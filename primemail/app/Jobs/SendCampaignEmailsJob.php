<?php

namespace App\Jobs;

use App\Mail\CampaignMail;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\Contact;
use App\Models\EmailEvent;
use App\Models\SuppressionList;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class SendCampaignEmailsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 120;

    public function __construct(
        public readonly int   $campaignId,
        public readonly array $recipientIds,
    ) {
        $this->onQueue('default');
    }

    public function handle(): void
    {
        $campaign = Campaign::find($this->campaignId);
        if (!$campaign || empty($campaign->compiled_html)) {
            CampaignRecipient::whereIn('id', $this->recipientIds)->update(['status' => 'failed']);
            return;
        }

        $recipients = CampaignRecipient::with('contact')
            ->whereIn('id', $this->recipientIds)
            ->where('status', 'pending')
            ->get();

        foreach ($recipients as $recipient) {
            $contact = $recipient->contact;
            if (!$contact) {
                $recipient->update(['status' => 'failed', 'failed_at' => now()]);
                continue;
            }

            // Final suppression check (may have changed since BuildCampaignRecipientsJob)
            if (SuppressionList::isSuppressed($contact->email, $campaign->brand_id)) {
                $recipient->update(['status' => 'suppressed', 'suppressed_at' => now()]);
                continue;
            }

            // Assign tracking token if not set
            if (!$recipient->tracking_token) {
                $recipient->update(['tracking_token' => Str::random(32)]);
            }

            try {
                $html = $this->personalise($campaign->compiled_html, $campaign, $contact);
                $text = $this->personalise($campaign->content_text ?? '', $campaign, $contact);

                // Clone campaign with personalised content for the Mailable
                $personalised = $campaign->replicate();
                $personalised->compiled_html = $html;
                $personalised->content_text  = $text;

                $sent = Mail::to($contact->email, $contact->full_name)
                    ->send(new CampaignMail($personalised, $contact, $recipient));

                $messageId = $sent?->getSymfonyMessage()->generateMessageId() ?? null;

                $recipient->update([
                    'status'     => 'sent',
                    'sent_at'    => now(),
                    'message_id' => $messageId,
                ]);

                EmailEvent::create([
                    'campaign_id' => $campaign->id,
                    'contact_id'  => $contact->id,
                    'brand_id'    => $campaign->brand_id,
                    'email'       => $contact->email,
                    'event_type'  => 'delivered',
                    'occurred_at' => now(),
                ]);

            } catch (\Throwable $e) {
                $recipient->update(['status' => 'failed', 'failed_at' => now()]);
            }
        }
    }

    private function personalise(string $content, Campaign $campaign, Contact $contact): string
    {
        $vars = [
            '{{ first_name }}'      => $contact->first_name ?? '',
            '{{ last_name }}'       => $contact->last_name  ?? '',
            '{{ email }}'           => $contact->email,
            '{{ company }}'         => $contact->company    ?? '',
            '{{ brand_name }}'      => $campaign->brand?->name ?? '',
            '{{ subject }}'         => $campaign->subject,
            '{{ year }}'            => now()->year,
            '{{ unsubscribe_url }}' => url("/unsubscribe/{$campaign->brand_id}/{$contact->email_hash}"),
        ];

        return str_replace(array_keys($vars), array_values($vars), $content);
    }
}
