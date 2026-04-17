<?php

namespace App\Http\Controllers;

use App\Models\Brand;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class BrandSettingsController extends Controller
{
    public function edit(): Response
    {
        $brand = Brand::findOrFail(session('active_brand_id'));

        // Never expose encrypted smtp_config to the frontend
        return Inertia::render('Brand/Settings', [
            'brand' => $brand->only([
                'id', 'name', 'slug', 'primary_color',
                'from_name', 'from_email', 'reply_to_email',
                'email_footer_html', 'physical_address', 'unsubscribe_url',
            ]),
            'hasSmtp' => !empty($brand->smtp_config),
        ]);
    }

    public function update(Request $request): RedirectResponse
    {
        $brand = Brand::findOrFail(session('active_brand_id'));

        $data = $request->validate([
            'name'              => 'required|string|max:255',
            'primary_color'     => 'required|string|regex:/^#[0-9A-Fa-f]{6}$/',
            'from_name'         => 'required|string|max:255',
            'from_email'        => 'required|email|max:320',
            'reply_to_email'    => 'nullable|email|max:320',
            'email_footer_html' => 'nullable|string|max:5000',
            'physical_address'  => 'nullable|string|max:500',
            'unsubscribe_url'   => 'nullable|url|max:500',
            // SMTP override (optional — only update if provided)
            'smtp_host'         => 'nullable|string|max:255',
            'smtp_port'         => 'nullable|integer|between:1,65535',
            'smtp_username'     => 'nullable|string|max:255',
            'smtp_password'     => 'nullable|string|max:255',
            'smtp_encryption'   => 'nullable|in:tls,ssl,starttls',
        ]);

        $smtpFields = ['smtp_host', 'smtp_port', 'smtp_username', 'smtp_password', 'smtp_encryption'];
        $smtpData   = array_filter(array_intersect_key($data, array_flip($smtpFields)));

        $brandData = array_diff_key($data, array_flip($smtpFields));

        if (!empty($smtpData)) {
            $existing = $brand->smtp_config ?? [];
            $brandData['smtp_config'] = array_merge($existing, $smtpData);
        }

        $brand->update($brandData);

        return back()->with('success', 'Definições da marca guardadas.');
    }

    public function clearSmtp(): RedirectResponse
    {
        Brand::findOrFail(session('active_brand_id'))->update(['smtp_config' => null]);

        return back()->with('success', 'Configuração SMTP personalizada removida.');
    }
}
