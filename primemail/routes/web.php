<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Brand\BrandSelectorController;
use App\Http\Controllers\CampaignController;
use App\Http\Controllers\ContactController;
use App\Http\Controllers\ContactListController;
use App\Http\Controllers\ImportController;
use App\Http\Controllers\TemplateController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', fn () => redirect()->route('login'));

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
        Route::get('dashboard', fn () => Inertia::render('Dashboard'))->name('dashboard');

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
    });
});
