<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Seance;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SeanceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Seance::with(['classe.filiere', 'intervenant', 'anneeAcademique']);

        if ($request->filled('classe_id')) {
            $query->where('classe_id', $request->classe_id);
        }
        if ($request->filled('intervenant_id')) {
            $query->where('intervenant_id', $request->intervenant_id);
        }
        if ($request->filled('annee_academique_id')) {
            $query->where('annee_academique_id', $request->annee_academique_id);
        }
        if ($request->filled('date_debut')) {
            $query->whereDate('date_debut', '>=', $request->date_debut);
        }
        if ($request->filled('date_fin')) {
            $query->whereDate('date_debut', '<=', $request->date_fin);
        }
        if ($request->filled('mode')) {
            $query->where('mode', $request->mode);
        }
        if ($request->filled('statut')) {
            $query->where('statut', $request->statut);
        }

        return response()->json($query->orderBy('date_debut')->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'classe_id'           => 'required|exists:classes,id',
            'intervenant_id'      => 'nullable|exists:intervenants,id',
            'matiere'             => 'required|string|max:255',
            'date_debut'          => 'required|date',
            'date_fin'            => 'required|date|after:date_debut',
            'mode'                => 'required|in:presentiel,en_ligne,hybride,exam',
            'salle'               => 'nullable|string|max:255',
            'lien_visio'          => 'nullable|string|max:500',
            'statut'              => 'in:planifie,confirme,annule,reporte',
            'notes'               => 'nullable|string',
            'annee_academique_id' => 'nullable|exists:annee_academiques,id',
        ]);

        $data['created_by'] = $request->user()->id;
        $seance = Seance::create($data);
        $seance->load(['classe.filiere', 'intervenant']);

        return response()->json($seance, 201);
    }

    public function update(Request $request, Seance $seance): JsonResponse
    {
        $data = $request->validate([
            'classe_id'      => 'sometimes|exists:classes,id',
            'intervenant_id' => 'nullable|exists:intervenants,id',
            'matiere'        => 'sometimes|string|max:255',
            'date_debut'     => 'sometimes|date',
            'date_fin'       => 'sometimes|date',
            'mode'           => 'sometimes|in:presentiel,en_ligne,hybride,exam',
            'salle'          => 'nullable|string|max:255',
            'lien_visio'     => 'nullable|string|max:500',
            'statut'         => 'sometimes|in:planifie,confirme,annule,reporte',
            'notes'          => 'nullable|string',
        ]);

        $seance->update($data);

        return response()->json($seance->fresh(['classe.filiere', 'intervenant']));
    }

    public function destroy(Seance $seance): JsonResponse
    {
        $seance->delete();
        return response()->json(null, 204);
    }

    public function annuler(Seance $seance): JsonResponse
    {
        $seance->update(['statut' => 'annule']);
        return response()->json($seance->fresh(['classe.filiere', 'intervenant']));
    }
}
