<?php

namespace App\Http\Controllers;

use App\Models\SuppressionList;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class SuppressionController extends Controller
{
    public function index(Request $request): Response
    {
        $suppressions = SuppressionList::select('id', 'email', 'reason', 'added_at')
            ->when($request->search, fn ($q, $s) => $q->where('email', 'like', "%{$s}%"))
            ->when($request->reason, fn ($q, $r) => $q->where('reason', $r))
            ->orderByDesc('added_at')
            ->paginate(50)
            ->withQueryString();

        return Inertia::render('Suppression/Index', [
            'suppressions' => $suppressions,
            'filters'      => $request->only('search', 'reason'),
            'reasons'      => ['unsubscribe', 'hard_bounce', 'spam_complaint', 'manual', 'import'],
        ]);
    }

    public function destroy(SuppressionList $suppression): RedirectResponse
    {
        $suppression->delete();

        return back()->with('success', 'Endereço removido da lista de supressão.');
    }
}
