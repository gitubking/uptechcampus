<?php

namespace App\Services;

use App\Models\Intervenant;

class NumeroContratService
{
    public static function generate(int $annee): string
    {
        $prefix = "CONT-{$annee}-";
        $last = Intervenant::where('numero_contrat', 'like', $prefix . '%')
            ->orderBy('numero_contrat', 'desc')
            ->first();

        $next = 1;
        if ($last) {
            $parts = explode('-', $last->numero_contrat);
            $next = (int) end($parts) + 1;
        }

        return $prefix . str_pad($next, 5, '0', STR_PAD_LEFT);
    }
}
