<?php

namespace App\Jobs;

use App\Enums\CampaignStatus;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\ContactListMember;
use App\Models\SuppressionList;
use Illuminate\Bus\Batch;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;

class BuildCampaignRecipientsJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 600;

    public function __construct(public readonly int $campaignId) {}

    public function handle(): void
    {
        $campaign = Campaign::with('campaignLists')->find($this->campaignId);

        if (!$campaign || $campaign->status !== CampaignStatus::Sending) {
            return;
        }

        $brandId     = $campaign->brand_id;
        $listIds     = $campaign->campaignLists()
            ->where('is_exclusion', false)
            ->pluck('list_id')
            ->filter()
            ->all();

        $exclusionIds = $campaign->campaignLists()
            ->where('is_exclusion', true)
            ->pluck('list_id')
            ->filter()
            ->all();

        // Expandir listas em contactos únicos — deduplicados por email_hash
        $contactIds = ContactListMember::query()
            ->whereIn('list_id', $listIds)
            ->where('status', 'active')
            ->when($exclusionIds, fn ($q) =>
                $q->whereNotIn('contact_id',
                    ContactListMember::whereIn('list_id', $exclusionIds)->select('contact_id')
                )
            )
            ->select('contact_id')
            ->distinct()
            ->pluck('contact_id');

        // Filtrar suprimidos (join com suppression_list por email_hash)
        $suppressedHashes = SuppressionList::where('brand_id', $brandId)->pluck('email_hash');

        $validContactIds = DB::table('contacts')
            ->whereIn('id', $contactIds)
            ->whereNotIn('email_hash', $suppressedHashes)
            ->pluck('id');

        if ($validContactIds->isEmpty()) {
            $campaign->update(['status' => CampaignStatus::Sent, 'actual_recipients' => 0]);
            return;
        }

        // Inserir em campaign_recipients em chunks (evitar INSERT imenso)
        $totalRecipients = 0;
        foreach ($validContactIds->chunk(1000) as $chunk) {
            $rows = $chunk->map(fn ($id) => [
                'campaign_id' => $this->campaignId,
                'contact_id'  => $id,
                'status'      => 'pending',
                'created_at'  => now(),
                'updated_at'  => now(),
            ])->all();

            DB::table('campaign_recipients')->insertOrIgnore($rows);
            $totalRecipients += count($rows);
        }

        $campaign->update(['estimated_recipients' => $totalRecipients]);

        // Despachar jobs de envio em batch (100 destinatários por job)
        $jobs = CampaignRecipient::where('campaign_id', $this->campaignId)
            ->where('status', 'pending')
            ->select('id')
            ->lazy(100)
            ->chunk(100)
            ->map(fn ($chunk) => new SendCampaignEmailsJob($this->campaignId, $chunk->pluck('id')->all()))
            ->all();

        Bus::batch($jobs)
            ->then(fn (Batch $batch) =>
                Campaign::where('id', $this->campaignId)->update([
                    'status'            => CampaignStatus::Sent->value,
                    'actual_recipients' => $totalRecipients,
                ])
            )
            ->catch(fn (Batch $batch, \Throwable $e) =>
                Campaign::where('id', $this->campaignId)->update(['status' => CampaignStatus::Failed->value])
            )
            ->allowFailures()
            ->onQueue('default')
            ->dispatch();
    }
}
