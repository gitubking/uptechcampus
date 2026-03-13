<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\NiveauEntree;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class NiveauEntreeController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(NiveauEntree::orderBy('ordre')->orderBy('nom')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'nom'              => 'required|string|max:100',
            'code'             => 'required|string|max:20|unique:niveaux_entree',
            'est_superieur_bac'=> 'sometimes|boolean',
            'ordre'            => 'sometimes|integer|min:0',
            'actif'            => 'sometimes|boolean',
        ]);

        $niveau = NiveauEntree::create([
            ...$request->only(['nom', 'code', 'est_superieur_bac', 'ordre']),
            'actif' => $request->input('actif', true),
        ]);

        AuditService::log('niveau_entree_created', 'App\\Models\\NiveauEntree', $niveau->id, null, $niveau->toArray(), $request);
        return response()->json($niveau, 201);
    }

    public function update(Request $request, NiveauEntree $niveau): JsonResponse
    {
        $request->validate([
            'nom'              => 'sometimes|string|max:100',
            'code'             => 'sometimes|string|max:20|unique:niveaux_entree,code,' . $niveau->id,
            'est_superieur_bac'=> 'sometimes|boolean',
            'ordre'            => 'sometimes|integer|min:0',
            'actif'            => 'sometimes|boolean',
        ]);

        $avant = $niveau->toArray();
        $niveau->update($request->only(['nom', 'code', 'est_superieur_bac', 'ordre', 'actif']));
        AuditService::log('niveau_entree_updated', 'App\\Models\\NiveauEntree', $niveau->id, $avant, $niveau->fresh()->toArray(), $request);
        return response()->json($niveau->fresh());
    }

    public function destroy(Request $request, NiveauEntree $niveau): JsonResponse
    {
        if ($niveau->inscriptions()->exists()) {
            return response()->json(['message' => 'Ce niveau d\'entrée est utilisé par des inscriptions.'], 422);
        }

        AuditService::log('niveau_entree_deleted', 'App\\Models\\NiveauEntree', $niveau->id, $niveau->toArray(), null, $request);
        $niveau->delete();
        return response()->json(['message' => 'Niveau d\'entrée supprimé.']);
    }
}
