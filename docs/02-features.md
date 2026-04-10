# 02 — Funcionalidades Principais

## Módulos Funcionais do Caetano PrimeMail

---

## Módulo 1 — Autenticação e Utilizadores

### 1.1 Registo
- Registo de utilizadores por convite (admin cria o utilizador ou envia convite por email)
- O registo público é desativado por defeito (ambiente corporativo controlado)
- Formulário com: nome, email, password, confirmação de password
- Envio de email de verificação após registo
- Password com requisitos mínimos: 12 caracteres, maiúsculas, minúsculas, números, símbolos

### 1.2 Login
- Formulário de login: email + password
- Feedback de erro genérico (não revela se o email existe — anti-enumeration)
- Proteção contra brute force: bloqueio temporário após N tentativas falhadas (rate limiting)
- Redirecionamento para a última marca ativa após login bem-sucedido
- Registo de evento de login nos audit logs

### 1.3 Logout
- Invalida a sessão atual
- Limpa os cookies de sessão
- Registo de evento de logout nos audit logs
- Redirecionamento para a página de login

### 1.4 Recuperação de Password
- Formulário de "esqueci a password" com input de email
- Envio de link temporário e único (token com expiração de 60 minutos)
- O link de reset só funciona uma vez
- Registo de evento de reset de password nos audit logs

### 1.5 Verificação de Email
- Email de verificação enviado após registo ou alteração de email
- Link com token de verificação (expiração de 24 horas)
- Acesso limitado até email verificado
- Opção de reenviar email de verificação

### 1.6 Gestão de Sessão
- Sessões com expiração configurável (por defeito: 8 horas de inatividade)
- Opção "lembrar-me" que estende a sessão para 30 dias
- Visualização das sessões ativas (dispositivo, IP, data/hora, localização aproximada)
- Possibilidade de terminar sessões específicas ou todas as sessões ativas

### 1.7 Perfis de Utilizador
- Nome, email, avatar/foto de perfil
- Alteração de password (requer password atual)
- Preferências de notificação
- Histórico de atividade recente
- Marca(s) associadas ao perfil

### 1.8 Papéis e Permissões

| Papel | Descrição |
|-------|-----------|
| `super_admin` | Acesso total a tudo. Gestão de sistema global |
| `group_admin` | Acesso a todas as marcas. Gestão de utilizadores |
| `brand_admin` | Admin de marca(s) específica(s). Gestão de utilizadores da marca |
| `marketing_manager` | Cria, edita e envia campanhas. Gere listas e segmentos |
| `marketing_coordinator` | Cria rascunhos, importa listas. Não pode enviar |
| `analyst` | Leitura apenas. Acesso a relatórios e métricas |

### 1.9 Permissões por Marca
- Um utilizador pode ter papéis diferentes em marcas diferentes
- Ex: `marketing_manager` na BMW e `analyst` na Hyundai
- O sistema verifica sempre: (utilizador) + (ação) + (marca) = permitido/negado
- Tabela `user_brand_roles` associa utilizador + marca + papel

### 1.10 2FA (Fase 2)
- Autenticação de dois fatores via TOTP (Google Authenticator, Authy)
- Opcional por utilizador, obrigatório por configuração de sistema
- Códigos de backup para recuperação

---

## Módulo 2 — Gestão de Marcas

### 2.1 Entidade Marca
- **Nome** da marca (ex: BMW, Hyundai, Dacia)
- **Slug** único (ex: `bmw`, `hyundai`) para URLs e referências internas
- **Logótipo** (upload de imagem)
- **Cor primária** (hex) para personalização visual do contexto
- **Email de remetente padrão** (From Name + From Email por marca)
- **Reply-to** padrão por marca
- **Assinatura de email** padrão por marca
- **Configuração SMTP/API de envio** por marca (opcional — pode herdar da configuração global)
- **Status** (ativa/inativa)
- **Data de criação e última modificação**

### 2.2 Dropdown / Selector de Marca
- Presente no topo da interface, sempre visível quando autenticado
- Mostra a marca atualmente ativa com logótipo e nome
- Lista apenas as marcas às quais o utilizador tem acesso
- Pesquisa rápida no dropdown para utilizadores com muitas marcas
- Ao selecionar uma marca, dispara reload de contexto sem reload de página (SPA)
- A marca selecionada é persistida na sessão do utilizador

### 2.3 Mudança de Contexto Ativo
- Quando a marca muda, a aplicação:
  1. Guarda a nova `active_brand_id` na sessão
  2. Atualiza o estado global da aplicação (Vuex/Pinia store)
  3. Recarrega os dados do dashboard, listas, campanhas no contexto da nova marca
  4. Atualiza indicadores visuais (cor de destaque, nome da marca no header)
  5. Redireciona para o dashboard da marca se estiver numa página específica de outra

### 2.4 Carregamento de Dados por Marca
- Todas as queries incluem `WHERE brand_id = :active_brand_id`
- Middleware de API valida que o `brand_id` do pedido corresponde à marca ativa do utilizador
- Nenhum dado de outra marca é exposto acidentalmente

### 2.5 Restrições de Acesso por Marca
- Middleware `BrandAccessMiddleware` verifica: o utilizador tem acesso à marca solicitada?
- Se não tiver acesso, devolve 403 Forbidden
- Nunca expõe dados de marcas não autorizadas (nem 404 — para não revelar existência)

### 2.6 Branding e Configuração por Marca
- Cada marca tem configuração própria:
  - Templates de email padrão
  - Rodapé de email com dados legais
  - Cor do botão de unsubscribe
  - URL de unsubscribe personalizada
  - Endereço físico para CAN-SPAM / RGPD
  - Configuração de bounce handling

### 2.7 Dashboards por Marca
- Dashboard carrega métricas apenas da marca ativa
- KPIs rápidos: total de contactos, campanhas enviadas, taxa de abertura média, bounces recentes
- Gráficos de tendência (últimos 30/90 dias) no contexto da marca
- Admins de grupo veem um dashboard adicional com visão agregada de todas as marcas

---

## Módulo 3 — Gestão de Contactos

### 3.1 Listas de Contactos
- Criar lista com nome, descrição e associação obrigatória a uma marca
- Uma lista pertence a uma (e apenas uma) marca
- Visualização de todos os contactos de uma lista com paginação
- Contagem de contactos ativos, unsubscribed, bounced
- Histórico de importações associado à lista
- Duplicação de lista (sem os contactos)
- Arquivamento de lista (desativa sem apagar)

### 3.2 Importação CSV / Excel
- Upload de ficheiro CSV ou XLSX
- Tamanho máximo configurável (ex: 100MB)
- Processamento 100% assíncrono — o utilizador não bloqueia
- Progresso em tempo real via polling ou WebSocket
- Histórico de todas as importações com estado, erros e resumo
- Funcionalidade detalhada descrita em [07 — Fluxo de Importação](07-import-flow.md)

### 3.3 Mapeamento de Colunas
- Interface de mapeamento: coluna do ficheiro → campo do sistema
- Campos do sistema: email, nome, apelido, telefone, empresa, campos customizados
- Pré-visualização das primeiras 5 linhas para validação visual
- Memorização do último mapeamento para o mesmo tipo de ficheiro

### 3.4 Validação de Dados
- Validação de formato de email (RFC 5321 compliant)
- Remoção de espaços extra, lowercasing de emails
- Validação de campos obrigatórios
- Relatório de linhas inválidas com indicação do erro

### 3.5 Deduplicação
- Deduplicação baseada em email (case-insensitive)
- No mesmo import: a segunda ocorrência é ignorada ou mergida (configurável)
- Entre imports: se o contacto já existe na lista, é atualizado (não duplicado)
- Se o contacto existe em outra lista da mesma marca, é referenciado (não duplicado na tabela `contacts`)
- Relatório de deduplicação no resumo de importação

### 3.6 Tags
- Tags livres associadas a contactos
- Multi-tag por contacto
- Filtragem de contactos por tag
- Criação de segmentos baseada em tags
- Tags têm contexto de marca (uma tag "VIP" da BMW é diferente da da Hyundai)

### 3.7 Segmentos
- Criação de segmentos dinâmicos com regras
- Operadores: igual, contém, começa por, maior que, menor que, entre, existe, não existe
- Campos disponíveis para segmentação: campos padrão + campos customizados + tags + comportamento (abriu campanha X, clicou em Y)
- Preview do número de contactos que correspondem ao segmento antes de guardar
- Segmentos são avaliados em tempo de envio (não são listas estáticas — são queries)

### 3.8 Campos Personalizados
- Criação de campos customizados por marca: texto, número, data, booleano, lista de opções
- Mapeados na importação
- Disponíveis como variáveis de personalização nas campanhas (merge tags)
- Ex: `{{first_name}}`, `{{vehicle_model}}`, `{{last_service_date}}`

### 3.9 Histórico de Importações
- Lista de todas as importações de uma lista, com:
  - Data/hora
  - Utilizador que importou
  - Ficheiro original (link para download temporário)
  - Total de linhas, importados, atualizados, ignorados, erros
  - Estado: pending, processing, completed, failed
  - Ficheiro de erros para download

### 3.10 Supressão de Contactos
- Lista de supressão global por marca (emails que nunca devem receber)
- Unsubscribes adicionados automaticamente à lista de supressão da marca
- Bounces hard adicionados automaticamente à supressão
- Importação de lista de supressão externa

### 3.11 Unsubscribes
- Processamento automático de unsubscribes via link de unsubscribe em cada email
- Unsubscribe one-click (RFC 8058)
- Landing page de unsubscribe com confirmação
- Opção de unsubscribe seletivo (desta lista apenas vs. todas as comunicações da marca)
- Registo de unsubscribe com timestamp, source (link, manual, import)
- Não se pode reenviar para um contacto unsubscribed (proteção no momento do envio)

### 3.12 Blacklist / Suppression List
- Lista negra global: emails bloqueados a nível de plataforma (ex: domínios inválidos, endereços abusivos)
- Suppression list por marca (ex: contactos que pediram não ser contactados pela BMW)
- Verificação em todas as etapas: importação, segmento e envio

### 3.13 Associação de Contactos a Marca(s)
- Um contacto (email único) pode estar associado a múltiplas marcas
- A entidade `contacts` é partilhada (email único), mas a relação com listas e marcas é via `contact_list_members` e `contact_brand_relations`
- Consentimento é gerido por marca — o mesmo email pode ter consentimento na BMW mas não na Hyundai

---

## Módulo 4 — Campanhas

### 4.1 Criação de Campanha
- Nome interno da campanha
- Assunto do email (subject line)
- Preview text (pre-header)
- Remetente (From Name + From Email, herdado da marca ou personalizado)
- Reply-to
- Seleção de lista(s) e/ou segmento(s) destinatários
- Associação obrigatória à marca ativa

### 4.2 Editor de Email
- **Editor visual drag-and-drop** (integração com Unlayer, Stripo, MJML ou similar)
- **Editor HTML** para utilizadores avançados
- Suporte a merge tags / variáveis de personalização (`{{first_name}}`, `{{unsubscribe_url}}`, etc.)
- Preview de desktop e mobile em tempo real
- Envio de email de teste para endereço específico
- Verificação de links antes de envio

### 4.3 Rascunhos
- Campanhas guardadas como rascunho até serem agendadas ou enviadas
- Auto-save a cada 30 segundos no editor
- Histórico de versões do rascunho (simples, últimas 5 versões)

### 4.4 Agendamento
- Seleção de data e hora de envio com timezone configurável
- Validação: não se pode agendar para o passado
- Preview da audiência estimada no momento do agendamento
- Cancelamento de agendamento possível até ao momento do envio

### 4.5 Envio Imediato
- Envio imediato com confirmação explícita ("Tem a certeza que quer enviar agora?")
- Estimativa do número de destinatários mostrada antes da confirmação
- Após confirmação, o envio é processado em background (queue)

### 4.6 Duplicação de Campanha
- Duplicar uma campanha cria um rascunho com o mesmo conteúdo, assunto e configuração
- Permite criar variações rapidamente
- O rascunho duplicado fica associado à marca ativa (pode ser a mesma ou outra, se o utilizador tem acesso)

### 4.7 Seleção de Listas / Segmentos
- Possibilidade de selecionar múltiplas listas para uma campanha
- Possibilidade de excluir segmentos (ex: "envia para lista X excepto segmento Y")
- Deduplicação automática de destinatários quando há sobreposição entre listas

### 4.8 Segmentação por Marca
- Só é possível selecionar listas e segmentos da marca ativa
- A campanha fica marcada com o `brand_id` da marca ativa
- Não é possível criar uma campanha que misture contactos de marcas diferentes

### 4.9 Preview / Test Email
- Envio de email de teste para até 5 endereços
- Os merge tags são preenchidos com dados de um contacto real ou valores mock configuráveis
- Preview renderizado em HTML na interface (iframe sandbox)

### 4.10 Estados da Campanha

| Estado | Descrição |
|--------|-----------|
| `draft` | Rascunho, em edição |
| `scheduled` | Agendada para envio futuro |
| `sending` | A ser processada e enviada |
| `sent` | Envio concluído |
| `paused` | Envio pausado manualmente |
| `cancelled` | Cancelada antes do envio |
| `failed` | Falha crítica no envio |

---

## Módulo 5 — Templates

### 5.1 Templates por Marca
- Templates criados e geridos no contexto de uma marca
- Visíveis apenas para utilizadores com acesso à marca
- Podem ser usados como base para novas campanhas

### 5.2 Templates Partilhados vs. Exclusivos
- **Template partilhado**: visível a todas as marcas (ex: layout base do grupo)
- **Template exclusivo**: visível apenas à marca proprietária
- Templates partilhados geridos pelo `group_admin` ou `super_admin`

### 5.3 Versionamento Simples (V2)
- Guarda até N versões de um template
- Possibilidade de reverter para versão anterior
- Comparação visual entre versões (V2 roadmap)

---

## Módulo 6 — Relatórios e Métricas

### 6.1 Métricas por Campanha
- **Entregues**: total de emails aceites pelo servidor de destino
- **Aberturas**: total e únicas (tracking pixel)
- **Cliques**: total e únicos (tracking de redirect)
- **Bounces**: soft (temporário) e hard (permanente)
- **Unsubscribes**: total de unsubscribes via link na campanha
- **Spam complaints**: reclamações de spam (via feedback loops)
- **Taxa de abertura**: aberturas únicas / entregues × 100
- **Taxa de clique**: cliques únicos / entregues × 100
- **Taxa de clique sobre abertura (CTOR)**: cliques / aberturas × 100

### 6.2 Visão Geral por Campanha
- Dashboard de campanha individual com todas as métricas
- Timeline de eventos (quando foram abertas, clicadas, etc.)
- Top links clicados
- Mapa de calor de cliques no email (V2)
- Lista de contactos que abriram / clicaram / bounced / unsubscribed

### 6.3 Dashboard de Métricas Principais
- Métricas dos últimos 30/90 dias
- Campanhas recentes com performance
- Tendências de abertura e clique
- Alertas de degradação de performance (taxa de bounce elevada, etc.)
- Tudo filtrado pela marca ativa

### 6.4 Relatórios por Marca
- Todas as vistas de relatório filtradas pela `active_brand_id`
- Impossível ver métricas de outras marcas sem mudar o contexto

### 6.5 Visão Agregada Multi-Marca (Admins)
- Disponível apenas para `group_admin` e `super_admin`
- Comparação de performance entre marcas
- Tabela de KPIs por marca (side-by-side)
- Exportação para CSV/Excel

---

*Próximo: [03 — Definição de MVP](03-mvp.md)*
