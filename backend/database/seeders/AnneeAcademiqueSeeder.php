<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\AnneeAcademique;

class AnneeAcademiqueSeeder extends Seeder
{
    public function run(): void
    {
        AnneeAcademique::firstOrCreate(
            ['libelle' => '2025-2026'],
            ['date_debut' => '2025-10-01', 'date_fin' => '2026-06-30', 'actif' => true]
        );
    }
}
