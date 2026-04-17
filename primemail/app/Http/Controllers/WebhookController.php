<?php

namespace App\Http\Controllers;

use App\Actions\Campaigns\ProcessWebhookEventAction;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Log;

class WebhookController extends Controller
{
    private const VALID_EVENTS = ['delivered', 'open', 'click', 'bounce', 'unsubscribe', 'spam_complaint'];

    public function mailgun(Request $request, ProcessWebhookEventAction $action): Response
    {
        if (!$this->verifyMailgunSignature($request)) {
            Log::warning('Mailgun webhook: invalid signature', ['ip' => $request->ip()]);
            return response('Unauthorized', 401);
        }

        try {
            $payload   = $request->input('event-data', $request->all());
            $eventType = $this->normaliseEventType($payload['event'] ?? '');

            if (!in_array($eventType, self::VALID_EVENTS)) {
                return response('OK', 200);
            }

            $variables = $this->parseVariables($payload);

            $action->execute([
                'event_type'  => $eventType,
                'token'       => $variables['token']       ?? null,
                'campaign_id' => $variables['campaign_id'] ?? null,
                'contact_id'  => $variables['contact_id']  ?? null,
                'brand_id'    => $variables['brand_id']    ?? null,
                'email'       => $payload['recipient']     ?? null,
                'ip'          => $payload['ip']            ?? null,
                'user_agent'  => $payload['client-info']['user-agent'] ?? null,
                'occurred_at' => isset($payload['timestamp'])
                                    ? \Carbon\Carbon::createFromTimestamp($payload['timestamp'])
                                    : now(),
                'raw'         => $payload,
            ]);
        } catch (\Throwable $e) {
            Log::error('Mailgun webhook processing error', ['error' => $e->getMessage()]);
            return response('Error', 500);
        }

        return response('OK', 200);
    }

    private function verifyMailgunSignature(Request $request): bool
    {
        $signingKey = config('services.mailgun.webhook_signing_key');

        if (empty($signingKey)) {
            return app()->environment('local', 'testing');
        }

        $data = $request->input('signature', []);
        if (empty($data['timestamp']) || empty($data['token']) || empty($data['signature'])) {
            return false;
        }

        $expected = hash_hmac(
            'sha256',
            $data['timestamp'] . $data['token'],
            $signingKey
        );

        return hash_equals($expected, $data['signature']);
    }

    private function normaliseEventType(string $event): string
    {
        return match ($event) {
            'opened'         => 'open',
            'clicked'        => 'click',
            'bounced'        => 'bounce',
            'unsubscribed'   => 'unsubscribe',
            'complained'     => 'spam_complaint',
            default          => $event,
        };
    }

    private function parseVariables(array $payload): array
    {
        $vars = $payload['user-variables'] ?? [];

        if (is_string($vars)) {
            $vars = json_decode($vars, true) ?? [];
        }

        return $vars;
    }
}
