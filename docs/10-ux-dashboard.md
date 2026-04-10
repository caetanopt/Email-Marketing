# 10 — UX / Dashboard / Backoffice

## Caetano PrimeMail — Estrutura da Interface e Experiência do Utilizador

---

## 10.1 Filosofia de UX

A interface do Caetano PrimeMail deve ser:

- **Focada** — cada página tem um objetivo claro, sem ruído visual
- **Contextual** — o utilizador sabe sempre em que marca está a trabalhar
- **Responsiva a ações pesadas** — progresso visível, nunca bloqueante
- **Familiar** — patterns conhecidos de ferramentas como Mailchimp, Notion, HubSpot
- **Rápida** — carregamentos < 300ms para ações normais, skeleton states para carregamentos

---

## 10.2 Layout Principal da Aplicação

```
┌─────────────────────────────────────────────────────────────────────┐
│  TOPBAR                                                              │
│  ┌──────────────┐                           ┌─────────────────────┐ │
│  │ 🏷 BMW       ▼│  ← Brand Selector        │ 👤 Ana Silva  ▼    │ │
│  │  (dropdown)  │                           │  (perfil / logout)  │ │
│  └──────────────┘                           └─────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│ SIDEBAR         │              CONTENT AREA                          │
│                 │                                                    │
│  ● Dashboard    │                                                    │
│                 │                                                    │
│  📧 Campanhas   │                                                    │
│    ├ Todas      │                                                    │
│    ├ Rascunhos  │                                                    │
│    └ Agendadas  │                                                    │
│                 │                                                    │
│  👥 Contactos   │                                                    │
│    ├ Listas     │                                                    │
│    ├ Segmentos  │                                                    │
│    └ Importações│                                                    │
│                 │                                                    │
│  📄 Templates   │                                                    │
│                 │                                                    │
│  📊 Relatórios  │                                                    │
│                 │                                                    │
│  ─────────────  │                                                    │
│  ⚙️  Definições  │                                                    │
│  (se permissão) │                                                    │
│                 │                                                    │
└─────────────────┴────────────────────────────────────────────────────┘
```

---

## 10.3 Brand Selector — Dropdown de Marca

O dropdown de marca é o elemento mais crítico da navegação. Deve ser:

### Comportamento

1. **Sempre visível** no topbar, mesmo que o utilizador tenha acesso a apenas uma marca
2. **Mostra logótipo + nome** da marca ativa
3. **Cor de destaque** da barra lateral e topbar muda para a cor primária da marca (ex: BMW = azul, Hyundai = azul-escuro, Dacia = amarelo)
4. **Lista apenas as marcas acessíveis** ao utilizador atual
5. **Pesquisa inline** no dropdown para utilizadores com muitas marcas
6. **Animação de transição** ao trocar — skeleton state durante carregamento dos novos dados

### Exemplo Visual do Dropdown

```
┌──────────────────────────────┐
│ 🔍 Pesquisar marca...        │
├──────────────────────────────┤
│ ✓ [B] BMW                   │  ← marca ativa (checkmark)
│   [H] Hyundai                │
│   [Y] BYD                   │
│   [A] Audi                   │
│   [Al] Alpine                │
│   [D] Dacia                  │
│   [C] Caetano                │
│   [CP] Caetano Parts         │
└──────────────────────────────┘
```

### Vue 3 + Pinia — Estado Global da Marca

```typescript
// stores/brand.ts
export const useBrandStore = defineStore('brand', {
    state: () => ({
        activeBrand: null as Brand | null,
        availableBrands: [] as Brand[],
    }),

    actions: {
        async switchBrand(brandId: number) {
            // Otimistic update — muda visual imediatamente
            const brand = this.availableBrands.find(b => b.id === brandId)
            this.activeBrand = brand

            // Persiste no servidor
            await router.post(`/brands/${brandId}/switch`)

            // Recarrega a página atual com novo contexto
            router.reload({ only: ['campaigns', 'contacts', 'stats'] })
        }
    }
})
```

---

## 10.4 Dashboard Principal (por marca)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Dashboard — BMW                                     [Últimos 30d ▼] │
├────────────────┬────────────────┬────────────────┬───────────────────┤
│  📬 Contactos  │  📧 Campanhas  │  📈 Taxa Aber. │  ⚠️ Bounces      │
│   142.387      │   Enviadas: 23 │   24,7%        │   1,2%           │
│   +3.241 novo  │   Agendadas: 2 │   ↑ +2.1%      │   ↓ -0.3%       │
├────────────────┴────────────────┴────────────────┴───────────────────┤
│                                                                      │
│  Campanhas Recentes                              [+ Nova Campanha]   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Nome             │ Estado  │ Enviada em │ Abertura │ Cliques  │  │
│  │ Newsletter Mar.  │ ✅ Sent  │ 05/03/26   │ 28.4%    │ 4.2%    │  │
│  │ Promoção Série 3 │ ✅ Sent  │ 02/03/26   │ 31.2%    │ 6.1%    │  │
│  │ Evento BMW Next  │ 📅 Sched │ 15/04/26   │ —        │ —       │  │
│  │ Recall Info      │ ✏️ Draft │ —          │ —        │ —       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  Tendência de Aberturas — últimos 30 dias                           │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ [gráfico de linha — taxa de abertura por campanha no tempo]   │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  Atividade Recente                                                   │
│  • Ana Silva importou 5.234 contactos — lista "Clientes Part." (2h) │
│  • Campanha "Newsletter Mar." enviada para 12.430 contactos (1d)    │
│  • João Costa criou rascunho "Promoção Abril" (3d)                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10.5 Gestão de Campanhas

### Lista de Campanhas

```
Campanhas — BMW                          [+ Nova Campanha]

Filtros: [Todos ▼] [Qualquer estado ▼] [Qualquer data ▼]  🔍 Pesquisar...

┌──────────────────────────────────────────────────────────────────────┐
│ □ │ Nome               │ Estado    │ Listas         │ Agendado  │ ⋮  │
├──────────────────────────────────────────────────────────────────────┤
│ □ │ Newsletter Março   │ ✅ Enviada │ Clientes Part. │ 05/03 14h │ ⋮  │
│   │                    │           │ 12.430 destin. │ enviada   │    │
├──────────────────────────────────────────────────────────────────────┤
│ □ │ Evento BMW Next     │ 📅 Agend. │ BMW Premium    │ 15/04 10h │ ⋮  │
│   │                    │           │ 3.240 destin.  │           │    │
├──────────────────────────────────────────────────────────────────────┤
│ □ │ Recall Info X1     │ ✏️ Rascun. │ Não definida  │ —         │ ⋮  │
└──────────────────────────────────────────────────────────────────────┘
```

### Editor de Campanha

O editor é um wizard multi-passo:

```
1. Conteúdo   →   2. Destinatários   →   3. Revisão   →   4. Envio
     ●                  ○                    ○                ○
```

**Passo 1 — Conteúdo:**
- Nome interno
- Assunto + preview text
- Remetente (From Name, From Email)
- Editor de email (HTML ou drag-and-drop na V2)
- Preview desktop / mobile em tempo real
- Botão "Enviar teste para..."

**Passo 2 — Destinatários:**
- Seleção de listas (checkboxes, com contagem de contactos ativos)
- Estimativa de destinatários únicos (deduplicados)
- Aviso se algum destinatário tem unsubscribe ativo

**Passo 3 — Revisão:**
- Resumo completo: assunto, remetente, listas, estimativa
- Checklist automático:
  - ✅ Link de unsubscribe presente no conteúdo
  - ✅ Assunto definido
  - ✅ Remetente válido
  - ⚠️ Sem imagens ALT text (aviso, não bloqueante)

**Passo 4 — Envio:**
- "Enviar agora" com confirmação modal
- "Agendar para..." com date/time picker
- "Guardar como rascunho"

---

## 10.6 Gestão de Listas e Importações

### Lista — Página de Detalhe

```
Lista: BMW — Clientes Particulares                   [+ Importar] [⚙️ Editar]

📊 142.387 contactos ativos  |  1.243 unsubscribed  |  89 bounced

Tabs: [Contactos] [Importações] [Segmentos] [Estatísticas]

─── Tab: Contactos ────────────────────────────────────────────────────
Pesquisar...  [Filtros ▼]                              [Exportar CSV]

┌──────────────────────────────────────────────────────────────────────┐
│ Nome              │ Email                │ Estado   │ Subscrito em   │
├──────────────────────────────────────────────────────────────────────┤
│ João Silva        │ joao.silva@gm...     │ ✅ Ativo  │ 10/01/2026    │
│ Maria Santos      │ maria.santos@...     │ ❌ Unsub  │ 05/03/2025    │
│ Carlos Ferreira   │ carlos.f@...         │ ✅ Ativo  │ 22/02/2026    │
└──────────────────────────────────────────────────────────────────────┘
[1] [2] [3] ... [next →]

─── Tab: Importações ──────────────────────────────────────────────────
[+ Nova Importação]

┌─────────────────────────────────────────────────────────────────────┐
│ Data       │ Utilizador │ Ficheiro       │ Estado  │ Resultado      │
├─────────────────────────────────────────────────────────────────────┤
│ 10/04/26   │ Ana Silva  │ clientes_q1... │ ✅ OK   │ +9.891 / 17 ⚠️ │
│ 15/03/26   │ João Costa │ base_part_...  │ ✅ OK   │ +12.430 / 0   │
│ 01/02/26   │ Ana Silva  │ clientes_jan.  │ ❌ Erro │ Ver detalhes   │
└─────────────────────────────────────────────────────────────────────┘
```

### Modal de Importação

```
Importar Contactos — BMW — Clientes Particulares

Passo 1/3: Ficheiro
┌─────────────────────────────────────────────────────┐
│         📄 Arraste o ficheiro aqui                  │
│         ou clique para selecionar                   │
│                                                     │
│         Formatos: CSV, XLSX  |  Máx. 100MB          │
└─────────────────────────────────────────────────────┘
[Cancelar]                              [Próximo →]

─── (após upload) ───────────────────────────────────
Passo 2/3: Mapeamento de colunas

Pré-visualização do ficheiro:
┌──────────────┬───────────────────┬──────────────┐
│ Nome         │ Email             │ Telefone     │
├──────────────┼───────────────────┼──────────────┤
│ João Silva   │ joao@...          │ +351 9...    │
│ Maria Santos │ maria@...         │ +351 9...    │
└──────────────┴───────────────────┴──────────────┘

Mapeamento:
  "Nome"      →  [Primeiro Nome      ▼]
  "Email"     →  [Email *            ▼]   ← obrigatório
  "Telefone"  →  [Telefone           ▼]
  "Ref"       →  [Ignorar coluna     ▼]

[← Anterior]                        [Iniciar Importação →]
```

---

## 10.7 Página de Progresso da Importação

```
Importação em curso — BMW — Clientes Particulares

📄 base_clientes_bmw_2026.csv  (45.2 MB)

████████████████████░░░░░░░░░░  65%

7.891 / 12.108 linhas processadas

✅ Importados: 7.543
🔄 Atualizados: 312
⏭  Ignorados: 27
❌ Erros: 9

Tempo estimado restante: ~1 min 20 seg

[Esta página pode ser fechada — a importação continua em background]
```

---

## 10.8 Relatórios — Página de Campanha

```
Campanha: Newsletter Março — BMW

Enviada em: 05/03/2026 às 14:00  |  Destinatários: 12.430

KPIs Principais:
┌────────────────┬────────────────┬────────────────┬────────────────┐
│  📬 Entregues  │  👁 Aberturas  │  🔗 Cliques    │  📴 Unsubscr. │
│   12.298       │   3.492        │   518          │   23          │
│   98.9%        │   28.4%        │   4.2%         │   0.19%       │
└────────────────┴────────────────┴────────────────┴────────────────┘

┌─────────────────────┬─────────────────────────────────────────────┐
│  Devoluções         │  Atividade ao longo do tempo                │
│  Hard: 87 (0.7%)    │  [gráfico de aberturas + cliques por hora]  │
│  Soft: 45 (0.36%)   │                                             │
└─────────────────────┴─────────────────────────────────────────────┘

Links mais clicados:
1. https://bmw.pt/serie-3  —  234 cliques (45.2%)
2. https://bmw.pt/test-drive  —  187 cliques (36.1%)
3. https://bmw.pt/configurador  —  97 cliques (18.7%)

[Exportar relatório CSV]
```

---

## 10.9 Área de Administração

### Para `group_admin` e `super_admin`

```
Administração                             [+ Novo Utilizador] [+ Nova Marca]

Tabs: [Utilizadores] [Marcas] [Audit Log] [Sistema]

─── Tab: Utilizadores ─────────────────────────────────────────────────
┌────────────────────────────────────────────────────────────────────┐
│ Nome         │ Email          │ Marcas        │ Último Login │ ⋮   │
├────────────────────────────────────────────────────────────────────┤
│ Ana Silva    │ ana@caetano... │ BMW, Audi, +3 │ 10/04/26     │ ⋮   │
│ João Costa   │ joao@caetano. │ Hyundai       │ 09/04/26     │ ⋮   │
│ Maria F.     │ maria@caet... │ BYD, Alpine   │ 08/04/26     │ ⋮   │
└────────────────────────────────────────────────────────────────────┘

─── Modal: Editar Utilizador ─────────────────────────────────────────
Nome: Ana Silva
Email: ana@caetano.pt
Estado: [Ativo ▼]

Acesso por Marca:
┌────────────────┬──────────────────────────────────────┐
│ BMW            │ [Marketing Manager ▼]  [Remover ×]  │
│ Audi           │ [Analyst ▼]            [Remover ×]  │
│ + Adicionar marca...                                  │
└────────────────┴──────────────────────────────────────┘
[Guardar Alterações]
```

---

## 10.10 Contexto Visual da Marca Selecionada

### Personalização por Marca

Quando BMW está ativa:
- Barra lateral e topbar com **borda/destaque azul BMW (#1C69D4)**
- Logótipo BMW visível no dropdown
- Título do browser: "Dashboard — BMW | Caetano PrimeMail"

Quando Hyundai está ativa:
- Barra lateral e topbar com **destaque azul-escuro Hyundai (#002C5F)**
- Logótipo Hyundai visível

### CSS Variables por Marca

```typescript
// Ao trocar de marca, atualiza as CSS variables globais
function applyBrandTheme(brand: Brand) {
    document.documentElement.style.setProperty('--brand-color', brand.primary_color)
    document.documentElement.style.setProperty('--brand-color-light', lighten(brand.primary_color, 0.8))
    document.title = `${currentPage} — ${brand.name} | Caetano PrimeMail`
}
```

```css
/* Tailwind com CSS custom property */
.sidebar-accent {
    border-left-color: var(--brand-color);
}
.brand-badge {
    background-color: var(--brand-color-light);
    color: var(--brand-color);
}
```

---

## 10.11 Estados de Loading e Feedback

### Skeleton States (carregamento)

```vue
<!-- Dashboard em carregamento -->
<template>
  <div v-if="loading">
    <div class="animate-pulse">
      <div class="h-24 bg-gray-200 rounded mb-4"></div>
      <div class="h-64 bg-gray-200 rounded mb-4"></div>
    </div>
  </div>
  <div v-else>
    <!-- conteúdo real -->
  </div>
</template>
```

### Notificações Toast

```
✅ Campanha guardada com sucesso.
✅ Importação iniciada. Pode fechar esta janela.
❌ Erro ao enviar: lista sem contactos ativos.
⚠️ A campanha não tem link de unsubscribe. Adicione antes de enviar.
```

### Confirmações Destrutivas

```
Modal: Enviar Campanha

Tem a certeza que quer enviar esta campanha?

"Newsletter Abril — BMW"
Para: 14.230 contactos (Clientes Part. + BMW Premium)
Imediatamente após confirmação.

Esta ação não pode ser desfeita.

[Cancelar]                        [Confirmar Envio]
```

---

*Próximo: [11 — API e Organização do Código](11-api-code-organization.md)*
