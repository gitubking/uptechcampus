<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DocumentEtudiant;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

class DocumentController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'etudiant_id'    => 'required|exists:etudiants,id',
            'inscription_id' => 'nullable|exists:inscriptions,id',
            'type_document'  => 'required|in:cni,passeport,photo,diplome,bulletin_naissance,contrat_signe,autre',
            'fichier'        => 'required|file|max:10240',
        ]);

        $file = $request->file('fichier');
        $path = $file->store("etudiants/{$request->etudiant_id}/documents", 'public');

        $doc = DocumentEtudiant::create([
            'etudiant_id'    => $request->etudiant_id,
            'inscription_id' => $request->inscription_id,
            'type_document'  => $request->type_document,
            'fichier_path'   => $path,
            'nom_fichier'    => $file->getClientOriginalName(),
            'taille_fichier' => $file->getSize(),
            'statut'         => 'present',
            'uploaded_by'    => $request->user()->id,
        ]);

        AuditService::log('document_uploaded', 'App\\Models\\DocumentEtudiant', $doc->id, null, $doc->toArray(), $request);

        return response()->json($doc, 201);
    }

    public function destroy(Request $request, DocumentEtudiant $document): JsonResponse
    {
        Storage::disk('public')->delete($document->fichier_path);
        AuditService::log('document_deleted', 'App\\Models\\DocumentEtudiant', $document->id, $document->toArray(), null, $request);
        $document->delete();
        return response()->json(['message' => 'Document supprimé.']);
    }
}
