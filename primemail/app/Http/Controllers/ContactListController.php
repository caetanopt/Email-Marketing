<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Contact;
use App\Models\ContactList;
use App\Models\ContactListMember;
use App\Scopes\BrandScope;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ContactListController extends Controller
{
    public function index(): Response
    {
        $lists = ContactList::withCount([
            'members as active_count' => fn ($q) => $q->where('status', 'active'),
        ])
        ->orderBy('name')
        ->get();

        return Inertia::render('Lists/Index', compact('lists'));
    }

    public function create(): Response
    {
        return Inertia::render('Lists/Create');
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'name'        => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:1000'],
        ]);

        $list = ContactList::create([
            ...$data,
            'brand_id'   => session('active_brand_id'),
            'created_by' => auth()->id(),
        ]);

        AuditLog::record('list.created', entityType: 'contact_list', entityId: $list->id, newValues: ['name' => $list->name]);

        return redirect()->route('lists.index')->with('success', 'Lista criada.');
    }

    public function edit(ContactList $list, Request $request): Response
    {
        $search = $request->input('search');

        $members = ContactListMember::withoutGlobalScope(BrandScope::class)
            ->with('contact:id,first_name,last_name,email')
            ->where('list_id', $list->id)
            ->when($search, function ($q) use ($search) {
                $q->whereHas('contact', function ($q) use ($search) {
                    $q->where('email', 'like', "%{$search}%")
                      ->orWhere('first_name', 'like', "%{$search}%")
                      ->orWhere('last_name', 'like', "%{$search}%");
                });
            })
            ->latest()
            ->paginate(50)
            ->withQueryString();

        return Inertia::render('Lists/Edit', compact('list', 'members', 'search'));
    }

    public function removeMember(ContactList $list, Contact $contact): RedirectResponse
    {
        ContactListMember::withoutGlobalScope(BrandScope::class)
            ->where('list_id', $list->id)
            ->where('contact_id', $contact->id)
            ->delete();

        return back()->with('success', 'Contacto removido da lista.');
    }

    public function update(Request $request, ContactList $list): RedirectResponse
    {
        $data = $request->validate([
            'name'        => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:1000'],
        ]);

        $list->update($data);

        return redirect()->route('lists.index')->with('success', 'Lista actualizada.');
    }

    public function destroy(ContactList $list): RedirectResponse
    {
        AuditLog::record('list.deleted', entityType: 'contact_list', entityId: $list->id, oldValues: ['name' => $list->name]);
        $list->delete();

        return redirect()->route('lists.index')->with('success', 'Lista eliminada.');
    }
}
