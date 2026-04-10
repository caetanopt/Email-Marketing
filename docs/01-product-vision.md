# 01 — Visão do Produto

## Caetano PrimeMail — Product Vision Document

---

## 1.1 Objetivo da Plataforma

O **Caetano PrimeMail** nasce para resolver um problema concreto do Grupo Caetano: gerir comunicações de email marketing para múltiplas marcas automóveis de forma centralizada, eficiente, segura e conforme com o RGPD, sem depender de ferramentas externas pagas por volume de envio ou de plataformas genéricas que não refletem a realidade operacional multi-marca do grupo.

A plataforma cobre todo o ciclo de vida de uma campanha de email marketing:
- Construção e gestão de bases de dados de contactos por marca
- Criação, agendamento e envio de campanhas
- Rastreabilidade de aberturas, cliques, bounces e unsubscribes
- Gestão de consentimento e conformidade legal

---

## 1.2 Tipo de Utilizador

### Utilizadores Primários

| Perfil | Descrição |
|--------|-----------|
| **Marketing Manager (por marca)** | Gere campanhas, listas e relatórios da sua marca específica |
| **Marketing Coordinator** | Cria rascunhos, importa listas, agenda campanhas |
| **Brand Admin** | Administra utilizadores e configurações da sua marca |
| **Group Administrator** | Acesso total a todas as marcas, configuração global da plataforma |
| **Read-only Analyst** | Visualiza relatórios e métricas sem poder criar ou enviar |

### Utilizadores Secundários (indiretos)

- **Contactos** — os destinatários que recebem campanhas e interagem com as mesmas (abertura, clique, unsubscribe)
- **Responsável de IT** — garante infraestrutura, backups, monitorização

---

## 1.3 Problemas que Resolve

### Problema 1 — Fragmentação de ferramentas
Sem uma plataforma central, cada marca pode estar a usar soluções diferentes (Mailchimp, Excel, Google Sheets, MailerLite), criando silos de dados, duplicação de contactos entre marcas e inconsistência de comunicação.

**Solução:** Uma única plataforma com contextos de marca isolados logicamente.

### Problema 2 — Ausência de controlo sobre dados
Plataformas externas detêm os dados dos contactos. Em caso de RGPD, não há soberania total sobre os dados pessoais.

**Solução:** Plataforma self-hosted ou hosted internamente, com total controlo sobre os dados.

### Problema 3 — Custo variável por volume
Ferramentas como Mailchimp cobram por contacto e por envio. Com bases de dados de centenas de milhares de contactos e múltiplas marcas, os custos tornam-se proibitivos.

**Solução:** Plataforma própria com custo fixo de infraestrutura.

### Problema 4 — Falta de contexto de marca
Ferramentas genéricas não têm uma lógica nativa de marca. Trabalhar com múltiplas marcas implica múltiplas contas separadas, sem visão consolidada.

**Solução:** Arquitetura multi-brand nativa com contexto de marca selecionável.

### Problema 5 — Gestão de consentimento e RGPD
Gerir opt-ins, opt-outs, supressões e direito ao esquecimento em ferramentas externas é complexo e arriscado.

**Solução:** RGPD integrado na plataforma: consentimento rastreável, unsubscribes automáticos, supressão por marca, direito ao esquecimento com auditoria.

### Problema 6 — Importações de grandes bases de dados
Importar ficheiros CSV com dezenas ou centenas de milhar de contactos em ferramentas tradicionais é lento, bloqueante e propenso a falhas.

**Solução:** Sistema de importação assíncrona em chunks, com feedback de progresso e histórico de importações.

---

## 1.4 Proposta de Valor

> **"Uma única plataforma para gerir todas as comunicações de email marketing do Grupo Caetano, com contexto de marca nativo, performance para grandes volumes, soberania de dados e conformidade RGPD integrada."**

### Para a equipa de marketing:
- Interface intuitiva, semelhante a ferramentas conhecidas (Mailchimp, HubSpot)
- Contexto de marca imediato ao fazer login
- Campanhas, listas e relatórios sempre filtrados pela marca ativa
- Criação de campanhas sem fricção técnica

### Para o grupo:
- Soberania total sobre os dados de contactos
- Custo fixo e previsível (infraestrutura própria)
- Conformidade RGPD nativa e auditável
- Visão consolidada multi-marca para administradores

### Para IT:
- Backend PHP/Laravel — stack conhecida e maintível
- Docker-ready e preparado para cloud
- Logging, monitorização e alertas integrados
- Arquitetura escalável sem necessidade de reescrever

---

## 1.5 Diferenciais Face a Ferramentas Tradicionais

| Dimensão | Mailchimp | Sendy | Caetano PrimeMail |
|----------|-----------|-------|-------------------|
| Multi-marca nativo | Não (contas separadas) | Não | **Sim, nativo** |
| Self-hosted / soberania dados | Não | Sim | **Sim** |
| Custo | Por contacto/envio | Licença única | **Infraestrutura própria** |
| Importação grandes volumes | Limitado | Básico | **Assíncrona, chunked, com progresso** |
| RGPD integrado | Parcial | Mínimo | **Completo, com auditoria** |
| Permissões por marca | Não | Não | **Sim, granular** |
| Customização | Limitada | Limitada | **Total — codebase própria** |
| Relatórios multi-marca | Não | Não | **Sim, admin vê tudo** |
| Contexto de marca no UI | Não | Não | **Dropdown nativo, contexto imediato** |
| PHP Backend | Não | Sim (PHP básico) | **Laravel moderno** |

---

## 1.6 O Papel da Lógica Multi-Marca

A lógica multi-marca não é apenas um filtro. É um **paradigma arquitetural** que atravessa toda a plataforma.

### O que significa ter contexto de marca?

Quando um utilizador seleciona a marca **BMW** no dropdown do topo da aplicação:
- Todas as campanhas apresentadas são campanhas da BMW
- Todas as listas pertencem à BMW
- Os contactos mostrados são contactos associados à BMW
- Os templates disponíveis são da BMW (ou partilhados)
- As métricas do dashboard são da BMW
- As permissões verificadas são as permissões do utilizador para a BMW
- Qualquer nova campanha criada será automaticamente associada à BMW

### O que muda quando se troca de marca?

A troca de marca é equivalente a trocar de "workspace" ou "conta" em ferramentas como Slack, Notion ou Figma. A interface recarrega os dados no contexto da nova marca selecionada, sem necessidade de logout/login.

### Por que é estratégico?

- Permite que um utilizador com acesso a múltiplas marcas (ex: Group Admin) trabalhe em qualquer marca sem criar contas separadas
- Permite que um utilizador restrito (ex: Marketing BMW) apenas veja e trabalhe no contexto da BMW, sem acesso acidental a dados de outras marcas
- Centraliza a gestão, reduz fricção operacional e mantém os dados limpos e segregados por marca

---

## 1.7 Razão Estratégica para o Contexto de Marca Selecionável

### 1. Escalabilidade operacional
À medida que o grupo cresce (novas marcas, novos mercados), o sistema acomoda novas marcas sem reorganização de dados.

### 2. Controlo de acesso real
Um colaborador da BMW não deve ver as campanhas ou contactos da Hyundai. O contexto de marca garante que o isolamento de dados é estrutural, não só visual.

### 3. Autonomia por marca
Cada equipa de marketing trabalha de forma autónoma no seu contexto, com os seus templates, listas e relatórios — sem interferência de outras marcas.

### 4. Visão consolidada para gestão
Um administrador de grupo pode ver métricas de todas as marcas, comparar performance entre marcas e identificar padrões.

### 5. Conformidade RGPD por marca
Um contacto pode ter dado consentimento para a BMW mas não para a Hyundai. O sistema gere consentimentos por marca, não de forma global, garantindo conformidade legal.

---

*Próximo: [02 — Funcionalidades Principais](02-features.md)*
