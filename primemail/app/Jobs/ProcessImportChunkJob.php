<?php

namespace App\Jobs;

use App\Models\Import;
use App\Services\ContactImportService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

class ProcessImportChunkJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries   = 3;
    public int $timeout = 300;

    public function __construct(
        public readonly int   $importId,
        public readonly array $rows,
        public readonly array $fieldMap,
    ) {
        $this->onQueue('imports');
    }

    public function handle(ContactImportService $service): void
    {
        $import = Import::find($this->importId);
        if (!$import || $import->status->isTerminal()) {
            return;
        }

        $counts = $service->processChunk($this->rows, $this->fieldMap, $import);

        // Incrementos atómicos — evita race conditions entre jobs paralelos
        Import::where('id', $this->importId)->increment('imported_count', $counts['imported']);
        Import::where('id', $this->importId)->increment('skipped_count',  $counts['skipped']);
        Import::where('id', $this->importId)->increment('error_count',    $counts['failed']);
    }

    public function failed(\Throwable $exception): void
    {
        Import::where('id', $this->importId)->increment('error_count', count($this->rows));
    }
}
