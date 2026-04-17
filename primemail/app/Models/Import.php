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
        'brand_id', 'list_id', 'user_id', 'created_by',
        'file_name', 'filename', 'file_path', 'file_size', 'file_type',
        'column_mapping', 'headers', 'status',
        'total_rows', 'processed_rows',
        'imported_count', 'updated_count', 'skipped_count', 'error_count', 'failed_count',
        'error_file_path', 'started_at', 'completed_at', 'finished_at', 'error_message',
    ];

    protected function casts(): array
    {
        return [
            'column_mapping' => 'array',
            'headers'        => 'array',
            'status'         => ImportStatus::class,
            'started_at'     => 'datetime',
            'completed_at'   => 'datetime',
            'finished_at'    => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new BrandScope());
    }

    public function brand(): BelongsTo   { return $this->belongsTo(Brand::class); }
    public function list(): BelongsTo    { return $this->belongsTo(ContactList::class, 'list_id'); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'user_id'); }

    public function getProgressPercentageAttribute(): int
    {
        $total = $this->total_rows;
        if (!$total) return 0;
        $done = ($this->imported_count ?? 0) + ($this->skipped_count ?? 0) + ($this->error_count ?? $this->failed_count ?? 0);
        return (int) min(100, round(($done / $total) * 100));
    }
}
