<?php

namespace App\Jobs;

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
            $this->markFailed();
            return;
        }

        $recipients = CampaignRecipient::with('contact')
            ->whereIn('id', $this->recipientIds)
            ->where('status', 'pending')
            ->get();

        foreach ($recipients as $recipient) {
            $contact = $recipient->contact;
            if (!$contact) {
                $recipient->update(['status' => 'failed']);
                continue;
            }

            // Última verificação de supressão (pode ter mudado desde BuildCampaignRecipientsJob)
            if (SuppressionList::isSuppressed($campaign->brand_id, $contact->email)) {
                $recipient->update(['status' => 'suppressed', 'suppressed_at' => now()]);
                continue;
            }

            try {
                $html = $this->personalise($campaign->compiled_html, $campaign, $contact);
                $text = $this->personalise($campaign->content_text ?? '', $campaign, $contact);

                // Envio via Laravel Mail (driver configurado por marca — Mailgun em produção)
                Mail::send([], [], function ($message) use ($campaign, $contact, $html, $text) {
                    $message
                        ->to($contact->email, $contact->full_name)
                        ->from($campaign->from_email, $campaign->from_name)
                        ->replyTo($campaign->reply_to ?? $campaign->from_email)
                        ->subject($campaign->subject)
                        ->setBody($html, 'text/html')
                        ->addPart($text ?: strip_tags($html), 'text/plain');
                });

                $recipient->update(['status' => 'sent', 'sent_at' => now()]);

                EmailEvent::create([
                    'campaign_id' => $campaign->id,
                    'contact_id'  => $contact->id,
                    'brand_id'    => $campaign->brand_id,
                    'type'        => 'sent',
                    'occurred_at' => now(),
                ]);

            } catch (\Throwable $e) {
                $recipient->update(['status' => 'failed', 'failed_at' => now()]);
            }
        }
    }

    /**
     * Substitui variáveis {{ var }} no HTML/texto por valores do contacto.
     */
    private function personalise(string $content, Campaign $campaign, Contact $contact): string
    {
        $vars = [
            '{{ first_name }}'    => $contact->first_name ?? '',
            '{{ last_name }}'     => $contact->last_name  ?? '',
            '{{ email }}'         => $contact->email,
            '{{ company }}'       => $contact->company    ?? '',
            '{{ brand_name }}'    => $campaign->brand?->name ?? '',
            '{{ subject }}'       => $campaign->subject,
            '{{ year }}'          => now()->year,
            '{{ unsubscribe_url }}' => url("/unsubscribe/{$campaign->brand_id}/{$contact->email_hash}"),
        ];

        return str_replace(array_keys($vars), array_values($vars), $content);
    }

    private function markFailed(): void
    {
        CampaignRecipient::whereIn('id', $this->recipientIds)->update(['status' => 'failed']);
    }
}
