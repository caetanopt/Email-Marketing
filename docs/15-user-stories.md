# 15 — User Stories Iniciais

## Caetano PrimeMail — Histórias de Utilizador para o MVP

---

## Autenticação e Acesso

**US-01**
Como utilizador, quero fazer login com o meu email e password para aceder à minha conta de forma segura.

**US-02**
Como utilizador, quero que o sistema bloqueie temporariamente o meu acesso após 5 tentativas de login falhadas para me proteger de ataques de brute force.

**US-03**
Como utilizador, quero recuperar a minha password através de um email com um link temporário e de uso único para retomar o acesso caso esqueça a password.

**US-04**
Como utilizador, quero receber um email de verificação após o meu registo para confirmar a minha identidade antes de poder aceder à plataforma.

**US-05**
Como utilizador, quero visualizar as sessões ativas na minha conta para detectar acessos não autorizados e terminá-los remotamente.

**US-06**
Como utilizador, quero fazer logout de forma segura para garantir que ninguém acede à minha conta após eu terminar a sessão.

---

## Gestão de Marcas e Contexto

**US-07**
Como utilizador, quero selecionar uma marca no dropdown do topo da aplicação para passar a trabalhar no contexto dessa marca específica.

**US-08**
Como utilizador, quero que ao mudar de marca a interface atualize automaticamente todos os dados (campanhas, listas, contactos) para o contexto da nova marca selecionada.

**US-09**
Como utilizador, quero que a marca ativa seja memorizada entre sessões para não ter de selecionar a marca a cada login.

**US-10**
Como utilizador, quero ver um indicador visual claro da marca em que estou a trabalhar para não confundir dados de marcas diferentes.

**US-11**
Como administrador de grupo, quero criar e gerir marcas (nome, logótipo, email remetente) para configurar o contexto operacional de cada marca.

**US-12**
Como administrador de grupo, quero associar utilizadores a marcas específicas com papéis definidos para controlar quem tem acesso ao quê.

---

## Gestão de Contactos e Importação

**US-13**
Como utilizador, quero criar uma lista de contactos associada à marca ativa para organizar os meus destinatários por grupo.

**US-14**
Como utilizador, quero importar uma base de dados CSV para uma lista da marca ativa para adicionar contactos em grande volume de forma eficiente.

**US-15**
Como utilizador, quero mapear as colunas do ficheiro CSV para os campos do sistema antes de iniciar a importação para garantir que os dados ficam corretamente estruturados.

**US-16**
Como utilizador, quero ver uma pré-visualização das primeiras linhas do ficheiro durante o mapeamento de colunas para verificar que os dados estão corretos antes de importar.

**US-17**
Como utilizador, quero ver o progresso da importação em tempo real (percentagem e contagens) para perceber se o sistema está a processar corretamente sem ter de esperar pelo resultado final.

**US-18**
Como utilizador, quero poder fechar a janela de progresso da importação e continuar a trabalhar noutra área enquanto a importação corre em background.

**US-19**
Como utilizador, quero ver um resumo detalhado no final da importação (contactos importados, atualizados, ignorados, erros) para validar a qualidade dos dados.

**US-20**
Como utilizador, quero descarregar um ficheiro de erros após uma importação para identificar e corrigir as linhas que falharam.

**US-21**
Como utilizador, quero ver o histórico completo de importações de uma lista para ter rastreabilidade de quando e por quem foram feitos os uploads.

**US-22**
Como utilizador, quero que o sistema faça deduplicação automática durante a importação para evitar que o mesmo email apareça múltiplas vezes na mesma lista.

---

## Campanhas

**US-23**
Como utilizador, quero criar uma campanha de email associada à marca ativa para comunicar com os contactos dessa marca.

**US-24**
Como utilizador, quero definir o assunto, preview text, remetente e conteúdo HTML da campanha para personalizar a comunicação.

**US-25**
Como utilizador, quero usar merge tags como `{{first_name}}` no conteúdo da campanha para personalizar os emails individualmente.

**US-26**
Como utilizador, quero enviar um email de teste antes de enviar a campanha para verificar a aparência e funcionamento antes de atingir os destinatários reais.

**US-27**
Como utilizador, quero selecionar uma ou mais listas como destinatárias da campanha para definir quem vai receber o email.

**US-28**
Como utilizador, quero ver a estimativa do número de destinatários únicos antes de confirmar o envio para saber o alcance da campanha.

**US-29**
Como utilizador, quero agendar uma campanha para uma data e hora futuras para programar comunicações com antecedência.

**US-30**
Como utilizador, quero enviar uma campanha imediatamente com uma confirmação explícita para ter controlo total sobre o momento do envio.

**US-31**
Como utilizador, quero ver o estado atual de cada campanha (rascunho, agendada, a enviar, enviada, falhada) para acompanhar o progresso.

**US-32**
Como utilizador, quero duplicar uma campanha existente para criar rapidamente uma variação com base num conteúdo anterior.

---

## Unsubscribes e Conformidade

**US-33**
Como destinatário de um email de campanha, quero clicar num link de unsubscribe para deixar de receber comunicações dessa marca de forma imediata.

**US-34**
Como utilizador da plataforma, quero que os unsubscribes sejam processados automaticamente e que os contactos unsubscribed não recebam mais campanhas da marca.

**US-35**
Como utilizador, quero ver a lista de contactos unsubscribed da minha marca para ter visibilidade sobre quem optou por não receber comunicações.

---

## Relatórios e Métricas

**US-36**
Como utilizador, quero ver as métricas de uma campanha enviada (entregues, aberturas, cliques, bounces, unsubscribes) para avaliar a performance da comunicação.

**US-37**
Como utilizador, quero ver um dashboard com os KPIs principais da marca ativa (últimos 30 dias) para ter uma visão rápida da performance de email marketing.

**US-38**
Como utilizador, quero que todas as métricas e relatórios estejam filtrados pela marca ativa para não ver dados de outras marcas.

---

## Administração

**US-39**
Como administrador, quero criar utilizadores por convite (enviando um email de convite) para controlar quem tem acesso à plataforma.

**US-40**
Como administrador, quero definir o papel de um utilizador numa marca (ex: marketing_manager na BMW, analyst na Hyundai) para controlar o nível de acesso por marca.

**US-41**
Como administrador, quero revogar o acesso de um utilizador a uma marca sem apagar a sua conta para gerir mudanças na equipa.

**US-42**
Como administrador de grupo, quero ver um audit log das ações mais importantes na plataforma (logins, envios, importações) para fins de auditoria e conformidade.

---

## Templates

**US-43**
Como utilizador, quero criar e guardar templates HTML por marca para reutilizar estruturas de email sem ter de recriar do zero.

**US-44**
Como utilizador, quero selecionar um template existente ao criar uma nova campanha para acelerar o processo de criação.

**US-45**
Como administrador de grupo, quero criar templates partilhados disponíveis a todas as marcas para garantir consistência no design de base.

---

## Segurança e Privacidade

**US-46**
Como responsável de RGPD, quero processar um pedido de "direito ao esquecimento" de um contacto para anonimizar os seus dados pessoais mantendo o registo de unsubscribe para conformidade legal.

**US-47**
Como utilizador, quero que o sistema me impeça de enviar uma campanha para contactos que já fizeram unsubscribe para garantir conformidade legal e respeito pela preferência do destinatário.
