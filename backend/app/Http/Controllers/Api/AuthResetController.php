<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

class AuthResetController extends Controller
{
    // ── Étape 1 : demande de code OTP ─────────────────────────────────
    public function forgotPassword(Request $request): JsonResponse
    {
        $request->validate(['email' => 'required|email']);

        $user = User::where('email', $request->email)->first();

        if (! $user) {
            // Ne pas révéler si l'email existe ou non (sécurité)
            return response()->json(['message' => 'Si cet email existe, un code vous a été envoyé.']);
        }

        // Générer un code OTP 6 chiffres
        $otp = str_pad(random_int(0, 999999), 6, '0', STR_PAD_LEFT);

        // Supprimer les anciens tokens pour cet email
        DB::table('password_reset_tokens')->where('email', $request->email)->delete();

        // Stocker le token (haché)
        DB::table('password_reset_tokens')->insert([
            'email'      => $request->email,
            'token'      => Hash::make($otp),
            'created_at' => Carbon::now(),
        ]);

        // Log le code (à remplacer par envoi email/SMS en production)
        Log::info("[RESET PASSWORD] Code OTP pour {$request->email} : {$otp}");

        // Tenter d'envoyer par email si mail est configuré
        try {
            \Illuminate\Support\Facades\Mail::raw(
                "Votre code de réinitialisation Uptech Campus : {$otp}\n\nCe code expire dans 10 minutes.",
                fn ($m) => $m->to($request->email)->subject('Code de réinitialisation Uptech Campus')
            );
        } catch (\Throwable $e) {
            // Mail non configuré — code disponible dans les logs
            Log::warning("Mail non envoyé ({$e->getMessage()}) — code disponible dans storage/logs");
        }

        return response()->json([
            'message' => 'Si cet email existe, un code vous a été envoyé.',
            // En développement seulement : retourner le code pour faciliter les tests
            'dev_otp' => app()->isLocal() ? $otp : null,
        ]);
    }

    // ── Étape 2 : vérification du code OTP ────────────────────────────
    public function verifyOtp(Request $request): JsonResponse
    {
        $request->validate([
            'email' => 'required|email',
            'otp'   => 'required|string|size:6',
        ]);

        $record = DB::table('password_reset_tokens')
            ->where('email', $request->email)
            ->first();

        if (! $record) {
            return response()->json(['message' => 'Code invalide ou expiré.'], 422);
        }

        // Vérifier expiration (10 minutes)
        if (Carbon::parse($record->created_at)->addMinutes(10)->isPast()) {
            DB::table('password_reset_tokens')->where('email', $request->email)->delete();
            return response()->json(['message' => 'Code expiré. Veuillez recommencer.'], 422);
        }

        if (! Hash::check($request->otp, $record->token)) {
            return response()->json(['message' => 'Code incorrect.'], 422);
        }

        return response()->json(['message' => 'Code vérifié.']);
    }

    // ── Étape 3 : réinitialisation du mot de passe ────────────────────
    public function resetPassword(Request $request): JsonResponse
    {
        $request->validate([
            'email'                 => 'required|email',
            'otp'                   => 'required|string|size:6',
            'password'              => 'required|string|min:8|confirmed',
        ]);

        $record = DB::table('password_reset_tokens')
            ->where('email', $request->email)
            ->first();

        if (! $record) {
            return response()->json(['message' => 'Code invalide ou expiré.'], 422);
        }

        if (Carbon::parse($record->created_at)->addMinutes(10)->isPast()) {
            DB::table('password_reset_tokens')->where('email', $request->email)->delete();
            return response()->json(['message' => 'Code expiré. Veuillez recommencer.'], 422);
        }

        if (! Hash::check($request->otp, $record->token)) {
            return response()->json(['message' => 'Code incorrect.'], 422);
        }

        $user = User::where('email', $request->email)->first();
        if (! $user) {
            return response()->json(['message' => 'Utilisateur introuvable.'], 404);
        }

        // Mettre à jour le mot de passe et forcer la connexion normale
        $user->update([
            'password'          => Hash::make($request->password),
            'premier_connexion' => false,
            'tentatives_echec'  => 0,
            'bloque_jusqu_a'    => null,
        ]);

        // Supprimer le token
        DB::table('password_reset_tokens')->where('email', $request->email)->delete();

        return response()->json(['message' => 'Mot de passe réinitialisé avec succès.']);
    }
}
