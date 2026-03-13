<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\TypeFormation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TypeFormationController extends Controller
{
    /**
     * Crée un nouveau type de formation.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'nom'               => 'required|string|max:150',
            'code'              => 'required|string|max:20|unique:types_formation,code',
            'diplome_vise'      => 'nullable|string|max:100',
            'duree_description' => 'nullable|string|max:100',
            'public_cible'      => 'nullable|string|max:255',
            'actif'             => 'sometimes|boolean',
        ]);

        $type = TypeFormation::create($data + ['actif' => $data['actif'] ?? true]);

        return response()->json($type->load(['parcours', 'filieres']), 201);
    }

    /**
     * Met à jour un type de formation.
     */
    public function update(Request $request, TypeFormation $type): JsonResponse
    {
        $data = $request->validate([
            'nom'               => 'sometimes|string|max:150',
            'code'              => 'sometimes|string|max:20|unique:types_formation,code,' . $type->id,
            'diplome_vise'      => 'nullable|string|max:100',
            'duree_description' => 'nullable|string|max:100',
            'public_cible'      => 'nullable|string|max:255',
            'actif'             => 'sometimes|boolean',
        ]);

        $type->update($data);

        return response()->json($type->load(['parcours', 'filieres']));
    }

    /**
     * Supprime un type de formation (bloqué si parcours ou filières liés).
     */
    public function destroy(TypeFormation $type): JsonResponse
    {
        if ($type->parcours()->exists()) {
            return response()->json([
                'message' => 'Ce type de formation est utilisé par des parcours. Veuillez d\'abord les réassigner.'
            ], 422);
        }

        if ($type->filieres()->exists()) {
            return response()->json([
                'message' => 'Ce type de formation est utilisé par des filières. Veuillez d\'abord les réassigner.'
            ], 422);
        }

        $type->delete();

        return response()->json(['message' => 'Type de formation supprimé.']);
    }
}
