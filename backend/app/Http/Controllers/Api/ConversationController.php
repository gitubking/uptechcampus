<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Conversation;
use App\Models\Message;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ConversationController extends Controller
{
    /**
     * Liste les conversations de l'utilisateur courant avec dernier message + nb non-lus.
     */
    public function index(Request $request): JsonResponse
    {
        $userId = $request->user()->id;

        $conversations = Conversation::whereHas('participants', fn($q) => $q->where('user_id', $userId))
            ->with([
                'participants',
                'messages' => fn($q) => $q->latest()->limit(1),
                'messages.sender',
            ])
            ->latest('updated_at')
            ->get()
            ->map(function (Conversation $conv) use ($userId) {
                // Dernier lu pour cet utilisateur
                $pivot = $conv->participants->firstWhere('id', $userId)?->pivot;
                $dernierLuAt = $pivot?->dernier_lu_at;

                // Nb non-lus
                $nbNonLus = $dernierLuAt
                    ? $conv->messages()->where('created_at', '>', $dernierLuAt)->count()
                    : $conv->messages()->count();

                $dernierMessage = $conv->messages->first();

                return [
                    'id'              => $conv->id,
                    'type'            => $conv->type,
                    'nom'             => $conv->nom,
                    'couleur'         => $conv->couleur,
                    'participants'    => $conv->participants->map(fn($u) => [
                        'id'    => $u->id,
                        'nom'   => $u->nom,
                        'prenom' => $u->prenom,
                        'role'  => $u->role,
                    ]),
                    'dernier_message' => $dernierMessage ? [
                        'contenu'    => $dernierMessage->contenu,
                        'created_at' => $dernierMessage->created_at,
                        'sender'     => $dernierMessage->sender ? $dernierMessage->sender->prenom . ' ' . $dernierMessage->sender->nom : null,
                    ] : null,
                    'nb_non_lus'      => $nbNonLus,
                ];
            });

        return response()->json($conversations);
    }

    /**
     * Retourne les 100 derniers messages d'une conversation + marque comme lu.
     */
    public function show(Request $request, Conversation $conversation): JsonResponse
    {
        $userId = $request->user()->id;

        // Vérifier que l'utilisateur est participant
        $isParticipant = $conversation->participants()->where('user_id', $userId)->exists();
        if (! $isParticipant) {
            return response()->json(['message' => 'Accès refusé'], 403);
        }

        // Marquer comme lu
        $conversation->participants()->updateExistingPivot($userId, [
            'dernier_lu_at' => now(),
        ]);

        $messages = $conversation->messages()
            ->with('sender')
            ->latest()
            ->limit(100)
            ->get()
            ->reverse()
            ->values()
            ->map(fn(Message $m) => [
                'id'          => $m->id,
                'contenu'     => $m->contenu,
                'fichier_nom' => $m->fichier_nom,
                'fichier_taille' => $m->fichier_taille,
                'created_at'  => $m->created_at,
                'is_mine'     => $m->sender_id === $userId,
                'sender'      => $m->sender ? [
                    'id'     => $m->sender->id,
                    'nom'    => $m->sender->nom,
                    'prenom' => $m->sender->prenom,
                ] : null,
            ]);

        return response()->json([
            'conversation' => [
                'id'           => $conversation->id,
                'type'         => $conversation->type,
                'nom'          => $conversation->nom,
                'couleur'      => $conversation->couleur,
                'participants' => $conversation->participants->map(fn($u) => [
                    'id'     => $u->id,
                    'nom'    => $u->nom,
                    'prenom' => $u->prenom,
                ]),
            ],
            'messages' => $messages,
        ]);
    }

    /**
     * Crée une nouvelle conversation.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type'     => 'required|in:groupe,direct',
            'nom'      => 'nullable|string|max:255',
            'couleur'  => 'nullable|string|max:20',
            'user_ids' => 'nullable|array',
            'user_ids.*' => 'integer|exists:users,id',
        ]);

        $conversation = Conversation::create([
            'type'       => $data['type'],
            'nom'        => $data['nom'] ?? null,
            'couleur'    => $data['couleur'] ?? '#3b82f6',
            'created_by' => $request->user()->id,
        ]);

        // Ajouter l'auteur + les destinataires comme participants
        $participantIds = array_unique(array_merge([$request->user()->id], $data['user_ids'] ?? []));
        $conversation->participants()->attach($participantIds, ['dernier_lu_at' => null]);

        $conversation->load('participants');

        return response()->json($conversation, 201);
    }

    /**
     * Envoie un message dans une conversation.
     */
    public function sendMessage(Request $request, Conversation $conversation): JsonResponse
    {
        $userId = $request->user()->id;

        // Vérifier participant
        $isParticipant = $conversation->participants()->where('user_id', $userId)->exists();
        if (! $isParticipant) {
            return response()->json(['message' => 'Accès refusé'], 403);
        }

        $data = $request->validate([
            'contenu' => 'required|string|max:5000',
        ]);

        $message = Message::create([
            'conversation_id' => $conversation->id,
            'sender_id'       => $userId,
            'contenu'         => $data['contenu'],
        ]);

        // Marquer comme lu pour l'expéditeur
        $conversation->participants()->updateExistingPivot($userId, [
            'dernier_lu_at' => now(),
        ]);

        $conversation->touch();

        $message->load('sender');

        return response()->json([
            'id'          => $message->id,
            'contenu'     => $message->contenu,
            'created_at'  => $message->created_at,
            'is_mine'     => true,
            'sender'      => [
                'id'     => $message->sender->id,
                'nom'    => $message->sender->nom,
                'prenom' => $message->sender->prenom,
            ],
        ], 201);
    }
}
