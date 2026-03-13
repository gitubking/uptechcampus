<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Matiere;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class MatiereController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(Matiere::orderBy('nom')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'nom'         => 'required|string|max:150',
            'code'        => 'required|string|max:20|unique:matieres',
            'description' => 'nullable|string',
            'actif'       => 'sometimes|boolean',
        ]);

        $matiere = Matiere::create([
            ...$request->only(['nom', 'code', 'description']),
            'actif' => $request->input('actif', true),
        ]);

        AuditService::log('matiere_created', 'App\\Models\\Matiere', $matiere->id, null, $matiere->toArray(), $request);
        return response()->json($matiere, 201);
    }

    public function update(Request $request, Matiere $matiere): JsonResponse
    {
        $request->validate([
            'nom'         => 'sometimes|string|max:150',
            'code'        => 'sometimes|string|max:20|unique:matieres,code,' . $matiere->id,
            'description' => 'nullable|string',
            'actif'       => 'sometimes|boolean',
        ]);

        $avant = $matiere->toArray();
        $matiere->update($request->only(['nom', 'code', 'description', 'actif']));
        AuditService::log('matiere_updated', 'App\\Models\\Matiere', $matiere->id, $avant, $matiere->fresh()->toArray(), $request);
        return response()->json($matiere->fresh());
    }

    public function destroy(Request $request, Matiere $matiere): JsonResponse
    {
        if ($matiere->filieres()->exists()) {
            return response()->json(['message' => 'Cette matière est utilisée par des filières.'], 422);
        }
        if ($matiere->unitesEnseignement()->exists()) {
            return response()->json(['message' => 'Cette matière est utilisée par des unités d\'enseignement.'], 422);
        }

        AuditService::log('matiere_deleted', 'App\\Models\\Matiere', $matiere->id, $matiere->toArray(), null, $request);
        $matiere->delete();
        return response()->json(['message' => 'Matière supprimée.']);
    }
}
