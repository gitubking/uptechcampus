<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Annonce;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AnnonceController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Annonce::with('createdBy')->orderByDesc('epingle')->orderByDesc('publie_at');

        if ($request->user()->role === 'etudiant') {
            // Les étudiants ne voient que les annonces publiées
            $query->where('statut', 'publie');
        }
        // Les admins voient tout (brouillons inclus)

        return response()->json($query->get());
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'titre'         => 'required|string|max:255',
            'type'          => 'required|in:info,urgent,alerte,evenement',
            'contenu'       => 'required|string|max:5000',
            'destinataires' => 'nullable|array',
            'canaux'        => 'nullable|array',
            'epingle'       => 'boolean',
            'publie_at'     => 'nullable|date',
        ]);

        $data['created_by'] = $request->user()->id;
        $data['statut'] = 'brouillon';

        return response()->json(Annonce::create($data), 201);
    }

    public function update(Request $request, Annonce $annonce): JsonResponse
    {
        $data = $request->validate([
            'titre'         => 'sometimes|string|max:255',
            'type'          => 'sometimes|in:info,urgent,alerte,evenement',
            'contenu'       => 'sometimes|string|max:5000',
            'destinataires' => 'nullable|array',
            'canaux'        => 'nullable|array',
            'epingle'       => 'boolean',
            'publie_at'     => 'nullable|date',
        ]);

        $annonce->update($data);

        return response()->json($annonce);
    }

    public function destroy(Annonce $annonce): JsonResponse
    {
        $annonce->delete();

        return response()->json(null, 204);
    }

    public function publier(Annonce $annonce): JsonResponse
    {
        $annonce->update([
            'statut'    => 'publie',
            'publie_at' => $annonce->publie_at ?? now(),
        ]);

        return response()->json($annonce);
    }
}
