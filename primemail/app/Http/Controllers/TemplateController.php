<?php

namespace App\Http\Controllers;

use App\Exceptions\MjmlCompilationException;
use App\Http\Requests\StoreTemplateRequest;
use App\Models\AuditLog;
use App\Models\Template;
use App\Services\MjmlCompiler;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class TemplateController extends Controller
{
    public function index(): Response
    {
        $templates = Template::select('id', 'name', 'description', 'is_shared', 'compiled_at', 'compile_error', 'created_at')
            ->orderBy('is_shared')
            ->orderBy('name')
            ->get()
            ->map(fn ($t) => [
                ...$t->toArray(),
                'has_error'  => !empty($t->compile_error),
                'is_ready'   => $t->compiled_at !== null && empty($t->compile_error),
            ]);

        return Inertia::render('Templates/Index', compact('templates'));
    }

    public function create(): Response
    {
        return Inertia::render('Templates/Edit', [
            'template'   => null,
            'isCreating' => true,
        ]);
    }

    public function store(StoreTemplateRequest $request): RedirectResponse
    {
        $brandId  = session('active_brand_id');
        $template = Template::create([
            ...$request->validated(),
            'brand_id'   => $request->boolean('is_shared') ? null : $brandId,
            'created_by' => auth()->id(),
        ]);

        AuditLog::record('template.created', entityType: 'template', entityId: $template->id,
            newValues: ['name' => $template->name]);

        $msg = $template->hasCompiledSuccessfully()
            ? 'Template criado e compilado com sucesso.'
            : 'Template criado mas com erros de compilação MJML.';

        return redirect()->route('templates.index')->with('success', $msg);
    }

    public function edit(Template $template): Response
    {
        return Inertia::render('Templates/Edit', [
            'template'   => $template->only('id', 'name', 'description', 'mjml_source', 'content_text', 'is_shared', 'compile_error', 'compiled_at'),
            'isCreating' => false,
        ]);
    }

    public function update(StoreTemplateRequest $request, Template $template): RedirectResponse
    {
        $old = $template->only('name', 'mjml_source');
        $template->update($request->validated());

        AuditLog::record('template.updated', entityType: 'template', entityId: $template->id,
            oldValues: $old, newValues: $template->fresh()->only('name'));

        $msg = $template->hasCompiledSuccessfully()
            ? 'Template guardado e compilado.'
            : 'Template guardado mas com erros de compilação.';

        return redirect()->route('templates.index')->with('success', $msg);
    }

    public function destroy(Template $template): RedirectResponse
    {
        AuditLog::record('template.deleted', entityType: 'template', entityId: $template->id,
            oldValues: ['name' => $template->name]);
        $template->delete();

        return redirect()->route('templates.index')->with('success', 'Template eliminado.');
    }

    /**
     * Preview MJML em tempo real — chamado via fetch com debounce no editor.
     * Retorna HTML compilado ou erro de sintaxe.
     */
    public function preview(Request $request, MjmlCompiler $compiler): JsonResponse
    {
        $mjml = $request->input('mjml', '');

        if (strlen(trim($mjml)) < 10) {
            return response()->json(['html' => '', 'error' => null]);
        }

        try {
            $html = $compiler->compile($mjml, useCache: false);
            return response()->json(['html' => $html, 'error' => null]);
        } catch (MjmlCompilationException $e) {
            return response()->json(['html' => null, 'error' => $e->getMessage()], 422);
        }
    }
}
