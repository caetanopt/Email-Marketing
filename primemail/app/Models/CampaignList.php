<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CampaignList extends Model
{
    public $timestamps = false;

    protected $fillable = ['campaign_id', 'list_id', 'segment_id', 'is_exclusion'];

    protected function casts(): array
    {
        return ['is_exclusion' => 'boolean'];
    }

    public function campaign(): BelongsTo { return $this->belongsTo(Campaign::class); }
    public function list(): BelongsTo     { return $this->belongsTo(ContactList::class, 'list_id'); }
}
