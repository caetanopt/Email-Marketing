<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

class AuditLog extends Model
{
    // Audit logs são imutáveis — apenas INSERT, nunca UPDATE
    const UPDATED_AT = null;

    protected $fillable = [
        'user_id', 'brand_id', 'action', 'entity_type',
        'entity_id', 'old_values', 'new_values',
        'ip_address', 'user_agent',
    ];

    protected function casts(): array
    {
        return [
            'old_values' => 'array',
            'new_values' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo  { return $this->belongsTo(User::class); }
    public function brand(): BelongsTo { return $this->belongsTo(Brand::class); }

    // Impede atualização de registos de auditoria
    public function save(array $options = []): bool
    {
        if ($this->exists) {
            throw new RuntimeException('Audit logs são imutáveis e não podem ser alterados.');
        }
        return parent::save($options);
    }

    // Helper estático para criar logs facilmente
    public static function record(
        string $action,
        ?int   $userId    = null,
        ?int   $brandId   = null,
        array  $newValues = [],
        array  $oldValues = [],
        ?string $entityType = null,
        ?int   $entityId  = null,
    ): self {
        return static::create([
            'user_id'     => $userId  ?? auth()->id(),
            'brand_id'    => $brandId ?? session('active_brand_id'),
            'action'      => $action,
            'entity_type' => $entityType,
            'entity_id'   => $entityId,
            'old_values'  => $oldValues ?: null,
            'new_values'  => $newValues ?: null,
            'ip_address'  => request()->ip(),
            'user_agent'  => request()->userAgent(),
        ]);
    }
}
