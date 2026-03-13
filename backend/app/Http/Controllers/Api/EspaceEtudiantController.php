<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Annonce;
use App\Models\Note;
use App\Models\UniteEnseignement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

class EspaceEtudiantController extends Controller
{
    public function dashboard(Request $request): JsonResponse
    {
        $user = $request->user();

        // Récupérer l'étudiant lié
        $etudiant = $user->etudiant()->with([
            'inscriptionActive.classe.filiere',
            'inscriptionActive.anneeAcademique',
            'inscriptionActive.paiements',
        ])->first();

        if (! $etudiant || ! $etudiant->inscriptionActive) {
            return response()->json(['message' => 'Aucune inscription active'], 404);
        }

        $inscription = $etudiant->inscriptionActive;
        $classe = $inscription->classe;

        // ── Infos financières ──────────────────────────────────────────
        $fraisTotaux = $inscription->frais_inscription + ($inscription->mensualite_effective * 10);
        $totalPaye = $inscription->paiements
            ->where('statut', 'confirme')
            ->sum('montant');
        $restantDu = max(0, $fraisTotaux - $totalPaye);

        // ── Séances de la semaine ──────────────────────────────────────
        $debutSemaine = Carbon::now()->startOfWeek(); // lundi
        $finSemaine   = Carbon::now()->endOfWeek();   // dimanche

        $seancesSemaine = \App\Models\Seance::where('classe_id', $classe->id)
            ->whereBetween('date_debut', [$debutSemaine, $finSemaine])
            ->with('intervenant')
            ->orderBy('date_debut')
            ->get()
            ->map(fn($s) => [
                'id'           => $s->id,
                'matiere'      => $s->matiere,
                'date_debut'   => $s->date_debut,
                'date_fin'     => $s->date_fin,
                'mode'         => $s->mode,
                'salle'        => $s->salle,
                'lien_visio'   => $s->lien_visio,
                'statut'       => $s->statut,
                'intervenant'  => $s->intervenant ? $s->intervenant->nom . ' ' . $s->intervenant->prenom : null,
            ]);

        // ── Notes + moyennes ──────────────────────────────────────────
        $ues = UniteEnseignement::where('classe_id', $classe->id)
            ->orderBy('ordre')->orderBy('id')->get();

        $notes = Note::where('inscription_id', $inscription->id)
            ->where('session', 'normale')
            ->get()
            ->keyBy('ue_id');

        $totalPts   = 0;
        $totalCoeff = 0;
        $notesData  = [];

        foreach ($ues as $ue) {
            $note = $notes->get($ue->id);
            $notesData[] = [
                'ue_id'      => $ue->id,
                'intitule'   => $ue->intitule,
                'coefficient' => (float) $ue->coefficient,
                'note'       => $note ? (float) $note->note : null,
            ];
            if ($note) {
                $totalPts   += (float) $note->note * (float) $ue->coefficient;
                $totalCoeff += (float) $ue->coefficient;
            }
        }

        $moyenneGenerale = $totalCoeff > 0 ? round($totalPts / $totalCoeff, 2) : null;

        $mention = null;
        if ($moyenneGenerale !== null) {
            $mention = match (true) {
                $moyenneGenerale >= 16 => 'Très bien',
                $moyenneGenerale >= 14 => 'Bien',
                $moyenneGenerale >= 12 => 'Assez bien',
                $moyenneGenerale >= 10 => 'Passable',
                default                => 'Insuffisant',
            };
        }

        // Rang parmi les inscriptions de la même classe
        $rang = null;
        if ($moyenneGenerale !== null) {
            $autresInscriptions = \App\Models\Inscription::where('classe_id', $classe->id)
                ->where('id', '!=', $inscription->id)
                ->pluck('id');

            $moyennesAutres = $autresInscriptions->map(function ($inscId) use ($ues) {
                $notesAutre = Note::where('inscription_id', $inscId)->where('session', 'normale')->get()->keyBy('ue_id');
                $pts = 0; $coeff = 0;
                foreach ($ues as $ue) {
                    $n = $notesAutre->get($ue->id);
                    if ($n) { $pts += (float)$n->note * (float)$ue->coefficient; $coeff += (float)$ue->coefficient; }
                }
                return $coeff > 0 ? round($pts / $coeff, 2) : 0;
            })->filter(fn($m) => $m > 0)->sort()->reverse()->values();

            $rang = $moyennesAutres->search(fn($m) => $m <= $moyenneGenerale);
            $rang = $rang !== false ? $rang + 1 : 1;
        }

        // ── Présences ─────────────────────────────────────────────────
        $presencesAll = \App\Models\Presence::where('inscription_id', $inscription->id)->get();
        $totalPresences = $presencesAll->count();
        $nbPresent = $presencesAll->where('statut', 'present')->count();
        $nbRetard  = $presencesAll->where('statut', 'retard')->count();
        $nbAbsent  = $presencesAll->where('statut', 'absent')->count();
        $tauxPresence = $totalPresences > 0
            ? round(($nbPresent + $nbRetard) / $totalPresences * 100, 1)
            : 100;

        // ── Derniers paiements ────────────────────────────────────────
        $derniersPaiements = $inscription->paiements()
            ->latest()
            ->limit(5)
            ->get()
            ->map(fn($p) => [
                'id'              => $p->id,
                'numero_recu'     => $p->numero_recu,
                'type_paiement'   => $p->type_paiement,
                'mois_concerne'   => $p->mois_concerne,
                'montant'         => (float) $p->montant,
                'mode_paiement'   => $p->mode_paiement,
                'statut'          => $p->statut,
                'created_at'      => $p->created_at,
            ]);

        // ── Annonces ──────────────────────────────────────────────────
        $annonces = Annonce::where('statut', 'publie')
            ->orderByDesc('epingle')
            ->orderByDesc('publie_at')
            ->limit(5)
            ->get()
            ->map(fn($a) => [
                'id'        => $a->id,
                'titre'     => $a->titre,
                'type'      => $a->type,
                'contenu'   => substr($a->contenu, 0, 120),
                'epingle'   => $a->epingle,
                'publie_at' => $a->publie_at,
            ]);

        // ── Messages récents ──────────────────────────────────────────
        $userId = $user->id;
        $conversations = \App\Models\Conversation::whereHas('participants', fn($q) => $q->where('user_id', $userId))
            ->with([
                'participants',
                'messages' => fn($q) => $q->latest()->limit(1),
                'messages.sender',
            ])
            ->latest('updated_at')
            ->limit(3)
            ->get()
            ->map(function ($conv) use ($userId) {
                $pivot = $conv->participants->firstWhere('id', $userId)?->pivot;
                $dernierLuAt = $pivot?->dernier_lu_at;
                $nbNonLus = $dernierLuAt
                    ? $conv->messages()->where('created_at', '>', $dernierLuAt)->count()
                    : $conv->messages()->count();
                $dernierMessage = $conv->messages->first();
                return [
                    'id'              => $conv->id,
                    'nom'             => $conv->nom,
                    'couleur'         => $conv->couleur,
                    'type'            => $conv->type,
                    'dernier_message' => $dernierMessage?->contenu,
                    'nb_non_lus'      => $nbNonLus,
                ];
            });

        // ── Documents ─────────────────────────────────────────────────
        $documents = \App\Models\DocumentEtudiant::where('etudiant_id', $etudiant->id)
            ->latest()
            ->get()
            ->map(fn($d) => [
                'id'            => $d->id,
                'type_document' => $d->type_document,
                'nom_fichier'   => $d->nom_fichier,
                'taille_fichier' => $d->taille_fichier,
                'statut'        => $d->statut,
                'created_at'    => $d->created_at,
            ]);

        return response()->json([
            'etudiant' => [
                'nom'             => $etudiant->nom,
                'prenom'          => $etudiant->prenom,
                'numero_etudiant' => $etudiant->numero_etudiant,
            ],
            'inscription' => [
                'id'                  => $inscription->id,
                'filiere'             => $classe->filiere?->nom,
                'classe'              => $classe->nom,
                'annee_academique'    => $inscription->anneeAcademique?->libelle,
                'frais_totaux'        => $fraisTotaux,
                'total_paye'          => $totalPaye,
                'restant_du'          => $restantDu,
            ],
            'seances_semaine'    => $seancesSemaine,
            'notes' => [
                'ues'              => $notesData,
                'moyenne_generale' => $moyenneGenerale,
                'mention'          => $mention,
                'rang'             => $rang,
            ],
            'presences' => [
                'total'         => $totalPresences,
                'present'       => $nbPresent,
                'retard'        => $nbRetard,
                'absent'        => $nbAbsent,
                'taux_presence' => $tauxPresence,
            ],
            'paiements'  => $derniersPaiements,
            'annonces'   => $annonces,
            'messages'   => $conversations,
            'documents'  => $documents,
        ]);
    }
}
