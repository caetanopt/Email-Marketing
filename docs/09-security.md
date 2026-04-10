# 09 — Segurança e Proteção de Dados

## Caetano PrimeMail — Security by Design e RGPD

---

## 9.1 Princípios Fundamentais

> **"Security by Design: a segurança não é uma funcionalidade a adicionar depois — é uma restrição de design desde o início."**

> **"Privacy by Default: por omissão, a plataforma recolhe o mínimo de dados necessários e protege-os ao máximo."**

---

## 9.2 Autenticação e Autorização

### Autenticação
- Login obrigatório para todas as rotas da aplicação
- Argon2id para hash de passwords (ver [08 — Autenticação](08-authentication-flow.md))
- Rate limiting e bloqueio após falhas repetidas
- Sessões encriptadas em Redis com HttpOnly + Secure cookies
- Regeneração de session ID após login (anti-session fixation)
- Invalidação de todas as sessões após reset de password

### Autorização por Papéis

```php
// Policy-based authorization em Laravel
class CampaignPolicy
{
    public function create(User $user, Brand $brand): bool
    {
        return $user->hasPermissionForBrand('campaigns.create', $brand->id);
    }

    public function send(User $user, Campaign $campaign): bool
    {
        return $user->hasPermissionForBrand('campaigns.send', $campaign->brand_id)
            && $campaign->brand_id === session('active_brand_id'); // só na marca ativa
    }

    public function delete(User $user, Campaign $campaign): bool
    {
        return $user->hasPermissionForBrand('campaigns.delete', $campaign->brand_id)
            && in_array($campaign->status, ['draft', 'scheduled']); // só rascunhos
    }
}
```

### Autorização por Marca

```php
// Middleware que valida acesso à marca em TODOS os pedidos
class BrandAccessMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $brandId = session('active_brand_id');

        if (!$brandId) {
            return redirect()->route('brands.select');
        }

        // Verifica que o utilizador tem acesso ativo à marca
        $hasAccess = Cache::remember(
            "user_brand_access.{$request->user()->id}.{$brandId}",
            now()->addMinutes(15),
            fn() => UserBrandRole::where('user_id', $request->user()->id)
                ->where('brand_id', $brandId)
                ->whereNull('revoked_at')
                ->exists()
        );

        if (!$hasAccess) {
            abort(403, 'Acesso não autorizado a esta marca.');
        }

        return $next($request);
    }
}
```

---

## 9.3 Proteção de Endpoints

### Todas as rotas são protegidas por defeito

```php
// routes/web.php — estrutura de proteção em camadas
Route::middleware(['auth', 'verified', 'active_brand'])->group(function () {

    // Rotas de marketing (manager + coordinator)
    Route::middleware('permission:campaigns.view')->group(function () {
        Route::resource('campaigns', CampaignController::class);
    });

    // Rotas de administração de marca (brand_admin+)
    Route::middleware('permission:brand.manage')->prefix('admin')->group(function () {
        Route::resource('users', BrandUserController::class);
        Route::resource('brands', BrandSettingsController::class);
    });

    // Rotas de sistema (super_admin only)
    Route::middleware('role:super_admin')->prefix('system')->group(function () {
        Route::get('audit-logs', [AuditLogController::class, 'index']);
        Route::resource('brands', SystemBrandController::class);
    });
});
```

### Proteção de APIs de Tracking (sem autenticação, mas com validação)

```php
// Endpoints de tracking (pixel, redirect de clique) não requerem auth
// Mas são protegidos por token assinado + validação
Route::get('/track/open/{token}', [TrackingController::class, 'open'])
    ->middleware(['throttle:1000,1']); // máx 1000 req/min por IP

Route::get('/track/click/{token}', [TrackingController::class, 'click'])
    ->middleware(['throttle:500,1']);

// Token é assinado com HMAC e contém campaign_id + contact_id
// Expiração de 30 dias (período razoável para tracking)
```

---

## 9.4 Validação de Input e Sanitização

### Regra: Nunca confiar em input do utilizador

```php
// Form Requests para toda a validação
class CreateCampaignRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'name'         => ['required', 'string', 'max:255'],
            'subject'      => ['required', 'string', 'max:998'],
            'from_name'    => ['required', 'string', 'max:255'],
            'from_email'   => ['required', 'email:rfc,dns'],
            'content_html' => ['required', 'string'],
            'list_ids'     => ['required', 'array', 'min:1'],
            'list_ids.*'   => ['integer', 'exists:contact_lists,id'],
            'scheduled_at' => ['nullable', 'date', 'after:now'],
        ];
    }

    public function authorize(): bool
    {
        // Valida que todas as listas selecionadas pertencem à marca ativa
        $brandId = session('active_brand_id');
        foreach ($this->list_ids as $listId) {
            $list = ContactList::find($listId);
            if (!$list || $list->brand_id !== $brandId) {
                return false;
            }
        }
        return $this->user()->can('campaigns.create', Brand::find($brandId));
    }
}
```

### Sanitização de HTML em Campanhas

```php
// O conteúdo HTML de campanhas deve ser sanitizado para remover scripts
// mas preservar HTML legítimo de email
use HTMLPurifier;

class HtmlSanitizer
{
    public function sanitizeCampaignHtml(string $html): string
    {
        $config = HTMLPurifier_Config::createDefault();
        $config->set('HTML.Allowed', 'a[href|title],b,strong,i,em,u,p,br,h1,h2,h3,h4,ul,ol,li,img[src|alt|width|height],table,tr,td,th,thead,tbody,div[style],span[style],style');
        $config->set('CSS.AllowedProperties', 'color,background-color,font-size,font-family,text-align,padding,margin,border,width,height');
        $config->set('HTML.TargetBlank', true);
        $config->set('URI.AllowedSchemes', ['http' => true, 'https' => true, 'mailto' => true]);

        $purifier = new HTMLPurifier($config);
        return $purifier->purify($html);
    }
}
```

---

## 9.5 Proteção Contra SQL Injection

**Laravel Eloquent e Query Builder usam PDO com prepared statements por defeito.**

```php
// Seguro — usa prepared statement automaticamente
Campaign::where('brand_id', $brandId)->where('status', $status)->get();

// Seguro — binding explícito
DB::select('SELECT * FROM campaigns WHERE brand_id = ? AND status = ?', [$brandId, $status]);

// NUNCA fazer:
DB::select("SELECT * FROM campaigns WHERE brand_id = {$brandId}"); // PERIGOSO

// Se usar raw expressions, sempre com bindings:
DB::table('contacts')
    ->whereRaw('email_hash = SHA2(?, 256)', [strtolower($email)])
    ->first();
```

**Regra:** Nunca interpolar variáveis diretamente em queries SQL. Sempre usar bindings ou Eloquent.

---

## 9.6 Proteção Contra XSS

```php
// Laravel Blade escapa automaticamente com {{ }}
{{ $campaign->name }}  // Seguro — escapa HTML

// {!! !!} só para conteúdo HTML trustworthy/sanitizado
{!! $campaign->content_html_sanitized !!}  // Apenas após sanitização

// Inertia.js passa dados como JSON — Vue.js escapa por defeito no template
// Nunca usar v-html sem sanitização prévia
```

```typescript
// Vue 3 — seguro por defeito
<template>
  <span>{{ campaign.name }}</span>  <!-- escapado automaticamente -->
</template>

// v-html só com sanitização:
<div v-html="sanitizedContent"></div>  <!-- DOMPurify no cliente -->
```

---

## 9.7 Proteção Contra CSRF

```php
// Habilitado por defeito em todas as rotas web POST/PUT/PATCH/DELETE
// Middleware VerifyCsrfToken ativo no grupo 'web'

// Exceções explícitas (ex: webhooks de providers externos)
class VerifyCsrfToken extends Middleware
{
    protected $except = [
        'webhooks/*',  // protegidos por assinatura HMAC própria
    ];
}
```

---

## 9.8 Encriptação de Dados Sensíveis

### Dados encriptados na base de dados

```php
// Campos com dados sensíveis usam encriptação a nível de aplicação
// Usando Laravel Encrypted Cast

class Brand extends Model
{
    protected $casts = [
        'smtp_config' => 'encrypted:json',  // credenciais SMTP encriptadas
    ];
}

class User extends Model
{
    // API keys encriptadas
    protected $casts = [
        'api_token_hash' => 'hashed',
    ];
}
```

**Chave de encriptação:**
- `APP_KEY` do Laravel (AES-256-CBC)
- Rotação anual da chave com re-encriptação programada
- Nunca comitada no repositório — apenas em variáveis de ambiente seguras

### Dados em trânsito
- TLS 1.2+ obrigatório para todas as conexões
- HSTS (HTTP Strict Transport Security) ativo
- Certificados renovados automaticamente (Let's Encrypt ou AWS ACM)

---

## 9.9 Gestão Segura de Ficheiros Importados

```php
// Validação de upload (ver 07-import-flow.md para detalhes)
$request->validate([
    'file' => [
        'required',
        'file',
        'mimes:csv,xlsx',          // validação de MIME type
        'max:102400',              // 100MB máximo
        new NoMaliciousContent(),  // rule custom que verifica magic bytes
    ],
]);

// Custom Rule para verificar conteúdo
class NoMaliciousContent implements Rule
{
    public function passes($attribute, $file): bool
    {
        // Verifica magic bytes reais do ficheiro
        $realMimeType = mime_content_type($file->getRealPath());
        $allowedMimes = ['text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

        return in_array($realMimeType, $allowedMimes);
    }
}
```

**Regras absolutas de segurança para ficheiros:**
- Nunca servir ficheiros de import com URL pública
- Acesso via URL assinada temporária do S3 (1 hora de validade)
- Ficheiros processados eliminados após 30 dias
- Nomes de ficheiro gerados internamente (UUID), não o nome original do utilizador
- Isolamento por pasta: `imports/{brand_id}/{year}/{month}/{uuid}.{ext}`

---

## 9.10 Segregação de Permissões e Acesso por Marca

### Regras Absolutas

```
1. Nunca expor dados de uma marca a um utilizador sem acesso a essa marca.
2. Nunca confiar no brand_id enviado pelo utilizador — usar sempre o da sessão.
3. Nunca retornar 404 quando o acesso é negado por razão de marca — retornar 403.
4. Verificar permissão de marca em TODAS as operações, não só nas de listagem.
```

```php
// Anti-pattern — NÃO FAZER (confia no input do utilizador)
public function show(Request $request, Campaign $campaign): Response
{
    return Inertia::render('Campaign/Show', compact('campaign'));
}

// Correto — verificar acesso explicitamente
public function show(Request $request, Campaign $campaign): Response
{
    $this->authorize('view', $campaign);  // CampaignPolicy verifica brand_id
    return Inertia::render('Campaign/Show', compact('campaign'));
}

// Ou: Route Model Binding com scope de marca
Route::scopeBindings()->group(function () {
    Route::get('/campaigns/{campaign}', [CampaignController::class, 'show']);
});
// O binding usa automaticamente o Global Scope de brand_id
```

---

## 9.11 Auditoria e Logs

### O que é auditado (mínimo obrigatório)

| Evento | Detalhes guardados |
|--------|-------------------|
| Login bem-sucedido | user_id, IP, user_agent, device, timestamp |
| Login falhado | email tentado, IP, timestamp |
| Logout | user_id, IP, timestamp |
| Troca de marca | user_id, brand anterior, nova brand |
| Criação de campanha | user_id, brand_id, campaign_id |
| Envio de campanha | user_id, brand_id, campaign_id, recipients_count |
| Cancelamento de campanha | user_id, brand_id, campaign_id |
| Importação iniciada | user_id, brand_id, list_id, import_id, filename |
| Importação concluída | import_id, stats resumo |
| Criação de utilizador | admin_id, novo user_id |
| Alteração de papel | admin_id, user_id, brand_id, novo papel |
| Reset de password | user_id, IP |
| Acesso negado (403) | user_id, brand_id tentado, recurso |
| Pedido de esquecimento RGPD | admin_id, contact_id/email |
| Unsubscribe | contact_email, brand_id, source |
| Deleção de dados | user_id, tipo, id |

### Imutabilidade dos Audit Logs

```php
// audit_logs nunca deve ser atualizado ou apagado
// Apenas INSERT — nunca UPDATE ou DELETE

class AuditLog extends Model
{
    // Sem updated_at — registos imutáveis
    const UPDATED_AT = null;

    // Proibir update
    public function save(array $options = []): bool
    {
        if ($this->exists) {
            throw new \RuntimeException('Audit logs são imutáveis.');
        }
        return parent::save($options);
    }
}
```

---

## 9.12 RGPD / GDPR — Conformidade Completa

### Base Legal de Tratamento
- Consentimento explícito documentado (`contact_brand_relations.consent_status`)
- Interesse legítimo (ex: contactos clientes ativos) — documentado
- Contrato (ex: dados necessários para fulfillment) — documentado

### Direitos dos Titulares

| Direito | Implementação |
|---------|--------------|
| Acesso | Exportação dos dados do contacto via CSV |
| Retificação | Edição de dados do contacto |
| Apagamento ("direito ao esquecimento") | Anonimização: dados pessoais substituídos, hash mantido para supressão |
| Portabilidade | Exportação em formato legível por máquina (JSON/CSV) |
| Oposição | Opt-out global por marca |
| Limitação de tratamento | Marcação de contacto como "suspended" sem apagar |

### Gestão de Consentimento

```php
// Registo de consentimento rastreável
class ConsentService
{
    public function recordConsent(
        int    $contactId,
        int    $brandId,
        string $source,      // 'import', 'form', 'manual'
        string $ipAddress = null
    ): void {
        ContactBrandRelation::updateOrCreate(
            ['contact_id' => $contactId, 'brand_id' => $brandId],
            [
                'consent_status' => 'opted_in',
                'consent_source' => $source,
                'consent_date'   => now(),
            ]
        );

        AuditLog::create([
            'action'      => 'gdpr.consent_recorded',
            'entity_type' => 'Contact',
            'entity_id'   => $contactId,
            'brand_id'    => $brandId,
            'new_values'  => ['source' => $source, 'ip' => $ipAddress],
        ]);
    }
}
```

### Retenção de Dados

| Dado | Retenção | Ação após período |
|------|----------|------------------|
| Contactos ativos | Enquanto consentimento ativo | Notificação para renovar |
| Contactos unsubscribed | 3 anos (hash para supressão permanente) | Anonimizar dados pessoais |
| Email events (opens, clicks) | 2 anos | Arquivar / agregar |
| Audit logs | 5 anos (requisito legal PT) | Arquivo imutável |
| Ficheiros de importação | 30 dias após processamento | Deleção automática |
| Sessões expiradas | 30 dias | Limpeza automática |
| Failed login logs | 90 dias | Limpeza automática |

### "Direito ao Esquecimento" — Implementação

```php
class GdprErasureService
{
    public function processErasureRequest(int $contactId, int $requestedBy): void
    {
        DB::transaction(function () use ($contactId, $requestedBy) {
            $contact = Contact::findOrFail($contactId);

            // 1. Anonimizar dados pessoais
            $contact->update([
                'first_name' => '[REMOVED]',
                'last_name'  => '[REMOVED]',
                'phone'      => null,
                'company'    => null,
                // email mantido como hash — mas email real substituído
                'email'      => 'gdpr_removed_' . $contact->email_hash . '@removed.invalid',
            ]);

            // 2. Limpar campos personalizados
            ContactListMember::where('contact_id', $contactId)
                ->update(['custom_fields' => null]);

            // 3. Manter unsubscribes com email hash (para não enviar novamente)
            // email já foi atualizado para formato inválido — nenhum envio possível

            // 4. Anonimizar eventos de email
            EmailEvent::where('contact_id', $contactId)
                ->update(['email' => '[REMOVED]', 'ip_address' => null]);

            // 5. Registo de auditoria obrigatório
            AuditLog::create([
                'user_id'     => $requestedBy,
                'action'      => 'gdpr.erasure_completed',
                'entity_type' => 'Contact',
                'entity_id'   => $contactId,
                'new_values'  => ['email_hash' => $contact->email_hash],
                'ip_address'  => request()->ip(),
            ]);
        });
    }
}
```

---

## 9.13 Checklist de Segurança — Dia 1

### Obrigatório antes do primeiro deploy

- [ ] HTTPS com TLS 1.2+ e certificado válido
- [ ] HSTS header configurado (incluindo subdomains)
- [ ] `APP_ENV=production` e `APP_DEBUG=false`
- [ ] `APP_KEY` gerado e seguro (nunca no repositório)
- [ ] Passwords com Argon2id e políticas de complexidade
- [ ] Rate limiting no login e endpoints críticos
- [ ] CSRF protection ativo em todas as rotas web
- [ ] Sessões: HttpOnly, Secure, SameSite=Lax, encriptadas
- [ ] Headers de segurança HTTP configurados:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Content-Security-Policy` (permitir apenas origens conhecidas)
- [ ] SQL injection impossível (apenas Eloquent + prepared statements)
- [ ] Ficheiros de import no S3 privado, nunca em path público
- [ ] `.env` fora da raiz pública do servidor web
- [ ] `storage/` e `bootstrap/cache/` não acessíveis via URL
- [ ] Logs não contêm dados pessoais completos
- [ ] Audit log imutável e operacional
- [ ] Global Scope de brand_id em todos os models relevantes
- [ ] Policies de autorização em todos os controllers
- [ ] Variáveis sensíveis (DB password, API keys) apenas em `.env` / vault
- [ ] Backups automáticos da base de dados e testados
- [ ] `composer.lock` e `package-lock.json` comitados (dependências fixas)
- [ ] `composer audit` sem vulnerabilidades conhecidas

---

## 9.14 Backups e Disaster Recovery

### Estratégia de Backup

| Componente | Frequência | Retenção | Tipo |
|------------|------------|----------|------|
| MySQL (dados) | Cada hora | 7 dias | Incremental (binlog) |
| MySQL (full) | Diário | 30 dias | Full dump |
| Redis | Diário | 7 dias | RDB snapshot |
| S3 (ficheiros) | Continuous | 90 dias | Versioning |
| Configurações | A cada alteração | Permanente | Git |

### Testes de Recuperação
- Teste de restore mensal (tabletop exercise)
- RTO (Recovery Time Objective): < 4 horas
- RPO (Recovery Point Objective): < 1 hora

---

*Próximo: [10 — UX / Dashboard / Backoffice](10-ux-dashboard.md)*
