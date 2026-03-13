<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Presence;
use App\Models\Seance;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PresenceController extends Controller
{
    public function index(Seance $seance): JsonResponse
    {
        $presences = $seance->presences()->with(['inscription.etudiant'])->get();
        return response()->json($presences);
    }

    public function batchUpsert(Request $request, Seance $seance): JsonResponse
    {
        $request->validate([
            'presences'                  => 'required|array',
            'presences.*.inscription_id' => 'required|exists:inscriptions,id',
            'presences.*.statut'         => 'required|in:present,retard,absent,excuse',
            'presences.*.heure_arrivee'  => 'nullable|date_format:H:i',
            'presences.*.note'           => 'nullable|string',
        ]);

        $userId = $request->user()->id;
        $result = [];

        foreach ($request->presences as $item) {
            $presence = Presence::updateOrCreate(
                ['seance_id' => $seance->id, 'inscription_id' => $item['inscription_id']],
                [
                    'statut'       => $item['statut'],
                    'heure_arrivee'=> $item['heure_arrivee'] ?? null,
                    'note'         => $item['note'] ?? null,
                    'created_by'   => $userId,
                ]
            );
            $result[] = $presence;
        }

        return response()->json($result);
    }
}
