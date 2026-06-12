# 07 — Fluxo de Importação de Contactos

## Caetano eMKT — Pipeline Completo de Importação

---

## 7.1 Princípios do Fluxo de Importação

1. **Upload não bloqueia** — o utilizador recebe feedback imediato após upload
2. **Processamento assíncrono** — todo o parsing, validação e inserção acontece em background
3. **Feedback contínuo** — o utilizador vê o progresso da importação em tempo real
4. **Falhas parciais são tratadas** — erros em linhas específicas não abortam o import inteiro
5. **Rastreabilidade total** — cada importação tem um histórico detalhado

---

## 7.2 Fluxo Completo — Passo a Passo

```
Utilizador                    Frontend (Vue)              Backend (Laravel)           Workers / Jobs
    │                               │                            │                          │
    │  1. Seleciona marca ativa     │                            │                          │
    │──────────────────────────────►│                            │                          │
    │                               │  2. Verifica brand_id     │                          │
    │                               │   na sessão ativa         │                          │
    │                               │                            │                          │
    │  3. Abre modal de importação  │                            │                          │
    │──────────────────────────────►│                            │                          │
    │                               │                            │                          │
    │  4. Seleciona ficheiro CSV    │                            │                          │
    │──────────────────────────────►│                            │                          │
    │                               │  5. Validação client-side  │                          │
    │                               │   (extensão, tamanho)      │                          │
    │                               │                            │                          │
    │                               │  6. POST /imports/upload   │                          │
    │                               │──────────────────────────►│                          │
    │                               │                            │  7. Valida ficheiro       │
    │                               │                            │  8. Upload para S3        │
    │                               │                            │  9. Cria registo import   │
    │                               │                            │  10. Cria ParseHeadersJob │
    │                               │                            │                          │
    │                               │  11. Retorna import_id     │                          │
    │                               │◄──────────────────────────│                          │
    │                               │                            │                          │
    │  12. Mostra ecrã de mapeamento│                            │                          │
    │◄──────────────────────────────│                            │                          │
    │                               │                            │  13. ParseHeadersJob       │
    │                               │                            │      lê cabeçalhos do CSV │
    │                               │                            │◄─────────────────────────│
    │                               │                            │                          │
    │  14. Confirma mapeamento cols │                            │                          │
    │──────────────────────────────►│                            │                          │
    │                               │  15. POST /imports/{id}/   │                          │
    │                               │      start (com mapping)  │                          │
    │                               │──────────────────────────►│                          │
    │                               │                            │  16. Guarda mapeamento    │
    │                               │                            │  17. Cria ImportBatchJobs │
    │                               │                            │      (chunks de 500)      │
    │                               │  18. Retorna {status:      │                          │
    │                               │      processing}          │                          │
    │◄──────────────────────────────│◄──────────────────────────│                          │
    │                               │                            │                          │
    │  19. Página de progresso      │                            │  20. Worker processa      │
    │◄──────────────────────────────│                            │      chunk 1 (linhas 1-500)│
    │                               │  [polling cada 2s]         │◄─────────────────────────│
    │                               │  GET /imports/{id}/status │  21. Atualiza progress    │
    │                               │──────────────────────────►│      no Redis             │
    │                               │◄──────────────────────────│                          │
    │  20. Barra de progresso 10%   │                            │                          │
    │◄──────────────────────────────│                            │  22. Worker processa      │
    │                               │  [polling...]              │      chunk 2 (500-1000)  │
    │                               │                            │◄─────────────────────────│
    │  ...progresso 20%, 30%...     │                            │                          │
    │                               │                            │  [N chunks processados]   │
    │                               │                            │                          │
    │  23. Progresso 100%           │                            │  24. FinalizeImportJob    │
    │◄──────────────────────────────│◄──────────────────────────│◄─────────────────────────│
    │                               │                            │                          │
    │  25. Resumo final mostrado    │                            │                          │
    │◄──────────────────────────────│                            │                          │
```

---

## 7.3 Etapas Detalhadas

### Etapa 1 — Seleção da Marca Ativa

Antes de iniciar qualquer importação, o sistema **verifica** que:
- O utilizador tem uma marca ativa selecionada na sessão
- O utilizador tem permissão `contacts.import` na marca ativa
- A lista de destino pertence à marca ativa

```php
// Middleware de validação de contexto de marca
class EnsureActiveBrandMiddleware
{
    public function handle(Request $request, Closure $next)
    {
        if (!session('active_brand_id')) {
            return redirect()->route('brands.select')
                ->withError('Selecione uma marca antes de continuar.');
        }
        return $next($request);
    }
}
```

---

### Etapa 2 — Upload do Ficheiro (Validação Inicial)

**Client-side (antes do upload):**
- Extensão: `.csv` ou `.xlsx` apenas
- Tamanho máximo: 100MB (configurável)
- Feedback imediato se o ficheiro não passa

**Server-side (Laravel Form Request):**

```php
class ImportUploadRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'file'    => ['required', 'file', 'mimes:csv,xlsx', 'max:102400'], // 100MB
            'list_id' => ['required', 'integer', 'exists:contact_lists,id'],
        ];
    }

    public function authorize(): bool
    {
        $list = ContactList::findOrFail($this->list_id);
        return $list->brand_id === session('active_brand_id')
            && $this->user()->can('contacts.import', $list->brand);
    }
}
```

**Proteções de segurança no upload:**
- MIME type verification (não só extensão)
- Verificação de conteúdo do ficheiro (primeiro bytes — magic bytes)
- O ficheiro é guardado no S3 com nome gerado (UUID) — nunca com o nome original
- O nome original é guardado na tabela `imports` para referência

---

### Etapa 3 — Armazenamento Temporário no S3

```php
// Upload para S3 em pasta dedicada a imports
$path = Storage::disk('s3')->putFile(
    "imports/{$brandId}/" . date('Y/m'),
    $request->file('file'),
    ['visibility' => 'private']  // nunca público
);

// Cria registo no DB
$import = Import::create([
    'brand_id'   => session('active_brand_id'),
    'list_id'    => $request->list_id,
    'user_id'    => auth()->id(),
    'file_name'  => $request->file('file')->getClientOriginalName(),
    'file_path'  => $path,
    'file_size'  => $request->file('file')->getSize(),
    'file_type'  => $request->file('file')->getClientOriginalExtension(),
    'status'     => 'pending',
]);
```

---

### Etapa 4 — Criação do Job de Análise de Cabeçalhos

```php
// Job leve: lê apenas a primeira linha do CSV para extrair cabeçalhos
ParseImportHeadersJob::dispatch($import->id)->onQueue('imports');
```

```php
class ParseImportHeadersJob implements ShouldQueue
{
    public function handle(): void
    {
        $import = Import::findOrFail($this->importId);

        // Lê apenas a primeira linha do CSV (stream, sem carregar tudo)
        $headers = $this->csvReader->readHeaders(
            $import->file_path,
            $import->file_type
        );

        // Guarda cabeçalhos e conta total de linhas
        $import->update([
            'headers'    => $headers,
            'total_rows' => $this->csvReader->countRows($import->file_path),
            'status'     => 'awaiting_mapping',
        ]);
    }
}
```

---

### Etapa 5 — Interface de Mapeamento de Colunas

O frontend mostra:
- Colunas detectadas no CSV (ex: `Nome`, `Email`, `Telefone`, `Marca_Auto`)
- Campos disponíveis no sistema (ex: `first_name`, `email`, `phone`, campos custom)
- Pré-visualização das primeiras 5 linhas reais do CSV
- Match automático por nome similar (ex: "Email" → `email`, "Nome" → `first_name`)
- Possibilidade de marcar colunas como "Ignorar"
- Campo `email` é obrigatório — não é possível avançar sem mapeá-lo

```typescript
// Exemplo de estado do mapeamento no frontend
const mapping = {
    'Nome':       'first_name',
    'Email':      'email',       // obrigatório
    'Apelido':    'last_name',
    'Telefone':   'phone',
    'Marca_Auto': 'custom_vehicle_brand', // campo personalizado
    'Data_NV':    null,          // ignorar
}
```

---

### Etapa 6 — Início do Processamento (start)

```php
// POST /imports/{id}/start
class StartImportController extends Controller
{
    public function __invoke(StartImportRequest $request, Import $import): Response
    {
        $this->authorize('update', $import);

        $import->update([
            'column_mapping' => $request->mapping,
            'status'         => 'processing',
            'started_at'     => now(),
        ]);

        // Calcula quantos chunks são necessários
        $chunkSize  = 500;
        $totalRows  = $import->total_rows;
        $totalChunks = ceil($totalRows / $chunkSize);

        // Cria todos os chunk jobs de uma vez (Bus::batch para rastreamento)
        $jobs = collect(range(0, $totalChunks - 1))->map(
            fn($i) => new ProcessImportChunkJob($import->id, $i * $chunkSize, $chunkSize)
        );

        Bus::batch($jobs)
            ->name("Import #{$import->id}")
            ->then(fn(Batch $batch) => FinalizeImportJob::dispatch($import->id))
            ->catch(fn(Batch $batch, Throwable $e) => FailImportJob::dispatch($import->id, $e->getMessage()))
            ->onQueue('imports')
            ->dispatch();

        return response()->json(['status' => 'processing', 'import_id' => $import->id]);
    }
}
```

---

### Etapa 7 — Processamento Assíncrono por Chunks

```php
class ProcessImportChunkJob implements ShouldQueue
{
    public int $timeout = 300; // 5 min por chunk de 500 linhas
    public int $tries = 3;
    public int $backoff = 60; // espera 60s entre retries

    public function handle(CsvReader $reader, ImportProcessor $processor): void
    {
        $import = Import::findOrFail($this->importId);
        $rows   = $reader->readChunk($import->file_path, $this->offset, $this->limit);

        $stats = ['imported' => 0, 'updated' => 0, 'skipped' => 0, 'errors' => 0];
        $errorRows = [];

        foreach ($rows as $lineNumber => $rawRow) {
            try {
                // a) Aplica mapeamento de colunas
                $mapped = $processor->applyMapping($rawRow, $import->column_mapping);

                // b) Normalização (lowercase email, trim, etc.)
                $normalized = $processor->normalize($mapped);

                // c) Validação de email
                if (!$processor->isValidEmail($normalized['email'])) {
                    $stats['errors']++;
                    $errorRows[] = ['line' => $this->offset + $lineNumber, 'row' => $rawRow, 'error' => 'Email inválido'];
                    continue;
                }

                // d) Verificação de supressão
                if ($processor->isSuppressed($normalized['email'], $import->brand_id)) {
                    $stats['skipped']++;
                    continue;
                }

                // e) Upsert do contacto (deduplicação por email)
                $contact = $processor->upsertContact($normalized, $import->brand_id);

                // f) Associação à lista (deduplicação por contact+list)
                $result = $processor->upsertListMembership($contact->id, $import->list_id, $import->brand_id, $normalized, $import->id);

                $stats[$result]++; // 'imported' ou 'updated'

            } catch (Throwable $e) {
                $stats['errors']++;
                $errorRows[] = ['line' => $this->offset + $lineNumber, 'row' => $rawRow, 'error' => $e->getMessage()];
                Log::warning("Import chunk error", ['import_id' => $this->importId, 'error' => $e->getMessage()]);
            }
        }

        // g) Atualiza progresso de forma atómica no DB
        Import::where('id', $this->importId)->update([
            'processed_rows' => DB::raw("processed_rows + " . count($rows)),
            'imported_count' => DB::raw("imported_count + {$stats['imported']}"),
            'updated_count'  => DB::raw("updated_count + {$stats['updated']}"),
            'skipped_count'  => DB::raw("skipped_count + {$stats['skipped']}"),
            'error_count'    => DB::raw("error_count + {$stats['errors']}"),
        ]);

        // h) Guarda linhas com erros no Redis temporariamente
        if (!empty($errorRows)) {
            Redis::rpush("import_errors_{$this->importId}", json_encode($errorRows));
        }
    }
}
```

---

### Etapa 8 — Atualização de Progresso e Polling

```php
// GET /imports/{id}/status
class ImportStatusController extends Controller
{
    public function __invoke(Import $import): JsonResponse
    {
        $this->authorize('view', $import);

        $progress = $import->total_rows > 0
            ? round(($import->processed_rows / $import->total_rows) * 100)
            : 0;

        return response()->json([
            'id'             => $import->id,
            'status'         => $import->status,
            'progress'       => $progress,
            'total_rows'     => $import->total_rows,
            'processed_rows' => $import->processed_rows,
            'imported_count' => $import->imported_count,
            'updated_count'  => $import->updated_count,
            'skipped_count'  => $import->skipped_count,
            'error_count'    => $import->error_count,
        ]);
    }
}
```

**Frontend faz polling a cada 2 segundos:**

```typescript
// Vue composable para polling de progresso
const useImportProgress = (importId: number) => {
    const progress = ref(0)
    const status = ref('processing')

    const interval = setInterval(async () => {
        const res = await api.get(`/imports/${importId}/status`)
        progress.value = res.data.progress
        status.value = res.data.status

        if (['completed', 'failed'].includes(status.value)) {
            clearInterval(interval)
        }
    }, 2000)

    onUnmounted(() => clearInterval(interval))
    return { progress, status }
}
```

---

### Etapa 9 — Finalização da Importação

```php
class FinalizeImportJob implements ShouldQueue
{
    public function handle(): void
    {
        $import = Import::findOrFail($this->importId);

        // a) Gera ficheiro de erros se existirem erros
        if ($import->error_count > 0) {
            $errorData = $this->collectErrorsFromRedis($import->id);
            $errorFilePath = $this->uploadErrorFile($errorData, $import);
            $import->error_file_path = $errorFilePath;
        }

        // b) Atualiza contadores da lista
        ContactList::where('id', $import->list_id)->update([
            'total_contacts'  => DB::raw("(SELECT COUNT(*) FROM contact_list_members WHERE list_id = {$import->list_id})"),
            'active_contacts' => DB::raw("(SELECT COUNT(*) FROM contact_list_members WHERE list_id = {$import->list_id} AND status = 'active')"),
        ]);

        // c) Marca import como completo
        $import->update([
            'status'       => 'completed',
            'completed_at' => now(),
        ]);

        // d) Limpa dados de erro do Redis
        Redis::del("import_errors_{$import->id}");

        // e) Invalida cache de contactos da marca
        Cache::tags(["brand_{$import->brand_id}"])->flush();

        // f) Regista no audit log
        AuditLog::create([
            'user_id'     => $import->user_id,
            'brand_id'    => $import->brand_id,
            'action'      => 'import.completed',
            'entity_type' => 'Import',
            'entity_id'   => $import->id,
            'new_values'  => [
                'imported' => $import->imported_count,
                'updated'  => $import->updated_count,
                'errors'   => $import->error_count,
            ],
        ]);
    }
}
```

---

### Etapa 10 — Resumo Final

O utilizador vê:

```
✅ Importação Concluída

Ficheiro: base_clientes_bmw_2026.csv
Lista: BMW — Clientes Particulares

📊 Resumo:
  • Total de linhas:      10.247
  • Contactos importados: 9.891
  • Contactos atualizados: 312
  • Ignorados (supressão): 27
  • Erros:                17

⚠️ Existem 17 erros. [Descarregar ficheiro de erros]

Duração: 2 min 34 seg
Utilizador: Ana Silva
Data: 10 Abril 2026, 14:32
```

---

### Etapa 11 — Tratamento de Erros

| Tipo de Erro | Tratamento |
|--------------|-----------|
| Linha com email inválido | Registo no ficheiro de erros, continua |
| Linha com campos obrigatórios em falta | Registo no ficheiro de erros, continua |
| Ficheiro corrompido ou ilegível | Import marcado como `failed`, notifica utilizador |
| Timeout de chunk job (> 5 min) | Retry automático (máx. 3 vezes) |
| S3 indisponível | Retry com backoff, alerta para admin se persistir |
| Base de dados em timeout | Retry do chunk, alerta se persistir |
| Ficheiro malicioso (zip bomb, etc.) | Rejeitado na validação inicial, log de segurança |

---

### Etapa 12 — Histórico de Importações

```php
// GET /brands/{brand}/lists/{list}/imports
// Lista paginada de todas as importações da lista
$imports = Import::where('brand_id', $brandId)
    ->where('list_id', $listId)
    ->with('user:id,name')
    ->latest()
    ->paginate(20);
```

Cada entrada mostra:
- Data/hora de início e fim
- Utilizador que importou
- Ficheiro original (nome)
- Estado (completed/failed/processing)
- Contadores (importados, atualizados, erros)
- Link para descarregar ficheiro de erros (se existir)
- Link para descarregar ficheiro original (acesso temporário assinado do S3, 1 hora)

---

## 7.4 Segurança na Importação

```
NUNCA executar o conteúdo do CSV como código.
NUNCA confiar na extensão do ficheiro para determinar o tipo.
NUNCA guardar o ficheiro na raiz pública do servidor.
SEMPRE validar MIME type real do ficheiro.
SEMPRE guardar no S3 com visibilidade privada.
SEMPRE usar nome de ficheiro gerado (UUID), nunca o nome original.
SEMPRE limitar o tamanho máximo.
SEMPRE processar como dados puros (strings), com sanitização antes de inserir.
```

---

*Próximo: [08 — Autenticação e Login](08-authentication-flow.md)*
