<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('inscription_id')->constrained()->cascadeOnDelete();
            $table->foreignId('ue_id')->constrained('unites_enseignement')->cascadeOnDelete();
            $table->decimal('note', 5, 2);
            $table->enum('session', ['normale', 'rattrapage'])->default('normale');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['inscription_id', 'ue_id', 'session']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notes');
    }
};
