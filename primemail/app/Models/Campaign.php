<?php

namespace App\Models;

use App\Enums\CampaignStatus;
use App\Scopes\BrandScope;
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
        'content_html', 'content_text', 'template_id',
        'status', 'scheduled_at', 'sent_at',
        'estimated_recipients', 'actual_recipients', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'status'       => CampaignStatus::class,
            'scheduled_at' => 'datetime',
            'sent_at'      => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
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
        return $this->status->canBeSent();
    }

    public function scopeDraft($query)     { return $query->where('status', CampaignStatus::Draft); }
    public function scopeScheduled($query) { return $query->where('status', CampaignStatus::Scheduled); }
    public function scopeSent($query)      { return $query->where('status', CampaignStatus::Sent); }
}
