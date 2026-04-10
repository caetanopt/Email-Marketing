<?php

namespace App\Models;

use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SuppressionList extends Model
{
    public $timestamps = false;
    protected $table   = 'suppression_list';

    protected $fillable = ['brand_id', 'email', 'email_hash', 'reason', 'added_at', 'added_by'];

    protected function casts(): array
    {
        return ['added_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());

        static::creating(function (SuppressionList $model) {
            $model->email      = strtolower(trim($model->email));
            $model->email_hash = hash('sha256', $model->email);
        });
    }

    public function brand(): BelongsTo  { return $this->belongsTo(Brand::class); }
    public function addedBy(): BelongsTo { return $this->belongsTo(User::class, 'added_by'); }

    public static function isSuppressed(string $email, int $brandId): bool
    {
        $hash = hash('sha256', strtolower(trim($email)));
        return static::withoutGlobalScope(BrandScope::class)
            ->where('brand_id', $brandId)
            ->where('email_hash', $hash)
            ->exists();
    }
}
