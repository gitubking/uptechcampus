<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use App\Models\ParametreSysteme;

class ParametresSeeder extends Seeder
{
    public function run(): void
    {
        $params = [
            // Groupe : etablissement
            ['cle' => 'nom_etablissement',      'valeur' => 'Institut UPTECH Formation',            'groupe' => 'etablissement', 'description' => "Nom officiel de l'établissement"],
            ['cle' => 'abreviation',             'valeur' => 'UPTECH',                               'groupe' => 'etablissement', 'description' => 'Abréviation'],
            ['cle' => 'adresse',                 'valeur' => 'Amitié 1, Villa n°3031 — Dakar, Sénégal', 'groupe' => 'etablissement', 'description' => 'Adresse postale'],
            ['cle' => 'telephone',               'valeur' => '+221 77 841 50 44',                    'groupe' => 'etablissement', 'description' => 'Numéro de téléphone principal'],
            ['cle' => 'email_contact',           'valeur' => 'contact@uptechformation.com',          'groupe' => 'etablissement', 'description' => 'Email de contact'],
            ['cle' => 'site_web',                'valeur' => 'https://uptechformation.com',          'groupe' => 'etablissement', 'description' => 'Site web'],
            ['cle' => 'devise',                  'valeur' => 'XOF',                                  'groupe' => 'etablissement', 'description' => 'Devise utilisée'],
            ['cle' => 'fuseau_horaire',          'valeur' => 'Africa/Dakar',                         'groupe' => 'etablissement', 'description' => 'Fuseau horaire'],
            ['cle' => 'cgu_texte',               'valeur' => "En utilisant UPTECH Campus, vous acceptez de respecter le règlement intérieur de l'Institut UPTECH Formation. Toutes les informations personnelles collectées sont utilisées exclusivement dans le cadre de la gestion académique et financière de votre formation. Conformément à la loi sénégalaise sur la protection des données personnelles (CDP), vous disposez d'un droit d'accès, de rectification et de suppression de vos données sur demande officielle adressée à la Direction.", 'groupe' => 'etablissement', 'description' => 'Texte des CGU affiché à la première connexion'],

            // Groupe : academique
            ['cle' => 'seuil_validation_ue',     'valeur' => '10',  'groupe' => 'academique', 'description' => 'Moyenne minimale pour valider une UE (sur 20)'],
            ['cle' => 'seuil_mention_passable',  'valeur' => '10',  'groupe' => 'academique', 'description' => 'Seuil mention Passable'],
            ['cle' => 'seuil_mention_ab',        'valeur' => '12',  'groupe' => 'academique', 'description' => 'Seuil mention Assez Bien'],
            ['cle' => 'seuil_mention_bien',      'valeur' => '14',  'groupe' => 'academique', 'description' => 'Seuil mention Bien'],
            ['cle' => 'seuil_mention_tb',        'valeur' => '16',  'groupe' => 'academique', 'description' => 'Seuil mention Très Bien'],

            // Groupe : finance
            ['cle' => 'paiement_wave',           'valeur' => '1',   'groupe' => 'finance', 'description' => 'Accepter les paiements Wave'],
            ['cle' => 'paiement_orange_money',   'valeur' => '1',   'groupe' => 'finance', 'description' => 'Accepter les paiements Orange Money'],
            ['cle' => 'paiement_virement',       'valeur' => '1',   'groupe' => 'finance', 'description' => 'Accepter les virements bancaires'],
            ['cle' => 'paiement_especes',        'valeur' => '1',   'groupe' => 'finance', 'description' => 'Accepter les paiements en espèces'],
            ['cle' => 'paiement_cheque',         'valeur' => '0',   'groupe' => 'finance', 'description' => 'Accepter les chèques'],
            ['cle' => 'seuil_blocage_acces_jours','valeur' => '30', 'groupe' => 'finance', 'description' => "Jours de retard avant blocage accès (décision direction)"],
            ['cle' => 'seuil_depense_justificatif','valeur' => '50000', 'groupe' => 'finance', 'description' => 'Montant (FCFA) au-delà duquel un justificatif est obligatoire pour une dépense'],
            ['cle' => 'seuil_tresorerie_alerte', 'valeur' => '0',   'groupe' => 'finance', 'description' => 'Seuil de trésorerie (FCFA) déclenchant une alerte direction'],

            // Groupe : relances
            ['cle' => 'relance_j3',              'valeur' => '1',   'groupe' => 'relances', 'description' => 'Activer relance J+3 (SMS étudiant)'],
            ['cle' => 'relance_j7',              'valeur' => '1',   'groupe' => 'relances', 'description' => 'Activer relance J+7 (SMS + WhatsApp + Email)'],
            ['cle' => 'relance_j15',             'valeur' => '1',   'groupe' => 'relances', 'description' => 'Activer relance J+15 (notification secrétariat)'],
            ['cle' => 'relance_j30',             'valeur' => '1',   'groupe' => 'relances', 'description' => 'Activer relance J+30 (notification direction)'],
            ['cle' => 'message_relance_j3',      'valeur' => 'Bonjour {prenom}, nous vous rappelons que votre mensualité de {montant} FCFA pour le mois de {mois} est due. Merci de régulariser votre situation. — UPTECH Formation', 'groupe' => 'relances', 'description' => 'Modèle SMS relance J+3'],
            ['cle' => 'message_relance_j7',      'valeur' => 'URGENT — {prenom}, votre mensualité de {montant} FCFA est en retard de 7 jours. Veuillez contacter le secrétariat au plus vite. — UPTECH Formation', 'groupe' => 'relances', 'description' => 'Modèle SMS relance J+7'],

            // Groupe : notifications
            ['cle' => 'heure_debut_notifications','valeur' => '8',  'groupe' => 'notifications', 'description' => "Heure de début d'envoi des notifications (0-23)"],
            ['cle' => 'heure_fin_notifications', 'valeur' => '20',  'groupe' => 'notifications', 'description' => "Heure de fin d'envoi des notifications (0-23)"],
            ['cle' => 'notif_nouveau_paiement',  'valeur' => '1',   'groupe' => 'notifications', 'description' => 'Notifier à chaque nouveau paiement enregistré'],
            ['cle' => 'notif_impaye_j30',        'valeur' => '1',   'groupe' => 'notifications', 'description' => "Notifier la direction à J+30 d'impayé"],
            ['cle' => 'notif_bordereau_attente', 'valeur' => '1',   'groupe' => 'notifications', 'description' => 'Notifier quand un bordereau est en attente de validation'],
            ['cle' => 'notif_absence',           'valeur' => '1',   'groupe' => 'notifications', 'description' => 'Notifier automatiquement les absences via émargement'],
            ['cle' => 'notif_conflit_edt',       'valeur' => '1',   'groupe' => 'notifications', 'description' => "Notifier en cas de conflit d'emploi du temps"],
            ['cle' => 'seuil_absence_alerte',    'valeur' => '30',  'groupe' => 'notifications', 'description' => 'Pourcentage d\'absences déclenchant une alerte direction'],
            ['cle' => 'seuil_programme_retard',  'valeur' => '80',  'groupe' => 'notifications', 'description' => 'Pourcentage minimal de progression programme (en dessous = alerte)'],
        ];

        foreach ($params as $param) {
            ParametreSysteme::firstOrCreate(
                ['cle' => $param['cle']],
                [
                    'valeur'      => $param['valeur'],
                    'groupe'      => $param['groupe'],
                    'description' => $param['description'],
                ]
            );
        }
    }
}
