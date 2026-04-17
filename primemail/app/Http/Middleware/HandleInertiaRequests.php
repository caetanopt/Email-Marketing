<?php

namespace App\Http\Middleware;

use App\Models\Brand;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    protected $rootView = 'app';

    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    public function share(Request $request): array
    {
        $user = $request->user();
        $activeBrand = null;

        if ($brandId = session('active_brand_id')) {
            $activeBrand = Brand::select('id', 'name', 'slug', 'primary_color', 'logo_path')->find($brandId);
        }

        return [
            ...parent::share($request),

            'auth' => [
                'user' => $user ? [
                    'id'     => $user->id,
                    'name'   => $user->name,
                    'email'  => $user->email,
                    'avatar' => $user->avatar_path,
                ] : null,
            ],

            'activeBrand' => $activeBrand,

            'flash' => [
                'success' => fn () => $request->session()->get('success'),
                'error'   => fn () => $request->session()->get('error'),
            ],

            'csrf_token' => csrf_token(),
        ];
    }
}
