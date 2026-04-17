<?php

namespace App\Actions\Campaigns;

use App\Enums\CampaignStatus;
use App\Models\AuditLog;
use App\Models\Campaign;
use App\Models\CampaignList;
use App\Models\Template;

class CreateCampaignAction
{
    public function execute(array $data, int $brandId): Campaign
    {
        // Se um template foi selecionado, herda o MJML source
        $mjmlSource   = $data['mjml_source'] ?? null;
        $contentText  = $data['content_text'] ?? null;

        if (!empty($data['template_id'])) {
            $template = Template::find($data['template_id']);
            if ($template) {
                $mjmlSource  ??= $template->mjml_source;
                $contentText ??= $template->content_text;
            }
        }

        $campaign = Campaign::create([
            'brand_id'     => $brandId,
            'name'         => $data['name'],
            'subject'      => $data['subject'],
            'preview_text' => $data['preview_text'] ?? null,
            'from_name'    => $data['from_name'],
            'from_email'   => $data['from_email'],
            'reply_to'     => $data['reply_to'] ?? null,
            'template_id'  => $data['template_id'] ?? null,
            'mjml_source'  => $mjmlSource,
            'content_text' => $contentText,
            'status'       => CampaignStatus::Draft,
            'scheduled_at' => $data['scheduled_at'] ?? null,
            'created_by'   => auth()->id(),
        ]);

        // Associar listas
        foreach ($data['list_ids'] as $listId) {
            CampaignList::create([
                'campaign_id'  => $campaign->id,
                'list_id'      => $listId,
                'is_exclusion' => false,
            ]);
        }

        AuditLog::record(
            action:     'campaign.created',
            brandId:    $brandId,
            entityType: 'campaign',
            entityId:   $campaign->id,
            newValues:  ['name' => $campaign->name, 'subject' => $campaign->subject],
        );

        return $campaign;
    }
}
