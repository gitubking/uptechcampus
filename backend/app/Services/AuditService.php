<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Support\Facades\Auth;
use Illuminate\Http\Request;

class AuditService
{
    public static function log(
        string $action,
        ?string $modele = null,
        ?int $modeleId = null,
        ?array $avant = null,
        ?array $apres = null,
        ?Request $request = null
    ): void {
        AuditLog::create([
            'user_id'      => Auth::id(),
            'action'       => $action,
            'modele'       => $modele,
            'modele_id'    => $modeleId,
            'donnees_avant' => $avant,
            'donnees_apres' => $apres,
            'ip_address'   => $request?->ip(),
            'user_agent'   => $request?->userAgent(),
        ]);
    }
}
