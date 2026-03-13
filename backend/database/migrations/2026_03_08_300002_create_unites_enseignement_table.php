<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('unites_enseignement', function (Blueprint $table) {
            $table->id();
            $table->foreignId('classe_id')->constrained()->cascadeOnDelete();
            $table->foreignId('intervenant_id')->nullable()->constrained()->nullOnDelete();
            $table->string('code');
            $table->string('intitule');
            $table->decimal('coefficient', 5, 2)->default(1);
            $table->integer('credits_ects')->default(0);
            $table->integer('ordre')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('unites_enseignement');
    }
};
