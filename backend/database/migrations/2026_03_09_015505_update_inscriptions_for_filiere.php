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
        Schema::table('inscriptions', function (Blueprint $table) {
            $table->foreignId('filiere_id')->nullable()->after('etudiant_id')
                  ->constrained('filieres')->nullOnDelete();
            $table->foreignId('niveau_entree_id')->nullable()->after('filiere_id')
                  ->constrained('niveaux_entree')->nullOnDelete();
            $table->foreignId('niveau_bourse_id')->nullable()->after('niveau_entree_id')
                  ->constrained('niveaux_bourse')->nullOnDelete();
            $table->decimal('frais_tenue', 10, 2)->default(0)->after('mensualite');
            $table->boolean('acces_bloque')->default(false)->after('statut');
        });

        // Rendre classe_id et parcours_id nullables
        Schema::table('inscriptions', function (Blueprint $table) {
            $table->foreignId('classe_id')->nullable()->change();
            $table->foreignId('parcours_id')->nullable()->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('inscriptions', function (Blueprint $table) {
            $table->dropForeign(['filiere_id']);
            $table->dropForeign(['niveau_entree_id']);
            $table->dropForeign(['niveau_bourse_id']);
            $table->dropColumn(['filiere_id', 'niveau_entree_id', 'niveau_bourse_id', 'frais_tenue', 'acces_bloque']);
        });
    }
};
