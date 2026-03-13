<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

class UserSeeder extends Seeder
{
    public function run(): void
    {
        $users = [
            ['nom' => 'DIRECTEUR',  'prenom' => 'General',   'email' => 'dg@uptechformation.com',           'role' => 'dg',          'telephone' => '+221 77 841 50 44', 'premier_connexion' => false, 'cgu_acceptees' => true],
            ['nom' => 'DIOP',       'prenom' => 'Aminata',   'email' => 'dir.peda@uptechformation.com',     'role' => 'dir_peda',    'telephone' => '+221 77 000 00 02', 'premier_connexion' => true,  'cgu_acceptees' => false],
            ['nom' => 'FALL',       'prenom' => 'Ibrahima',  'email' => 'resp.fin@uptechformation.com',     'role' => 'resp_fin',    'telephone' => '+221 77 000 00 03', 'premier_connexion' => true,  'cgu_acceptees' => false],
            ['nom' => 'NDIAYE',     'prenom' => 'Fatou',     'email' => 'coordinateur@uptechformation.com', 'role' => 'coordinateur','telephone' => '+221 77 000 00 04', 'premier_connexion' => true,  'cgu_acceptees' => false],
            ['nom' => 'SARR',       'prenom' => 'Moussa',    'email' => 'secretariat@uptechformation.com',  'role' => 'secretariat', 'telephone' => '+221 77 000 00 05', 'premier_connexion' => true,  'cgu_acceptees' => false],
        ];

        foreach ($users as $userData) {
            User::firstOrCreate(
                ['email' => $userData['email']],
                array_merge($userData, ['password' => Hash::make('Uptech@2026'), 'statut' => 'actif'])
            );
        }
    }
}
