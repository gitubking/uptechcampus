<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Inscription;
use App\Models\Intervenant;
use App\Models\ParametreSysteme;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\Response;

class PdfController extends Controller
{
    private function getEtablissement(): array
    {
        $params = ParametreSysteme::whereIn('cle', [
            'nom_etablissement', 'abreviation', 'adresse',
            'telephone', 'email_contact', 'site_web',
        ])->pluck('valeur', 'cle')->toArray();

        return $params;
    }

    public function contratInscription(Inscription $inscription): Response
    {
        $inscription->load([
            'etudiant',
            'classe.filiere',
            'parcours.typeFormation',
            'anneeAcademique',
        ]);

        $etudiant = $inscription->etudiant;
        $etablissement = $this->getEtablissement();

        $pdf = Pdf::loadView('pdf.contrat_inscription', compact('inscription', 'etudiant', 'etablissement'));
        $pdf->setPaper('A4', 'portrait');

        $filename = 'contrat_inscription_' . $etudiant->numero_etudiant . '.pdf';

        return $pdf->stream($filename);
    }

    public function contratIntervenant(Intervenant $intervenant): Response
    {
        $intervenant->load(['filieres.filiere', 'anneeAcademique']);
        $etablissement = $this->getEtablissement();

        $pdf = Pdf::loadView('pdf.contrat_intervenant', compact('intervenant', 'etablissement'));
        $pdf->setPaper('A4', 'portrait');

        $filename = 'contrat_' . $intervenant->numero_contrat . '.pdf';

        return $pdf->stream($filename);
    }
}
