<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserBrandRole extends Model
{
    protected $fillable = [
        'user_id', 'brand_id', 'role_id', 'granted_by', 'granted_at', 'revoked_at',
    ];

    protected function casts(): array
    {
        return [
            'granted_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo   { return $this->belongsTo(User::class); }
    public function brand(): BelongsTo  { return $this->belongsTo(Brand::class); }
    public function role(): BelongsTo   { return $this->belongsTo(Role::class); }
    public function granter(): BelongsTo { return $this->belongsTo(User::class, 'granted_by'); }

    public function isActive(): bool
    {
        return $this->revoked_at === null;
    }

    public function scopeActive($query)
    {
        return $query->whereNull('revoked_at');
    }
}
