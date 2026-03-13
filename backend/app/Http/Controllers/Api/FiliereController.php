<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Filiere;
use App\Models\Matiere;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class FiliereController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Filiere::with(['typeFormation', 'matieres'])->orderBy('nom');
        if ($request->filled('type_formation_id')) {
            $query->where('type_formation_id', $request->type_formation_id);
        }
        return response()->json($query->get());
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'nom'               => 'required|string|max:150',
            'code'              => 'required|string|max:20|unique:filieres',
            'description'       => 'nullable|string',
            'type_formation_id' => 'nullable|exists:types_formation,id',
            'frais_inscription' => 'required|numeric|min:0',
            'mensualite'        => 'required|numeric|min:0',
            'duree_mois'        => 'required|integer|min:1|max:120',
        ]);
        $filiere = Filiere::create(
            $request->only(['nom', 'code', 'description', 'type_formation_id', 'frais_inscription', 'mensualite', 'duree_mois'])
            + ['actif' => true]
        );
        AuditService::log('filiere_created', 'App\\Models\\Filiere', $filiere->id, null, $filiere->toArray(), $request);
        return response()->json($filiere->load(['typeFormation', 'matieres']), 201);
    }

    public function update(Request $request, Filiere $filiere): JsonResponse
    {
        $request->validate([
            'nom'               => 'sometimes|string|max:150',
            'code'              => 'sometimes|string|max:20|unique:filieres,code,' . $filiere->id,
            'description'       => 'nullable|string',
            'actif'             => 'sometimes|boolean',
            'type_formation_id' => 'nullable|exists:types_formation,id',
            'frais_inscription' => 'sometimes|numeric|min:0',
            'mensualite'        => 'sometimes|numeric|min:0',
            'duree_mois'        => 'sometimes|integer|min:1|max:120',
        ]);
        $avant = $filiere->toArray();
        $filiere->update($request->only(['nom', 'code', 'description', 'actif', 'type_formation_id', 'frais_inscription', 'mensualite', 'duree_mois']));
        AuditService::log('filiere_updated', 'App\\Models\\Filiere', $filiere->id, $avant, $filiere->toArray(), $request);
        return response()->json($filiere->load(['typeFormation', 'matieres']));
    }

    public function destroy(Request $request, Filiere $filiere): JsonResponse
    {
        if ($filiere->classes()->exists()) {
            return response()->json(['message' => 'Cette filière est utilisée par des classes.'], 422);
        }
        if ($filiere->inscriptions()->exists()) {
            return response()->json(['message' => 'Cette filière est utilisée par des inscriptions.'], 422);
        }
        AuditService::log('filiere_deleted', 'App\\Models\\Filiere', $filiere->id, $filiere->toArray(), null, $request);
        $filiere->delete();
        return response()->json(['message' => 'Filière supprimée.']);
    }

    public function attachMatiere(Request $request, Filiere $filiere): JsonResponse
    {
        $request->validate([
            'matiere_id'  => 'required|exists:matieres,id',
            'coefficient' => 'required|numeric|min:0',
            'credits'     => 'required|integer|min:0',
            'ordre'       => 'sometimes|integer|min:0',
        ]);

        $filiere->matieres()->syncWithoutDetaching([
            $request->matiere_id => [
                'coefficient' => $request->coefficient,
                'credits'     => $request->credits,
                'ordre'       => $request->input('ordre', 0),
            ],
        ]);

        return response()->json($filiere->load('matieres'));
    }

    public function detachMatiere(Request $request, Filiere $filiere, Matiere $matiere): JsonResponse
    {
        $filiere->matieres()->detach($matiere->id);
        return response()->json(['message' => 'Matière retirée de la filière.']);
    }
}
