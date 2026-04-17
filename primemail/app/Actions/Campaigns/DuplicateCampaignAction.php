<?php

namespace App\Actions\Campaigns;

use App\Enums\CampaignStatus;
use App\Models\Campaign;

class DuplicateCampaignAction
{
    public function execute(Campaign $campaign): Campaign
    {
        $clone = $campaign->replicate([
            'status', 'scheduled_at', 'sent_at',
            'actual_recipients', 'estimated_recipients',
        ]);

        $clone->name       = 'Cópia de ' . $campaign->name;
        $clone->status     = CampaignStatus::Draft;
        $clone->sent_at    = null;
        $clone->created_by = auth()->id();

        // replicate() não inclui timestamps — save() irá criá-los
        $clone->save();

        // Duplicar listas associadas
        foreach ($campaign->campaignLists as $cl) {
            $clone->campaignLists()->create([
                'list_id'      => $cl->list_id,
                'segment_id'   => $cl->segment_id,
                'is_exclusion' => $cl->is_exclusion,
            ]);
        }

        return $clone;
    }
}
