<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\Filiere;

class FiliereSeeder extends Seeder
{
    public function run(): void
    {
        $filieres = [
            ['nom' => 'Master Audiovisuel et Médias Numériques', 'code' => 'MAMN'],
            ['nom' => 'Journalisme et Multimédia', 'code' => 'JMM'],
            ['nom' => 'Infographie et Multimédia', 'code' => 'IMG'],
            ['nom' => 'Informatique de Gestion', 'code' => 'IG'],
            ['nom' => 'Maintenance, Administration Réseaux & Systèmes', 'code' => 'MARS'],
            ['nom' => 'Webmaster & Développement Mobile', 'code' => 'WDM'],
            ['nom' => 'Secrétariat & Assistanat de Direction', 'code' => 'SAD'],
        ];
        foreach ($filieres as $f) {
            Filiere::firstOrCreate(['code' => $f['code']], $f + ['actif' => true]);
        }
    }
}
