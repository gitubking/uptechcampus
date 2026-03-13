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
        Schema::table('etudiants', function (Blueprint $table) {
            $table->string('nom_parent')->nullable()->after('cni_numero');
            $table->string('telephone_parent', 20)->nullable()->after('nom_parent');
        });
    }

    public function down(): void
    {
        Schema::table('etudiants', function (Blueprint $table) {
            $table->dropColumn(['nom_parent', 'telephone_parent']);
        });
    }
};
