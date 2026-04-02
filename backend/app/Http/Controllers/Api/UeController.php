<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\UniteEnseignement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UeController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = UniteEnseignement::with(['intervenant']);

        if ($request->filled('classe_id')) {
            $query->where('classe_id', $request->classe_id);
        }

        return response()->json($query->orderBy('ordre')->orderBy('id')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'classe_id'      => 'required|exists:classes,id',
            'intervenant_id' => 'nullable|exists:intervenants,id',
            'code'           => 'required|string|max:50',
            'intitule'       => 'required|string|max:255',
            'coefficient'    => 'required|numeric|min:0',
            'credits_ects'   => 'numeric|min:0',
            'volume_horaire' => 'integer|min:0',
            'ordre'          => 'integer|min:0',
        ]);

        $ue = UniteEnseignement::create($data);
        $ue->load('intervenant');

        return response()->json($ue, 201);
    }

    public function update(Request $request, UniteEnseignement $ue): JsonResponse
    {
        $data = $request->validate([
            'intervenant_id' => 'nullable|exists:intervenants,id',
            'code'           => 'sometimes|string|max:50',
            'intitule'       => 'sometimes|string|max:255',
            'coefficient'    => 'sometimes|numeric|min:0',
            'credits_ects'   => 'sometimes|integer|min:0',
            'volume_horaire' => 'sometimes|integer|min:0',
            'ordre'          => 'sometimes|integer|min:0',
        ]);

        $ue->update($data);

        return response()->json($ue->fresh('intervenant'));
    }

    public function destroy(UniteEnseignement $ue): JsonResponse
    {
        $ue->delete();
        return response()->json(null, 204);
    }
}
