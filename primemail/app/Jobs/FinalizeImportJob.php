<?php

namespace App\Jobs;

use App\Enums\ImportStatus;
use App\Models\ContactList;
use App\Models\Import;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class FinalizeImportJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 60;

    public function __construct(public readonly int $importId)
    {
        $this->onQueue('imports');
    }

    public function handle(): void
    {
        $import = Import::find($this->importId);
        if (!$import) return;

        $import->update([
            'status'       => ImportStatus::Completed,
            'completed_at' => now(),
        ]);

        // Actualiza contador da lista (denormalizado para performance)
        if ($import->list_id) {
            $activeCount = $import->list->members()
                ->where('status', 'active')
                ->count();

            ContactList::where('id', $import->list_id)->update([
                'active_contacts' => $activeCount,
                'total_contacts'  => $activeCount,
            ]);
        }
    }
}
