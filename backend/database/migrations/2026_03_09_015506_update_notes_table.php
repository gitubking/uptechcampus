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
        // Les colonnes ont été partiellement migrées — on ajoute uniquement ce qui manque
        // (FK inscription_id + index unique)
        Schema::table('notes', function (Blueprint $table) {
            $table->unique(['inscription_id', 'ue_id', 'semestre']);
            $table->foreign('inscription_id')->references('id')->on('inscriptions')->cascadeOnDelete();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('notes', function (Blueprint $table) {
            $table->decimal('note', 5, 2)->after('ue_id');
            $table->enum('session', ['normale', 'rattrapage'])->default('normale')->after('note');
            $table->dropColumn(['semestre', 'note_controle', 'note_examen', 'note_rattrapage', 'moyenne']);
        });
    }
};
