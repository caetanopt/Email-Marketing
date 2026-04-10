<?php

namespace App\Http\Middleware;

use App\Models\UserBrandRole;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

class BrandAccessMiddleware
{
    public function handle(Request $request, Closure $next): Response
    {
        $user    = $request->user();
        $brandId = session('active_brand_id');

        if (!$user || !$brandId) {
            abort(403, 'Acesso não autorizado.');
        }

        // Cache de 15 minutos — evita query a cada request
        $hasAccess = Cache::remember(
            "brand_access.{$user->id}.{$brandId}",
            now()->addMinutes(15),
            fn () => UserBrandRole::where('user_id', $user->id)
                ->where('brand_id', $brandId)
                ->whereNull('revoked_at')
                ->exists()
        );

        if (!$hasAccess) {
            // 403 e não 404 — nunca revelar existência de outras marcas
            abort(403, 'Não tem acesso a esta marca.');
        }

        return $next($request);
    }
}
