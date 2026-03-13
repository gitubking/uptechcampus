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
            $table->foreignId('type_formation_id')
                  ->nullable()
                  ->after('actif')
                  ->constrained('types_formation')
                  ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('filieres', function (Blueprint $table) {
            $table->dropForeign(['type_formation_id']);
            $table->dropColumn('type_formation_id');
        });
    }
};
