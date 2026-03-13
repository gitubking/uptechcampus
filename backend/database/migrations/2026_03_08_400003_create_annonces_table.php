<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('annonces', function (Blueprint $table) {
            $table->id();
            $table->string('titre');
            $table->enum('type', ['info', 'urgent', 'alerte', 'evenement'])->default('info');
            $table->text('contenu');
            $table->json('destinataires')->nullable(); // ["tous"] | ["etudiants","intervenants"]
            $table->json('canaux')->nullable();        // ["messagerie","email","sms"]
            $table->enum('statut', ['brouillon', 'publie'])->default('brouillon');
            $table->boolean('epingle')->default(false);
            $table->timestamp('publie_at')->nullable();
            $table->foreignId('created_by')->constrained('users');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('annonces');
    }
};
