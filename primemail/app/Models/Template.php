<?php

namespace App\Models;

use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Template extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'brand_id', 'name', 'description', 'content_html',
        'content_text', 'thumbnail_path', 'is_shared', 'created_by',
    ];

    protected function casts(): array
    {
        return ['is_shared' => 'boolean'];
    }

    protected static function booted(): void
    {
        // Templates partilhados (brand_id = null) são acessíveis a todas as marcas
        // BrandScope só aplica se brand_id estiver preenchido
        static::addGlobalScope(function ($builder) {
            if ($brandId = session('active_brand_id')) {
                $builder->where(function ($q) use ($brandId) {
                    $q->where('brand_id', $brandId)
                      ->orWhere('is_shared', true);
                });
            }
        });
    }

    public function brand(): BelongsTo   { return $this->belongsTo(Brand::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
}
