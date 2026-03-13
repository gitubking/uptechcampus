<?php

namespace App\Console\Commands;

use App\Models\Inscription;
use App\Models\Paiement;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

class CheckInscriptionAccess extends Command
{
    protected $signature = 'inscriptions:check-access';
    protected $description = 'Bloque l\'accès aux cours des étudiants n\'ayant pas payé leur mensualité (exécuté le 6 de chaque mois)';

    public function handle(): void
    {
        $moisCourant = Carbon::now()->startOfMonth();
        $this->info("Vérification des accès pour le mois de {$moisCourant->format('F Y')}...");

        $inscriptions = Inscription::where('statut', 'inscrit_actif')->get();
        $bloquees = 0;
        $debloquees = 0;

        foreach ($inscriptions as $inscription) {
            // Vérifier si une mensualité confirmée existe pour ce mois
            $aPaye = Paiement::where('inscription_id', $inscription->id)
                ->where('type_paiement', 'mensualite')
                ->where('statut', 'confirme')
                ->whereYear('mois_concerne', $moisCourant->year)
                ->whereMonth('mois_concerne', $moisCourant->month)
                ->exists();

            if (!$aPaye && !$inscription->acces_bloque) {
                $inscription->update(['acces_bloque' => true]);
                $bloquees++;
            } elseif ($aPaye && $inscription->acces_bloque) {
                $inscription->update(['acces_bloque' => false]);
                $debloquees++;
            }
        }

        $this->info("Terminé : {$bloquees} bloqué(s), {$debloquees} débloqué(s).");
    }
}
