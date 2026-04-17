<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Brand\BrandSelectorController;
use App\Http\Controllers\CampaignController;
use App\Http\Controllers\ContactController;
use App\Http\Controllers\ContactListController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\ImportController;
use App\Http\Controllers\SuppressionController;
use App\Http\Controllers\TemplateController;
use App\Http\Controllers\TrackingController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', fn () => redirect()->route('login'));

// ── Tracking público (sem auth) ────────────────────────────────────────────
Route::get('track/open/{token}',          [TrackingController::class, 'open'])->name('track.open');
Route::get('track/click/{token}/{url}',   [TrackingController::class, 'click'])->name('track.click')->where('url', '.*');
Route::get('unsubscribe/{brandId}/{emailHash}',  [TrackingController::class, 'unsubscribeConfirm'])->name('unsubscribe.confirm');
Route::post('unsubscribe/{brandId}/{emailHash}', [TrackingController::class, 'unsubscribe'])->name('unsubscribe');

// ── Mailgun Webhook (sem auth, HMAC-protegido) ─────────────────────────────
Route::post('webhooks/mailgun', [WebhookController::class, 'mailgun'])->name('webhooks.mailgun');

// ── Autenticação ──────────────────────────────────────────────────────────
Route::middleware('guest')->group(function () {
    Route::get('login',  [AuthenticatedSessionController::class, 'create'])->name('login');
    Route::post('login', [AuthenticatedSessionController::class, 'store']);
});

Route::middleware('auth')->group(function () {
    Route::post('logout', [AuthenticatedSessionController::class, 'destroy'])->name('logout');

    // ── Seletor de Marca ─────────────────────────────────────────────────
    Route::get('brands/select',  [BrandSelectorController::class, 'show'])->name('brands.select');
    Route::post('brands/select', [BrandSelectorController::class, 'store'])->name('brands.store');
    Route::post('brands/switch', [BrandSelectorController::class, 'switch'])->name('brands.switch');

    // ── Rotas protegidas por marca ativa ─────────────────────────────────
    Route::middleware(['active_brand', 'brand.access'])->group(function () {
        Route::get('dashboard', DashboardController::class)->name('dashboard');

        // Contactos
        Route::resource('contacts', ContactController::class);

        // Listas
        Route::resource('lists', ContactListController::class)->except(['show']);

        // Importações
        Route::prefix('imports')->name('imports.')->group(function () {
            Route::get('/',          [ImportController::class, 'index'])->name('index');
            Route::get('/create',    [ImportController::class, 'create'])->name('create');
            Route::post('/',         [ImportController::class, 'store'])->name('store');
            Route::get('/{import}',  [ImportController::class, 'show'])->name('show');
            Route::get('/{import}/progress', [ImportController::class, 'progress'])->name('progress');
        });

        // Templates MJML
        Route::post('templates/preview', [TemplateController::class, 'preview'])->name('templates.preview');
        Route::resource('templates', TemplateController::class);

        // Campanhas
        Route::post('campaigns/{campaign}/send', [CampaignController::class, 'send'])->name('campaigns.send');
        Route::resource('campaigns', CampaignController::class);

        // Supressão
        Route::get('suppression',               [SuppressionController::class, 'index'])->name('suppression.index');
        Route::delete('suppression/{suppression}', [SuppressionController::class, 'destroy'])->name('suppression.destroy');
    });
});
