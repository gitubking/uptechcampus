<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\FiliereController;
use App\Http\Controllers\Api\ParcoursController;
use App\Http\Controllers\Api\EtudiantController;
use App\Http\Controllers\Api\InscriptionController;
use App\Http\Controllers\Api\DocumentController;
use App\Http\Controllers\Api\IntervenantController;
use App\Http\Controllers\Api\ParametreController;
use App\Http\Controllers\Api\PdfController;
use App\Http\Controllers\Api\PaiementController;
use App\Http\Controllers\Api\DepenseController;
use App\Http\Controllers\Api\SeanceController;
use App\Http\Controllers\Api\PresenceController;
use App\Http\Controllers\Api\UeController;
use App\Http\Controllers\Api\NoteController;
use App\Http\Controllers\Api\RapportController;
use App\Http\Controllers\Api\ConversationController;
use App\Http\Controllers\Api\AnnonceController;
use App\Http\Controllers\Api\EspaceEtudiantController;
use App\Http\Controllers\Api\AuthResetController;
use App\Http\Controllers\Api\TypeFormationController;
use App\Http\Controllers\Api\MatiereController;
use App\Http\Controllers\Api\NiveauEntreeController;
use App\Http\Controllers\Api\NiveauBourseController;
use Illuminate\Support\Facades\Route;

// Auth publiques
Route::post('/auth/login', [AuthController::class, 'login']);

// Réinitialisation mot de passe (routes publiques)
Route::post('/auth/forgot-password', [AuthResetController::class, 'forgotPassword']);
Route::post('/auth/verify-otp',      [AuthResetController::class, 'verifyOtp']);
Route::post('/auth/reset-password',  [AuthResetController::class, 'resetPassword']);

// Routes protégées
Route::middleware('auth:sanctum')->group(function () {

    // Auth
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/accept-cgu', [AuthController::class, 'acceptCgu']);
    Route::post('/auth/change-password', [AuthController::class, 'changePassword']);

    // Utilisateurs (DG uniquement)
    Route::middleware('role:dg')->group(function () {
        Route::apiResource('users', UserController::class);
        Route::post('/users/{user}/reset-password', [UserController::class, 'resetPassword']);
        Route::get('/parametres', [ParametreController::class, 'index']);
        Route::put('/parametres/{cle}', [ParametreController::class, 'update']);
    });

    // Filières (lecture: tous, CRUD: DG)
    Route::get('/filieres', [FiliereController::class, 'index']);
    Route::middleware('role:dg')->group(function () {
        Route::post('/filieres', [FiliereController::class, 'store']);
        Route::put('/filieres/{filiere}', [FiliereController::class, 'update']);
        Route::delete('/filieres/{filiere}', [FiliereController::class, 'destroy']);
        Route::post('/filieres/{filiere}/matieres', [FiliereController::class, 'attachMatiere']);
        Route::delete('/filieres/{filiere}/matieres/{matiere}', [FiliereController::class, 'detachMatiere']);
    });

    // Matières
    Route::get('/matieres', [MatiereController::class, 'index']);
    Route::middleware('role:dg')->group(function () {
        Route::post('/matieres', [MatiereController::class, 'store']);
        Route::put('/matieres/{matiere}', [MatiereController::class, 'update']);
        Route::delete('/matieres/{matiere}', [MatiereController::class, 'destroy']);
    });

    // Niveaux d'entrée
    Route::get('/niveaux-entree', [NiveauEntreeController::class, 'index']);
    Route::middleware('role:dg')->group(function () {
        Route::post('/niveaux-entree', [NiveauEntreeController::class, 'store']);
        Route::put('/niveaux-entree/{niveau}', [NiveauEntreeController::class, 'update']);
        Route::delete('/niveaux-entree/{niveau}', [NiveauEntreeController::class, 'destroy']);
    });

    // Niveaux de bourse
    Route::get('/niveaux-bourse', [NiveauBourseController::class, 'index']);
    Route::middleware('role:dg')->group(function () {
        Route::post('/niveaux-bourse', [NiveauBourseController::class, 'store']);
        Route::put('/niveaux-bourse/{bourse}', [NiveauBourseController::class, 'update']);
        Route::delete('/niveaux-bourse/{bourse}', [NiveauBourseController::class, 'destroy']);
    });

    // Types de formation
    Route::get('/types-formation', fn() => response()->json(\App\Models\TypeFormation::with(['parcours', 'filieres'])->get()));
    Route::middleware('role:dg')->group(function () {
        Route::post('/types-formation', [TypeFormationController::class, 'store']);
        Route::put('/types-formation/{type}', [TypeFormationController::class, 'update']);
        Route::delete('/types-formation/{type}', [TypeFormationController::class, 'destroy']);
    });

    // Parcours
    Route::get('/parcours', [ParcoursController::class, 'index']);
    Route::middleware('role:dg')->group(function () {
        Route::post('/parcours', [ParcoursController::class, 'store']);
        Route::put('/parcours/{parcours}', [ParcoursController::class, 'update']);
    });

    // Années académiques
    Route::get('/annees-academiques', fn() => response()->json(\App\Models\AnneeAcademique::orderBy('date_debut', 'desc')->get()));
    Route::middleware('role:dg')->group(function () {
        Route::post('/annees-academiques', fn(\Illuminate\Http\Request $r) => response()->json(
            \App\Models\AnneeAcademique::create($r->validate(['libelle'=>'required','date_debut'=>'required|date','date_fin'=>'required|date','actif'=>'boolean'])), 201
        ));
        Route::put('/annees-academiques/{annee}', function (\Illuminate\Http\Request $r, \App\Models\AnneeAcademique $annee) {
            $annee->update($r->validate(['libelle'=>'required','date_debut'=>'required|date','date_fin'=>'required|date','actif'=>'boolean']));
            return response()->json($annee->fresh());
        });
        Route::delete('/annees-academiques/{annee}', function (\App\Models\AnneeAcademique $annee) {
            $annee->delete();
            return response()->json(null, 204);
        });
    });

    // Classes
    Route::get('/classes', fn() => response()->json(\App\Models\Classe::with(['filiere','anneeAcademique','parcours'])->get()));
    Route::middleware('role:dg,coordinateur')->group(function () {
        Route::post('/classes', function (\Illuminate\Http\Request $r) {
            $r->validate(['nom'=>'required','filiere_id'=>'required|exists:filieres,id','annee_academique_id'=>'required|exists:annees_academiques,id','parcours_ids'=>'array']);
            $classe = \App\Models\Classe::create(['nom'=>$r->nom,'filiere_id'=>$r->filiere_id,'annee_academique_id'=>$r->annee_academique_id,'created_by'=>$r->user()->id]);
            if ($r->parcours_ids) $classe->parcours()->sync($r->parcours_ids);
            $classe->updateTroncCommun();
            return response()->json($classe->load(['filiere','anneeAcademique','parcours']), 201);
        });
        Route::put('/classes/{classe}', function (\Illuminate\Http\Request $r, \App\Models\Classe $classe) {
            $r->validate(['nom'=>'required','filiere_id'=>'required|exists:filieres,id','annee_academique_id'=>'required|exists:annees_academiques,id','parcours_ids'=>'array']);
            $classe->update(['nom'=>$r->nom,'filiere_id'=>$r->filiere_id,'annee_academique_id'=>$r->annee_academique_id]);
            $classe->parcours()->sync($r->parcours_ids ?? []);
            $classe->updateTroncCommun();
            return response()->json($classe->fresh()->load(['filiere','anneeAcademique','parcours']));
        });
        Route::delete('/classes/{classe}', function (\App\Models\Classe $classe) {
            $classe->delete();
            return response()->json(null, 204);
        });
    });

    // Étudiants
    Route::get('/etudiants', [EtudiantController::class, 'index']);
    Route::get('/etudiants/{etudiant}', [EtudiantController::class, 'show']);
    Route::middleware('role:secretariat,dg')->group(function () {
        Route::post('/etudiants', [EtudiantController::class, 'store']);
        Route::put('/etudiants/{etudiant}', [EtudiantController::class, 'update']);
        Route::post('/etudiants/{etudiant}/photo', [EtudiantController::class, 'uploadPhoto']);
    });

    // Inscriptions
    Route::get('/inscriptions', [InscriptionController::class, 'index']);
    Route::get('/inscriptions/{inscription}/contrat-pdf', [PdfController::class, 'contratInscription']);
    Route::middleware('role:secretariat,dg')->group(function () {
        Route::post('/inscriptions', [InscriptionController::class, 'store']);
        Route::put('/inscriptions/{inscription}', [InscriptionController::class, 'update']);
        Route::post('/inscriptions/{inscription}/valider', [InscriptionController::class, 'valider']);
        Route::put('/inscriptions/{inscription}/statut', [InscriptionController::class, 'updateStatut']);
        Route::post('/inscriptions/{inscription}/contrat', [InscriptionController::class, 'uploadContrat']);
        Route::put('/inscriptions/{inscription}/affecter-classe', [InscriptionController::class, 'affecterClasse']);
    });

    // Documents
    Route::middleware('role:secretariat,dg')->group(function () {
        Route::post('/documents', [DocumentController::class, 'store']);
        Route::delete('/documents/{document}', [DocumentController::class, 'destroy']);
    });

    // Intervenants
    Route::get('/intervenants', [IntervenantController::class, 'index']);
    Route::get('/intervenants/{intervenant}', [IntervenantController::class, 'show']);
    Route::get('/intervenants/{intervenant}/contrat-pdf', [PdfController::class, 'contratIntervenant']);
    Route::middleware('role:dg,secretariat')->group(function () {
        Route::post('/intervenants', [IntervenantController::class, 'store']);
        Route::put('/intervenants/{intervenant}', [IntervenantController::class, 'update']);
        Route::post('/intervenants/{intervenant}/cv', [IntervenantController::class, 'uploadCv']);
    });

    // Stats dashboard
    Route::get('/stats', function () {
        $debutMois = now()->startOfMonth();
        $finMois   = now()->endOfMonth();

        // KPIs financiers
        $encaisseCeMois = \App\Models\Paiement::where('statut', 'confirme')
            ->whereBetween('confirmed_at', [$debutMois, $finMois])
            ->sum('montant');

        $paiementsEnAttente = \App\Models\Paiement::where('statut', 'en_attente')->count();

        $depensesCeMois = \App\Models\Depense::whereIn('statut', ['validee', 'en_attente'])
            ->whereBetween('date_depense', [$debutMois, $finMois])
            ->sum('montant');

        $totalRecettes = \App\Models\Paiement::where('statut', 'confirme')->sum('montant');
        $totalDepenses = \App\Models\Depense::where('statut', 'validee')->sum('montant');
        $soldeTresorerie = $totalRecettes - $totalDepenses;

        // Impayés : somme des mensualités attendues moins les paiements confirmés
        // Approximation : étudiants actifs × mois écoulés depuis début d'année académique
        $impayes = \App\Models\Inscription::where('statut', 'inscrit_actif')
            ->get()
            ->sum(fn($i) => max(0, (float) $i->mensualite_effective - (float) \App\Models\Paiement::where('inscription_id', $i->id)->where('statut', 'confirme')->where('type_paiement', 'mensualite')->sum('montant')));

        // 5 derniers paiements
        $dernierspaiements = \App\Models\Paiement::with(['inscription.etudiant', 'inscription.classe.filiere'])
            ->where('statut', 'confirme')
            ->orderByDesc('confirmed_at')
            ->limit(5)
            ->get();

        return response()->json([
            'etudiants_total'        => \App\Models\Etudiant::count(),
            'inscriptions_actives'   => \App\Models\Inscription::where('statut', 'inscrit_actif')->count(),
            'inscriptions_attente'   => \App\Models\Inscription::whereIn('statut', ['pre_inscrit', 'en_examen'])->count(),
            'intervenants_actifs'    => \App\Models\Intervenant::where('statut', 'actif')->count(),
            'filieres_actives'       => \App\Models\Filiere::where('actif', true)->count(),
            'classes_total'          => \App\Models\Classe::count(),
            // Finance
            'encaisse_ce_mois'       => (float) $encaisseCeMois,
            'impayes_total'          => (float) $impayes,
            'paiements_en_attente'   => $paiementsEnAttente,
            'depenses_ce_mois'       => (float) $depensesCeMois,
            'solde_tresorerie'       => (float) $soldeTresorerie,
            'derniers_paiements'     => $dernierspaiements,
        ]);
    });

    // Paiements
    Route::get('/paiements', [PaiementController::class, 'index']);
    Route::get('/paiements/{paiement}', [PaiementController::class, 'show']);
    Route::middleware('role:secretariat,dg,resp_fin')->group(function () {
        Route::post('/paiements', [PaiementController::class, 'store']);
    });
    Route::middleware('role:dg,resp_fin')->group(function () {
        Route::post('/paiements/{paiement}/confirmer', [PaiementController::class, 'confirmer']);
        Route::post('/paiements/{paiement}/rejeter', [PaiementController::class, 'rejeter']);
    });

    // Dépenses
    Route::get('/depenses', [DepenseController::class, 'index']);
    Route::get('/depenses/{depense}', [DepenseController::class, 'show']);
    Route::middleware('role:secretariat,dg')->group(function () {
        Route::post('/depenses', [DepenseController::class, 'store']);
        Route::post('/depenses/{depense}/justificatif', [DepenseController::class, 'uploadJustificatif']);
    });
    Route::middleware('role:dg')->group(function () {
        Route::post('/depenses/{depense}/valider', [DepenseController::class, 'valider']);
        Route::post('/depenses/{depense}/rejeter', [DepenseController::class, 'rejeter']);
    });

    // Séances
    Route::get('/seances', [SeanceController::class, 'index']);
    Route::get('/seances/{seance}/presences', [PresenceController::class, 'index']);
    Route::middleware('role:dg,dir_peda,coordinateur,secretariat,intervenant')->group(function () {
        Route::post('/seances', [SeanceController::class, 'store']);
        Route::put('/seances/{seance}', [SeanceController::class, 'update']);
        Route::delete('/seances/{seance}', [SeanceController::class, 'destroy']);
        Route::post('/seances/{seance}/annuler', [SeanceController::class, 'annuler']);
        Route::post('/seances/{seance}/presences', [PresenceController::class, 'batchUpsert']);
    });

    // Unités d'enseignement
    Route::get('/ues', [UeController::class, 'index']);
    Route::middleware('role:dg,dir_peda,coordinateur')->group(function () {
        Route::post('/ues', [UeController::class, 'store']);
        Route::put('/ues/{ue}', [UeController::class, 'update']);
        Route::delete('/ues/{ue}', [UeController::class, 'destroy']);
    });

    // Notes
    Route::get('/notes', [NoteController::class, 'index']);
    Route::get('/notes/bulletin/{inscription}', [NoteController::class, 'bulletin']);
    Route::middleware('role:dg,dir_peda,coordinateur')->group(function () {
        Route::post('/notes/batch', [NoteController::class, 'batchUpsert']);
    });

    // Rapports
    Route::get('/rapports', [RapportController::class, 'index']);

    // Conversations
    Route::get('/conversations', [ConversationController::class, 'index']);
    Route::get('/conversations/{conversation}', [ConversationController::class, 'show']);
    Route::post('/conversations', [ConversationController::class, 'store']);
    Route::post('/conversations/{conversation}/messages', [ConversationController::class, 'sendMessage']);

    // Annonces
    Route::get('/annonces', [AnnonceController::class, 'index']);
    Route::middleware('role:dg,dir_peda,coordinateur,secretariat')->group(function () {
        Route::post('/annonces', [AnnonceController::class, 'store']);
        Route::put('/annonces/{annonce}', [AnnonceController::class, 'update']);
        Route::delete('/annonces/{annonce}', [AnnonceController::class, 'destroy']);
        Route::post('/annonces/{annonce}/publier', [AnnonceController::class, 'publier']);
    });

    // Espace étudiant
    Route::middleware('role:etudiant')->get('/espace-etudiant/dashboard', [EspaceEtudiantController::class, 'dashboard']);

    // Tarifs
    Route::get('/tarifs', fn() => response()->json(\App\Models\TarifIntervenant::with(['typeFormation','anneeAcademique'])->get()));
    Route::middleware('role:dg')->group(function () {
        Route::post('/tarifs', function (\Illuminate\Http\Request $r) {
            $r->validate(['type_formation_id'=>'required|exists:types_formation,id','annee_academique_id'=>'required|exists:annees_academiques,id','montant_horaire'=>'required|numeric|min:0','date_effet'=>'required|date']);
            $tarif = \App\Models\TarifIntervenant::updateOrCreate(
                ['type_formation_id'=>$r->type_formation_id,'annee_academique_id'=>$r->annee_academique_id],
                ['montant_horaire'=>$r->montant_horaire,'date_effet'=>$r->date_effet,'created_by'=>$r->user()->id]
            );
            return response()->json($tarif->load(['typeFormation','anneeAcademique']), 201);
        });
    });
});
