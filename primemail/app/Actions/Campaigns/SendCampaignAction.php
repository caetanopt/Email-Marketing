<?php

namespace App\Actions\Campaigns;

use App\Enums\CampaignStatus;
use App\Jobs\BuildCampaignRecipientsJob;
use App\Models\AuditLog;
use App\Models\Campaign;
use Illuminate\Validation\ValidationException;

class SendCampaignAction
{
    public function execute(Campaign $campaign): void
    {
        // Pré-condições obrigatórias antes de enviar
        if (!$campaign->status->canBeSent()) {
            throw ValidationException::withMessages([
                'status' => "Campanha em estado «{$campaign->status->label()}» não pode ser enviada.",
            ]);
        }

        if (empty($campaign->compiled_html)) {
            throw ValidationException::withMessages([
                'mjml_source' => 'O template MJML não foi compilado com sucesso. Edita o template antes de enviar.',
            ]);
        }

        if (!empty($campaign->compile_error)) {
            throw ValidationException::withMessages([
                'mjml_source' => 'O template tem erros de compilação: ' . $campaign->compile_error,
            ]);
        }

        // Snapshot — congela o HTML compilado para auditoria/reprodutibilidade
        // A partir daqui, alterações ao template não afectam esta campanha
        $campaign->update([
            'status'       => CampaignStatus::Sending,
            'sent_at'      => now(),
            // compiled_html já está em cache no model; o hook save() congela-o
        ]);

        // Constrói destinatários e dispara envio de forma assíncrona
        BuildCampaignRecipientsJob::dispatch($campaign->id)->onQueue('default');

        AuditLog::record(
            action:     'campaign.send_initiated',
            entityType: 'campaign',
            entityId:   $campaign->id,
            newValues:  ['status' => CampaignStatus::Sending->value],
        );
    }
}
