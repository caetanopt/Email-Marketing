<?php

namespace App\Actions\Campaigns;

use App\Mail\CampaignMail;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\Contact;
use App\Services\EmailTrackingService;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class SendTestEmailAction
{
    public function execute(Campaign $campaign, string $toEmail): void
    {
        if (empty($campaign->compiled_html)) {
            throw new \RuntimeException('Campanha sem HTML compilado. Verifica o template MJML.');
        }

        // Cria um contacto temporário para personalização
        $fakeContact = new Contact([
            'email'      => $toEmail,
            'first_name' => 'Teste',
            'last_name'  => '',
            'company'    => 'Empresa Teste',
            'email_hash' => hash('sha256', strtolower(trim($toEmail))),
        ]);

        // Recipient temporário (não persiste na DB)
        $fakeRecipient = new CampaignRecipient([
            'campaign_id'    => $campaign->id,
            'brand_id'       => $campaign->brand_id,
            'contact_id'     => 0,
            'email'          => $toEmail,
            'tracking_token' => Str::random(32),
        ]);

        $vars = [
            '{{ first_name }}'      => $fakeContact->first_name,
            '{{ last_name }}'       => $fakeContact->last_name,
            '{{ email }}'           => $toEmail,
            '{{ company }}'         => $fakeContact->company,
            '{{ brand_name }}'      => $campaign->brand?->name ?? '',
            '{{ subject }}'         => $campaign->subject,
            '{{ year }}'            => now()->year,
            '{{ unsubscribe_url }}' => url('/unsubscribe/0/test'),
        ];

        $personalised = $campaign->replicate();
        $personalised->compiled_html = str_replace(array_keys($vars), array_values($vars), $campaign->compiled_html);
        $personalised->content_text  = $campaign->content_text
            ? str_replace(array_keys($vars), array_values($vars), $campaign->content_text)
            : null;

        // Adiciona prefixo [TESTE] ao assunto
        $personalised->subject = '[TESTE] ' . $campaign->subject;

        Mail::to($toEmail)->send(new CampaignMail($personalised, $fakeContact, $fakeRecipient));
    }
}
