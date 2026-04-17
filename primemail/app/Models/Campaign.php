<?php

namespace App\Models;

use App\Enums\CampaignStatus;
use App\Exceptions\MjmlCompilationException;
use App\Scopes\BrandScope;
use App\Services\MjmlCompiler;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Campaign extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = [
        'brand_id', 'name', 'subject', 'preview_text',
        'from_name', 'from_email', 'reply_to',
        'mjml_source', 'compiled_html', 'content_text',
        'compiled_at', 'compile_error', 'template_id',
        'status', 'scheduled_at', 'sent_at',
        'estimated_recipients', 'actual_recipients', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'status'       => CampaignStatus::class,
            'scheduled_at' => 'datetime',
            'sent_at'      => 'datetime',
            'compiled_at'  => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());

        // Auto-compile MJML enquanto a campanha está em draft.
        // Depois de iniciado o envio (Sending/Sent) o compiled_html fica
        // congelado — snapshot imutável para reprodutibilidade e auditoria.
        static::saving(function (Campaign $campaign) {
            if (!$campaign->isDirty('mjml_source')) {
                return;
            }

            // Congelado se já estiver em envio ou terminado
            $frozen = in_array($campaign->status, [
                CampaignStatus::Sending,
                CampaignStatus::Sent,
                CampaignStatus::Cancelled,
                CampaignStatus::Failed,
            ], strict: true);

            if ($frozen) {
                // Ignora silenciosamente a alteração de mjml_source
                $campaign->mjml_source = $campaign->getOriginal('mjml_source');
                return;
            }

            if (empty($campaign->mjml_source)) {
                return;
            }

            try {
                $compiler = app(MjmlCompiler::class);
                $campaign->compiled_html = $compiler->compile($campaign->mjml_source);
                $campaign->compiled_at   = now();
                $campaign->compile_error = null;
            } catch (MjmlCompilationException $e) {
                $campaign->compile_error = $e->getMessage();
                $campaign->compiled_html = null;
                $campaign->compiled_at   = null;
            }
        });
    }

    public function brand(): BelongsTo    { return $this->belongsTo(Brand::class); }
    public function creator(): BelongsTo  { return $this->belongsTo(User::class, 'created_by'); }
    public function template(): BelongsTo { return $this->belongsTo(Template::class); }

    public function campaignLists(): HasMany
    {
        return $this->hasMany(CampaignList::class);
    }

    public function recipients(): HasMany
    {
        return $this->hasMany(CampaignRecipient::class);
    }

    public function emailEvents(): HasMany
    {
        return $this->hasMany(EmailEvent::class);
    }

    public function canBeSent(): bool
    {
        return $this->status->canBeSent()
            && $this->compiled_html !== null
            && $this->compile_error === null;
    }

    public function scopeDraft($query)     { return $query->where('status', CampaignStatus::Draft); }
    public function scopeScheduled($query) { return $query->where('status', CampaignStatus::Scheduled); }
    public function scopeSent($query)      { return $query->where('status', CampaignStatus::Sent); }
}
