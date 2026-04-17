<?php

namespace App\Models;

use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable implements MustVerifyEmail
{
    use HasFactory, Notifiable, SoftDeletes;

    protected $fillable = [
        'name', 'email', 'password', 'avatar_path',
        'status', 'last_login_at', 'last_login_ip', 'active_brand_id',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at'     => 'datetime',
            'password'          => 'hashed',
        ];
    }

    // ── Relações ──────────────────────────────────────────────────────────

    public function activeBrand(): BelongsTo
    {
        return $this->belongsTo(Brand::class, 'active_brand_id');
    }

    public function brandRoles(): HasMany
    {
        return $this->hasMany(UserBrandRole::class);
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class);
    }

    // ── Permissões por Marca ─────────────────────────────────────────────

    public function brandsWithAccess()
    {
        return Brand::whereHas('userRoles', fn($q) =>
            $q->where('user_id', $this->id)->whereNull('revoked_at')
        );
    }

    /**
     * Alias explícito usado no fluxo de autenticação / brand selector.
     * Retorna query pronta a usar para ->get() ou ->count().
     */
    public function activeBrands()
    {
        return $this->brandsWithAccess()->orderBy('name');
    }

    public function hasAccessToBrand(int $brandId): bool
    {
        return $this->brandRoles()
            ->where('brand_id', $brandId)
            ->whereNull('revoked_at')
            ->exists();
    }

    public function getRoleForBrand(int $brandId): ?string
    {
        return $this->brandRoles()
            ->where('brand_id', $brandId)
            ->whereNull('revoked_at')
            ->with('role')
            ->first()
            ?->role
            ?->name;
    }

    public function hasPermissionForBrand(string $permission, int $brandId): bool
    {
        $role = $this->getRoleForBrand($brandId);
        if (!$role) return false;

        return Role::where('name', $role)
            ->whereHas('permissions', fn($q) => $q->where('name', $permission))
            ->exists();
    }

    public function isSuperAdmin(): bool
    {
        return $this->brandRoles()
            ->whereHas('role', fn($q) => $q->where('name', 'super_admin'))
            ->whereNull('revoked_at')
            ->exists();
    }

    public function isGroupAdmin(): bool
    {
        return $this->brandRoles()
            ->whereHas('role', fn($q) => $q->whereIn('name', ['super_admin', 'group_admin']))
            ->whereNull('revoked_at')
            ->exists();
    }
}
