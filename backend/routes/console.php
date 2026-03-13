<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Blocage accès cours le 6 de chaque mois à 00h01
Schedule::command('inscriptions:check-access')->monthlyOn(6, '00:01');
