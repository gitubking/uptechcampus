-- ============================================================
-- Script SQL — Tables manquantes pour Uptech Campus
-- À exécuter dans Supabase > SQL Editor
-- ============================================================

-- ── Années académiques ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS annees_academiques (
  id bigserial PRIMARY KEY,
  libelle varchar(255) NOT NULL,
  date_debut date NOT NULL,
  date_fin date NOT NULL,
  actif boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

INSERT INTO annees_academiques (libelle, date_debut, date_fin, actif)
  VALUES ('2025-2026', '2025-10-01', '2026-06-30', true)
  ON CONFLICT DO NOTHING;

-- ── Paramètres système ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parametres_systeme (
  id bigserial PRIMARY KEY,
  cle varchar(255) NOT NULL UNIQUE,
  groupe varchar(255) NOT NULL DEFAULT 'general',
  valeur text NOT NULL,
  description varchar(255),
  updated_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

INSERT INTO parametres_systeme (cle, groupe, valeur, description) VALUES
  ('nom_etablissement',        'etablissement',  'Institut UPTECH Formation',                    'Nom officiel de l''établissement'),
  ('abreviation',              'etablissement',  'UPTECH',                                       'Abréviation'),
  ('adresse',                  'etablissement',  'Amitié 1, Villa n°3031 — Dakar, Sénégal',     'Adresse postale'),
  ('telephone',                'etablissement',  '+221 77 841 50 44',                            'Numéro de téléphone principal'),
  ('email_contact',            'etablissement',  'contact@uptechformation.com',                  'Email de contact'),
  ('site_web',                 'etablissement',  'https://uptechformation.com',                  'Site web'),
  ('devise',                   'etablissement',  'XOF',                                          'Devise utilisée'),
  ('fuseau_horaire',           'etablissement',  'Africa/Dakar',                                 'Fuseau horaire'),
  ('cgu_texte',                'etablissement',  'En utilisant UPTECH Campus, vous acceptez de respecter le règlement intérieur de l''Institut UPTECH Formation.',  'Texte des CGU'),
  ('seuil_validation_ue',      'academique',     '10',                                           'Moyenne minimale pour valider une UE (sur 20)'),
  ('seuil_mention_passable',   'academique',     '10',                                           'Seuil mention Passable'),
  ('seuil_mention_ab',         'academique',     '12',                                           'Seuil mention Assez Bien'),
  ('seuil_mention_bien',       'academique',     '14',                                           'Seuil mention Bien'),
  ('seuil_mention_tb',         'academique',     '16',                                           'Seuil mention Très Bien'),
  ('paiement_wave',            'finance',        '1',                                            'Accepter les paiements Wave'),
  ('paiement_orange_money',    'finance',        '1',                                            'Accepter les paiements Orange Money'),
  ('paiement_virement',        'finance',        '1',                                            'Accepter les virements bancaires'),
  ('paiement_especes',         'finance',        '1',                                            'Accepter les paiements en espèces'),
  ('paiement_cheque',          'finance',        '0',                                            'Accepter les chèques'),
  ('seuil_blocage_acces_jours','finance',        '30',                                           'Jours de retard avant blocage accès'),
  ('seuil_depense_justificatif','finance',       '50000',                                        'Montant au-delà duquel un justificatif est obligatoire'),
  ('seuil_tresorerie_alerte',  'finance',        '0',                                            'Seuil de trésorerie déclenchant une alerte'),
  ('relance_j3',               'relances',       '1',                                            'Activer relance J+3 (SMS étudiant)'),
  ('relance_j7',               'relances',       '1',                                            'Activer relance J+7 (SMS + WhatsApp + Email)'),
  ('relance_j15',              'relances',       '1',                                            'Activer relance J+15 (notification secrétariat)'),
  ('relance_j30',              'relances',       '1',                                            'Activer relance J+30 (notification direction)'),
  ('notif_nouveau_paiement',   'notifications',  '1',                                            'Notifier à chaque nouveau paiement enregistré'),
  ('notif_impaye_j30',         'notifications',  '1',                                            'Notifier la direction à J+30 d''impayé'),
  ('notif_absence',            'notifications',  '1',                                            'Notifier automatiquement les absences via émargement'),
  ('seuil_absence_alerte',     'notifications',  '30',                                           'Pourcentage d''absences déclenchant une alerte direction')
ON CONFLICT (cle) DO NOTHING;

-- ── Tarifs intervenants ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tarifs_intervenants (
  id bigserial PRIMARY KEY,
  type_formation_id bigint NOT NULL REFERENCES types_formation(id),
  annee_academique_id bigint NOT NULL REFERENCES annees_academiques(id),
  montant_horaire decimal(10, 2) NOT NULL,
  date_effet date NOT NULL,
  created_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE (type_formation_id, annee_academique_id)
);

-- ── Conversations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id bigserial PRIMARY KEY,
  type varchar(10) NOT NULL DEFAULT 'direct',
  nom varchar(255),
  couleur varchar(20) DEFAULT '#3b82f6',
  created_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- ── Participants aux conversations ────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_participants (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dernier_lu_at timestamptz,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  UNIQUE (conversation_id, user_id)
);

-- ── Messages ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id bigint REFERENCES users(id) ON DELETE SET NULL,
  contenu text NOT NULL,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);

-- ── Annonces ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS annonces (
  id bigserial PRIMARY KEY,
  titre varchar(255) NOT NULL,
  type varchar(20) NOT NULL DEFAULT 'info',
  contenu text NOT NULL,
  destinataires jsonb,
  canaux jsonb,
  statut varchar(20) NOT NULL DEFAULT 'brouillon',
  epingle boolean NOT NULL DEFAULT false,
  publie_at timestamptz,
  created_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW()
);
