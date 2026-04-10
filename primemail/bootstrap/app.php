<?php

use App\Http\Middleware\BrandAccessMiddleware;
use App\Http\Middleware\EnsureActiveBrand;
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
        // Encrypt cookies except for public/webhook endpoints
        $middleware->encryptCookies(except: []);

        // Session-based Inertia SPA — trust these headers
        $middleware->trustProxies(at: '*');

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
