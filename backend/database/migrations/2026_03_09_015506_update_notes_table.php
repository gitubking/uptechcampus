<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     * Note: create_notes_table already handles inscription_id FK and unique constraint.
     * This migration is a no-op on fresh databases.
     */
    public function up(): void
    {
        // Already handled in create_notes_table migration
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Nothing to reverse
    }
};
