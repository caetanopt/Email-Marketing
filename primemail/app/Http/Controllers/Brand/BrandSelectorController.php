<?php

namespace App\Http\Controllers\Brand;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Brand;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Inertia\Inertia;
use Inertia\Response;

class BrandSelectorController extends Controller
{
    /**
     * Mostra o seletor com todas as marcas a que o utilizador tem acesso.
     */
    public function show(Request $request): Response
    {
        $brands = $request->user()->activeBrands()
            ->select('id', 'name', 'slug', 'primary_color', 'logo_path')
            ->get();

        return Inertia::render('Auth/SelectBrand', [
            'brands'         => $brands,
            'activeBrandId'  => session('active_brand_id'),
        ]);
    }

    /**
     * Define a marca ativa na sessão. Valida sempre o acesso antes de fixar.
     */
    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'brand_id' => ['required', 'integer', 'exists:brands,id'],
        ]);

        $user = $request->user();
        $brandId = (int) $data['brand_id'];

        // Nunca confiar no client — reverificar acesso server-side
        $hasAccess = $user->activeBrands()->where('brands.id', $brandId)->exists();

        if (!$hasAccess) {
            abort(403, 'Não tem acesso a esta marca.');
        }

        // Invalida cache da marca anterior (BrandAccessMiddleware)
        if ($old = session('active_brand_id')) {
            Cache::forget("brand_access.{$user->id}.{$old}");
        }

        session(['active_brand_id' => $brandId]);
        Cache::forget("brand_access.{$user->id}.{$brandId}");

        AuditLog::record(
            action:    'brand.selected',
            userId:    $user->id,
            brandId:   $brandId,
            newValues: ['brand_id' => $brandId],
        );

        return redirect()->intended(route('dashboard', absolute: false));
    }

    /**
     * Permite trocar de marca sem logout.
     */
    public function switch(Request $request): RedirectResponse
    {
        session()->forget('active_brand_id');
        return redirect()->route('brands.select');
    }
}
