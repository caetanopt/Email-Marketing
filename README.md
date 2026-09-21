# Caetano eMKT

> Plataforma de email marketing multi-marca do Grupo Caetano. **Em produção.**

Serve as marcas do grupo (BMW, Hyundai, BYD, Audi, Alpine, Dacia, Caetano Parts, entre outras) com uma base de contactos partilhada e campanhas, templates e segmentos por marca.

---

## Como isto está feito

Não há framework, nem build step, nem workers. É deliberado, e tem consequências que convém conhecer antes de mexer.

| Camada | O que é |
|---|---|
| Frontend | `email.html` — uma SPA num único ficheiro, ~19 000 linhas, Tailwind por CDN, sem compilação |
| Backend | Funções serverless Node.js na Vercel, uma por ficheiro em `api/` — **12 de 12 usadas** |
| Base de dados | PostgreSQL no Supabase, via `pg` (`lib/db.js`), pelo pooler na porta 6543 |
| Envio | Amazon SES (`SendRawEmailCommand`), eventos de volta por SNS → `api/track.js` |
| Ficheiros | Vercel Blob para logos e media de marca; anexos de campanha vão em base64 numa coluna JSONB |
| Esquema | Ficheiros SQL numerados em `migrations/`, **corridos à mão** no Supabase |
| Deploy | Push em `claude/email-marketing-saas-M2qZP` → GitHub Action → `vercel --prod` |

Três restrições que explicam quase todas as decisões do código:

1. **12 funções na Vercel, todas ocupadas.** Uma funcionalidade nova entra como `action=` numa rota existente, não como ficheiro novo. Os `rewrites` no `vercel.json` disfarçam isto (`/api/cron` é `campaigns?action=process-scheduled`).
2. **Não há fila nem workers.** A tabela `campaign_recipients` *é* a fila, e cada invocação reclama um lote com `FOR UPDATE SKIP LOCKED`. Os 60 s de limite da função são o que divide um envio em lotes.
3. **O agendamento depende de um cron externo** chamar `/api/cron`. Não há Vercel Cron. Se esse agendador parar, as campanhas agendadas não saem — ver o indicador «Agendador» no ecrã de Estatísticas.

## Por onde começar

| Quero… | Ler |
|---|---|
| perceber o sistema, operá-lo, ou desencravar alguma coisa | **[RUNBOOK.md](RUNBOOK.md)** — é o documento a sério |
| mexer no motor de envio | `lib/sendCampaign.js` |
| mexer no editor ou em qualquer ecrã | `email.html` |
| perceber tracking, webhooks e cancelamentos | `api/track.js`, `api/suppression/` |

## Antes de entregar alterações

```bash
node scripts/check-runtime.js
```

São sondas estáticas sobre o código: cada uma guarda uma correcção que já custou um incidente, e a mensagem de erro diz qual. Se uma falhar, não é ruído.

Uma alteração que traga uma migração nova **não está terminada** até o SQL ser corrido no Supabase → SQL Editor. Não há execução automática. O código tolera migrações por correr (fallbacks de `42P01`/`42703`) para não rebentar entre o deploy e a migração — não porque seja opcional.

## Nota sobre `docs/`

A pasta `docs/` é o PRD original de Abril de 2026 e descreve uma arquitectura em Laravel + Vue + MySQL + Redis + Horizon que **nunca foi construída**. Vale como intenção de produto — funcionalidades, regras de negócio, prioridades. Não descreve este sistema, e nada lá dentro deve ser lido como referência técnica.

---

*Grupo Salvador Caetano*
