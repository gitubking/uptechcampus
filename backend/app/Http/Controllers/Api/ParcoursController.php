<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Parcours;
use App\Models\TypeFormation;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class ParcoursController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(
            Parcours::with('typeFormation')->orderBy('nom')->get()
        );
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'nom'               => 'required|string|max:150',
            'code'              => 'required|string|max:20|unique:parcours',
            'type_formation_id' => 'required|exists:types_formation,id',
            'niveau_entree'     => 'nullable|string|max:50',
            'diplome_vise'      => 'nullable|string|max:100',
        ]);
        $parcours = Parcours::create($request->only(['nom','code','type_formation_id','niveau_entree','diplome_vise']) + ['actif' => true]);
        AuditService::log('parcours_created', 'App\\Models\\Parcours', $parcours->id, null, $parcours->toArray(), $request);
        return response()->json($parcours->load('typeFormation'), 201);
    }

    public function update(Request $request, Parcours $parcours): JsonResponse
    {
        $request->validate([
            'nom'               => 'sometimes|string|max:150',
            'code'              => 'sometimes|string|max:20|unique:parcours,code,'.$parcours->id,
            'type_formation_id' => 'sometimes|exists:types_formation,id',
            'niveau_entree'     => 'nullable|string|max:50',
            'diplome_vise'      => 'nullable|string|max:100',
            'actif'             => 'sometimes|boolean',
        ]);
        $avant = $parcours->toArray();
        $parcours->update($request->only(['nom','code','type_formation_id','niveau_entree','diplome_vise','actif']));
        AuditService::log('parcours_updated', 'App\\Models\\Parcours', $parcours->id, $avant, $parcours->toArray(), $request);
        return response()->json($parcours->load('typeFormation'));
    }
}
