<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Depense;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class DepenseController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $query = Depense::with(['anneeAcademique', 'createdBy', 'validatedBy']);

        if ($request->filled('categorie')) {
            $query->where('categorie', $request->categorie);
        }
        if ($request->filled('statut')) {
            $query->where('statut', $request->statut);
        }
        if ($request->filled('annee_academique_id')) {
            $query->where('annee_academique_id', $request->annee_academique_id);
        }
        if ($request->filled('mois')) {
            $query->whereYear('date_depense', substr($request->mois, 0, 4))
                  ->whereMonth('date_depense', substr($request->mois, 5, 2));
        }
        if ($request->filled('search')) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('libelle', 'like', "%{$search}%")
                  ->orWhere('beneficiaire', 'like', "%{$search}%")
                  ->orWhere('reference_facture', 'like', "%{$search}%");
            });
        }

        $depenses = $query->orderByDesc('date_depense')->orderByDesc('created_at')->paginate(20);

        return response()->json($depenses);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'libelle'              => 'required|string|max:255',
            'categorie'            => 'required|string',
            'montant'              => 'required|numeric|min:0',
            'mode_paiement'        => 'required|string',
            'beneficiaire'         => 'nullable|string|max:255',
            'reference_facture'    => 'nullable|string|max:255',
            'notes'                => 'nullable|string',
            'annee_academique_id'  => 'nullable|exists:annees_academiques,id',
            'date_depense'         => 'required|date',
        ]);

        $data['created_by'] = $request->user()->id;
        $data['statut']     = 'en_attente';

        $depense = Depense::create($data);
        $depense->load(['anneeAcademique', 'createdBy']);

        return response()->json($depense, 201);
    }

    public function show(Depense $depense): JsonResponse
    {
        $depense->load(['anneeAcademique', 'createdBy', 'validatedBy']);

        return response()->json($depense);
    }

    public function valider(Request $request, Depense $depense): JsonResponse
    {
        if ($depense->statut !== 'en_attente') {
            return response()->json(['message' => 'Cette dépense ne peut pas être validée.'], 422);
        }

        $depense->update([
            'statut'       => 'validee',
            'validated_by' => $request->user()->id,
            'validated_at' => now(),
        ]);

        return response()->json($depense->fresh(['validatedBy']));
    }

    public function rejeter(Request $request, Depense $depense): JsonResponse
    {
        if ($depense->statut !== 'en_attente') {
            return response()->json(['message' => 'Cette dépense ne peut pas être rejetée.'], 422);
        }

        $depense->update(['statut' => 'rejetee']);

        return response()->json($depense->fresh());
    }

    public function uploadJustificatif(Request $request, Depense $depense): JsonResponse
    {
        $request->validate([
            'justificatif' => 'required|file|mimes:pdf,jpg,jpeg,png|max:5120',
        ]);

        if ($depense->justificatif_path) {
            Storage::disk('public')->delete($depense->justificatif_path);
        }

        $path = $request->file('justificatif')->store('justificatifs', 'public');
        $depense->update(['justificatif_path' => $path]);

        return response()->json(['justificatif_path' => $path]);
    }
}
