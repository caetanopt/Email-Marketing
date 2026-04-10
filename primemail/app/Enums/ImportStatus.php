<?php

namespace App\Enums;

enum ImportStatus: string
{
    case Pending        = 'pending';
    case AwaitingMapping = 'awaiting_mapping';
    case Processing     = 'processing';
    case Completed      = 'completed';
    case Failed         = 'failed';
    case Cancelled      = 'cancelled';

    public function isTerminal(): bool
    {
        return in_array($this, [self::Completed, self::Failed, self::Cancelled]);
    }
}
