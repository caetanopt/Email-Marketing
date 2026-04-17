<?php

namespace App\Console\Commands;

use App\Actions\Campaigns\SendCampaignAction;
use App\Enums\CampaignStatus;
use App\Models\Campaign;
use Illuminate\Console\Command;

class DispatchScheduledCampaigns extends Command
{
    protected $signature   = 'campaigns:dispatch-scheduled';
    protected $description = 'Dispatch campaigns whose scheduled_at has passed';

    public function handle(SendCampaignAction $action): int
    {
        $due = Campaign::withoutGlobalScopes()
            ->where('status', CampaignStatus::Scheduled)
            ->where('scheduled_at', '<=', now())
            ->get();

        if ($due->isEmpty()) {
            $this->line('No scheduled campaigns due.');
            return self::SUCCESS;
        }

        foreach ($due as $campaign) {
            try {
                $action->execute($campaign);
                $this->info("Dispatched campaign #{$campaign->id} — {$campaign->name}");
            } catch (\Throwable $e) {
                $this->error("Failed campaign #{$campaign->id}: {$e->getMessage()}");
            }
        }

        return self::SUCCESS;
    }
}
