<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Paiement;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PaiementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Paiement::with([
            'inscription.etudiant',
            'inscription.classe.filiere',
            'createdBy',
            'confirmedBy',
        ]);

        if ($request->filled('statut')) {
            $query->where('statut', $request->statut);
        }
        if ($request->filled('mode_paiement')) {
            $query->where('mode_paiement', $request->mode_paiement);
        }
        if ($request->filled('mois')) {
            // mois format: YYYY-MM
            $query->whereYear('mois_concerne', substr($request->mois, 0, 4))
                  ->whereMonth('mois_concerne', substr($request->mois, 5, 2));
        }
        if ($request->filled('inscription_id')) {
            $query->where('inscription_id', $request->inscription_id);
        }
        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('numero_recu', 'like', "%{$search}%")
                  ->orWhereHas('inscription.etudiant', function ($q2) use ($search) {
                      $q2->where('nom', 'like', "%{$search}%")
                         ->orWhere('prenom', 'like', "%{$search}%")
                         ->orWhere('numero_etudiant', 'like', "%{$search}%");
                  });
            });
        }

        $paiements = $query->orderByDesc('created_at')->paginate(20);

        return response()->json($paiements);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'inscription_id' => 'required|exists:inscriptions,id',
            'type_paiement'  => 'required|in:frais_inscription,mensualite,rattrapage',
            'mois_concerne'  => 'nullable|date',
            'montant'        => 'required|numeric|min:0',
            'mode_paiement'  => 'required|in:wave,orange_money,especes,virement,cheque',
            'reference'      => 'nullable|string|max:255',
            'observation'    => 'nullable|string',
        ]);

        // Auto-statut selon mode de paiement
        $confirmeImmediatement = $data['mode_paiement'] === 'especes';
        $data['statut']     = $confirmeImmediatement ? 'confirme' : 'en_attente';
        $data['created_by'] = $request->user()->id;

        if ($confirmeImmediatement) {
            $data['confirmed_by'] = $request->user()->id;
            $data['confirmed_at'] = now();
        }

        $paiement = Paiement::create($data);
        $paiement->load(['inscription.etudiant', 'inscription.classe.filiere', 'createdBy']);

        return response()->json($paiement, 201);
    }

    public function show(Paiement $paiement): JsonResponse
    {
        $paiement->load([
            'inscription.etudiant',
            'inscription.classe.filiere',
            'createdBy',
            'confirmedBy',
        ]);

        return response()->json($paiement);
    }

    public function confirmer(Request $request, Paiement $paiement): JsonResponse
    {
        if ($paiement->statut !== 'en_attente') {
            return response()->json(['message' => 'Ce paiement ne peut pas être confirmé.'], 422);
        }

        $paiement->update([
            'statut'       => 'confirme',
            'confirmed_by' => $request->user()->id,
            'confirmed_at' => now(),
        ]);

        return response()->json($paiement->fresh(['inscription.etudiant', 'confirmedBy']));
    }

    public function rejeter(Request $request, Paiement $paiement): JsonResponse
    {
        if ($paiement->statut !== 'en_attente') {
            return response()->json(['message' => 'Ce paiement ne peut pas être rejeté.'], 422);
        }

        $paiement->update(['statut' => 'rejete']);

        return response()->json($paiement->fresh());
    }
}
