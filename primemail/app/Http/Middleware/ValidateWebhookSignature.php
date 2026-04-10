<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ValidateWebhookSignature
{
    public function handle(Request $request, Closure $next, string $provider = 'mailgun'): Response
    {
        if (!$this->isValidSignature($request, $provider)) {
            abort(401, 'Assinatura de webhook inválida.');
        }

        return $next($request);
    }

    private function isValidSignature(Request $request, string $provider): bool
    {
        return match ($provider) {
            'mailgun' => $this->validateMailgun($request),
            default   => false,
        };
    }

    private function validateMailgun(Request $request): bool
    {
        $signingKey = config('services.mailgun.webhook_signing_key');
        $timestamp  = $request->input('signature.timestamp');
        $token      = $request->input('signature.token');
        $signature  = $request->input('signature.signature');

        if (!$signingKey || !$timestamp || !$token || !$signature) {
            return false;
        }

        $expected = hash_hmac('sha256', $timestamp . $token, $signingKey);

        return hash_equals($expected, $signature);
    }
}
