<?php

use App\Http\Controllers\Auth\AuthenticatedSessionController;
use App\Http\Controllers\Brand\BrandSelectorController;
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

    // ── Seletor de Marca (sem active_brand) ──────────────────────────────
    Route::get('brands/select',  [BrandSelectorController::class, 'show'])->name('brands.select');
    Route::post('brands/select', [BrandSelectorController::class, 'store'])->name('brands.store');
    Route::post('brands/switch', [BrandSelectorController::class, 'switch'])->name('brands.switch');

    // ── Rotas protegidas por marca ativa ─────────────────────────────────
    Route::middleware(['active_brand', 'brand.access'])->group(function () {
        Route::get('dashboard', fn () => Inertia::render('Dashboard'))->name('dashboard');
        // Route::resource('campaigns', CampaignController::class);
        // Route::resource('contacts',  ContactController::class);
        // Route::resource('templates', TemplateController::class);
    });
});
