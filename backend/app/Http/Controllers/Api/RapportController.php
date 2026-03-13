<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Depense;
use App\Models\Inscription;
use App\Models\Intervenant;
use App\Models\Paiement;
use App\Models\Seance;
use App\Models\UniteEnseignement;
use App\Models\Note;
use App\Models\Presence;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class RapportController extends Controller
{
    public function index(): JsonResponse
    {
        $now   = Carbon::now();
        $annee = $now->year;

        // ── FINANCIER ────────────────────────────────────────────────
        $encaisseAnnee = Paiement::where('statut', 'confirme')
            ->whereYear('created_at', $annee)->sum('montant');

        $depensesAnnee = Depense::whereIn('statut', ['validee', 'en_attente'])
            ->whereYear('date_depense', $annee)->sum('montant');

        $solde = $encaisseAnnee - $depensesAnnee;

        // Taux recouvrement : paiements mensualités confirmés / attendus (inscriptions actives × mensualité)
        $attendu = Inscription::whereIn('statut', ['inscrit_actif', 'inscrit'])
            ->whereYear('created_at', $annee)
            ->sum('mensualite');
        $recouvre = Paiement::where('statut', 'confirme')
            ->where('type_paiement', 'mensualite')
            ->whereYear('created_at', $annee)
            ->sum('montant');
        $tauxRecouvrement = $attendu > 0 ? round($recouvre / $attendu * 100, 1) : 0;

        // Évolution 6 derniers mois
        $evolution6mois = [];
        for ($i = 5; $i >= 0; $i--) {
            $mois = $now->copy()->subMonths($i);
            $evolution6mois[] = [
                'mois'     => $mois->format('M Y'),
                'recettes' => (float) Paiement::where('statut', 'confirme')
                    ->whereYear('created_at', $mois->year)
                    ->whereMonth('created_at', $mois->month)
                    ->sum('montant'),
                'depenses' => (float) Depense::whereIn('statut', ['validee'])
                    ->whereYear('date_depense', $mois->year)
                    ->whereMonth('date_depense', $mois->month)
                    ->sum('montant'),
            ];
        }

        // ── PÉDAGOGIQUE ──────────────────────────────────────────────
        $nbSeances = Seance::whereYear('date_debut', $annee)->count();
        $nbSeancesRealisees = Seance::whereYear('date_debut', $annee)
            ->whereIn('statut', ['confirme', 'planifie'])->count();

        $nbPresences = Presence::whereHas('seance', fn($q) => $q->whereYear('date_debut', $annee))->count();
        $nbAbsences  = Presence::where('statut', 'absent')
            ->whereHas('seance', fn($q) => $q->whereYear('date_debut', $annee))->count();
        $tauxPresence = $nbPresences > 0
            ? round(($nbPresences - $nbAbsences) / $nbPresences * 100, 1) : 0;

        $nbUes = UniteEnseignement::count();
        $nbEtudiantsNotes = Note::whereYear('created_at', $annee)
            ->distinct('inscription_id')->count('inscription_id');

        // ── RH ───────────────────────────────────────────────────────
        $intervenantsActifs = Intervenant::where('statut', 'actif')->count();

        // Volume horaire : sum(date_fin - date_debut) en heures
        $seancesHoraire = Seance::whereYear('date_debut', $annee)
            ->whereNotIn('statut', ['annule'])
            ->selectRaw('SUM(TIMESTAMPDIFF(MINUTE, date_debut, date_fin)) as minutes')
            ->value('minutes') ?? 0;
        $volumeHoraire = round($seancesHoraire / 60, 1);

        $repartitionMode = [];
        $modesSeances = Seance::whereYear('date_debut', $annee)
            ->whereNotIn('statut', ['annule'])
            ->select('mode', DB::raw('count(*) as total'))
            ->groupBy('mode')->get();
        $totalSeances = $modesSeances->sum('total') ?: 1;
        foreach ($modesSeances as $row) {
            $repartitionMode[$row->mode] = round($row->total / $totalSeances * 100, 1);
        }

        // ── ÉTUDIANTS ────────────────────────────────────────────────
        $parFiliere = DB::table('inscriptions')
            ->join('classes', 'inscriptions.classe_id', '=', 'classes.id')
            ->join('filieres', 'classes.filiere_id', '=', 'filieres.id')
            ->whereIn('inscriptions.statut', ['inscrit_actif', 'inscrit'])
            ->select('filieres.nom', DB::raw('count(*) as total'))
            ->groupBy('filieres.id', 'filieres.nom')
            ->get();
        $totalInscrits = $parFiliere->sum('total') ?: 1;
        $parFiliereData = $parFiliere->map(fn($r) => [
            'nom'   => $r->nom,
            'count' => $r->total,
            'pct'   => round($r->total / $totalInscrits * 100, 1),
        ])->values();

        $parStatut = DB::table('inscriptions')
            ->select('statut', DB::raw('count(*) as total'))
            ->groupBy('statut')->get();

        $evolutionInscriptions = [];
        for ($i = 5; $i >= 0; $i--) {
            $mois = $now->copy()->subMonths($i);
            $evolutionInscriptions[] = [
                'mois'  => $mois->format('M Y'),
                'count' => Inscription::whereYear('created_at', $mois->year)
                    ->whereMonth('created_at', $mois->month)->count(),
            ];
        }

        return response()->json([
            'financier' => [
                'encaisse_annee'    => (float) $encaisseAnnee,
                'depenses_annee'    => (float) $depensesAnnee,
                'solde'             => (float) $solde,
                'taux_recouvrement' => $tauxRecouvrement,
                'evolution_6_mois'  => $evolution6mois,
            ],
            'pedagogique' => [
                'nb_seances'          => $nbSeances,
                'nb_seances_realisees'=> $nbSeancesRealisees,
                'taux_presence'       => $tauxPresence,
                'nb_ues'              => $nbUes,
                'nb_etudiants_notes'  => $nbEtudiantsNotes,
            ],
            'rh' => [
                'intervenants_actifs' => $intervenantsActifs,
                'volume_horaire'      => $volumeHoraire,
                'repartition_mode'    => $repartitionMode,
            ],
            'etudiants' => [
                'par_filiere'               => $parFiliereData,
                'par_statut'                => $parStatut,
                'evolution_inscriptions'    => $evolutionInscriptions,
            ],
        ]);
    }
}
