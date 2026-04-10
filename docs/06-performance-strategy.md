# 06 — Estratégia de Performance para Grandes Volumes

## Caetano PrimeMail — Como Manter a Plataforma Rápida

---

## 6.1 Princípio Central

> **"Operações pesadas nunca bloqueiam a interface. O utilizador recebe feedback imediato. O trabalho pesado acontece em background."**

A performance não se garante só com boa infraestrutura — é uma decisão de arquitetura que tem de estar presente desde o primeiro dia de código.

---

## 6.2 Importação em Chunks / Lotes

### Problema
Importar um ficheiro CSV com 500.000 linhas de uma só vez consome memória excessiva, bloqueia workers por horas e pode falhar a meio.

### Solução: Chunked Processing

```php
// Job de importação processa em chunks de 500 linhas por iteração
class ProcessImportChunkJob implements ShouldQueue
{
    public int $timeout = 300; // 5 min por chunk
    public int $tries = 3;

    public function handle(): void
    {
        // Lê apenas N linhas do CSV a partir de um offset
        $rows = $this->csvReader->readChunk(
            offset: $this->offset,
            limit:  500
        );

        foreach ($rows as $row) {
            $this->processRow($row);
        }

        // Se há mais linhas, despacha próximo chunk como novo job
        if ($this->hasMoreRows()) {
            ProcessImportChunkJob::dispatch(
                importId: $this->importId,
                offset:   $this->offset + 500
            )->onQueue('imports');
        }
    }
}
```

**Benefícios:**
- Uso de memória controlado (nunca carrega o ficheiro inteiro)
- Cada chunk é independente — falhas parciais não perdem o progresso inteiro
- Workers libertados rapidamente para outros jobs
- Progresso rastreável a nível de chunk

---

## 6.3 Processamento Assíncrono com Filas

### Regra: Nenhuma operação > 200ms na thread do request

| Operação | Síncrono? | Abordagem |
|----------|-----------|-----------|
| Upload de ficheiro CSV | Sim (só o upload) | Upload direto para S3, job criado no fim |
| Processar importação | Não | Job assíncrono em fila `imports` |
| Enviar campanha | Não | Jobs em fila `default` ou `high` |
| Calcular métricas de campanha | Não | Job agendado após envio |
| Gerar relatório CSV | Não | Job em fila `reports`, notifica quando pronto |
| Verificar listas de supressão | Não (grande volume) | Parte do job de importação |
| Deduplicação de contactos | Não | Parte do job de importação |
| Processar bounces/webhooks | Não | Job rápido em fila `high` |

---

## 6.4 Filas e Workers — Configuração Detalhada

### Filas por Prioridade

```php
// config/horizon.php
'environments' => [
    'production' => [
        'supervisor-critical' => [
            'connection' => 'redis',
            'queue'      => ['critical', 'high'],
            'processes'  => 2,
            'tries'      => 3,
            'timeout'    => 60,
        ],
        'supervisor-campaigns' => [
            'connection' => 'redis',
            'queue'      => ['default'],
            'processes'  => 4,   // escala horizontal
            'tries'      => 3,
            'timeout'    => 120,
        ],
        'supervisor-imports' => [
            'connection' => 'redis',
            'queue'      => ['imports'],
            'processes'  => 2,   // separado para não bloquear envios
            'tries'      => 1,   // falhas de import não fazem retry automático
            'timeout'    => 3600, // 1 hora por chunk de import
        ],
        'supervisor-maintenance' => [
            'connection' => 'redis',
            'queue'      => ['reports', 'cleanup'],
            'processes'  => 1,
            'tries'      => 3,
            'timeout'    => 600,
        ],
    ],
],
```

### Envio de Campanhas em Batch

```php
// Envia em lotes de 500 destinatários por job
class SendCampaignBatchJob implements ShouldQueue
{
    public function handle(): void
    {
        $recipients = CampaignRecipient::where('campaign_id', $this->campaignId)
            ->where('status', 'pending')
            ->limit(500)
            ->get();

        foreach ($recipients as $recipient) {
            // Envia via provider (SES/Mailgun) com rate limiting
            $this->emailSender->send($recipient);
        }
    }
}
```

---

## 6.5 Paginação Correta

### Problema com OFFSET em tabelas grandes

```sql
-- LENTO com 500.000 contactos:
SELECT * FROM contacts WHERE brand_id = 1 LIMIT 20 OFFSET 499980;
-- MySQL lê e descarta 499.980 linhas antes de retornar 20
```

### Solução: Cursor-based Pagination

```php
// Laravel cursor pagination — O(1) independente da página
$contacts = Contact::whereHas('listMemberships', fn($q) => $q->where('list_id', $listId))
    ->orderBy('id')
    ->cursorPaginate(50);
```

```sql
-- Rápido: usa o cursor (ID) como ponto de partida
SELECT * FROM contacts WHERE id > :last_id AND ... LIMIT 50;
-- Usa o índice de PRIMARY KEY — O(log n)
```

**Quando usar offset?** Apenas para tabelas pequenas (< 10.000 registos) onde a simplicidade supera o impacto de performance.

---

## 6.6 Índices — Estratégia Completa

### Regra dos Índices Compostos com `brand_id`

Todo o índice em tabelas com `brand_id` deve começar com `brand_id`:

```sql
-- Correto: brand_id como prefixo do índice composto
INDEX idx_campaigns_brand_status (brand_id, status)
INDEX idx_campaigns_brand_scheduled (brand_id, status, scheduled_at)
INDEX idx_clm_brand_status (brand_id, status)

-- Errado: índice sem brand_id vai fazer full scan filtrado depois
INDEX idx_campaigns_status (status)  -- evitar
```

### Por quê brand_id primeiro?

O MySQL utiliza o índice da esquerda para a direita. Como `brand_id` aparece em **todas** as queries (via Global Scope), colocá-lo como prefixo significa que o índice elimina imediatamente 90%+ das linhas antes de aplicar outros filtros.

### Índices Recomendados por Tabela

```sql
-- contacts
INDEX idx_contacts_email (email)
INDEX idx_contacts_hash (email_hash)

-- contact_list_members (tabela de maior volume)
INDEX idx_clm_brand_status (brand_id, status)
INDEX idx_clm_list_status (list_id, status)
INDEX idx_clm_contact (contact_id)

-- campaigns
INDEX idx_camp_brand_status (brand_id, status)
INDEX idx_camp_brand_scheduled (brand_id, status, scheduled_at)

-- email_events (tabela de maior crescimento)
INDEX idx_ee_brand_campaign (brand_id, campaign_id)
INDEX idx_ee_brand_type_date (brand_id, event_type, occurred_at)

-- campaign_recipients
INDEX idx_cr_campaign_status (campaign_id, status)
INDEX idx_cr_contact (contact_id)
```

---

## 6.7 Queries Otimizadas

### Evitar N+1 com Eager Loading

```php
// Errado — N+1 queries
$campaigns = Campaign::all();
foreach ($campaigns as $campaign) {
    echo $campaign->brand->name; // 1 query por campanha
}

// Correto — 2 queries total
$campaigns = Campaign::with('brand')->get();
```

### Usar `select()` Explícito

```php
// Evitar carregar colunas pesadas (content_html) em listagens
$campaigns = Campaign::select('id', 'name', 'subject', 'status', 'sent_at')
    ->where('brand_id', $brandId)
    ->latest()
    ->paginate(20);
```

### Contagens Eficientes

```php
// Errado — carrega todos os registos para contar
$count = ContactListMember::where('list_id', $listId)->get()->count();

// Correto — COUNT(*) na base de dados
$count = ContactListMember::where('list_id', $listId)->count();

// Melhor ainda — usar cached counter column
$count = ContactList::find($listId)->total_contacts; // coluna mantida por incremento
```

### Atualizar Contadores Eficientemente

```php
// Usar incremento atómico (não SELECT + UPDATE)
ContactList::where('id', $listId)->increment('total_contacts', $newCount);
ContactList::where('id', $listId)->decrement('active_contacts', $removedCount);
```

---

## 6.8 Cache — Quando e Como Usar

### O que fazer cache

| Dado | TTL | Estratégia |
|------|-----|-----------|
| Métricas do dashboard por marca | 5 min | Redis + invalidação no envio |
| Contagem de contactos por lista | 1 hora | Counter atómico + Redis |
| Permissões do utilizador por marca | 15 min | Redis por user_id+brand_id |
| Lista de marcas acessíveis ao utilizador | 30 min | Redis por user_id |
| Estimativa de segmento | 30 min | Redis por segment_id |

### Implementação com Laravel Cache

```php
// Cache de métricas do dashboard
$metrics = Cache::remember(
    "dashboard_metrics.brand_{$brandId}",
    now()->addMinutes(5),
    fn() => $this->metricsService->getDashboardMetrics($brandId)
);

// Invalidar após envio de campanha
Cache::forget("dashboard_metrics.brand_{$brandId}");
```

### Tags de Cache para Invalidação em Grupo

```php
// Cache com tags (Redis required)
Cache::tags(["brand_{$brandId}", 'metrics'])->remember(
    "campaign_stats.{$campaignId}",
    now()->addMinutes(10),
    fn() => $this->getStats($campaignId)
);

// Invalidar tudo da marca
Cache::tags(["brand_{$brandId}"])->flush();
```

---

## 6.9 Tracking de Aberturas e Cliques — Alta Frequência

### Problema
O tracking de aberturas (pixel) e cliques (redirect) pode gerar **milhares de requests por segundo** durante um envio grande. Gravar cada evento diretamente na base de dados cria contenção.

### Solução: Buffer Redis → Flush Assíncrono

```php
// TrackingController — endpoint ultra-leve
public function trackOpen(string $token): Response
{
    // 1. Decodifica o token (sem query DB)
    $data = $this->tokenDecoder->decode($token);

    // 2. Empurra para Redis list (sub-millisecond)
    Redis::lpush('email_events_queue', json_encode([
        'type'        => 'open',
        'campaign_id' => $data->campaignId,
        'contact_id'  => $data->contactId,
        'brand_id'    => $data->brandId,
        'ip'          => request()->ip(),
        'ua'          => request()->userAgent(),
        'ts'          => now()->timestamp,
    ]));

    // 3. Retorna pixel 1x1 imediatamente
    return response($this->transparentPixel(), 200, [
        'Content-Type' => 'image/gif',
        'Cache-Control' => 'no-store',
    ]);
}
```

```php
// Job agendado a cada minuto: flush do buffer Redis para MySQL
class FlushEmailEventsJob implements ShouldQueue
{
    public function handle(): void
    {
        $batch = [];
        $maxBatch = 1000;

        while (count($batch) < $maxBatch) {
            $item = Redis::rpop('email_events_queue');
            if (!$item) break;
            $batch[] = json_decode($item, true);
        }

        if (!empty($batch)) {
            EmailEvent::insert($batch); // INSERT em bulk
        }
    }
}
```

**Benefício:** O endpoint de tracking responde em < 5ms. A gravação na DB acontece em batch sem bloquear requests de utilizadores.

---

## 6.10 Deduplicação Eficiente

### Abordagem: `INSERT ... ON DUPLICATE KEY UPDATE`

```php
// Ao importar, usar INSERT com tratamento de duplicados a nível de MySQL
DB::statement("
    INSERT INTO contact_list_members (contact_id, list_id, brand_id, status, custom_fields, import_id, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
        custom_fields = IF(VALUES(custom_fields) IS NOT NULL, VALUES(custom_fields), custom_fields),
        updated_at = NOW(),
        import_id = VALUES(import_id)
", [$contactId, $listId, $brandId, $customFields, $importId]);
```

**Por que é eficiente?**
- Uma única operação de DB (sem SELECT + INSERT separados)
- O índice `UNIQUE KEY unique_contact_list (contact_id, list_id)` trata a deduplicação
- Escala bem em inserções em bulk

### Batch Insert para Novos Contactos

```php
// Inserção em lote com deduplicação por email
$rows = collect($chunk)->map(fn($row) => [
    'email'      => strtolower(trim($row['email'])),
    'email_hash' => hash('sha256', strtolower(trim($row['email']))),
    'first_name' => $row['first_name'] ?? null,
    'created_at' => now(),
    'updated_at' => now(),
])->toArray();

DB::table('contacts')->insertOrIgnore($rows); // ignora duplicados de email
```

---

## 6.11 Separação de Tabelas Operacionais vs. Históricas

### Tabelas Operacionais (acesso frequente, devem ser compactas)
- `contacts` — dados atuais dos contactos
- `contact_list_members` — estado atual da subscrição
- `campaigns` — campanhas recentes
- `imports` — importações em progresso e recentes

### Tabelas Históricas (crescem sem parar, devem ser particionadas)
- `email_events` — particionada por mês/trimestre
- `audit_logs` — particionada por trimestre
- `campaign_recipients` — particionada por `campaign_id`

### Archiving Strategy

Para campanhas com mais de 1 ano, considerar:
1. Mover `campaign_recipients` e `email_events` antigas para uma tabela de arquivo (`email_events_archive`)
2. A tabela de arquivo pode estar num servidor de analytics separado (ex: ClickHouse em V3)
3. As métricas agregadas ficam em `campaign_stats` (tabela de sumário) para acesso rápido sem precisar dos eventos raw

---

## 6.12 Prevenção de Degradação Após Muitos Uploads

### Problema
Após centenas de importações, a tabela `contacts` pode ter milhões de linhas. Queries de deduplicação começam a ficar lentas.

### Estratégias de Mitigação

**1. Índice de hash para lookup de email:**
```sql
-- Lookup por email_hash (CHAR(64)) é O(1) para verificar existência
SELECT id FROM contacts WHERE email_hash = SHA2('test@example.com', 256) LIMIT 1;
```

**2. Partition pruning em `contact_list_members`:**
```sql
-- Usar brand_id no índice garante que queries por marca não lêem outras marcas
SELECT COUNT(*) FROM contact_list_members WHERE brand_id = 5 AND status = 'active';
-- Usa idx_clm_brand_status → lê apenas as linhas da marca 5
```

**3. ANALYZE TABLE periódico:**
```bash
# Agendado mensalmente para atualizar estatísticas do otimizador
php artisan schedule:run → AnalyzeTablesJob → ANALYZE TABLE contacts, contact_list_members, ...
```

**4. Vacuum / Optimize periódico:**
```sql
-- Após muitos DELETEs/UPDATEs, recuperar espaço e desfragmentar
OPTIMIZE TABLE contact_list_members;  -- agendado em janela de manutenção
```

---

## 6.13 Impacto do Filtro por Marca nas Queries

### Garantia: Nenhuma query varre dados de outras marcas

```php
// Global Scope aplica automaticamente em todos os models com brand_id
// Cada query tem implicitamente: WHERE brand_id = :active_brand_id

// Exemplo de query gerada automaticamente:
// SELECT * FROM campaigns WHERE brand_id = 3 AND status = 'sent' ORDER BY sent_at DESC LIMIT 20;
// Usa: INDEX idx_camp_brand_status (brand_id, status) → leitura eficiente
```

### Dashboard por Marca — Queries Rápidas

```php
// Métricas do dashboard: queries simples com índice composto
$stats = [
    'total_contacts' => Cache::remember("brand_{$brandId}_contacts", 300, fn() =>
        ContactListMember::where('brand_id', $brandId)->where('status', 'active')->count()
    ),
    'campaigns_sent' => Cache::remember("brand_{$brandId}_campaigns", 300, fn() =>
        Campaign::where('brand_id', $brandId)->where('status', 'sent')->count()
    ),
    'avg_open_rate' => Cache::remember("brand_{$brandId}_open_rate", 300, fn() =>
        $this->calculateAvgOpenRate($brandId)
    ),
];
```

---

## 6.14 Tratamento de Picos de Carga

### Cenário: 10 utilizadores fazem upload simultâneo de 100k contactos cada

**Sem proteção:** 10 jobs de import em paralelo → 10x consumo de memória/CPU → servidor corre risco de ficar sem recursos

**Com proteção:**

```php
// Rate limiting de importações por utilizador
// config: máximo 2 imports em simultâneo por utilizador
if ($this->importService->activeImportsCount($userId) >= 2) {
    return back()->withError('Tem 2 importações em curso. Aguarde que terminem.');
}

// Throttle de jobs de import no Horizon
'supervisor-imports' => [
    'processes' => 2,  // máximo 2 chunks de import a correr em simultâneo no servidor
]
```

```php
// Mutex/Lock no início de cada job de chunk para evitar race conditions
$lock = Cache::lock("import_{$this->importId}_chunk_{$this->offset}", 3600);
if (!$lock->get()) {
    // Outro worker já está a processar este chunk
    return;
}
```

---

*Próximo: [07 — Fluxo de Importação](07-import-flow.md)*
