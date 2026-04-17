<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\ContactList;
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

    public function edit(ContactList $list): Response
    {
        return Inertia::render('Lists/Edit', compact('list'));
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
