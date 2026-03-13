<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Inscription;
use App\Models\Etudiant;
use App\Models\Filiere;
use App\Models\NiveauBourse;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;

class InscriptionController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $inscriptions = Inscription::with([
                'etudiant', 'filiere.typeFormation', 'niveauEntree',
                'niveauBourse', 'classe', 'anneeAcademique'
            ])
            ->when($request->statut, fn($q, $s) => $q->where('statut', $s))
            ->when($request->annee_academique_id, fn($q, $id) => $q->where('annee_academique_id', $id))
            ->when($request->filiere_id, fn($q, $id) => $q->where('filiere_id', $id))
            ->when($request->classe_id, fn($q, $id) => $q->where('classe_id', $id))
            ->when($request->sans_classe, fn($q) => $q->whereNull('classe_id'))
            ->when($request->etudiant_id, fn($q, $id) => $q->where('etudiant_id', $id))
            ->when($request->search, function ($q, $s) {
                $q->whereHas('etudiant', fn($q2) =>
                    $q2->where('nom', 'like', "%$s%")
                       ->orWhere('prenom', 'like', "%$s%")
                       ->orWhere('numero_etudiant', 'like', "%$s%")
                );
            })
            ->orderBy('created_at', 'desc')
            ->paginate((int) $request->input('per_page', 25));
        return response()->json($inscriptions);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'etudiant_id'         => 'required|exists:etudiants,id',
            'filiere_id'          => 'required|exists:filieres,id',
            'niveau_entree_id'    => 'required|exists:niveaux_entree,id',
            'annee_academique_id' => 'required|exists:annees_academiques,id',
            'niveau_bourse_id'    => 'nullable|exists:niveaux_bourse,id',
            'classe_id'           => 'nullable|exists:classes,id',
            'frais_tenue'         => 'nullable|numeric|min:0',
            'reduction_type'      => 'nullable|in:pourcentage,montant',
            'reduction_valeur'    => 'nullable|numeric|min:0',
            'statut'              => 'nullable|in:pre_inscrit,inscrit_actif',
        ]);

        // Récupération des montants depuis la filière
        $filiere = Filiere::findOrFail($request->filiere_id);
        $fraisInscription = (float) $filiere->frais_inscription;
        $mensualite       = (float) $filiere->mensualite;

        // Application de la bourse si présente
        if ($request->niveau_bourse_id) {
            $bourse = NiveauBourse::findOrFail($request->niveau_bourse_id);
            $mensualite = $mensualite * (1 - $bourse->pourcentage / 100);
            if ($bourse->applique_inscription) {
                $fraisInscription = $fraisInscription * (1 - $bourse->pourcentage / 100);
            }
        }

        $inscription = Inscription::create([
            ...$request->only([
                'etudiant_id', 'filiere_id', 'niveau_entree_id', 'niveau_bourse_id',
                'annee_academique_id', 'classe_id', 'frais_tenue',
                'reduction_type', 'reduction_valeur',
            ]),
            'frais_inscription' => $fraisInscription,
            'mensualite'        => $mensualite,
            'statut'            => $request->input('statut', 'pre_inscrit'),
            'created_by'        => $request->user()->id,
        ]);

        AuditService::log('inscription_created', 'App\\Models\\Inscription', $inscription->id, null, $inscription->toArray(), $request);

        return response()->json(
            $inscription->load(['etudiant', 'filiere.typeFormation', 'niveauEntree', 'niveauBourse', 'classe']),
            201
        );
    }

    public function affecterClasse(Request $request, Inscription $inscription): JsonResponse
    {
        $request->validate(['classe_id' => 'required|exists:classes,id']);
        $avant = $inscription->toArray();
        $inscription->update(['classe_id' => $request->classe_id]);
        AuditService::log('inscription_classe_affectee', 'App\\Models\\Inscription', $inscription->id, $avant, $inscription->fresh()->toArray(), $request);
        return response()->json($inscription->fresh()->load(['etudiant', 'filiere', 'niveauEntree', 'classe']));
    }

    public function valider(Request $request, Inscription $inscription): JsonResponse
    {
        if ($inscription->statut !== 'en_examen') {
            return response()->json(['message' => 'Seule une inscription en examen peut être validée.'], 422);
        }

        if (!$inscription->contrat_path) {
            return response()->json(['message' => 'Le contrat signé doit être uploadé avant validation.'], 422);
        }

        $inscription->update([
            'statut'          => 'inscrit_actif',
            'date_validation' => now(),
            'validated_by'    => $request->user()->id,
        ]);

        // Créer le compte utilisateur étudiant
        $etudiant = $inscription->etudiant;
        if (!$etudiant->user_id) {
            $user = User::create([
                'nom'        => $etudiant->nom,
                'prenom'     => $etudiant->prenom,
                'email'      => $etudiant->email,
                'telephone'  => $etudiant->telephone,
                'role'       => 'etudiant',
                'statut'     => 'actif',
                'password'   => Hash::make('Uptech@2026'),
                'created_by' => $request->user()->id,
            ]);
            $etudiant->update(['user_id' => $user->id]);
        }

        AuditService::log('inscription_validee', 'App\\Models\\Inscription', $inscription->id, null, $inscription->fresh()->toArray(), $request);

        return response()->json(['message' => 'Dossier validé. Compte étudiant créé.', 'inscription' => $inscription->fresh()]);
    }

    public function updateStatut(Request $request, Inscription $inscription): JsonResponse
    {
        $request->validate(['statut' => 'required|in:pre_inscrit,en_examen,inscrit_actif,suspendu,abandonne,diplome']);
        $avant = $inscription->toArray();
        $inscription->update(['statut' => $request->statut]);
        AuditService::log('inscription_statut_updated', 'App\\Models\\Inscription', $inscription->id, $avant, $inscription->fresh()->toArray(), $request);
        return response()->json($inscription->fresh());
    }

    public function update(Request $request, Inscription $inscription): JsonResponse
    {
        $request->validate([
            'filiere_id'       => 'sometimes|exists:filieres,id',
            'niveau_entree_id' => 'sometimes|exists:niveaux_entree,id',
            'niveau_bourse_id' => 'nullable|exists:niveaux_bourse,id',
            'frais_tenue'      => 'nullable|numeric|min:0',
        ]);

        $avant = $inscription->toArray();

        $filiereId = $request->input('filiere_id', $inscription->filiere_id);
        $bourseId  = $request->has('niveau_bourse_id')
            ? $request->niveau_bourse_id
            : $inscription->niveau_bourse_id;

        $filiere = Filiere::findOrFail($filiereId);
        $fraisInscription = (float) $filiere->frais_inscription;
        $mensualite       = (float) $filiere->mensualite;

        if ($bourseId) {
            $bourse = NiveauBourse::findOrFail($bourseId);
            $mensualite = $mensualite * (1 - $bourse->pourcentage / 100);
            if ($bourse->applique_inscription) {
                $fraisInscription = $fraisInscription * (1 - $bourse->pourcentage / 100);
            }
        }

        $inscription->update([
            ...$request->only(['filiere_id', 'niveau_entree_id', 'niveau_bourse_id', 'frais_tenue']),
            'frais_inscription' => $fraisInscription,
            'mensualite'        => $mensualite,
        ]);

        AuditService::log('inscription_updated', 'App\\Models\\Inscription', $inscription->id, $avant, $inscription->fresh()->toArray(), $request);

        return response()->json(
            $inscription->fresh()->load(['filiere', 'niveauEntree', 'niveauBourse', 'classe'])
        );
    }

    public function uploadContrat(Request $request, Inscription $inscription): JsonResponse
    {
        $request->validate(['contrat' => 'required|mimes:pdf|max:5120']);
        $path = $request->file('contrat')->store("etudiants/{$inscription->etudiant_id}/contrats", 'public');
        $inscription->update(['contrat_path' => $path, 'date_contrat_signe' => now(), 'statut' => 'en_examen']);
        return response()->json(['contrat_path' => $path]);
    }
}
