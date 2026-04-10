# 11 — API e Organização do Código

## Caetano PrimeMail — Estrutura Laravel, Padrões e Boas Práticas

---

## 11.1 Estrutura de Pastas do Projeto

```
caetano-primemail/
├── app/
│   ├── Console/
│   │   └── Commands/           # Comandos Artisan personalizados
│   │       ├── PruneExpiredSessions.php
│   │       ├── ScheduleCampaigns.php
│   │       └── FlushEmailEvents.php
│   │
│   ├── Domain/                 # Lógica de negócio por domínio
│   │   ├── Auth/
│   │   │   ├── Actions/
│   │   │   │   ├── LoginAction.php
│   │   │   │   ├── LogoutAction.php
│   │   │   │   └── ResetPasswordAction.php
│   │   │   └── Services/
│   │   │       └── AuthService.php
│   │   │
│   │   ├── Brands/
│   │   │   ├── Actions/
│   │   │   │   ├── CreateBrandAction.php
│   │   │   │   └── SwitchBrandAction.php
│   │   │   ├── Services/
│   │   │   │   └── BrandService.php
│   │   │   └── DTOs/
│   │   │       └── BrandData.php
│   │   │
│   │   ├── Campaigns/
│   │   │   ├── Actions/
│   │   │   │   ├── CreateCampaignAction.php
│   │   │   │   ├── SendCampaignAction.php
│   │   │   │   ├── ScheduleCampaignAction.php
│   │   │   │   └── DuplicateCampaignAction.php
│   │   │   ├── Services/
│   │   │   │   ├── CampaignService.php
│   │   │   │   └── EmailSenderService.php
│   │   │   ├── DTOs/
│   │   │   │   └── CampaignData.php
│   │   │   └── ValueObjects/
│   │   │       └── CampaignStatus.php
│   │   │
│   │   ├── Contacts/
│   │   │   ├── Actions/
│   │   │   │   ├── ImportContactsAction.php
│   │   │   │   └── UnsubscribeContactAction.php
│   │   │   ├── Services/
│   │   │   │   ├── ImportService.php
│   │   │   │   ├── DeduplicationService.php
│   │   │   │   ├── SuppressionService.php
│   │   │   │   └── EmailValidatorService.php
│   │   │   └── DTOs/
│   │   │       └── ContactData.php
│   │   │
│   │   ├── Analytics/
│   │   │   └── Services/
│   │   │       └── MetricsService.php
│   │   │
│   │   └── Gdpr/
│   │       └── Services/
│   │           └── GdprErasureService.php
│   │
│   ├── Http/
│   │   ├── Controllers/
│   │   │   ├── Auth/
│   │   │   │   ├── LoginController.php
│   │   │   │   ├── LogoutController.php
│   │   │   │   ├── ForgotPasswordController.php
│   │   │   │   └── ResetPasswordController.php
│   │   │   ├── Brands/
│   │   │   │   ├── BrandController.php
│   │   │   │   └── BrandSwitchController.php
│   │   │   ├── Campaigns/
│   │   │   │   ├── CampaignController.php
│   │   │   │   ├── CampaignSendController.php
│   │   │   │   └── CampaignTestEmailController.php
│   │   │   ├── Contacts/
│   │   │   │   ├── ContactListController.php
│   │   │   │   ├── ContactController.php
│   │   │   │   └── ImportController.php
│   │   │   ├── Analytics/
│   │   │   │   └── ReportController.php
│   │   │   ├── Tracking/
│   │   │   │   └── TrackingController.php      # pixel + clique
│   │   │   ├── Webhooks/
│   │   │   │   └── MailgunWebhookController.php
│   │   │   └── Admin/
│   │   │       ├── UserController.php
│   │   │       └── SystemBrandController.php
│   │   │
│   │   ├── Middleware/
│   │   │   ├── EnsureActiveBrand.php
│   │   │   ├── BrandAccessMiddleware.php
│   │   │   ├── CheckBrandPermission.php
│   │   │   └── ValidateWebhookSignature.php
│   │   │
│   │   └── Requests/
│   │       ├── Auth/
│   │       │   ├── LoginRequest.php
│   │       │   └── ResetPasswordRequest.php
│   │       ├── Campaigns/
│   │       │   ├── CreateCampaignRequest.php
│   │       │   └── SendCampaignRequest.php
│   │       └── Contacts/
│   │           ├── ImportUploadRequest.php
│   │           └── StartImportRequest.php
│   │
│   ├── Jobs/
│   │   ├── Imports/
│   │   │   ├── ParseImportHeadersJob.php
│   │   │   ├── ProcessImportChunkJob.php
│   │   │   └── FinalizeImportJob.php
│   │   ├── Campaigns/
│   │   │   ├── SendCampaignJob.php
│   │   │   ├── SendCampaignBatchJob.php
│   │   │   └── CalculateCampaignStatsJob.php
│   │   ├── Email/
│   │   │   └── FlushEmailEventsJob.php
│   │   └── Maintenance/
│   │       ├── PruneOldDataJob.php
│   │       └── ArchiveOldEventsJob.php
│   │
│   ├── Models/
│   │   ├── User.php
│   │   ├── Brand.php
│   │   ├── UserBrandRole.php
│   │   ├── ContactList.php
│   │   ├── Contact.php
│   │   ├── ContactListMember.php
│   │   ├── ContactBrandRelation.php
│   │   ├── Campaign.php
│   │   ├── CampaignRecipient.php
│   │   ├── Template.php
│   │   ├── Import.php
│   │   ├── EmailEvent.php
│   │   ├── Unsubscribe.php
│   │   ├── SuppressionList.php
│   │   ├── AuditLog.php
│   │   └── LoginSession.php
│   │
│   ├── Policies/
│   │   ├── CampaignPolicy.php
│   │   ├── ContactListPolicy.php
│   │   ├── ImportPolicy.php
│   │   ├── BrandPolicy.php
│   │   └── UserPolicy.php
│   │
│   ├── Scopes/
│   │   └── BrandScope.php             # Global Scope para filtragem por marca
│   │
│   └── Providers/
│       ├── AppServiceProvider.php
│       └── AuthServiceProvider.php
│
├── database/
│   ├── migrations/                    # Uma migration por tabela
│   ├── seeders/
│   │   ├── DatabaseSeeder.php
│   │   ├── RolesSeeder.php
│   │   ├── PermissionsSeeder.php
│   │   └── BrandsSeeder.php           # marcas iniciais do grupo
│   └── factories/
│       ├── UserFactory.php
│       ├── BrandFactory.php
│       ├── ContactFactory.php
│       └── CampaignFactory.php
│
├── resources/
│   ├── js/
│   │   ├── app.ts
│   │   ├── Components/               # Componentes Vue reutilizáveis
│   │   │   ├── BrandSelector.vue
│   │   │   ├── DataTable.vue
│   │   │   ├── ImportProgressBar.vue
│   │   │   ├── CampaignStatusBadge.vue
│   │   │   └── MetricCard.vue
│   │   ├── Layouts/
│   │   │   ├── AppLayout.vue         # Layout principal com sidebar + topbar
│   │   │   └── AuthLayout.vue        # Layout para login/registo
│   │   ├── Pages/
│   │   │   ├── Auth/
│   │   │   │   ├── Login.vue
│   │   │   │   └── ForgotPassword.vue
│   │   │   ├── Dashboard/
│   │   │   │   └── Index.vue
│   │   │   ├── Campaigns/
│   │   │   │   ├── Index.vue
│   │   │   │   ├── Create.vue
│   │   │   │   ├── Edit.vue
│   │   │   │   └── Report.vue
│   │   │   ├── Contacts/
│   │   │   │   ├── Index.vue        # Listas
│   │   │   │   ├── Show.vue         # Detalhe da lista
│   │   │   │   └── Import.vue       # Wizard de importação
│   │   │   └── Admin/
│   │   │       ├── Users.vue
│   │   │       └── Brands.vue
│   │   ├── Stores/
│   │   │   ├── brand.ts             # Pinia store — marca ativa
│   │   │   └── auth.ts              # Pinia store — utilizador atual
│   │   └── Composables/
│   │       ├── useImportProgress.ts
│   │       └── useBrandContext.ts
│   └── views/
│       └── emails/                  # Templates Blade para emails transacionais
│           ├── auth/
│           │   ├── verification.blade.php
│           │   └── password-reset.blade.php
│           └── notifications/
│               └── import-complete.blade.php
│
├── routes/
│   ├── web.php                      # Rotas web (Inertia)
│   ├── webhooks.php                 # Rotas de webhook (sem CSRF)
│   └── console.php                  # Comandos agendados
│
├── tests/
│   ├── Feature/
│   │   ├── Auth/
│   │   │   ├── LoginTest.php
│   │   │   └── BruteForceProtectionTest.php
│   │   ├── Brands/
│   │   │   └── BrandSwitchTest.php
│   │   ├── Campaigns/
│   │   │   ├── CreateCampaignTest.php
│   │   │   └── SendCampaignTest.php
│   │   ├── Contacts/
│   │   │   ├── ImportTest.php
│   │   │   └── UnsubscribeTest.php
│   │   └── Security/
│   │       ├── BrandIsolationTest.php   # Testa que dados de marcas não se misturam
│   │       └── PermissionsTest.php
│   └── Unit/
│       ├── ImportProcessorTest.php
│       ├── EmailValidatorTest.php
│       ├── DeduplicationTest.php
│       └── HtmlSanitizerTest.php
│
├── config/
│   ├── primemail.php                # Configurações específicas da aplicação
│   └── horizon.php                  # Configuração das filas
│
├── docker/
│   ├── php/
│   │   └── Dockerfile
│   └── nginx/
│       └── default.conf
├── docker-compose.yml
└── .env.example
```

---

## 11.2 Padrões de Desenvolvimento

### Action Pattern (Single Responsibility)

```php
// Cada Action faz uma coisa e faz-a bem
// Controllers são finos — apenas orquestram Actions

class SendCampaignAction
{
    public function __construct(
        private readonly EmailSenderService $sender,
        private readonly SuppressionService $suppression,
    ) {}

    public function execute(Campaign $campaign): void
    {
        // 1. Valida que a campanha pode ser enviada
        if (!$campaign->canBeSent()) {
            throw new CampaignCannotBeSentException($campaign);
        }

        // 2. Marca como 'sending'
        $campaign->update(['status' => 'sending', 'sent_at' => now()]);

        // 3. Despacha jobs de envio em batches
        $this->dispatchSendingJobs($campaign);
    }

    private function dispatchSendingJobs(Campaign $campaign): void
    {
        // Lê destinatários em chunks e cria jobs
        CampaignRecipient::where('campaign_id', $campaign->id)
            ->where('status', 'pending')
            ->chunkById(500, function ($recipients) use ($campaign) {
                SendCampaignBatchJob::dispatch($campaign->id, $recipients->pluck('id'))
                    ->onQueue('default');
            });
    }
}
```

### Controllers Finos

```php
// Controllers apenas validam, autorizam e delegam para Actions
class CampaignSendController extends Controller
{
    public function __invoke(
        SendCampaignRequest $request,
        Campaign $campaign,
        SendCampaignAction $action
    ): Response {
        $this->authorize('send', $campaign);

        $action->execute($campaign);

        return redirect()
            ->route('campaigns.show', $campaign)
            ->with('success', 'Campanha em envio.');
    }
}
```

### DTOs (Data Transfer Objects)

```php
// PHP 8.x readonly classes para DTOs imutáveis
readonly class CampaignData
{
    public function __construct(
        public string  $name,
        public string  $subject,
        public string  $previewText,
        public string  $fromName,
        public string  $fromEmail,
        public string  $contentHtml,
        public int     $brandId,
        public array   $listIds,
        public ?Carbon $scheduledAt = null,
    ) {}

    public static function fromRequest(CreateCampaignRequest $request): self
    {
        return new self(
            name:        $request->validated('name'),
            subject:     $request->validated('subject'),
            previewText: $request->validated('preview_text', ''),
            fromName:    $request->validated('from_name'),
            fromEmail:   $request->validated('from_email'),
            contentHtml: $request->validated('content_html'),
            brandId:     session('active_brand_id'),
            listIds:     $request->validated('list_ids'),
            scheduledAt: $request->validated('scheduled_at')
                ? Carbon::parse($request->validated('scheduled_at'))
                : null,
        );
    }
}
```

---

## 11.3 Global Scope de Marca

```php
// app/Scopes/BrandScope.php
class BrandScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        // Só aplica se houver uma marca ativa na sessão
        if ($brandId = session('active_brand_id')) {
            $builder->where($model->getTable() . '.brand_id', $brandId);
        }
    }
}

// app/Models/Campaign.php
class Campaign extends Model
{
    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
    }
}

// Para queries cross-brand (admins):
Campaign::withoutGlobalScope(BrandScope::class)
    ->where('status', 'sent')
    ->get();
```

---

## 11.4 API REST (V2) — Estrutura

Para a V2, a API REST será adicionada sem alterar o backend web existente:

```php
// routes/api.php (V2)
Route::prefix('v1')->middleware(['auth:sanctum', 'brand.access'])->group(function () {
    Route::apiResource('campaigns', Api\CampaignController::class);
    Route::apiResource('contact-lists', Api\ContactListController::class);
    Route::apiResource('contacts', Api\ContactController::class);
    Route::get('brands', [Api\BrandController::class, 'index']);
    Route::post('imports', [Api\ImportController::class, 'store']);
    Route::get('imports/{import}/status', [Api\ImportController::class, 'status']);
});
```

**Convenções da API:**
- Resources no plural (`/campaigns`, `/contact-lists`)
- Versioning por prefixo (`/api/v1/`)
- Respostas em JSON com envelopes consistentes
- Erros com código, mensagem e detalhes
- Paginação com metadata (`current_page`, `last_page`, `per_page`, `total`)

---

## 11.5 Testes

### Tipos de Testes e Cobertura Mínima

| Tipo | O que testa | Cobertura mínima |
|------|-------------|-----------------|
| Unit | Actions, Services, DTOs, validações | 80% |
| Feature | Fluxos completos via HTTP | 70% dos fluxos críticos |
| Security | Isolamento de marcas, permissões | 100% das boundaries |

### Testes de Segurança Obrigatórios

```php
// tests/Feature/Security/BrandIsolationTest.php
class BrandIsolationTest extends TestCase
{
    public function test_user_cannot_access_other_brands_campaigns(): void
    {
        $bmwBrand      = Brand::factory()->create();
        $hyundaiBrand  = Brand::factory()->create();
        $bmwCampaign   = Campaign::factory()->for($bmwBrand)->create();
        $hyundaiUser   = User::factory()->withBrandRole($hyundaiBrand)->create();

        // Utilizador da Hyundai tenta aceder à campanha da BMW
        $this->actingAs($hyundaiUser)
             ->withSession(['active_brand_id' => $hyundaiBrand->id])
             ->get(route('campaigns.show', $bmwCampaign))
             ->assertForbidden(); // 403, não 404
    }

    public function test_brand_switch_validates_access(): void
    {
        $user      = User::factory()->create();
        $bmwBrand  = Brand::factory()->create();
        // user não tem acesso à BMW

        $this->actingAs($user)
             ->post(route('brands.switch', $bmwBrand))
             ->assertForbidden();
    }
}
```

```php
// tests/Feature/Auth/BruteForceProtectionTest.php
class BruteForceProtectionTest extends TestCase
{
    public function test_blocks_after_5_failed_login_attempts(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->post('/login', [
                'email'    => 'test@example.com',
                'password' => 'wrong-password',
            ]);
        }

        // 6ª tentativa deve ser bloqueada
        $this->post('/login', ['email' => 'test@example.com', 'password' => 'any'])
             ->assertStatus(429); // Too Many Requests
    }
}
```

---

## 11.6 Eventos e Listeners Laravel

```php
// Eventos de domínio para desacoplamento
class CampaignSent
{
    public function __construct(
        public readonly Campaign $campaign,
        public readonly int      $recipientCount,
    ) {}
}

// Listeners reagindo ao evento
class CampaignSentListener
{
    public function handle(CampaignSent $event): void
    {
        // Invalida cache do dashboard
        Cache::tags(["brand_{$event->campaign->brand_id}"])->flush();

        // Agenda job para calcular estatísticas após 1 hora
        CalculateCampaignStatsJob::dispatch($event->campaign->id)
            ->delay(now()->addHour());
    }
}
```

---

## 11.7 Manutenção e Prevenção de Dívida Técnica

### Regras da Equipa

1. **Conventions over configuration:** Seguir as convenções Laravel. Só afastar quando há razão clara.
2. **Controllers finos:** Lógica de negócio em Actions/Services, nunca em Controllers.
3. **Form Requests obrigatórios:** Nenhum controller usa `$request->input()` diretamente sem Form Request.
4. **Policies para autorização:** Nunca checar permissões inline no controller sem usar Policy.
5. **Global Scope de marca sempre ativo:** Nunca `withoutGlobalScope` sem comentário explicativo.
6. **Testes de segurança a cada novo endpoint:** Testar isolamento de marca e permissões.
7. **Migrations sem rollback destrutivo:** Sempre criar nova migration para alterar schema.
8. **Sem `dump`, `var_dump` ou `dd` no código produção:** Usar `Log::debug()`.
9. **Strings mágicas evitadas:** Usar Enums PHP 8.1+ para estados, papéis, etc.

```php
// Enum para estados de campanha
enum CampaignStatus: string
{
    case Draft      = 'draft';
    case Scheduled  = 'scheduled';
    case Sending    = 'sending';
    case Sent       = 'sent';
    case Paused     = 'paused';
    case Cancelled  = 'cancelled';
    case Failed     = 'failed';

    public function canBeSent(): bool
    {
        return in_array($this, [self::Draft, self::Scheduled]);
    }

    public function isFinal(): bool
    {
        return in_array($this, [self::Sent, self::Cancelled, self::Failed]);
    }
}
```

---

*Próximo: [12 — Roadmap por Fases](12-roadmap.md)*
