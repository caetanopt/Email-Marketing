<?php

namespace App\Http\Controllers;

use App\Actions\Campaigns\CreateCampaignAction;
use App\Actions\Campaigns\SendCampaignAction;
use App\Enums\CampaignStatus;
use App\Http\Requests\StoreCampaignRequest;
use App\Models\Campaign;
use App\Models\ContactList;
use App\Models\Template;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class CampaignController extends Controller
{
    public function index(): Response
    {
        $campaigns = Campaign::with(['creator'])
            ->select('id', 'name', 'subject', 'status', 'scheduled_at', 'sent_at',
                     'actual_recipients', 'estimated_recipients', 'created_at', 'created_by')
            ->latest()
            ->paginate(20);

        return Inertia::render('Campaigns/Index', [
            'campaigns' => $campaigns,
            'statuses'  => collect(CampaignStatus::cases())->map(fn ($s) => [
                'value' => $s->value,
                'label' => $s->label(),
            ]),
        ]);
    }

    public function create(): Response
    {
        return Inertia::render('Campaigns/Create', [
            'templates' => Template::select('id', 'name', 'is_shared', 'compiled_at')
                ->whereNotNull('compiled_at')
                ->whereNull('compile_error')
                ->orderBy('name')
                ->get(),
            'lists' => ContactList::select('id', 'name', 'active_contacts')
                ->orderBy('name')
                ->get(),
            'brand' => \App\Models\Brand::find(session('active_brand_id'))
                ?->only('from_name', 'from_email')
                ?? ['from_name' => '', 'from_email' => ''],
        ]);
    }

    public function store(StoreCampaignRequest $request, CreateCampaignAction $action): RedirectResponse
    {
        $campaign = $action->execute($request->validated(), session('active_brand_id'));

        return redirect()->route('campaigns.show', $campaign)
            ->with('success', 'Campanha criada. Revê o conteúdo antes de enviar.');
    }

    public function show(Campaign $campaign): Response
    {
        $campaign->load(['creator', 'campaignLists.list', 'template']);

        $stats = [
            'sent'      => $campaign->recipients()->where('status', 'sent')->count(),
            'failed'    => $campaign->recipients()->where('status', 'failed')->count(),
            'suppressed'=> $campaign->recipients()->where('status', 'suppressed')->count(),
            'opens'     => $campaign->emailEvents()->where('event_type', 'open')->count(),
            'clicks'    => $campaign->emailEvents()->where('event_type', 'click')->distinct('contact_id')->count('contact_id'),
        ];

        $stats['open_rate']  = $stats['sent'] ? round($stats['opens']  / $stats['sent'] * 100, 1) : 0;
        $stats['click_rate'] = $stats['sent'] ? round($stats['clicks'] / $stats['sent'] * 100, 1) : 0;

        return Inertia::render('Campaigns/Show', compact('campaign', 'stats'));
    }

    public function edit(Campaign $campaign): Response
    {
        if ($campaign->status->isFinal()) {
            return redirect()->route('campaigns.show', $campaign)
                ->with('error', 'Campanhas já enviadas não podem ser editadas.');
        }

        return Inertia::render('Campaigns/Edit', [
            'campaign'  => $campaign->load('campaignLists'),
            'templates' => Template::select('id', 'name')->whereNotNull('compiled_at')->get(),
            'lists'     => ContactList::select('id', 'name')->orderBy('name')->get(),
        ]);
    }

    public function update(StoreCampaignRequest $request, Campaign $campaign): RedirectResponse
    {
        if ($campaign->status->isFinal()) {
            abort(403, 'Não é possível editar uma campanha já finalizada.');
        }

        $campaign->update($request->safe()->except('list_ids'));

        // Actualizar listas associadas
        $campaign->campaignLists()->delete();
        foreach ($request->validated()['list_ids'] as $listId) {
            $campaign->campaignLists()->create(['list_id' => $listId, 'is_exclusion' => false]);
        }

        return redirect()->route('campaigns.show', $campaign)->with('success', 'Campanha actualizada.');
    }

    public function destroy(Campaign $campaign): RedirectResponse
    {
        if ($campaign->status === CampaignStatus::Sending) {
            abort(403, 'Não é possível eliminar uma campanha a ser enviada.');
        }
        $campaign->delete();

        return redirect()->route('campaigns.index')->with('success', 'Campanha eliminada.');
    }

    /**
     * Inicia o envio da campanha ou agenda para a data definida.
     */
    public function send(Campaign $campaign, SendCampaignAction $action): RedirectResponse
    {
        try {
            $action->execute($campaign);
        } catch (ValidationException $e) {
            return back()->withErrors($e->errors());
        }

        return redirect()->route('campaigns.show', $campaign)
            ->with('success', 'Campanha em envio. Acompanha o progresso nesta página.');
    }
}
