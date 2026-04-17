<?php

namespace App\Http\Controllers;

use App\Actions\Campaigns\ProcessWebhookEventAction;
use App\Models\CampaignRecipient;
use App\Models\Contact;
use App\Models\SuppressionList;
use App\Models\Unsubscribe;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

class TrackingController extends Controller
{
    /** GET /track/open/{token} — returns 1×1 transparent GIF, records open event */
    public function open(string $token, ProcessWebhookEventAction $action): Response
    {
        $recipient = CampaignRecipient::where('tracking_token', $token)->first();

        if ($recipient) {
            $action->execute([
                'event_type'  => 'open',
                'token'       => $token,
                'campaign_id' => $recipient->campaign_id,
                'contact_id'  => $recipient->contact_id,
                'brand_id'    => $recipient->brand_id,
                'email'       => $recipient->email,
                'occurred_at' => now(),
            ]);
        }

        // 1×1 transparent GIF
        $gif = base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');

        return response($gif, 200, [
            'Content-Type'  => 'image/gif',
            'Cache-Control' => 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma'        => 'no-cache',
        ]);
    }

    /** GET /track/click/{token}/{url} — records click, redirects to destination */
    public function click(string $token, string $url, ProcessWebhookEventAction $action): \Illuminate\Http\RedirectResponse
    {
        $decoded   = urldecode($url);
        $recipient = CampaignRecipient::where('tracking_token', $token)->first();

        if ($recipient) {
            $action->execute([
                'event_type'  => 'click',
                'token'       => $token,
                'campaign_id' => $recipient->campaign_id,
                'contact_id'  => $recipient->contact_id,
                'brand_id'    => $recipient->brand_id,
                'email'       => $recipient->email,
                'occurred_at' => now(),
                'raw'         => ['url' => $decoded],
            ]);
        }

        return redirect()->away($decoded);
    }

    /** GET /unsubscribe/{brandId}/{emailHash} — opt-out confirmation page */
    public function unsubscribeConfirm(int $brandId, string $emailHash): \Inertia\Response
    {
        return Inertia::render('Unsubscribe/Confirm', [
            'brandId'   => $brandId,
            'emailHash' => $emailHash,
        ]);
    }

    /** POST /unsubscribe/{brandId}/{emailHash} — performs opt-out */
    public function unsubscribe(Request $request, int $brandId, string $emailHash): \Inertia\Response
    {
        $contact = Contact::withoutGlobalScopes()
            ->where('brand_id', $brandId)
            ->where('email_hash', $emailHash)
            ->first();

        if ($contact) {
            DB::transaction(function () use ($contact, $brandId, $request) {
                SuppressionList::firstOrCreate(
                    ['brand_id' => $brandId, 'email_hash' => $contact->email_hash],
                    [
                        'email'    => $contact->email,
                        'reason'   => 'unsubscribe',
                        'added_by' => null,
                    ]
                );

                Unsubscribe::firstOrCreate(
                    ['brand_id' => $brandId, 'email' => $contact->email],
                    [
                        'contact_id'      => $contact->id,
                        'source'          => 'link',
                        'ip_address'      => $request->ip(),
                        'unsubscribed_at' => now(),
                    ]
                );
            });
        }

        return Inertia::render('Unsubscribe/Done', [
            'email' => $contact?->email ?? '—',
        ]);
    }
}
