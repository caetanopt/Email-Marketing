<?php

namespace App\Http\Controllers;

use App\Actions\Campaigns\CreateCampaignAction;
use App\Actions\Campaigns\DuplicateCampaignAction;
use App\Actions\Campaigns\SendCampaignAction;
use App\Actions\Campaigns\SendTestEmailAction;
use App\Enums\CampaignStatus;
use App\Http\Requests\StoreCampaignRequest;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\ContactList;
use App\Models\EmailEvent;
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

        $sent = $campaign->recipients()->where('status', 'sent')->count();

        $stats = [
            'sent'       => $sent,
            'failed'     => $campaign->recipients()->where('status', 'failed')->count(),
            'suppressed' => $campaign->recipients()->where('status', 'suppressed')->count(),
            'opens'      => $campaign->emailEvents()->where('event_type', 'open')->distinct('contact_id')->count('contact_id'),
            'clicks'     => $campaign->emailEvents()->where('event_type', 'click')->distinct('contact_id')->count('contact_id'),
        ];

        $stats['open_rate']  = $sent > 0 ? round($stats['opens']  / $sent * 100, 1) : 0;
        $stats['click_rate'] = $sent > 0 ? round($stats['clicks'] / $sent * 100, 1) : 0;

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

    /** POST /campaigns/{campaign}/test — envia email de teste para o endereço indicado */
    public function sendTest(Request $request, Campaign $campaign, SendTestEmailAction $action): RedirectResponse
    {
        $data = $request->validate([
            'email' => 'required|email|max:320',
        ]);

        try {
            $action->execute($campaign, $data['email']);
        } catch (\RuntimeException $e) {
            return back()->withErrors(['email' => $e->getMessage()]);
        }

        return back()->with('success', "Email de teste enviado para {$data['email']}.");
    }

    /** POST /campaigns/{campaign}/duplicate — clona campanha como rascunho */
    public function duplicate(Campaign $campaign, DuplicateCampaignAction $action): RedirectResponse
    {
        $clone = $action->execute($campaign);

        return redirect()->route('campaigns.edit', $clone)
            ->with('success', 'Campanha duplicada. Edita e envia quando estiveres pronto.');
    }

    /** GET /campaigns/{campaign}/report — relatório detalhado de destinatários */
    public function report(Request $request, Campaign $campaign): Response
    {
        $campaign->load(['creator']);

        $recipients = CampaignRecipient::with('contact:id,first_name,last_name,email')
            ->where('campaign_id', $campaign->id)
            ->when($request->status, fn ($q, $s) => $q->where('status', $s))
            ->when($request->search, fn ($q, $s) => $q->where('email', 'like', "%{$s}%"))
            ->orderByDesc('sent_at')
            ->paginate(50)
            ->withQueryString()
            ->through(function ($r) use ($campaign) {
                $opens  = EmailEvent::where('campaign_id', $campaign->id)
                    ->where('contact_id', $r->contact_id)
                    ->where('event_type', 'open')
                    ->count();
                $clicks = EmailEvent::where('campaign_id', $campaign->id)
                    ->where('contact_id', $r->contact_id)
                    ->where('event_type', 'click')
                    ->count();

                return [
                    'id'           => $r->id,
                    'email'        => $r->email,
                    'name'         => $r->contact
                        ? trim($r->contact->first_name . ' ' . $r->contact->last_name) ?: null
                        : null,
                    'status'       => $r->status,
                    'sent_at'      => $r->sent_at,
                    'failed_at'    => $r->failed_at,
                    'suppressed_at'=> $r->suppressed_at,
                    'opens'        => $opens,
                    'clicks'       => $clicks,
                ];
            });

        $totals = [
            'sent'       => CampaignRecipient::where('campaign_id', $campaign->id)->where('status', 'sent')->count(),
            'failed'     => CampaignRecipient::where('campaign_id', $campaign->id)->where('status', 'failed')->count(),
            'suppressed' => CampaignRecipient::where('campaign_id', $campaign->id)->where('status', 'suppressed')->count(),
            'bounced'    => CampaignRecipient::where('campaign_id', $campaign->id)->where('status', 'bounced')->count(),
        ];

        return Inertia::render('Campaigns/Report', [
            'campaign'   => $campaign,
            'recipients' => $recipients,
            'totals'     => $totals,
            'filters'    => $request->only('status', 'search'),
        ]);
    }
}
