<?php

namespace App\Http\Controllers;

use App\Actions\Contacts\ImportContactsAction;
use App\Models\ContactList;
use App\Models\Import;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ImportController extends Controller
{
    public function index(): Response
    {
        $imports = Import::with(['creator', 'list'])
            ->latest()
            ->paginate(20);

        return Inertia::render('Contacts/Imports/Index', compact('imports'));
    }

    public function create(): Response
    {
        $lists = ContactList::select('id', 'name')->orderBy('name')->get();

        return Inertia::render('Contacts/Imports/Create', compact('lists'));
    }

    public function store(Request $request, ImportContactsAction $action): RedirectResponse
    {
        $data = $request->validate([
            'file'    => ['required', 'file', 'mimes:csv,txt', 'max:102400'], // 100MB
            'list_id' => ['nullable', 'integer', 'exists:contact_lists,id'],
        ]);

        try {
            $import = $action->execute(
                file:    $data['file'],
                brandId: session('active_brand_id'),
                listId:  $data['list_id'] ?? null,
            );
        } catch (\InvalidArgumentException $e) {
            return back()->withErrors(['file' => $e->getMessage()]);
        }

        return redirect()->route('imports.show', $import)
            ->with('success', "Importação iniciada: {$import->total_rows} linhas em processamento.");
    }

    public function show(Import $import): Response
    {
        $import->load(['creator', 'list']);

        return Inertia::render('Contacts/Imports/Show', compact('import'));
    }

    /**
     * Endpoint de polling para o progresso em tempo real (retorna JSON).
     */
    public function progress(Import $import): JsonResponse
    {
        return response()->json([
            'id'             => $import->id,
            'filename'       => $import->file_name,
            'status'         => $import->status->value,
            'total_rows'     => $import->total_rows,
            'imported_count' => $import->imported_count,
            'skipped_count'  => $import->skipped_count,
            'failed_count'   => $import->error_count,
            'progress'       => $import->getProgressPercentageAttribute(),
            'is_terminal'    => $import->status->isTerminal(),
        ]);
    }
}
