<?php

use App\Http\Middleware\BrandAccessMiddleware;
use App\Http\Middleware\EnsureActiveBrand;
use App\Http\Middleware\HandleInertiaRequests;
use App\Http\Middleware\ValidateWebhookSignature;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Exempt webhook + tracking routes from CSRF (validated by HMAC instead)
        $middleware->validateCsrfTokens(except: [
            'webhooks/*',
            'track/*',
            'unsubscribe/*',
        ]);

        // Session-based Inertia SPA — trust these headers
        $middleware->trustProxies(at: '*');

        // Inertia middleware — partilha `auth.user`, `activeBrand`, flash
        $middleware->web(append: [
            HandleInertiaRequests::class,
        ]);

        // Named middleware aliases for route-level usage
        $middleware->alias([
            'active_brand'       => EnsureActiveBrand::class,
            'brand.access'       => BrandAccessMiddleware::class,
            'webhook.signature'  => ValidateWebhookSignature::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
