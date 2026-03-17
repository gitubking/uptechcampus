<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Etudiant;
use App\Models\Inscription;
use App\Models\DocumentEtudiant;
use App\Models\User;
use App\Services\NumeroEtudiantService;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;

class EtudiantController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $etudiants = Etudiant::with(['inscriptionActive.filiere', 'inscriptionActive.niveauEntree', 'inscriptionActive.niveauBourse', 'inscriptionActive.classe'])
            ->when($request->search, function ($q, $s) {
                $q->where(fn($q2) => $q2->where('nom', 'like', "%$s%")
                    ->orWhere('prenom', 'like', "%$s%")
                    ->orWhere('email', 'like', "%$s%")
                    ->orWhere('numero_etudiant', 'like', "%$s%"));
            })
            ->orderBy('nom')->orderBy('prenom')
            ->paginate(20);
        return response()->json($etudiants);
    }

    public function show(Etudiant $etudiant): JsonResponse
    {
        $etudiant->load([
            'inscriptions.classe.filiere',
            'inscriptions.parcours.typeFormation',
            'inscriptions.anneeAcademique',
            'documents',
            'user'
        ]);
        return response()->json($etudiant);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'nom'            => 'required|string|max:100',
            'prenom'         => 'required|string|max:100',
            'email'          => 'required|email|unique:etudiants',
            'telephone'      => 'nullable|string|max:20',
            'date_naissance' => 'nullable|date',
            'lieu_naissance' => 'nullable|string|max:100',
            'adresse'        => 'nullable|string|max:255',
            'cni_numero'       => 'nullable|string|max:50',
            'nom_parent'       => 'nullable|string|max:150',
            'telephone_parent' => 'nullable|string|max:20',
        ]);

        $annee = date('Y');
        $etudiant = Etudiant::create([
            'numero_etudiant'  => NumeroEtudiantService::generate($annee),
            'nom'              => $request->nom,
            'prenom'           => $request->prenom,
            'email'            => $request->email,
            'telephone'        => $request->telephone,
            'date_naissance'   => $request->date_naissance,
            'lieu_naissance'   => $request->lieu_naissance,
            'adresse'          => $request->adresse,
            'cni_numero'       => $request->cni_numero,
            'nom_parent'       => $request->nom_parent,
            'telephone_parent' => $request->telephone_parent,
        ]);

        AuditService::log('etudiant_created', 'App\\Models\\Etudiant', $etudiant->id, null, $etudiant->toArray(), $request);

        return response()->json($etudiant, 201);
    }

    public function update(Request $request, Etudiant $etudiant): JsonResponse
    {
        $request->validate([
            'nom'            => 'sometimes|string|max:100',
            'prenom'         => 'sometimes|string|max:100',
            'email'          => 'sometimes|email|unique:etudiants,email,'.$etudiant->id,
            'telephone'      => 'nullable|string|max:20',
            'date_naissance' => 'nullable|date',
            'lieu_naissance' => 'nullable|string|max:100',
            'adresse'        => 'nullable|string|max:255',
            'cni_numero'       => 'nullable|string|max:50',
            'nom_parent'       => 'nullable|string|max:150',
            'telephone_parent' => 'nullable|string|max:20',
        ]);

        $avant = $etudiant->toArray();
        $etudiant->update($request->only(['nom','prenom','email','telephone','date_naissance','lieu_naissance','adresse','cni_numero','nom_parent','telephone_parent']));
        AuditService::log('etudiant_updated', 'App\\Models\\Etudiant', $etudiant->id, $avant, $etudiant->fresh()->toArray(), $request);

        return response()->json($etudiant->fresh());
    }

    public function uploadPhoto(Request $request, Etudiant $etudiant): JsonResponse
    {
        $request->validate(['photo' => 'required|image|max:2048']);
        $path = $request->file('photo')->store("etudiants/{$etudiant->id}/photos", 'public');
        $etudiant->update(['photo_path' => $path]);
        return response()->json(['photo_path' => $path]);
    }

    public function destroy(Etudiant $etudiant): JsonResponse
    {
        DB::transaction(function () use ($etudiant) {
            // Supprimer toutes les inscriptions et leurs données liées
            foreach ($etudiant->inscriptions as $inscription) {
                if ($inscription->contrat_path) {
                    Storage::disk('public')->delete($inscription->contrat_path);
                }
                $inscription->notes()->delete();
                $inscription->paiements()->delete();
                $inscription->presences()->delete();
                $inscription->documents()->delete();
                $inscription->delete();
            }

            // Supprimer les documents directement liés à l'étudiant
            foreach ($etudiant->documents as $doc) {
                if ($doc->fichier_path) {
                    Storage::disk('public')->delete($doc->fichier_path);
                }
                $doc->delete();
            }

            // Supprimer la photo
            if ($etudiant->photo_path) {
                Storage::disk('public')->delete($etudiant->photo_path);
            }

            AuditService::log('etudiant_deleted', 'App\\Models\\Etudiant', $etudiant->id, $etudiant->toArray(), null, request());

            // Supprimer le compte utilisateur associé
            $userId = $etudiant->user_id;
            $etudiant->delete();
            if ($userId) {
                User::destroy($userId);
            }
        });

        return response()->json(['message' => 'Étudiant supprimé définitivement.']);
    }
}
