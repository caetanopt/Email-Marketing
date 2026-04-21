<?php

namespace App\Actions\Contacts;

use App\Enums\ImportStatus;
use App\Jobs\FinalizeImportJob;
use App\Jobs\ProcessImportChunkJob;
use App\Models\Import;
use App\Services\ContactImportService;
use Illuminate\Bus\Batch;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Storage;

class ImportContactsAction
{
    private const CHUNK_SIZE = 500;

    public function __construct(private readonly ContactImportService $service) {}

    /**
     * Orquestra a importação de um CSV ou TXT (um email por linha):
     * 1. Persiste o ficheiro em storage/local
     * 2. Detecta o tipo (txt vs csv) e faz parse apropriado
     * 3. Cria registo Import
     * 4. Divide em chunks de 500 linhas e despacha jobs em batch
     * 5. Ao terminar o batch, dispara FinalizeImportJob
     */
    public function execute(UploadedFile $file, int $brandId, ?int $listId = null): Import
    {
        $path      = $file->store("imports/{$brandId}", disk: 'local');
        $extension = strtolower($file->getClientOriginalExtension());

        if ($extension === 'txt') {
            [$chunks, $totalRows, $fieldMap] = $this->parseTxt($path);
        } else {
            [$chunks, $totalRows, $fieldMap] = $this->parseCsv($path);
        }

        // Criar registo Import
        $import = Import::create([
            'brand_id'       => $brandId,
            'list_id'        => $listId,
            'user_id'        => auth()->id(),
            'file_name'      => $file->getClientOriginalName(),
            'file_path'      => $path,
            'file_size'      => $file->getSize(),
            'status'         => ImportStatus::Processing,
            'total_rows'     => $totalRows,
            'imported_count' => 0,
            'skipped_count'  => 0,
            'error_count'    => 0,
            'started_at'     => now(),
        ]);

        // Despachar jobs em batch
        $jobs = array_map(
            fn ($rows) => new ProcessImportChunkJob($import->id, $rows, $fieldMap),
            $chunks
        );

        Bus::batch($jobs)
            ->then(fn (Batch $batch) => FinalizeImportJob::dispatch($import->id))
            ->catch(fn (Batch $batch, \Throwable $e) =>
                $import->update(['status' => ImportStatus::Failed])
            )
            ->allowFailures()
            ->onQueue('imports')
            ->dispatch();

        return $import;
    }

    /** Parse TXT: cada linha não vazia é tratada como endereço de email. */
    private function parseTxt(string $path): array
    {
        $handle   = fopen(Storage::disk('local')->path($path), 'r');
        $fieldMap = ['email' => 0];
        $totalRows = 0;
        $chunks    = [];
        $chunk     = [];

        while (($line = fgets($handle)) !== false) {
            $email = trim($line);
            if ($email !== '') {
                $chunk[] = [$email];
                $totalRows++;
            }
            if (count($chunk) >= self::CHUNK_SIZE) {
                $chunks[] = $chunk;
                $chunk    = [];
            }
        }
        if (!empty($chunk)) {
            $chunks[] = $chunk;
        }
        fclose($handle);

        return [$chunks, $totalRows, $fieldMap];
    }

    /** Parse CSV: detecta delimitador, mapeia cabeçalhos, divide em chunks. */
    private function parseCsv(string $path): array
    {
        $handle    = fopen(Storage::disk('local')->path($path), 'r');
        $firstLine = fgets($handle);
        rewind($handle);

        $delimiter = $this->service->detectDelimiter($firstLine);
        $headers   = fgetcsv($handle, separator: $delimiter);
        $fieldMap  = $this->service->mapHeaders($headers);

        if (!isset($fieldMap['email'])) {
            fclose($handle);
            Storage::disk('local')->delete($path);
            throw new \InvalidArgumentException(
                'Ficheiro CSV não contém coluna de email reconhecida.'
            );
        }

        $totalRows = 0;
        $chunks    = [];
        $chunk     = [];

        while (($row = fgetcsv($handle, separator: $delimiter)) !== false) {
            if (array_filter($row)) {
                $chunk[] = $row;
                $totalRows++;
            }
            if (count($chunk) >= self::CHUNK_SIZE) {
                $chunks[] = $chunk;
                $chunk    = [];
            }
        }
        if (!empty($chunk)) {
            $chunks[] = $chunk;
        }
        fclose($handle);

        return [$chunks, $totalRows, $fieldMap];
    }
}
