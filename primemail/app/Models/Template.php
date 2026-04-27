<?php

namespace App\Models;

use App\Exceptions\MjmlCompilationException;
use App\Services\MjmlCompiler;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Template extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'brand_id', 'name', 'description',
        'mjml_source', 'compiled_html', 'content_text', 'builder_data',
        'compiled_at', 'compile_error',
        'thumbnail_path', 'is_shared', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'is_shared'    => 'boolean',
            'compiled_at'  => 'datetime',
            'builder_data' => 'array',
        ];
    }

    protected static function booted(): void
    {
        // Scope customizado: templates partilhados (brand_id=null, is_shared=true)
        // são visíveis a qualquer marca ativa. BrandScope genérico não serve.
        static::addGlobalScope(function ($builder) {
            if ($brandId = session('active_brand_id')) {
                $builder->where(function ($q) use ($brandId) {
                    $q->where('brand_id', $brandId)
                      ->orWhere('is_shared', true);
                });
            }
        });

        // Compila MJML automaticamente sempre que mjml_source mudar
        static::saving(function (Template $template) {
            if ($template->isDirty('mjml_source') && !empty($template->mjml_source)) {
                try {
                    $compiler = app(MjmlCompiler::class);
                    $template->compiled_html = $compiler->compile($template->mjml_source);
                    $template->compiled_at   = now();
                    $template->compile_error = null;
                } catch (MjmlCompilationException $e) {
                    // Não impede o save — guarda o erro para o editor mostrar
                    $template->compile_error = $e->getMessage();
                    $template->compiled_html = null;
                    $template->compiled_at   = null;
                }
            }
        });
    }

    public function brand(): BelongsTo   { return $this->belongsTo(Brand::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }

    public function hasCompiledSuccessfully(): bool
    {
        return $this->compiled_at !== null && $this->compile_error === null;
    }
}
