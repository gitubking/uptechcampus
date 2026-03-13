<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\NiveauBourse;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class NiveauBourseController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(NiveauBourse::orderBy('nom')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'nom'                  => 'required|string|max:100',
            'pourcentage'          => 'required|numeric|min:0|max:100',
            'applique_inscription' => 'sometimes|boolean',
            'actif'                => 'sometimes|boolean',
        ]);

        $bourse = NiveauBourse::create([
            ...$request->only(['nom', 'pourcentage', 'applique_inscription']),
            'actif' => $request->input('actif', true),
        ]);

        AuditService::log('niveau_bourse_created', 'App\\Models\\NiveauBourse', $bourse->id, null, $bourse->toArray(), $request);
        return response()->json($bourse, 201);
    }

    public function update(Request $request, NiveauBourse $bourse): JsonResponse
    {
        $request->validate([
            'nom'                  => 'sometimes|string|max:100',
            'pourcentage'          => 'sometimes|numeric|min:0|max:100',
            'applique_inscription' => 'sometimes|boolean',
            'actif'                => 'sometimes|boolean',
        ]);

        $avant = $bourse->toArray();
        $bourse->update($request->only(['nom', 'pourcentage', 'applique_inscription', 'actif']));
        AuditService::log('niveau_bourse_updated', 'App\\Models\\NiveauBourse', $bourse->id, $avant, $bourse->fresh()->toArray(), $request);
        return response()->json($bourse->fresh());
    }

    public function destroy(Request $request, NiveauBourse $bourse): JsonResponse
    {
        if ($bourse->inscriptions()->exists()) {
            return response()->json(['message' => 'Ce niveau de bourse est utilisé par des inscriptions.'], 422);
        }

        AuditService::log('niveau_bourse_deleted', 'App\\Models\\NiveauBourse', $bourse->id, $bourse->toArray(), null, $request);
        $bourse->delete();
        return response()->json(['message' => 'Niveau de bourse supprimé.']);
    }
}
