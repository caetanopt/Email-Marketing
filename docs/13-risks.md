# 13 — Riscos Técnicos e Mitigação

## Caetano PrimeMail — Matriz de Riscos

---

## 13.1 Matriz de Riscos

| # | Risco | Impacto | Probabilidade | Prioridade | Mitigação |
|---|-------|---------|---------------|------------|-----------|
| R01 | Degradação de performance com volume crescente | Alto | Média | **Crítico** | Índices compostos, paginação cursor-based, cache, archiving |
| R02 | Duplicação massiva de contactos | Alto | Alta | **Crítico** | Deduplicação `ON DUPLICATE KEY`, hash de email, testes de carga |
| R03 | Importações falhadas/incompletas | Médio | Média | **Alto** | Jobs com retry, progresso granular, ficheiro de erros, histórico |
| R04 | Lentidão nas queries com múltiplas marcas | Alto | Média | **Alto** | Índices com brand_id como prefixo, Global Scope, cache por marca |
| R05 | Problemas de entregabilidade (spam) | Alto | Média | **Alto** | SPF/DKIM/DMARC, IP warming, bounce monitoring, unsubscribe one-click |
| R06 | Falha de segurança / acesso não autorizado | Alto | Baixa | **Alto** | OWASP hardening, policies, isolamento de marca, testes de segurança |
| R07 | Crescimento descontrolado da base de dados | Médio | Alta | **Alto** | Particionamento, archiving, retenção de dados, cleanup jobs |
| R08 | Má gestão de permissões (acesso indevido a marca) | Alto | Baixa | **Alto** | BrandScope global, BrandAccessMiddleware, testes de isolamento |
| R09 | Falha no isolamento lógico por marca | Alto | Baixa | **Crítico** | Global Scope obrigatório, testes de segurança por marca, code review |
| R10 | Falha na rastreabilidade de eventos (opens/clicks) | Médio | Média | **Médio** | Buffer Redis, flush assíncrono, dead letter queue |
| R11 | Jobs de importação pendentes após falha de servidor | Médio | Baixa | **Médio** | Redis persistence, job retry, horizon monitoring, alertas |
| R12 | Conflito de dados em imports simultâneos | Médio | Média | **Médio** | Mutex por import, INSERT ON DUPLICATE KEY, deduplicação atómica |
| R13 | Violação de RGPD (exposição de dados pessoais) | Alto | Baixa | **Crítico** | Audit logs, anonimização, direito ao esquecimento, backups encriptados |
| R14 | Abuso do sistema de envio (spam enviado via plataforma) | Alto | Baixa | **Alto** | Aprovação de campanhas, rate limiting de envio, monitorização de bounce |
| R15 | Falha do provider de email (SES/Mailgun down) | Médio | Baixa | **Médio** | Fallback para provider secundário, retry de envio, alertas |
| R16 | Token de recuperação de password comprometido | Alto | Baixa | **Alto** | Token de uso único, expiração de 60 min, hash armazenado (não plain) |
| R17 | Upload de ficheiro malicioso | Alto | Baixa | **Alto** | Validação MIME real, armazenamento S3 privado, sem execução |
| R18 | Lock de base de dados em imports grandes | Alto | Média | **Alto** | INSERT em batch, transações pequenas, sem locks de tabela |
| R19 | Perda de dados por falha de infraestrutura | Alto | Baixa | **Alto** | Backups automáticos, replicação MySQL, S3 versioning |
| R20 | Dívida técnica acumulada (código não mantível) | Médio | Média | **Médio** | Code review obrigatório, padrões documentados, testes obrigatórios |

---

## 13.2 Detalhes dos Riscos Críticos

---

### R01 — Degradação de Performance com Volume Crescente

**Cenário:** A plataforma arranca com 100k contactos. Após 12 meses, tem 2M contactos e 50 marcas. As queries começam a ser lentas.

**Sinais de alerta:**
- Queries na `contact_list_members` > 500ms
- Dashboard de marca demora > 3 segundos
- Imports bloqueiam workers de envio

**Mitigação detalhada:**
1. **Índices compostos com `brand_id` desde o dia 1** — não é possível adicionar depois sem impacto operacional
2. **Cursor-based pagination** em vez de OFFSET em todas as listagens de contactos
3. **Cache de métricas** no Redis com TTL de 5 minutos
4. **Particionamento** de `email_events` por trimestre — permite DROP de partições antigas
5. **Counter columns** em `contact_lists` para não fazer `COUNT(*)` a cada request
6. **Read replica** para queries de relatórios (Fase 2)
7. **ANALYZE TABLE** agendado mensalmente

---

### R02 — Duplicação Massiva de Contactos

**Cenário:** Dois utilizadores importam o mesmo ficheiro CSV simultaneamente para a mesma lista. Resultado: 10.000 contactos duplicados.

**Mitigação detalhada:**
1. **UNIQUE constraint** em `contacts.email` — impossível ter dois registos com o mesmo email
2. **UNIQUE constraint** em `contact_list_members (contact_id, list_id)` — impossível o mesmo contacto estar duas vezes na mesma lista
3. **INSERT OR IGNORE / ON DUPLICATE KEY UPDATE** — a nível de SQL, elimina a duplicação
4. **Mutex por import job** — se dois imports correm em simultâneo para a mesma lista, o MySQL gere os conflitos via UNIQUE constraints
5. **Relatório de deduplicação** no resumo de cada import

---

### R09 — Falha no Isolamento Lógico por Marca

**Cenário:** Um bug no código faz com que um utilizador da BMW consiga ver campanhas da Hyundai quando muda de marca.

**Cenário crítico:** Um utilizador mal-intencionado manipula o parâmetro `brand_id` num pedido HTTP para aceder a dados de outra marca.

**Mitigação detalhada:**
1. **Global Scope de `brand_id` em TODOS os models** — é impossível fazer uma query sem o filtro de marca sem ser explícito (`withoutGlobalScope`)
2. **BrandAccessMiddleware** verificado em todos os requests — valida sessão + DB
3. **Nunca usar `brand_id` do request** — sempre usar `session('active_brand_id')`
4. **Route Model Binding com scope** — o binding usa automaticamente o Global Scope
5. **Testes de segurança obrigatórios por brand** — test suite dedicada a testar cross-brand access
6. **Code review checklist** — "este endpoint tem `brand_id` do request? Se sim, está a validar na Policy?"

```php
// REGRA DE ORO: nunca isto
$brandId = $request->brand_id; // NUNCA — pode ser manipulado

// SEMPRE isto
$brandId = session('active_brand_id'); // da sessão server-side, não do cliente
```

---

### R13 — Violação de RGPD

**Cenário:** Um utilizador exporta uma lista de 500k contactos com emails e dados pessoais para um ficheiro CSV. O ficheiro fica acessível publicamente.

**Cenário 2:** A plataforma é comprometida e dados de contactos são extraídos.

**Mitigação detalhada:**
1. **Exportações protegidas** — só para utilizadores autorizados, via URL assinada temporária
2. **Registos de exportação no audit log** — quem exportou o quê e quando
3. **Dados pessoais encriptados em backup** — AES-256
4. **Notificação de breach** — processo documentado para cumprimento do prazo RGPD (72h para notificar CNPD)
5. **Minimização de dados** — não recolher dados que não são necessários
6. **Retenção automática** — contactos sem consentimento ativo após X meses são anonimizados automaticamente
7. **DPO designado** — responsável pela gestão de pedidos RGPD
8. **Data Processing Agreement (DPA)** com todos os sub-processadores (AWS, Mailgun, etc.)

---

### R18 — Lock de Base de Dados em Imports Grandes

**Cenário:** Um import de 500k contactos faz INSERT em batch numa tabela com 2M linhas existentes. A operação bloqueia queries de leitura.

**Mitigação detalhada:**
1. **InnoDB row-level locking** — apenas bloqueia as linhas afetadas, não a tabela inteira
2. **Transações pequenas** — cada chunk de 500 linhas tem a sua própria transação
3. **INSERT IGNORE / ON DUPLICATE KEY** em vez de SELECT + INSERT — evita leituras desnecessárias
4. **`innodb_buffer_pool_size`** bem configurado — > 70% da RAM disponível para MySQL
5. **Sem `LOCK TABLES`** em nenhuma parte do código — usar row-level locks do InnoDB
6. **Reads sem lock** para dashboards — usar `SELECT ... LOCK IN SHARE MODE` apenas quando necessário
7. **Monitorização de slow queries** — alertas quando query > 1s

---

## 13.3 Riscos de Negócio (Não-Técnicos)

| Risco | Mitigação |
|-------|-----------|
| Adoção fraca pelos utilizadores | UX familiar, formação inicial, suporte responsivo |
| Resistência à mudança vs. Mailchimp | Demonstrar migração suave, equivalência funcional, manter familiaridade UX |
| Equipa de dev pequena com escopo grande | MVP rigoroso, sem features desnecessárias, foco em fundação técnica |
| Provider de email bloqueado por spam | Warm-up de IP, monitorização de reputação, separação de IPs por marca |
| Não-conformidade RGPD descoberta tarde | Audit RGPD formal antes do lançamento, DPO envolvido desde o início |

---

## 13.4 Plano de Resposta a Incidentes

### Níveis de Severidade

| Nível | Descrição | Tempo de Resposta |
|-------|-----------|------------------|
| P0 | Plataforma inacessível para todos os utilizadores | 15 minutos |
| P1 | Funcionalidade crítica quebrada (login, envio) | 1 hora |
| P2 | Performance degradada (> 5s em operações normais) | 4 horas |
| P3 | Bug não-crítico ou funcionalidade secundária | Próximo sprint |

### Contactos de Escalada

- P0/P1: Responsável técnico + CTO imediatamente
- Breach de dados: DPO + DPO adjunto em 30 minutos, CNPD em 72 horas se aplicável

---

*Próximo: [14 — Resumo Executivo](14-summary.md)*
