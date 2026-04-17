<?php

use Illuminate\Support\Facades\Schedule;

// Dispatch scheduled campaigns every minute
Schedule::command('campaigns:dispatch-scheduled')->everyMinute()->withoutOverlapping();

// Horizon metrics snapshot (keeps 24 snapshots = last 24h of charts)
Schedule::command('horizon:snapshot')->everyFiveMinutes();
