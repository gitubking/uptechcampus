-- ============================================================
-- Créer la table niveaux_entree dans Supabase
-- À exécuter dans : Supabase > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS niveaux_entree (
  id              bigserial PRIMARY KEY,
  nom             varchar(255) NOT NULL,
  code            varchar(50)  NOT NULL DEFAULT '',
  est_superieur_bac boolean    NOT NULL DEFAULT false,
  ordre           integer      NOT NULL DEFAULT 0,
  actif           boolean      NOT NULL DEFAULT true,
  created_at      timestamptz  DEFAULT NOW(),
  updated_at      timestamptz  DEFAULT NOW()
);

-- Données initiales (niveaux typiques Sénégal)
INSERT INTO niveaux_entree (nom, code, est_superieur_bac, ordre, actif) VALUES
  ('BFEM / Brevet',    'BFEM',     false, 1, true),
  ('Baccalauréat',     'BAC',      false, 2, true),
  ('BTS / DUT',        'BTS',      true,  3, true),
  ('Licence (L3)',     'LIC',      true,  4, true),
  ('Master',           'MASTER',   true,  5, true),
  ('Autres',           'AUTRE',    false, 6, true)
ON CONFLICT DO NOTHING;
