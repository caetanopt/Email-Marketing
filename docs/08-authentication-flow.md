# 08 — Fluxo Seguro de Autenticação e Login

## Caetano eMKT — Autenticação, Sessões e Contexto de Marca

---

## 8.1 Abordagem de Autenticação — Sessões vs JWT vs Híbrido

### Análise das Opções

| Critério | Sessões Tradicionais | JWT | Híbrido (Sessões + API tokens) |
|----------|---------------------|-----|-------------------------------|
| Segurança web (SPA/Inertia) | ✅ Excelente | ⚠️ Requer armazenamento seguro | ✅ Excelente |
| Revogação imediata | ✅ Sim (invalida na DB) | ❌ Não (até expirar) | ✅ Sim para web |
| Stateless | ❌ Requer servidor de sessões | ✅ Sim | Parcial |
| Complexidade | ✅ Baixa | ⚠️ Média | ✅ Baixa-Média |
| Multi-servidor | ✅ Com Redis | ✅ Nativo | ✅ Com Redis |
| CSRF protection | ✅ Nativo Laravel | ⚠️ Requer cuidado | ✅ Nativo |
| API pública (V2) | ❌ Não adequado | ✅ Sim | ✅ API tokens separados |

### Decisão: **Laravel Sessions + Redis + Sanctum**

**Para a aplicação web (MVP + V2):**
- Sessões server-side armazenadas em Redis
- Proteção CSRF nativa do Laravel
- Cookie HttpOnly + Secure + SameSite=Lax
- Revogação imediata possível

**Para a API pública (V2):**
- Laravel Sanctum com API tokens (não JWT)
- Tokens com scopes e expiração configurável
- Revogação de token possível

**Por que não JWT para a web?**
JWT armazenado em `localStorage` é vulnerável a XSS. Armazenado em cookie HttpOnly tem os mesmos benefícios que sessões tradicionais mas com complexidade adicional desnecessária. Para uma aplicação web corporativa com Inertia.js, sessões são a escolha certa.

---

## 8.2 Fluxo de Registo (por Convite)

```
Admin                     Sistema                      Novo Utilizador
  │                          │                               │
  │  1. Cria utilizador      │                               │
  │     (nome, email, papel, │                               │
  │      marcas)             │                               │
  │─────────────────────────►│                               │
  │                          │  2. Gera token de convite     │
  │                          │     (UUID, expira em 48h)     │
  │                          │  3. Envia email de convite    │
  │                          │─────────────────────────────►│
  │                          │                               │
  │                          │                               │  4. Clica no link
  │                          │◄─────────────────────────────│
  │                          │  5. Valida token              │
  │                          │  6. Mostra form de definição  │
  │                          │     de password               │
  │                          │─────────────────────────────►│
  │                          │                               │
  │                          │                               │  7. Define password
  │                          │◄─────────────────────────────│
  │                          │  8. Hash da password          │
  │                          │     (Argon2id)                │
  │                          │  9. Marca email como          │
  │                          │     verificado                │
  │                          │  10. Invalida token           │
  │                          │  11. Cria sessão              │
  │                          │  12. Redireciona para         │
  │                          │      seleção de marca         │
  │                          │─────────────────────────────►│
```

---

## 8.3 Fluxo de Login

```
Utilizador                    Laravel                      Redis/DB
    │                            │                            │
    │  1. GET /login              │                            │
    │────────────────────────────►│                            │
    │◄────────────────────────────│                            │
    │  [Formulário login]         │                            │
    │                             │                            │
    │  2. POST /login             │                            │
    │    {email, password,        │                            │
    │     remember_me}            │                            │
    │────────────────────────────►│                            │
    │                             │  3. Rate limit check       │
    │                             │────────────────────────────►│
    │                             │◄────────────────────────────│
    │                             │  [OK / Throttled]          │
    │                             │                            │
    │                             │  4. Normaliza email        │
    │                             │  5. Busca utilizador       │
    │                             │────────────────────────────►│
    │                             │◄────────────────────────────│
    │                             │                            │
    │                             │  6. Hash::check(password,  │
    │                             │     stored_hash)           │
    │                             │                            │
    │                             │  [Se falhou]               │
    │                             │  7a. Incrementa throttle   │
    │                             │  7b. Regista tentativa     │
    │◄────────────────────────────│     falhada no audit log   │
    │  [Erro genérico: "Credenciais│                            │
    │   inválidas"]               │                            │
    │                             │                            │
    │                             │  [Se sucesso]              │
    │                             │  8. Verifica email         │
    │                             │     verificado             │
    │                             │  9. Verifica status ativo  │
    │                             │  10. Regenera session ID   │
    │                             │      (anti-fixation)       │
    │                             │  11. Cria sessão no Redis  │
    │                             │────────────────────────────►│
    │                             │  12. Regista login no      │
    │                             │      audit log             │
    │                             │  13. Atualiza              │
    │                             │      last_login_at + IP    │
    │                             │  14. Determina marca ativa │
    │                             │      (última ou primeira)  │
    │◄────────────────────────────│                            │
    │  [Redirect → dashboard      │                            │
    │   da marca ativa]           │                            │
```

---

## 8.4 Proteção Contra Brute Force

### Rate Limiting com Laravel

```php
// LoginController — proteção com throttle nativo do Laravel
class LoginController extends Controller
{
    use ThrottlesLogins;

    protected int $maxAttempts = 5;     // máximo 5 tentativas
    protected int $decayMinutes = 15;   // bloqueio de 15 minutos

    protected function throttleKey(Request $request): string
    {
        // Throttle por email + IP (não só por IP)
        return Str::transliterate(
            Str::lower($request->input('email')) . '|' . $request->ip()
        );
    }

    public function login(LoginRequest $request): Response
    {
        // Verifica se está bloqueado
        if ($this->hasTooManyLoginAttempts($request)) {
            $this->fireLockoutEvent($request);
            return $this->sendLockoutResponse($request);
        }

        if (Auth::attempt($request->only('email', 'password'), $request->boolean('remember'))) {
            $this->clearLoginAttempts($request);
            $request->session()->regenerate();

            // ... resto do fluxo
        }

        $this->incrementLoginAttempts($request);

        // Sempre o mesmo erro — não revela se email existe
        return back()->withErrors(['email' => __('auth.failed')]);
    }
}
```

### Proteção Adicional

```php
// config/auth.php / Limitações adicionais via Redis
// Bloqueio de IP com muitas tentativas (de emails diferentes)
RateLimiter::for('login-ip', function (Request $request) {
    return Limit::perMinute(20)->by($request->ip()); // máx 20 tentativas/min por IP
});
```

---

## 8.5 Hash de Passwords

**Algoritmo: Argon2id** (PHP 7.2+ via `PASSWORD_ARGON2ID`)

```php
// config/hashing.php
'driver' => 'argon2id',
'argon' => [
    'memory'  => 65536,  // 64MB (adequado para servidor, resistente a GPU attacks)
    'threads' => 2,
    'time'    => 4,      // 4 iterações
],
```

**Por que Argon2id em vez de bcrypt?**
- Argon2id é o vencedor da Password Hashing Competition (2015)
- Resistente a ataques de GPU/ASIC (memory-hard)
- Parâmetros tunáveis para equilibrar segurança vs. performance
- bcrypt ainda é aceitável mas Argon2id é a escolha moderna

**Política de password:**
```php
// Regras de validação de password
Password::min(12)
    ->letters()
    ->mixedCase()
    ->numbers()
    ->symbols()
    ->uncompromised(3) // verifica contra base de passwords comprometidas (HaveIBeenPwned API)
```

---

## 8.6 Gestão Segura de Sessões

### Configuração

```php
// config/session.php
[
    'driver'          => 'redis',       // sessões em Redis
    'lifetime'        => 480,           // 8 horas de inatividade
    'expire_on_close' => false,
    'encrypt'         => true,          // conteúdo da sessão encriptado
    'cookie'          => 'primemail_session',
    'secure'          => true,          // HTTPS only
    'http_only'       => true,          // inacessível por JavaScript
    'same_site'       => 'lax',         // proteção CSRF
    'domain'          => '.caetanoprimemail.pt',
]
```

### "Lembrar-me" (Remember Me)

```php
// Se remember_me = true, cria um token de longa duração
// Token guardado como cookie HttpOnly com validade de 30 dias
// Hash do token guardado na DB (tabela remember_tokens)
// Regenerado em cada login para prevenir token stealing
Auth::attempt($credentials, $remember = true);
```

### Expiração de Sessão Inteligente

```php
// Middleware que verifica inatividade
class SessionTimeoutMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $lastActivity = session('last_activity_at');

        if ($lastActivity && now()->diffInMinutes($lastActivity) > 480) {
            Auth::logout();
            session()->invalidate();
            return redirect()->route('login')
                ->withError('A sua sessão expirou por inatividade.');
        }

        session(['last_activity_at' => now()]);
        return $next($request);
    }
}
```

---

## 8.7 Recuperação de Password

```
Utilizador                    Sistema
    │                            │
    │  1. POST /forgot-password   │
    │    {email}                  │
    │────────────────────────────►│
    │                             │  2. Sempre responde da mesma forma
    │                             │     (não revela se email existe)
    │◄────────────────────────────│
    │  "Se o email existir, vai   │
    │   receber um link."         │
    │                             │
    │                             │  3. Verifica se email existe
    │                             │  4. Se existe: gera token único
    │                             │     (64 chars, SHA-256 armazenado)
    │                             │  5. Envia email com link de reset
    │                             │     (válido 60 minutos)
    │                             │
    │  6. Clica no link            │
    │────────────────────────────►│
    │                             │  7. Valida token (existe + não expirou)
    │                             │  8. Mostra form de nova password
    │◄────────────────────────────│
    │                             │
    │  9. Submete nova password   │
    │────────────────────────────►│
    │                             │  10. Valida requisitos de password
    │                             │  11. Hash Argon2id da nova password
    │                             │  12. Invalida token (uso único)
    │                             │  13. Invalida TODAS as sessões ativas
    │                             │       do utilizador (segurança)
    │                             │  14. Regista no audit log
    │                             │  15. Envia email de confirmação
    │◄────────────────────────────│
    │  [Redirect → login]         │
```

---

## 8.8 Verificação de Email

```php
// Após registo, email de verificação enviado automaticamente
// Link: /email/verify/{id}/{hash}?expires=...&signature=...
// (URL assinada com tempo de expiração — Laravel padrão)

// Middleware que bloqueia acesso se email não verificado
Route::middleware(['auth', 'verified'])->group(function () {
    // Todas as rotas da aplicação
});
```

---

## 8.9 Logout

```php
class LogoutController extends Controller
{
    public function __invoke(Request $request): Response
    {
        // 1. Regista logout no audit log
        AuditLog::create([
            'user_id'    => auth()->id(),
            'brand_id'   => session('active_brand_id'),
            'action'     => 'auth.logout',
            'ip_address' => $request->ip(),
        ]);

        // 2. Logout e invalidação de sessão
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken(); // novo CSRF token

        return redirect()->route('login');
    }
}
```

---

## 8.10 Logs de Atividade de Autenticação

```php
// Eventos auditados automaticamente:
// - auth.login (success)
// - auth.login_failed (com email tentado, IP)
// - auth.logout
// - auth.password_reset_requested
// - auth.password_reset_completed
// - auth.email_verified
// - auth.session_expired
// - auth.lockout (após 5 tentativas falhadas)

// Exemplo de registo:
AuditLog::create([
    'user_id'     => $user->id,
    'brand_id'    => null,  // contexto ainda não definido no login
    'action'      => 'auth.login',
    'ip_address'  => $request->ip(),
    'user_agent'  => $request->userAgent(),
    'new_values'  => [
        'device_type' => $this->detectDevice($request),
        'location'    => $this->geoIp($request->ip()),  // aproximado
    ],
]);
```

---

## 8.11 Validação do Acesso às Marcas e Contexto Ativo

### Ao Fazer Login

```php
// Após autenticação, determinar a marca ativa
protected function setActiveBrand(User $user): void
{
    // 1. Tentar restaurar a última marca ativa do utilizador
    $lastBrandId = $user->active_brand_id;

    if ($lastBrandId) {
        $hasAccess = UserBrandRole::where('user_id', $user->id)
            ->where('brand_id', $lastBrandId)
            ->whereNull('revoked_at')
            ->exists();

        if ($hasAccess) {
            session(['active_brand_id' => $lastBrandId]);
            return;
        }
    }

    // 2. Fallback: primeira marca disponível
    $firstBrand = UserBrandRole::where('user_id', $user->id)
        ->whereNull('revoked_at')
        ->with('brand')
        ->orderBy('brand_id')
        ->first();

    if ($firstBrand) {
        session(['active_brand_id' => $firstBrand->brand_id]);
        $user->update(['active_brand_id' => $firstBrand->brand_id]);
        return;
    }

    // 3. Super admin: marca padrão do sistema
    if ($user->hasRole('super_admin')) {
        $defaultBrand = Brand::first();
        session(['active_brand_id' => $defaultBrand?->id]);
    }
}
```

### Ao Trocar de Marca (Brand Switch)

```php
// POST /brands/{brand}/switch
class BrandSwitchController extends Controller
{
    public function __invoke(Brand $brand): Response
    {
        // 1. Verifica que o utilizador tem acesso à marca
        $this->authorize('access', $brand);

        // 2. Atualiza sessão e DB
        session(['active_brand_id' => $brand->id]);
        auth()->user()->update(['active_brand_id' => $brand->id]);

        // 3. Regista no audit log
        AuditLog::create([
            'user_id'  => auth()->id(),
            'brand_id' => $brand->id,
            'action'   => 'brand.switched',
        ]);

        // 4. Retorna confirmação (Inertia faz reload automático do contexto)
        return back();
    }
}
```

---

## 8.12 Proteção CSRF

```php
// Todas as rotas POST/PUT/PATCH/DELETE têm proteção CSRF nativa
// Laravel valida o token CSRF em todos os formulários

// Inertia.js envia automaticamente o CSRF token em todos os pedidos
// via header X-XSRF-TOKEN (cookie não-HttpOnly para JavaScript ler)

// Exceções: rotas de webhook (ex: bounce handler do Mailgun)
// protegidas por IP whitelist + assinatura HMAC em vez de CSRF
Route::middleware('webhook.signature')->group(function () {
    Route::post('/webhooks/mailgun', [MailgunWebhookController::class, 'handle']);
});
```

---

*Próximo: [09 — Segurança e Proteção de Dados](09-security.md)*
