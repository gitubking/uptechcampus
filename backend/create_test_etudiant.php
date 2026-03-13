<?php
/**
 * Script temporaire : crée un compte étudiant de test complet
 * Exécuter avec : php artisan tinker < create_test_etudiant.php
 * ou : php create_test_etudiant.php (depuis le dossier backend avec bootstrap/app chargé)
 */

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

// 1. TypeFormation
$tfId = DB::table('types_formation')->insertGetId([
    'nom'        => 'Formation Initiale',
    'code'       => 'FI',
    'actif'      => 1,
    'created_at' => now(),
    'updated_at' => now(),
]);
echo "TypeFormation créé : id=$tfId\n";

// 2. Parcours
$parcoursId = DB::table('parcours')->insertGetId([
    'nom'                => 'Licence Informatique - L1',
    'code'               => 'LIC-INFO-L1',
    'type_formation_id'  => $tfId,
    'niveau_entree'      => 'Bac',
    'diplome_vise'       => 'Licence',
    'actif'              => 1,
    'created_at'         => now(),
    'updated_at'         => now(),
]);
echo "Parcours créé : id=$parcoursId\n";

// 3. Classe (filiere_id=1, annee_academique_id=1, created_by=1)
$classeId = DB::table('classes')->insertGetId([
    'nom'                  => 'L1 Info 2025-2026',
    'filiere_id'           => 1,
    'annee_academique_id'  => 1,
    'est_tronc_commun'     => 0,
    'created_by'           => 1,
    'created_at'           => now(),
    'updated_at'           => now(),
]);
echo "Classe créée : id=$classeId\n";

// Lier parcours à classe dans classes_parcours (si la table existe)
$tables = DB::select("SHOW TABLES LIKE 'classes_parcours'");
if (!empty($tables)) {
    DB::table('classes_parcours')->insert([
        'classe_id'   => $classeId,
        'parcours_id' => $parcoursId,
    ]);
    echo "Liaison classe-parcours créée\n";
}

// 4. User étudiant
$userId = DB::table('users')->insertGetId([
    'nom'           => 'FALL',
    'prenom'        => 'Mariama',
    'email'         => 'etudiant@uptechformation.com',
    'password'      => Hash::make('Uptech@2026'),
    'role'          => 'etudiant',
    'statut'        => 'actif',
    'created_at'    => now(),
    'updated_at'    => now(),
]);
echo "User étudiant créé : id=$userId, email=etudiant@uptechformation.com\n";

// 5. Etudiant
$etudiantId = DB::table('etudiants')->insertGetId([
    'numero_etudiant' => 'ETU-2025-001',
    'user_id'         => $userId,
    'nom'             => 'FALL',
    'prenom'          => 'Mariama',
    'email'           => 'etudiant@uptechformation.com',
    'telephone'       => '771234567',
    'created_at'      => now(),
    'updated_at'      => now(),
]);
echo "Etudiant créé : id=$etudiantId\n";

// Mettre à jour le user avec etudiant_id si la colonne existe
$cols = DB::select("SHOW COLUMNS FROM users LIKE 'etudiant_id'");
if (!empty($cols)) {
    DB::table('users')->where('id', $userId)->update(['etudiant_id' => $etudiantId]);
    echo "User mis à jour avec etudiant_id\n";
}

// 6. Inscription active
$inscriptionId = DB::table('inscriptions')->insertGetId([
    'etudiant_id'         => $etudiantId,
    'classe_id'           => $classeId,
    'parcours_id'         => $parcoursId,
    'annee_academique_id' => 1,
    'statut'              => 'inscrit_actif',
    'frais_inscription'   => 150000,
    'mensualite'          => 50000,
    'created_by'          => 1,
    'created_at'          => now(),
    'updated_at'          => now(),
]);
echo "Inscription créée : id=$inscriptionId\n";

// 7. Quelques UEs pour la classe
$ues = [
    ['classe_id' => $classeId, 'code' => 'INFO101', 'intitule' => 'Algorithmique', 'coefficient' => 3, 'credits_ects' => 6, 'ordre' => 1],
    ['classe_id' => $classeId, 'code' => 'INFO102', 'intitule' => 'Programmation C', 'coefficient' => 3, 'credits_ects' => 6, 'ordre' => 2],
    ['classe_id' => $classeId, 'code' => 'MATH101', 'intitule' => 'Mathématiques', 'coefficient' => 2, 'credits_ects' => 4, 'ordre' => 3],
    ['classe_id' => $classeId, 'code' => 'ANG101',  'intitule' => 'Anglais',        'coefficient' => 1, 'credits_ects' => 2, 'ordre' => 4],
];
foreach ($ues as &$ue) {
    $ue['created_at'] = now();
    $ue['updated_at'] = now();
}
DB::table('unites_enseignement')->insert($ues);
$ueIds = DB::table('unites_enseignement')->where('classe_id', $classeId)->pluck('id');
echo "UEs créées : " . $ueIds->count() . "\n";

// 8. Notes pour l'étudiant
$notesData = [14.5, 12.0, 16.0, 15.0];
foreach ($ueIds as $i => $ueId) {
    DB::table('notes')->insert([
        'inscription_id' => $inscriptionId,
        'ue_id'          => $ueId,
        'note'           => $notesData[$i] ?? 12.0,
        'session'        => 'normale',
        'created_by'     => 1,
        'created_at'     => now(),
        'updated_at'     => now(),
    ]);
}
echo "Notes créées\n";

// 9. Quelques séances cette semaine
$lundi = now()->startOfWeek(); // lundi
$seancesData = [
    ['matiere' => 'Algorithmique', 'date_debut' => $lundi->copy()->setHour(8)->setMinute(0), 'date_fin' => $lundi->copy()->setHour(10), 'mode' => 'presentiel', 'salle' => 'Salle A1'],
    ['matiere' => 'Programmation C', 'date_debut' => $lundi->copy()->addDay()->setHour(10), 'date_fin' => $lundi->copy()->addDay()->setHour(12), 'mode' => 'en_ligne', 'salle' => null],
    ['matiere' => 'Mathématiques', 'date_debut' => $lundi->copy()->addDays(2)->setHour(14), 'date_fin' => $lundi->copy()->addDays(2)->setHour(16), 'mode' => 'presentiel', 'salle' => 'Salle B2'],
];
foreach ($seancesData as $s) {
    DB::table('seances')->insert([
        'classe_id'           => $classeId,
        'matiere'             => $s['matiere'],
        'date_debut'          => $s['date_debut'],
        'date_fin'            => $s['date_fin'],
        'mode'                => $s['mode'],
        'salle'               => $s['salle'],
        'statut'              => 'confirme',
        'annee_academique_id' => 1,
        'created_by'          => 1,
        'created_at'          => now(),
        'updated_at'          => now(),
    ]);
}
echo "Séances créées\n";

// 10. Présences
$seanceIds = DB::table('seances')->where('classe_id', $classeId)->pluck('id');
$statutsPresence = ['present', 'present', 'retard'];
foreach ($seanceIds as $i => $seanceId) {
    DB::table('presences')->insert([
        'seance_id'      => $seanceId,
        'inscription_id' => $inscriptionId,
        'statut'         => $statutsPresence[$i] ?? 'present',
        'created_by'     => 1,
        'created_at'     => now(),
        'updated_at'     => now(),
    ]);
}
echo "Présences créées\n";

// 11. Paiements
$paiementsData = [
    ['type_paiement' => 'frais_inscription', 'montant' => 150000, 'mode_paiement' => 'virement', 'statut' => 'confirme', 'mois_concerne' => null],
    ['type_paiement' => 'mensualite', 'montant' => 50000, 'mode_paiement' => 'especes', 'statut' => 'confirme', 'mois_concerne' => '2025-10-01'],
    ['type_paiement' => 'mensualite', 'montant' => 50000, 'mode_paiement' => 'especes', 'statut' => 'confirme', 'mois_concerne' => '2025-11-01'],
];
foreach ($paiementsData as $idx => $p) {
    DB::table('paiements')->insert([
        'inscription_id'  => $inscriptionId,
        'numero_recu'     => 'REC-' . str_pad($idx + 1, 4, '0', STR_PAD_LEFT),
        'type_paiement'   => $p['type_paiement'],
        'montant'         => $p['montant'],
        'mode_paiement'   => $p['mode_paiement'],
        'statut'          => $p['statut'],
        'mois_concerne'   => $p['mois_concerne'],
        'created_by'      => 1,
        'created_at'      => now(),
        'updated_at'      => now(),
    ]);
}
echo "Paiements créés\n";

echo "\n=== DONE ===\n";
echo "Login étudiant : etudiant@uptechformation.com / Uptech@2026\n";
