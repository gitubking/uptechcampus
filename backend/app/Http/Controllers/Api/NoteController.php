<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Inscription;
use App\Models\Note;
use App\Models\UniteEnseignement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NoteController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $classeId = $request->classe_id;
        $session  = $request->session ?? 'normale';

        $ues = UniteEnseignement::where('classe_id', $classeId)
            ->orderBy('ordre')->orderBy('id')
            ->get();

        $inscriptions = Inscription::where('classe_id', $classeId)
            ->whereIn('statut', ['inscrit_actif', 'inscrit'])
            ->with('etudiant')
            ->get();

        $notes = Note::whereIn('inscription_id', $inscriptions->pluck('id'))
            ->whereIn('ue_id', $ues->pluck('id'))
            ->where('session', $session)
            ->get();

        return response()->json([
            'ues'          => $ues,
            'inscriptions' => $inscriptions,
            'notes'        => $notes,
        ]);
    }

    public function batchUpsert(Request $request): JsonResponse
    {
        $request->validate([
            'notes'                  => 'required|array',
            'notes.*.inscription_id' => 'required|exists:inscriptions,id',
            'notes.*.ue_id'          => 'required|exists:unites_enseignement,id',
            'notes.*.note'           => 'required|numeric|min:0|max:20',
            'notes.*.session'        => 'required|in:normale,rattrapage',
        ]);

        $userId = $request->user()->id;
        $result = [];

        foreach ($request->notes as $item) {
            $note = Note::updateOrCreate(
                [
                    'inscription_id' => $item['inscription_id'],
                    'ue_id'          => $item['ue_id'],
                    'session'        => $item['session'],
                ],
                [
                    'note'       => $item['note'],
                    'created_by' => $userId,
                ]
            );
            $result[] = $note;
        }

        return response()->json($result);
    }

    public function bulletin(Inscription $inscription): JsonResponse
    {
        $inscription->load(['etudiant', 'classe.filiere', 'anneeAcademique', 'parcours']);

        $ues = UniteEnseignement::where('classe_id', $inscription->classe_id)
            ->orderBy('ordre')->orderBy('id')
            ->get();

        $notes = Note::where('inscription_id', $inscription->id)
            ->whereIn('ue_id', $ues->pluck('id'))
            ->get()
            ->keyBy('ue_id');

        $totalCoef  = 0;
        $totalPts   = 0;
        $totalCredits  = 0;
        $validatedCredits = 0;
        $uesData = [];

        foreach ($ues as $ue) {
            $note = $notes->get($ue->id);
            $noteVal = $note ? (float) $note->note : null;
            $coef = (float) $ue->coefficient;

            $uesData[] = [
                'id'          => $ue->id,
                'code'        => $ue->code,
                'intitule'    => $ue->intitule,
                'coefficient' => $coef,
                'credits_ects'=> $ue->credits_ects,
                'note'        => $noteVal,
                'points'      => $noteVal !== null ? round($noteVal * $coef, 2) : null,
                'valide'      => $noteVal !== null && $noteVal >= 10,
            ];

            if ($noteVal !== null) {
                $totalCoef += $coef;
                $totalPts  += $noteVal * $coef;
                $totalCredits += $ue->credits_ects;
                if ($noteVal >= 10) $validatedCredits += $ue->credits_ects;
            }
        }

        $moyenne = $totalCoef > 0 ? round($totalPts / $totalCoef, 2) : null;

        $mention = null;
        $decision = 'en_attente';
        if ($moyenne !== null) {
            if ($moyenne >= 16)      { $mention = 'Très Bien'; $decision = 'admis'; }
            elseif ($moyenne >= 14) { $mention = 'Bien'; $decision = 'admis'; }
            elseif ($moyenne >= 12) { $mention = 'Assez Bien'; $decision = 'admis'; }
            elseif ($moyenne >= 10) { $mention = 'Passable'; $decision = 'admis'; }
            elseif ($moyenne >= 8)  { $mention = null; $decision = 'rattrapage'; }
            else                    { $mention = null; $decision = 'redoublant'; }
        }

        return response()->json([
            'inscription'      => $inscription,
            'ues'              => $uesData,
            'moyenne'          => $moyenne,
            'mention'          => $mention,
            'decision'         => $decision,
            'credits_valides'  => $validatedCredits,
            'credits_total'    => $totalCredits,
        ]);
    }
}
