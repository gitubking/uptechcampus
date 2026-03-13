<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\AuditLog;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Carbon\Carbon;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $request->validate([
            'email'    => 'required|email',
            'password' => 'required|string',
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user) {
            return response()->json(['message' => 'Identifiants incorrects.'], 401);
        }

        // Vérifie blocage
        if ($user->statut === 'bloque' || ($user->bloque_jusqu_a && $user->bloque_jusqu_a->isFuture())) {
            return response()->json([
                'message' => 'Compte bloqué après 5 tentatives. Un lien de déblocage a été envoyé par SMS et Email.',
                'bloque'  => true,
            ], 403);
        }

        if ($user->statut === 'inactif' || $user->statut === 'suspendu') {
            return response()->json(['message' => 'Votre compte est inactif ou suspendu.'], 403);
        }

        if (!Hash::check($request->password, $user->password)) {
            $user->increment('tentatives_echec');
            if ($user->tentatives_echec >= 5) {
                $user->update(['statut' => 'bloque', 'bloque_jusqu_a' => Carbon::now()->addHours(24)]);
            }
            $restant = max(0, 5 - $user->tentatives_echec);
            return response()->json([
                'message'  => 'Identifiants incorrects.',
                'tentatives_restantes' => $restant,
            ], 401);
        }

        // Connexion réussie
        $user->update([
            'tentatives_echec' => 0,
            'bloque_jusqu_a'   => null,
            'last_login_at'    => Carbon::now(),
        ]);

        $token = $user->createToken('uptech-campus')->plainTextToken;

        AuditService::log('login', 'App\\Models\\User', $user->id, null, null, $request);

        return response()->json([
            'token' => $token,
            'user'  => [
                'id'               => $user->id,
                'nom'              => $user->nom,
                'prenom'           => $user->prenom,
                'email'            => $user->email,
                'role'             => $user->role,
                'photo_path'       => $user->photo_path,
                'premier_connexion' => $user->premier_connexion,
                'cgu_acceptees'    => $user->cgu_acceptees,
            ],
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        AuditService::log('logout', 'App\\Models\\User', $request->user()->id, null, null, $request);
        $request->user()->currentAccessToken()->delete();
        return response()->json(['message' => 'Déconnecté avec succès.']);
    }

    public function me(Request $request): JsonResponse
    {
        $user = $request->user();
        return response()->json([
            'id'               => $user->id,
            'nom'              => $user->nom,
            'prenom'           => $user->prenom,
            'email'            => $user->email,
            'role'             => $user->role,
            'statut'           => $user->statut,
            'telephone'        => $user->telephone,
            'photo_path'       => $user->photo_path,
            'premier_connexion' => $user->premier_connexion,
            'cgu_acceptees'    => $user->cgu_acceptees,
        ]);
    }

    public function acceptCgu(Request $request): JsonResponse
    {
        $user = $request->user();
        $user->update(['cgu_acceptees' => true, 'premier_connexion' => false]);
        return response()->json(['message' => 'CGU acceptées.']);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $request->validate([
            'ancien_mot_de_passe' => 'required|string',
            'nouveau_mot_de_passe' => 'required|string|min:8|confirmed',
        ]);

        $user = $request->user();
        if (!Hash::check($request->ancien_mot_de_passe, $user->password)) {
            return response()->json(['message' => 'Ancien mot de passe incorrect.'], 422);
        }

        $user->update([
            'password'          => Hash::make($request->nouveau_mot_de_passe),
            'premier_connexion' => false,
        ]);

        AuditService::log('password_changed', 'App\\Models\\User', $user->id, null, null, $request);

        return response()->json(['message' => 'Mot de passe modifié avec succès.']);
    }
}
