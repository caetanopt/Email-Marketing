<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureActiveBrand
{
    public function handle(Request $request, Closure $next): Response
    {
        if (!session('active_brand_id')) {
            if ($request->expectsJson()) {
                return response()->json(['message' => 'Nenhuma marca ativa selecionada.'], 422);
            }
            return redirect()->route('brands.select')
                ->withError('Selecione uma marca para continuar.');
        }

        return $next($request);
    }
}
