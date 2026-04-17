<?php

namespace App\Mail;

use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\Contact;
use App\Services\EmailTrackingService;
use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Mail\Mailables\Headers;
use Illuminate\Queue\SerializesModels;

class CampaignMail extends Mailable
{
    use Queueable, SerializesModels;

    private string $instrumentedHtml;
    private string $plainText;

    public function __construct(
        private readonly Campaign          $campaign,
        private readonly Contact           $contact,
        private readonly CampaignRecipient $recipient,
    ) {
        $trackingService        = app(EmailTrackingService::class);
        $this->instrumentedHtml = $trackingService->instrument(
            $campaign->compiled_html,
            $recipient
        );
        $this->plainText = $campaign->content_text ?? strip_tags($campaign->compiled_html);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            from:    new \Illuminate\Mail\Mailables\Address(
                         $this->campaign->from_email,
                         $this->campaign->from_name
                     ),
            replyTo: $this->campaign->reply_to ? [
                         new \Illuminate\Mail\Mailables\Address($this->campaign->reply_to)
                     ] : [],
            subject: $this->campaign->subject,
        );
    }

    public function headers(): Headers
    {
        // Mailgun custom variables forwarded in webhook events
        $variables = json_encode([
            'campaign_id' => $this->campaign->id,
            'contact_id'  => $this->contact->id,
            'brand_id'    => $this->campaign->brand_id,
            'token'       => $this->recipient->tracking_token,
        ]);

        return new Headers(
            text: [
                'X-Mailgun-Variables'     => $variables,
                'X-Campaign-ID'           => (string) $this->campaign->id,
                'List-Unsubscribe'        => '<' . url("/unsubscribe/{$this->campaign->brand_id}/{$this->contact->email_hash}") . '>',
                'List-Unsubscribe-Post'   => 'List-Unsubscribe=One-Click',
            ]
        );
    }

    public function content(): Content
    {
        return new Content(htmlString: $this->instrumentedHtml);
    }

    public function attachments(): array
    {
        return [];
    }

    /** Adds plain-text alternative part after build. */
    public function build(): static
    {
        $this->text('emails.plain')->with(['content' => $this->plainText]);

        return $this;
    }
}
