<?php

namespace App\Actions\Campaigns;

use App\Models\CampaignRecipient;
use App\Models\Contact;
use App\Models\EmailEvent;
use App\Models\SuppressionList;
use App\Models\Unsubscribe;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ProcessWebhookEventAction
{
    private const SUPPRESSION_EVENTS = ['unsubscribe', 'spam_complaint', 'bounce'];

    public function execute(array $eventData): void
    {
        $eventType = $eventData['event_type'];
        $token     = $eventData['token'] ?? null;
        $email     = strtolower(trim($eventData['email'] ?? ''));

        $recipient = $token
            ? CampaignRecipient::where('tracking_token', $token)->first()
            : null;

        if (!$recipient && $email && isset($eventData['campaign_id'])) {
            $recipient = CampaignRecipient::where('campaign_id', $eventData['campaign_id'])
                ->where('email', $email)
                ->first();
        }

        if (!$recipient) {
            Log::warning('WebhookEvent: recipient not found', $eventData);
            return;
        }

        DB::transaction(function () use ($eventType, $email, $recipient, $eventData) {
            // Record EmailEvent
            EmailEvent::create([
                'campaign_id' => $recipient->campaign_id,
                'brand_id'    => $recipient->brand_id,
                'contact_id'  => $recipient->contact_id,
                'email'       => $email ?: $recipient->email,
                'event_type'  => $eventType,
                'event_data'  => $eventData['raw'] ?? null,
                'ip_address'  => $eventData['ip'] ?? null,
                'user_agent'  => $eventData['user_agent'] ?? null,
                'occurred_at' => $eventData['occurred_at'] ?? now(),
            ]);

            // Update recipient status for terminal events
            match ($eventType) {
                'bounce'     => $recipient->update(['status' => 'bounced']),
                'unsubscribe', 'spam_complaint' => $recipient->update(['status' => 'suppressed', 'suppressed_at' => now()]),
                default      => null,
            };

            // Add to suppression list for hard bounces, unsubscribes, spam
            if (in_array($eventType, self::SUPPRESSION_EVENTS)) {
                $reason = match ($eventType) {
                    'bounce'          => 'hard_bounce',
                    'spam_complaint'  => 'spam_complaint',
                    default           => 'unsubscribe',
                };

                SuppressionList::firstOrCreate(
                    ['brand_id' => $recipient->brand_id, 'email_hash' => hash('sha256', $recipient->email)],
                    ['email' => $recipient->email, 'reason' => $reason, 'added_by' => null]
                );

                if ($eventType === 'unsubscribe') {
                    $contact = $recipient->contact_id
                        ? Contact::find($recipient->contact_id)
                        : Contact::where('email', $recipient->email)->first();

                    Unsubscribe::firstOrCreate(
                        ['brand_id' => $recipient->brand_id, 'email' => $recipient->email],
                        [
                            'contact_id'      => $contact?->id,
                            'campaign_id'     => $recipient->campaign_id,
                            'source'          => 'link',
                            'ip_address'      => $eventData['ip'] ?? null,
                            'unsubscribed_at' => now(),
                        ]
                    );
                }
            }
        });
    }
}
