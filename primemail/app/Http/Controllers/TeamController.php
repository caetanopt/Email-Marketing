<?php

namespace App\Http\Controllers;

use App\Models\Brand;
use App\Models\Role;
use App\Models\User;
use App\Models\UserBrandRole;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class TeamController extends Controller
{
    public function index(): Response
    {
        $brandId = session('active_brand_id');

        $members = UserBrandRole::with(['user', 'role', 'granter'])
            ->where('brand_id', $brandId)
            ->whereNull('revoked_at')
            ->orderBy('granted_at')
            ->get()
            ->map(fn ($ubr) => [
                'id'         => $ubr->id,
                'user_id'    => $ubr->user_id,
                'name'       => $ubr->user->name,
                'email'      => $ubr->user->email,
                'role'       => $ubr->role->name,
                'role_label' => $ubr->role->label ?? ucfirst($ubr->role->name),
                'granted_at' => $ubr->granted_at,
                'granted_by' => $ubr->granter?->name,
                'is_self'    => $ubr->user_id === auth()->id(),
            ]);

        $roles = Role::whereNotIn('name', ['super_admin'])->get(['id', 'name']);

        return Inertia::render('Team/Index', [
            'members' => $members,
            'roles'   => $roles,
        ]);
    }

    public function invite(Request $request): RedirectResponse
    {
        $brandId = session('active_brand_id');

        $data = $request->validate([
            'email'   => 'required|email|max:320',
            'role_id' => 'required|exists:roles,id',
        ]);

        $user = User::where('email', $data['email'])->first();

        if (!$user) {
            return back()->withErrors(['email' => 'Utilizador não encontrado. O utilizador deve criar conta primeiro.']);
        }

        // Prevent duplicate active role
        $existing = UserBrandRole::where('user_id', $user->id)
            ->where('brand_id', $brandId)
            ->whereNull('revoked_at')
            ->first();

        if ($existing) {
            return back()->withErrors(['email' => 'Este utilizador já tem acesso a esta marca.']);
        }

        UserBrandRole::create([
            'user_id'    => $user->id,
            'brand_id'   => $brandId,
            'role_id'    => $data['role_id'],
            'granted_by' => auth()->id(),
            'granted_at' => now(),
        ]);

        return back()->with('success', "{$user->name} adicionado à marca com sucesso.");
    }

    public function remove(UserBrandRole $member): RedirectResponse
    {
        $brandId = session('active_brand_id');

        abort_if($member->brand_id !== $brandId, 403);
        abort_if($member->user_id  === auth()->id(), 403, 'Não podes remover o teu próprio acesso.');

        $member->update(['revoked_at' => now()]);

        return back()->with('success', 'Acesso revogado.');
    }

    public function updateRole(Request $request, UserBrandRole $member): RedirectResponse
    {
        $brandId = session('active_brand_id');
        abort_if($member->brand_id !== $brandId, 403);
        abort_if($member->user_id  === auth()->id(), 403, 'Não podes alterar o teu próprio papel.');

        $data = $request->validate(['role_id' => 'required|exists:roles,id']);
        $member->update(['role_id' => $data['role_id']]);

        return back()->with('success', 'Papel actualizado.');
    }
}
