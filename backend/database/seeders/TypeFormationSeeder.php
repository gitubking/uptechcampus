<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\TypeFormation;

class TypeFormationSeeder extends Seeder
{
    public function run(): void
    {
        $types = [
            ['nom' => 'Académique', 'code' => 'ACAD', 'diplome_vise' => 'DAP, DT/BT, DTS/BTS, Licence, Master', 'duree_description' => '9 mois / niveau', 'public_cible' => 'Tout public selon niveau'],
            ['nom' => 'Certifiée', 'code' => 'CERT', 'diplome_vise' => 'Certificat de Spécialisation', 'duree_description' => 'Variable', 'public_cible' => 'Tout public'],
            ['nom' => 'Accélérée', 'code' => 'ACCE', 'diplome_vise' => 'Attestation professionnelle', 'duree_description' => 'Variable', 'public_cible' => 'Tout public'],
        ];
        foreach ($types as $type) {
            TypeFormation::firstOrCreate(['code' => $type['code']], $type + ['actif' => true]);
        }
    }
}
