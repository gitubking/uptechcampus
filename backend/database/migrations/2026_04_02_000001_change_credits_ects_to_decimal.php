<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('unites_enseignement', function (Blueprint $table) {
            $table->decimal('credits_ects', 5, 1)->default(0)->change();
        });
    }

    public function down(): void
    {
        Schema::table('unites_enseignement', function (Blueprint $table) {
            $table->integer('credits_ects')->default(0)->change();
        });
    }
};
