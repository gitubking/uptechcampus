<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\AuditService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Hash;

class UserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $users = User::when($request->role, fn($q, $r) => $q->where('role', $r))
            ->when($request->statut, fn($q, $s) => $q->where('statut', $s))
            ->orderBy('nom')->orderBy('prenom')
            ->get(['id','nom','prenom','email','telephone','role','statut','photo_path','created_at','last_login_at']);
        return response()->json($users);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'nom'       => 'required|string|max:100',
            'prenom'    => 'required|string|max:100',
            'email'     => 'required|email|unique:users',
            'telephone' => 'nullable|string|max:20',
            'role'      => 'required|in:dg,dir_peda,resp_fin,coordinateur,secretariat,intervenant,etudiant',
        ]);

        $user = User::create([
            'nom'        => $request->nom,
            'prenom'     => $request->prenom,
            'email'      => $request->email,
            'telephone'  => $request->telephone,
            'role'       => $request->role,
            'password'   => Hash::make('Uptech@2026'), // mot de passe par défaut
            'statut'     => 'actif',
            'created_by' => $request->user()->id,
        ]);

        AuditService::log('user_created', 'App\\Models\\User', $user->id, null, $user->toArray(), $request);

        return response()->json($user, 201);
    }

    public function update(Request $request, User $user): JsonResponse
    {
        $request->validate([
            'nom'       => 'sometimes|string|max:100',
            'prenom'    => 'sometimes|string|max:100',
            'email'     => 'sometimes|email|unique:users,email,' . $user->id,
            'telephone' => 'nullable|string|max:20',
            'statut'    => 'sometimes|in:actif,inactif,suspendu,bloque',
        ]);

        $avant = $user->toArray();
        $user->update($request->only(['nom','prenom','email','telephone','statut']));
        AuditService::log('user_updated', 'App\\Models\\User', $user->id, $avant, $user->fresh()->toArray(), $request);

        return response()->json($user->fresh());
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        if ($user->id === $request->user()->id) {
            return response()->json(['message' => 'Vous ne pouvez pas supprimer votre propre compte.'], 422);
        }
        AuditService::log('user_deleted', 'App\\Models\\User', $user->id, $user->toArray(), null, $request);
        $user->delete();
        return response()->json(['message' => 'Compte supprimé.']);
    }

    public function resetPassword(Request $request, User $user): JsonResponse
    {
        $user->update([
            'password'          => Hash::make('Uptech@2026'),
            'tentatives_echec'  => 0,
            'bloque_jusqu_a'    => null,
            'statut'            => 'actif',
            'premier_connexion' => true,
        ]);
        AuditService::log('password_reset', 'App\\Models\\User', $user->id, null, null, $request);
        return response()->json(['message' => 'Mot de passe réinitialisé. Nouveau mot de passe: Uptech@2026']);
    }
}
