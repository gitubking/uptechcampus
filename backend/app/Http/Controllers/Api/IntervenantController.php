<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Intervenant;
use App\Models\User;
use App\Services\NumeroContratService;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;

class IntervenantController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $intervenants = Intervenant::with(['filieres.filiere', 'anneeAcademique'])
            ->when($request->statut, fn($q, $s) => $q->where('statut', $s))
            ->when($request->search, function ($q, $s) {
                $q->where(fn($q2) => $q2->where('nom', 'like', "%$s%")
                    ->orWhere('prenom', 'like', "%$s%")
                    ->orWhere('email', 'like', "%$s%"));
            })
            ->orderBy('nom')->orderBy('prenom')
            ->paginate(20);
        return response()->json($intervenants);
    }

    public function show(Intervenant $intervenant): JsonResponse
    {
        return response()->json($intervenant->load(['filieres.filiere', 'anneeAcademique', 'user']));
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'nom'                  => 'required|string|max:100',
            'prenom'               => 'required|string|max:100',
            'email'                => 'required|email|unique:intervenants',
            'telephone'            => 'nullable|string|max:20',
            'annee_academique_id'  => 'required|exists:annees_academiques,id',
            'filieres'             => 'nullable|array',
            'filieres.*.filiere_id' => 'exists:filieres,id',
            'filieres.*.matiere'   => 'string|max:150',
        ]);

        $annee = date('Y');
        $user = User::create([
            'nom'        => $request->nom,
            'prenom'     => $request->prenom,
            'email'      => $request->email,
            'telephone'  => $request->telephone,
            'role'       => 'intervenant',
            'statut'     => 'actif',
            'password'   => Hash::make('Uptech@2026'),
            'created_by' => $request->user()->id,
        ]);

        $intervenant = Intervenant::create([
            'user_id'             => $user->id,
            'numero_contrat'      => NumeroContratService::generate($annee),
            'nom'                 => $request->nom,
            'prenom'              => $request->prenom,
            'email'               => $request->email,
            'telephone'           => $request->telephone,
            'statut'              => 'en_attente',
            'annee_academique_id' => $request->annee_academique_id,
            'created_by'          => $request->user()->id,
        ]);

        if ($request->filieres) {
            foreach ($request->filieres as $f) {
                $intervenant->filieres()->create($f);
            }
        }

        AuditService::log('intervenant_created', 'App\\Models\\Intervenant', $intervenant->id, null, $intervenant->toArray(), $request);

        return response()->json($intervenant->load(['filieres.filiere']), 201);
    }

    public function update(Request $request, Intervenant $intervenant): JsonResponse
    {
        $request->validate([
            'nom'                   => 'sometimes|string|max:100',
            'prenom'                => 'sometimes|string|max:100',
            'email'                 => 'sometimes|email|unique:intervenants,email,'.$intervenant->id,
            'telephone'             => 'nullable|string|max:20',
            'statut'                => 'sometimes|in:actif,inactif,en_attente,suspendu',
            'filieres'              => 'sometimes|array',
            'filieres.*.filiere_id' => 'exists:filieres,id',
            'filieres.*.matiere'    => 'string|max:150',
        ]);

        $avant = $intervenant->toArray();
        $intervenant->update($request->only(['nom','prenom','email','telephone','statut']));

        // Synchronisation des filières/matières si envoyées
        if ($request->has('filieres')) {
            $intervenant->filieres()->delete();
            foreach ($request->filieres as $f) {
                if (!empty($f['filiere_id']) && !empty($f['matiere'])) {
                    $intervenant->filieres()->create($f);
                }
            }
        }

        AuditService::log('intervenant_updated', 'App\\Models\\Intervenant', $intervenant->id, $avant, $intervenant->fresh()->toArray(), $request);
        return response()->json($intervenant->fresh()->load(['filieres.filiere']));
    }

    public function uploadCv(Request $request, Intervenant $intervenant): JsonResponse
    {
        $request->validate(['cv' => 'required|mimes:pdf,doc,docx|max:10240']);
        $path = $request->file('cv')->store("intervenants/{$intervenant->id}/cv", 'public');
        $intervenant->update(['cv_path' => $path]);
        return response()->json(['cv_path' => $path]);
    }
}
