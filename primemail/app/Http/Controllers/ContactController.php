<?php

namespace App\Http\Controllers;

use App\Actions\Contacts\CreateContactAction;
use App\Actions\Contacts\UpdateContactAction;
use App\DataTransferObjects\ContactData;
use App\Http\Requests\StoreContactRequest;
use App\Http\Requests\UpdateContactRequest;
use App\Models\AuditLog;
use App\Models\Contact;
use App\Models\ContactBrandRelation;
use App\Models\ContactList;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ContactController extends Controller
{
    public function index(Request $request): Response
    {
        $brandId = session('active_brand_id');

        // Só mostra contactos que têm relação com a marca activa
        $contacts = Contact::whereHas(
            'brandRelations',
            fn ($q) => $q->where('brand_id', $brandId)->where('status', 'active')
        )
        ->when($request->search, fn ($q, $s) =>
            $q->where(fn ($q2) => $q2
                ->where('email', 'like', "%{$s}%")
                ->orWhere('first_name', 'like', "%{$s}%")
                ->orWhere('last_name', 'like', "%{$s}%")
                ->orWhere('company', 'like', "%{$s}%")
            )
        )
        ->when($request->list_id, fn ($q, $listId) =>
            $q->whereHas('listMemberships', fn ($q2) =>
                $q2->where('list_id', $listId)->where('status', 'active')
            )
        )
        ->select('id', 'email', 'first_name', 'last_name', 'phone', 'company', 'created_at')
        ->latest()
        ->paginate(50)
        ->withQueryString();

        $lists = ContactList::select('id', 'name')->orderBy('name')->get();

        return Inertia::render('Contacts/Index', [
            'contacts' => $contacts,
            'lists'    => $lists,
            'filters'  => $request->only('search', 'list_id'),
        ]);
    }

    public function create(): Response
    {
        $lists = ContactList::select('id', 'name')->orderBy('name')->get();

        return Inertia::render('Contacts/Create', compact('lists'));
    }

    public function store(StoreContactRequest $request, CreateContactAction $action): RedirectResponse
    {
        $contact = $action->execute(
            ContactData::fromArray($request->validated()),
            session('active_brand_id')
        );

        // Adicionar às listas seleccionadas
        $brandId = session('active_brand_id');
        if ($listIds = $request->validated()['list_ids'] ?? []) {
            foreach ($listIds as $listId) {
                \App\Models\ContactListMember::firstOrCreate([
                    'contact_id' => $contact->id,
                    'list_id'    => $listId,
                ], ['brand_id' => $brandId, 'status' => 'active', 'subscribed_at' => now()]);
            }
        }

        return redirect()->route('contacts.index')
            ->with('success', 'Contacto criado com sucesso.');
    }

    public function show(Contact $contact): Response
    {
        $brandId = session('active_brand_id');

        $contact->load([
            'brandRelations' => fn ($q) => $q->where('brand_id', $brandId),
            'listMemberships.list',
        ]);

        $stats = [
            'emails_sent'    => $contact->emailEvents()->where('event_type', 'delivered')->count(),
            'emails_opened'  => $contact->emailEvents()->where('event_type', 'open')->count(),
            'emails_clicked' => $contact->emailEvents()->where('event_type', 'click')->count(),
        ];

        $events = $contact->emailEvents()
            ->with('campaign:id,name')
            ->whereIn('event_type', ['open', 'click', 'bounce', 'unsubscribe', 'spam', 'delivered'])
            ->orderByDesc('occurred_at')
            ->limit(50)
            ->get(['id', 'campaign_id', 'event_type', 'event_data', 'occurred_at']);

        return Inertia::render('Contacts/Show', compact('contact', 'stats', 'events'));
    }

    public function edit(Contact $contact): Response
    {
        $brandId  = session('active_brand_id');
        $relation = ContactBrandRelation::where('contact_id', $contact->id)
            ->where('brand_id', $brandId)
            ->first();

        return Inertia::render('Contacts/Edit', [
            'contact'  => $contact,
            'relation' => $relation,
        ]);
    }

    public function update(UpdateContactRequest $request, Contact $contact, UpdateContactAction $action): RedirectResponse
    {
        $action->execute(
            $contact,
            ContactData::fromArray($request->validated()),
            session('active_brand_id')
        );

        return redirect()->route('contacts.show', $contact)
            ->with('success', 'Contacto actualizado.');
    }

    /**
     * Erase GDPR — anonimiza dados pessoais mas mantém email_hash para supressão.
     */
    public function destroy(Contact $contact): RedirectResponse
    {
        $brandId = session('active_brand_id');

        // Desactiva relação com a marca (não apaga o contacto global)
        ContactBrandRelation::where('contact_id', $contact->id)
            ->where('brand_id', $brandId)
            ->update(['status' => 'removed', 'consent_given' => false]);

        AuditLog::record(
            action:     'contact.removed_from_brand',
            brandId:    $brandId,
            entityType: 'contact',
            entityId:   $contact->id,
        );

        return redirect()->route('contacts.index')
            ->with('success', 'Contacto removido desta marca.');
    }
}
