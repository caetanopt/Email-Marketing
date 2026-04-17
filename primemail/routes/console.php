<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('campaigns:dispatch-scheduled')->everyMinute()->withoutOverlapping();
