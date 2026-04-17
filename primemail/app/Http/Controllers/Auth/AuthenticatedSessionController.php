<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Models\AuditLog;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

class AuthenticatedSessionController extends Controller
{
    public function create(): Response
    {
        return Inertia::render('Auth/Login', [
            'canResetPassword' => true,
        ]);
    }

    public function store(LoginRequest $request): RedirectResponse
    {
        $request->authenticate();
        $request->session()->regenerate();

        AuditLog::record(
            action:    'auth.login',
            userId:    Auth::id(),
            brandId:   null,
            newValues: ['ip' => $request->ip(), 'user_agent' => $request->userAgent()],
        );

        // Se tiver apenas uma marca, define-a automaticamente
        $user = Auth::user();
        $brands = $user->activeBrands();

        if ($brands->count() === 1) {
            session(['active_brand_id' => $brands->first()->id]);
            return redirect()->intended(route('dashboard', absolute: false));
        }

        return redirect()->route('brands.select');
    }

    public function destroy(Request $request): RedirectResponse
    {
        $userId = Auth::id();

        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        AuditLog::record(
            action: 'auth.logout',
            userId: $userId,
        );

        return redirect()->route('login');
    }
}
