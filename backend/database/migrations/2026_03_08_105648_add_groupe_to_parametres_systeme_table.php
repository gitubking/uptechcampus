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
        Schema::table('parametres_systeme', function (Blueprint $table) {
            $table->string('groupe')->default('general')->after('cle');
        });
    }

    public function down(): void
    {
        Schema::table('parametres_systeme', function (Blueprint $table) {
            $table->dropColumn('groupe');
        });
    }
};
