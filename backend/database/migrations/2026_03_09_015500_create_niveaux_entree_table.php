<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('niveaux_entree', function (Blueprint $table) {
            $table->id();
            $table->string('nom');
            $table->string('code')->unique();
            $table->boolean('est_superieur_bac')->default(false);
            $table->unsignedInteger('ordre')->default(0);
            $table->boolean('actif')->default(true);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('niveaux_entree');
    }
};
