# Caetano PrimeMail

> **Plataforma SaaS de Email Marketing Multi-Marca para o Grupo Caetano**

---

## O que é o Caetano PrimeMail?

O **Caetano PrimeMail** é uma plataforma profissional de email marketing construída especificamente para operar num ambiente **multi-marca** (multi-brand), servindo as diferentes marcas do Grupo Caetano (BMW, Hyundai, BYD, Audi, Alpine, Dacia, Caetano Parts, entre outras).

A plataforma combina a usabilidade de ferramentas como Mailchimp com o controlo e soberania de dados de soluções auto-hospedadas como o Sendy, adaptada às necessidades operacionais de um grupo automóvel com múltiplas marcas, bases de dados extensas e requisitos rigorosos de segurança e conformidade RGPD.

---

## Documentação do Projeto

| # | Documento | Descrição |
|---|-----------|-----------|
| 01 | [Visão do Produto](docs/01-product-vision.md) | Objetivo, proposta de valor, diferenciais, papel da lógica multi-marca |
| 02 | [Funcionalidades Principais](docs/02-features.md) | Módulos funcionais detalhados |
| 03 | [Definição de MVP](docs/03-mvp.md) | MVP obrigatório e roadmap V2+ |
| 04 | [Arquitetura Técnica](docs/04-technical-architecture.md) | Stack, infraestrutura, serviços |
| 05 | [Arquitetura de Dados](docs/05-data-architecture.md) | Entidades, relações, índices, estratégia multi-marca |
| 06 | [Estratégia de Performance](docs/06-performance-strategy.md) | Grandes volumes, queries, cache, workers |
| 07 | [Fluxo de Importação](docs/07-import-flow.md) | Pipeline completo de importação de contactos |
| 08 | [Autenticação e Login](docs/08-authentication-flow.md) | Fluxo seguro de autenticação e sessões |
| 09 | [Segurança e Proteção de Dados](docs/09-security.md) | RGPD, proteção de endpoints, auditoria |
| 10 | [UX / Dashboard / Backoffice](docs/10-ux-dashboard.md) | Estrutura da interface, navegação, contexto de marca |
| 11 | [API e Organização do Código](docs/11-api-code-organization.md) | Estrutura Laravel, padrões, testes |
| 12 | [Roadmap por Fases](docs/12-roadmap.md) | Fase 1 MVP → Fase 2 Otimização → Fase 3 Escala |
| 13 | [Riscos e Mitigação](docs/13-risks.md) | Tabela de riscos técnicos e estratégias |
| 14 | [Resumo Executivo](docs/14-summary.md) | Stack, arquitetura, MVP e prioridades do dia 1 |
| 15 | [User Stories](docs/15-user-stories.md) | Histórias de utilizador iniciais |
| 16 | [Requisitos Não Funcionais](docs/16-non-functional-requirements.md) | Performance, segurança, disponibilidade |
| 17 | [Ordem de Desenvolvimento](docs/17-development-order.md) | Sequência recomendada de implementação |

---

## Stack Tecnológica (Resumo)

| Camada | Tecnologia |
|--------|-----------|
| Backend | PHP 8.3 + Laravel 11 |
| Frontend | Inertia.js + Vue 3 + Tailwind CSS |
| Base de dados | MySQL 8.0 (principal) + Redis 7 |
| Filas / Workers | Laravel Queues + Redis + Horizon |
| Ficheiros | S3-compatible (MinIO local / AWS S3 prod) |
| Emails transacionais | Mailgun / SES via Laravel Mail |
| Envio de campanhas | SMTP próprio ou SES + Mailgun |
| Infraestrutura | Docker + Docker Compose (dev) / AWS ou VPS (prod) |
| Observabilidade | Laravel Telescope (dev) + Sentry + Grafana |
| Auth | Laravel Sanctum (sessões web) + política por marca |

---

## Princípios Fundamentais

1. **Performance First** — Nenhuma operação pesada bloqueia a interface. Tudo processado de forma assíncrona.
2. **Security First** — Autenticação obrigatória, autorização granular, RGPD nativo.
3. **Brand Context** — Todo o dado, campanha, lista e métrica está sempre associado a uma marca.
4. **Scalability by Design** — Índices compostos, paginação, workers, cache desde o dia 1.
5. **PHP Backend** — Laravel como framework principal, seguindo as melhores práticas do ecossistema.

---

## Contexto de Execução

Este documento foi produzido como **PRD + Blueprint Técnico** base para a equipa de produto, design e desenvolvimento do Grupo Caetano.

Destina-se a:
- Equipa de desenvolvimento (backend + frontend)
- Equipa de produto / design
- Responsável técnico / CTO
- Stakeholders do projeto

---

*Versão: 1.0 — Abril 2026*
*Plataforma: Caetano PrimeMail*
*Grupo: Salvador Caetano*
