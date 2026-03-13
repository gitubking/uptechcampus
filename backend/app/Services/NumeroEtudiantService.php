<?php

namespace App\Services;

use App\Models\Etudiant;

class NumeroEtudiantService
{
    public static function generate(int $annee): string
    {
        $prefix = "UPTECH-{$annee}-";
        $last = Etudiant::where('numero_etudiant', 'like', $prefix . '%')
            ->orderBy('numero_etudiant', 'desc')
            ->first();

        $next = 1;
        if ($last) {
            $parts = explode('-', $last->numero_etudiant);
            $next = (int) end($parts) + 1;
        }

        return $prefix . str_pad($next, 3, '0', STR_PAD_LEFT);
    }
}
