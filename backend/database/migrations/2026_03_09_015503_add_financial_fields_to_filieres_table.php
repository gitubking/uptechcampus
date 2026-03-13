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
        Schema::table('filieres', function (Blueprint $table) {
            $table->decimal('frais_inscription', 10, 2)->default(0)->after('description');
            $table->decimal('mensualite', 10, 2)->default(0)->after('frais_inscription');
            $table->unsignedInteger('duree_mois')->nullable()->after('mensualite');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('filieres', function (Blueprint $table) {
            $table->dropColumn(['frais_inscription', 'mensualite', 'duree_mois']);
        });
    }
};
