<?php

namespace App\Models;

use App\Enums\ImportStatus;
use App\Scopes\BrandScope;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Import extends Model
{
    use HasFactory;

    protected $fillable = [
        'brand_id', 'list_id', 'user_id', 'file_name', 'file_path',
        'file_size', 'file_type', 'column_mapping', 'headers', 'status',
        'total_rows', 'processed_rows', 'imported_count', 'updated_count',
        'skipped_count', 'error_count', 'error_file_path',
        'started_at', 'completed_at', 'error_message',
    ];

    protected function casts(): array
    {
        return [
            'column_mapping' => 'array',
            'headers'        => 'array',
            'status'         => ImportStatus::class,
            'started_at'     => 'datetime',
            'completed_at'   => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
    }

    public function brand(): BelongsTo { return $this->belongsTo(Brand::class); }
    public function list(): BelongsTo  { return $this->belongsTo(ContactList::class, 'list_id'); }
    public function user(): BelongsTo  { return $this->belongsTo(User::class); }

    public function getProgressPercentageAttribute(): int
    {
        if (!$this->total_rows || $this->total_rows === 0) return 0;
        return (int) round(($this->processed_rows / $this->total_rows) * 100);
    }

    public function isProcessing(): bool
    {
        return $this->status === ImportStatus::Processing;
    }

    public function isCompleted(): bool
    {
        return $this->status === ImportStatus::Completed;
    }
}
