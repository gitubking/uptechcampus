import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { Pool } from 'pg'
// @ts-ignore — CJS default export works at runtime
import jwt from 'jsonwebtoken'
// @ts-ignore — CJS default export works at runtime
import bcrypt from 'bcryptjs'
import type { IncomingMessage, ServerResponse } from 'http'
// @ts-ignore
import { createReport } from 'docx-templates'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// ─── DB ──────────────────────────────────────────────────────────────────────
// Strip sslmode from URL to avoid conflict with explicit ssl option
function buildPoolConfig() {
  const rawUrl = process.env.DATABASE_URL || 'postgresql://localhost/placeholder'
  try {
    const u = new URL(rawUrl)
    u.searchParams.delete('sslmode')
    // pgbouncer=true → transaction mode (required for serverless / Vercel)
    u.searchParams.set('pgbouncer', 'true')
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } }
  } catch {
    return { connectionString: rawUrl, ssl: { rejectUnauthorized: false } }
  }
}
// max:1 — session mode pgbouncer: 1 connection per serverless instance
const pool = new Pool({ ...buildPoolConfig(), max: 1, idleTimeoutMillis: 5000, connectionTimeoutMillis: 8000 })

// ─── Migrations automatiques (idempotentes) ───────────────────────────────────
pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS niveau INT DEFAULT 1`).catch(() => {})
pool.query(`ALTER TABLE classes ALTER COLUMN filiere_id DROP NOT NULL`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS contenu_seance TEXT`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS fi_module_id INT`).catch(() => {})
pool.query(`ALTER TABLE seances ALTER COLUMN classe_id DROP NOT NULL`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS objectifs TEXT`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS signe_enseignant_at TIMESTAMP`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS signe_enseignant_id INT REFERENCES enseignants(id) ON DELETE SET NULL`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS chapitre TEXT`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS objectifs_atteints VARCHAR(10) CHECK (objectifs_atteints IN ('oui','partiel','non'))`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS remarques TEXT`).catch(() => {})
pool.query(`DO $$ BEGIN ALTER TABLE seances DROP CONSTRAINT IF EXISTS seances_statut_check; ALTER TABLE seances ADD CONSTRAINT seances_statut_check CHECK (statut IN ('planifie','confirme','annule','reporte','effectue')); EXCEPTION WHEN OTHERS THEN NULL; END $$`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS specialite VARCHAR(150)`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS grade VARCHAR(80)`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS type_contrat VARCHAR(30) DEFAULT 'vacataire'`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS tarif_horaire DECIMAL(10,2) DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS tronc_commun_id INT REFERENCES classes(id) ON DELETE SET NULL`).catch(() => {})
pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS date_debut_cours DATE`).catch(() => {})
pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS capacite INT DEFAULT 30`).catch(() => {})
// Table de jonction many-to-many : une classe peut appartenir à plusieurs tronc commun
pool.query(`CREATE TABLE IF NOT EXISTS classe_tronc_commun (
  id SERIAL PRIMARY KEY,
  classe_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  tronc_commun_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  UNIQUE(classe_id, tronc_commun_id)
)`).catch(() => {})
// Migration : copier les anciens tronc_commun_id vers la nouvelle table
pool.query(`INSERT INTO classe_tronc_commun (classe_id, tronc_commun_id)
  SELECT id, tronc_commun_id FROM classes WHERE tronc_commun_id IS NOT NULL
  ON CONFLICT DO NOTHING`).catch(() => {})
pool.query(`ALTER TABLE filieres ADD COLUMN IF NOT EXISTS montant_tenue INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE filieres ADD COLUMN IF NOT EXISTS tarif_horaire DECIMAL(10,2) DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE niveaux_bourse ADD COLUMN IF NOT EXISTS applique_tenue BOOLEAN DEFAULT FALSE`).catch(() => {})
pool.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS date_abandon DATE`).catch(() => {})
pool.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS motif_abandon TEXT`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS coefficient DECIMAL(5,2) DEFAULT 1`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS ordre INTEGER DEFAULT 0`).catch(() => {})
// Lien UE → matière globale (pour coefficient cross-filière en tronc commun)
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS matiere_id INT REFERENCES matieres(id) ON DELETE SET NULL`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS volume_horaire INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS semestre INTEGER DEFAULT 1`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS categorie_ue VARCHAR(30)`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS intitule_ue VARCHAR(255)`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS cm INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS td INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS tp INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS tpe INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ALTER COLUMN credits_ects TYPE DECIMAL(5,1)`).catch(() => {})
// Colonnes maquette sur filiere_matiere pour stocker le template par filière
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS semestre INTEGER DEFAULT 1`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS categorie_ue VARCHAR(30)`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS code_ue VARCHAR(30)`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS intitule_ue VARCHAR(255)`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS cm INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS td INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS tp INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS tpe INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS vht INTEGER DEFAULT 0`).catch(() => {})
pool.query(`DO $$ BEGIN ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_type_paiement_check; ALTER TABLE paiements ADD CONSTRAINT paiements_type_paiement_check CHECK (type_paiement IN ('frais_inscription','mensualite','tenue','rattrapage','autre')); EXCEPTION WHEN OTHERS THEN NULL; END $$`).catch(() => {})
pool.query(`ALTER TABLE types_formation ADD COLUMN IF NOT EXISTS has_niveau BOOLEAN DEFAULT FALSE`).catch(() => {})
pool.query(`ALTER TABLE types_formation ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => {})
pool.query(`ALTER TABLE types_formation ADD COLUMN IF NOT EXISTS est_individuel BOOLEAN DEFAULT FALSE`).catch(() => {})

// ─── Colonnes rapport ministère ───────────────────────────────────────────────
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS date_naissance DATE`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS lieu_naissance VARCHAR(150)`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS sexe VARCHAR(15)`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS diplome TEXT`).catch(() => {})
pool.query(`ALTER TABLE personnel ADD COLUMN IF NOT EXISTS date_naissance DATE`).catch(() => {})
pool.query(`ALTER TABLE personnel ADD COLUMN IF NOT EXISTS lieu_naissance VARCHAR(150)`).catch(() => {})
pool.query(`ALTER TABLE personnel ADD COLUMN IF NOT EXISTS diplome TEXT`).catch(() => {})
pool.query(`ALTER TABLE personnel ADD COLUMN IF NOT EXISTS grade VARCHAR(100)`).catch(() => {})
pool.query(`ALTER TABLE personnel ADD COLUMN IF NOT EXISTS fonction VARCHAR(150)`).catch(() => {})

// ─── Migrations absences justifiées + portail parents ─────────────────────────
pool.query(`ALTER TABLE presences ADD COLUMN IF NOT EXISTS justifie BOOLEAN DEFAULT FALSE`).catch(() => {})
pool.query(`ALTER TABLE presences ADD COLUMN IF NOT EXISTS motif_justification TEXT`).catch(() => {})
pool.query(`CREATE TABLE IF NOT EXISTS parent_etudiant (
  id SERIAL PRIMARY KEY,
  parent_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  etudiant_id INT NOT NULL REFERENCES etudiants(id) ON DELETE CASCADE,
  UNIQUE(parent_user_id, etudiant_id)
)`).catch(() => {})
pool.query(`DO $$ BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
  ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('dg','dir_peda','resp_fin','coordinateur','secretariat','enseignant','etudiant','parent'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$`).catch(() => {})

// ─── Migration: avis qualité séances (anonymes) ───────────────────────────────
pool.query(`CREATE TABLE IF NOT EXISTS avis_seance (
  id SERIAL PRIMARY KEY,
  seance_id INT NOT NULL REFERENCES seances(id) ON DELETE CASCADE,
  inscription_id INT NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  note SMALLINT NOT NULL CHECK (note BETWEEN 1 AND 5),
  commentaire TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(seance_id, inscription_id)
)`).catch(() => {})

// ─── Migration: strip HTML de contenu_seance / objectifs / notes existants ────
pool.query(`
  UPDATE seances
  SET
    contenu_seance = trim(regexp_replace(regexp_replace(contenu_seance, '<[^>]*>', '', 'g'), '&[^;]{1,10};', ' ', 'g')),
    objectifs      = trim(regexp_replace(regexp_replace(objectifs,      '<[^>]*>', '', 'g'), '&[^;]{1,10};', ' ', 'g')),
    notes          = trim(regexp_replace(regexp_replace(notes,          '<[^>]*>', '', 'g'), '&[^;]{1,10};', ' ', 'g'))
  WHERE (contenu_seance IS NOT NULL AND contenu_seance LIKE '%<%')
     OR (objectifs      IS NOT NULL AND objectifs      LIKE '%<%')
     OR (notes          IS NOT NULL AND notes          LIKE '%<%')
`).catch(() => {})

// ─── Migration: unicité (classe_id, matiere_id) dans unites_enseignement ───────
pool.query(`
  DO $$
  DECLARE dup RECORD; keep_id INT;
  BEGIN
    FOR dup IN
      SELECT classe_id, matiere_id FROM unites_enseignement
      WHERE matiere_id IS NOT NULL
      GROUP BY classe_id, matiere_id HAVING COUNT(*) > 1
    LOOP
      SELECT id INTO keep_id FROM unites_enseignement
      WHERE classe_id = dup.classe_id AND matiere_id = dup.matiere_id
      ORDER BY CASE WHEN enseignant_id IS NOT NULL THEN 0 ELSE 1 END, id LIMIT 1;
      UPDATE notes SET ue_id = keep_id WHERE ue_id IN (
        SELECT id FROM unites_enseignement
        WHERE classe_id = dup.classe_id AND matiere_id = dup.matiere_id AND id <> keep_id
      );
      DELETE FROM unites_enseignement
      WHERE classe_id = dup.classe_id AND matiere_id = dup.matiere_id AND id <> keep_id;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ue_classe_matiere_unique_idx') THEN
      CREATE UNIQUE INDEX ue_classe_matiere_unique_idx
        ON unites_enseignement (classe_id, matiere_id) WHERE matiere_id IS NOT NULL;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END $$
`).catch(() => {})

// (migration semestre retirée — nettoyage désormais géré dans POST /classes/:id/generer-ues)

pool.query(`CREATE TABLE IF NOT EXISTS infrastructures (
  id SERIAL PRIMARY KEY,
  designation VARCHAR(200) NOT NULL,
  categorie VARCHAR(80) NOT NULL DEFAULT 'Pédagogie',
  nombre INTEGER NOT NULL DEFAULT 1,
  etat VARCHAR(100) NOT NULL DEFAULT 'Bon/Fonctionnel',
  ordre INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

pool.query(`CREATE TABLE IF NOT EXISTS materiels_pedagogiques (
  id SERIAL PRIMARY KEY,
  designation VARCHAR(200) NOT NULL,
  nombre INTEGER NOT NULL DEFAULT 1,
  etat VARCHAR(100) NOT NULL DEFAULT 'Bon/Fonctionnel',
  ordre INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

// ─── Tables Notifications ─────────────────────────────────────────────────────
pool.query(`CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL DEFAULT 'custom',
  sujet VARCHAR(200) NOT NULL,
  corps TEXT NOT NULL,
  canal VARCHAR(20) NOT NULL DEFAULT 'email',
  nb_destinataires INTEGER DEFAULT 0,
  nb_envoyes INTEGER DEFAULT 0,
  nb_erreurs INTEGER DEFAULT 0,
  cible_type VARCHAR(30) DEFAULT 'tous',
  cible_id INTEGER,
  annee_id INTEGER,
  envoye_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

pool.query(`CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  sujet VARCHAR(200) NOT NULL,
  corps TEXT NOT NULL,
  variables TEXT DEFAULT '',
  actif BOOLEAN DEFAULT TRUE
)`).catch(() => {})

// ─── Notifications individuelles in-app (cloche) ──────────────────────────────
pool.query(`CREATE TABLE IF NOT EXISTS user_notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL DEFAULT 'info',
  titre VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  lu BOOLEAN DEFAULT FALSE,
  lu_at TIMESTAMP,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})
pool.query(`CREATE INDEX IF NOT EXISTS idx_user_notif_user_lu ON user_notifications(user_id, lu)`).catch(() => {})

// Seed templates par défaut
;(async () => {
  try {
    const tpls = [
      ['resultats', 'Résultats disponibles', '📊 Vos résultats de {session} sont disponibles – UPTECH Campus',
       `<p>Bonjour <strong>{prenom} {nom}</strong>,</p>
<p>Nous avons le plaisir de vous informer que les résultats de la session <strong>{session}</strong> pour votre classe <strong>{classe}</strong> sont désormais disponibles.</p>
<p>Vous pouvez consulter votre bulletin de notes en vous connectant à votre espace étudiant.</p>
<p>Cordialement,<br/>L'équipe pédagogique<br/><strong>UPTECH Campus</strong></p>`,
       '{prenom}, {nom}, {session}, {classe}, {filiere}'],
      ['convocation', 'Convocation jury', '📋 Convocation au jury – {session} – UPTECH Campus',
       `<p>Bonjour <strong>{prenom} {nom}</strong>,</p>
<p>Vous êtes convoqué(e) au jury de la session <strong>{session}</strong> pour votre classe <strong>{classe}</strong>.</p>
<p>Veuillez vous assurer d'avoir respecté toutes les conditions de présence et de paiement avant la tenue du jury.</p>
<p>Cordialement,<br/>La Direction Pédagogique<br/><strong>UPTECH Campus</strong></p>`,
       '{prenom}, {nom}, {session}, {classe}, {filiere}'],
      ['paiement', 'Rappel paiement', '⚠️ Rappel de paiement – {mois} – UPTECH Campus',
       `<p>Bonjour <strong>{prenom} {nom}</strong>,</p>
<p>Nous vous rappelons que votre mensualité de <strong>{montant} FCFA</strong> pour le mois de <strong>{mois}</strong> est due.</p>
<p>Merci de régulariser votre situation au plus tôt pour éviter toute interruption de vos accès.</p>
<p>Cordialement,<br/>Le Service Financier<br/><strong>UPTECH Campus</strong></p>`,
       '{prenom}, {nom}, {montant}, {mois}, {numero_etudiant}'],
      ['custom', 'Message personnalisé', '{sujet}',
       `<p>Bonjour <strong>{prenom} {nom}</strong>,</p>
<p>{corps}</p>
<p>Cordialement,<br/><strong>UPTECH Campus</strong></p>`,
       '{prenom}, {nom}'],
    ]
    for (const [type, label, sujet, corps, variables] of tpls) {
      await pool.query(
        `INSERT INTO notification_templates (type, label, sujet, corps, variables)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (type) DO NOTHING`,
        [type, label, sujet, corps, variables]
      )
    }
  } catch { /* ignore */ }
})()

// Seed new parametres (établissement)
;(async () => {
  try {
    const seeds = [
      ['agrement',          '', 'etablissement', 'text'],
      ['directeur_general', '', 'etablissement', 'text'],
      ['ministere_tutelle', 'Enseignement Supérieur, de la Recherche et de l\'Innovation (MESRI)', 'etablissement', 'text'],
    ]
    for (const [cle, valeur, groupe, type] of seeds) {
      await pool.query(
        `INSERT INTO parametres_systeme (cle, valeur, groupe, type) VALUES ($1,$2,$3,$4) ON CONFLICT (cle) DO NOTHING`,
        [cle, valeur, groupe, type]
      )
    }
  } catch { /* ignore */ }
})()

// Tables formations individuelles — séquentielles car fi_modules et fi_paiements dépendent de formations_individuelles
;(async () => {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS formations_individuelles (
      id SERIAL PRIMARY KEY,
      etudiant_id INT NOT NULL REFERENCES etudiants(id) ON DELETE CASCADE,
      type_formation_id INT REFERENCES types_formation(id) ON DELETE SET NULL,
      annee_academique_id INT REFERENCES annees_academiques(id) ON DELETE SET NULL,
      cout_total NUMERIC(12,2) NOT NULL DEFAULT 0,
      pct_inscription NUMERIC(5,2) NOT NULL DEFAULT 50,
      pct_formateur NUMERIC(5,2) NOT NULL DEFAULT 50,
      statut VARCHAR(30) NOT NULL DEFAULT 'en_cours',
      date_debut DATE,
      date_fin DATE,
      created_at TIMESTAMP DEFAULT NOW(),
      created_by INT REFERENCES users(id) ON DELETE SET NULL
    )`)
    await pool.query(`CREATE TABLE IF NOT EXISTS fi_modules (
      id SERIAL PRIMARY KEY,
      formation_individuelle_id INT NOT NULL REFERENCES formations_individuelles(id) ON DELETE CASCADE,
      matiere_id INT NOT NULL REFERENCES matieres(id) ON DELETE CASCADE,
      volume_horaire INT NOT NULL DEFAULT 0,
      enseignant_id INT REFERENCES enseignants(id) ON DELETE SET NULL,
      heures_effectuees INT NOT NULL DEFAULT 0,
      UNIQUE(formation_individuelle_id, matiere_id)
    )`)
    await pool.query(`CREATE TABLE IF NOT EXISTS fi_paiements (
      id SERIAL PRIMARY KEY,
      formation_individuelle_id INT NOT NULL REFERENCES formations_individuelles(id) ON DELETE CASCADE,
      type VARCHAR(30) NOT NULL DEFAULT 'inscription',
      montant NUMERIC(12,2) NOT NULL DEFAULT 0,
      montant_paye NUMERIC(12,2) NOT NULL DEFAULT 0,
      statut VARCHAR(20) NOT NULL DEFAULT 'non_paye',
      date_echeance DATE,
      date_paiement DATE,
      created_at TIMESTAMP DEFAULT NOW()
    )`)
    // Colonnes groupe entreprise
    await pool.query(`ALTER TABLE formations_individuelles ADD COLUMN IF NOT EXISTS groupe_fi UUID`)
    await pool.query(`ALTER TABLE formations_individuelles ADD COLUMN IF NOT EXISTS entreprise VARCHAR(255)`)
  } catch (e) { console.error('Migration formations_individuelles:', e) }
})()
// Mois de début des paiements — stocké sur l'inscription, plus jamais deviné
pool.query(`ALTER TABLE inscriptions ADD COLUMN IF NOT EXISTS mois_debut DATE`).catch(() => {})
// Migration : remplir mois_debut depuis la première échéance existante
pool.query(`UPDATE inscriptions SET mois_debut = sub.premier_mois FROM (
  SELECT inscription_id, MIN(mois) as premier_mois FROM echeances WHERE type_echeance = 'mensualite' GROUP BY inscription_id
) sub WHERE inscriptions.id = sub.inscription_id AND inscriptions.mois_debut IS NULL`).catch(() => {})

pool.query(`CREATE TABLE IF NOT EXISTS echeances (
  id SERIAL PRIMARY KEY,
  inscription_id INT NOT NULL,
  mois DATE NOT NULL,
  montant DECIMAL(10,2) NOT NULL DEFAULT 0,
  type_echeance VARCHAR(20) NOT NULL DEFAULT 'mensualite',
  statut VARCHAR(20) NOT NULL DEFAULT 'non_paye',
  paiement_id INT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(inscription_id, mois, type_echeance)
)`).catch(() => {})
// Table des types de documents (configurable dans Paramètres)
pool.query(`CREATE TABLE IF NOT EXISTS types_documents (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  label VARCHAR(100) NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  ordre INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
)`).then(async () => {
  // Migrer type_document de ENUM vers TEXT si besoin
  await pool.query(`ALTER TABLE documents_etudiant ALTER COLUMN type_document TYPE TEXT USING type_document::TEXT`).catch(() => {})
  // Ajouter type_formation_id (remplace filiere_id — lié au type de formation académique)
  await pool.query(`ALTER TABLE types_documents ADD COLUMN IF NOT EXISTS type_formation_id INT REFERENCES types_formation(id) ON DELETE SET NULL`).catch(() => {})
  // Seeder les types par défaut si la table est vide
  const { rows } = await pool.query('SELECT COUNT(*)::int as cnt FROM types_documents')
  if (rows[0].cnt === 0) {
    await pool.query(`INSERT INTO types_documents (code, label, ordre) VALUES
      ('cni',                'CNI',                      1),
      ('passeport',          'Passeport',                 2),
      ('photo',              'Photo',                     3),
      ('diplome',            'Diplôme',                   4),
      ('bulletin_naissance', 'Bulletin de naissance',     5),
      ('contrat_signe',      'Contrat signé',             6),
      ('autre',              'Autre',                     99)
    `).catch(() => {})
  }
}).catch(() => {})

// Table commentaires / appréciations internes (staff uniquement)
pool.query(`CREATE TABLE IF NOT EXISTS commentaires_etudiant (
  id SERIAL PRIMARY KEY,
  etudiant_id INT NOT NULL REFERENCES etudiants(id) ON DELETE CASCADE,
  auteur_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contenu TEXT NOT NULL,
  categorie VARCHAR(30) NOT NULL DEFAULT 'general',
  updated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

// Table historique des relances envoyées
pool.query(`CREATE TABLE IF NOT EXISTS relances_paiement (
  id SERIAL PRIMARY KEY,
  inscription_id INT NOT NULL,
  echeance_id INT,
  etudiant_id INT NOT NULL,
  type_relance VARCHAR(20) NOT NULL DEFAULT 'auto',
  jours_avant INT,
  email_destinataire VARCHAR(255),
  sujet VARCHAR(255),
  statut VARCHAR(20) NOT NULL DEFAULT 'envoye',
  erreur TEXT,
  envoye_par INT,
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

// ─── Tables Dépenses structurées ──────────────────────────────────────────────
pool.query(`CREATE TABLE IF NOT EXISTS personnel (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  poste VARCHAR(150) NOT NULL,
  type_contrat VARCHAR(10) NOT NULL DEFAULT 'CDI',
  salaire_brut DECIMAL(12,2) NOT NULL DEFAULT 0,
  date_debut DATE NOT NULL,
  date_fin DATE,
  statut VARCHAR(10) NOT NULL DEFAULT 'actif',
  notes TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

pool.query(`CREATE TABLE IF NOT EXISTS contrats_fixes (
  id SERIAL PRIMARY KEY,
  libelle VARCHAR(200) NOT NULL,
  beneficiaire VARCHAR(200) NOT NULL,
  montant DECIMAL(12,2) NOT NULL,
  periodicite VARCHAR(20) NOT NULL DEFAULT 'mensuelle',
  categorie VARCHAR(50) NOT NULL DEFAULT 'prestation',
  date_debut DATE NOT NULL,
  date_fin DATE,
  statut VARCHAR(15) NOT NULL DEFAULT 'actif',
  description TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS type_source VARCHAR(30)`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS source_id INT`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS mois_concerne VARCHAR(7)`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS beneficiaire VARCHAR(200)`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS mode_paiement VARCHAR(30)`).catch(() => {})
pool.query(`ALTER TABLE depenses ALTER COLUMN mode_paiement SET DEFAULT 'especes'`).catch(() => {})
pool.query(`UPDATE depenses SET mode_paiement='especes' WHERE mode_paiement IS NULL`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS reference_facture VARCHAR(100)`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS notes TEXT`).catch(() => {})
pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_controle DECIMAL(5,2)`).catch(() => {})
pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_examen DECIMAL(5,2)`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS motif_rejet TEXT`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS validated_at TIMESTAMP`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS validated_by INT REFERENCES users(id) ON DELETE SET NULL`).catch(() => {})
pool.query(`ALTER TABLE depenses ADD COLUMN IF NOT EXISTS justificatif_path TEXT`).catch(() => {})
pool.query(`ALTER TABLE personnel ADD COLUMN IF NOT EXISTS contrat_url TEXT`).catch(() => {})
pool.query(`ALTER TABLE contrats_fixes ADD COLUMN IF NOT EXISTS contrat_url TEXT`).catch(() => {})
pool.query(`ALTER TABLE categories_depenses ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => {})

// Table catégories de dépenses (dynamiques)
pool.query(`CREATE TABLE IF NOT EXISTS categories_depenses (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  libelle VARCHAR(100) NOT NULL,
  description TEXT,
  ordre INT DEFAULT 0,
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
)`).then(() => {
  // Seed des catégories par défaut si table vide
  pool.query(`SELECT COUNT(*)::int as cnt FROM categories_depenses`).then(r => {
    if (r.rows[0].cnt === 0) {
      pool.query(`INSERT INTO categories_depenses (code,libelle,ordre) VALUES
        ('loyer_charges','Loyer & Charges',1),
        ('salaires','Salaires',2),
        ('prestation','Prestation de service',3),
        ('materiel','Matériel & Équipement',4),
        ('fournitures','Fournitures & Consommables',5),
        ('internet_tel','Internet & Téléphone',6),
        ('entretien','Entretien & Maintenance',7),
        ('communication','Communication & Marketing',8),
        ('autre','Autre',99)
      `).catch(() => {})
    }
  }).catch(() => {})
}).catch(() => {})

// Table checklist dépôt documents (cases à cocher)
pool.query(`CREATE TABLE IF NOT EXISTS checklist_documents (
  id SERIAL PRIMARY KEY,
  etudiant_id INT NOT NULL REFERENCES etudiants(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  recu BOOLEAN DEFAULT FALSE,
  date_reception TIMESTAMP,
  recu_par INT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(etudiant_id, code)
)`).catch(() => {})

// Budget prévisionnel
pool.query(`CREATE TABLE IF NOT EXISTS budgets (
  id             SERIAL PRIMARY KEY,
  categorie_code VARCHAR(50) NOT NULL,
  montant_prevu  NUMERIC(14,2) NOT NULL DEFAULT 0,
  annee          SMALLINT NOT NULL,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(categorie_code, annee)
)`).catch(() => {})

// Table relances créances
pool.query(`CREATE TABLE IF NOT EXISTS relances_creances (
  id SERIAL PRIMARY KEY,
  etudiant_id INT NOT NULL,
  montant_total NUMERIC(12,2) NOT NULL,
  nb_echeances INT NOT NULL DEFAULT 0,
  type_contact VARCHAR(20) NOT NULL DEFAULT 'manuel',
  message TEXT,
  statut VARCHAR(20) NOT NULL DEFAULT 'envoyee',
  created_by INT,
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

// Table clôtures mensuelles
pool.query(`CREATE TABLE IF NOT EXISTS clotures_mensuelles (
  id SERIAL PRIMARY KEY,
  periode VARCHAR(7) NOT NULL UNIQUE,
  cloture_at TIMESTAMP DEFAULT NOW(),
  cloture_par INT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT
)`).catch(() => {})

// Table congés / fêtes institut
pool.query(`CREATE TABLE IF NOT EXISTS conges_institut (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(150) NOT NULL,
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  type VARCHAR(30) DEFAULT 'fete',
  recurrent BOOLEAN DEFAULT FALSE,
  annee_academique_id INT REFERENCES annees_academiques(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})

// Colonne groupe_serie pour lier les séances créées en lot
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS groupe_serie UUID`).catch(() => {})

// Table disponibilités enseignants
pool.query(`CREATE TABLE IF NOT EXISTS disponibilites_enseignant (
  id SERIAL PRIMARY KEY,
  enseignant_id INT NOT NULL REFERENCES enseignants(id) ON DELETE CASCADE,
  jour SMALLINT NOT NULL CHECK (jour BETWEEN 0 AND 6),
  heure_debut TIME NOT NULL,
  heure_fin TIME NOT NULL,
  actif BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(enseignant_id, jour, heure_debut, heure_fin)
)`).catch(() => {})

// Table vacations enseignants
pool.query(`CREATE TABLE IF NOT EXISTS vacations (
  id SERIAL PRIMARY KEY,
  enseignant_id INT NOT NULL REFERENCES enseignants(id) ON DELETE CASCADE,
  annee_academique_id INT REFERENCES annees_academiques(id) ON DELETE SET NULL,
  mois VARCHAR(7) NOT NULL,
  nb_heures DECIMAL(6,2) NOT NULL DEFAULT 0,
  tarif_horaire DECIMAL(10,2) NOT NULL DEFAULT 0,
  montant DECIMAL(12,2) GENERATED ALWAYS AS (nb_heures * tarif_horaire) STORED,
  statut VARCHAR(20) NOT NULL DEFAULT 'en_attente',
  valide_par INT REFERENCES users(id) ON DELETE SET NULL,
  valide_at TIMESTAMP,
  paye_par INT REFERENCES users(id) ON DELETE SET NULL,
  paye_at TIMESTAMP,
  reference_paiement VARCHAR(100),
  note TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(enseignant_id, mois)
)`).catch(() => {})

// ─── Migration vacations : type de formation par ligne ───────────────────────
// Sans FK REFERENCES pour éviter l'échec si types_formation n'est pas accessible au démarrage
pool.query(`ALTER TABLE vacations ADD COLUMN IF NOT EXISTS type_formation_id INT`).catch(() => {})
pool.query(`ALTER TABLE vacations ADD COLUMN IF NOT EXISTS type_formation_libelle VARCHAR(100)`).catch(() => {})
// Remplacement de l'ancienne contrainte UNIQUE(enseignant_id, mois) par (enseignant_id, mois, type_formation_id)
pool.query(`ALTER TABLE vacations DROP CONSTRAINT IF EXISTS vacations_enseignant_id_mois_key`).catch(() => {})
pool.query(`
  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vac_ens_mois_type'
    ) THEN
      CREATE UNIQUE INDEX idx_vac_ens_mois_type
        ON vacations (enseignant_id, mois, COALESCE(type_formation_id, 0));
    END IF;
  END $$
`).catch(() => {})

// ─── Tables Jury ─────────────────────────────────────────────────────────────
pool.query(`CREATE TABLE IF NOT EXISTS jurys (
  id SERIAL PRIMARY KEY,
  classe_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  annee_academique_id INTEGER REFERENCES annees_academiques(id),
  session VARCHAR(20) DEFAULT 'normale',
  date_deliberation DATE,
  statut VARCHAR(20) DEFAULT 'ouvert',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
)`).catch(() => {})
pool.query(`CREATE TABLE IF NOT EXISTS jury_membres (
  id SERIAL PRIMARY KEY,
  jury_id INTEGER NOT NULL REFERENCES jurys(id) ON DELETE CASCADE,
  nom VARCHAR(200) NOT NULL,
  fonction VARCHAR(200),
  ordre INTEGER DEFAULT 0
)`).catch(() => {})
pool.query(`CREATE TABLE IF NOT EXISTS jury_decisions (
  id SERIAL PRIMARY KEY,
  jury_id INTEGER NOT NULL REFERENCES jurys(id) ON DELETE CASCADE,
  inscription_id INTEGER NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
  decision VARCHAR(50) NOT NULL,
  observation TEXT,
  UNIQUE(jury_id, inscription_id)
)`).catch(() => {})

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET manquant dans les variables d\'environnement')

// ─── Types ────────────────────────────────────────────────────────────────────
type Env = { Variables: { user: Record<string, unknown> } }

// ─── Helper : convertit HTML (éditeur riche ou Word) en texte brut lisible ────
function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  // Décoder les entités d'abord (cas où le HTML est double-encodé)
  let s = html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#[0-9]+;/g, '')
  // Puis supprimer les balises HTML
  s = s
    .replace(/<!--[\s\S]*?-->/g, '')                       // commentaires HTML/Word
    .replace(/<br\s*\/?>/gi, '\n')                         // <br> → saut de ligne
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th)>/gi, '\n')    // fermeture blocs → saut
    .replace(/<li[^>]*>/gi, '• ')                          // puces
    .replace(/<[^>]*>/g, '')                               // supprimer toutes balises
    .replace(/\n[ \t]+/g, '\n')                            // espaces en début de ligne
    .replace(/\n{3,}/g, '\n\n')                            // max 2 sauts consécutifs
    .trim()
  return s
}

function cleanSeanceContent(rows: any[]): any[] {
  return rows.map(s => ({
    ...s,
    contenu_seance: s.contenu_seance ? htmlToText(s.contenu_seance) : null,
    objectifs: s.objectifs ? htmlToText(s.objectifs) : null,
    notes: s.notes ? htmlToText(s.notes) : null,
  }))
}

// ─── App ──────────────────────────────────────────────────────────────────────
const app = new Hono<Env>().basePath('/api')

// Global error handler — returns JSON with actual error message
app.onError((err, c) => {
  console.error('Hono error:', err.message, err.stack)
  return c.json({ message: err.message, type: err.constructor.name }, 500)
})

// CORS
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', c.req.header('Origin') || '*')
  c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  c.header('Access-Control-Allow-Credentials', 'true')
  if (c.req.method === 'OPTIONS') return c.body(null, 204)
  await next()
})

// ─── Middleware ───────────────────────────────────────────────────────────────
const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return c.json({ message: 'Non authentifié.' }, 401)
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { userId: number }
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [payload.userId])
    if (!rows[0]) return c.json({ message: 'Utilisateur introuvable.' }, 401)
    if (['bloque', 'inactif', 'suspendu'].includes(rows[0].statut as string))
      return c.json({ message: 'Compte inactif ou bloqué.' }, 403)
    c.set('user', rows[0])
    await next()
  } catch {
    return c.json({ message: 'Token invalide.' }, 401)
  }
}

const role = (...roles: string[]): MiddlewareHandler<Env> => async (c, next) => {
  if (!roles.includes((c.get('user') as Record<string, string>).role))
    return c.json({ message: 'Accès refusé.' }, 403)
  await next()
}

const u = (c: { get(key: 'user'): Record<string, unknown> }) => c.get('user')

// ─── UTILS ────────────────────────────────────────────────────────────────────
function pad(n: number, len = 5) { return String(n).padStart(len, '0') }
function year() { return new Date().getFullYear() }
const ALLOWED_SEQ_TABLES = new Set(['etudiants', 'enseignants', 'inscriptions', 'paiements', 'depenses', 'seances', 'formations_individuelles', 'contrats_fixes', 'personnel'])
async function nextSeq(table: string) {
  if (!ALLOWED_SEQ_TABLES.has(table)) throw new Error(`nextSeq: table "${table}" non autorisée`)
  const { rows } = await pool.query(`SELECT COALESCE(MAX(id),0)+1 as next FROM ${table}`)
  return rows[0].next as number
}

async function isPeriodeLocked(dateStr: string): Promise<boolean> {
  if (!dateStr) return false
  const periode = String(dateStr).slice(0, 7)
  const { rows } = await pool.query('SELECT id FROM clotures_mensuelles WHERE periode=$1', [periode])
  return rows.length > 0
}

// ─── AUTH PUBLIC ──────────────────────────────────────────────────────────────
app.post('/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ message: 'Champs requis.' }, 422)

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email])
  const user = rows[0]
  if (!user) return c.json({ message: 'Identifiants incorrects.' }, 401)

  // Blocage temporaire : vérifier si le temps est écoulé → auto-débloquer
  if (user.bloque_jusqu_a && new Date(user.bloque_jusqu_a as string) > new Date()) {
    const reste = Math.ceil((new Date(user.bloque_jusqu_a as string).getTime() - Date.now()) / 60000)
    return c.json({ message: `Trop de tentatives. Réessayez dans ${reste} minute(s).`, bloque: true }, 403)
  }
  // Si le blocage est expiré, remettre à zéro automatiquement
  if (user.bloque_jusqu_a && new Date(user.bloque_jusqu_a as string) <= new Date()) {
    await pool.query("UPDATE users SET tentatives_echec=0, bloque_jusqu_a=NULL, statut='actif' WHERE id=$1", [user.id])
    user.tentatives_echec = 0
    user.bloque_jusqu_a = null
    user.statut = 'actif'
  }

  if (user.statut === 'bloque')
    return c.json({ message: 'Compte bloqué. Contactez un administrateur.', bloque: true }, 403)

  if (['inactif', 'suspendu'].includes(user.statut as string))
    return c.json({ message: 'Votre compte est inactif ou suspendu.' }, 403)

  if (!await bcrypt.compare(password as string, user.password as string)) {
    const MAX_ATTEMPTS = 10
    const attempts = ((user.tentatives_echec as number) || 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      // Blocage temporaire de 15 minutes — PAS de changement de statut
      await pool.query(
        "UPDATE users SET tentatives_echec=$1, bloque_jusqu_a=NOW()+INTERVAL '15 minutes' WHERE id=$2",
        [attempts, user.id]
      )
    } else {
      await pool.query('UPDATE users SET tentatives_echec=$1 WHERE id=$2', [attempts, user.id])
    }
    return c.json({ message: 'Identifiants incorrects.', tentatives_restantes: Math.max(0, MAX_ATTEMPTS - attempts) }, 401)
  }

  await pool.query('UPDATE users SET tentatives_echec=0, bloque_jusqu_a=NULL, last_login_at=NOW() WHERE id=$1', [user.id])
  const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' })

  return c.json({
    token,
    user: {
      id: user.id, nom: user.nom, prenom: user.prenom, email: user.email,
      role: user.role, photo_path: user.photo_path,
      premier_connexion: user.premier_connexion, cgu_acceptees: user.cgu_acceptees,
    },
  })
})

// ── Helpers OTP ─────────────────────────────────────────────────────────────

function normalizeSenPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('221')) return '+' + digits
  if (digits.length === 9) return '+221' + digits
  if (digits.startsWith('0') && digits.length === 10) return '+221' + digits.slice(1)
  return '+' + digits
}

function maskPhone(phone: string): string {
  const n = normalizeSenPhone(phone) // ex: +221771234567
  if (n.length < 8) return '***'
  return n.slice(0, 7) + ' *** ** ' + n.slice(-2)
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!domain) return email
  const visible = user.slice(0, 2)
  return `${visible}***@${domain}`
}

// ── Vérification email (étape 1 — ne pas envoyer le code encore) ─────────────

app.post('/auth/check-email', async (c) => {
  const body = await c.req.json()
  const email = (body.email as string)?.toLowerCase().trim()
  if (!email) return c.json({ message: 'Email requis.' }, 422)

  const { rows } = await pool.query(
    'SELECT id, telephone FROM users WHERE email=$1 AND statut=$2',
    [email, 'actif']
  )
  if (!rows[0]) return c.json({ message: 'Aucun compte actif trouvé avec cet email.' }, 404)

  const hasTelephone = !!rows[0].telephone
  return c.json({
    emailMasked: maskEmail(email),
    hasTelephone,
    telephoneMasked: hasTelephone ? maskPhone(rows[0].telephone) : null,
  })
})

// ── Envoi OTP (étape 2 — après sélection canal) ───────────────────────────────

app.post('/auth/forgot-password', async (c) => {
  const body = await c.req.json()
  const email   = (body.email as string)?.toLowerCase().trim()
  const channel = (body.channel as string) === 'sms' ? 'sms' : 'email'
  if (!email) return c.json({ message: 'Email requis.' }, 422)

  // Vérifier que l'email existe
  const { rows } = await pool.query(
    'SELECT id, telephone FROM users WHERE email=$1 AND statut=$2',
    [email, 'actif']
  )
  if (!rows[0]) {
    return c.json({ message: "Si cet email existe, un code vous sera envoyé." })
  }

  // Canal SMS : vérifier que le téléphone est disponible
  if (channel === 'sms' && !rows[0].telephone) {
    return c.json({ message: "Aucun numéro de téléphone associé à ce compte. Utilisez l'email." }, 400)
  }

  // Générer un OTP à 6 chiffres
  const otp = String(Math.floor(100000 + Math.random() * 900000))
  const hashed = await bcrypt.hash(otp, 10)

  // Stocker dans la table existante (email PK, token, created_at)
  await pool.query(
    `INSERT INTO password_reset_tokens (email, token, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (email) DO UPDATE SET token=$2, created_at=NOW()`,
    [email, hashed]
  )

  const apiKey = process.env.BREVO_API_KEY

  if (channel === 'sms') {
    // ── Brevo SMS ──────────────────────────────────────────────────────────
    if (apiKey) {
      const recipient = normalizeSenPhone(rows[0].telephone as string)
      const smsResp = await fetch('https://api.brevo.com/v3/transactionalSMS/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          sender: 'UPTECH',
          recipient,
          content: `UPTECH Campus - Code : ${otp} - Valable 10 min.`,
          type: 'transactional',
        }),
      })
      if (!smsResp.ok) {
        const errBody = await smsResp.json().catch(() => ({}))
        return c.json({
          message: `Échec envoi SMS (${smsResp.status}): ${(errBody as any).message || JSON.stringify(errBody)}`,
          brevo_error: errBody,
          recipient_debug: recipient,
        }, 500)
      }
    }
    return c.json({
      message: "Code envoyé par SMS.",
      dev_otp: apiKey ? undefined : otp,
    })
  } else {
    // ── Brevo Email ────────────────────────────────────────────────────────
    const fromEmail = process.env.BREVO_FROM_EMAIL || 'noreply@uptechcampus.com'
    const fromName  = process.env.BREVO_FROM_NAME  || 'UPTECH Campus'

    if (apiKey) {
      const html = `
<!DOCTYPE html><html lang="fr"><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<div style="background:linear-gradient(135deg,#0f172a,#1e293b);color:white;padding:20px 24px;border-radius:10px 10px 0 0">
  <h2 style="margin:0;font-size:18px">UPTECH Campus</h2>
  <p style="margin:4px 0 0;font-size:13px;opacity:.7">Réinitialisation de mot de passe</p>
</div>
<div style="border:1px solid #e5e7eb;border-top:none;padding:28px 24px;border-radius:0 0 10px 10px">
  <p style="font-size:15px;color:#1e293b">Voici votre code de vérification :</p>
  <div style="background:#f8fafc;border:2px dashed #e2e8f0;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
    <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#E30613;font-family:monospace">${otp}</span>
  </div>
  <p style="font-size:13px;color:#64748b">Ce code est valable <strong>10 minutes</strong>. Ne le partagez avec personne.</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="font-size:11px;color:#9ca3af">Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
</div>
</body></html>`

      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          sender: { name: fromName, email: fromEmail },
          to: [{ email }],
          subject: `${otp} — Votre code UPTECH Campus`,
          htmlContent: html,
        }),
      }).catch(() => {})
    }
    return c.json({
      message: "Code envoyé par email.",
      dev_otp: apiKey ? undefined : otp,
    })
  }
})

app.post('/auth/verify-otp', async (c) => {
  const body = await c.req.json()
  const email = (body.email as string)?.toLowerCase().trim()
  const otp   = (body.otp as string)?.trim()
  if (!email || !otp) return c.json({ message: 'Email et code requis.', valid: false }, 422)

  const { rows } = await pool.query(
    'SELECT token, created_at FROM password_reset_tokens WHERE email=$1',
    [email]
  )
  if (!rows[0]) return c.json({ message: 'Aucun code en attente.', valid: false }, 400)
  const expiresAt = new Date(rows[0].created_at).getTime() + 10 * 60 * 1000
  if (Date.now() > expiresAt) return c.json({ message: 'Code expiré.', valid: false }, 400)
  if (!await bcrypt.compare(otp, rows[0].token)) return c.json({ message: 'Code incorrect.', valid: false }, 400)

  return c.json({ message: 'Code vérifié.', valid: true })
})

app.post('/auth/reset-password', async (c) => {
  const body = await c.req.json()
  const email   = (body.email as string)?.toLowerCase().trim()
  const otp     = (body.otp as string)?.trim()
  const nouveau = (body.nouveau_mot_de_passe || body.password) as string

  if (!email || !nouveau) return c.json({ message: 'Email et nouveau mot de passe requis.' }, 422)

  // Vérifier le token une dernière fois (sauf si pas de table encore = fallback)
  if (otp) {
    const { rows } = await pool.query(
      'SELECT token, created_at FROM password_reset_tokens WHERE email=$1',
      [email]
    ).catch(() => ({ rows: [] as any[] }))
    if (rows[0]) {
      const exp = new Date(rows[0].created_at).getTime() + 10 * 60 * 1000
      if (Date.now() > exp) return c.json({ message: 'Code expiré.' }, 400)
      if (!await bcrypt.compare(otp, rows[0].token)) return c.json({ message: 'Code incorrect.' }, 400)
    }
  }

  const hashed = await bcrypt.hash(nouveau, 10)
  await pool.query(
    'UPDATE users SET password=$1, premier_connexion=false, tentatives_echec=0, bloque_jusqu_a=NULL WHERE email=$2',
    [hashed, email]
  )
  // Supprimer le token utilisé
  await pool.query('DELETE FROM password_reset_tokens WHERE email=$1', [email]).catch(() => {})

  return c.json({ message: 'Mot de passe réinitialisé avec succès.' })
})

// ─── AUTH PROTECTED ───────────────────────────────────────────────────────────
app.post('/auth/logout', requireAuth, async (c) => {
  return c.json({ message: 'Déconnecté avec succès.' })
})

app.get('/auth/me', requireAuth, async (c) => {
  const user = u(c)
  return c.json({
    id: user.id, nom: user.nom, prenom: user.prenom, email: user.email,
    role: user.role, statut: user.statut, telephone: user.telephone,
    photo_path: user.photo_path, premier_connexion: user.premier_connexion, cgu_acceptees: user.cgu_acceptees,
  })
})

app.post('/auth/accept-cgu', requireAuth, async (c) => {
  await pool.query('UPDATE users SET cgu_acceptees=true, premier_connexion=false WHERE id=$1', [u(c).id])
  return c.json({ message: 'CGU acceptées.' })
})

app.post('/auth/change-password', requireAuth, async (c) => {
  const body = await c.req.json()
  const { ancien_mot_de_passe, nouveau_mot_de_passe } = body
  const { rows } = await pool.query('SELECT password FROM users WHERE id=$1', [u(c).id])
  if (!await bcrypt.compare(ancien_mot_de_passe as string, rows[0].password as string))
    return c.json({ message: 'Ancien mot de passe incorrect.' }, 422)
  const hashed = await bcrypt.hash(nouveau_mot_de_passe as string, 10)
  await pool.query('UPDATE users SET password=$1, premier_connexion=false WHERE id=$2', [hashed, u(c).id])
  return c.json({ message: 'Mot de passe modifié avec succès.' })
})

// ─── USERS ────────────────────────────────────────────────────────────────────
app.get('/users', requireAuth, role('dg', 'secretariat'), async (c) => {
  const roleFilter = c.req.query('role')
  const params: any[] = []
  let where = ''
  if (roleFilter) { where = 'WHERE role=$1'; params.push(roleFilter) }
  const { rows } = await pool.query(
    `SELECT id,nom,prenom,email,role,statut,telephone,photo_path,last_login_at,created_at
     FROM users ${where} ORDER BY role, nom, prenom`,
    params
  )
  return c.json(rows)
})

app.post('/users', requireAuth, role('dg'), async (c) => {
  const body = await c.req.json()
  const hashed = await bcrypt.hash((body.password as string) || 'Uptech@2026', 10)
  const { rows } = await pool.query(
    'INSERT INTO users (nom,prenom,email,password,role,telephone,statut,premier_connexion,cgu_acceptees,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,true,false,$8) RETURNING id,nom,prenom,email,role,statut,telephone',
    [body.nom, body.prenom, body.email, hashed, body.role, body.telephone || null, body.statut || 'actif', u(c).id]
  )
  return c.json(rows[0], 201)
})

app.put('/users/:id', requireAuth, role('dg'), async (c) => {
  const body = await c.req.json()
  const newStatut = body.statut || 'actif'
  // Si on débloque (statut != bloque), effacer aussi bloque_jusqu_a et tentatives_echec
  // Quand l'admin met à jour un user, on efface toujours le verrou temporaire
  const { rows } = await pool.query(
    `UPDATE users SET nom=$1,prenom=$2,email=$3,role=$4,telephone=$5,statut=$6,
     bloque_jusqu_a=NULL, tentatives_echec=0
     WHERE id=$7 RETURNING id,nom,prenom,email,role,statut,telephone`,
    [body.nom, body.prenom, body.email, body.role, body.telephone || null, newStatut, c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Utilisateur introuvable.' }, 404)
  return c.json(rows[0])
})

app.delete('/users/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM users WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// Génération en masse des comptes étudiants (ceux qui n'en ont pas encore)
app.post('/users/bulk-etudiants', requireAuth, role('dg'), async (c) => {
  const { rows: etudiants } = await pool.query(`
    SELECT e.nom, e.prenom, e.email, e.telephone
    FROM etudiants e
    WHERE e.email IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(e.email))
  `)
  if (etudiants.length === 0) return c.json({ created: 0, message: 'Tous les étudiants ont déjà un compte.' })
  const defaultPassword = await bcrypt.hash('Uptech@2026', 10)
  let created = 0
  for (const et of etudiants) {
    try {
      await pool.query(
        `INSERT INTO users (nom, prenom, email, password, role, telephone, statut, premier_connexion, cgu_acceptees, created_by)
         VALUES ($1,$2,$3,$4,'etudiant',$5,'actif',true,false,$6)
         ON CONFLICT (email) DO NOTHING`,
        [et.nom, et.prenom, et.email, defaultPassword, et.telephone || null, u(c).id]
      )
      created++
    } catch { /* skip duplicates */ }
  }
  return c.json({ created, total: etudiants.length, message: `${created} compte(s) étudiant créé(s). Mot de passe par défaut : Uptech@2026` })
})

app.post('/users/:id/reset-password', requireAuth, role('dg'), async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const mdp = body.nouveau_mot_de_passe || 'Uptech@2026'
  const hashed = await bcrypt.hash(mdp, 10)
  await pool.query('UPDATE users SET password=$1, premier_connexion=true WHERE id=$2', [hashed, c.req.param('id')])
  return c.json({ message: 'Mot de passe réinitialisé.', nouveau_mot_de_passe: mdp })
})

// ─── PARAMETRES ───────────────────────────────────────────────────────────────
app.get('/parametres', requireAuth, role('dg'), async (c) => {
  const { rows } = await pool.query('SELECT * FROM parametres_systeme ORDER BY groupe,cle')
  return c.json(rows)
})

app.put('/parametres/:cle', requireAuth, role('dg'), async (c) => {
  const body = await c.req.json()
  await pool.query('UPDATE parametres_systeme SET valeur=$1 WHERE cle=$2', [body.valeur, c.req.param('cle')])
  const { rows } = await pool.query('SELECT * FROM parametres_systeme WHERE cle=$1', [c.req.param('cle')])
  return c.json(rows[0])
})

// ─── FILIERES ─────────────────────────────────────────────────────────────────
app.get('/filieres', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT f.*,
      COALESCE(json_agg(
        jsonb_build_object(
          'id', m.id, 'nom', m.nom, 'code', m.code,
          'pivot', jsonb_build_object(
            'coefficient', COALESCE(fm.coefficient, 1),
            'credits',     COALESCE(fm.credits, 0),
            'ordre',       COALESCE(fm.ordre, 0)
          )
        ) ORDER BY fm.ordre, m.nom
      ) FILTER (WHERE m.id IS NOT NULL), '[]') as matieres
    FROM filieres f
    LEFT JOIN filiere_matiere fm ON f.id = fm.filiere_id
    LEFT JOIN matieres m ON fm.matiere_id = m.id
    GROUP BY f.id ORDER BY f.nom
  `)
  return c.json(rows)
})

app.post('/filieres', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO filieres (nom,code,description,actif,type_formation_id,frais_inscription,mensualite,duree_mois,montant_tenue,tarif_horaire) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
    [b.nom, b.code, b.description || null, b.actif ?? true, b.type_formation_id || null, b.frais_inscription || 0, b.mensualite || 0, b.duree_mois || null, b.montant_tenue || 0, b.tarif_horaire || 0]
  )
  return c.json(rows[0], 201)
})

app.put('/filieres/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE filieres SET nom=$1,code=$2,description=$3,actif=$4,type_formation_id=$5,frais_inscription=$6,mensualite=$7,duree_mois=$8,montant_tenue=$9,tarif_horaire=$10 WHERE id=$11 RETURNING *',
    [b.nom, b.code, b.description || null, b.actif ?? true, b.type_formation_id || null, b.frais_inscription || 0, b.mensualite || 0, b.duree_mois || null, b.montant_tenue || 0, b.tarif_horaire || 0, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/filieres/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM filieres WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

app.post('/filieres/:id/matieres', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const filiereId = c.req.param('id')
  await pool.query(
    `INSERT INTO filiere_matiere (filiere_id, matiere_id, coefficient, credits, ordre)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (filiere_id, matiere_id) DO UPDATE
       SET coefficient = EXCLUDED.coefficient,
           credits     = EXCLUDED.credits,
           ordre       = EXCLUDED.ordre`,
    [filiereId, b.matiere_id, b.coefficient ?? 1, b.credits ?? 0, b.ordre ?? 0]
  )
  // Retourner la filière complète avec matieres + pivot
  const { rows } = await pool.query(`
    SELECT f.*,
      COALESCE(json_agg(
        jsonb_build_object(
          'id', m.id, 'nom', m.nom, 'code', m.code,
          'pivot', jsonb_build_object(
            'coefficient', COALESCE(fm.coefficient, 1),
            'credits',     COALESCE(fm.credits, 0),
            'ordre',       COALESCE(fm.ordre, 0)
          )
        ) ORDER BY fm.ordre, m.nom
      ) FILTER (WHERE m.id IS NOT NULL), '[]') as matieres
    FROM filieres f
    LEFT JOIN filiere_matiere fm ON f.id = fm.filiere_id
    LEFT JOIN matieres m ON fm.matiere_id = m.id
    WHERE f.id = $1
    GROUP BY f.id
  `, [filiereId])
  return c.json(rows[0])
})

app.delete('/filieres/:id/matieres/:matiere_id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM filiere_matiere WHERE filiere_id=$1 AND matiere_id=$2', [c.req.param('id'), c.req.param('matiere_id')])
  return c.body(null, 204)
})

// Ajouter une matière à la maquette (find-or-create matière + insert filiere_matiere)
app.post('/filieres/:id/ligne-maquette', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const filiereId = c.req.param('id')
  const b = await c.req.json()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let matiereId: number
    const { rows: existing } = await client.query(
      `SELECT id FROM matieres WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1)) LIMIT 1`, [b.nom_matiere]
    )
    if (existing.length > 0) {
      matiereId = existing[0].id
    } else {
      const { rows: created } = await client.query(
        `INSERT INTO matieres (nom, code) VALUES ($1, $2) RETURNING id`,
        [b.nom_matiere.trim(), b.code_matiere?.trim() || '']
      )
      matiereId = created[0].id
    }
    await client.query(
      `INSERT INTO filiere_matiere (filiere_id, matiere_id, semestre, code_ue, intitule_ue, coefficient, credits, vht, cm, td, tp, tpe, ordre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (filiere_id, matiere_id) DO UPDATE SET
         semestre=EXCLUDED.semestre, code_ue=EXCLUDED.code_ue, intitule_ue=EXCLUDED.intitule_ue,
         coefficient=EXCLUDED.coefficient, credits=EXCLUDED.credits, vht=EXCLUDED.vht,
         cm=EXCLUDED.cm, td=EXCLUDED.td, tp=EXCLUDED.tp, tpe=EXCLUDED.tpe, ordre=EXCLUDED.ordre`,
      [filiereId, matiereId, b.semestre||1, b.code_ue||'', b.intitule_ue||'',
       b.coefficient??1, b.credits??0, b.vht??0, b.cm??0, b.td??0, b.tp??0, b.tpe??0, b.ordre??0]
    )
    await client.query('COMMIT')
    const { rows } = await client.query(
      `SELECT fm.filiere_id, fm.matiere_id, fm.semestre, fm.code_ue, fm.intitule_ue,
              fm.coefficient, fm.credits, fm.vht, fm.cm, fm.td, fm.tp, fm.tpe, fm.ordre,
              m.nom as matiere_nom, m.code as matiere_code
       FROM filiere_matiere fm JOIN matieres m ON fm.matiere_id = m.id
       WHERE fm.filiere_id=$1 AND fm.matiere_id=$2`, [filiereId, matiereId]
    )
    return c.json(rows[0])
  } catch (e: any) {
    await client.query('ROLLBACK')
    return c.json({ error: e.message }, 500)
  } finally { client.release() }
})

// Mettre à jour une ligne de la maquette
app.put('/filieres/:id/ligne-maquette/:matiere_id', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const filiereId = c.req.param('id')
  const matiereId = c.req.param('matiere_id')
  const b = await c.req.json()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (b.nom_matiere) {
      // Vérifier si la matière est utilisée dans d'autres filières
      const { rows: usages } = await client.query(
        `SELECT COUNT(DISTINCT filiere_id)::int as nb FROM filiere_matiere WHERE matiere_id=$1`, [matiereId]
      )
      const nbFilieres = usages[0]?.nb || 0
      if (nbFilieres <= 1) {
        // Utilisée dans 1 seule filière (celle-ci) → renommage sécurisé
        await client.query('UPDATE matieres SET nom=$1 WHERE id=$2', [b.nom_matiere.trim(), matiereId])
      }
      // Si utilisée dans plusieurs filières → on ne renomme pas le nom global
      // L'intitulé EC dans la maquette est géré via intitule_ue / code_ue sur filiere_matiere
    }
    await client.query(
      `UPDATE filiere_matiere SET
         semestre=$3, code_ue=$4, intitule_ue=$5, coefficient=$6, credits=$7,
         vht=$8, cm=$9, td=$10, tp=$11, tpe=$12, ordre=$13
       WHERE filiere_id=$1 AND matiere_id=$2`,
      [filiereId, matiereId, b.semestre||1, b.code_ue||'', b.intitule_ue||'',
       b.coefficient??1, b.credits??0, b.vht??0, b.cm??0, b.td??0, b.tp??0, b.tpe??0, b.ordre??0]
    )
    await client.query('COMMIT')
    const { rows } = await client.query(
      `SELECT fm.filiere_id, fm.matiere_id, fm.semestre, fm.code_ue, fm.intitule_ue,
              fm.coefficient, fm.credits, fm.vht, fm.cm, fm.td, fm.tp, fm.tpe, fm.ordre,
              m.nom as matiere_nom, m.code as matiere_code
       FROM filiere_matiere fm JOIN matieres m ON fm.matiere_id = m.id
       WHERE fm.filiere_id=$1 AND fm.matiere_id=$2`, [filiereId, matiereId]
    )
    return c.json(rows[0])
  } catch (e: any) {
    await client.query('ROLLBACK')
    return c.json({ error: e.message }, 500)
  } finally { client.release() }
})

// ─── MATIERES ─────────────────────────────────────────────────────────────────
app.get('/matieres', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM matieres ORDER BY nom')
  return c.json(rows)
})

app.post('/matieres', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO matieres (nom,code,description) VALUES ($1,$2,$3) RETURNING *',
    [b.nom, b.code || null, b.description || null]
  )
  return c.json(rows[0], 201)
})

app.put('/matieres/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE matieres SET nom=$1,code=$2,description=$3 WHERE id=$4 RETURNING *',
    [b.nom, b.code || null, b.description || null, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/matieres/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM matieres WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// Nettoyer les doublons de matières globales (même nom, insensible à la casse)
app.post('/matieres/nettoyer-doublons', requireAuth, role('dg'), async (c) => {
  // Récupérer toutes les matières groupées par nom normalisé
  const { rows: matieres } = await pool.query(
    `SELECT id, nom, code, description, actif FROM matieres ORDER BY LOWER(nom), id ASC`
  )

  // Grouper par nom normalisé (lowercase, trim)
  const byNom: Record<string, any[]> = {}
  for (const m of matieres) {
    const key = (m.nom || '').trim().toLowerCase()
    if (!byNom[key]) byNom[key] = []
    byNom[key].push(m)
  }

  let supprimees = 0
  for (const [, groupe] of Object.entries(byNom)) {
    if (groupe.length <= 1) continue
    // Garder la première (id le plus petit = la plus ancienne)
    const [garder, ...supprimer] = groupe
    for (const m of supprimer) {
      // filiere_matiere : supprimer les liens qui existent déjà sur la matière conservée (évite la contrainte unique filiere_id+matiere_id)
      await pool.query(
        `DELETE FROM filiere_matiere WHERE matiere_id=$1 AND filiere_id IN (
           SELECT filiere_id FROM filiere_matiere WHERE matiere_id=$2
         )`,
        [m.id, garder.id]
      )
      // Transférer les liens restants vers la matière conservée
      await pool.query('UPDATE filiere_matiere SET matiere_id=$1 WHERE matiere_id=$2', [garder.id, m.id])
      // Transférer les UEs
      await pool.query('UPDATE unites_enseignement SET matiere_id=$1 WHERE matiere_id=$2', [garder.id, m.id])
      await pool.query('DELETE FROM matieres WHERE id=$1', [m.id])
      supprimees++
    }
  }

  return c.json({ supprimees, message: `${supprimees} doublon(s) de matière(s) supprimé(s).` })
})

// ─── NIVEAUX ENTREE ───────────────────────────────────────────────────────────
app.get('/niveaux-entree', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM niveaux_entree ORDER BY ordre, nom')
  return c.json(rows)
})

app.post('/niveaux-entree', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO niveaux_entree (nom,code,est_superieur_bac,ordre,actif) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.nom, b.code || '', b.est_superieur_bac ?? false, b.ordre ?? 0, b.actif ?? true]
  )
  return c.json(rows[0], 201)
})

app.put('/niveaux-entree/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE niveaux_entree SET nom=$1,code=$2,est_superieur_bac=$3,ordre=$4,actif=$5 WHERE id=$6 RETURNING *',
    [b.nom, b.code || '', b.est_superieur_bac ?? false, b.ordre ?? 0, b.actif ?? true, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/niveaux-entree/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM niveaux_entree WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── NIVEAUX BOURSE ───────────────────────────────────────────────────────────
app.get('/niveaux-bourse', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM niveaux_bourse ORDER BY nom')
  return c.json(rows)
})

app.post('/niveaux-bourse', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO niveaux_bourse (nom,pourcentage,applique_inscription,applique_tenue,actif) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.nom, b.pourcentage || 0, b.applique_inscription ?? false, b.applique_tenue ?? false, b.actif ?? true]
  )
  return c.json(rows[0], 201)
})

app.put('/niveaux-bourse/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE niveaux_bourse SET nom=$1,pourcentage=$2,applique_inscription=$3,applique_tenue=$4,actif=$5 WHERE id=$6 RETURNING *',
    [b.nom, b.pourcentage || 0, b.applique_inscription ?? false, b.applique_tenue ?? false, b.actif ?? true, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/niveaux-bourse/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM niveaux_bourse WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── DISPONIBILITÉS ENSEIGNANT ─────────────────────────────────────────────────
const jourNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']

app.get('/enseignants/:id/disponibilites', requireAuth, async (c) => {
  const { rows } = await pool.query(
    'SELECT * FROM disponibilites_enseignant WHERE enseignant_id=$1 ORDER BY jour, heure_debut',
    [c.req.param('id')]
  )
  return c.json(rows)
})

app.post('/enseignants/:id/disponibilites', requireAuth, async (c) => {
  const ensId = c.req.param('id')
  // Vérifier que l'utilisateur est le prof lui-même ou un admin
  const currentUser = c.get('user') as any
  if (currentUser.role === 'enseignant') {
    const { rows: ens } = await pool.query('SELECT user_id FROM enseignants WHERE id=$1', [ensId])
    if (!ens[0] || ens[0].user_id !== currentUser.id) return c.json({ message: 'Accès refusé.' }, 403)
  }
  const b = await c.req.json()
  if (b.jour === undefined || !b.heure_debut || !b.heure_fin) return c.json({ message: 'Jour, heure début et heure fin sont requis.' }, 422)
  const { rows } = await pool.query(
    `INSERT INTO disponibilites_enseignant (enseignant_id, jour, heure_debut, heure_fin, actif)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ensId, b.jour, b.heure_debut, b.heure_fin, b.actif ?? true]
  )
  return c.json(rows[0], 201)
})

app.put('/enseignants/:id/disponibilites/:did', requireAuth, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE disponibilites_enseignant SET jour=$1, heure_debut=$2, heure_fin=$3, actif=$4
     WHERE id=$5 AND enseignant_id=$6 RETURNING *`,
    [b.jour, b.heure_debut, b.heure_fin, b.actif ?? true, c.req.param('did'), c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Créneau introuvable.' }, 404)
  return c.json(rows[0])
})

app.delete('/enseignants/:id/disponibilites/:did', requireAuth, async (c) => {
  await pool.query('DELETE FROM disponibilites_enseignant WHERE id=$1 AND enseignant_id=$2', [c.req.param('did'), c.req.param('id')])
  return c.body(null, 204)
})

// Remplacer toutes les disponibilités d'un enseignant (batch)
app.put('/enseignants/:id/disponibilites', requireAuth, async (c) => {
  const ensId = c.req.param('id')
  const currentUser = c.get('user') as any
  if (currentUser.role === 'enseignant') {
    const { rows: ens } = await pool.query('SELECT user_id FROM enseignants WHERE id=$1', [ensId])
    if (!ens[0] || ens[0].user_id !== currentUser.id) return c.json({ message: 'Accès refusé.' }, 403)
  }
  const { creneaux } = await c.req.json() as { creneaux: { jour: number; heure_debut: string; heure_fin: string }[] }
  if (!Array.isArray(creneaux)) return c.json({ message: 'creneaux[] requis.' }, 422)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM disponibilites_enseignant WHERE enseignant_id=$1', [ensId])
    for (const cr of creneaux) {
      await client.query(
        'INSERT INTO disponibilites_enseignant (enseignant_id, jour, heure_debut, heure_fin) VALUES ($1,$2,$3,$4)',
        [ensId, cr.jour, cr.heure_debut, cr.heure_fin]
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
  const { rows } = await pool.query('SELECT * FROM disponibilites_enseignant WHERE enseignant_id=$1 ORDER BY jour, heure_debut', [ensId])
  return c.json(rows)
})

// ─── CONGÉS / FÊTES INSTITUT ──────────────────────────────────────────────────
app.get('/conges-institut', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT ci.*, aa.libelle AS annee_academique_libelle
    FROM conges_institut ci
    LEFT JOIN annees_academiques aa ON ci.annee_academique_id = aa.id
    ORDER BY ci.date_debut DESC
  `)
  return c.json(rows)
})

app.post('/conges-institut', requireAuth, role('dg', 'dir_peda'), async (c) => {
  const b = await c.req.json()
  if (!b.nom?.trim() || !b.date_debut || !b.date_fin) return c.json({ message: 'Nom, date début et date fin sont requis.' }, 422)
  if (b.date_fin < b.date_debut) return c.json({ message: 'La date de fin doit être après la date de début.' }, 422)
  const { rows } = await pool.query(
    `INSERT INTO conges_institut (nom, date_debut, date_fin, type, recurrent, annee_academique_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [b.nom.trim(), b.date_debut, b.date_fin, b.type || 'fete', b.recurrent ?? false, b.annee_academique_id || null]
  )
  return c.json(rows[0], 201)
})

app.put('/conges-institut/:id', requireAuth, role('dg', 'dir_peda'), async (c) => {
  const b = await c.req.json()
  if (!b.nom?.trim() || !b.date_debut || !b.date_fin) return c.json({ message: 'Nom, date début et date fin sont requis.' }, 422)
  const { rows } = await pool.query(
    `UPDATE conges_institut SET nom=$1, date_debut=$2, date_fin=$3, type=$4, recurrent=$5, annee_academique_id=$6
     WHERE id=$7 RETURNING *`,
    [b.nom.trim(), b.date_debut, b.date_fin, b.type || 'fete', b.recurrent ?? false, b.annee_academique_id || null, c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Congé introuvable.' }, 404)
  return c.json(rows[0])
})

app.delete('/conges-institut/:id', requireAuth, role('dg', 'dir_peda'), async (c) => {
  await pool.query('DELETE FROM conges_institut WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── TYPES FORMATION ──────────────────────────────────────────────────────────
app.get('/types-formation', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT tf.*,
      COALESCE(json_agg(DISTINCT jsonb_build_object('id',p.id,'nom',p.nom)) FILTER (WHERE p.id IS NOT NULL),'[]') as parcours,
      COALESCE(json_agg(DISTINCT jsonb_build_object('id',f.id,'nom',f.nom)) FILTER (WHERE f.id IS NOT NULL),'[]') as filieres
    FROM types_formation tf
    LEFT JOIN parcours p ON p.type_formation_id = tf.id
    LEFT JOIN filieres f ON f.type_formation_id = tf.id
    GROUP BY tf.id ORDER BY tf.nom
  `)
  return c.json(rows)
})

app.post('/types-formation', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO types_formation (nom,code,description,has_niveau,est_individuel) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.nom, b.code || null, b.description || null, b.has_niveau ?? false, b.est_individuel ?? false]
  )
  return c.json(rows[0], 201)
})

app.put('/types-formation/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE types_formation SET nom=$1,code=$2,description=$3,has_niveau=$4,actif=$5,est_individuel=$6 WHERE id=$7 RETURNING *',
    [b.nom, b.code || null, b.description || null, b.has_niveau ?? false, b.actif ?? true, b.est_individuel ?? false, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/types-formation/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM types_formation WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── FORMATIONS INDIVIDUELLES ────────────────────────────────────────────────

// Liste toutes les formations individuelles
app.get('/formations-individuelles', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT fi.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom,'telephone',e.telephone) as etudiant,
      CASE WHEN tf.id IS NOT NULL THEN jsonb_build_object('id',tf.id,'nom',tf.nom) ELSE NULL END as type_formation,
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_academique,
      COALESCE((SELECT json_agg(json_build_object(
        'id',fm.id,'matiere_id',fm.matiere_id,'matiere_nom',m.nom,
        'volume_horaire',fm.volume_horaire,'heures_effectuees',fm.heures_effectuees,
        'enseignant_id',fm.enseignant_id,
        'enseignant_nom',CASE WHEN ens.id IS NOT NULL THEN ens.prenom||' '||ens.nom ELSE NULL END
      ) ORDER BY m.nom) FROM fi_modules fm
        LEFT JOIN matieres m ON fm.matiere_id = m.id
        LEFT JOIN enseignants ens ON fm.enseignant_id = ens.id
        WHERE fm.formation_individuelle_id = fi.id), '[]') as modules,
      COALESCE((SELECT json_agg(json_build_object(
        'id',fp.id,'type',fp.type,'montant',fp.montant,'montant_paye',fp.montant_paye,
        'statut',fp.statut,'date_echeance',fp.date_echeance,'date_paiement',fp.date_paiement
      ) ORDER BY fp.type) FROM fi_paiements fp
        WHERE fp.formation_individuelle_id = fi.id), '[]') as paiements
    FROM formations_individuelles fi
    LEFT JOIN etudiants e ON fi.etudiant_id = e.id
    LEFT JOIN types_formation tf ON fi.type_formation_id = tf.id
    LEFT JOIN annees_academiques aa ON fi.annee_academique_id = aa.id
    ORDER BY fi.created_at DESC
  `)
  return c.json(rows)
})

// Détail d'une formation individuelle
app.get('/formations-individuelles/:id', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT fi.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom,'telephone',e.telephone,'email',e.email) as etudiant,
      COALESCE((SELECT json_agg(json_build_object(
        'id',fm.id,'matiere_id',fm.matiere_id,'matiere_nom',m.nom,
        'volume_horaire',fm.volume_horaire,'heures_effectuees',fm.heures_effectuees,
        'enseignant_id',fm.enseignant_id,
        'enseignant_nom',CASE WHEN ens.id IS NOT NULL THEN ens.prenom||' '||ens.nom ELSE NULL END
      ) ORDER BY m.nom) FROM fi_modules fm
        LEFT JOIN matieres m ON fm.matiere_id = m.id
        LEFT JOIN enseignants ens ON fm.enseignant_id = ens.id
        WHERE fm.formation_individuelle_id = fi.id), '[]') as modules,
      COALESCE((SELECT json_agg(json_build_object(
        'id',fp.id,'type',fp.type,'montant',fp.montant,'montant_paye',fp.montant_paye,
        'statut',fp.statut,'date_echeance',fp.date_echeance,'date_paiement',fp.date_paiement
      ) ORDER BY fp.type) FROM fi_paiements fp
        WHERE fp.formation_individuelle_id = fi.id), '[]') as paiements
    FROM formations_individuelles fi
    LEFT JOIN etudiants e ON fi.etudiant_id = e.id
    WHERE fi.id = $1
  `, [c.req.param('id')])
  if (!rows[0]) return c.json({ error: 'Non trouvé' }, 404)
  return c.json(rows[0])
})

// Créer une formation individuelle + modules + échéancier 50/50
app.post('/formations-individuelles', requireAuth, role('dg', 'coordinateur'), async (c) => {
  const b = await c.req.json()

  // Création inline d'un nouvel étudiant si new_etudiant est fourni
  if (!b.etudiant_id && b.new_etudiant) {
    const ne = b.new_etudiant
    if (!ne.nom || !ne.prenom) return c.json({ error: 'new_etudiant.nom et prenom requis' }, 400)
    const seq = await nextSeq('etudiants')
    const numero = `UPTECH-${year()}-${pad(seq)}`
    const { rows: newRows } = await pool.query(
      `INSERT INTO etudiants (numero_etudiant,nom,prenom,email,telephone) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [numero, ne.nom, ne.prenom, ne.email || null, ne.telephone || null]
    )
    b.etudiant_id = newRows[0].id
    // Auto-créer compte utilisateur si email fourni
    if (ne.email) {
      const hashed = await bcrypt.hash('Uptech@2026', 10)
      try {
        await pool.query(
          `INSERT INTO users (nom,prenom,email,password,role,telephone,statut,premier_connexion,cgu_acceptees,created_by)
           VALUES ($1,$2,$3,$4,'etudiant',$5,'actif',true,false,$6) ON CONFLICT (email) DO NOTHING`,
          [ne.nom, ne.prenom, ne.email, hashed, ne.telephone || null, u(c).id]
        )
      } catch { /* email déjà pris */ }
    }
  }

  if (!b.etudiant_id || !b.cout_total || !Array.isArray(b.modules) || b.modules.length === 0) {
    return c.json({ error: 'etudiant_id (ou new_etudiant), cout_total et modules[] requis' }, 400)
  }
  const cout = parseFloat(b.cout_total)
  const pctInscription = parseFloat(b.pct_inscription) || 50
  const pctFormateur = parseFloat(b.pct_formateur) || 50

  // Créer la formation
  const { rows } = await pool.query(
    `INSERT INTO formations_individuelles (etudiant_id,type_formation_id,annee_academique_id,cout_total,pct_inscription,pct_formateur,date_debut,date_fin,created_by,groupe_fi,entreprise)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [b.etudiant_id, b.type_formation_id || null, b.annee_academique_id || null, cout, pctInscription, pctFormateur, b.date_debut || null, b.date_fin || null, u(c).id, b.groupe_fi || null, b.entreprise || null]
  )
  const fi = rows[0]

  // Ajouter les modules
  for (const mod of b.modules) {
    await pool.query(
      `INSERT INTO fi_modules (formation_individuelle_id,matiere_id,volume_horaire,enseignant_id)
       VALUES ($1,$2,$3,$4)`,
      [fi.id, mod.matiere_id, mod.volume_horaire || 0, mod.enseignant_id || null]
    )
  }

  // Échéancier 50/50
  const montantInscription = Math.round(cout * pctInscription / 100)
  const montantSolde = cout - montantInscription
  await pool.query(
    `INSERT INTO fi_paiements (formation_individuelle_id,type,montant,date_echeance) VALUES ($1,'inscription',$2,$3)`,
    [fi.id, montantInscription, b.date_debut || new Date().toISOString().slice(0, 10)]
  )
  if (montantSolde > 0) {
    await pool.query(
      `INSERT INTO fi_paiements (formation_individuelle_id,type,montant,date_echeance) VALUES ($1,'solde',$2,$3)`,
      [fi.id, montantSolde, b.date_fin || null]
    )
  }

  return c.json(fi, 201)
})

// Créer une formation individuelle de GROUPE (même formation pour N étudiants)
// Accepte etudiant_ids[] (existants) ET/OU participants[] (nouveaux à créer)
// Tarification : cout_mode = 'par_personne' (défaut) ou 'total_groupe'
app.post('/formations-individuelles/groupe', requireAuth, role('dg', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const existingIds: number[] = Array.isArray(b.etudiant_ids) ? b.etudiant_ids : []
  const newParticipants: any[] = Array.isArray(b.participants) ? b.participants : []

  if (existingIds.length === 0 && newParticipants.length === 0) {
    return c.json({ error: 'Ajoutez au moins un participant (existant ou nouveau)' }, 400)
  }
  if (!b.cout_total || !Array.isArray(b.modules) || b.modules.length === 0) {
    return c.json({ error: 'cout_total et modules[] requis' }, 400)
  }

  // 1. Créer les nouveaux étudiants + comptes utilisateurs
  const defaultPassword = await bcrypt.hash('Uptech@2026', 10)
  const allEtudiantIds = [...existingIds]
  for (const p of newParticipants) {
    if (!p.nom || !p.prenom) continue
    const seq = await nextSeq('etudiants')
    const numero = `UPTECH-${year()}-${pad(seq)}`
    const { rows } = await pool.query(
      `INSERT INTO etudiants (numero_etudiant,nom,prenom,email,telephone) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [numero, p.nom, p.prenom, p.email || null, p.telephone || null]
    )
    allEtudiantIds.push(rows[0].id)
    // Auto-créer un compte utilisateur si email fourni
    if (p.email) {
      try {
        await pool.query(
          `INSERT INTO users (nom,prenom,email,password,role,telephone,statut,premier_connexion,cgu_acceptees,created_by)
           VALUES ($1,$2,$3,$4,'etudiant',$5,'actif',true,false,$6) ON CONFLICT (email) DO NOTHING`,
          [p.nom, p.prenom, p.email, defaultPassword, p.telephone || null, u(c).id]
        )
      } catch { /* email déjà pris */ }
    }
  }
  // Auto-créer comptes pour les étudiants existants qui n'en ont pas
  for (const eid of existingIds) {
    try {
      await pool.query(
        `INSERT INTO users (nom,prenom,email,password,role,telephone,statut,premier_connexion,cgu_acceptees,created_by)
         SELECT e.nom,e.prenom,e.email,$1,'etudiant',e.telephone,'actif',true,false,$2
         FROM etudiants e WHERE e.id=$3 AND e.email IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM users u WHERE LOWER(u.email)=LOWER(e.email))`,
        [defaultPassword, u(c).id, eid]
      )
    } catch { /* skip */ }
  }

  if (allEtudiantIds.length === 0) return c.json({ error: 'Aucun participant valide' }, 400)

  // 2. Tarification
  const coutMode = b.cout_mode || 'par_personne'
  const coutBrut = parseFloat(b.cout_total)
  const coutParPersonne = coutMode === 'total_groupe' ? Math.round(coutBrut / allEtudiantIds.length) : coutBrut
  const pctInscription = parseFloat(b.pct_inscription) || 50
  const pctFormateur = parseFloat(b.pct_formateur) || 50
  const montantInscription = Math.round(coutParPersonne * pctInscription / 100)
  const montantSolde = coutParPersonne - montantInscription

  const groupeId = crypto.randomUUID()
  const entreprise = b.entreprise || null
  const created: any[] = []

  // 3. Créer FI + modules + paiements pour chaque étudiant
  for (const etudiantId of allEtudiantIds) {
    const { rows } = await pool.query(
      `INSERT INTO formations_individuelles (etudiant_id,type_formation_id,annee_academique_id,cout_total,pct_inscription,pct_formateur,date_debut,date_fin,created_by,groupe_fi,entreprise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [etudiantId, b.type_formation_id || null, b.annee_academique_id || null, coutParPersonne, pctInscription, pctFormateur, b.date_debut || null, b.date_fin || null, u(c).id, groupeId, entreprise]
    )
    const fi = rows[0]
    for (const mod of b.modules) {
      await pool.query(
        `INSERT INTO fi_modules (formation_individuelle_id,matiere_id,volume_horaire,enseignant_id) VALUES ($1,$2,$3,$4)`,
        [fi.id, mod.matiere_id, mod.volume_horaire || 0, mod.enseignant_id || null]
      )
    }
    await pool.query(
      `INSERT INTO fi_paiements (formation_individuelle_id,type,montant,date_echeance) VALUES ($1,'inscription',$2,$3)`,
      [fi.id, montantInscription, b.date_debut || new Date().toISOString().slice(0, 10)]
    )
    if (montantSolde > 0) {
      await pool.query(
        `INSERT INTO fi_paiements (formation_individuelle_id,type,montant,date_echeance) VALUES ($1,'solde',$2,$3)`,
        [fi.id, montantSolde, b.date_fin || null]
      )
    }
    created.push(fi)
  }

  return c.json({ ok: true, groupe_fi: groupeId, entreprise, count: created.length, cout_par_personne: coutParPersonne, formations: created }, 201)
})

// Planifier séances pour tout un GROUPE FI (crée les séances pour chaque étudiant du groupe)
app.post('/seances/fi-planifier-groupe', requireAuth, role('dg', 'dir_peda', 'coordinateur', 'secretariat', 'enseignant'), async (c) => {
  try {
    const b = await c.req.json()
    if (!b.groupe_fi || !b.matiere_id || !b.enseignant_id || !b.heure_debut || !b.heure_fin || !b.date_debut) {
      return c.json({ error: 'groupe_fi, matiere_id, enseignant_id, heure_debut, heure_fin, date_debut requis' }, 400)
    }
    const jours: number[] = Array.isArray(b.jours) ? b.jours : (b.jour ? [parseInt(b.jour)] : [])
    if (jours.length === 0) return c.json({ error: 'jours[] requis' }, 400)

    // Trouver tous les fi_modules du groupe pour cette matière
    const { rows: groupModules } = await pool.query(`
      SELECT fm.id as fi_module_id, fm.volume_horaire, fm.heures_effectuees, fi.etudiant_id
      FROM fi_modules fm
      JOIN formations_individuelles fi ON fm.formation_individuelle_id = fi.id
      WHERE fi.groupe_fi = $1 AND fm.matiere_id = $2
    `, [b.groupe_fi, b.matiere_id])
    if (groupModules.length === 0) return c.json({ error: 'Aucun module trouvé pour ce groupe/matière' }, 404)

    // Utiliser le premier module comme référence pour le calcul des séances
    const ref = groupModules[0]
    const heuresRestantes = (ref.volume_horaire || 0) - (ref.heures_effectuees || 0)
    if (heuresRestantes <= 0) return c.json({ error: 'Module déjà terminé' }, 400)

    const parts1 = b.heure_debut.split(':')
    const parts2 = b.heure_fin.split(':')
    const dureeSeance = (Number(parts2[0]) + Number(parts2[1] || 0) / 60) - (Number(parts1[0]) + Number(parts1[1] || 0) / 60)
    if (dureeSeance <= 0) return c.json({ error: 'Heure fin doit être après heure début' }, 400)
    const nbSeances = Math.ceil(heuresRestantes / dureeSeance)

    let conges: any[] = []
    try { const { rows } = await pool.query('SELECT date_debut, date_fin, nom FROM conges_institut'); conges = rows } catch {}
    let dispos: any[] = []
    try { const { rows } = await pool.query('SELECT jour, heure_debut, heure_fin FROM disponibilites_enseignant WHERE enseignant_id=$1 AND actif=true', [b.enseignant_id]); dispos = rows } catch {}
    const hasDispos = dispos.length > 0
    const { rows: aaRows } = await pool.query("SELECT id FROM annees_academiques WHERE actif=true LIMIT 1")
    const aaId = aaRows[0]?.id || null
    const jsDays = new Set(jours.map((j: number) => j === 7 ? 0 : j))
    const groupeSerieId = crypto.randomUUID()
    const startDate = new Date(b.date_debut + 'T00:00:00')
    let current = new Date(startDate)
    let created = 0
    const exclues: { date: string; raison: string }[] = []
    const maxIter = nbSeances * 4 + 200
    const mode = b.mode || 'presentiel'
    const salle = b.salle || null
    const jourNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']

    for (let iter = 0; created < nbSeances && iter < maxIter; iter++) {
      const dow = current.getDay()
      if (!jsDays.has(dow)) { current.setDate(current.getDate() + 1); continue }
      const dateStr = current.toISOString().slice(0, 10)
      const jourNom = jourNoms[dow] || ''

      const conge = conges.find((cg: any) => dateStr >= (cg.date_debut?.toString().slice(0, 10)) && dateStr <= (cg.date_fin?.toString().slice(0, 10)))
      if (conge) { exclues.push({ date: `${dateStr} (${jourNom})`, raison: `Congé : ${conge.nom || 'férié'}` }); current.setDate(current.getDate() + 1); continue }
      if (hasDispos) {
        const ok = dispos.some((d: any) => d.jour === dow && d.heure_debut.toString().slice(0, 5) <= b.heure_debut && d.heure_fin.toString().slice(0, 5) >= b.heure_fin)
        if (!ok) { exclues.push({ date: `${dateStr} (${jourNom})`, raison: 'Prof non disponible' }); current.setDate(current.getDate() + 1); continue }
      }
      const { rows: conflitProf } = await pool.query(
        `SELECT id FROM seances WHERE enseignant_id=$1 AND statut != 'annule' AND date_debut::date = $2 AND (date_debut::time < $4::time AND date_fin::time > $3::time)`,
        [b.enseignant_id, dateStr, b.heure_debut, b.heure_fin]
      )
      if (conflitProf.length > 0) { exclues.push({ date: `${dateStr} (${jourNom})`, raison: 'Conflit horaire du formateur' }); current.setDate(current.getDate() + 1); continue }

      // Créer une séance pour CHAQUE étudiant du groupe
      const debut = `${dateStr}T${b.heure_debut}:00`
      const fin = `${dateStr}T${b.heure_fin}:00`
      for (const gm of groupModules) {
        await pool.query(
          `INSERT INTO seances (enseignant_id, matiere, date_debut, date_fin, mode, salle, statut, annee_academique_id, created_by, fi_module_id, groupe_serie)
           VALUES ($1, $2, $3, $4, $5, $6, 'planifie', $7, $8, $9, $10)`,
          [b.enseignant_id, b.matiere_nom || b.matiere, debut, fin, mode, salle, aaId, u(c).id, gm.fi_module_id, groupeSerieId]
        )
      }
      created++
      current.setDate(current.getDate() + 1)
    }

    return c.json({ ok: true, total_crees: created, etudiants: groupModules.length, seances_totales: created * groupModules.length, exclues, groupe_serie: groupeSerieId })
  } catch (err: any) {
    console.error('fi-planifier-groupe error:', err)
    return c.json({ error: err?.message || 'Erreur serveur' }, 500)
  }
})

// Modifier une formation individuelle
app.put('/formations-individuelles/:id', requireAuth, role('dg', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const id = c.req.param('id')
  const { rows } = await pool.query(
    `UPDATE formations_individuelles SET cout_total=COALESCE($1,cout_total), pct_inscription=COALESCE($2,pct_inscription),
     pct_formateur=COALESCE($3,pct_formateur), statut=COALESCE($4,statut), date_debut=COALESCE($5,date_debut),
     date_fin=COALESCE($6,date_fin) WHERE id=$7 RETURNING *`,
    [b.cout_total, b.pct_inscription, b.pct_formateur, b.statut, b.date_debut, b.date_fin, id]
  )
  if (!rows[0]) return c.json({ error: 'Non trouvé' }, 404)

  // Mettre à jour les modules si fournis
  if (Array.isArray(b.modules)) {
    await pool.query('DELETE FROM fi_modules WHERE formation_individuelle_id=$1', [id])
    for (const mod of b.modules) {
      await pool.query(
        `INSERT INTO fi_modules (formation_individuelle_id,matiere_id,volume_horaire,enseignant_id) VALUES ($1,$2,$3,$4)`,
        [id, mod.matiere_id, mod.volume_horaire || 0, mod.enseignant_id || null]
      )
    }
  }

  // Recalculer l'échéancier si cout changé
  if (b.cout_total) {
    const cout = parseFloat(b.cout_total)
    const pctI = parseFloat(rows[0].pct_inscription)
    const montantInscription = Math.round(cout * pctI / 100)
    const montantSolde = cout - montantInscription
    // Mettre à jour seulement les non payés
    await pool.query(`UPDATE fi_paiements SET montant=$1 WHERE formation_individuelle_id=$2 AND type='inscription' AND statut='non_paye'`, [montantInscription, id])
    await pool.query(`UPDATE fi_paiements SET montant=$1 WHERE formation_individuelle_id=$2 AND type='solde' AND statut='non_paye'`, [montantSolde, id])
  }

  return c.json(rows[0])
})

// Enregistrer un paiement sur formation individuelle
app.post('/formations-individuelles/:id/payer', requireAuth, role('dg', 'coordinateur', 'comptable'), async (c) => {
  const b = await c.req.json()
  const fiId = c.req.param('id')
  if (!b.paiement_id || !b.montant) return c.json({ error: 'paiement_id et montant requis' }, 400)

  const { rows } = await pool.query('SELECT * FROM fi_paiements WHERE id=$1 AND formation_individuelle_id=$2', [b.paiement_id, fiId])
  if (!rows[0]) return c.json({ error: 'Échéance non trouvée' }, 404)

  const echeance = rows[0]
  const nouveauPaye = parseFloat(echeance.montant_paye) + parseFloat(b.montant)
  const statut = nouveauPaye >= parseFloat(echeance.montant) ? 'paye' : 'partiel'

  await pool.query(
    `UPDATE fi_paiements SET montant_paye=$1, statut=$2, date_paiement=$3 WHERE id=$4`,
    [nouveauPaye, statut, new Date().toISOString().slice(0, 10), b.paiement_id]
  )

  // Vérifier si tout est payé → mettre la formation en "soldé"
  const { rows: restant } = await pool.query(
    `SELECT COUNT(*) as c FROM fi_paiements WHERE formation_individuelle_id=$1 AND statut != 'paye'`, [fiId]
  )
  if (parseInt(restant[0].c) === 0) {
    await pool.query(`UPDATE formations_individuelles SET statut='solde' WHERE id=$1`, [fiId])
  }

  return c.json({ ok: true, statut })
})

// Mettre à jour les heures effectuées d'un module
app.put('/fi-modules/:id/heures', requireAuth, role('dg', 'coordinateur', 'enseignant'), async (c) => {
  const b = await c.req.json()
  const heures = parseInt(b.heures_effectuees) || 0
  const { rows } = await pool.query(
    `UPDATE fi_modules SET heures_effectuees=$1 WHERE id=$2 RETURNING *`,
    [heures, c.req.param('id')]
  )
  if (!rows[0]) return c.json({ error: 'Module non trouvé' }, 404)

  // Vérifier si tous les modules de cette formation sont terminés
  const fiId = rows[0].formation_individuelle_id
  const { rows: check } = await pool.query(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE heures_effectuees >= volume_horaire) as termines
     FROM fi_modules WHERE formation_individuelle_id = $1`,
    [fiId]
  )
  const total = parseInt(check[0].total)
  const termines = parseInt(check[0].termines)

  if (total > 0 && termines === total) {
    // Tous les modules terminés → clôturer la formation
    await pool.query(
      `UPDATE formations_individuelles SET statut='termine', date_fin=CURRENT_DATE WHERE id=$1 AND statut != 'termine'`,
      [fiId]
    )
    return c.json({ ...rows[0], formation_terminee: true })
  }

  return c.json(rows[0])
})

// Supprimer une formation individuelle
app.delete('/formations-individuelles/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM formations_individuelles WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── PARCOURS ─────────────────────────────────────────────────────────────────
app.get('/parcours', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT p.*, tf.nom as type_formation_nom
    FROM parcours p LEFT JOIN types_formation tf ON p.type_formation_id = tf.id ORDER BY p.nom
  `)
  return c.json(rows)
})

app.post('/parcours', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO parcours (nom,code,description,type_formation_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.nom, b.code || null, b.description || null, b.type_formation_id || null]
  )
  return c.json(rows[0], 201)
})

app.put('/parcours/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE parcours SET nom=$1,code=$2,description=$3,type_formation_id=$4 WHERE id=$5 RETURNING *',
    [b.nom, b.code || null, b.description || null, b.type_formation_id || null, c.req.param('id')]
  )
  return c.json(rows[0])
})

// ─── ANNEES ACADEMIQUES ───────────────────────────────────────────────────────
app.get('/annees-academiques', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM annees_academiques ORDER BY date_debut DESC')
  return c.json(rows)
})

app.post('/annees-academiques', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO annees_academiques (libelle,date_debut,date_fin,actif) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.libelle, b.date_debut, b.date_fin, b.actif ?? false]
  )
  return c.json(rows[0], 201)
})

app.put('/annees-academiques/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE annees_academiques SET libelle=$1,date_debut=$2,date_fin=$3,actif=$4 WHERE id=$5 RETURNING *',
    [b.libelle, b.date_debut, b.date_fin, b.actif ?? false, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/annees-academiques/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM annees_academiques WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── CLASSES ──────────────────────────────────────────────────────────────────
app.get('/classes', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT c.*,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code,'type_formation_id',f.type_formation_id) ELSE NULL END as filiere,
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle,'actif',aa.actif) ELSE NULL END as annee_academique,
      COALESCE(json_agg(DISTINCT jsonb_build_object('id',p.id,'nom',p.nom)) FILTER (WHERE p.id IS NOT NULL),'[]') as parcours,
      COALESCE((SELECT json_agg(jsonb_build_object('id',tc2.id,'nom',tc2.nom))
        FROM classe_tronc_commun ctc2
        JOIN classes tc2 ON ctc2.tronc_commun_id = tc2.id
        WHERE ctc2.classe_id = c.id), '[]') as troncs_commun
    FROM classes c
    LEFT JOIN filieres f ON c.filiere_id = f.id
    LEFT JOIN annees_academiques aa ON c.annee_academique_id = aa.id
    LEFT JOIN classes_parcours cp ON c.id = cp.classe_id
    LEFT JOIN parcours p ON cp.parcours_id = p.id
    GROUP BY c.id,f.id,f.nom,f.code,f.type_formation_id,aa.id,aa.libelle ORDER BY c.nom
  `)
  return c.json(rows)
})

app.post('/classes', requireAuth, role('dg', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const estTronc = b.est_tronc_commun ?? false
  const { rows } = await pool.query(
    'INSERT INTO classes (nom,filiere_id,annee_academique_id,niveau,est_tronc_commun,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.nom, estTronc ? null : b.filiere_id, b.annee_academique_id, b.niveau ?? 1, estTronc, u(c).id]
  )
  const classe = rows[0]
  if (Array.isArray(b.parcours_ids)) {
    for (const pid of b.parcours_ids)
      await pool.query('INSERT INTO classes_parcours (classe_id,parcours_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [classe.id, pid])
  }
  // Tronc commun : many-to-many
  if (Array.isArray(b.tronc_commun_ids)) {
    for (const tcId of b.tronc_commun_ids)
      await pool.query('INSERT INTO classe_tronc_commun (classe_id,tronc_commun_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [classe.id, tcId])
  } else if (b.tronc_commun_id) {
    await pool.query('INSERT INTO classe_tronc_commun (classe_id,tronc_commun_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [classe.id, b.tronc_commun_id])
  }
  // Retourner la classe complète
  const { rows: fullRows } = await pool.query(`
    SELECT c.*,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code,'type_formation_id',f.type_formation_id) ELSE NULL END as filiere,
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle,'actif',aa.actif) ELSE NULL END as annee_academique,
      COALESCE(json_agg(DISTINCT jsonb_build_object('id',p.id,'nom',p.nom)) FILTER (WHERE p.id IS NOT NULL),'[]') as parcours,
      COALESCE((SELECT json_agg(jsonb_build_object('id',tc2.id,'nom',tc2.nom))
        FROM classe_tronc_commun ctc2
        JOIN classes tc2 ON ctc2.tronc_commun_id = tc2.id
        WHERE ctc2.classe_id = c.id), '[]') as troncs_commun
    FROM classes c
    LEFT JOIN filieres f ON c.filiere_id = f.id
    LEFT JOIN annees_academiques aa ON c.annee_academique_id = aa.id
    LEFT JOIN classes_parcours cp ON c.id = cp.classe_id
    LEFT JOIN parcours p ON cp.parcours_id = p.id
    WHERE c.id = $1
    GROUP BY c.id,f.id,f.nom,f.code,f.type_formation_id,aa.id,aa.libelle
  `, [classe.id])
  return c.json(fullRows[0] || classe, 201)
})

app.put('/classes/:id', requireAuth, role('dg', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const estTronc = b.est_tronc_commun ?? false
  const { rows } = await pool.query(
    'UPDATE classes SET nom=$1,filiere_id=$2,annee_academique_id=$3,niveau=$4,est_tronc_commun=$5,date_debut_cours=$7 WHERE id=$6 RETURNING *',
    [b.nom, estTronc ? null : b.filiere_id, b.annee_academique_id, b.niveau ?? 1, estTronc, c.req.param('id'), b.date_debut_cours || null]
  )
  await pool.query('DELETE FROM classes_parcours WHERE classe_id=$1', [c.req.param('id')])
  if (Array.isArray(b.parcours_ids)) {
    for (const pid of b.parcours_ids)
      await pool.query('INSERT INTO classes_parcours (classe_id,parcours_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.req.param('id'), pid])
  }
  // Tronc commun : remplacer les liens
  await pool.query('DELETE FROM classe_tronc_commun WHERE classe_id=$1', [c.req.param('id')])
  if (Array.isArray(b.tronc_commun_ids)) {
    for (const tcId of b.tronc_commun_ids)
      await pool.query('INSERT INTO classe_tronc_commun (classe_id,tronc_commun_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.req.param('id'), tcId])
  } else if (b.tronc_commun_id) {
    await pool.query('INSERT INTO classe_tronc_commun (classe_id,tronc_commun_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.req.param('id'), b.tronc_commun_id])
  }
  return c.json(rows[0])
})

app.delete('/classes/:id', requireAuth, role('dg', 'coordinateur'), async (c) => {
  await pool.query('DELETE FROM classes WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── ETUDIANTS ────────────────────────────────────────────────────────────────
app.get('/etudiants', requireAuth, async (c) => {
  const search         = c.req.query('search')           || ''
  const page           = Math.max(1, parseInt(c.req.query('page') || '1'))
  const filiereId      = c.req.query('filiere_id')       || ''
  const classeId       = c.req.query('classe_id')        || ''
  const typeFormId     = c.req.query('type_formation_id') || ''
  const anneeId        = c.req.query('annee_academique_id') || ''
  const perPage        = 20
  const offset         = (page - 1) * perPage

  // Filtre année dans le CTE (safe car parseInt)
  const anneeFilter = anneeId ? `WHERE ins.annee_academique_id = ${parseInt(anneeId)}` : ''

  // Construction dynamique des conditions
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (search) {
    params.push(`%${search}%`)
    conditions.push(`(e.nom ILIKE $${params.length} OR e.prenom ILIKE $${params.length} OR e.numero_etudiant ILIKE $${params.length} OR e.email ILIKE $${params.length})`)
  }
  if (filiereId) {
    params.push(parseInt(filiereId))
    conditions.push(`ia.filiere_id = $${params.length}`)
  }
  if (classeId) {
    params.push(parseInt(classeId))
    conditions.push(`ia.classe_id = $${params.length}`)
  }
  if (typeFormId) {
    params.push(parseInt(typeFormId))
    conditions.push(`ia.type_formation_id = $${params.length}`)
  }
  // Quand filtre par année : inclure uniquement les étudiants sans inscription connue (LEFT JOIN)
  // mais s'assurer qu'on ne ramène que ceux qui ont une inscription dans cette année
  if (anneeId) {
    conditions.push(`ia.etudiant_id IS NOT NULL`)
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const cte = `
    WITH ia AS (
      SELECT DISTINCT ON (ins.etudiant_id)
        ins.etudiant_id, ins.filiere_id, ins.classe_id, f.type_formation_id
      FROM inscriptions ins
      LEFT JOIN filieres f ON ins.filiere_id = f.id
      ${anneeFilter}
      ORDER BY ins.etudiant_id, ins.created_at DESC
    )`

  const { rows: countRows } = await pool.query(
    `${cte} SELECT COUNT(*)::int as total FROM etudiants e LEFT JOIN ia ON ia.etudiant_id = e.id ${whereClause}`,
    params
  )
  const total = countRows[0].total

  params.push(perPage)
  const limitIdx = params.length
  params.push(offset)
  const offsetIdx = params.length

  const { rows } = await pool.query(
    `${cte}
    SELECT e.*,
      (SELECT jsonb_build_object(
        'id', ins.id, 'statut', ins.statut, 'acces_bloque', ins.acces_bloque,
        'frais_inscription', ins.frais_inscription, 'mensualite', ins.mensualite,
        'frais_tenue', ins.frais_tenue, 'contrat_path', ins.contrat_path,
        'filiere', CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code,'type_formation_id',f.type_formation_id,'frais_inscription',f.frais_inscription,'mensualite',f.mensualite,'montant_tenue',COALESCE(f.montant_tenue,0)) ELSE NULL END,
        'classe', CASE WHEN cl.id IS NOT NULL THEN jsonb_build_object('id',cl.id,'nom',cl.nom,'niveau',cl.niveau) ELSE NULL END,
        'niveau_entree', CASE WHEN ne.id IS NOT NULL THEN jsonb_build_object('id',ne.id,'nom',ne.nom,'est_superieur_bac',ne.est_superieur_bac) ELSE NULL END,
        'niveau_bourse', CASE WHEN nb.id IS NOT NULL THEN jsonb_build_object('id',nb.id,'nom',nb.nom,'pourcentage',nb.pourcentage) ELSE NULL END
      )
      FROM inscriptions ins
      LEFT JOIN filieres f ON ins.filiere_id = f.id
      LEFT JOIN classes cl ON ins.classe_id = cl.id
      LEFT JOIN niveaux_entree ne ON ins.niveau_entree_id = ne.id
      LEFT JOIN niveaux_bourse nb ON ins.niveau_bourse_id = nb.id
      WHERE ins.etudiant_id = e.id ${anneeId ? `AND ins.annee_academique_id = ${parseInt(anneeId)}` : ''}
      ORDER BY ins.created_at DESC LIMIT 1
      ) as inscription_active,
      (SELECT jsonb_build_object(
        'id', fi.id, 'cout_total', fi.cout_total, 'statut', fi.statut,
        'pct_inscription', fi.pct_inscription, 'pct_formateur', fi.pct_formateur,
        'date_debut', fi.date_debut, 'date_fin', fi.date_fin,
        'type_formation', CASE WHEN tf.id IS NOT NULL THEN jsonb_build_object('id',tf.id,'nom',tf.nom) ELSE NULL END
      )
      FROM formations_individuelles fi
      LEFT JOIN types_formation tf ON fi.type_formation_id = tf.id
      WHERE fi.etudiant_id = e.id
      ORDER BY fi.created_at DESC LIMIT 1
      ) as formation_individuelle_active
    FROM etudiants e
    LEFT JOIN ia ON ia.etudiant_id = e.id
    ${whereClause} ORDER BY e.nom, e.prenom
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  )
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  return c.json({ data: rows, current_page: page, last_page: lastPage, per_page: perPage, total })
})

// ─── Table attestations ───────────────────────────────────────────────────────
pool.query(`CREATE TABLE IF NOT EXISTS attestations (
  id SERIAL PRIMARY KEY,
  reference VARCHAR(120) UNIQUE NOT NULL,
  etudiant_nom VARCHAR(200) NOT NULL,
  etudiant_prenom VARCHAR(200) NOT NULL,
  numero_etudiant VARCHAR(50),
  filiere VARCHAR(200),
  classe VARCHAR(200),
  annee_academique VARCHAR(20),
  type_attestation VARCHAR(50) DEFAULT 'scolarite',
  mention VARCHAR(80),
  moyenne NUMERIC(5,2),
  session VARCHAR(30),
  generated_at TIMESTAMP DEFAULT NOW(),
  generated_by INT REFERENCES users(id) ON DELETE SET NULL,
  expires_at DATE,
  statut VARCHAR(20) DEFAULT 'valide'
)`).catch(() => {})

// ─── API attestations ─────────────────────────────────────────────────────────
// Vérification publique (sans auth)
app.get('/attestations/verify/:ref', async (c) => {
  const ref = c.req.param('ref')
  const { rows } = await pool.query(
    `SELECT a.*,
      u.prenom || ' ' || u.nom AS generee_par
     FROM attestations a
     LEFT JOIN users u ON a.generated_by = u.id
     WHERE a.reference = $1`,
    [ref]
  )
  if (!rows[0]) return c.json({ message: 'Attestation introuvable ou invalide.' }, 404)
  const att = rows[0]
  if (att.statut === 'revoquee') return c.json({ message: 'Cette attestation a été révoquée.' }, 410)
  if (att.expires_at && new Date(att.expires_at) < new Date()) return c.json({ message: 'Cette attestation a expiré.' }, 410)
  return c.json(att)
})

// Sauvegarde (auth requise)
app.post('/attestations', requireAuth, async (c) => {
  const b = await c.req.json()
  const user = u(c)
  const { rows } = await pool.query(
    `INSERT INTO attestations
      (reference, etudiant_nom, etudiant_prenom, numero_etudiant, filiere, classe, annee_academique, type_attestation, mention, moyenne, session, generated_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (reference) DO UPDATE SET generated_at = NOW()
     RETURNING *`,
    [
      b.reference, b.etudiant_nom, b.etudiant_prenom, b.numero_etudiant || null,
      b.filiere || null, b.classe || null, b.annee_academique || null,
      b.type_attestation || 'scolarite', b.mention || null,
      b.moyenne != null ? Number(b.moyenne) : null,
      b.session || null, user.id,
      b.expires_at || null
    ]
  )
  return c.json(rows[0], 201)
})

// ─── Vérification publique QR code (sans auth) ───────────────────────────────
app.get('/verify/:numero', async (c) => {
  const numero = c.req.param('numero')
  const { rows } = await pool.query(`
    SELECT e.nom, e.prenom, e.numero_etudiant, e.photo_path,
      i.statut,
      COALESCE(f.nom, cl.nom) AS filiere_nom,
      aa.libelle AS annee_libelle,
      CASE WHEN cl.id IS NOT NULL
        THEN jsonb_build_object('id', cl.id, 'nom', cl.nom)
        ELSE NULL END AS classe
    FROM etudiants e
    LEFT JOIN inscriptions i ON i.etudiant_id = e.id
      AND i.statut NOT IN ('abandonne')
    LEFT JOIN filieres f ON i.filiere_id = f.id
    LEFT JOIN classes cl ON i.classe_id = cl.id
    LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
    WHERE e.numero_etudiant = $1
    ORDER BY
      CASE i.statut
        WHEN 'inscrit_actif' THEN 1 WHEN 'en_examen' THEN 2
        WHEN 'pre_inscrit' THEN 3 ELSE 4
      END,
      i.created_at DESC
    LIMIT 1
  `, [numero])
  if (!rows[0]) return c.json({ message: 'Étudiant introuvable.' }, 404)
  return c.json(rows[0])
})

// ─── INDICATEUR DE RISQUE D'ABANDON ──────────────────────────────────────────
app.get('/etudiants/risques', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    WITH active_inscriptions AS (
      SELECT DISTINCT ON (etudiant_id)
        etudiant_id, id AS inscription_id, filiere_id
      FROM inscriptions
      ORDER BY etudiant_id, created_at DESC
    ),
    presence_risk AS (
      SELECT ai.etudiant_id,
        COUNT(pr.id)                                                       AS total_seances,
        COUNT(CASE WHEN pr.statut IN ('present','retard') THEN 1 END)     AS presences_count,
        CASE
          WHEN COUNT(pr.id) = 0 THEN 'green'
          WHEN COUNT(CASE WHEN pr.statut IN ('present','retard') THEN 1 END)::float / COUNT(pr.id) >= 0.75 THEN 'green'
          WHEN COUNT(CASE WHEN pr.statut IN ('present','retard') THEN 1 END)::float / COUNT(pr.id) >= 0.5  THEN 'yellow'
          ELSE 'red'
        END AS risque,
        CASE WHEN COUNT(pr.id) > 0
          THEN ROUND(COUNT(CASE WHEN pr.statut IN ('present','retard') THEN 1 END)::numeric / COUNT(pr.id) * 100)
          ELSE NULL END AS taux
      FROM active_inscriptions ai
      LEFT JOIN presences pr ON pr.inscription_id = ai.inscription_id
        AND pr.created_at >= NOW() - INTERVAL '60 days'
      GROUP BY ai.etudiant_id
    ),
    paiement_risk AS (
      SELECT ai.etudiant_id,
        MAX(CURRENT_DATE - ech.mois::date)::int AS jours_retard,
        CASE
          WHEN MAX(CURRENT_DATE - ech.mois::date) IS NULL THEN 'green'
          WHEN MAX(CURRENT_DATE - ech.mois::date) > 30    THEN 'red'
          WHEN MAX(CURRENT_DATE - ech.mois::date) > 15    THEN 'yellow'
          ELSE 'green'
        END AS risque
      FROM active_inscriptions ai
      LEFT JOIN echeances ech ON ech.inscription_id = ai.inscription_id
        AND ech.statut = 'non_paye' AND ech.mois < CURRENT_DATE
      GROUP BY ai.etudiant_id
    ),
    dossier_risk AS (
      SELECT ai.etudiant_id,
        COUNT(DISTINCT td.id)                                      AS total_docs,
        COUNT(DISTINCT CASE WHEN cd.recu = true THEN td.id END)    AS docs_recu,
        CASE
          WHEN COUNT(DISTINCT td.id) = 0 THEN 'green'
          WHEN COUNT(DISTINCT CASE WHEN cd.recu = true THEN td.id END) = COUNT(DISTINCT td.id) THEN 'green'
          WHEN COUNT(DISTINCT CASE WHEN cd.recu = true THEN td.id END)::float
               / NULLIF(COUNT(DISTINCT td.id),0) >= 0.5 THEN 'yellow'
          ELSE 'red'
        END AS risque
      FROM active_inscriptions ai
      LEFT JOIN filieres f ON f.id = ai.filiere_id
      LEFT JOIN types_documents td ON td.actif = true
        AND (td.type_formation_id IS NULL OR td.type_formation_id = f.type_formation_id)
      LEFT JOIN checklist_documents cd ON cd.etudiant_id = ai.etudiant_id
        AND cd.code = td.code AND cd.recu = true
      GROUP BY ai.etudiant_id
    )
    SELECT
      e.id           AS etudiant_id,
      pr.risque      AS risque_presence,  pr.taux      AS taux_presence,
      pr.presences_count, pr.total_seances,
      pay.risque     AS risque_paiement,  pay.jours_retard,
      dos.risque     AS risque_dossier,   dos.docs_recu, dos.total_docs,
      CASE
        WHEN pr.risque='red'    OR pay.risque='red'    OR dos.risque='red'    THEN 'red'
        WHEN pr.risque='yellow' OR pay.risque='yellow' OR dos.risque='yellow' THEN 'yellow'
        ELSE 'green'
      END AS risque_global
    FROM etudiants e
    JOIN active_inscriptions ai  ON ai.etudiant_id  = e.id
    JOIN presence_risk       pr  ON pr.etudiant_id  = e.id
    JOIN paiement_risk       pay ON pay.etudiant_id = e.id
    JOIN dossier_risk        dos ON dos.etudiant_id = e.id
    ORDER BY e.nom, e.prenom
  `)
  return c.json(rows)
})

app.get('/etudiants/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const { rows } = await pool.query('SELECT * FROM etudiants WHERE id=$1', [id])
  if (!rows[0]) return c.json({ message: 'Étudiant introuvable.' }, 404)
  const [inscrRows, docRows] = await Promise.all([
    pool.query(`
      SELECT i.*,
        CASE WHEN fi.id IS NOT NULL THEN jsonb_build_object('id',fi.id,'nom',fi.nom,'code',fi.code,'type_formation_id',fi.type_formation_id,'type_formation_nom',tfi.nom,'type_has_niveau',COALESCE(tfi.has_niveau,false)) ELSE NULL END as filiere,
        CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom,'niveau',c.niveau,'date_debut_cours',c.date_debut_cours,
          'filiere', CASE WHEN fc.id IS NOT NULL THEN jsonb_build_object('id',fc.id,'nom',fc.nom,'type_formation_id',fc.type_formation_id,'type_formation_nom',tfc.nom,'type_has_niveau',COALESCE(tfc.has_niveau,false)) ELSE NULL END
        ) ELSE NULL END as classe,
        CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_academique,
        CASE WHEN ne.id IS NOT NULL THEN jsonb_build_object('id',ne.id,'nom',ne.nom) ELSE NULL END as niveau_entree,
        CASE WHEN nb.id IS NOT NULL THEN jsonb_build_object('id',nb.id,'nom',nb.nom,'pourcentage',nb.pourcentage) ELSE NULL END as niveau_bourse
      FROM inscriptions i
      LEFT JOIN filieres fi ON i.filiere_id = fi.id
      LEFT JOIN types_formation tfi ON fi.type_formation_id = tfi.id
      LEFT JOIN classes c ON i.classe_id = c.id
      LEFT JOIN filieres fc ON c.filiere_id = fc.id
      LEFT JOIN types_formation tfc ON fc.type_formation_id = tfc.id
      LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
      LEFT JOIN niveaux_entree ne ON i.niveau_entree_id = ne.id
      LEFT JOIN niveaux_bourse nb ON i.niveau_bourse_id = nb.id
      WHERE i.etudiant_id = $1
      ORDER BY i.created_at DESC
    `, [id]),
    pool.query('SELECT * FROM documents_etudiant WHERE etudiant_id=$1 ORDER BY created_at DESC', [id])
  ])
  return c.json({ ...rows[0], inscriptions: inscrRows.rows, documents: docRows.rows })
})

app.post('/etudiants', requireAuth, role('secretariat', 'dg'), async (c) => {
  const b = await c.req.json()
  const seq = await nextSeq('etudiants')
  const numero = `UPTECH-${year()}-${pad(seq)}`
  const { rows } = await pool.query(
    `INSERT INTO etudiants (numero_etudiant,nom,prenom,email,telephone,date_naissance,lieu_naissance,adresse,cni_numero,nom_parent,telephone_parent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [numero, b.nom, b.prenom, b.email || null, b.telephone || null,
     b.date_naissance || null, b.lieu_naissance || null, b.adresse || null,
     b.cni_numero || null, b.nom_parent || null, b.telephone_parent || null]
  )
  return c.json(rows[0], 201)
})

app.put('/etudiants/:id', requireAuth, role('secretariat', 'dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE etudiants SET nom=$1,prenom=$2,email=$3,telephone=$4,date_naissance=$5,lieu_naissance=$6,
      adresse=$7,cni_numero=$8,nom_parent=$9,telephone_parent=$10 WHERE id=$11 RETURNING *`,
    [b.nom, b.prenom, b.email || null, b.telephone || null, b.date_naissance || null,
     b.lieu_naissance || null, b.adresse || null, b.cni_numero || null,
     b.nom_parent || null, b.telephone_parent || null, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.post('/etudiants/:id/photo', requireAuth, role('secretariat', 'dg'), async (c) => {
  const b = await c.req.json()
  const dataUrl = b.photo_base64
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return c.json({ message: 'Image base64 requise.' }, 400)
  const { rows } = await pool.query(
    'UPDATE etudiants SET photo_path=$1 WHERE id=$2 RETURNING photo_path',
    [dataUrl, c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Étudiant introuvable.' }, 404)
  return c.json({ photo_path: rows[0].photo_path })
})

app.get('/etudiants/:id/deletion-preview', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  const { rows: etud } = await pool.query('SELECT id, nom, prenom, email, user_id FROM etudiants WHERE id=$1', [id])
  if (!etud[0]) return c.json({ message: 'Étudiant introuvable.' }, 404)

  const { rows: inscRows } = await pool.query('SELECT id, statut, filiere_id FROM inscriptions WHERE etudiant_id=$1', [id])
  const inscIds = inscRows.map((r: any) => r.id)

  const [paiem, notes, presences, echeances, docs, docsEtud] = await Promise.all([
    inscIds.length
      ? pool.query(`SELECT COUNT(*)::int as cnt, COALESCE(SUM(montant),0)::float as total FROM paiements WHERE inscription_id = ANY($1::int[])`, [inscIds])
      : Promise.resolve({ rows: [{ cnt: 0, total: 0 }] }),
    inscIds.length
      ? pool.query(`SELECT COUNT(*)::int as cnt FROM notes WHERE inscription_id = ANY($1::int[])`, [inscIds])
      : Promise.resolve({ rows: [{ cnt: 0 }] }),
    inscIds.length
      ? pool.query(`SELECT COUNT(*)::int as cnt FROM presences WHERE inscription_id = ANY($1::int[])`, [inscIds])
      : Promise.resolve({ rows: [{ cnt: 0 }] }),
    inscIds.length
      ? pool.query(`SELECT COUNT(*)::int as cnt FROM echeances WHERE inscription_id = ANY($1::int[])`, [inscIds]).catch(() => ({ rows: [{ cnt: 0 }] }))
      : Promise.resolve({ rows: [{ cnt: 0 }] }),
    inscIds.length
      ? pool.query(`SELECT COUNT(*)::int as cnt FROM documents_etudiant WHERE inscription_id = ANY($1::int[])`, [inscIds])
      : Promise.resolve({ rows: [{ cnt: 0 }] }),
    pool.query(`SELECT COUNT(*)::int as cnt FROM documents_etudiant WHERE etudiant_id=$1 AND inscription_id IS NULL`, [id]),
  ])

  return c.json({
    etudiant: { id: etud[0].id, nom: etud[0].nom, prenom: etud[0].prenom, email: etud[0].email },
    niveaux: [
      {
        label: 'Inscriptions',
        count: inscRows.length,
        detail: `${inscRows.length} inscription(s)`,
        enfants: [
          { label: 'Paiements', count: paiem.rows[0].cnt, detail: `${paiem.rows[0].cnt} paiement(s) — ${Number(paiem.rows[0].total).toLocaleString('fr-FR')} FCFA encaissés` },
          { label: 'Échéanciers', count: echeances.rows[0].cnt, detail: `${echeances.rows[0].cnt} échéance(s) planifiée(s)` },
          { label: 'Notes', count: notes.rows[0].cnt, detail: `${notes.rows[0].cnt} note(s) de cours` },
          { label: 'Présences', count: presences.rows[0].cnt, detail: `${presences.rows[0].cnt} enregistrement(s) de présence` },
          { label: 'Documents liés', count: docs.rows[0].cnt, detail: `${docs.rows[0].cnt} document(s) d'inscription` },
        ]
      },
      { label: 'Documents personnels', count: docsEtud.rows[0].cnt, detail: `${docsEtud.rows[0].cnt} document(s) personnel(s)`, enfants: [] },
      { label: 'Compte utilisateur', count: etud[0].user_id ? 1 : 0, detail: etud[0].user_id ? '1 compte de connexion actif' : 'Aucun compte de connexion', enfants: [] },
    ]
  })
})

// ─── Timeline étudiant ───────────────────────────────────────────────────────
app.get('/etudiants/:id/timeline', requireAuth, async (c) => {
  const id = c.req.param('id')
  const { rows } = await pool.query(`
    WITH si AS (
      SELECT i.id AS inscription_id,
        COALESCE(f.nom, cl.nom, 'Filière inconnue') AS filiere_nom,
        COALESCE(aa.libelle, '') AS annee_libelle,
        i.statut, i.created_at
      FROM inscriptions i
      LEFT JOIN filieres f ON i.filiere_id = f.id
      LEFT JOIN classes cl ON i.classe_id = cl.id
      LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
      WHERE i.etudiant_id = $1
    )
    SELECT 'inscription' AS type, si.created_at AS event_date,
      si.filiere_nom AS titre,
      jsonb_build_object('statut', si.statut, 'annee', si.annee_libelle) AS meta
    FROM si

    UNION ALL

    SELECT 'paiement', COALESCE(p.confirmed_at, p.created_at),
      p.type_paiement,
      jsonb_build_object(
        'montant', p.montant::float,
        'mode', COALESCE(p.mode_paiement, ''),
        'numero_recu', COALESCE(p.numero_recu, ''),
        'mois', COALESCE(p.mois_concerne::text, '')
      ) AS meta
    FROM paiements p
    JOIN si ON p.inscription_id = si.inscription_id
    WHERE p.statut = 'confirme'

    UNION ALL

    SELECT 'note', n.created_at,
      ue.nom,
      jsonb_build_object(
        'note', n.note::float,
        'session', COALESCE(n.session, 'normale'),
        'ue_code', ue.code
      ) AS meta
    FROM notes n
    JOIN si ON n.inscription_id = si.inscription_id
    JOIN unites_enseignement ue ON n.ue_id = ue.id

    UNION ALL

    SELECT 'absence', pr.created_at,
      COALESCE(s.matiere, 'Cours'),
      jsonb_build_object('seance_date', s.date_debut::text, 'statut', pr.statut) AS meta
    FROM presences pr
    JOIN si ON pr.inscription_id = si.inscription_id
    JOIN seances s ON pr.seance_id = s.id
    WHERE pr.statut = 'absent'

    UNION ALL

    SELECT 'document', cd.date_reception,
      COALESCE(td.label, cd.code),
      jsonb_build_object('code', cd.code) AS meta
    FROM checklist_documents cd
    LEFT JOIN types_documents td ON td.code = cd.code
    WHERE cd.etudiant_id = $1 AND cd.recu = true AND cd.date_reception IS NOT NULL

    UNION ALL

    SELECT 'relance', r.created_at,
      CASE r.type_relance WHEN 'manuel' THEN 'Relance manuelle' ELSE 'Relance automatique' END,
      jsonb_build_object(
        'type_relance', r.type_relance,
        'jours_avant', r.jours_avant,
        'email', COALESCE(r.email_destinataire, ''),
        'statut', r.statut,
        'envoye_par', COALESCE(r.envoye_par::text, '')
      ) AS meta
    FROM relances_paiement r
    JOIN inscriptions insc ON insc.id = r.inscription_id
    WHERE insc.etudiant_id = $1 AND r.statut = 'envoye'

    ORDER BY event_date DESC NULLS LAST
  `, [id])
  return c.json(rows)
})

app.delete('/etudiants/:id', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Vérifier que l'étudiant existe
    const { rows: etudRows } = await client.query('SELECT id, user_id FROM etudiants WHERE id=$1', [id])
    if (!etudRows[0]) {
      await client.query('ROLLBACK')
      return c.json({ message: 'Étudiant introuvable.' }, 404)
    }
    const userId = etudRows[0].user_id

    // Récupérer les IDs d'inscriptions
    const { rows: inscRows } = await client.query('SELECT id FROM inscriptions WHERE etudiant_id=$1', [id])
    const inscIds = inscRows.map((r: any) => r.id)

    if (inscIds.length) {
      await client.query(`DELETE FROM notes WHERE inscription_id = ANY($1::int[])`, [inscIds])
      await client.query(`DELETE FROM paiements WHERE inscription_id = ANY($1::int[])`, [inscIds])
      await client.query(`DELETE FROM presences WHERE inscription_id = ANY($1::int[])`, [inscIds])
      await client.query(`DELETE FROM echeances WHERE inscription_id = ANY($1::int[])`, [inscIds]).catch(() => {})
      await client.query(`DELETE FROM documents_etudiant WHERE inscription_id = ANY($1::int[])`, [inscIds]).catch(() => {})
      await client.query(`DELETE FROM relances_paiement WHERE inscription_id = ANY($1::int[])`, [inscIds]).catch(() => {})
      await client.query('DELETE FROM inscriptions WHERE etudiant_id=$1', [id])
    }

    // Checklist documents liés directement à l'étudiant
    await client.query('DELETE FROM checklist_documents WHERE etudiant_id=$1', [id]).catch(() => {})
    // Documents restants liés directement à l'étudiant
    await client.query('DELETE FROM documents_etudiant WHERE etudiant_id=$1', [id]).catch(() => {})

    // Supprimer l'étudiant
    await client.query('DELETE FROM etudiants WHERE id=$1', [id])

    // Supprimer le compte utilisateur et toutes ses données liées
    if (userId) {
      // personal_access_tokens (Sanctum) — pas de FK déclarée mais on nettoie
      await client.query('DELETE FROM personal_access_tokens WHERE tokenable_id=$1', [userId]).catch(() => {})
      // Messages envoyés → doivent être supprimés avant les conversations (sender_id RESTRICT)
      await client.query('DELETE FROM messages WHERE sender_id=$1', [userId]).catch(() => {})
      // Conversations créées par cet utilisateur (created_by RESTRICT)
      // → le CASCADE supprime automatiquement les messages + participants liés
      await client.query('DELETE FROM conversations WHERE created_by=$1', [userId]).catch(() => {})
      // Participation dans d'autres conversations
      await client.query('DELETE FROM conversation_participants WHERE user_id=$1', [userId]).catch(() => {})
      // Supprimer le compte
      await client.query('DELETE FROM users WHERE id=$1', [userId])
    }

    await client.query('COMMIT')
    return c.json({ message: 'Étudiant supprimé définitivement.' })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ─── INSCRIPTIONS ─────────────────────────────────────────────────────────────
app.get('/inscriptions', requireAuth, async (c) => {
  const classeId    = c.req.query('classe_id')
  const statut      = c.req.query('statut')
  const etudiantId  = c.req.query('etudiant_id')
  const filiereId   = c.req.query('filiere_id')
  const sansClasse  = c.req.query('sans_classe')   // "1" → uniquement sans classe affectée
  const conditions: string[] = []
  const params: any[] = []
  if (classeId) {
    // Si c'est une classe tronc commun, inclure aussi les classes liées
    params.push(classeId)
    conditions.push(`(i.classe_id = $${params.length} OR i.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = $${params.length}))`)
  }
  if (statut)     { params.push(statut);     conditions.push(`i.statut = $${params.length}`) }
  if (etudiantId) { params.push(etudiantId); conditions.push(`i.etudiant_id = $${params.length}`) }
  if (filiereId)  { params.push(filiereId);  conditions.push(`i.filiere_id = $${params.length}`) }
  if (sansClasse === '1') conditions.push(`i.classe_id IS NULL`)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query(`
    SELECT i.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom,'email',e.email,'numero_etudiant',e.numero_etudiant) as etudiant,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom,'niveau',c.niveau) ELSE NULL END as classe,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code,'type_formation_id',f.type_formation_id,'frais_inscription',f.frais_inscription,'mensualite',f.mensualite,'montant_tenue',COALESCE(f.montant_tenue,0),'duree_mois',COALESCE(f.duree_mois,12)) ELSE NULL END as filiere,
      CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'nom',p.nom) ELSE NULL END as parcours,
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_academique,
      CASE WHEN ne.id IS NOT NULL THEN jsonb_build_object('id',ne.id,'nom',ne.nom) ELSE NULL END as niveau_entree,
      CASE WHEN nb.id IS NOT NULL THEN jsonb_build_object('id',nb.id,'nom',nb.nom,'pourcentage',nb.pourcentage) ELSE NULL END as niveau_bourse
    FROM inscriptions i
    LEFT JOIN etudiants e ON i.etudiant_id = e.id
    LEFT JOIN classes c ON i.classe_id = c.id
    LEFT JOIN filieres f ON i.filiere_id = f.id
    LEFT JOIN parcours p ON i.parcours_id = p.id
    LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
    LEFT JOIN niveaux_entree ne ON i.niveau_entree_id = ne.id
    LEFT JOIN niveaux_bourse nb ON i.niveau_bourse_id = nb.id
    ${where}
    ORDER BY e.nom,e.prenom
  `, params)
  return c.json(rows)
})

app.post('/inscriptions', requireAuth, role('secretariat', 'dg'), async (c) => {
  const b = await c.req.json()
  // Auto-populate tariffs from filière if not explicitly provided
  let fraisInscription = b.frais_inscription || 0
  let mensualite = b.mensualite || 0
  let fraisTenue = b.frais_tenue || 0
  if (b.filiere_id && (!fraisInscription && !mensualite)) {
    const { rows: fil } = await pool.query('SELECT frais_inscription,mensualite,montant_tenue FROM filieres WHERE id=$1', [b.filiere_id])
    if (fil[0]) {
      fraisInscription = parseFloat(fil[0].frais_inscription) || 0
      mensualite = parseFloat(fil[0].mensualite) || 0
      if (!fraisTenue) fraisTenue = parseFloat(fil[0].montant_tenue) || 0
    }
  }
  const moisDebutVal = b.mois_debut ? b.mois_debut + (b.mois_debut.length === 7 ? '-01' : '') : null
  const { rows } = await pool.query(
    `INSERT INTO inscriptions (etudiant_id,filiere_id,classe_id,parcours_id,annee_academique_id,
      niveau_entree_id,niveau_bourse_id,statut,frais_inscription,mensualite,frais_tenue,reduction_type,reduction_valeur,mois_debut,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [b.etudiant_id, b.filiere_id || null, b.classe_id || null, b.parcours_id || null, b.annee_academique_id,
     b.niveau_entree_id || null, b.niveau_bourse_id || null, b.statut || 'pre_inscrit',
     fraisInscription, mensualite, fraisTenue,
     b.reduction_type || null, b.reduction_valeur || null, moisDebutVal, u(c).id]
  )
  // Générer les échéances immédiatement dès l'inscription (await = fiable, pas de fire-and-forget)
  try {
    await genererEcheances(rows[0].id, b.mois_debut || undefined)
  } catch (e) {
    console.error('Erreur genererEcheances inscription', rows[0].id, e)
  }

  // Créer automatiquement le compte étudiant si l'étudiant a un email
  try {
    const { rows: etud } = await pool.query('SELECT nom,prenom,email FROM etudiants WHERE id=$1', [b.etudiant_id])
    if (etud[0]?.email) {
      const { rows: existing } = await pool.query('SELECT id FROM users WHERE email=$1', [etud[0].email])
      if (!existing.length) {
        const hashed = await bcrypt.hash('@2026', 10)
        await pool.query(
          'INSERT INTO users (nom,prenom,email,password,role,statut,premier_connexion,cgu_acceptees,created_by) VALUES ($1,$2,$3,$4,$5,$6,true,false,$7)',
          [etud[0].nom, etud[0].prenom, etud[0].email, hashed, 'etudiant', 'actif', u(c).id]
        )
      }
    }
  } catch { /* silencieux — ne bloque pas l'inscription */ }
  return c.json(rows[0], 201)
})

app.put('/inscriptions/:id', requireAuth, role('secretariat', 'dg'), async (c) => {
  const b = await c.req.json()
  // Si la filière a changé, on vide automatiquement la classe (l'étudiant retourne dans le pool de la nouvelle filière)
  const { rows: cur } = await pool.query('SELECT filiere_id FROM inscriptions WHERE id=$1', [c.req.param('id')])
  const filiereChanged = cur[0] && String(cur[0].filiere_id) !== String(b.filiere_id || '')
  const classeId = filiereChanged ? null : (b.classe_id || null)
  // Auto-populate tariffs from filière when filière changes and tariffs not explicitly provided
  let fraisInscription = b.frais_inscription || 0
  let mensualite = b.mensualite || 0
  if (b.filiere_id && filiereChanged && (!fraisInscription && !mensualite)) {
    const { rows: fil } = await pool.query('SELECT frais_inscription,mensualite FROM filieres WHERE id=$1', [b.filiere_id])
    if (fil[0]) {
      fraisInscription = parseFloat(fil[0].frais_inscription) || 0
      mensualite = parseFloat(fil[0].mensualite) || 0
    }
  }
  const moisDebutVal = b.mois_debut ? b.mois_debut + (b.mois_debut.length === 7 ? '-01' : '') : undefined
  const moisDebutClause = moisDebutVal ? ',mois_debut=$14' : ''
  const params: any[] = [b.filiere_id || null, classeId, b.parcours_id || null, b.annee_academique_id,
     b.niveau_entree_id || null, b.niveau_bourse_id || null, b.statut || 'pre_inscrit',
     fraisInscription, mensualite, b.frais_tenue || 0,
     b.reduction_type || null, b.reduction_valeur || null, c.req.param('id')]
  if (moisDebutVal) params.push(moisDebutVal)
  const { rows } = await pool.query(
    `UPDATE inscriptions SET filiere_id=$1,classe_id=$2,parcours_id=$3,annee_academique_id=$4,
      niveau_entree_id=$5,niveau_bourse_id=$6,statut=$7,frais_inscription=$8,mensualite=$9,
      frais_tenue=$10,reduction_type=$11,reduction_valeur=$12${moisDebutClause}
     WHERE id=$13 RETURNING *`,
    params
  )
  // Recalculer les échéances après modification (bourse, tarifs, filière, etc.)
  try {
    await genererEcheances(rows[0].id)
  } catch (e) {
    console.error('Erreur genererEcheances PUT inscription', rows[0].id, e)
  }
  return c.json(rows[0])
})

app.post('/inscriptions/:id/valider', requireAuth, role('secretariat', 'dg'), async (c) => {
  const inscId = parseInt(c.req.param('id'))
  const { rows } = await pool.query(
    "UPDATE inscriptions SET statut='inscrit_actif',date_validation=NOW(),validated_by=$1 WHERE id=$2 RETURNING *",
    [u(c).id, inscId]
  )
  // Supprimer les échéances à 0 FCFA (générées prématurément sans tarifs) puis recréer correctement
  await pool.query(
    `DELETE FROM echeances WHERE inscription_id = $1 AND montant = 0`,
    [inscId]
  ).catch(() => {})
  try { await genererEcheances(inscId) } catch (e) { console.error('Erreur genererEcheances update', inscId, e) }
  return c.json(rows[0])
})

app.put('/inscriptions/:id/statut', requireAuth, role('secretariat', 'dg'), async (c) => {
  const body = await c.req.json()
  const statut = body.statut
  if (statut === 'abandonne') {
    const dateAbandon = body.date_abandon || new Date().toISOString().substring(0, 10)
    const motif = body.motif_abandon || null
    const { rows } = await pool.query(
      'UPDATE inscriptions SET statut=$1, date_abandon=$2, motif_abandon=$3 WHERE id=$4 RETURNING *',
      [statut, dateAbandon, motif, c.req.param('id')]
    )
    return c.json(rows[0])
  } else {
    // Si on réactive, on efface la date/motif d'abandon
    const { rows } = await pool.query(
      'UPDATE inscriptions SET statut=$1, date_abandon=NULL, motif_abandon=NULL WHERE id=$2 RETURNING *',
      [statut, c.req.param('id')]
    )
    return c.json(rows[0])
  }
})

app.post('/inscriptions/:id/contrat', requireAuth, role('secretariat', 'dg'), async (c) => {
  return c.json({ message: 'Upload contrat: utilisez un service de stockage externe.' })
})

app.put('/inscriptions/:id/affecter-classe', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { classe_id } = await c.req.json()
  // When assigning: also fill filiere_id from the class (in case inscription.filiere_id is null)
  // When removing (classe_id=null): keep filiere_id intact so student reappears in pool
  // COALESCE(filiere_id, subquery) : si $1 est null, la sous-requête retourne null → filiere_id inchangé
  // Si $1 est un id valide, on remplit filiere_id depuis la classe au cas où il serait null
  const { rows } = await pool.query(
    `UPDATE inscriptions SET classe_id=$1::int,
      filiere_id=COALESCE(filiere_id,(SELECT filiere_id FROM classes WHERE id=$1::int))
     WHERE id=$2 RETURNING *`,
    [classe_id ?? null, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.get('/inscriptions/:id/contrat-pdf', requireAuth, async (c) => {
  return c.json({ message: 'PDF non supporté en serverless.' }, 501)
})

// ─── TYPES DE DOCUMENTS ───────────────────────────────────────────────────────
app.get('/types-documents', requireAuth, async (c) => {
  const { rows } = await pool.query(
    `SELECT td.*, tf.nom AS type_formation_nom FROM types_documents td
     LEFT JOIN types_formation tf ON tf.id = td.type_formation_id
     ORDER BY td.ordre, td.label`
  )
  return c.json(rows)
})

app.post('/types-documents', requireAuth, role('dg'), async (c) => {
  const { code, label, actif = true, ordre = 0, type_formation_id = null } = await c.req.json()
  if (!code?.trim() || !label?.trim()) return c.json({ message: 'Code et libellé requis.' }, 400)
  const { rows } = await pool.query(
    `INSERT INTO types_documents (code, label, actif, ordre, type_formation_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [code.trim().toLowerCase().replace(/\s+/g, '_'), label.trim(), actif, ordre, type_formation_id || null]
  )
  return c.json(rows[0], 201)
})

app.put('/types-documents/:id', requireAuth, role('dg'), async (c) => {
  const { label, actif, ordre, type_formation_id = null } = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE types_documents SET label=$1, actif=$2, ordre=$3, type_formation_id=$4 WHERE id=$5 RETURNING *`,
    [label, actif, ordre, type_formation_id || null, c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Type introuvable.' }, 404)
  return c.json(rows[0])
})

app.delete('/types-documents/:id', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  // Vérifier si des documents utilisent ce type
  const { rows: usages } = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM documents_etudiant de
     JOIN types_documents td ON de.type_document = td.code
     WHERE td.id = $1`, [id]
  )
  if (usages[0].cnt > 0)
    return c.json({ message: `Impossible : ${usages[0].cnt} document(s) utilisent ce type.` }, 409)
  await pool.query('DELETE FROM types_documents WHERE id=$1', [id])
  return c.body(null, 204)
})

// ─── DOSSIERS ÉTUDIANTS (vue matricielle) ─────────────────────────────────────
app.get('/dossiers-etudiants', requireAuth, async (c) => {
  // Types avec leur type_formation_id (null = applicable à tous les types de formation)
  const { rows: types } = await pool.query(
    `SELECT td.code, td.label, td.ordre, td.type_formation_id, tf.nom AS type_formation_nom
     FROM types_documents td
     LEFT JOIN types_formation tf ON tf.id = td.type_formation_id
     WHERE td.actif = TRUE ORDER BY td.ordre, td.label`
  )
  // Étudiants avec leur type de formation via : inscription → filière → type_formation
  const { rows: etudiants } = await pool.query(`
    SELECT e.id, e.nom, e.prenom, e.numero_etudiant,
           f.id AS filiere_id, f.nom AS filiere_nom, f.code AS filiere_code,
           f.type_formation_id,
           tf.nom AS type_formation_nom,
           i.statut AS inscription_statut
    FROM etudiants e
    LEFT JOIN inscriptions i ON i.id = (
      SELECT id FROM inscriptions WHERE etudiant_id = e.id ORDER BY created_at DESC LIMIT 1
    )
    LEFT JOIN filieres f ON f.id = i.filiere_id
    LEFT JOIN types_formation tf ON tf.id = f.type_formation_id
    ORDER BY e.nom, e.prenom
  `)
  const { rows: checks } = await pool.query(
    `SELECT etudiant_id, code, recu FROM checklist_documents WHERE recu = TRUE`
  )
  const checkMap: Record<number, Record<string, boolean>> = {}
  for (const row of checks) {
    if (!checkMap[row.etudiant_id]) checkMap[row.etudiant_id] = {}
    checkMap[row.etudiant_id][row.code] = true
  }
  const result = etudiants.map((e: any) => {
    const docs = checkMap[e.id] ?? {}
    // Un type est applicable si type_formation_id IS NULL (commun) OU correspond au type de formation de l'étudiant
    const applicables = types.filter((t: any) => t.type_formation_id === null || t.type_formation_id === e.type_formation_id)
    const recu_count = applicables.filter((t: any) => docs[t.code] === true).length
    return { id: e.id, nom: e.nom, prenom: e.prenom, numero_etudiant: e.numero_etudiant,
             filiere_id: e.filiere_id, filiere_nom: e.filiere_nom, filiere_code: e.filiere_code,
             type_formation_id: e.type_formation_id, type_formation_nom: e.type_formation_nom,
             inscription_statut: e.inscription_statut, checklist: docs,
             recu_count, total: applicables.length }
  })
  return c.json({ types, etudiants: result })
})

// ─── CHECKLIST DOCUMENTS ──────────────────────────────────────────────────────
// Retourne la liste de tous les types actifs + statut reçu pour cet étudiant
app.get('/etudiants/:id/checklist-documents', requireAuth, async (c) => {
  const etudiantId = c.req.param('id')
  const { rows: types } = await pool.query(
    `SELECT code, label, ordre FROM types_documents WHERE actif = TRUE ORDER BY ordre, label`
  )
  const { rows: checks } = await pool.query(
    `SELECT code, recu, date_reception, recu_par FROM checklist_documents WHERE etudiant_id = $1`,
    [etudiantId]
  )
  const checkMap: Record<string, any> = {}
  for (const c of checks) checkMap[c.code] = c

  return c.json(types.map((t: any) => ({
    code: t.code,
    label: t.label,
    recu: checkMap[t.code]?.recu ?? false,
    date_reception: checkMap[t.code]?.date_reception ?? null,
  })))
})

// Bascule le statut reçu d'un document
app.patch('/etudiants/:id/checklist-documents/:code', requireAuth, role('secretariat', 'dg'), async (c) => {
  const etudiantId = c.req.param('id')
  const code = c.req.param('code')
  const { recu } = await c.req.json()
  const user = c.get('user') as any
  const dateReception = recu ? new Date().toISOString() : null

  const { rows } = await pool.query(
    `INSERT INTO checklist_documents (etudiant_id, code, recu, date_reception, recu_par)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (etudiant_id, code)
     DO UPDATE SET recu=$3, date_reception=$4, recu_par=$5
     RETURNING *`,
    [etudiantId, code, recu, dateReception, user.userId ?? null]
  )
  return c.json(rows[0])
})

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────
app.post('/documents', requireAuth, role('secretariat', 'dg'), async (c) => {
  return c.json({ message: 'Upload: utilisez un service de stockage externe.' }, 501)
})

app.delete('/documents/:id', requireAuth, role('secretariat', 'dg'), async (c) => {
  await pool.query('DELETE FROM documents_etudiant WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// Migration: rename intervenant tables/columns to enseignant
app.post('/migrate-enseignant', requireAuth, role('dg'), async (c) => {
  try {
    await pool.query(`
      DO $$
      BEGIN
        -- Rename enseignants table
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename='intervenants') AND
           NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='enseignants') THEN
          ALTER TABLE intervenants RENAME TO enseignants;
        END IF;
        -- Rename enseignant_filieres table
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename='intervenant_filieres') AND
           NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='enseignant_filieres') THEN
          ALTER TABLE intervenant_filieres RENAME TO enseignant_filieres;
        END IF;
        -- Rename tarifs_enseignants table
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename='tarifs_intervenants') AND
           NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename='tarifs_enseignants') THEN
          ALTER TABLE tarifs_intervenants RENAME TO tarifs_enseignants;
        END IF;
        -- Rename enseignant_id column in enseignant_filieres
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='enseignant_filieres' AND column_name='intervenant_id') THEN
          ALTER TABLE enseignant_filieres RENAME COLUMN intervenant_id TO enseignant_id;
        END IF;
        -- Rename enseignant_id column in seances
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='seances' AND column_name='intervenant_id') THEN
          ALTER TABLE seances RENAME COLUMN intervenant_id TO enseignant_id;
        END IF;
        -- Rename enseignant_id column in unites_enseignement
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='unites_enseignement' AND column_name='intervenant_id') THEN
          ALTER TABLE unites_enseignement RENAME COLUMN intervenant_id TO enseignant_id;
        END IF;
        -- Update check constraint to allow 'enseignant' role
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('dg','dir_peda','resp_fin','coordinateur','secretariat','enseignant','etudiant','intervenant'));
        -- Update user roles
        UPDATE users SET role = 'enseignant' WHERE role = 'intervenant';
        -- Remove old 'intervenant' value from constraint
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('dg','dir_peda','resp_fin','coordinateur','secretariat','enseignant','etudiant'));
      END $$;
    `)
    return c.json({ success: true, message: 'Migration enseignant effectuée' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── ENSEIGNANTS ─────────────────────────────────────────────────────────────
app.get('/enseignants', requireAuth, async (c) => {
  const search = c.req.query('search') || ''
  const statut = c.req.query('statut') || ''
  const page = Math.max(1, parseInt(c.req.query('page') || '1'))
  const perPage = 20
  const offset = (page - 1) * perPage
  const conditions: string[] = []
  const params: any[] = []
  if (search) { params.push(`%${search}%`); conditions.push(`(i.nom ILIKE $${params.length} OR i.prenom ILIKE $${params.length} OR i.email ILIKE $${params.length} OR i.numero_contrat ILIKE $${params.length})`) }
  if (statut) { params.push(statut); conditions.push(`i.statut = $${params.length}`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int as total FROM enseignants i ${where}`, params)
  const total = countRows[0].total
  params.push(perPage); const p1 = params.length
  params.push(offset); const p2 = params.length
  const { rows } = await pool.query(`
    SELECT i.*,
      jsonb_build_object('id',aa.id,'libelle',aa.libelle,'actif',aa.actif) as annee_academique,
      COALESCE((
        SELECT json_agg(jsonb_build_object(
          'code', ue.code,
          'intitule', ue.intitule,
          'classe', jsonb_build_object('id', cl.id, 'nom', cl.nom)
        ))
        FROM unites_enseignement ue
        LEFT JOIN classes cl ON cl.id = ue.classe_id
        WHERE ue.enseignant_id = i.id
      ), '[]'::json) as mes_ues
    FROM enseignants i
    LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
    ${where} ORDER BY i.nom,i.prenom LIMIT $${p1} OFFSET $${p2}
  `, params)
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  return c.json({ data: rows, current_page: page, last_page: lastPage, per_page: perPage, total })
})

// Profil enseignant du user connecté + ses classes (DOIT être avant /:id)
app.get('/enseignants/me', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT e.*,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', ue.id, 'classe_id', ue.classe_id, 'code', ue.code, 'intitule', ue.intitule))
        FILTER (WHERE ue.id IS NOT NULL), '[]'
      ) as mes_ues,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', cl.id, 'nom', cl.nom))
        FILTER (WHERE cl.id IS NOT NULL), '[]'
      ) as mes_classes
    FROM enseignants e
    LEFT JOIN unites_enseignement ue ON ue.enseignant_id = e.id
    LEFT JOIN classes cl ON cl.id = ue.classe_id
    WHERE e.user_id=$1
    GROUP BY e.id
  `, [u(c).id])
  if (!rows.length) return c.json({ message: 'Profil enseignant introuvable.' }, 404)
  return c.json(rows[0])
})

app.get('/enseignants/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const { rows } = await pool.query(`
    SELECT e.*,
      jsonb_build_object('id',aa.id,'libelle',aa.libelle) as annee_academique,
      COALESCE((
        SELECT json_agg(jsonb_build_object('filiere_id',ef.filiere_id,'matiere',ef.matiere,
          'filiere', jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code)))
        FROM enseignant_filieres ef LEFT JOIN filieres f ON ef.filiere_id = f.id
        WHERE ef.enseignant_id = e.id
      ), '[]'::json) as filieres,
      COALESCE((
        SELECT json_agg(DISTINCT jsonb_build_object('id',ue.id,'code',ue.code,'intitule',ue.intitule,
          'coefficient',ue.coefficient,'credits_ects',ue.credits_ects,
          'classe', jsonb_build_object('id',cl.id,'nom',cl.nom,'est_tronc_commun',cl.est_tronc_commun)))
        FROM unites_enseignement ue
        JOIN classes cl ON ue.classe_id = cl.id
        WHERE ue.enseignant_id = e.id
      ), '[]'::json) as ues
    FROM enseignants e
    LEFT JOIN annees_academiques aa ON e.annee_academique_id = aa.id
    WHERE e.id = $1
  `, [id])
  if (!rows[0]) return c.json({ message: 'Enseignant introuvable.' }, 404)
  return c.json(rows[0])
})

app.get('/enseignants/:id/stats', requireAuth, async (c) => {
  const id = c.req.param('id')
  const now = new Date()
  const moisCourant = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`

  // Séances ce mois — utilise range timestamps explicites
  const debutMois = `${moisCourant}-01T00:00:00`
  const finMois = now.getMonth() === 11
    ? `${now.getFullYear() + 1}-01-01T00:00:00`
    : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01T00:00:00`

  const { rows: seancesMois } = await pool.query(`
    SELECT COUNT(*)::int as total,
      COALESCE(SUM(EXTRACT(EPOCH FROM (date_fin - date_debut))/3600), 0)::numeric(10,2) as heures
    FROM seances
    WHERE enseignant_id=$1
      AND statut IN ('planifie','confirme','effectue')
      AND date_debut >= $2::timestamp AND date_debut < $3::timestamp
  `, [id, debutMois, finMois])

  // Séances émargées (effectuées) avec calcul du tarif par séance selon le type de formation
  // - Classe normale  → tarif via filière.type_formation_id → tarifs_enseignants
  // - Tronc commun   → MAX tarif parmi les classes liées (tronc_commun_id) → tarif le plus élevé
  const { rows: seancesDetail } = await pool.query(`
    SELECT
      s.id,
      EXTRACT(EPOCH FROM (s.date_fin - s.date_debut))/3600 AS heures,
      c.est_tronc_commun,
      s.annee_academique_id,
      -- Tarif applicable : MAX parmi les types de formation concernés
      CASE
        WHEN COALESCE(c.est_tronc_commun, false) = false THEN
          -- Classe normale : tarif du type de formation de sa filière
          (SELECT te.montant_horaire FROM tarifs_enseignants te
           JOIN filieres f ON f.type_formation_id = te.type_formation_id
           WHERE f.id = c.filiere_id
           ORDER BY te.montant_horaire DESC LIMIT 1)
        ELSE
          -- Tronc commun : MAX tarif parmi les classes liées à ce tronc
          (SELECT MAX(te.montant_horaire) FROM tarifs_enseignants te
           JOIN filieres f ON f.type_formation_id = te.type_formation_id
           JOIN classes cl ON cl.filiere_id = f.id
           WHERE cl.id IN (SELECT ctc.classe_id FROM classe_tronc_commun ctc WHERE ctc.tronc_commun_id = c.id))
      END AS tarif_horaire
    FROM seances s
    JOIN classes c ON s.classe_id = c.id
    WHERE s.enseignant_id = $1 AND s.statut = 'effectue'
  `, [id])

  // Totaux classiques
  const heuresClassique = seancesDetail.reduce((sum: number, r: any) => sum + parseFloat(r.heures || 0), 0)
  const montantDu = Math.round(seancesDetail.reduce((sum: number, r: any) =>
    sum + parseFloat(r.heures || 0) * parseFloat(r.tarif_horaire || 0), 0))

  // Heures FI effectuées (séances sans classe_id, avec fi_module_id)
  const { rows: fSeances } = await pool.query(`
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (date_fin - date_debut))/3600),0)::numeric(10,2) as heures,
           COUNT(*)::int as total
    FROM seances WHERE enseignant_id=$1 AND statut='effectue' AND fi_module_id IS NOT NULL
  `, [id])
  const heuresFiEff = parseFloat(fSeances[0]?.heures) || 0

  // Total toutes séances
  const heuresTot = heuresClassique + heuresFiEff
  const seancesTot = [{ total: seancesDetail.length + (parseInt(fSeances[0]?.total) || 0), heures: heuresTot.toFixed(2) }]

  // Tarif moyen effectif pour affichage (montant_du / heures ou 0)
  const tarif = heuresClassique > 0 ? Math.round(montantDu / heuresClassique) : 0

  const heuresMois = parseFloat(seancesMois[0]?.heures) || 0

  // ── Formations individuelles : part formateur ──────────────────────
  // Pour chaque module FI assigné à ce prof, sa part = (cout_total × pct_formateur / 100) × (volume_module / total_volumes)
  const { rows: fiRows } = await pool.query(`
    SELECT fi.cout_total, fi.pct_formateur, fi.statut as fi_statut,
           fm.volume_horaire, fm.heures_effectuees,
           (SELECT COALESCE(SUM(fm2.volume_horaire),1) FROM fi_modules fm2
            WHERE fm2.formation_individuelle_id = fi.id) as total_volumes
    FROM fi_modules fm
    JOIN formations_individuelles fi ON fm.formation_individuelle_id = fi.id
    WHERE fm.enseignant_id = $1
  `, [id])

  let fiMontantDu = 0
  let fiHeuresTotal = 0
  let fiHeuresEffectuees = 0
  let fiTarifHoraire = 0
  for (const fi of fiRows) {
    const partFormateur = parseFloat(fi.cout_total) * parseFloat(fi.pct_formateur) / 100
    const totalVol = parseFloat(fi.total_volumes) || 1
    const tarifH = partFormateur / totalVol
    const heuresEff = parseFloat(fi.heures_effectuees) || 0
    fiMontantDu += Math.round(tarifH * heuresEff)
    fiHeuresTotal += parseFloat(fi.volume_horaire) || 0
    fiHeuresEffectuees += heuresEff
    if (!fiTarifHoraire && tarifH > 0) fiTarifHoraire = Math.round(tarifH)
  }

  // Vacations payées (dépenses liées à cet enseignant)
  const ensNom = (await pool.query('SELECT nom FROM enseignants WHERE id=$1',[id])).rows[0]?.nom ?? ''
  const { rows: vacRows } = await pool.query(`
    SELECT COALESCE(SUM(montant),0)::numeric(10,2) as paye
    FROM depenses WHERE categorie='vacations'
      AND (notes ILIKE $1 OR libelle ILIKE $1)
  `, [`%${ensNom}%`])
  const vacPaye = parseFloat(vacRows[0]?.paye) || 0

  // Classes assignées via UEs
  const { rows: classes } = await pool.query(`
    SELECT DISTINCT cl.id, cl.nom, cl.est_tronc_commun,
      COUNT(ue.id)::int as nb_ues
    FROM unites_enseignement ue
    JOIN classes cl ON ue.classe_id = cl.id
    WHERE ue.enseignant_id = $1
    GROUP BY cl.id, cl.nom, cl.est_tronc_commun
    ORDER BY cl.nom
  `, [id])

  const totalMontantDu = montantDu + fiMontantDu

  return c.json({
    seances_ce_mois: seancesMois[0]?.total || 0,
    heures_ce_mois: heuresMois,
    seances_total: seancesTot[0]?.total || 0,
    heures_total: Math.round(heuresTot * 100) / 100,
    tarif_horaire: tarif,           // tarif moyen pondéré pour affichage
    montant_du: totalMontantDu,     // classique + FI
    montant_du_classique: montantDu,
    montant_du_fi: fiMontantDu,
    montant_paye: vacPaye,
    montant_restant: Math.max(0, totalMontantDu - vacPaye),
    fi_heures_total: Math.round(fiHeuresTotal * 100) / 100,
    fi_heures_effectuees: Math.round(fiHeuresEffectuees * 100) / 100,
    fi_nb_modules: fiRows.length,
    fi_tarif_horaire: fiTarifHoraire,
    classes,
  })
})

app.get('/enseignants/:id/seances', requireAuth, async (c) => {
  const id = c.req.param('id')
  const { rows } = await pool.query(`
    SELECT s.*,
      jsonb_build_object('id',cl.id,'nom',cl.nom) as classe,
      EXTRACT(EPOCH FROM (s.date_fin - s.date_debut))/3600 as duree_heures,
      (SELECT COUNT(*)::int FROM presences pr WHERE pr.seance_id = s.id AND pr.statut='present') as nb_presents,
      (SELECT COUNT(*)::int FROM presences pr WHERE pr.seance_id = s.id) as nb_inscrits
    FROM seances s
    LEFT JOIN classes cl ON s.classe_id = cl.id
    WHERE s.enseignant_id = $1
    ORDER BY s.date_debut DESC
    LIMIT 50
  `, [id])
  return c.json(rows)
})

// Formations individuelles assignées à un enseignant
app.get('/enseignants/:id/formations-individuelles', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT fm.id, fm.volume_horaire, fm.heures_effectuees,
      m.nom as matiere_nom,
      e.nom as etudiant_nom, e.prenom as etudiant_prenom,
      fi.cout_total, fi.statut as fi_statut, fi.date_debut, fi.date_fin
    FROM fi_modules fm
    JOIN formations_individuelles fi ON fm.formation_individuelle_id = fi.id
    JOIN etudiants e ON fi.etudiant_id = e.id
    JOIN matieres m ON fm.matiere_id = m.id
    WHERE fm.enseignant_id = $1
    ORDER BY fi.created_at DESC
  `, [c.req.param('id')])
  return c.json(rows)
})

app.post('/enseignants', requireAuth, role('dg', 'secretariat'), async (c) => {
  const b = await c.req.json()
  if (!b.annee_academique_id) return c.json({ message: 'annee_academique_id requis.' }, 422)
  // Auto-create user account if user_id not provided
  let userId = b.user_id
  if (!userId && b.email) {
    const hash = await bcrypt.hash('Uptech@2026', 10)
    const existingUser = await pool.query('SELECT id FROM users WHERE email=$1', [b.email])
    if (existingUser.rows[0]) {
      userId = existingUser.rows[0].id
    } else {
      const newUser = await pool.query(
        `INSERT INTO users (nom,prenom,email,telephone,role,statut,password) VALUES ($1,$2,$3,$4,'enseignant','actif',$5) RETURNING id`,
        [b.nom, b.prenom, b.email, b.telephone || null, hash]
      )
      userId = newUser.rows[0].id
    }
  }
  const seq = await nextSeq('enseignants')
  const numero = `CONT-${year()}-${pad(seq)}`
  const { rows } = await pool.query(
    `INSERT INTO enseignants (user_id,numero_contrat,nom,prenom,email,telephone,statut,annee_academique_id,specialite,grade,type_contrat,tarif_horaire,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [userId || null, numero, b.nom, b.prenom, b.email || null, b.telephone || null,
     b.statut || 'en_attente', b.annee_academique_id,
     b.specialite || null, b.grade || null, b.type_contrat || 'vacataire', b.tarif_horaire || 0,
     u(c).id]
  )
  const enseignant = rows[0]
  // Save filières
  if (b.filieres?.length) {
    await pool.query('DELETE FROM enseignant_filieres WHERE enseignant_id=$1', [enseignant.id])
    for (const f of b.filieres) {
      if (f.filiere_id && f.matiere) {
        await pool.query(
          'INSERT INTO enseignant_filieres (enseignant_id,filiere_id,matiere) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [enseignant.id, f.filiere_id, f.matiere]
        )
      }
    }
  }
  return c.json(enseignant, 201)
})

app.put('/enseignants/:id', requireAuth, role('dg', 'secretariat'), async (c) => {
  const b = await c.req.json()
  const id = c.req.param('id')
  const { rows } = await pool.query(
    `UPDATE enseignants SET nom=$1,prenom=$2,email=$3,telephone=$4,statut=$5,
     specialite=$6,grade=$7,type_contrat=$8,tarif_horaire=$9 WHERE id=$10 RETURNING *`,
    [b.nom, b.prenom, b.email || null, b.telephone || null, b.statut || 'actif',
     b.specialite || null, b.grade || null, b.type_contrat || 'vacataire', b.tarif_horaire || 0, id]
  )
  if (b.filieres !== undefined) {
    await pool.query('DELETE FROM enseignant_filieres WHERE enseignant_id=$1', [id])
    for (const f of (b.filieres || [])) {
      if (f.filiere_id && f.matiere) {
        await pool.query(
          'INSERT INTO enseignant_filieres (enseignant_id,filiere_id,matiere) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [id, f.filiere_id, f.matiere]
        )
      }
    }
  }
  return c.json(rows[0])
})

app.post('/enseignants/:id/cv', requireAuth, role('dg', 'secretariat'), async (c) => {
  return c.json({ message: 'Upload CV: utilisez un service de stockage externe.' })
})

app.get('/enseignants/:id/contrat-pdf', requireAuth, async (c) => {
  const id = c.req.param('id')

  // 1. Données enseignant
  const { rows } = await pool.query(`
    SELECT e.nom, e.prenom, e.email, e.telephone, e.specialite, e.grade,
           e.type_contrat, e.tarif_horaire, e.numero_contrat,
           aa.libelle AS annee_academique
    FROM enseignants e
    LEFT JOIN annees_academiques aa ON e.annee_academique_id = aa.id
    WHERE e.id = $1
  `, [id])
  if (!rows[0]) return c.json({ error: 'Enseignant non trouvé' }, 404)
  const ens = rows[0]

  // 2. UEs affectées
  const { rows: ues } = await pool.query(`
    SELECT ue.intitule, ue.volume_horaire,
           COALESCE(cl.nom, '') AS classe
    FROM unites_enseignement ue
    LEFT JOIN classes cl ON ue.classe_id = cl.id
    WHERE ue.enseignant_id = $1
    ORDER BY cl.nom, ue.intitule
  `, [id])

  // 3. Calculs financiers
  const tarif = parseFloat(ens.tarif_horaire) || 0
  const totalHeures = ues.reduce((s: number, u: any) => s + (parseInt(u.volume_horaire) || 0), 0)
  const montantNet = totalHeures * tarif
  const retenue = Math.round(montantNet * 5 / 95) // retenue = 5% du brut, donc brut = net / 0.95
  const montantBrut = montantNet + retenue

  // 4. Formater la date
  const now = new Date()
  const moisFr = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre']
  const dateContrat = `${now.getDate()} ${moisFr[now.getMonth()]} ${now.getFullYear()}`

  // 5. Formatter les nombres
  const fmt = (n: number) => n.toLocaleString('fr-FR')

  // 6. Charger le template — compatible ESM serverless Vercel
  const __filename2 = fileURLToPath(import.meta.url)
  const __dirname2 = dirname(__filename2)
  let templatePath = join(__dirname2, 'templates', 'contrat-vacation.docx')
  try { readFileSync(templatePath) } catch { templatePath = join(process.cwd(), 'api', 'templates', 'contrat-vacation.docx') }

  const template = readFileSync(templatePath)

  const buffer = await createReport({
    template,
    data: {
      numero_contrat: ens.numero_contrat || `CONT-${now.getFullYear()}-${String(id).padStart(5, '0')}`,
      annee_academique: ens.annee_academique || `${now.getFullYear()}-${now.getFullYear() + 1}`,
      prenom: ens.prenom || '',
      nom: ens.nom || '',
      specialite: ens.specialite || '—',
      grade: ens.grade || '—',
      telephone: ens.telephone || '—',
      email: ens.email || '—',
      // Table matières — chaque ligne dupliquée par docx-templates
      intitule: ues.map((u: any) => u.intitule).join('\n') || '—',
      classe: ues.map((u: any) => u.classe).join('\n') || '—',
      volume_horaire: ues.map((u: any) => u.volume_horaire || 0).join('\n') || '0',
      total_heures: fmt(totalHeures),
      tarif_horaire: fmt(tarif),
      retenue: fmt(retenue),
      montant_total_brut: fmt(montantBrut),
      date_contrat: dateContrat,
    },
    cmdDelimiter: ['{', '}'],
  })

  const filename = `Contrat_${ens.prenom}_${ens.nom}_${ens.numero_contrat || id}.docx`

  return new Response(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
})

// ─── FINANCE OVERVIEW ────────────────────────────────────────────────────────
app.get('/finance/overview', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const mode   = c.req.query('mode')   ?? 'tout'           // mois | annee | tout
  const valeur = c.req.query('valeur') ?? ''               // YYYY-MM ou YYYY

  // Clauses WHERE période
  const validMois   = /^\d{4}-\d{2}$/.test(valeur)
  const validAnnee  = /^\d{4}$/.test(valeur)

  let payWhere = "p.statut='confirme'"
  let depWhere = "d.statut='validee'"
  let payWhereSimple = "statut='confirme'"
  let depWhereSimple = "statut='validee'"

  if (mode === 'mois' && validMois) {
    const clause = `date_trunc('month', %COL%::timestamptz) = '${valeur}-01'::date`
    payWhere      += ` AND ${clause.replace('%COL%', "COALESCE(p.confirmed_at, p.created_at)")}`
    depWhere      += ` AND ${clause.replace('%COL%', "d.date_depense")}`
    payWhereSimple += ` AND ${clause.replace('%COL%', "COALESCE(confirmed_at, created_at)")}`
    depWhereSimple += ` AND ${clause.replace('%COL%', "date_depense")}`
  } else if (mode === 'annee' && validAnnee) {
    const yr = Number(valeur)
    payWhere      += ` AND EXTRACT(YEAR FROM COALESCE(p.confirmed_at, p.created_at)::timestamptz) = ${yr}`
    depWhere      += ` AND EXTRACT(YEAR FROM d.date_depense::timestamptz) = ${yr}`
    payWhereSimple += ` AND EXTRACT(YEAR FROM COALESCE(confirmed_at, created_at)::timestamptz) = ${yr}`
    depWhereSimple += ` AND EXTRACT(YEAR FROM date_depense::timestamptz) = ${yr}`
  }

  // Série de mois pour le graphique bar
  let monthsSql: string
  if (mode === 'mois' && validMois) {
    monthsSql = `SELECT '${valeur}-01'::date AS m`
  } else if (mode === 'annee' && validAnnee) {
    monthsSql = `SELECT generate_series('${valeur}-01-01'::date, '${valeur}-12-01'::date, '1 month'::interval) AS m`
  } else {
    monthsSql = `SELECT generate_series(date_trunc('month', NOW() - interval '11 months'), date_trunc('month', NOW()), '1 month'::interval) AS m`
  }

  // Clauses FI paiements (fi_paiements : montant_paye > 0 = payé)
  let fiPayWhere = "fp.montant_paye > 0"
  if (mode === 'mois' && validMois) {
    fiPayWhere += ` AND date_trunc('month', fp.date_paiement::timestamptz) = '${valeur}-01'::date`
  } else if (mode === 'annee' && validAnnee) {
    fiPayWhere += ` AND EXTRACT(YEAR FROM fp.date_paiement::timestamptz) = ${Number(valeur)}`
  }

  const [kpis, monthly, cats, parFiliere, recentPay, recentDep, creances, recentFiPay, fiCreances] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COALESCE(SUM(montant),0)::float FROM paiements WHERE ${payWhereSimple})
        + (SELECT COALESCE(SUM(fp.montant_paye),0)::float FROM fi_paiements fp WHERE ${fiPayWhere})
        AS recettes_total,
        (SELECT COALESCE(SUM(montant),0)::float FROM depenses   WHERE ${depWhereSimple}) AS depenses_total
    `),
    pool.query(`
      WITH months AS (${monthsSql})
      SELECT
        to_char(m.m, 'YYYY-MM') AS mois,
        to_char(m.m, 'Mon YYYY') AS label,
        (
          COALESCE((SELECT SUM(p.montant) FROM paiements p
            WHERE ${payWhere} AND date_trunc('month', COALESCE(p.confirmed_at, p.created_at)::timestamptz) = m.m
          ), 0)
          + COALESCE((SELECT SUM(fp.montant_paye) FROM fi_paiements fp
            WHERE fp.montant_paye > 0 AND date_trunc('month', fp.date_paiement::timestamptz) = m.m
          ), 0)
        )::float AS recettes,
        COALESCE((SELECT SUM(d.montant) FROM depenses d
          WHERE ${depWhere} AND date_trunc('month', d.date_depense::timestamptz) = m.m
        ), 0)::float AS depenses
      FROM months m ORDER BY m.m
    `),
    pool.query(`
      SELECT d.categorie, COALESCE(SUM(d.montant),0)::float AS total, COUNT(*)::int AS nb
      FROM depenses d WHERE ${depWhere}
      GROUP BY d.categorie ORDER BY total DESC
    `),
    pool.query(`
      SELECT f.nom, COALESCE(SUM(p.montant),0)::float AS recettes
      FROM paiements p
      JOIN inscriptions i ON p.inscription_id = i.id
      JOIN filieres f ON i.filiere_id = f.id
      WHERE ${payWhere}
      GROUP BY f.id, f.nom ORDER BY recettes DESC LIMIT 6
    `),
    pool.query(`
      SELECT p.id, p.montant, p.type_paiement, COALESCE(p.confirmed_at, p.created_at) AS date,
        e.nom || ' ' || e.prenom AS etudiant
      FROM paiements p
      LEFT JOIN inscriptions i ON p.inscription_id = i.id
      LEFT JOIN etudiants e ON i.etudiant_id = e.id
      WHERE ${payWhere} ORDER BY COALESCE(p.confirmed_at, p.created_at) DESC LIMIT 8
    `),
    pool.query(`
      SELECT d.id, d.libelle, d.categorie, d.montant, d.date_depense AS date
      FROM depenses d WHERE ${depWhere}
      ORDER BY d.date_depense DESC LIMIT 8
    `),
    pool.query(`
      SELECT COALESCE(SUM(montant),0)::float AS total FROM echeances
      WHERE statut IN ('non_paye','partiellement_paye')
    `),
    // Paiements FI récents
    pool.query(`
      SELECT fp.id, fp.montant_paye as montant, fp.type as type_paiement, fp.date_paiement as date,
        e.nom || ' ' || e.prenom AS etudiant, 'FI' as source
      FROM fi_paiements fp
      JOIN formations_individuelles fi ON fp.formation_individuelle_id = fi.id
      JOIN etudiants e ON fi.etudiant_id = e.id
      WHERE fp.montant_paye > 0
      ORDER BY fp.date_paiement DESC LIMIT 8
    `),
    // Créances FI (non payées)
    pool.query(`
      SELECT COALESCE(SUM(fp.montant - fp.montant_paye), 0)::float AS total
      FROM fi_paiements fp WHERE fp.statut IN ('non_paye','partiel')
    `),
  ])

  const r = kpis.rows[0]
  const totalCreances = (creances.rows[0]?.total || 0) + (fiCreances.rows[0]?.total || 0)
  // KPIs du mois courant (toujours le mois en cours, indépendant du filtre)
  const moisNow = new Date().toISOString().substring(0, 7)
  const { rows: moisKpi } = await pool.query(`
    SELECT
      COALESCE((SELECT SUM(montant) FROM paiements WHERE statut='confirme'
        AND date_trunc('month', COALESCE(confirmed_at, created_at)::timestamptz) = $1::date), 0)::float
      + COALESCE((SELECT SUM(montant_paye) FROM fi_paiements WHERE montant_paye > 0
        AND date_trunc('month', date_paiement::timestamptz) = $1::date), 0)::float
      AS recettes_mois,
      COALESCE((SELECT SUM(montant) FROM depenses WHERE statut='validee'
        AND date_trunc('month', date_depense::timestamptz) = $1::date), 0)::float
      AS depenses_mois
  `, [`${moisNow}-01`])

  // Détail recettes FI total
  const recFiTotal = recentFiPay.rows.reduce((s: number, r: any) => s + (parseFloat(r.montant) || 0), 0)

  return c.json({
    kpis: {
      recettes_total: r.recettes_total,
      depenses_total: r.depenses_total,
      solde_net: (r.recettes_total as number) - (r.depenses_total as number),
      creances: totalCreances,
      recettes_mois: moisKpi[0]?.recettes_mois || 0,
      depenses_mois: moisKpi[0]?.depenses_mois || 0,
      recettes_fi: recFiTotal,
    },
    monthly: monthly.rows,
    categories: cats.rows,
    par_filiere: parFiliere.rows,
    recent: [
      ...recentPay.rows.map((row: any) => ({ ...row, sens: 'entree', libelle: row.etudiant || row.type_paiement })),
      ...recentFiPay.rows.map((row: any) => ({ ...row, sens: 'entree', libelle: `🎓 ${row.etudiant} (${row.type_paiement})` })),
      ...recentDep.rows.map((row: any) => ({ ...row, sens: 'sortie' })),
    ].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 12),
  })
})

// ─── BUDGET PRÉVISIONNEL ──────────────────────────────────────────────────────

// GET /budgets/suivi?annee=YYYY — budget vs réalisé par catégorie
app.get('/budgets/suivi', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const annee = Number(c.req.query('annee') ?? new Date().getFullYear())
  const { rows } = await pool.query(`
    SELECT
      cd.code                                                          AS categorie_code,
      cd.libelle,
      COALESCE(b.id, NULL)                                            AS budget_id,
      COALESCE(b.montant_prevu, 0)::float                             AS montant_prevu,
      COALESCE((
        SELECT SUM(d.montant) FROM depenses d
        WHERE d.categorie = cd.code
          AND d.statut = 'validee'
          AND EXTRACT(YEAR FROM d.date_depense::date) = $1
      ), 0)::float                                                     AS montant_reel
    FROM categories_depenses cd
    LEFT JOIN budgets b ON b.categorie_code = cd.code AND b.annee = $1
    WHERE cd.actif = true
    ORDER BY cd.ordre, cd.libelle
  `, [annee])
  return c.json(rows.map((r: any) => ({
    ...r,
    restant: Number(r.montant_prevu) - Number(r.montant_reel),
    pct: Number(r.montant_prevu) > 0
      ? (Number(r.montant_reel) / Number(r.montant_prevu)) * 100
      : 0,
  })))
})

// POST /budgets — créer ou mettre à jour un budget par catégorie + année
app.post('/budgets', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const montant = Number(String(b.montant_prevu ?? 0).replace(/[\s\u00a0]/g, '').replace(',', '.'))
  if (isNaN(montant) || montant < 0) return c.json({ message: 'Montant invalide.' }, 422)
  const { rows } = await pool.query(`
    INSERT INTO budgets (categorie_code, montant_prevu, annee)
    VALUES ($1, $2, $3)
    ON CONFLICT (categorie_code, annee) DO UPDATE
      SET montant_prevu = EXCLUDED.montant_prevu, updated_at = NOW()
    RETURNING *
  `, [b.categorie_code, montant, Number(b.annee ?? new Date().getFullYear())])
  return c.json(rows[0])
})

// DELETE /budgets/:id
app.delete('/budgets/:id', requireAuth, role('dg', 'resp_fin'), async (c) => {
  await pool.query('DELETE FROM budgets WHERE id=$1', [c.req.param('id')])
  return c.json({ ok: true })
})

// ─── CRÉANCES & RELANCES ──────────────────────────────────────────────────────
app.get('/creances/etudiants', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const { rows } = await pool.query(`
    SELECT
      e.id AS etudiant_id,
      e.nom || ' ' || e.prenom AS nom_complet,
      e.telephone, e.email,
      f.nom AS filiere,
      COUNT(ech.id)::int AS nb_echeances,
      COALESCE(SUM(ech.montant),0)::float AS montant_du,
      MIN(ech.mois)::text AS plus_ancienne,
      MAX(r.created_at)::text AS derniere_relance
    FROM echeances ech
    JOIN inscriptions i ON i.id = ech.inscription_id
    JOIN etudiants e ON e.id = i.etudiant_id
    LEFT JOIN filieres f ON f.id = i.filiere_id
    LEFT JOIN relances_creances r ON r.etudiant_id = e.id
    WHERE ech.statut IN ('non_paye','partiellement_paye')
    GROUP BY e.id, e.nom, e.prenom, e.telephone, e.email, f.nom
    ORDER BY montant_du DESC
  `)
  return c.json(rows)
})

app.get('/relances', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const { rows } = await pool.query(`
    SELECT r.*, e.nom || ' ' || e.prenom AS nom_complet
    FROM relances_creances r
    LEFT JOIN etudiants e ON e.id = r.etudiant_id
    ORDER BY r.created_at DESC LIMIT 50
  `)
  return c.json(rows)
})

app.post('/relances', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(`
    INSERT INTO relances_creances (etudiant_id, montant_total, nb_echeances, type_contact, message, created_by)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [b.etudiant_id, b.montant_total, b.nb_echeances || 0, b.type_contact || 'manuel', b.message || null, u(c).id])
  return c.json(rows[0], 201)
})

// ─── CLÔTURES MENSUELLES ──────────────────────────────────────────────────────
app.get('/clotures', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const { rows } = await pool.query(`
    SELECT c.*, u.nom || ' ' || u.prenom AS par_user
    FROM clotures_mensuelles c
    LEFT JOIN users u ON u.id = c.cloture_par
    ORDER BY c.periode DESC
  `)
  return c.json(rows)
})

app.post('/clotures', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  if (!/^\d{4}-\d{2}$/.test(b.periode)) return c.json({ message: 'Format période invalide (YYYY-MM).' }, 422)
  const { rows: existing } = await pool.query('SELECT id FROM clotures_mensuelles WHERE periode=$1', [b.periode])
  if (existing.length > 0) return c.json({ message: `La période ${b.periode} est déjà clôturée.` }, 409)
  const { rows } = await pool.query(`
    INSERT INTO clotures_mensuelles (periode, cloture_par, notes)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [b.periode, u(c).id, b.notes || null])
  const { rows: withUser } = await pool.query(`
    SELECT c.*, u.nom || ' ' || u.prenom AS par_user
    FROM clotures_mensuelles c
    LEFT JOIN users u ON u.id = c.cloture_par
    WHERE c.id = $1
  `, [rows[0].id])
  return c.json(withUser[0], 201)
})

app.delete('/clotures/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM clotures_mensuelles WHERE id=$1', [c.req.param('id')])
  return c.json({ ok: true })
})

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/stats', requireAuth, async (c) => {
  const [et, ia, iatt, iv, fi, cl, enc, dep, totR, totD, pa, ab, su] = await Promise.all([
    pool.query('SELECT COUNT(*)::int FROM etudiants'),
    pool.query("SELECT COUNT(*)::int FROM inscriptions WHERE statut='inscrit_actif'"),
    pool.query("SELECT COUNT(*)::int FROM inscriptions WHERE statut IN ('pre_inscrit','en_examen')"),
    pool.query("SELECT COUNT(*)::int FROM enseignants WHERE statut='actif'"),
    pool.query("SELECT COUNT(*)::int FROM filieres WHERE actif=true"),
    pool.query('SELECT COUNT(*)::int FROM classes'),
    pool.query(`SELECT COALESCE(SUM(montant),0)::float FROM paiements WHERE statut='confirme' AND confirmed_at >= date_trunc('month', NOW()) AND confirmed_at < date_trunc('month', NOW()) + INTERVAL '1 month'`),
    pool.query(`SELECT COALESCE(SUM(montant),0)::float FROM depenses WHERE statut IN ('validee','en_attente') AND COALESCE(date_depense, created_at) >= date_trunc('month', NOW()) AND COALESCE(date_depense, created_at) < date_trunc('month', NOW()) + INTERVAL '1 month'`),
    pool.query("SELECT COALESCE(SUM(montant),0)::float FROM paiements WHERE statut='confirme'"),
    pool.query("SELECT COALESCE(SUM(montant),0)::float FROM depenses WHERE statut='validee'"),
    pool.query("SELECT COUNT(*)::int FROM paiements WHERE statut='en_attente'"),
    pool.query("SELECT COUNT(*)::int FROM inscriptions WHERE statut='abandonne'"),
    pool.query("SELECT COUNT(*)::int FROM inscriptions WHERE statut='suspendu'"),
  ])

  const { rows: derniers } = await pool.query(`
    SELECT p.id,p.montant,p.type_paiement,p.confirmed_at,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom) as etudiant
    FROM paiements p
    LEFT JOIN inscriptions i ON p.inscription_id = i.id
    LEFT JOIN etudiants e ON i.etudiant_id = e.id
    WHERE p.statut='confirme' ORDER BY p.confirmed_at DESC LIMIT 5
  `)

  return c.json({
    etudiants_total: et.rows[0].count,
    inscriptions_actives: ia.rows[0].count,
    inscriptions_attente: iatt.rows[0].count,
    inscriptions_abandonnees: ab.rows[0].count,
    inscriptions_suspendues: su.rows[0].count,
    enseignants_actifs: iv.rows[0].count,
    filieres_actives: fi.rows[0].count,
    classes_total: cl.rows[0].count,
    encaisse_ce_mois: enc.rows[0].coalesce,
    depenses_ce_mois: dep.rows[0].coalesce,
    solde_tresorerie: (totR.rows[0].coalesce as number) - (totD.rows[0].coalesce as number),
    paiements_en_attente: pa.rows[0].count,
    impayes_total: 0,
    derniers_paiements: derniers,
  })
})

// ─── DASHBOARD STATS AVANCÉES ────────────────────────────────────────────────
app.get('/dashboard/stats-avancees', requireAuth, async (c) => {
  // Chaque requête est indépendante : une erreur n'en bloque pas d'autres
  const safe = async (fn: () => Promise<any>, fallback: any) => {
    try { return await fn() } catch { return fallback }
  }

  const [evolutionRows, classesRows, retardsRows, presenceRow] = await Promise.all([
    // 1. Évolution paiements — 6 derniers mois
    safe(() => pool.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', confirmed_at), 'YYYY-MM') AS mois,
             COALESCE(SUM(montant), 0)::float AS montant
      FROM paiements
      WHERE statut = 'confirme'
        AND confirmed_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
      GROUP BY 1 ORDER BY 1 ASC
    `).then(r => r.rows), []),

    // 2. Taux de remplissage des classes
    safe(() => pool.query(`
      SELECT c.id, c.nom,
             COALESCE(c.capacite, 30) AS capacite,
             COUNT(i.id) FILTER (WHERE i.statut = 'inscrit_actif')::int AS inscrits
      FROM classes c
      LEFT JOIN inscriptions i ON i.classe_id = c.id
      GROUP BY c.id, c.nom, c.capacite
      ORDER BY inscrits DESC
      LIMIT 8
    `).then(r => r.rows), []),

    // 3. Top 5 étudiants en retard de paiement
    safe(() => pool.query(`
      SELECT e.id, e.nom, e.prenom, e.numero_etudiant,
             COALESCE(SUM(ech.montant), 0)::float AS montant_retard,
             COUNT(ech.id)::int AS nb_mois_retard
      FROM etudiants e
      JOIN inscriptions i ON i.etudiant_id = e.id AND i.statut = 'inscrit_actif'
      JOIN echeances ech ON ech.inscription_id = i.id
        AND ech.statut = 'non_paye'
        AND ech.type_echeance = 'mensualite'
        AND ech.mois < DATE_TRUNC('month', NOW())
      GROUP BY e.id, e.nom, e.prenom, e.numero_etudiant
      ORDER BY montant_retard DESC
      LIMIT 5
    `).then(r => r.rows), []),

    // 4. Taux de présence global (séances émargées / séances passées)
    safe(() => pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE statut = 'effectue')::float AS effectuees,
        COUNT(*) FILTER (WHERE date_fin < NOW() AND statut NOT IN ('annule'))::float AS total_passees
      FROM seances
      WHERE date_debut >= DATE_TRUNC('month', NOW()) - INTERVAL '2 months'
    `).then(r => r.rows[0] ?? { effectuees: 0, total_passees: 0 }), { effectuees: 0, total_passees: 0 }),
  ])

  // Compléter les mois manquants dans l'évolution (toujours 6 points)
  const evolutionMap: Record<string, number> = {}
  for (const r of evolutionRows as any[]) evolutionMap[r.mois] = parseFloat(r.montant)
  const evol = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const key = d.toISOString().slice(0, 7)
    evol.push({ mois: key, montant: evolutionMap[key] ?? 0 })
  }

  const pr = presenceRow as any
  const eff = parseFloat(pr.effectuees) || 0
  const tot = parseFloat(pr.total_passees) || 0
  const tauxPresence = tot > 0 ? Math.round((eff / tot) * 100) : null

  return c.json({
    evolution_paiements: evol,
    classes_remplissage: classesRows,
    top_retards: retardsRows,
    taux_presence: tauxPresence,
    seances_effectuees: eff,
    seances_total_passees: tot,
  })
})

// ─── ÉCHEANCES ────────────────────────────────────────────────────────────────
// Helper : extraire "YYYY-MM-DD" d'une valeur pg (Date object ou string)
function pgDateToStr(val: any): string {
  if (val instanceof Date) return val.toISOString().substring(0, 10)
  return String(val).substring(0, 10)
}

async function genererEcheances(inscriptionId: number, moisDebut?: string) {
  // 1. Récupérer toutes les infos nécessaires en une seule requête
  const { rows } = await pool.query(`
    SELECT
      COALESCE(NULLIF(f.mensualite, 0), i.mensualite, 0)               AS mensualite,
      COALESCE(NULLIF(f.frais_inscription, 0), i.frais_inscription, 0) AS frais_inscription,
      COALESCE(NULLIF(f.montant_tenue, 0), i.frais_tenue, 0)           AS frais_tenue,
      COALESCE(f.duree_mois, 12)      AS duree_mois,
      COALESCE(nb.pourcentage, 0)     AS bourse_pct,
      COALESCE(nb.applique_inscription, false) AS bourse_applique,
      COALESCE(nb.applique_tenue, false)       AS bourse_applique_tenue,
      i.mois_debut,
      aa.date_debut AS annee_date_debut
    FROM inscriptions i
    LEFT JOIN filieres f ON i.filiere_id = f.id
    LEFT JOIN niveaux_bourse nb ON i.niveau_bourse_id = nb.id
    LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
    WHERE i.id = $1
  `, [inscriptionId])
  if (!rows[0]) return
  const insc = rows[0]

  // 2. Calculer les montants effectifs (après bourse)
  const mensBase = parseFloat(insc.mensualite) || 0
  const fraisBase = parseFloat(insc.frais_inscription) || 0
  const tenueBase = parseFloat(insc.frais_tenue) || 0
  const pct = parseFloat(insc.bourse_pct) || 0
  const mensEff = Math.round(mensBase * (1 - pct / 100))
  const fraisEff = insc.bourse_applique ? Math.round(fraisBase * (1 - pct / 100)) : fraisBase
  const tenueEff = insc.bourse_applique_tenue ? Math.round(tenueBase * (1 - pct / 100)) : tenueBase
  const duree = Math.max(1, Math.min(parseInt(insc.duree_mois) || 12, 36))

  // 3. Déterminer le mois de départ — source de vérité : inscriptions.mois_debut
  let startDate: Date
  if (insc.mois_debut) {
    // Source de vérité : le mois_debut stocké sur l'inscription
    startDate = new Date(pgDateToStr(insc.mois_debut) + 'T00:00:00')
  } else if (moisDebut) {
    // Paramètre passé (ex: formulaire d'inscription)
    startDate = new Date(moisDebut + '-01T00:00:00')
    // Sauvegarder pour ne plus jamais le deviner
    await pool.query(`UPDATE inscriptions SET mois_debut = $1 WHERE id = $2`, [moisDebut + '-01', inscriptionId]).catch(() => {})
  } else if (insc.annee_date_debut) {
    // Fallback : date début de l'année académique
    startDate = new Date(pgDateToStr(insc.annee_date_debut) + 'T00:00:00')
    const md = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`
    await pool.query(`UPDATE inscriptions SET mois_debut = $1 WHERE id = $2`, [md, inscriptionId]).catch(() => {})
  } else {
    startDate = new Date()
    const md = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`
    await pool.query(`UPDATE inscriptions SET mois_debut = $1 WHERE id = $2`, [md, inscriptionId]).catch(() => {})
  }
  const moisPremier = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-01`

  // 4. Frais inscription (une seule fois, au premier mois)
  if (fraisBase > 0) {
    await pool.query(
      `INSERT INTO echeances (inscription_id,mois,montant,type_echeance) VALUES ($1,$2,$3,'frais_inscription')
       ON CONFLICT (inscription_id,mois,type_echeance) DO UPDATE SET montant=$3 WHERE echeances.statut='non_paye'`,
      [inscriptionId, moisPremier, fraisEff]
    ).catch(() => {})
  }
  // Nettoyer les doublons frais_inscription à d'autres mois (non payés)
  await pool.query(
    `DELETE FROM echeances WHERE inscription_id = $1 AND type_echeance = 'frais_inscription' AND statut = 'non_paye' AND mois != $2::date`,
    [inscriptionId, moisPremier]
  ).catch(() => {})

  // 5. Tenue (une seule fois, au premier mois)
  if (tenueBase > 0) {
    await pool.query(
      `INSERT INTO echeances (inscription_id,mois,montant,type_echeance) VALUES ($1,$2,$3,'tenue')
       ON CONFLICT (inscription_id,mois,type_echeance) DO UPDATE SET montant=$3 WHERE echeances.statut='non_paye'`,
      [inscriptionId, moisPremier, tenueEff]
    ).catch(() => {})
  }
  // Nettoyer les doublons tenue à d'autres mois (non payés)
  await pool.query(
    `DELETE FROM echeances WHERE inscription_id = $1 AND type_echeance = 'tenue' AND statut = 'non_paye' AND mois != $2::date`,
    [inscriptionId, moisPremier]
  ).catch(() => {})

  // 6. Mensualités — liste fixe de N mois depuis mois_debut
  // Construire la liste des N mois attendus
  const moisTheoriques: string[] = []
  for (let i = 0; i < duree; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
    moisTheoriques.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`)
  }

  if (mensBase > 0) {
    // Charger les mensualités existantes
    const { rows: existantes } = await pool.query(
      `SELECT id, mois, montant, statut FROM echeances WHERE inscription_id = $1 AND type_echeance = 'mensualite' ORDER BY mois ASC`,
      [inscriptionId]
    )
    const existMap = new Map(existantes.map((e: any) => [pgDateToStr(e.mois), e]))

    // Créer les mois manquants, mettre à jour les montants si tarif changé
    for (const m of moisTheoriques) {
      const ex = existMap.get(m)
      if (!ex) {
        await pool.query(
          `INSERT INTO echeances (inscription_id,mois,montant,type_echeance) VALUES ($1,$2,$3,'mensualite')
           ON CONFLICT (inscription_id,mois,type_echeance) DO NOTHING`,
          [inscriptionId, m, mensEff]
        ).catch(() => {})
      } else if (ex.statut === 'non_paye' && parseFloat(ex.montant) !== mensEff) {
        await pool.query(`UPDATE echeances SET montant=$1 WHERE id=$2`, [mensEff, ex.id]).catch(() => {})
      }
    }

    // Supprimer TOUTES les mensualités hors liste théorique (non payées = delete, payées hors range = delete aussi car ce sont des fantômes)
    const idsASupprimer = existantes
      .filter((e: any) => !moisTheoriques.includes(pgDateToStr(e.mois)))
      .map((e: any) => e.id)
    if (idsASupprimer.length > 0) {
      // Vérifier s'il y a des paiements liés avant de supprimer
      const { rows: avecPaiements } = await pool.query(
        `SELECT DISTINCT e.id FROM echeances e
         INNER JOIN paiements p ON p.inscription_id = e.inscription_id
           AND p.type_paiement = 'mensualite' AND p.statut = 'confirme'
           AND DATE_TRUNC('month', p.mois_concerne::timestamptz) = DATE_TRUNC('month', e.mois::timestamptz)
         WHERE e.id = ANY($1::int[])`,
        [idsASupprimer]
      ).catch(() => ({ rows: [] }))
      const idsAvecPaiements = new Set(avecPaiements.map((r: any) => r.id))
      // Supprimer celles sans paiement lié
      const idsSafeDelete = idsASupprimer.filter((id: number) => !idsAvecPaiements.has(id))
      if (idsSafeDelete.length > 0) {
        await pool.query(`DELETE FROM echeances WHERE id = ANY($1::int[])`, [idsSafeDelete]).catch(() => {})
      }
      // Les payées hors range avec paiement réel : les garder mais ne pas les compter
    }
  }
}

app.get('/echeances', requireAuth, async (c) => {
  const inscriptionId = c.req.query('inscription_id')
  const statut = c.req.query('statut')
  const conditions: string[] = []
  const params: any[] = []
  if (inscriptionId) { params.push(inscriptionId); conditions.push(`e.inscription_id = $${params.length}`) }
  if (statut) { params.push(statut); conditions.push(`e.statut = $${params.length}`) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query(`
    SELECT e.*,
      jsonb_build_object('id',et.id,'nom',et.nom,'prenom',et.prenom,'numero_etudiant',et.numero_etudiant) as etudiant,
      jsonb_build_object('id',f.id,'nom',f.nom) as filiere,
      -- mois_paye : le mois_concerne saisi dans le formulaire de paiement
      CASE
        WHEN e.type_echeance = 'mensualite' THEN COALESCE(
          -- P1 : paiement avec mois_concerne correspondant exactement à ce mois
          (
            SELECT p.mois_concerne::text
            FROM paiements p
            WHERE p.inscription_id = e.inscription_id
              AND p.type_paiement = 'mensualite'
              AND p.statut = 'confirme'
              AND p.mois_concerne IS NOT NULL
              AND DATE_TRUNC('month', p.mois_concerne::timestamptz) = DATE_TRUNC('month', e.mois::timestamptz)
            ORDER BY COALESCE(p.confirmed_at, p.created_at) DESC
            LIMIT 1
          ),
          -- P2 : positionnel → mois_concerne du paiement associé (peut être null si non saisi)
          (
            SELECT p.mois_concerne::text
            FROM paiements p
            WHERE p.inscription_id = e.inscription_id
              AND p.type_paiement = 'mensualite'
              AND p.statut = 'confirme'
              AND (
                SELECT COALESCE(SUM(p2.montant), 0)::numeric
                FROM paiements p2
                WHERE p2.inscription_id = e.inscription_id
                  AND p2.type_paiement = 'mensualite'
                  AND p2.statut = 'confirme'
                  AND (
                    COALESCE(p2.confirmed_at, p2.created_at) < COALESCE(p.confirmed_at, p.created_at)
                    OR (COALESCE(p2.confirmed_at, p2.created_at) = COALESCE(p.confirmed_at, p.created_at) AND p2.id <= p.id)
                  )
              ) > GREATEST(
                (
                  SELECT COALESCE(SUM(e2.montant), 0)::numeric
                  FROM echeances e2
                  WHERE e2.inscription_id = e.inscription_id
                    AND e2.type_echeance = 'mensualite'
                    AND e2.mois < e.mois
                ) - (
                  SELECT GREATEST(
                    COALESCE((SELECT SUM(pfi.montant) FROM paiements pfi
                              WHERE pfi.inscription_id = e.inscription_id
                                AND pfi.type_paiement = 'frais_inscription'
                                AND pfi.statut = 'confirme'), 0)
                    - COALESCE((SELECT efi.montant FROM echeances efi
                                WHERE efi.inscription_id = e.inscription_id
                                  AND efi.type_echeance = 'frais_inscription'
                                LIMIT 1), 0),
                    0
                  )
                ),
                0
              )
            ORDER BY COALESCE(p.confirmed_at, p.created_at) ASC, p.id ASC
            LIMIT 1
          )
        )
        ELSE NULL
      END AS mois_paye,
      -- date_paiement : la date réelle du règlement (confirmed_at)
      CASE
        WHEN e.type_echeance = 'mensualite' THEN COALESCE(
          -- P1 : paiement avec mois_concerne correspondant exactement
          (
            SELECT COALESCE(p.confirmed_at, p.created_at)::text
            FROM paiements p
            WHERE p.inscription_id = e.inscription_id
              AND p.type_paiement = 'mensualite'
              AND p.statut = 'confirme'
              AND p.mois_concerne IS NOT NULL
              AND DATE_TRUNC('month', p.mois_concerne::timestamptz) = DATE_TRUNC('month', e.mois::timestamptz)
            ORDER BY COALESCE(p.confirmed_at, p.created_at) DESC
            LIMIT 1
          ),
          -- P2 : positionnel
          (
            SELECT COALESCE(p.confirmed_at, p.created_at)::text
            FROM paiements p
            WHERE p.inscription_id = e.inscription_id
              AND p.type_paiement = 'mensualite'
              AND p.statut = 'confirme'
              AND (
                SELECT COALESCE(SUM(p2.montant), 0)::numeric
                FROM paiements p2
                WHERE p2.inscription_id = e.inscription_id
                  AND p2.type_paiement = 'mensualite'
                  AND p2.statut = 'confirme'
                  AND (
                    COALESCE(p2.confirmed_at, p2.created_at) < COALESCE(p.confirmed_at, p.created_at)
                    OR (COALESCE(p2.confirmed_at, p2.created_at) = COALESCE(p.confirmed_at, p.created_at) AND p2.id <= p.id)
                  )
              ) > GREATEST(
                (
                  SELECT COALESCE(SUM(e2.montant), 0)::numeric
                  FROM echeances e2
                  WHERE e2.inscription_id = e.inscription_id
                    AND e2.type_echeance = 'mensualite'
                    AND e2.mois < e.mois
                ) - (
                  SELECT GREATEST(
                    COALESCE((SELECT SUM(pfi.montant) FROM paiements pfi
                              WHERE pfi.inscription_id = e.inscription_id
                                AND pfi.type_paiement = 'frais_inscription'
                                AND pfi.statut = 'confirme'), 0)
                    - COALESCE((SELECT efi.montant FROM echeances efi
                                WHERE efi.inscription_id = e.inscription_id
                                  AND efi.type_echeance = 'frais_inscription'
                                LIMIT 1), 0),
                    0
                  )
                ),
                0
              )
            ORDER BY COALESCE(p.confirmed_at, p.created_at) ASC, p.id ASC
            LIMIT 1
          ),
          -- P3 : surplus FI → premier paiement confirmé de l'inscription
          (
            SELECT COALESCE(p.confirmed_at, p.created_at)::text
            FROM paiements p
            WHERE p.inscription_id = e.inscription_id
              AND p.statut = 'confirme'
            ORDER BY COALESCE(p.confirmed_at, p.created_at) ASC, p.id ASC
            LIMIT 1
          )
        )
        ELSE (
          SELECT COALESCE(p.confirmed_at, p.created_at)::text
          FROM paiements p
          WHERE p.inscription_id = e.inscription_id
            AND p.type_paiement = e.type_echeance
            AND p.statut = 'confirme'
          ORDER BY COALESCE(p.confirmed_at, p.created_at) DESC
          LIMIT 1
        )
      END AS date_paiement
    FROM echeances e
    LEFT JOIN inscriptions i ON e.inscription_id = i.id
    LEFT JOIN etudiants et ON i.etudiant_id = et.id
    LEFT JOIN filieres f ON i.filiere_id = f.id
    ${where}
    ORDER BY e.mois ASC, et.nom, et.prenom
  `, params)
  return c.json(rows)
})

// Modifier le mois d'une écheance (correction manuelle)
app.patch('/echeances/:id/mois', requireAuth, role('secretariat', 'dg'), async (c) => {
  const id = c.req.param('id')
  const { mois } = await c.req.json()
  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) return c.json({ error: 'Format mois invalide (YYYY-MM)' }, 400)
  const moisDate = `${mois}-01`
  const { rows } = await pool.query(
    `UPDATE echeances SET mois = $1 WHERE id = $2 RETURNING *`,
    [moisDate, id]
  )
  if (!rows.length) return c.json({ error: 'Écheance non trouvée' }, 404)
  // Recalculer les statuts après changement de mois
  await recalculerEcheances(rows[0].inscription_id)
  return c.json(rows[0])
})

// Génération / régénération d'échéances — un seul endpoint idempotent
// genererEcheances fait tout : crée les manquantes, met à jour les montants, supprime le surplus
app.post('/echeances/generer', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { inscription_id, mois_debut } = await c.req.json()
  await genererEcheances(parseInt(inscription_id), mois_debut || undefined)
  return c.json({ success: true })
})

// Garder /regenerer comme alias pour compatibilité frontend
app.post('/echeances/regenerer', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { inscription_id, mois_debut } = await c.req.json()
  await genererEcheances(parseInt(inscription_id), mois_debut || undefined)
  return c.json({ success: true })
})

// Régénérer les échéances de TOUTES les inscriptions actives + nettoyage profond
app.post('/echeances/regenerer-tout', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { rows: inscriptions } = await pool.query(
    `SELECT i.id, i.mois_debut FROM inscriptions i WHERE i.statut IN ('inscrit_actif','pre_inscrit')`
  )

  // Phase 1 : nettoyage profond des doublons (y compris payés)
  let cleaned = 0
  for (const insc of inscriptions) {
    if (!insc.mois_debut) continue
    const moisPremier = pgDateToStr(insc.mois_debut)
    // Supprimer les frais_inscription en doublon (hors mois_debut) — même payés
    const { rowCount: c1 } = await pool.query(
      `DELETE FROM echeances WHERE inscription_id = $1 AND type_echeance = 'frais_inscription' AND mois != $2::date`,
      [insc.id, moisPremier]
    ).catch(() => ({ rowCount: 0 }))
    // Supprimer les tenue en doublon (hors mois_debut) — même payés
    const { rowCount: c2 } = await pool.query(
      `DELETE FROM echeances WHERE inscription_id = $1 AND type_echeance = 'tenue' AND mois != $2::date`,
      [insc.id, moisPremier]
    ).catch(() => ({ rowCount: 0 }))
    cleaned += (c1 || 0) + (c2 || 0)
  }

  // Phase 2 : régénérer proprement
  let ok = 0, erreurs = 0
  for (const insc of inscriptions) {
    try {
      await genererEcheances(insc.id)
      ok++
    } catch { erreurs++ }
  }
  return c.json({ success: true, total: inscriptions.length, ok, erreurs, cleaned })
})

// ─── PAIEMENTS ────────────────────────────────────────────────────────────────
app.get('/paiements', requireAuth, async (c) => {
  const q = c.req.query()
  const conditions: string[] = []
  const params: any[] = []
  let idx = 1
  if (q.statut)       { conditions.push(`p.statut=$${idx++}`);        params.push(q.statut) }
  if (q.mode_paiement){ conditions.push(`p.mode_paiement=$${idx++}`); params.push(q.mode_paiement) }
  if (q.inscription_id){ conditions.push(`p.inscription_id=$${idx++}`); params.push(q.inscription_id) }
  if (q.date_from)    { conditions.push(`COALESCE(p.confirmed_at, p.created_at)::date >= $${idx++}`); params.push(q.date_from) }
  if (q.date_to)      { conditions.push(`COALESCE(p.confirmed_at, p.created_at)::date <= $${idx++}`); params.push(q.date_to) }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const { rows } = await pool.query(`
    SELECT p.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom) as etudiant,
      jsonb_build_object('id',cu.id,'name',COALESCE(cu.prenom||' '||cu.nom, cu.email)) as created_by_user,
      jsonb_build_object('id',cf.id,'name',COALESCE(cf.prenom||' '||cf.nom, cf.email)) as confirmed_by_user
    FROM paiements p
    LEFT JOIN inscriptions i  ON p.inscription_id = i.id
    LEFT JOIN etudiants e     ON i.etudiant_id = e.id
    LEFT JOIN users cu        ON p.created_by = cu.id
    LEFT JOIN users cf        ON p.confirmed_by = cf.id
    ${where}
    ORDER BY p.created_at DESC
  `, params)
  return c.json({ data: rows, total: rows.length })
})

app.get('/paiements/:id', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM paiements WHERE id=$1', [c.req.param('id')])
  if (!rows[0]) return c.json({ message: 'Paiement introuvable.' }, 404)
  return c.json(rows[0])
})

// Recalcule intégralement toutes les échéances d'une inscription avec cascade des surplus :
// frais_inscription surplus → mensualité 1 → mensualité 2 → ...
// mensualité N surplus → mensualité N+1 → ...
async function recalculerEcheances(inscriptionId: number) {
  try {
    // 1. Frais d'inscription
    const { rows: fiEch } = await pool.query(
      `SELECT id, montant FROM echeances WHERE inscription_id=$1 AND type_echeance='frais_inscription' LIMIT 1`,
      [inscriptionId]
    )
    const { rows: fiPaid } = await pool.query(
      `SELECT COALESCE(SUM(montant),0)::float AS total FROM paiements
       WHERE inscription_id=$1 AND type_paiement='frais_inscription' AND statut='confirme'`,
      [inscriptionId]
    )
    let surplus = 0
    if (fiEch[0]) {
      const totalFI = Number(fiPaid[0].total)
      const montantFI = Number(fiEch[0].montant)
      const statutFI = totalFI >= montantFI ? 'paye' : totalFI > 0 ? 'partiellement_paye' : 'non_paye'
      await pool.query(`UPDATE echeances SET statut=$1 WHERE id=$2`, [statutFI, fiEch[0].id])
      surplus = Math.max(0, totalFI - montantFI)
    }

    // 2. Tenue
    const { rows: tenueEchs } = await pool.query(
      `SELECT id, montant FROM echeances WHERE inscription_id=$1 AND type_echeance='tenue'`,
      [inscriptionId]
    )
    for (const ech of tenueEchs) {
      const { rows: tenuePaid } = await pool.query(
        `SELECT COALESCE(SUM(montant),0)::float AS total FROM paiements
         WHERE inscription_id=$1 AND type_paiement='tenue' AND statut='confirme'`,
        [inscriptionId]
      )
      const totalTenue = Number(tenuePaid[0].total)
      const montantTenue = Number(ech.montant)
      const statutTenue = totalTenue >= montantTenue ? 'paye' : totalTenue > 0 ? 'partiellement_paye' : 'non_paye'
      await pool.query(`UPDATE echeances SET statut=$1 WHERE id=$2`, [statutTenue, ech.id])
    }

    // 3. Mensualités : cumul positionnel — total des paiements distribué de M1 vers M_n
    //    (M1 = première mensualité couverte, peu importe la date ou mois_concerne)
    const { rows: mensEchs } = await pool.query(
      `SELECT id, montant, mois FROM echeances
       WHERE inscription_id=$1 AND type_echeance='mensualite'
       ORDER BY mois ASC`,
      [inscriptionId]
    )
    // Somme totale de tous les paiements mensualité confirmés
    const { rows: mensSum } = await pool.query(
      `SELECT COALESCE(SUM(montant),0)::float AS total FROM paiements
       WHERE inscription_id=$1 AND type_paiement='mensualite' AND statut='confirme'`,
      [inscriptionId]
    )
    let remaining = Number(mensSum[0].total) + surplus
    for (const ech of mensEchs) {
      const montant = Number(ech.montant)
      const statut = remaining >= montant ? 'paye' : remaining > 0 ? 'partiellement_paye' : 'non_paye'
      await pool.query(`UPDATE echeances SET statut=$1 WHERE id=$2`, [statut, ech.id])
      remaining = Math.max(0, remaining - montant)
    }
  } catch { /* silencieux */ }
}

// ─── Helper : créer une notification in-app pour un utilisateur ──────────────
async function createUserNotif(user_id: number, type: string, titre: string, message: string, data: Record<string, any> = {}) {
  await pool.query(
    `INSERT INTO user_notifications (user_id, type, titre, message, data) VALUES ($1,$2,$3,$4,$5)`,
    [user_id, type, titre, message, JSON.stringify(data)]
  ).catch(() => {})
}

app.post('/paiements', requireAuth, role('secretariat', 'dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const seq = await nextSeq('paiements')
  const numero = `PAY-${year()}-${pad(seq)}`
  // Si une date de paiement est fournie explicitement, le paiement est confirmé
  const customDate = b.confirmed_at ? new Date(b.confirmed_at).toISOString() : null
  const isEspeces = (b.mode_paiement || 'especes') === 'especes'
  const isConfirmed = isEspeces || !!customDate
  const statut = isConfirmed ? 'confirme' : 'en_attente'
  const moisConcerne = b.mois_concerne
    ? (String(b.mois_concerne).length === 7 ? b.mois_concerne + '-01' : b.mois_concerne)
    : null
  const { rows } = await pool.query(
    `INSERT INTO paiements (inscription_id,numero_recu,type_paiement,mois_concerne,montant,mode_paiement,statut,confirmed_at,reference,observation,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [b.inscription_id, numero, b.type_paiement || 'mensualite', moisConcerne,
     b.montant, b.mode_paiement || 'especes', statut,
     customDate ?? (isEspeces ? new Date().toISOString() : null),
     b.reference || null, b.observation || null, u(c).id]
  )
  if (isConfirmed && b.inscription_id) {
    await recalculerEcheances(b.inscription_id)
    // Notifier l'étudiant in-app
    try {
      const { rows: inscRows } = await pool.query(
        `SELECT et.user_id, et.prenom, et.nom FROM inscriptions i
         JOIN etudiants et ON et.id = i.etudiant_id WHERE i.id=$1`,
        [b.inscription_id]
      )
      if (inscRows[0]?.user_id) {
        const typeLabels: Record<string, string> = {
          mensualite: 'mensualité', frais_inscription: "frais d'inscription",
          tenue: 'tenue scolaire', rattrapage: 'rattrapage', autre: 'paiement',
        }
        const typeLabel = typeLabels[b.type_paiement as string] || 'paiement'
        await createUserNotif(
          inscRows[0].user_id, 'paiement',
          '✅ Paiement enregistré',
          `Votre ${typeLabel} de ${Number(b.montant).toLocaleString('fr-FR')} FCFA a bien été reçu (réf. ${numero}).`,
          { montant: b.montant, type: b.type_paiement, numero }
        )
      }
    } catch { /* silencieux */ }
  }
  return c.json(rows[0], 201)
})

app.put('/paiements/:id', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const moisConcerne = b.mois_concerne
    ? (String(b.mois_concerne).length === 7 ? b.mois_concerne + '-01' : b.mois_concerne)
    : null
  const confirmedAt = b.confirmed_at ? new Date(b.confirmed_at).toISOString() : null
  const { rows } = await pool.query(
    `UPDATE paiements
     SET montant=$1, type_paiement=$2, mois_concerne=$3, mode_paiement=$4, reference=$5, observation=$6,
         confirmed_at=COALESCE($8::timestamptz, confirmed_at),
         statut=CASE WHEN $8 IS NOT NULL AND statut='en_attente' THEN 'confirme' ELSE statut END
     WHERE id=$7 RETURNING *`,
    [b.montant, b.type_paiement, moisConcerne, b.mode_paiement, b.reference || null, b.observation || null, c.req.param('id'), confirmedAt]
  )
  if (rows[0]?.inscription_id) await recalculerEcheances(rows[0].inscription_id)
  return c.json(rows[0])
})

app.post('/paiements/:id/confirmer', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const { rows } = await pool.query(
    "UPDATE paiements SET statut='confirme',confirmed_at=NOW(),confirmed_by=$1 WHERE id=$2 RETURNING *",
    [u(c).id, c.req.param('id')]
  )
  if (rows[0] && rows[0].inscription_id) {
    await recalculerEcheances(rows[0].inscription_id)
  }
  return c.json(rows[0])
})

// Recalcule les MONTANTS des échéances selon les tarifs actuels des filières, puis recalcule les statuts
app.post('/echeances/recalculer-tarifs', requireAuth, role('dg'), async (c) => {
  try {
    // Récupérer toutes les inscriptions actives avec les tarifs actuels de leur filière
    const { rows: inscriptions } = await pool.query(`
      SELECT i.id AS inscription_id,
             COALESCE(NULLIF(f.frais_inscription,0), i.frais_inscription, 0) AS frais_inscription,
             COALESCE(NULLIF(f.mensualite,0), i.mensualite, 0)               AS mensualite,
             COALESCE(NULLIF(f.montant_tenue,0), i.frais_tenue, 0)           AS montant_tenue,
             COALESCE(nb.pourcentage, 0)                                      AS bourse_pct,
             COALESCE(nb.applique_inscription, false)                         AS bourse_applique,
             COALESCE(nb.applique_tenue, false)                               AS bourse_applique_tenue
      FROM inscriptions i
      LEFT JOIN filieres f ON f.id = i.filiere_id
      LEFT JOIN niveaux_bourse nb ON nb.id = i.niveau_bourse_id
      WHERE i.statut NOT IN ('annule','archive')
    `)
    let updated = 0
    for (const insc of inscriptions) {
      const pct = parseFloat(insc.bourse_pct) || 0
      const appliqueInscription = insc.bourse_applique
      const appliqueTenue = insc.bourse_applique_tenue
      const fraisEff = appliqueInscription ? Math.round(Number(insc.frais_inscription) * (1 - pct / 100)) : Number(insc.frais_inscription)
      const mensEff = Math.round(Number(insc.mensualite) * (1 - pct / 100))
      const tenueEff = appliqueTenue ? Math.round(Number(insc.montant_tenue) * (1 - pct / 100)) : Number(insc.montant_tenue)
      // Mise à jour montant frais_inscription (avec bourse)
      if (Number(insc.frais_inscription) > 0) {
        await pool.query(
          `UPDATE echeances SET montant=$1 WHERE inscription_id=$2 AND type_echeance='frais_inscription'`,
          [fraisEff, insc.inscription_id]
        )
      }
      // Mise à jour montant mensualités (avec bourse)
      if (Number(insc.mensualite) > 0) {
        await pool.query(
          `UPDATE echeances SET montant=$1 WHERE inscription_id=$2 AND type_echeance='mensualite'`,
          [mensEff, insc.inscription_id]
        )
      }
      // Tenue : mettre à jour si elle existe, sinon la créer (avec bourse)
      if (Number(insc.montant_tenue) > 0) {
        const moisCourant = new Date().toISOString().substring(0, 7) + '-01'
        await pool.query(
          `INSERT INTO echeances (inscription_id,mois,montant,type_echeance)
           VALUES ($1,$2,$3,'tenue')
           ON CONFLICT (inscription_id,mois,type_echeance) DO UPDATE SET montant=$3`,
          [insc.inscription_id, moisCourant, tenueEff]
        )
      }
      // Recalcul des statuts avec cascade surplus
      await recalculerEcheances(insc.inscription_id)
      updated++
    }
    return c.json({ message: `Tarifs et statuts recalculés pour ${updated} inscription(s).` })
  } catch (err: any) {
    return c.json({ message: err.message }, 500)
  }
})

// Recalcule toutes les échéances de toutes les inscriptions (données existantes)
app.post('/paiements/recalculer-surpluses', requireAuth, role('dg'), async (c) => {
  try {
    const { rows: inscIds } = await pool.query(
      `SELECT DISTINCT inscription_id FROM paiements WHERE statut='confirme'`
    )
    for (const row of inscIds) {
      await recalculerEcheances(row.inscription_id)
    }
    return c.json({ message: `Recalcul effectué pour ${inscIds.length} inscription(s).` })
  } catch (err: any) {
    return c.json({ message: err.message }, 500)
  }
})

app.post('/paiements/:id/rejeter', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const { rows } = await pool.query(
    "UPDATE paiements SET statut='rejete',observation=$1 WHERE id=$2 RETURNING *",
    [b.motif || null, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/paiements/:id', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  // Récupérer l'inscription_id avant suppression pour recalculer les échéances
  const { rows: pRows } = await pool.query('SELECT inscription_id FROM paiements WHERE id=$1', [id])
  if (!pRows[0]) return c.json({ message: 'Paiement introuvable.' }, 404)
  const inscriptionId = pRows[0].inscription_id
  await pool.query('DELETE FROM paiements WHERE id=$1', [id])
  // Recalculer les statuts d'échéances
  if (inscriptionId) await recalculerEcheances(inscriptionId)
  return c.json({ message: 'Paiement supprimé.' })
})

// ─── DEPENSES ─────────────────────────────────────────────────────────────────
app.get('/depenses', requireAuth, async (c) => {
  const q = c.req.query()
  const conditions: string[] = []
  const params: any[] = []
  let idx = 1
  if (q.statut)    { conditions.push(`d.statut=$${idx++}`);    params.push(q.statut) }
  if (q.categorie) { conditions.push(`d.categorie=$${idx++}`); params.push(q.categorie) }
  if (q.date_from) { conditions.push(`d.date_depense::date >= $${idx++}`); params.push(q.date_from) }
  if (q.date_to)   { conditions.push(`d.date_depense::date <= $${idx++}`); params.push(q.date_to) }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
  const { rows } = await pool.query(`
    SELECT d.*,
      jsonb_build_object('id',cu.id,'name',COALESCE(cu.prenom||' '||cu.nom, cu.email)) as created_by_user,
      jsonb_build_object('id',vu.id,'name',COALESCE(vu.prenom||' '||vu.nom, vu.email)) as validated_by_user
    FROM depenses d
    LEFT JOIN users cu ON d.created_by = cu.id
    LEFT JOIN users vu ON d.validated_by = vu.id
    ${where}
    ORDER BY d.date_depense DESC, d.created_at DESC
  `, params)
  return c.json({ data: rows, total: rows.length })
})

app.get('/depenses/:id', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM depenses WHERE id=$1', [c.req.param('id')])
  if (!rows[0]) return c.json({ message: 'Dépense introuvable.' }, 404)
  return c.json(rows[0])
})

app.post('/depenses', requireAuth, role('secretariat', 'dg'), async (c) => {
  const b = await c.req.json()
  if (await isPeriodeLocked(b.date_depense)) {
    const periode = String(b.date_depense).slice(0, 7)
    return c.json({ message: `Période ${periode} clôturée. Modification impossible.` }, 423)
  }
  const { rows } = await pool.query(
    `INSERT INTO depenses (libelle,montant,categorie,date_depense,statut,mode_paiement,beneficiaire,reference_facture,notes,created_by)
     VALUES ($1,$2,$3,$4,'en_attente',$5,$6,$7,$8,$9) RETURNING *`,
    [b.libelle, b.montant, b.categorie || null, b.date_depense, b.mode_paiement || 'especes', b.beneficiaire || null, b.reference_facture || null, b.notes || null, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.post('/depenses/:id/justificatif', requireAuth, role('secretariat', 'dg'), async (c) => {
  return c.json({ message: 'Upload justificatif: utilisez un service de stockage externe.' })
})

app.post('/depenses/:id/valider', requireAuth, role('dg'), async (c) => {
  const { rows } = await pool.query("UPDATE depenses SET statut='validee' WHERE id=$1 RETURNING *", [c.req.param('id')])
  return c.json(rows[0])
})

app.post('/depenses/:id/rejeter', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const { rows } = await pool.query("UPDATE depenses SET statut='rejetee',motif_rejet=$1 WHERE id=$2 RETURNING *", [b.motif || null, c.req.param('id')])
  return c.json(rows[0])
})

// Validation en masse : valider une sélection d'IDs ou TOUTES les dépenses en attente
app.post('/depenses/valider-masse', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json().catch(() => ({})) as { ids?: number[] }
  const ids = Array.isArray(b.ids) && b.ids.length > 0 ? b.ids : null
  let result
  if (ids) {
    result = await pool.query(
      `UPDATE depenses SET statut='validee', validated_at=NOW() WHERE id=ANY($1) AND statut='en_attente' RETURNING id`,
      [ids]
    )
  } else {
    result = await pool.query(
      `UPDATE depenses SET statut='validee', validated_at=NOW() WHERE statut='en_attente' RETURNING id`
    )
  }
  const n = result.rowCount ?? 0
  return c.json({ validated: n, message: `${n} dépense${n !== 1 ? 's' : ''} validée${n !== 1 ? 's' : ''}.` })
})

// PUT /depenses/:id — DG ou resp_fin peut modifier libellé, montant, date, catégorie, mode paiement, notes
app.put('/depenses/:id', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const id = c.req.param('id')
  const { rows } = await pool.query("SELECT id, date_depense FROM depenses WHERE id=$1", [id])
  if (!rows[0]) return c.json({ message: 'Introuvable.' }, 404)
  if (await isPeriodeLocked(rows[0].date_depense)) {
    const periode = String(rows[0].date_depense).slice(0, 7)
    return c.json({ message: `Période ${periode} clôturée. Modification impossible.` }, 423)
  }
  const b = await c.req.json()
  // Nettoyer montant (accepte espaces/virgules comme séparateurs de milliers)
  const montant = Number(String(b.montant ?? '0').replace(/[\s\u00a0]/g, '').replace(',', '.'))
  if (isNaN(montant) || montant <= 0) return c.json({ message: 'Montant invalide.' }, 422)
  await pool.query(
    `UPDATE depenses SET
      libelle=$1, montant=$2, date_depense=$3, categorie=$4,
      mode_paiement=$5, notes=$6, beneficiaire=$7
     WHERE id=$8`,
    [
      b.libelle?.trim(),
      montant,
      b.date_depense,
      b.categorie ?? 'autre',
      b.mode_paiement ?? 'especes',
      b.notes ?? null,
      b.beneficiaire ?? null,
      id
    ]
  )
  return c.json({ ok: true })
})

app.delete('/depenses/:id', requireAuth, role('dg'), async (c) => {
  const { rows } = await pool.query("SELECT statut, date_depense FROM depenses WHERE id=$1", [c.req.param('id')])
  if (!rows[0]) return c.json({ message: 'Introuvable.' }, 404)
  if (await isPeriodeLocked(rows[0].date_depense)) {
    const periode = String(rows[0].date_depense).slice(0, 7)
    return c.json({ message: `Période ${periode} clôturée. Modification impossible.` }, 423)
  }
  // Le DG peut supprimer toute dépense, même validée (avec confirmation côté frontend)
  await pool.query('DELETE FROM depenses WHERE id=$1', [c.req.param('id')])
  return c.json({ ok: true })
})

// ─── IMPORT DÉPENSES ──────────────────────────────────────────────────────────

// Télécharger le modèle CSV
app.get('/depenses/template-import', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const { rows: cats } = await pool.query('SELECT code, libelle FROM categories_depenses WHERE actif=true ORDER BY ordre')
  const catList = cats.map((r: { code: string; libelle: string }) => `${r.code} (${r.libelle})`).join(' | ')

  const lines = [
    '# MODELE IMPORT DEPENSES - UPTECH CAMPUS',
    `# Catégories disponibles : ${catList}`,
    '# Modes de paiement : especes | virement | wave | orange_money | cheque',
    '# Format date : YYYY-MM-DD (ex: 2025-11-15)',
    '# Les colonnes beneficiaire, reference_facture et notes sont optionnelles',
    '#',
    'date_depense,libelle,montant,categorie,mode_paiement,beneficiaire,reference_facture,notes',
    '2025-11-15,Achat cartouches imprimante,45000,fournitures,especes,Papeterie Express,FAC-2025-001,Cartouches HP',
    '2025-11-30,Loyer novembre 2025,700000,loyer_charges,virement,MME MBOUP,VIR-NOV25,',
    '2025-12-05,Facture électricité,85000,loyer_charges,especes,SENELEC,,',
  ].join('\r\n')

  return new Response(lines, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="modele_import_depenses.csv"',
    }
  })
})

// Import CSV de dépenses
app.post('/depenses/import', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const body = await c.req.text()

  // Auto-détection du séparateur (Excel FR → ';', standard → ',')
  const rawLines = body.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))
  const firstLine = rawLines[0] ?? ''
  const sep = (firstLine.split(';').length >= firstLine.split(',').length && firstLine.includes(';')) ? ';' : ','

  // Parser CSV robuste (gère les champs entre guillemets, séparateur dynamique)
  function parseCSVLine(line: string): string[] {
    const result: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === sep && !inQ) { result.push(cur.trim()); cur = '' }
      else cur += ch
    }
    result.push(cur.trim())
    return result
  }

  const lines = rawLines
  if (lines.length < 2) return c.json({ message: 'Fichier vide ou invalide.' }, 422)

  const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9_]/g, ''))

  // Alias pour compatibilité Livre de caisse : designation→libelle, sortie→montant, date→date_depense
  const colMap = (col: string) => {
    if (col === 'designation' || col === 'libelle') return 'libelle'
    if (col === 'sortie' || col === 'montant' || col === 'montantfcfa') return 'montant'
    if (col === 'date') return 'date_depense'
    if (col === 'modedepaiement' || col === 'mode_paiement') return 'mode_paiement'
    if (col === 'categories' || col === 'categorie') return 'categorie'
    if (col === 'beneficiaire') return 'beneficiaire'
    if (col === 'notes' || col === 'description') return 'notes'
    return col
  }
  const normalizedHeader = header.map(colMap)

  const requiredCols = ['date_depense', 'libelle', 'montant']
  for (const col of requiredCols) {
    if (!normalizedHeader.includes(col)) return c.json({ message: `Colonne manquante : "${col}". En-têtes trouvés : ${header.join(', ')}` }, 422)
  }

  const idx = (col: string) => normalizedHeader.indexOf(col)

  const { rows: cats } = await pool.query('SELECT code FROM categories_depenses WHERE actif=true')
  const validCats = new Set(cats.map((r: { code: string }) => r.code))
  const validModes = new Set(['especes', 'virement', 'wave', 'orange_money', 'cheque', 'prelevement'])

  const created: unknown[] = []
  const errors: { ligne: number; erreur: string }[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    const get = (col: string) => (cols[idx(col)] ?? '').trim()

    const dateRaw     = get('date_depense')
    const libelle     = get('libelle')
    // Nettoyage montant : espaces ordinaires + insécables (\u00a0) + apostrophes typographiques comme séparateurs de milliers
    const montantRaw  = get('montant').replace(/[\s\u00a0']/g, '').replace(/,(?=\d{3}(?:[^,]|$))/g, '').replace(',', '.')
    const categorieRaw = get('categorie')
    const modeRaw     = get('mode_paiement')
    const beneficiaire = get('beneficiaire') || null
    const notes        = get('notes') || null

    // Ignorer lignes vraiment vides
    if (!dateRaw && !libelle && !montantRaw) continue
    // Ignorer si montant vide (entrées de recettes dans le livre de caisse)
    if (!montantRaw) continue

    // Validation date — accepter YYYY-MM-DD et DD/MM/YYYY
    let date_depense = dateRaw
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateRaw)) {
      const [d, m, y] = dateRaw.split('/'); date_depense = `${y}-${m}-${d}`
    }
    if (!date_depense || !/^\d{4}-\d{2}-\d{2}$/.test(date_depense))
      { errors.push({ ligne: i + 1, erreur: `Date invalide : "${dateRaw}" (attendu AAAA-MM-JJ ou JJ/MM/AAAA)` }); continue }
    if (!libelle)
      { errors.push({ ligne: i + 1, erreur: 'Libellé / Désignation manquant' }); continue }
    const montant = Number(montantRaw)
    if (isNaN(montant) || montant <= 0)
      { errors.push({ ligne: i + 1, erreur: `Montant invalide : "${montantRaw}"` }); continue }

    // Catégorie : si vide ou inconnue → 'autre' par défaut (pas d'erreur)
    const categorie = validCats.has(categorieRaw) ? categorieRaw : 'autre'
    const mode = validModes.has(modeRaw) ? modeRaw : 'especes'
    const mois = date_depense.slice(0, 7)

    try {
      const { rows } = await pool.query(
        `INSERT INTO depenses (libelle,montant,categorie,date_depense,statut,mode_paiement,mois_concerne,beneficiaire,notes,created_by)
         VALUES ($1,$2,$3,$4,'en_attente',$5,$6,$7,$8,$9) RETURNING *`,
        [libelle, montant, categorie, date_depense, mode, mois, beneficiaire, notes, u(c).id]
      )
      created.push(rows[0])
    } catch (e: unknown) {
      errors.push({ ligne: i + 1, erreur: (e as Error).message })
    }
  }

  return c.json({
    created: created.length,
    errors: errors.length,
    details_erreurs: errors,
    message: `${created.length} dépense(s) importée(s)${errors.length > 0 ? `, ${errors.length} ligne(s) ignorée(s)` : ' avec succès'}.`
  }, created.length > 0 ? 201 : 422)
})

// ─── CATÉGORIES DÉPENSES ──────────────────────────────────────────────────────
app.get('/categories-depenses', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM categories_depenses ORDER BY ordre, libelle')
  return c.json(rows)
})
app.post('/categories-depenses', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  if (!b.libelle) return c.json({ message: 'Le libellé est obligatoire.' }, 422)
  const code = (b.code || b.libelle).toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 50)
  const { rows } = await pool.query(
    `INSERT INTO categories_depenses (code,libelle,description,ordre,actif) VALUES ($1,$2,$3,$4,true) RETURNING *`,
    [code, b.libelle, b.description || null, b.ordre || 0]
  )
  return c.json(rows[0], 201)
})
app.put('/categories-depenses/:id', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE categories_depenses SET libelle=$1,description=$2,ordre=$3,actif=$4 WHERE id=$5 RETURNING *`,
    [b.libelle, b.description || null, b.ordre ?? 0, b.actif ?? true, c.req.param('id')]
  )
  return c.json(rows[0])
})
app.delete('/categories-depenses/:id', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  const { rows: used } = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM depenses d
     JOIN categories_depenses c ON d.categorie = c.code
     WHERE c.id=$1`, [id]
  )
  if (used[0].cnt > 0) return c.json({ message: `Cette catégorie est utilisée par ${used[0].cnt} dépense(s). Impossible de la supprimer.` }, 409)
  await pool.query('DELETE FROM categories_depenses WHERE id=$1', [id])
  return c.json({ ok: true })
})

// ─── PERSONNEL ────────────────────────────────────────────────────────────────
app.get('/personnel', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const { rows } = await pool.query(`
    SELECT p.*, u.nom as created_by_nom
    FROM personnel p
    LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.nom, p.prenom
  `)
  return c.json(rows)
})

app.post('/personnel', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  if (!b.nom || !b.poste || !b.salaire_brut || !b.date_debut) return c.json({ message: 'Champs obligatoires manquants.' }, 422)
  const { rows } = await pool.query(
    `INSERT INTO personnel (nom,prenom,poste,type_contrat,salaire_brut,date_debut,date_fin,statut,notes,contrat_url,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [b.nom, b.prenom || '', b.poste, b.type_contrat || 'CDI', b.salaire_brut, b.date_debut,
     b.date_fin || null, b.statut || 'actif', b.notes || null, b.contrat_url || null, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.put('/personnel/:id', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE personnel SET nom=$1,prenom=$2,poste=$3,type_contrat=$4,salaire_brut=$5,
     date_debut=$6,date_fin=$7,statut=$8,notes=$9,contrat_url=$10,updated_at=NOW()
     WHERE id=$11 RETURNING *`,
    [b.nom, b.prenom || '', b.poste, b.type_contrat, b.salaire_brut,
     b.date_debut, b.date_fin || null, b.statut, b.notes || null, b.contrat_url || null, c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Personnel introuvable.' }, 404)
  return c.json(rows[0])
})

app.delete('/personnel/:id', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  // Supprimer les dépenses en attente de salaire pour ce membre (les validées restent)
  await pool.query(`DELETE FROM depenses WHERE type_source='salaire' AND source_id=$1 AND statut='en_attente'`, [id])
  await pool.query('DELETE FROM personnel WHERE id=$1', [id])
  return c.json({ ok: true })
})

// ─── CONTRATS FIXES ───────────────────────────────────────────────────────────
app.get('/contrats-fixes', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const { rows } = await pool.query('SELECT * FROM contrats_fixes ORDER BY libelle')
  return c.json(rows)
})

app.post('/contrats-fixes', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  if (!b.libelle || !b.beneficiaire || !b.montant || !b.date_debut) return c.json({ message: 'Champs obligatoires manquants.' }, 422)
  const { rows } = await pool.query(
    `INSERT INTO contrats_fixes (libelle,beneficiaire,montant,periodicite,categorie,date_debut,date_fin,statut,description,contrat_url,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [b.libelle, b.beneficiaire, b.montant, b.periodicite || 'mensuelle', b.categorie || 'prestation',
     b.date_debut, b.date_fin || null, b.statut || 'actif', b.description || null, b.contrat_url || null, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.put('/contrats-fixes/:id', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE contrats_fixes SET libelle=$1,beneficiaire=$2,montant=$3,periodicite=$4,categorie=$5,
     date_debut=$6,date_fin=$7,statut=$8,description=$9,contrat_url=$10
     WHERE id=$11 RETURNING *`,
    [b.libelle, b.beneficiaire, b.montant, b.periodicite, b.categorie,
     b.date_debut, b.date_fin || null, b.statut, b.description || null, b.contrat_url || null, c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Contrat introuvable.' }, 404)
  return c.json(rows[0])
})

app.delete('/contrats-fixes/:id', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  // Supprimer les dépenses en attente générées depuis ce contrat (les validées restent pour l'historique)
  await pool.query(`DELETE FROM depenses WHERE type_source='contrat' AND source_id=$1 AND statut='en_attente'`, [id])
  await pool.query('DELETE FROM contrats_fixes WHERE id=$1', [id])
  return c.json({ ok: true })
})

// ─── GÉNÉRATION DÉPENSES DU MOIS ──────────────────────────────────────────────
app.post('/depenses/generer-mois', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const mois = b.mois as string // format 'YYYY-MM'
  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) return c.json({ message: 'Format mois invalide (YYYY-MM).' }, 422)

  const [year, month] = mois.split('-').map(Number)
  const dateDepense = `${mois}-01`

  const generated: unknown[] = []
  const skipped: unknown[] = []

  // 1. Salaires du personnel actif dont le contrat couvre ce mois
  const { rows: personnelActif } = await pool.query(
    `SELECT * FROM personnel WHERE statut='actif'
     AND date_debut <= $1
     AND (date_fin IS NULL OR date_fin >= $2)`,
    [`${mois}-28`, `${mois}-01`]
  )
  for (const p of personnelActif) {
    // Vérifier doublon pour CE personnel CE mois
    const { rows: dup } = await pool.query(
      `SELECT id FROM depenses WHERE type_source='salaire' AND source_id=$1 AND mois_concerne=$2 LIMIT 1`,
      [p.id, mois]
    )
    if (dup.length > 0) { skipped.push({ type: 'salaire', nom: `${p.prenom} ${p.nom}` }); continue }
    const { rows } = await pool.query(
      `INSERT INTO depenses (libelle,montant,categorie,date_depense,statut,mode_paiement,type_source,source_id,mois_concerne,beneficiaire,created_by)
       VALUES ($1,$2,'salaires',$3,'en_attente','virement','salaire',$4,$5,$6,$7) RETURNING *`,
      [`Salaire ${p.prenom} ${p.nom} — ${mois}`, p.salaire_brut, dateDepense, p.id, mois, `${p.prenom} ${p.nom}`, u(c).id]
    )
    generated.push(rows[0])
  }

  // 2. Contrats fixes actifs couvrant ce mois
  const { rows: contratsActifs } = await pool.query(
    `SELECT * FROM contrats_fixes WHERE statut='actif'
     AND date_debut <= $1
     AND (date_fin IS NULL OR date_fin >= $2)`,
    [`${mois}-28`, `${mois}-01`]
  )
  for (const ct of contratsActifs) {
    // Vérifier périodicité
    let doit_generer = false
    if (ct.periodicite === 'mensuelle') {
      doit_generer = true
    } else if (ct.periodicite === 'trimestrielle') {
      const startMonth = new Date(ct.date_debut).getMonth()
      doit_generer = (month - 1 - startMonth) % 3 === 0
    } else if (ct.periodicite === 'annuelle') {
      doit_generer = new Date(ct.date_debut).getMonth() === month - 1
    }
    if (!doit_generer) continue
    // Vérifier doublon pour CE contrat CE mois
    const { rows: dup } = await pool.query(
      `SELECT id FROM depenses WHERE type_source='contrat' AND source_id=$1 AND mois_concerne=$2 LIMIT 1`,
      [ct.id, mois]
    )
    if (dup.length > 0) { skipped.push({ type: 'contrat', libelle: ct.libelle }); continue }
    const { rows } = await pool.query(
      `INSERT INTO depenses (libelle,montant,categorie,date_depense,statut,mode_paiement,type_source,source_id,mois_concerne,beneficiaire,created_by)
       VALUES ($1,$2,$3,$4,'en_attente','virement','contrat',$5,$6,$7,$8) RETURNING *`,
      [ct.libelle + ` — ${mois}`, ct.montant, ct.categorie, dateDepense, ct.id, mois, ct.beneficiaire, u(c).id]
    )
    generated.push(rows[0])
  }

  const msg = generated.length === 0 && skipped.length > 0
    ? `Toutes les charges de ${mois} ont déjà été générées (${skipped.length} élément(s) ignoré(s)).`
    : `${generated.length} charge(s) générée(s) pour ${mois}${skipped.length > 0 ? `, ${skipped.length} déjà existante(s) ignorée(s)` : ''}.`

  return c.json({ generated: generated.length, skipped: skipped.length, message: msg, items: generated })
})

// ─── CALCUL VACATIONS ─────────────────────────────────────────────────────────
app.post('/depenses/calculer-vacations', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const mois = b.mois as string
  const anneeAcademiqueId = b.annee_academique_id ? Number(b.annee_academique_id) : null
  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) return c.json({ message: 'Format mois invalide (YYYY-MM).' }, 422)

  // Vérifier doublons dépenses
  const { rows: existing } = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM depenses WHERE mois_concerne=$1 AND type_source='vacation'`, [mois]
  )
  if (existing[0].cnt > 0) return c.json({ message: `Les vacations de ${mois} ont déjà été transférées en dépenses.`, alreadyGenerated: true }, 409)

  const debutMois = mois + '-01'
  const finMois = new Date(new Date(debutMois).getFullYear(), new Date(debutMois).getMonth() + 1, 0)
    .toISOString().slice(0, 10)

  // ── Étape 1 : calculer les cumuls d'heures depuis les séances effectuées ──
  const { rows: cumuls } = await pool.query(`
    SELECT
      s.enseignant_id,
      e.nom, e.prenom, e.tarif_horaire AS tarif_defaut, e.type_contrat,
      COALESCE(SUM(EXTRACT(EPOCH FROM (s.date_fin - s.date_debut)) / 3600), 0) AS nb_heures,
      COALESCE(
        -- Niveau 1 : MAX tarif parmi toutes les filières (classe normale + tronc commun)
        (
          SELECT MAX(te.montant_horaire)
          FROM tarifs_enseignants te
          WHERE te.montant_horaire > 0
            AND te.type_formation_id IN (
              SELECT f2.type_formation_id
              FROM seances s2
              JOIN classes c2 ON c2.id = s2.classe_id
              JOIN filieres f2 ON f2.id = c2.filiere_id
              WHERE s2.enseignant_id = s.enseignant_id
                AND s2.statut = 'effectue'
                AND s2.date_debut >= $1 AND s2.date_debut <= $2
                AND s2.fi_module_id IS NULL
                AND c2.est_tronc_commun = false
                AND f2.type_formation_id IS NOT NULL
              UNION
              SELECT f3.type_formation_id
              FROM seances s2
              JOIN classes c2 ON c2.id = s2.classe_id AND c2.est_tronc_commun = true
              JOIN classe_tronc_commun ctc ON ctc.tronc_commun_id = c2.id
              JOIN classes c3 ON c3.id = ctc.classe_id
              JOIN filieres f3 ON f3.id = c3.filiere_id
              WHERE s2.enseignant_id = s.enseignant_id
                AND s2.statut = 'effectue'
                AND s2.date_debut >= $1 AND s2.date_debut <= $2
                AND s2.fi_module_id IS NULL
                AND f3.type_formation_id IS NOT NULL
            )
        ),
        -- Niveau 2 : tarif global
        (SELECT MAX(te2.montant_horaire) FROM tarifs_enseignants te2 WHERE te2.montant_horaire > 0),
        -- Niveau 3 : tarif individuel enseignant
        NULLIF(e.tarif_horaire, 0)
      ) AS tarif_resolu
    FROM seances s
    JOIN enseignants e ON e.id = s.enseignant_id
    WHERE s.statut = 'effectue'
      AND s.date_debut >= $1 AND s.date_debut <= $2
      AND s.enseignant_id IS NOT NULL
      AND s.fi_module_id IS NULL
    GROUP BY s.enseignant_id, e.nom, e.prenom, e.tarif_horaire, e.type_contrat
    HAVING SUM(EXTRACT(EPOCH FROM (s.date_fin - s.date_debut)) / 3600) > 0
  `, [debutMois, finMois + ' 23:59:59'])

  if (cumuls.length === 0) {
    return c.json({
      message: `Aucune séance marquée "effectuée" trouvée pour ${mois}. Marquez d'abord les séances comme effectuées dans l'emploi du temps.`,
      generated: 0
    }, 422)
  }

  // ── Étape 2 : UPSERT vacations (INSERT ou UPDATE si en_attente, ignorer si validée/payée) ──
  const vacationIds: number[] = []
  for (const row of cumuls) {
    const tarif = parseFloat(row.tarif_resolu) || parseFloat(row.tarif_defaut) || 0
    const heures = parseFloat(row.nb_heures) || 0
    const { rows: r } = await pool.query(
      `INSERT INTO vacations (enseignant_id, annee_academique_id, mois, nb_heures, tarif_horaire, statut, created_by)
       VALUES ($1, $2, $3, $4, $5, 'en_attente', $6)
       ON CONFLICT (enseignant_id, mois) DO UPDATE SET
         nb_heures    = CASE WHEN vacations.statut = 'en_attente' THEN EXCLUDED.nb_heures     ELSE vacations.nb_heures    END,
         tarif_horaire= CASE WHEN vacations.statut = 'en_attente' THEN EXCLUDED.tarif_horaire  ELSE vacations.tarif_horaire END,
         updated_at   = NOW()
       RETURNING id`,
      [row.enseignant_id, anneeAcademiqueId, mois, heures, tarif, u(c).id]
    )
    if (r[0]) vacationIds.push(r[0].id)
  }

  // ── Étape 3 : auto-valider toutes les vacations en_attente de ce mois ──
  await pool.query(
    `UPDATE vacations SET statut='validee', validated_at=NOW() WHERE id = ANY($1) AND statut='en_attente'`,
    [vacationIds]
  )

  // ── Étape 4 : récupérer les vacations validées et créer les dépenses ──
  const { rows: validees } = await pool.query(`
    SELECT v.id as vacation_id, v.enseignant_id, e.nom, e.prenom, v.nb_heures, v.tarif_horaire, v.montant
    FROM vacations v
    JOIN enseignants e ON e.id = v.enseignant_id
    WHERE v.id = ANY($1) AND v.statut IN ('validee','payee') AND v.montant > 0
  `, [vacationIds])

  const generated: unknown[] = []
  for (const v of validees) {
    const { rows } = await pool.query(
      `INSERT INTO depenses (libelle,montant,categorie,date_depense,statut,mode_paiement,type_source,source_id,mois_concerne,beneficiaire,created_by)
       VALUES ($1,$2,'salaires',$3,'en_attente','especes','vacation',$4,$5,$6,$7) RETURNING *`,
      [
        `Vacations ${v.prenom} ${v.nom} — ${mois} (${Math.round(Number(v.nb_heures) * 10) / 10}h × ${Number(v.tarif_horaire).toLocaleString('fr-FR')} F/h)`,
        Math.round(Number(v.montant)),
        `${mois}-01`, v.enseignant_id, mois, `${v.prenom} ${v.nom}`, u(c).id
      ]
    )
    generated.push(rows[0])
  }

  return c.json({
    generated: generated.length,
    items: generated,
    message: `${generated.length} vacation(s) générée(s) et transférées en dépenses pour ${mois}.`
  })
})

// ─── SEANCES ──────────────────────────────────────────────────────────────────
app.get('/seances', requireAuth, async (c) => {
  const enseignantId = c.req.query('enseignant_id')
  const classeId     = c.req.query('classe_id')
  const conditions: string[] = []
  const params: any[] = []
  if (enseignantId) { conditions.push(`s.enseignant_id = $${params.length + 1}`); params.push(Number(enseignantId)) }
  if (classeId)     { conditions.push(`s.classe_id = $${params.length + 1}`);     params.push(Number(classeId)) }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query(`
    SELECT s.*,
      jsonb_build_object('id',c.id,'nom',c.nom) as classe,
      CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
    FROM seances s
    LEFT JOIN classes c ON s.classe_id = c.id
    LEFT JOIN enseignants i ON s.enseignant_id = i.id
    ${where}
    ORDER BY s.date_debut DESC
  `, params)
  return c.json(rows)
})

const seanceRoles: MiddlewareHandler<Env> = role('dg', 'dir_peda', 'coordinateur', 'secretariat', 'enseignant')

app.post('/seances', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `INSERT INTO seances (classe_id,enseignant_id,matiere,date_debut,date_fin,mode,salle,lien_visio,statut,annee_academique_id,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [b.classe_id, b.enseignant_id || null, b.matiere, b.date_debut, b.date_fin,
     b.mode || 'presentiel', b.salle || null, b.lien_visio || null,
     b.statut || 'planifie', b.annee_academique_id || null, u(c).id]
  )
  return c.json(rows[0], 201)
})

// ── Planification séances pour formation individuelle ────────────────────
app.post('/seances/fi-planifier', requireAuth, seanceRoles, async (c) => {
  try {
  const b = await c.req.json()
  // Accepter jours[] (multi) ou jour (simple) pour rétrocompat
  const jours: number[] = Array.isArray(b.jours) ? b.jours : (b.jour ? [parseInt(b.jour)] : [])
  if (!b.fi_module_id || !b.enseignant_id || jours.length === 0 || !b.heure_debut || !b.heure_fin || !b.date_debut) {
    return c.json({ error: 'Champs requis manquants' }, 400)
  }

  const volumeTotal = parseInt(b.volume_horaire) || 0
  const heuresEffectuees = parseInt(b.heures_effectuees) || 0
  const heuresRestantes = volumeTotal - heuresEffectuees
  if (heuresRestantes <= 0) return c.json({ error: 'Module déjà terminé' }, 400)

  const parts1 = b.heure_debut.split(':')
  const parts2 = b.heure_fin.split(':')
  const dureeSeance = (Number(parts2[0] ?? 0) + Number(parts2[1] ?? 0) / 60) - (Number(parts1[0] ?? 0) + Number(parts1[1] ?? 0) / 60)
  if (dureeSeance <= 0) return c.json({ error: 'Heure fin doit être après heure début' }, 400)

  const nbSeances = Math.ceil(heuresRestantes / dureeSeance)
  const mode = b.mode || 'presentiel'
  const salle = b.salle || null

  // Charger les congés
  let conges: any[] = []
  try {
    const { rows } = await pool.query('SELECT date_debut, date_fin, nom FROM conges_institut')
    conges = rows
  } catch { /* table n'existe peut-être pas */ }

  // Charger les disponibilités du prof
  let dispos: any[] = []
  try {
    const { rows } = await pool.query('SELECT jour, heure_debut, heure_fin FROM disponibilites_enseignant WHERE enseignant_id=$1 AND actif=true', [b.enseignant_id])
    dispos = rows
  } catch { /* table n'existe peut-être pas */ }
  const hasDispos = dispos.length > 0

  // Année académique active
  const { rows: aaRows } = await pool.query("SELECT id FROM annees_academiques WHERE actif=true LIMIT 1")
  const aaId = aaRows[0]?.id || null

  const jourNoms = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']

  // Convertir jours en JS days (1=Lun → getDay()=1, 6=Sam → getDay()=6)
  const jsDays = new Set(jours.map((j: number) => j === 7 ? 0 : j))

  // Groupe série pour lier toutes les séances créées
  const groupeId = crypto.randomUUID()

  // Pas de date_fin : on crée autant de séances que nécessaire pour épuiser les heures
  const startDate = new Date(b.date_debut + 'T00:00:00')
  let current = new Date(startDate)

  let created = 0
  const exclues: { date: string; raison: string }[] = []
  const maxIter = nbSeances * 4 + 200

  for (let iter = 0; created < nbSeances && iter < maxIter; iter++) {
    const dow = current.getDay()
    if (!jsDays.has(dow)) { current.setDate(current.getDate() + 1); continue }

    const dateStr = current.toISOString().slice(0, 10)
    const jourNom = jourNoms[dow] || ''

    // Vérifier congé
    const conge = conges.find((cg: any) => {
      const cd = cg.date_debut?.toString().slice(0, 10)
      const cf = cg.date_fin?.toString().slice(0, 10)
      return dateStr >= cd && dateStr <= cf
    })
    if (conge) {
      exclues.push({ date: `${dateStr} (${jourNom})`, raison: `Congé : ${conge.nom || 'férié'}` })
      current.setDate(current.getDate() + 1); continue
    }

    // Vérifier dispo prof
    if (hasDispos) {
      const profDispo = dispos.some((d: any) => {
        return d.jour === dow && d.heure_debut.toString().slice(0, 5) <= b.heure_debut && d.heure_fin.toString().slice(0, 5) >= b.heure_fin
      })
      if (!profDispo) {
        exclues.push({ date: `${dateStr} (${jourNom})`, raison: 'Prof non disponible' })
        current.setDate(current.getDate() + 1); continue
      }
    }

    // Vérifier conflit prof (même prof, même créneau)
    const { rows: conflitProf } = await pool.query(
      `SELECT id FROM seances WHERE enseignant_id=$1 AND statut != 'annule'
       AND date_debut::date = $2 AND (
         (date_debut::time < $4::time AND date_fin::time > $3::time)
       )`,
      [b.enseignant_id, dateStr, b.heure_debut, b.heure_fin]
    )
    if (conflitProf.length > 0) {
      exclues.push({ date: `${dateStr} (${jourNom})`, raison: 'Conflit horaire du formateur' })
      current.setDate(current.getDate() + 1); continue
    }

    // Créer la séance
    const debut = `${dateStr}T${b.heure_debut}:00`
    const fin = `${dateStr}T${b.heure_fin}:00`
    await pool.query(
      `INSERT INTO seances (enseignant_id, matiere, date_debut, date_fin, mode, salle, statut, annee_academique_id, created_by, fi_module_id, groupe_serie)
       VALUES ($1, $2, $3, $4, $5, $6, 'planifie', $7, $8, $9, $10)`,
      [b.enseignant_id, b.matiere_nom, debut, fin, mode, salle, aaId, u(c).id, b.fi_module_id, groupeId]
    )
    created++
    current.setDate(current.getDate() + 1)
  }

  return c.json({ ok: true, total_crees: created, total_exclues: exclues.length, exclues, groupe_serie: groupeId })
  } catch (err: any) {
    console.error('fi-planifier error:', err)
    return c.json({ error: err?.message || 'Erreur serveur' }, 500)
  }
})

// ── Répétition automatique de séances (exclut congés + vérifie dispo prof) ────
app.post('/seances/repeter', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { classe_id, enseignant_id, matiere, heure_debut, heure_fin, date_debut, date_fin,
          mode, salle, lien_visio, annee_academique_id } = b

  // Accepter `jours` (tableau) ou `jour` (simple) pour rétrocompat
  const joursRaw: number[] = Array.isArray(b.jours) ? b.jours.map(Number) : (b.jour !== undefined ? [Number(b.jour)] : [])

  if (!classe_id || !matiere || !heure_debut || !heure_fin || joursRaw.length === 0 || !date_debut || !date_fin) {
    return c.json({ message: 'Champs requis : classe_id, matiere, heure_debut, heure_fin, jours[], date_debut, date_fin.' }, 422)
  }

  const dStart = new Date(date_debut)
  const dEnd = new Date(date_fin)
  if (dEnd <= dStart) return c.json({ message: 'La date de fin doit être après la date de début.' }, 422)

  // 1. Charger les congés de l'institut pour la période
  const { rows: congesRows } = await pool.query(
    `SELECT date_debut, date_fin FROM conges_institut
     WHERE date_debut <= $2 AND date_fin >= $1`,
    [date_debut, date_fin]
  )

  function isConge(d: Date): boolean {
    const ds = d.toISOString().slice(0, 10)
    return congesRows.some((cg: any) => {
      const cgStart = cg.date_debut.toISOString ? cg.date_debut.toISOString().slice(0, 10) : String(cg.date_debut).slice(0, 10)
      const cgEnd = cg.date_fin.toISOString ? cg.date_fin.toISOString().slice(0, 10) : String(cg.date_fin).slice(0, 10)
      return ds >= cgStart && ds <= cgEnd
    })
  }

  // 2. Charger les disponibilités de l'enseignant (si spécifié)
  let dispos: { jour: number; heure_debut: string; heure_fin: string }[] = []
  if (enseignant_id) {
    const { rows: dispoRows } = await pool.query(
      'SELECT jour, heure_debut::text, heure_fin::text FROM disponibilites_enseignant WHERE enseignant_id=$1 AND actif=true',
      [enseignant_id]
    )
    dispos = dispoRows
  }

  function profDisponible(jourSemaine: number, hDebut: string, hFin: string): boolean {
    if (!enseignant_id || dispos.length === 0) return true // pas de dispo déclarée = toujours dispo
    return dispos.some(d =>
      d.jour === jourSemaine && d.heure_debut <= hDebut && d.heure_fin >= hFin
    )
  }

  // 3. Charger les séances existantes pour détecter les conflits (classe ET prof)
  const { rows: existantesClasse } = await pool.query(
    `SELECT date_debut, date_fin FROM seances
     WHERE classe_id = $1 AND date_debut >= $2 AND date_fin <= $3 AND statut != 'annule'`,
    [classe_id, date_debut, date_fin + 'T23:59:59']
  )
  let existantesProf: any[] = []
  if (enseignant_id) {
    const { rows } = await pool.query(
      `SELECT date_debut, date_fin FROM seances
       WHERE enseignant_id = $1 AND date_debut >= $2 AND date_fin <= $3 AND statut != 'annule'`,
      [enseignant_id, date_debut, date_fin + 'T23:59:59']
    )
    existantesProf = rows
  }

  function hasConflict(dateStr: string, hDebut: string, hFin: string): string | null {
    const newStart = new Date(`${dateStr}T${hDebut}`)
    const newEnd = new Date(`${dateStr}T${hFin}`)
    const classeConflict = existantesClasse.some((s: any) => {
      const sStart = new Date(s.date_debut); const sEnd = new Date(s.date_fin)
      return newStart < sEnd && newEnd > sStart
    })
    if (classeConflict) return 'conflit classe'
    if (enseignant_id) {
      const profConflict = existantesProf.some((s: any) => {
        const sStart = new Date(s.date_debut); const sEnd = new Date(s.date_fin)
        return newStart < sEnd && newEnd > sStart
      })
      if (profConflict) return 'conflit prof (déjà occupé)'
    }
    return null
  }

  // 4. Calculer le volume horaire du module pour savoir quand s'arrêter
  const dureeSeance = (() => {
    const [h1, m1] = heure_debut.split(':').map(Number)
    const [h2, m2] = heure_fin.split(':').map(Number)
    return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60
  })()

  let volumeTotal = 0
  const { rows: ueRows } = await pool.query(
    `SELECT volume_horaire, credits_ects FROM unites_enseignement WHERE classe_id=$1 AND intitule=$2 LIMIT 1`,
    [classe_id, matiere]
  )
  if (ueRows[0]) {
    volumeTotal = parseFloat(ueRows[0].volume_horaire) || parseFloat(ueRows[0].credits_ects) || 0
  }
  if (volumeTotal === 0) {
    const { rows: fmRows } = await pool.query(
      `SELECT fm.credits FROM filiere_matiere fm
       JOIN classes c ON c.filiere_id = fm.filiere_id
       JOIN matieres m ON fm.matiere_id = m.id AND m.nom = $2
       WHERE c.id = $1 LIMIT 1`,
      [classe_id, matiere]
    )
    if (fmRows[0]) volumeTotal = parseFloat(fmRows[0].credits) || 0
  }

  // Heures déjà planifiées pour ce module dans cette classe
  const { rows: existPlanif } = await pool.query(
    `SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (date_fin - date_debut)) / 3600), 0) as heures
     FROM seances WHERE classe_id=$1 AND matiere=$2 AND statut != 'annule'`,
    [classe_id, matiere]
  )
  let heuresCumulees = parseFloat(existPlanif[0]?.heures) || 0

  // 5. Calculer toutes les dates pour tous les jours choisis
  const dates: string[] = []
  const skipped: { date: string; jour: string; raison: string }[] = []

  const cursor = new Date(dStart)
  while (cursor <= dEnd) {
    // S'arrêter si le volume horaire est atteint
    if (volumeTotal > 0 && heuresCumulees >= volumeTotal) break

    const jourSemaine = cursor.getDay()
    if (joursRaw.includes(jourSemaine)) {
      const dateStr = cursor.toISOString().slice(0, 10)
      const jourNom = jourNoms[jourSemaine] || String(jourSemaine)
      if (isConge(cursor)) {
        skipped.push({ date: dateStr, jour: jourNom, raison: 'congé/fête' })
      } else if (!profDisponible(jourSemaine, heure_debut, heure_fin)) {
        skipped.push({ date: dateStr, jour: jourNom, raison: 'prof non disponible' })
      } else {
        const conflict = hasConflict(dateStr, heure_debut, heure_fin)
        if (conflict) {
          skipped.push({ date: dateStr, jour: jourNom, raison: conflict })
        } else {
          dates.push(dateStr)
          heuresCumulees += dureeSeance
        }
      }
    }
    cursor.setDate(cursor.getDate() + 1)
  }

  // 6. Créer les séances en lot avec un groupe_serie commun
  const groupeId = crypto.randomUUID()
  const created: any[] = []
  for (const dateStr of dates) {
    const dDebut = `${dateStr}T${heure_debut}`
    const dFin = `${dateStr}T${heure_fin}`
    const { rows } = await pool.query(
      `INSERT INTO seances (classe_id, enseignant_id, matiere, date_debut, date_fin, mode, salle, lien_visio, statut, annee_academique_id, created_by, groupe_serie)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planifie',$9,$10,$11) RETURNING *`,
      [classe_id, enseignant_id || null, matiere, dDebut, dFin,
       mode || 'presentiel', salle || null, lien_visio || null,
       annee_academique_id || null, u(c).id, groupeId]
    )
    created.push(rows[0])
  }

  return c.json({
    message: `${created.length} séance(s) créée(s), ${skipped.length} date(s) exclue(s).${volumeTotal > 0 ? ` Volume horaire: ${heuresCumulees}/${volumeTotal}h.` : ''}`,
    total_crees: created.length,
    total_exclues: skipped.length,
    groupe_serie: groupeId,
    exclues: skipped,
    seances: created,
    volume_horaire: volumeTotal > 0 ? { total: volumeTotal, planifie: heuresCumulees } : null,
  })
})

// ── Gestion des séries (groupe_serie) ─────────────────────────────────────────
// Lister les séances d'un groupe
app.get('/seances/groupe/:gid', requireAuth, async (c) => {
  const gid = c.req.param('gid')
  const { rows } = await pool.query(`
    SELECT s.*,
      jsonb_build_object('id',c.id,'nom',c.nom) as classe,
      CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
    FROM seances s
    LEFT JOIN classes c ON s.classe_id = c.id
    LEFT JOIN enseignants i ON s.enseignant_id = i.id
    WHERE s.groupe_serie = $1
    ORDER BY s.date_debut
  `, [gid])
  return c.json(rows)
})

// Modifier en lot les séances planifiées d'un groupe (avec filtre date optionnel + redistribution jours)
app.put('/seances/groupe/:gid', requireAuth, seanceRoles, async (c) => {
  const gid = c.req.param('gid')
  const b = await c.req.json()
  const newJours: number[] | undefined = Array.isArray(b.jours) && b.jours.length > 0 ? b.jours.map(Number) : undefined

  // Si on change les jours → supprimer les planifiées (à partir de la date) et recréer
  if (newJours) {
    const aPartirDe = b.a_partir_de || null
    const dateFin = b.date_fin || null

    // Récupérer une séance de référence pour les infos (classe, matière, etc.)
    const { rows: refRows } = await pool.query(
      `SELECT * FROM seances WHERE groupe_serie = $1 ORDER BY date_debut LIMIT 1`, [gid]
    )
    if (!refRows[0]) return c.json({ message: 'Série introuvable.' }, 404)
    const ref = refRows[0]

    // Supprimer les séances planifiées à partir de la date
    let delWhere = `groupe_serie = $1 AND statut = 'planifie'`
    const delParams: any[] = [gid]
    if (aPartirDe) { delWhere += ` AND date_debut >= $2`; delParams.push(aPartirDe) }
    const { rowCount: deleted } = await pool.query(`DELETE FROM seances WHERE ${delWhere}`, delParams)

    // Déterminer la plage de recréation
    const startDate = aPartirDe ? new Date(aPartirDe) : new Date(ref.date_debut)
    let endDate: Date
    if (dateFin) {
      endDate = new Date(dateFin)
    } else {
      // Prendre la dernière séance du groupe
      const { rows: lastRows } = await pool.query(
        `SELECT MAX(date_debut) as last_date FROM seances WHERE groupe_serie = $1`, [gid]
      )
      endDate = lastRows[0]?.last_date ? new Date(lastRows[0].last_date) : new Date(startDate.getTime() + 90 * 86400000)
    }

    // Appliquer les modifications de champs
    const enseignantId = b.enseignant_id !== undefined ? (b.enseignant_id || null) : (ref.enseignant_id || null)
    const matiere = b.matiere !== undefined ? b.matiere : ref.matiere
    const mode = b.mode !== undefined ? b.mode : ref.mode
    const salle = b.salle !== undefined ? (b.salle || null) : ref.salle
    const heureDebut = b.heure_debut || new Date(ref.date_debut).toTimeString().slice(0, 5)
    const heureFin = b.heure_fin || new Date(ref.date_fin).toTimeString().slice(0, 5)

    // Charger congés
    const { rows: congesRows } = await pool.query(
      `SELECT date_debut, date_fin FROM conges_institut WHERE date_debut <= $2 AND date_fin >= $1`,
      [startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)]
    )
    function isConge(d: Date): boolean {
      const ds = d.toISOString().slice(0, 10)
      return congesRows.some((cg: any) => {
        const s = cg.date_debut.toISOString ? cg.date_debut.toISOString().slice(0, 10) : String(cg.date_debut).slice(0, 10)
        const e = cg.date_fin.toISOString ? cg.date_fin.toISOString().slice(0, 10) : String(cg.date_fin).slice(0, 10)
        return ds >= s && ds <= e
      })
    }

    // Calculer le volume horaire du module et les heures déjà couvertes (séances conservées)
    const dureeSeance = (() => {
      const [h1, m1] = heureDebut.split(':').map(Number)
      const [h2, m2] = heureFin.split(':').map(Number)
      return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60
    })()

    // Chercher le volume horaire total du module (UE ou filière_matière)
    let volumeTotal = 0
    const { rows: ueRows } = await pool.query(
      `SELECT volume_horaire, credits_ects FROM unites_enseignement WHERE classe_id=$1 AND intitule=$2 LIMIT 1`,
      [ref.classe_id, matiere]
    )
    if (ueRows[0]) {
      volumeTotal = parseFloat(ueRows[0].volume_horaire) || parseFloat(ueRows[0].credits_ects) || 0
    }
    if (volumeTotal === 0) {
      const { rows: fmRows } = await pool.query(
        `SELECT fm.credits FROM filiere_matiere fm
         JOIN classes c ON c.filiere_id = fm.filiere_id
         JOIN matieres m ON fm.matiere_id = m.id AND m.nom = $2
         WHERE c.id = $1 LIMIT 1`,
        [ref.classe_id, matiere]
      )
      if (fmRows[0]) volumeTotal = parseFloat(fmRows[0].credits) || 0
    }

    // Heures déjà couvertes par les séances conservées (non supprimées) du groupe
    const { rows: kept } = await pool.query(
      `SELECT date_debut, date_fin FROM seances WHERE groupe_serie=$1 AND statut != 'annule'`, [gid]
    )
    let heuresDejaFaites = kept.reduce((acc: number, s: any) => {
      return acc + (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 3600000
    }, 0)

    // Créer les nouvelles séances — s'arrêter quand le volume est atteint
    const created: any[] = []
    const cursor = new Date(startDate)
    while (cursor <= endDate) {
      // Vérifier si le volume horaire est atteint
      if (volumeTotal > 0 && heuresDejaFaites >= volumeTotal) break

      if (newJours.includes(cursor.getDay()) && !isConge(cursor)) {
        const dateStr = cursor.toISOString().slice(0, 10)
        const { rows } = await pool.query(
          `INSERT INTO seances (classe_id, enseignant_id, matiere, date_debut, date_fin, mode, salle, lien_visio, statut, annee_academique_id, created_by, groupe_serie)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'planifie',$9,$10,$11) RETURNING *`,
          [ref.classe_id, enseignantId, matiere, `${dateStr}T${heureDebut}`, `${dateStr}T${heureFin}`,
           mode, salle, ref.lien_visio, ref.annee_academique_id, u(c).id, gid]
        )
        created.push(rows[0])
        heuresDejaFaites += dureeSeance
      }
      cursor.setDate(cursor.getDate() + 1)
    }

    return c.json({
      message: `${deleted} séance(s) supprimée(s), ${created.length} séance(s) recréée(s).`,
      supprimees: deleted, creees: created.length, seances: created
    })
  }

  // Pas de changement de jours → modification simple
  const sets: string[] = []
  const params: any[] = []
  let idx = 1

  if (b.enseignant_id !== undefined) { sets.push(`enseignant_id=$${idx++}`); params.push(b.enseignant_id || null) }
  if (b.matiere !== undefined) { sets.push(`matiere=$${idx++}`); params.push(b.matiere) }
  if (b.mode !== undefined) { sets.push(`mode=$${idx++}`); params.push(b.mode) }
  if (b.salle !== undefined) { sets.push(`salle=$${idx++}`); params.push(b.salle || null) }
  if (b.lien_visio !== undefined) { sets.push(`lien_visio=$${idx++}`); params.push(b.lien_visio || null) }

  if (b.heure_debut && b.heure_fin) {
    sets.push(`date_debut = date_trunc('day', date_debut) + $${idx++}::interval`)
    params.push(b.heure_debut + ':00')
    sets.push(`date_fin = date_trunc('day', date_fin) + $${idx++}::interval`)
    params.push(b.heure_fin + ':00')
  }

  if (sets.length === 0) return c.json({ message: 'Rien à modifier.' }, 422)

  let where = `groupe_serie = $${idx++} AND statut = 'planifie'`
  params.push(gid)
  if (b.a_partir_de) {
    where += ` AND date_debut >= $${idx++}`
    params.push(b.a_partir_de)
  }

  const { rows } = await pool.query(
    `UPDATE seances SET ${sets.join(', ')} WHERE ${where} RETURNING *`,
    params
  )
  return c.json({ message: `${rows.length} séance(s) modifiée(s).`, total: rows.length, seances: rows })
})

// Supprimer les séances planifiées d'un groupe (avec filtre date optionnel)
app.delete('/seances/groupe/:gid', requireAuth, seanceRoles, async (c) => {
  const gid = c.req.param('gid')
  const aPartirDe = c.req.query('a_partir_de')
  let where = `groupe_serie = $1 AND statut = 'planifie'`
  const params: any[] = [gid]
  if (aPartirDe) {
    where += ` AND date_debut >= $2`
    params.push(aPartirDe)
  }
  const { rowCount } = await pool.query(`DELETE FROM seances WHERE ${where}`, params)
  return c.json({ message: `${rowCount} séance(s) supprimée(s).`, total: rowCount })
})

app.put('/seances/:id', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE seances SET classe_id=$1,enseignant_id=$2,matiere=$3,date_debut=$4,date_fin=$5,mode=$6,salle=$7,lien_visio=$8 WHERE id=$9 RETURNING *',
    [b.classe_id, b.enseignant_id || null, b.matiere, b.date_debut, b.date_fin, b.mode || 'presentiel', b.salle || null, b.lien_visio || null, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/seances/:id', requireAuth, seanceRoles, async (c) => {
  await pool.query('DELETE FROM seances WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

app.post('/seances/:id/annuler', requireAuth, seanceRoles, async (c) => {
  const { rows } = await pool.query("UPDATE seances SET statut='annule' WHERE id=$1 RETURNING *", [c.req.param('id')])
  return c.json(rows[0])
})

// ── Récupérer l'étudiant d'une séance FI (pour l'émargement) ─────────────
app.get('/seances/:id/fi-etudiant', requireAuth, async (c) => {
  const seanceId = c.req.param('id')
  // Récupérer fi_module_id de la séance
  const { rows: sRows } = await pool.query('SELECT fi_module_id FROM seances WHERE id=$1', [seanceId])
  const fiModuleId = sRows[0]?.fi_module_id
  if (!fiModuleId) return c.json({ error: 'Pas une séance individuelle' }, 400)

  // Récupérer l'étudiant via fi_modules → formations_individuelles → etudiants
  const { rows } = await pool.query(`
    SELECT e.id as etudiant_id, e.nom, e.prenom, e.numero_etudiant,
           fi.id as formation_individuelle_id,
           fm.id as fi_module_id, fm.matiere_id,
           m.nom as matiere_nom
    FROM fi_modules fm
    JOIN formations_individuelles fi ON fm.formation_individuelle_id = fi.id
    JOIN etudiants e ON fi.etudiant_id = e.id
    LEFT JOIN matieres m ON fm.matiere_id = m.id
    WHERE fm.id = $1
  `, [fiModuleId])

  if (!rows[0]) return c.json({ error: 'Module FI introuvable' }, 404)

  const etu = rows[0]
  // Chercher si cet étudiant a une inscription (pour réutiliser l'inscription_id dans les présences)
  const { rows: inscRows } = await pool.query(
    `SELECT id FROM inscriptions WHERE etudiant_id=$1 ORDER BY id DESC LIMIT 1`,
    [etu.etudiant_id]
  )

  let inscriptionId: number
  if (inscRows[0]) {
    inscriptionId = inscRows[0].id
  } else {
    // Créer une inscription pour l'étudiant FI (nécessaire pour la FK presences.inscription_id)
    const aaId = etu.formation_individuelle_id
      ? (await pool.query('SELECT annee_academique_id FROM formations_individuelles WHERE id=$1', [etu.formation_individuelle_id])).rows[0]?.annee_academique_id
      : null
    const { rows: newInsc } = await pool.query(
      `INSERT INTO inscriptions (etudiant_id, annee_academique_id, statut, created_by)
       VALUES ($1, $2, 'inscrit_actif', $3) RETURNING id`,
      [etu.etudiant_id, aaId, u(c).id]
    )
    inscriptionId = newInsc[0].id
  }

  return c.json([{
    id: inscriptionId,
    etudiant: { nom: etu.nom, prenom: etu.prenom, numero_etudiant: etu.numero_etudiant },
    fi_module: { id: etu.fi_module_id, matiere: etu.matiere_nom },
    is_fi: true
  }])
})

// Émargement complet : contenu + signature enseignant + clôture séance
app.post('/seances/:id/emarger', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { contenu_seance, objectifs, chapitre, objectifs_atteints, remarques, presences, enseignant_id } = b
  const id = c.req.param('id')

  // 0. Vérifier que la séance a bien commencé (contrôle temporel strict)
  const { rows: seanceInfo } = await pool.query('SELECT date_debut FROM seances WHERE id=$1', [id])
  if (!seanceInfo[0]) return c.json({ error: 'Séance introuvable' }, 404)
  if (new Date(seanceInfo[0].date_debut) > new Date()) {
    return c.json({ error: 'Émargement impossible : la séance n\'a pas encore commencé.' }, 403)
  }

  // 1. Sauvegarder contenu + signer + passer en effectue
  const { rows } = await pool.query(
    `UPDATE seances SET
      contenu_seance=$1, objectifs=$2, chapitre=$3, objectifs_atteints=$4, remarques=$5,
      statut='effectue', signe_enseignant_at=NOW(), signe_enseignant_id=$6
     WHERE id=$7 RETURNING *`,
    [contenu_seance || null, objectifs || null, chapitre || null, objectifs_atteints || null, remarques || null, enseignant_id || null, id]
  )

  // 2. Sauvegarder les présences
  if (Array.isArray(presences)) {
    for (const p of presences) {
      await pool.query(
        `INSERT INTO presences (seance_id, inscription_id, statut, heure_arrivee, created_by)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (seance_id, inscription_id) DO UPDATE SET statut=$3, heure_arrivee=$4`,
        [id, p.inscription_id, p.statut || 'absent', p.heure_arrivee || null, u(c).id]
      )
    }
  }

  // 3. Si séance FI → mettre à jour heures_effectuees du module
  const seance = rows[0]
  if (seance?.fi_module_id) {
    const dureeH = (new Date(seance.date_fin).getTime() - new Date(seance.date_debut).getTime()) / 3600000
    await pool.query(
      `UPDATE fi_modules SET heures_effectuees = LEAST(volume_horaire,
        (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (s.date_fin - s.date_debut))/3600),0)::int
         FROM seances s WHERE s.fi_module_id = $1 AND s.statut = 'effectue'))
       WHERE id = $1`,
      [seance.fi_module_id]
    )
  }

  return c.json(rows[0])
})

// Sauvegarder le contenu sans clôturer
app.post('/seances/:id/contenu', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE seances SET contenu_seance=$1, objectifs=$2, chapitre=$3, objectifs_atteints=$4, remarques=$5 WHERE id=$6 RETURNING *`,
    [b.contenu_seance || null, b.objectifs || null, b.chapitre || null, b.objectifs_atteints || null, b.remarques || null, c.req.param('id')]
  )
  return c.json(rows[0])
})

// ─── CAHIER DE TEXTES ────────────────────────────────────────────────────────
app.get('/cahier-de-textes', requireAuth, async (c) => {
  const { enseignant_id, matiere, debut, fin, annee_academique_id } = c.req.query()
  const params: any[] = []
  const filters: string[] = [`s.statut = 'effectue'`, `s.signe_enseignant_at IS NOT NULL`]

  if (enseignant_id) { params.push(enseignant_id); filters.push(`s.signe_enseignant_id = $${params.length}`) }
  if (matiere) { params.push(`%${matiere}%`); filters.push(`s.matiere ILIKE $${params.length}`) }
  if (debut) { params.push(debut); filters.push(`s.date_debut >= $${params.length}::date`) }
  if (fin) { params.push(fin); filters.push(`s.date_debut <= $${params.length}::date + interval '1 day'`) }
  if (annee_academique_id) { params.push(annee_academique_id); filters.push(`s.annee_academique_id = $${params.length}`) }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const { rows: seances } = await pool.query(`
    SELECT
      s.id, s.matiere, s.date_debut, s.date_fin, s.salle, s.mode,
      s.chapitre, s.objectifs, s.objectifs_atteints, s.contenu_seance, s.remarques,
      s.signe_enseignant_at,
      EXTRACT(EPOCH FROM (s.date_fin - s.date_debut))/3600 AS heures,
      jsonb_build_object('id', e.id, 'nom', e.nom, 'prenom', e.prenom) AS enseignant,
      CASE WHEN cl.id IS NOT NULL THEN jsonb_build_object('id', cl.id, 'nom', cl.nom) ELSE NULL END AS classe,
      (SELECT COUNT(*) FROM presences p WHERE p.seance_id = s.id AND p.statut = 'present')::int AS nb_presents,
      (SELECT COUNT(*) FROM presences p WHERE p.seance_id = s.id)::int AS nb_total
    FROM seances s
    LEFT JOIN enseignants e ON s.signe_enseignant_id = e.id
    LEFT JOIN classes cl ON s.classe_id = cl.id
    ${where}
    ORDER BY s.date_debut DESC
    LIMIT 500
  `, params)

  // Enseignants distincts pour le filtre
  const { rows: enseignants } = await pool.query(`
    SELECT DISTINCT e.id, e.nom, e.prenom
    FROM seances s JOIN enseignants e ON s.signe_enseignant_id = e.id
    WHERE s.statut = 'effectue' AND s.signe_enseignant_at IS NOT NULL
    ORDER BY e.nom, e.prenom
  `)

  return c.json({ seances, enseignants })
})

// ─── FICHE DE NOTES IMPRIMABLE ───────────────────────────────────────────────
// Retourne les données pour générer la fiche PDF d'une UE pour une classe
app.get('/fiches-notes', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const classeId = parseInt(c.req.query('classe_id') || '0')
  const ueId     = parseInt(c.req.query('ue_id')     || '0')
  const session  = c.req.query('session') || 'normale'
  const anneeId  = c.req.query('annee_id') ? parseInt(c.req.query('annee_id')!) : null

  if (!classeId || !ueId) return c.json({ error: 'classe_id et ue_id requis' }, 400)

  // Infos classe
  const { rows: clRows } = await pool.query(`
    SELECT cl.nom AS classe_nom, cl.niveau,
      f.nom AS filiere_nom,
      a.libelle AS annee_libelle, a.id AS annee_id
    FROM classes cl
    LEFT JOIN filieres f ON f.id = cl.filiere_id
    LEFT JOIN annees_academiques a ON a.id = cl.annee_academique_id
    WHERE cl.id = $1
  `, [classeId])
  const classe = clRows[0] ?? {}

  // Infos UE + enseignant
  const { rows: ueRows } = await pool.query(`
    SELECT ue.id, ue.code, ue.intitule_ue, ue.intitule, ue.volume_horaire,
      ue.cm, ue.td, ue.tp, ue.credits_ects, ue.coefficient,
      ue.enseignant_id,
      e.nom AS ens_nom, e.prenom AS ens_prenom, e.specialite AS ens_specialite
    FROM unites_enseignement ue
    LEFT JOIN enseignants e ON e.id = ue.enseignant_id
    WHERE ue.id = $1
  `, [ueId])
  const ue = ueRows[0] ?? {}

  // Séances effectuées de cet enseignant dans cette classe (= séances de la matière)
  const anneeFilter = anneeId ? `AND s.annee_academique_id = ${anneeId}` : ''
  const { rows: seancesRows } = await pool.query(`
    SELECT s.id AS seance_id
    FROM seances s
    WHERE s.classe_id = $1
      AND s.enseignant_id = $2
      AND s.statut = 'effectue'
      ${anneeFilter}
  `, [classeId, ue.enseignant_id ?? 0])
  const seanceIds = seancesRows.map((r: any) => r.seance_id)
  const totalSeances = seanceIds.length

  // Étudiants inscrits + présences
  const { rows: etudiants } = await pool.query(`
    SELECT i.id AS inscription_id,
      e.nom, e.prenom, e.numero_etudiant,
      COUNT(CASE WHEN pr.statut IN ('present','retard') THEN 1 END)::int AS nb_presences,
      COUNT(CASE WHEN pr.statut = 'absent'              THEN 1 END)::int AS nb_absences
    FROM inscriptions i
    JOIN etudiants e ON e.id = i.etudiant_id
    LEFT JOIN presences pr ON pr.inscription_id = i.id
      AND pr.seance_id = ANY($2::int[])
    WHERE i.classe_id = $1
      AND i.statut IN ('inscrit_actif','pre_inscrit')
    GROUP BY i.id, e.nom, e.prenom, e.numero_etudiant
    ORDER BY e.nom, e.prenom
  `, [classeId, seanceIds.length ? seanceIds : [0]])

  // Paramètres établissement
  const { rows: params } = await pool.query(
    `SELECT cle, valeur FROM parametres_systeme WHERE cle IN ('nom_etablissement','adresse','telephone')`
  ).catch(() => ({ rows: [] }))
  const paramsMap: Record<string, string> = {}
  for (const p of params) paramsMap[p.cle] = p.valeur

  return c.json({
    classe: { ...classe, id: classeId },
    ue,
    session,
    annee_libelle: classe.annee_libelle ?? '',
    total_seances: totalSeances,
    etudiants,
    params: paramsMap,
    generated_at: new Date().toISOString(),
  })
})

app.get('/seances/:id/presences', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT pr.*, jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom) as etudiant
    FROM presences pr
    LEFT JOIN inscriptions i ON pr.inscription_id = i.id
    LEFT JOIN etudiants e ON i.etudiant_id = e.id
    WHERE pr.seance_id=$1
  `, [c.req.param('id')])
  return c.json(rows)
})

app.post('/seances/:id/presences', requireAuth, seanceRoles, async (c) => {
  const body = await c.req.json()
  const presences = Array.isArray(body) ? body : (body.presences || []) as Array<{ inscription_id: number; statut?: string; heure_arrivee?: string }>
  for (const p of presences) {
    await pool.query(
      `INSERT INTO presences (seance_id,inscription_id,statut,heure_arrivee,created_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (seance_id,inscription_id) DO UPDATE SET statut=$3,heure_arrivee=$4`,
      [c.req.param('id'), p.inscription_id, p.statut || 'present', p.heure_arrivee || null, u(c).id]
    )
  }
  return c.json({ message: 'Présences enregistrées.' })
})

// ─── IMPORT MAQUETTE ──────────────────────────────────────────────────────────
// Importe une maquette pédagogique (UEs + ECs) pour une filière
// Crée automatiquement les matières, filiere_matiere, et optionnellement les UEs pour une classe
app.post('/filieres/:id/maquette', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const filiereId = parseInt(c.req.param('id'))
  const b = await c.req.json()
  // b.semestres = [{ numero: 1, ues: [{ code, intitule_ue, categorie, credits_ue, ecs: [{ intitule, cm, td, tp, tpe, vht, coefficient }] }] }]
  // b.classe_id (optionnel) — si fourni, génère aussi les UEs pour cette classe
  const { semestres, classe_id } = b
  if (!semestres || !Array.isArray(semestres)) return c.json({ error: 'Format: { semestres: [...] }' }, 400)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    let totalMatieres = 0, totalFM = 0, totalUEs = 0
    let ordreGlobal = 0

    for (const sem of semestres) {
      const semNum = sem.numero || 1
      for (const ue of (sem.ues || [])) {
        const codeUe = ue.code || ''
        const intituleUe = ue.intitule_ue || ''
        const categorie = ue.categorie || 'majeure'
        const creditsUe = ue.credits_ue || 0

        for (const ec of (ue.ecs || [])) {
          ordreGlobal++
          const ecNom = ec.intitule || ec.nom || ''
          const cm = ec.cm || 0, td = ec.td || 0, tp = ec.tp || 0, tpe = ec.tpe || 0
          const vht = ec.vht || (cm + td + tp + tpe)
          const coeff = ec.coefficient ?? 1
          const creditsEc = Math.round(vht / 20 * 10) / 10 // 20h = 1 crédit

          // 1. Créer la matière si elle n'existe pas
          const codeMatiere = codeUe + '-' + String(ordreGlobal).padStart(2, '0')
          const { rows: existMat } = await client.query(
            `SELECT id FROM matieres WHERE nom = $1 LIMIT 1`, [ecNom]
          )
          let matiereId: number
          if (existMat[0]) {
            matiereId = existMat[0].id
          } else {
            const { rows: newMat } = await client.query(
              `INSERT INTO matieres (nom, code, actif) VALUES ($1, $2, true) RETURNING id`,
              [ecNom, codeMatiere]
            )
            matiereId = newMat[0].id
            totalMatieres++
          }

          // 2. Créer/mettre à jour filiere_matiere (template de la maquette)
          await client.query(
            `INSERT INTO filiere_matiere (filiere_id, matiere_id, coefficient, credits, ordre, semestre, categorie_ue, code_ue, intitule_ue, cm, td, tp, tpe, vht)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (filiere_id, matiere_id) DO UPDATE SET
               coefficient = EXCLUDED.coefficient, credits = EXCLUDED.credits, ordre = EXCLUDED.ordre,
               semestre = EXCLUDED.semestre, categorie_ue = EXCLUDED.categorie_ue, code_ue = EXCLUDED.code_ue,
               intitule_ue = EXCLUDED.intitule_ue, cm = EXCLUDED.cm, td = EXCLUDED.td, tp = EXCLUDED.tp,
               tpe = EXCLUDED.tpe, vht = EXCLUDED.vht`,
            [filiereId, matiereId, coeff, creditsEc, ordreGlobal, semNum, categorie, codeUe, intituleUe, cm, td, tp, tpe, vht]
          )
          totalFM++

          // 3. Si classe_id fourni, créer aussi les UEs
          if (classe_id) {
            await client.query(
              `INSERT INTO unites_enseignement (classe_id, code, intitule, intitule_ue, coefficient, credits_ects, volume_horaire, ordre, matiere_id, semestre, categorie_ue, cm, td, tp, tpe)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
              [classe_id, codeUe, ecNom, intituleUe, coeff, creditsEc, vht, ordreGlobal, matiereId, semNum, categorie, cm, td, tp, tpe]
            )
            totalUEs++
          }
        }
      }
    }

    await client.query('COMMIT')
    return c.json({
      message: `Import réussi: ${totalMatieres} matière(s) créée(s), ${totalFM} entrée(s) filiere_matiere, ${totalUEs} UE(s) générée(s).`,
      total_matieres: totalMatieres,
      total_filiere_matiere: totalFM,
      total_ues: totalUEs,
    })
  } catch (e: any) {
    await client.query('ROLLBACK')
    return c.json({ error: e.message }, 500)
  } finally {
    client.release()
  }
})

// Générer les UEs pour une classe à partir de la maquette de sa filière
app.post('/classes/:id/generer-ues', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const classeId = parseInt(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))
  const { rows: classeRows } = await pool.query('SELECT filiere_id, est_tronc_commun, niveau FROM classes WHERE id=$1', [classeId])
  const classe = classeRows[0]
  if (!classe) return c.json({ error: 'Classe introuvable' }, 404)

  // Plage de semestres correspondant au niveau de la classe
  // niveau 1 → S1,S2 | niveau 2 → S3,S4 | niveau 3 → S5,S6 | etc.
  const niveauClasse: number = classe.niveau || 1
  const semMin = niveauClasse * 2 - 1
  const semMax = niveauClasse * 2

  let fm: any[] = []

  if (classe.est_tronc_commun) {
    // Tronc commun : générer depuis les matiere_ids sélectionnés
    const matiereIds: number[] = b.matiere_ids
    if (!matiereIds || matiereIds.length === 0) return c.json({ error: 'Sélectionnez au moins une matière' }, 400)

    // Charger les infos depuis filiere_matiere (prendre la première entrée trouvée par matière)
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (fm.matiere_id) fm.*, m.nom as matiere_nom
       FROM filiere_matiere fm
       JOIN matieres m ON fm.matiere_id = m.id
       WHERE fm.matiere_id = ANY($1::int[])
       ORDER BY fm.matiere_id, fm.ordre`, [matiereIds]
    )
    fm = rows
  } else {
    // Classe normale : générer UNIQUEMENT les UEs des semestres correspondant au niveau
    if (!classe.filiere_id) return c.json({ error: 'Classe sans filière' }, 400)
    const { rows } = await pool.query(
      `SELECT fm.*, m.nom as matiere_nom FROM filiere_matiere fm
       JOIN matieres m ON fm.matiere_id = m.id
       WHERE fm.filiere_id = $1 AND fm.semestre BETWEEN $2 AND $3
       ORDER BY fm.ordre`, [classe.filiere_id, semMin, semMax]
    )
    fm = rows
  }

  if (fm.length === 0) return c.json({ error: `Aucune maquette trouvée pour le niveau ${niveauClasse} (S${semMin}–S${semMax}). Vérifiez que la maquette filière a des matières avec les bons numéros de semestre.` }, 400)

  // ── Nettoyage : supprimer les UEs hors plage de semestre pour cette classe ──
  // Cas typique : ancienne génération avait copié S1+S2+S3+S4 dans une classe niveau 2
  // On supprime celles dont la filière_matiere dit qu'elles n'appartiennent PAS à S3-S4
  // Sécurité : on ne supprime que les UEs sans notes saisies
  if (!classe.est_tronc_commun && classe.filiere_id) {
    await pool.query(`
      DELETE FROM unites_enseignement
      WHERE classe_id = $1
        AND matiere_id IS NOT NULL
        AND matiere_id IN (
          SELECT matiere_id FROM filiere_matiere
          WHERE filiere_id = $2
            AND semestre NOT BETWEEN $3 AND $4
        )
        AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.ue_id = unites_enseignement.id)
    `, [classeId, classe.filiere_id, semMin, semMax])
  }

  let added = 0, updated = 0
  for (const entry of fm) {
    if (!entry.matiere_id) continue
    // UPSERT : si (classe_id, matiere_id) existe déjà → mettre à jour semestre/volumes SANS toucher à enseignant_id
    // L'index unique ue_classe_matiere_unique_idx garantit l'idempotence
    const { rows: r } = await pool.query(
      `INSERT INTO unites_enseignement
         (classe_id, code, intitule, intitule_ue, coefficient, credits_ects, volume_horaire, ordre, matiere_id, semestre, categorie_ue, cm, td, tp, tpe)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (classe_id, matiere_id) WHERE matiere_id IS NOT NULL
       DO UPDATE SET
         code         = EXCLUDED.code,
         intitule     = EXCLUDED.intitule,
         intitule_ue  = EXCLUDED.intitule_ue,
         coefficient  = EXCLUDED.coefficient,
         credits_ects = EXCLUDED.credits_ects,
         volume_horaire = EXCLUDED.volume_horaire,
         ordre        = EXCLUDED.ordre,
         semestre     = EXCLUDED.semestre,
         categorie_ue = EXCLUDED.categorie_ue,
         cm = EXCLUDED.cm, td = EXCLUDED.td, tp = EXCLUDED.tp, tpe = EXCLUDED.tpe
       RETURNING (xmax = 0) AS inserted`,
      [classeId, entry.code_ue || 'UE', entry.matiere_nom, entry.intitule_ue || '',
       entry.coefficient || 0, entry.credits || 0, entry.vht || 0, entry.ordre || 0,
       entry.matiere_id, entry.semestre || 1, entry.categorie_ue,
       entry.cm || 0, entry.td || 0, entry.tp || 0, entry.tpe || 0]
    )
    r[0]?.inserted ? added++ : updated++
  }

  return c.json({ message: `${added} ajoutée(s), ${updated} mise(s) à jour — Niveau ${niveauClasse} (S${semMin}–S${semMax}).`, total: added + updated })
})

// Nettoyer les doublons d'UEs dans une classe (même matiere_id)
app.post('/classes/:id/nettoyer-doublons', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const classeId = parseInt(c.req.param('id'))

  // Récupérer toutes les UEs de la classe groupées par matiere_id
  const { rows: ues } = await pool.query(
    `SELECT id, matiere_id, enseignant_id, intitule, code
     FROM unites_enseignement
     WHERE classe_id = $1 AND matiere_id IS NOT NULL
     ORDER BY matiere_id, enseignant_id DESC NULLS LAST, id ASC`,
    [classeId]
  )

  // Grouper par matiere_id
  const byMatiere: Record<number, any[]> = {}
  for (const ue of ues) {
    if (!byMatiere[ue.matiere_id]) byMatiere[ue.matiere_id] = []
    byMatiere[ue.matiere_id].push(ue)
  }

  let supprimees = 0
  for (const [, groupe] of Object.entries(byMatiere)) {
    if (groupe.length <= 1) continue
    // Garder la première (celle avec enseignant si possible, sinon la plus ancienne)
    const [garder, ...supprimer] = groupe
    for (const ue of supprimer) {
      // Transférer notes sur l'UE conservée avant suppression (contrainte FK notes.ue_id)
      await pool.query('UPDATE notes SET ue_id=$1 WHERE ue_id=$2', [garder.id, ue.id])
      await pool.query('DELETE FROM unites_enseignement WHERE id=$1', [ue.id])
      supprimees++
    }
  }

  return c.json({ supprimees, message: `${supprimees} doublon(s) supprimé(s).` })
})

// Matières disponibles pour un tronc commun (union des maquettes des filières rattachées)
app.get('/classes/:id/maquette-tc', requireAuth, async (c) => {
  const classeId = c.req.param('id')
  // Trouver les filières des classes rattachées à ce tronc commun
  const { rows: linkedClasses } = await pool.query(
    `SELECT DISTINCT c.filiere_id, f.nom as filiere_nom
     FROM classes c JOIN filieres f ON c.filiere_id = f.id
     WHERE c.id IN (SELECT ctc.classe_id FROM classe_tronc_commun ctc WHERE ctc.tronc_commun_id = $1) AND c.filiere_id IS NOT NULL`, [classeId]
  )
  if (linkedClasses.length === 0) return c.json({ filieres: [], matieres: [] })

  const filiereIds = linkedClasses.map((r: any) => r.filiere_id)

  // Charger toutes les matières de ces filières
  const { rows: entries } = await pool.query(
    `SELECT fm.*, m.nom as matiere_nom, m.code as matiere_code, f.nom as filiere_nom
     FROM filiere_matiere fm
     JOIN matieres m ON fm.matiere_id = m.id
     JOIN filieres f ON fm.filiere_id = f.id
     WHERE fm.filiere_id = ANY($1::int[])
     ORDER BY fm.semestre, fm.ordre`, [filiereIds]
  )

  // Dédupliquer par matiere_id et marquer les filières qui l'ont
  const matiereMap: Record<number, any> = {}
  for (const e of entries) {
    const mid = e.matiere_id
    if (!matiereMap[mid]) {
      matiereMap[mid] = {
        matiere_id: mid, intitule: e.matiere_nom, code_ue: e.code_ue, intitule_ue: e.intitule_ue,
        semestre: e.semestre, categorie_ue: e.categorie_ue, coefficient: parseFloat(e.coefficient),
        credits: e.credits, vht: e.vht, cm: e.cm, td: e.td, tp: e.tp, tpe: e.tpe,
        filieres: []
      }
    }
    matiereMap[mid].filieres.push(e.filiere_nom)
  }

  return c.json({
    filieres: linkedClasses,
    matieres: Object.values(matiereMap)
  })
})

// Mise à jour rapide de la date de début des cours
app.patch('/classes/:id/date-debut-cours', requireAuth, role('dg', 'coordinateur', 'resp_fin'), async (c) => {
  const classeId = parseInt(c.req.param('id'))
  const { date_debut_cours } = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE classes SET date_debut_cours = $1 WHERE id = $2 RETURNING id, nom, date_debut_cours',
    [date_debut_cours || null, classeId]
  )
  if (!rows[0]) return c.json({ error: 'Classe introuvable' }, 404)
  return c.json(rows[0])
})

// ─── SUIVI PAIEMENTS PAR CLASSE ─────────────────────────────────────────────
// Logique d'ancre : date_référence = MAX(date_inscription, date_début_cours)
app.get('/classes/:id/suivi-paiements', requireAuth, async (c) => {
  const classeId = parseInt(c.req.param('id'))
  const moisControle = c.req.query('mois_controle') || new Date().toISOString().slice(0, 7) // YYYY-MM

  // Récupérer la classe avec date_debut_cours et la filière
  const { rows: classeRows } = await pool.query(
    `SELECT c.*, f.mensualite, f.frais_inscription, f.duree_mois, f.montant_tenue, f.nom as filiere_nom
     FROM classes c LEFT JOIN filieres f ON c.filiere_id = f.id WHERE c.id = $1`, [classeId]
  )
  if (!classeRows[0]) return c.json({ error: 'Classe introuvable' }, 404)
  const classe = classeRows[0]
  const dateDebutCours = classe.date_debut_cours ? new Date(classe.date_debut_cours) : null
  const nbMensualites = classe.duree_mois || 9

  // Récupérer les inscriptions avec paiements
  const { rows: inscriptions } = await pool.query(`
    SELECT i.id, i.etudiant_id, i.mois_debut, i.created_at, i.mensualite as insc_mensualite, i.statut,
      e.nom, e.prenom, e.numero_etudiant, e.telephone, e.email,
      (SELECT COALESCE(SUM(p.montant), 0) FROM paiements p WHERE p.inscription_id = i.id AND p.statut = 'confirme') as total_paye,
      (SELECT COALESCE(SUM(p.montant), 0) FROM paiements p WHERE p.inscription_id = i.id AND p.statut = 'confirme' AND p.type_paiement = 'frais_inscription') as frais_insc_payes,
      (SELECT COALESCE(SUM(p.montant), 0) FROM paiements p WHERE p.inscription_id = i.id AND p.statut = 'confirme' AND p.type_paiement = 'mensualite') as mensualites_payees_montant,
      (SELECT COUNT(*) FROM echeances ec WHERE ec.inscription_id = i.id AND ec.type_echeance = 'mensualite' AND ec.statut IN ('paye', 'partiellement_paye')) as nb_mens_payees
    FROM inscriptions i
    JOIN etudiants e ON i.etudiant_id = e.id
    WHERE i.classe_id = $1 AND i.statut NOT IN ('abandonne', 'suspendu')
    ORDER BY e.nom, e.prenom
  `, [classeId])

  // Forcer UTC pour éviter les décalages de timezone
  const [ctrlY, ctrlM] = moisControle.split('-').map(Number)
  const mensualiteFiliere = parseFloat(classe.mensualite) || 0
  const ddcY = dateDebutCours ? dateDebutCours.getUTCFullYear() : 0
  const ddcM = dateDebutCours ? dateDebutCours.getUTCMonth() : 0

  const etudiants = inscriptions.map((ins: any) => {
    // Mensualité individuelle (réduction possible) — sinon celle de la filière
    const mensualiteMontant = parseFloat(ins.insc_mensualite) || mensualiteFiliere

    // Calculer l'ancre en UTC : MAX(mois_debut ou created_at, date_debut_cours)
    const dateIns = ins.mois_debut ? new Date(ins.mois_debut) : new Date(ins.created_at)
    const insY = dateIns.getUTCFullYear()
    const insM = dateIns.getUTCMonth()

    // ancre = MAX(date_inscription, date_debut_cours) en année/mois
    let ancreY: number, ancreM: number
    if (dateDebutCours && (insY < ddcY || (insY === ddcY && insM < ddcM))) {
      ancreY = ddcY; ancreM = ddcM
    } else {
      ancreY = insY; ancreM = insM
    }

    // Mensualités dues au mois de contrôle
    const diffMonths = (ctrlY - ancreY) * 12 + (ctrlM - 1 - ancreM)
    const mensualitesDues = Math.max(0, Math.min(nbMensualites, diffMonths + 1))

    // Mensualités payées : prendre le MAX entre le nombre d'échéances payées et le calcul par montant
    const mensPayeesNb = parseInt(ins.nb_mens_payees) || 0
    const mensPayeesParMontant = mensualiteMontant > 0
      ? Math.floor(parseFloat(ins.mensualites_payees_montant) / mensualiteMontant)
      : mensPayeesNb

    const mensPayees = Math.max(mensPayeesNb, mensPayeesParMontant)
    const retard = mensualitesDues - mensPayees
    const montantDu = Math.max(0, retard) * mensualiteMontant
    const fraisInscPaye = parseFloat(ins.frais_insc_payes) > 0

    let statut: string
    if (mensualitesDues === 0) statut = 'pas_encore_du'
    else if (retard <= 0) statut = 'a_jour'
    else if (retard <= 1) statut = 'retard_leger'
    else statut = 'en_retard'

    return {
      inscription_id: ins.id,
      etudiant_id: ins.etudiant_id,
      nom: ins.nom,
      prenom: ins.prenom,
      numero_etudiant: ins.numero_etudiant,
      telephone: ins.telephone,
      email: ins.email,
      mensualite: mensualiteMontant,
      statut_inscription: ins.statut,
      date_inscription: dateIns.toISOString().slice(0, 10),
      ancre: `${ancreY}-${String(ancreM + 1).padStart(2, '0')}-01`,
      mensualites_dues: mensualitesDues,
      mensualites_payees: mensPayees,
      retard,
      montant_du: montantDu,
      total_paye: parseFloat(ins.total_paye),
      frais_inscription_paye: fraisInscPaye,
      statut,
    }
  })

  // Résumé global
  const totalEtudiants = etudiants.length
  const aJour = etudiants.filter((e: any) => e.statut === 'a_jour' || e.statut === 'pas_encore_du').length
  const enRetard = etudiants.filter((e: any) => e.statut === 'en_retard' || e.statut === 'retard_leger').length
  const totalCreances = etudiants.reduce((s: number, e: any) => s + Math.max(0, e.montant_du), 0)
  const totalPaye = etudiants.reduce((s: number, e: any) => s + e.total_paye, 0)

  return c.json({
    classe: {
      id: classe.id, nom: classe.nom, filiere: classe.filiere_nom,
      date_debut_cours: classe.date_debut_cours, mensualite: mensualiteFiliere,
      frais_inscription: parseFloat(classe.frais_inscription) || 0,
      nb_mensualites: nbMensualites,
    },
    mois_controle: moisControle,
    resume: { total_etudiants: totalEtudiants, a_jour: aJour, en_retard: enRetard, total_creances: totalCreances, total_paye: totalPaye },
    etudiants,
  })
})

// ─── SUIVI PAIEMENTS GLOBAL (toutes les classes) ────────────────────────────
app.get('/suivi-paiements-global', requireAuth, async (c) => {
  const moisControle = c.req.query('mois_controle') || new Date().toISOString().slice(0, 7)
  const anneeId = c.req.query('annee_academique_id')

  // Toutes les classes non-tronc-commun avec leur filière
  const { rows: classes } = await pool.query(`
    SELECT c.id, c.nom, c.date_debut_cours, c.annee_academique_id,
      f.mensualite, f.frais_inscription, f.duree_mois, f.nom as filiere_nom
    FROM classes c
    LEFT JOIN filieres f ON c.filiere_id = f.id
    WHERE c.est_tronc_commun = false
    ${anneeId ? 'AND c.annee_academique_id = $1' : ''}
    ORDER BY c.nom
  `, anneeId ? [anneeId] : [])

  // Toutes les inscriptions actives avec paiements
  const classeIds = classes.map((c: any) => c.id)
  if (classeIds.length === 0) return c.json({ etudiants: [], resume: { total: 0, a_jour: 0, retard_leger: 0, en_retard: 0, total_creances: 0, total_paye: 0 } })

  const { rows: inscriptions } = await pool.query(`
    SELECT i.id, i.etudiant_id, i.classe_id, i.mois_debut, i.created_at, i.mensualite as insc_mensualite, i.statut,
      e.nom, e.prenom, e.numero_etudiant, e.telephone, e.email,
      (SELECT COALESCE(SUM(p.montant),0) FROM paiements p WHERE p.inscription_id = i.id AND p.statut='confirme') as total_paye,
      (SELECT COALESCE(SUM(p.montant),0) FROM paiements p WHERE p.inscription_id = i.id AND p.statut='confirme' AND p.type_paiement='mensualite') as mensualites_payees_montant,
      (SELECT COUNT(*) FROM echeances ec WHERE ec.inscription_id = i.id AND ec.type_echeance='mensualite' AND ec.statut IN ('paye','partiellement_paye')) as nb_mens_payees
    FROM inscriptions i
    JOIN etudiants e ON i.etudiant_id = e.id
    WHERE i.classe_id = ANY($1::int[]) AND i.statut NOT IN ('abandonne','suspendu')
    ORDER BY e.nom, e.prenom
  `, [classeIds])

  const classeMap = new Map(classes.map((cl: any) => [cl.id, cl]))
  const [ctrlY, ctrlM] = moisControle.split('-').map(Number)

  const etudiants = inscriptions.map((ins: any) => {
    const classe = classeMap.get(ins.classe_id)
    if (!classe) return null
    const mensualiteMontant = parseFloat(ins.insc_mensualite) || parseFloat(classe.mensualite) || 0
    const nbMensualites = classe.duree_mois || 9
    const dateDebutCours = classe.date_debut_cours ? new Date(classe.date_debut_cours) : null
    const ddcY = dateDebutCours ? dateDebutCours.getUTCFullYear() : 0
    const ddcM = dateDebutCours ? dateDebutCours.getUTCMonth() : 0
    const dateIns = ins.mois_debut ? new Date(ins.mois_debut) : new Date(ins.created_at)
    const insY = dateIns.getUTCFullYear()
    const insM = dateIns.getUTCMonth()
    let ancreY: number, ancreM: number
    if (dateDebutCours && (insY < ddcY || (insY === ddcY && insM < ddcM))) {
      ancreY = ddcY; ancreM = ddcM
    } else { ancreY = insY; ancreM = insM }
    const diffMonths = (ctrlY - ancreY) * 12 + (ctrlM - 1 - ancreM)
    const mensualitesDues = Math.max(0, Math.min(nbMensualites, diffMonths + 1))
    const mensPayeesNb = parseInt(ins.nb_mens_payees) || 0
    const mensPayeesParMontant = mensualiteMontant > 0 ? Math.floor(parseFloat(ins.mensualites_payees_montant) / mensualiteMontant) : mensPayeesNb
    const mensPayees = Math.max(mensPayeesNb, mensPayeesParMontant)
    const retard = mensualitesDues - mensPayees
    const montantDu = Math.max(0, retard) * mensualiteMontant
    let statut: string
    if (mensualitesDues === 0) statut = 'pas_encore_du'
    else if (retard <= 0) statut = 'a_jour'
    else if (retard <= 1) statut = 'retard_leger'
    else statut = 'en_retard'
    return {
      inscription_id: ins.id, etudiant_id: ins.etudiant_id,
      nom: ins.nom, prenom: ins.prenom, numero_etudiant: ins.numero_etudiant,
      telephone: ins.telephone, email: ins.email,
      classe_id: ins.classe_id, classe_nom: classe.nom, filiere_nom: classe.filiere_nom,
      mensualite: mensualiteMontant, mensualites_dues: mensualitesDues,
      mensualites_payees: mensPayees, retard, montant_du: montantDu,
      total_paye: parseFloat(ins.total_paye), statut,
    }
  }).filter(Boolean)

  const resume = {
    total: etudiants.length,
    a_jour: etudiants.filter((e: any) => e.statut === 'a_jour' || e.statut === 'pas_encore_du').length,
    retard_leger: etudiants.filter((e: any) => e.statut === 'retard_leger').length,
    en_retard: etudiants.filter((e: any) => e.statut === 'en_retard').length,
    total_creances: etudiants.reduce((s: number, e: any) => s + Math.max(0, e.montant_du), 0),
    total_paye: etudiants.reduce((s: number, e: any) => s + e.total_paye, 0),
  }

  return c.json({ mois_controle: moisControle, resume, etudiants, classes: classes.map((cl: any) => ({ id: cl.id, nom: cl.nom })) })
})

// ─── NOTIFICATION PAIEMENTS EN RETARD ───────────────────────────────────────
app.post('/suivi-paiements-global/notifier', requireAuth, async (c) => {
  const body = await c.req.json()
  const { inscription_ids, message_perso, mois_controle } = body as {
    inscription_ids: number[]
    message_perso?: string
    mois_controle?: string
  }
  if (!Array.isArray(inscription_ids) || inscription_ids.length === 0) {
    return c.json({ error: 'Aucun étudiant sélectionné.' }, 422)
  }
  const senderId = u(c).id
  let notifie = 0
  let sans_compte = 0

  for (const inscId of inscription_ids) {
    // Récupérer l'étudiant et son compte user
    const { rows } = await pool.query(`
      SELECT e.nom, e.prenom, e.email, i.mensualite as insc_mensualite,
        u.id as user_id,
        (SELECT COALESCE(SUM(p.montant),0) FROM paiements p WHERE p.inscription_id=i.id AND p.statut='confirme' AND p.type_paiement='mensualite') as mensualites_payees_montant,
        (SELECT COUNT(*) FROM echeances ec WHERE ec.inscription_id=i.id AND ec.type_echeance='mensualite' AND ec.statut IN ('paye','partiellement_paye')) as nb_mens_payees,
        f.mensualite as filiere_mensualite, f.nom as filiere_nom,
        cl.nom as classe_nom
      FROM inscriptions i
      JOIN etudiants e ON i.etudiant_id = e.id
      LEFT JOIN users u ON u.email = e.email AND u.statut = 'actif'
      LEFT JOIN classes cl ON cl.id = i.classe_id
      LEFT JOIN filieres f ON f.id = cl.filiere_id
      WHERE i.id = $1
    `, [inscId])
    const et = rows[0]
    if (!et || !et.user_id) { sans_compte++; continue }

    const mensualite = parseFloat(et.insc_mensualite) || parseFloat(et.filiere_mensualite) || 0
    const moisStr = mois_controle || new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

    const contenu = message_perso
      ? message_perso
          .replace('{prenom}', et.prenom)
          .replace('{nom}', et.nom)
          .replace('{classe}', et.classe_nom || '')
          .replace('{mois}', moisStr)
      : `Bonjour ${et.prenom} ${et.nom},\n\nNous vous informons que votre compte présente un retard de paiement pour le mois de ${moisStr}.\n\nVeuillez régulariser votre situation au secrétariat dans les meilleurs délais.\n\nCordialement,\nUP'TECH Campus`

    // Créer une conversation directe ou trouver une existante
    const existConv = await pool.query(`
      SELECT c.id FROM conversations c
      JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = $1
      JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = $2
      WHERE c.type = 'direct'
      LIMIT 1
    `, [senderId, et.user_id])

    let convId: number
    if (existConv.rows.length > 0) {
      convId = existConv.rows[0].id
    } else {
      const newConv = await pool.query(
        "INSERT INTO conversations (nom,type,couleur,created_by) VALUES ($1,'direct','#E30613',$2) RETURNING id",
        [`Retard paiement — ${et.prenom} ${et.nom}`, senderId]
      )
      convId = newConv.rows[0].id
      await pool.query('INSERT INTO conversation_participants (conversation_id,user_id) VALUES ($1,$2),($1,$3) ON CONFLICT DO NOTHING', [convId, senderId, et.user_id])
    }

    await pool.query(
      'INSERT INTO messages (conversation_id,sender_id,contenu) VALUES ($1,$2,$3)',
      [convId, senderId, contenu]
    )
    await pool.query('UPDATE conversations SET updated_at=NOW() WHERE id=$1', [convId])
    notifie++
  }

  return c.json({ notifie, sans_compte, message: `${notifie} étudiant(s) notifié(s) via messagerie interne.` })
})

// ─── COMPTABILITÉ PAR CLASSE ────────────────────────────────────────────────
app.get('/classes/:id/comptabilite', requireAuth, async (c) => {
  const classeId = parseInt(c.req.param('id'))
  const moisControle = c.req.query('mois') || new Date().toISOString().slice(0, 7)

  const { rows: classeRows } = await pool.query(
    `SELECT c.*, f.mensualite, f.frais_inscription, f.duree_mois, f.montant_tenue
     FROM classes c LEFT JOIN filieres f ON c.filiere_id = f.id WHERE c.id = $1`, [classeId]
  )
  if (!classeRows[0]) return c.json({ error: 'Classe introuvable' }, 404)
  const classe = classeRows[0]
  const dateDebutCours = classe.date_debut_cours ? new Date(classe.date_debut_cours) : null
  const mensualiteFiliere = parseFloat(classe.mensualite) || 0
  const fraisInscFiliere = parseFloat(classe.frais_inscription) || 0
  const nbMens = classe.duree_mois || 9
  const [cY, cM] = moisControle.split('-').map(Number)
  const ddcY2 = dateDebutCours ? dateDebutCours.getUTCFullYear() : 0
  const ddcM2 = dateDebutCours ? dateDebutCours.getUTCMonth() : 0

  // Tous les paiements confirmés de cette classe
  const { rows: paiements } = await pool.query(`
    SELECT p.montant FROM paiements p JOIN inscriptions i ON p.inscription_id = i.id
    WHERE i.classe_id = $1 AND p.statut = 'confirme'
  `, [classeId])

  // Trésorerie = total encaissé
  const tresorerie = paiements.reduce((s: number, p: any) => s + parseFloat(p.montant), 0)

  // Inscriptions actives avec mensualité individuelle
  const { rows: inscriptions } = await pool.query(`
    SELECT i.id, i.mois_debut, i.created_at, i.mensualite as insc_mensualite, i.frais_inscription as insc_frais
    FROM inscriptions i WHERE i.classe_id = $1 AND i.statut NOT IN ('abandonne')
  `, [classeId])

  let caReconnu = 0
  let totalDu = 0

  for (const ins of inscriptions) {
    const mensu = parseFloat(ins.insc_mensualite) || mensualiteFiliere
    const fraisInsc = parseFloat(ins.insc_frais) || fraisInscFiliere

    const dateIns = ins.mois_debut ? new Date(ins.mois_debut) : new Date(ins.created_at)
    const insY = dateIns.getUTCFullYear(), insM = dateIns.getUTCMonth()
    let aY: number, aM: number
    if (dateDebutCours && (insY < ddcY2 || (insY === ddcY2 && insM < ddcM2))) {
      aY = ddcY2; aM = ddcM2
    } else {
      aY = insY; aM = insM
    }

    const diffMonths = (cY - aY) * 12 + (cM - 1 - aM)
    const moisDispenses = Math.max(0, Math.min(nbMens, diffMonths + 1))

    caReconnu += fraisInsc + (moisDispenses * mensu)
    totalDu += fraisInsc + (nbMens * mensu)
  }

  // PCA = Trésorerie - CA reconnu (argent reçu pour des services pas encore rendus)
  const pca = Math.max(0, tresorerie - caReconnu)
  // Créances = CA reconnu - Trésorerie + PCA = services rendus non payés
  const creances = Math.max(0, caReconnu - tresorerie)
  // Taux de recouvrement
  const tauxRecouvrement = caReconnu > 0 ? Math.round(tresorerie / caReconnu * 100) : 0

  return c.json({
    mois_controle: moisControle,
    nb_inscrits: inscriptions.length,
    tresorerie, // Ce qu'on a encaissé
    ca_reconnu: caReconnu, // Ce qu'on a gagné (services rendus)
    pca, // Produits constatés d'avance (dette de service)
    creances, // Ce qu'on nous doit
    total_du: totalDu, // Valeur totale des contrats
    taux_recouvrement: tauxRecouvrement,
  })
})

// Voir la maquette d'une filière
app.get('/filieres/:id/maquette', requireAuth, async (c) => {
  const filiereId = c.req.param('id')
  const { rows } = await pool.query(
    `SELECT fm.*, m.nom as matiere_nom, m.code as matiere_code
     FROM filiere_matiere fm
     JOIN matieres m ON fm.matiere_id = m.id
     WHERE fm.filiere_id = $1
     ORDER BY fm.semestre, fm.ordre`, [filiereId]
  )
  // Structurer par semestre > UE > EC
  const semestres: Record<number, any> = {}
  for (const r of rows) {
    const sem = r.semestre || 1
    if (!semestres[sem]) semestres[sem] = { numero: sem, ues: {} }
    const ueKey = r.code_ue || 'SANS_CODE'
    if (!semestres[sem].ues[ueKey]) {
      semestres[sem].ues[ueKey] = {
        code: r.code_ue, intitule_ue: r.intitule_ue, categorie: r.categorie_ue, ecs: []
      }
    }
    semestres[sem].ues[ueKey].ecs.push({
      matiere_id: r.matiere_id, intitule: r.matiere_nom, cm: r.cm, td: r.td, tp: r.tp, tpe: r.tpe,
      vht: r.vht, coefficient: parseFloat(r.coefficient), credits: r.credits, ordre: r.ordre
    })
  }
  // Transformer en tableau
  const result = Object.values(semestres).map((s: any) => ({
    numero: s.numero, ues: Object.values(s.ues).map((ue: any) => {
      const totalCredits = ue.ecs.reduce((sum: number, ec: any) => sum + (ec.credits || 0), 0)
      return { ...ue, credits_ue: totalCredits }
    })
  }))
  return c.json(result)
})

// ─── UES ──────────────────────────────────────────────────────────────────────
app.get('/ues', requireAuth, async (c) => {
  const classeId = c.req.query('classe_id')
  const params: any[] = []
  let whereClause = ''
  let niveauFilter = ''

  if (classeId) {
    params.push(classeId)
    whereClause = `WHERE ue.classe_id = $${params.length}`
    // Filtre semestre par niveau de la classe :
    // niveau 1 → S1,S2 | niveau 2 → S3,S4 | etc.
    // On n'applique pas le filtre pour les troncs communs (est_tronc_commun=true)
    niveauFilter = `AND (
      c.est_tronc_commun = true
      OR c.niveau IS NULL OR c.niveau = 0
      OR ue.semestre BETWEEN (c.niveau * 2 - 1) AND (c.niveau * 2)
    )`
  }

  const { rows } = await pool.query(`
    SELECT ue.*,
      jsonb_build_object('id',c.id,'nom',c.nom) as classe,
      CASE WHEN e.id IS NOT NULL
        THEN jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom)
        ELSE NULL
      END as enseignant
    FROM unites_enseignement ue
    LEFT JOIN classes c ON ue.classe_id = c.id
    LEFT JOIN enseignants e ON ue.enseignant_id = e.id
    ${whereClause}
    ${niveauFilter}
    ORDER BY ue.semestre, ue.ordre, ue.code
  `, params)
  return c.json(rows)
})

app.post('/ues', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `INSERT INTO unites_enseignement (classe_id,enseignant_id,code,intitule,intitule_ue,coefficient,credits_ects,volume_horaire,ordre,matiere_id,semestre,categorie_ue,cm,td,tp,tpe)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [b.classe_id, b.enseignant_id || null, b.code, b.intitule, b.intitule_ue || null, b.coefficient || 1, b.credits_ects || 0, b.volume_horaire || 0, b.ordre || 0, b.matiere_id || null, b.semestre || 1, b.categorie_ue || null, b.cm || 0, b.td || 0, b.tp || 0, b.tpe || 0]
  )
  return c.json(rows[0], 201)
})

app.put('/ues/:id', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const ueId = c.req.param('id')
  // Charger les valeurs existantes pour préserver les champs non envoyés par le formulaire
  const { rows: ex } = await pool.query('SELECT * FROM unites_enseignement WHERE id=$1', [ueId])
  if (!ex[0]) return c.json({ error: 'UE introuvable' }, 404)
  const e = ex[0]
  const { rows } = await pool.query(
    `UPDATE unites_enseignement SET
      classe_id=$1, enseignant_id=$2, code=$3, intitule=$4, intitule_ue=$5,
      coefficient=$6, credits_ects=$7, volume_horaire=$8, ordre=$9, matiere_id=$10,
      semestre=$11, categorie_ue=$12, cm=$13, td=$14, tp=$15, tpe=$16
     WHERE id=$17 RETURNING *`,
    [
      b.classe_id       ?? e.classe_id,
      'enseignant_id' in b ? (b.enseignant_id || null) : e.enseignant_id,
      b.code            ?? e.code,
      b.intitule        ?? e.intitule,
      'intitule_ue' in b ? (b.intitule_ue ?? null) : e.intitule_ue,
      b.coefficient     ?? e.coefficient,
      b.credits_ects    ?? e.credits_ects,
      b.volume_horaire  != null ? b.volume_horaire : e.volume_horaire,
      b.ordre           ?? e.ordre,
      'matiere_id' in b ? (b.matiere_id || null) : e.matiere_id,
      b.semestre        ?? e.semestre,
      'categorie_ue' in b ? (b.categorie_ue ?? null) : e.categorie_ue,
      b.cm              ?? e.cm,
      b.td              ?? e.td,
      b.tp              ?? e.tp,
      b.tpe             ?? e.tpe,
      ueId
    ]
  )
  return c.json(rows[0])
})

app.delete('/ues/:id', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  await pool.query('DELETE FROM unites_enseignement WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── NOTES ────────────────────────────────────────────────────────────────────
app.get('/notes', requireAuth, async (c) => {
  const classeId = c.req.query('classe_id')
  const session = c.req.query('session') || 'normale'
  if (!classeId) return c.json({ ues: [], inscriptions: [], notes: [] })

  // Récupérer les tronc commun IDs de cette classe (many-to-many)
  const { rows: tcRows } = await pool.query('SELECT tronc_commun_id FROM classe_tronc_commun WHERE classe_id=$1', [classeId])
  const troncCommunIds = tcRows.map((r: any) => r.tronc_commun_id)

  // Infos de la classe (niveau + est_tronc_commun)
  const { rows: classeInfoRows } = await pool.query('SELECT est_tronc_commun, niveau FROM classes WHERE id=$1', [classeId])
  const estTroncCommun = classeInfoRows[0]?.est_tronc_commun ?? false
  const niveauClasse: number = classeInfoRows[0]?.niveau || 1
  const semMin = niveauClasse * 2 - 1  // niveau 2 → 3
  const semMax = niveauClasse * 2       // niveau 2 → 4

  // UEs propres à la classe — filtrées par semestre selon le niveau (sauf tronc commun)
  const { rows: uesSpecifiques } = await pool.query(`
    SELECT ue.*, false as is_tronc_commun, NULL as tronc_commun_classe_id,
      CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
    FROM unites_enseignement ue
    LEFT JOIN enseignants i ON ue.enseignant_id = i.id
    WHERE ue.classe_id = $1
      AND ($2 OR ue.semestre BETWEEN $3 AND $4)
    ORDER BY ue.semestre, ue.ordre, ue.code
  `, [classeId, estTroncCommun, semMin, semMax])

  // UEs de tous les tronc commun liés (pas de filtre semestre — le TC s'applique à tous les niveaux)
  let uesTronc: any[] = []
  if (troncCommunIds.length > 0) {
    const { rows } = await pool.query(`
      SELECT ue.*, true as is_tronc_commun, ue.classe_id as tronc_commun_classe_id,
        CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
      FROM unites_enseignement ue
      LEFT JOIN enseignants i ON ue.enseignant_id = i.id
      WHERE ue.classe_id = ANY($1::int[])
      ORDER BY ue.ordre, ue.code
    `, [troncCommunIds])
    uesTronc = rows
  }

  const ues = [...uesTronc, ...uesSpecifiques]

  // Inscriptions actives : classe directe + classes liées si tronc commun
  const { rows: inscriptions } = await pool.query(`
    SELECT ins.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom,
        'date_naissance',e.date_naissance,'lieu_naissance',e.lieu_naissance,
        'numero_etudiant',e.numero_etudiant) as etudiant,
      jsonb_build_object('id',cl.id,'nom',cl.nom) as classe,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom) ELSE NULL END as filiere,
      CASE WHEN ne.id IS NOT NULL THEN jsonb_build_object('id',ne.id,'nom',ne.nom,'est_superieur_bac',ne.est_superieur_bac) ELSE NULL END as niveau_entree,
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_academique
    FROM inscriptions ins
    LEFT JOIN etudiants e ON ins.etudiant_id = e.id
    LEFT JOIN classes cl ON ins.classe_id = cl.id
    LEFT JOIN filieres f ON ins.filiere_id = f.id
    LEFT JOIN niveaux_entree ne ON ins.niveau_entree_id = ne.id
    LEFT JOIN annees_academiques aa ON ins.annee_academique_id = aa.id
    WHERE (
      ins.classe_id = $1
      OR ($2 AND ins.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = $1))
    )
    AND ins.statut = 'inscrit_actif'
    ORDER BY e.nom, e.prenom
  `, [classeId, estTroncCommun])

  // Notes for these inscriptions and session
  const inscriptionIds = inscriptions.map((i: any) => i.id)
  let notes: any[] = []
  if (inscriptionIds.length && ues.length) {
    const { rows } = await pool.query(
      `SELECT * FROM notes WHERE inscription_id = ANY($1) AND session = $2`,
      [inscriptionIds, session]
    )
    notes = rows
  }

  // Pour les tronc commun : construire la map filiere_id → { matiere_id → { coefficient, credits } }
  // afin que le front puisse afficher le bon coefficient par étudiant selon sa filière
  const filiereIds = Array.from(new Set(inscriptions.map((i: any) => i.filiere_id).filter(Boolean)))
  let filierePivots: Record<number, Record<number, { coefficient: number; credits: number }>> = {}
  if (filiereIds.length > 0) {
    const { rows: pivotRows } = await pool.query(
      `SELECT filiere_id, matiere_id, coefficient::float as coefficient, credits FROM filiere_matiere WHERE filiere_id = ANY($1::int[])`,
      [filiereIds]
    )
    pivotRows.forEach((p: any) => {
      if (!filierePivots[p.filiere_id]) filierePivots[p.filiere_id] = {}
      filierePivots[p.filiere_id][p.matiere_id] = { coefficient: parseFloat(p.coefficient) || 1, credits: parseInt(p.credits) || 0 }
    })
  }

  return c.json({ ues, inscriptions, notes, filiere_pivots: filierePivots })
})

app.get('/notes/bulletin/:inscription_id', requireAuth, async (c) => {
  const inscriptionId = c.req.param('inscription_id')
  // Get inscription with student + class + filiere + annee info
  const { rows: inscRows } = await pool.query(`
    SELECT ins.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom,'numero_etudiant',e.numero_etudiant,'date_naissance',e.date_naissance,'lieu_naissance',e.lieu_naissance) as etudiant,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom,'filiere',
        CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom) ELSE NULL END
      ) ELSE NULL END as classe,
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_academique,
      CASE WHEN ne.id IS NOT NULL THEN jsonb_build_object('id',ne.id,'nom',ne.nom,'est_superieur_bac',ne.est_superieur_bac) ELSE NULL END as niveau_entree
    FROM inscriptions ins
    LEFT JOIN etudiants e ON ins.etudiant_id = e.id
    LEFT JOIN classes c ON ins.classe_id = c.id
    LEFT JOIN filieres f ON ins.filiere_id = f.id
    LEFT JOIN annees_academiques aa ON ins.annee_academique_id = aa.id
    LEFT JOIN niveaux_entree ne ON ins.niveau_entree_id = ne.id
    WHERE ins.id = $1
  `, [inscriptionId])
  if (!inscRows[0]) return c.json({ message: 'Inscription introuvable.' }, 404)

  // UEs de la classe + tronc commun éventuels (many-to-many)
  const classeId = inscRows[0].classe_id
  const { rows: tcRows2 } = await pool.query('SELECT tronc_commun_id FROM classe_tronc_commun WHERE classe_id=$1', [classeId])
  const troncIds = tcRows2.map((r: any) => r.tronc_commun_id)

  // Déterminer le niveau de la classe pour filtrer les semestres pertinents
  const { rows: classeNivRows } = await pool.query('SELECT niveau, est_tronc_commun FROM classes WHERE id=$1', [classeId])
  const classeNiveau: number = classeNivRows[0]?.niveau || 1
  const bulletinSemMin = classeNiveau * 2 - 1  // ex: niveau 2 → 3
  const bulletinSemMax = classeNiveau * 2       // ex: niveau 2 → 4

  const { rows: uesSpecifiques } = await pool.query(
    `SELECT ue.*, false as is_tronc_commun,
       CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
     FROM unites_enseignement ue
     LEFT JOIN enseignants i ON ue.enseignant_id=i.id
     JOIN classes cls ON cls.id = ue.classe_id
     WHERE ue.classe_id=$1
       AND (cls.est_tronc_commun = true OR ue.semestre BETWEEN $2 AND $3)
     ORDER BY ue.semestre, ue.ordre, ue.code`, [classeId, bulletinSemMin, bulletinSemMax])

  let uesTronc: any[] = []
  if (troncIds.length > 0) {
    const { rows } = await pool.query(
      `SELECT ue.*, true as is_tronc_commun,
         CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
       FROM unites_enseignement ue LEFT JOIN enseignants i ON ue.enseignant_id=i.id
       WHERE ue.classe_id = ANY($1::int[]) ORDER BY ue.ordre,ue.code`, [troncIds])
    uesTronc = rows
  }
  const allUes = [...uesTronc, ...uesSpecifiques]

  // Notes des deux sessions — on affiche la meilleure (rattrapage prioritaire si >= 10, sinon on garde normale)
  const { rows: notesNormale } = await pool.query(
    `SELECT * FROM notes WHERE inscription_id = $1 AND session = 'normale'`, [inscriptionId]
  )
  const { rows: notesRattrapage } = await pool.query(
    `SELECT * FROM notes WHERE inscription_id = $1 AND session = 'rattrapage'`, [inscriptionId]
  )
  const noteMapNormale: Record<number, number> = {}
  const controleMap: Record<number, number | null> = {}
  const examenMap: Record<number, number | null> = {}
  notesNormale.forEach((n: any) => {
    noteMapNormale[n.ue_id] = parseFloat(n.note)
    controleMap[n.ue_id] = n.note_controle != null ? parseFloat(n.note_controle) : null
    examenMap[n.ue_id] = n.note_examen != null ? parseFloat(n.note_examen) : null
  })
  const noteMapRattrapage: Record<number, number> = {}
  notesRattrapage.forEach((n: any) => { noteMapRattrapage[n.ue_id] = parseFloat(n.note) })
  // noteMap = note retenue pour le calcul (rattrapage si présent, sinon normale)
  const noteMap: Record<number, number> = { ...noteMapNormale }
  const sessionMap: Record<number, string> = {}
  Object.keys(noteMapNormale).forEach(id => { sessionMap[Number(id)] = '1ère' })
  Object.keys(noteMapRattrapage).forEach(id => {
    noteMap[Number(id)] = noteMapRattrapage[Number(id)]
    sessionMap[Number(id)] = '2ème'
  })

  // Récupérer la filière de l'étudiant (via inscription) pour les coefficients cross-filière
  const studentFiliereId = inscRows[0].filiere_id ?? null
  // Map matiere_id → { coefficient, credits } depuis la filière de l'étudiant
  const filierePivotMap: Record<number, { coefficient: number; credits: number }> = {}
  if (studentFiliereId) {
    const { rows: pivotRows } = await pool.query(
      `SELECT matiere_id, coefficient::float as coefficient, credits FROM filiere_matiere WHERE filiere_id = $1`,
      [studentFiliereId]
    )
    pivotRows.forEach((p: any) => {
      filierePivotMap[p.matiere_id] = { coefficient: parseFloat(p.coefficient) || 1, credits: parseInt(p.credits) || 0 }
    })
  }

  // Système : BAC (niveau d'entrée) ou BAC+ → crédits (LMD), < BAC → coefficients
  const niveauNom: string = inscRows[0]?.niveau_entree?.nom ?? ''
  const isLMD = inscRows[0]?.niveau_entree?.est_superieur_bac === true || /bac/i.test(niveauNom)

  // Compute bulletin — exclure les UEs avec coefficient=0 pour les FP
  // (coefficient=0 = matière exclue du bulletin dans "générer groupe de matières")
  const uesActives = isLMD
    ? allUes
    : allUes.filter((ue: any) => parseFloat(ue.coefficient) !== 0)

  let totalPts = 0, totalWeight = 0, creditsValides = 0, creditsTotal = 0
  const uesBulletin = uesActives.map((ue: any) => {
    const note = noteMap[ue.id] ?? null
    // Crédits et coefficient depuis l'UE de la classe (classe-spécifique)
    // Ne pas appliquer || 1 sur le coefficient pour respecter la valeur 0
    const coef = parseFloat(ue.coefficient)
    const credits = parseFloat(ue.credits_ects) || 0
    // Poids effectif : crédits si LMD, coefficient sinon (min 1 pour éviter division par 0 dans la moyenne)
    const weight = isLMD ? (credits || 1) : (coef > 0 ? coef : 1)
    creditsTotal += credits
    let points = null
    if (note !== null) {
      points = Math.round(note * weight * 100) / 100
      totalPts += note * weight
      totalWeight += weight
      if (note >= 10) creditsValides += credits
    }
    const sessionLabel = note !== null ? (sessionMap[ue.id] ?? '1ère') : '—'
    const note_controle = controleMap[ue.id] ?? null
    const note_examen = examenMap[ue.id] ?? null
    return { ...ue, note, note_controle, note_examen, points, valide: note !== null && note >= 10, coef_effectif: coef, credits, session_label: sessionLabel }
  })

  const moyenne = totalWeight > 0 ? Math.round(totalPts / totalWeight * 100) / 100 : null
  let mention: string | null = null
  let decision = 'en_attente'
  if (moyenne !== null) {
    if (moyenne >= 16) mention = 'Très Bien'
    else if (moyenne >= 14) mention = 'Bien'
    else if (moyenne >= 12) mention = 'Assez Bien'
    else if (moyenne >= 10) mention = 'Passable'
    if (isLMD) {
      // LMD : 60 crédits validés = admis, ≥42 = passif (passage conditionnel), <42 = redoublant
      if (creditsValides >= 60) decision = 'admis'
      else if (creditsValides >= 42) decision = 'passif'
      else decision = 'redoublant'
    } else {
      if (moyenne >= 10) decision = 'admis'
      else if (moyenne >= 8) decision = 'rattrapage'
      else decision = 'redoublant'
    }
  }

  // Helper : mention depuis une note
  function mentionUE(n: number | null): string {
    if (n === null || n < 10) return '—'
    if (n < 12) return 'Passable'
    if (n < 14) return 'Assez Bien'
    if (n < 16) return 'Bien'
    return 'Très Bien'
  }

  // Grouper par semestre puis par UE (categorie_ue / intitule_ue) pour le bulletin
  type SemMap = { numero: number; ecs: any[]; groupes: Record<string, { code: string; intitule: string; ecs: any[] }>; totalPts: number; totalWeight: number; creditsValides: number; creditsTotal: number }
  const semestresMap: Record<number, SemMap> = {}
  for (const ec of uesBulletin) {
    const sem = ec.semestre || 1
    if (!semestresMap[sem]) semestresMap[sem] = { numero: sem, ecs: [], groupes: {}, totalPts: 0, totalWeight: 0, creditsValides: 0, creditsTotal: 0 }
    const s = semestresMap[sem]
    s.ecs.push(ec)
    const w = ec.coef_effectif || 1
    const cr = ec.credits || 0
    s.creditsTotal += cr
    if (ec.note !== null) {
      s.totalPts += ec.note * w
      s.totalWeight += w
      if (ec.note >= 10) s.creditsValides += cr
    }
    // Groupement UE
    const ueKey = ec.categorie_ue || null
    const ueLabel = ec.intitule_ue || null
    if (ueKey && ueLabel) {
      if (!s.groupes[ueKey]) s.groupes[ueKey] = { code: ueKey, intitule: ueLabel, ecs: [] }
      s.groupes[ueKey].ecs.push(ec)
    }
  }

  const semestres = Object.values(semestresMap).sort((a, b) => a.numero - b.numero).map(s => {
    // Calcul des moyennes UE depuis leurs ECs (pondération par crédits)
    const groupes_ue = Object.values(s.groupes).map((g: any) => {
      let gPts = 0, gW = 0, gCr = 0
      for (const ec of g.ecs) {
        const w = ec.coef_effectif || 1
        const cr = ec.credits || 0
        gCr += cr
        if (ec.note !== null) { gPts += ec.note * w; gW += w }
      }
      const moy_ue = gW > 0 ? Math.round(gPts / gW * 100) / 100 : null
      const valide = moy_ue !== null && moy_ue >= 10
      // Crédits validés au niveau UE : tous les crédits si moyenne UE >= 10, sinon 0
      const gCrV = valide ? gCr : 0
      const session_ue = g.ecs.some((ec: any) => ec.session_label === '2ème') ? '2ème' : '1ère'
      return { code: g.code, intitule: g.intitule, ecs: g.ecs, moyenne_ue: moy_ue, credits_ue: gCr, credits_valides_ue: gCrV, session_ue, mention_ue: mentionUE(moy_ue), valide }
    })
    // ECs sans UE parente (categorie_ue null)
    const ecs_standalone = s.ecs.filter((ec: any) => !ec.categorie_ue)
    // Crédits validés corrigés : UE-level pour les groupes, EC-level pour les standalone
    const creditsValidesGroupe = groupes_ue.reduce((sum: number, ue: any) => sum + ue.credits_valides_ue, 0)
    const creditsValidesStandalone = ecs_standalone
      .filter((ec: any) => ec.note !== null && ec.note >= 10)
      .reduce((sum: number, ec: any) => sum + (ec.credits || 0), 0)
    return {
      numero: s.numero,
      ues: s.ecs,
      ecs_standalone,
      groupes_ue,
      has_groupes: groupes_ue.length > 0,
      moyenne: s.totalWeight > 0 ? Math.round(s.totalPts / s.totalWeight * 100) / 100 : null,
      credits_valides: creditsValidesGroupe + creditsValidesStandalone,
      credits_total: s.creditsTotal,
    }
  })

  return c.json({
    inscription: { ...inscRows[0], est_lmd: isLMD },
    ues: uesBulletin,
    ues_tronc_commun: uesBulletin.filter((u: any) => u.is_tronc_commun),
    ues_specifiques: uesBulletin.filter((u: any) => !u.is_tronc_commun),
    semestres,
    moyenne,
    mention,
    decision,
    credits_valides: creditsValides,
    credits_total: creditsTotal,
    has_tronc_commun: troncIds.length > 0,
    est_lmd: isLMD,
  })
})

// ── Envoi du bulletin par email (DG uniquement) ────────────────────────────
app.post('/notes/bulletin/:inscription_id/envoyer', requireAuth, role('dg'), async (c) => {
  const inscriptionId = c.req.param('inscription_id')
  const body = await c.req.json().catch(() => ({})) as { pdf_base64?: string; nom_dg?: string }
  const pdfBase64 = body.pdf_base64 || ''
  if (!pdfBase64) return c.json({ message: 'pdf_base64 requis.' }, 400)

  // Récupérer email de l'étudiant
  const { rows } = await pool.query(`
    SELECT e.nom, e.prenom, e.email
    FROM inscriptions ins
    JOIN etudiants e ON ins.etudiant_id = e.id
    WHERE ins.id = $1
  `, [inscriptionId])
  if (!rows[0]) return c.json({ message: 'Inscription introuvable.' }, 404)
  const etudiant = rows[0]
  if (!etudiant.email) return c.json({ message: `L'étudiant ${etudiant.prenom} ${etudiant.nom} n'a pas d'adresse email renseignée.` }, 422)

  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return c.json({ message: 'Service email non configuré (BREVO_API_KEY manquant).' }, 503)

  const fromEmail = process.env.BREVO_FROM_EMAIL || 'noreply@uptech.edu'
  const fromName  = process.env.BREVO_FROM_NAME  || 'UPTECH Campus'
  const nomDg     = body.nom_dg || 'Le Directeur Général'

  const htmlBody = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px;">
<p>Bonjour <strong>${etudiant.prenom} ${etudiant.nom}</strong>,</p>
<p>Veuillez trouver ci-joint votre bulletin de notes officiel, signé numériquement par ${nomDg}, Directeur Général d'UPTECH Campus.</p>
<p>Ce document est votre relevé officiel. Nous vous invitons à vous présenter à l'établissement pour retirer votre bulletin original.</p>
<br/>
<p>Cordialement,<br/><strong>${nomDg}</strong><br/>Directeur Général — UPTECH Campus</p>
</div>`

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: etudiant.email, name: `${etudiant.prenom} ${etudiant.nom}` }],
      subject: `📄 Votre bulletin de notes — UPTECH Campus`,
      htmlContent: htmlBody,
      attachment: [{
        name: `bulletin-${etudiant.prenom}-${etudiant.nom}.pdf`,
        content: pdfBase64,
      }],
    }),
  })
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}))
    return c.json({ message: `Échec envoi email (${resp.status}).`, detail: errBody }, 500)
  }
  return c.json({ success: true, message: `Bulletin envoyé à ${etudiant.email}` })
})

app.post('/notes/batch', requireAuth, role('dg', 'dir_peda', 'coordinateur', 'enseignant'), async (c) => {
  const body = await c.req.json()
  type NoteInput = { inscription_id: number; ue_id: number; note?: number | null; note_controle?: number | null; note_examen?: number | null; session?: string }
  const notes = Array.isArray(body) ? body : (body.notes || []) as NoteInput[]
  const userRole = u(c).role

  // Si enseignant : bloquer uniquement les UEs assignées à UN AUTRE enseignant
  let blockedUeIds: number[] = []
  if (userRole === 'enseignant') {
    const { rows: ensRows } = await pool.query('SELECT id FROM enseignants WHERE user_id=$1', [u(c).id])
    if (ensRows.length) {
      const enseignantId = ensRows[0].id
      const { rows: ueRows } = await pool.query(
        'SELECT id FROM unites_enseignement WHERE enseignant_id IS NOT NULL AND enseignant_id != $1', [enseignantId]
      )
      blockedUeIds = ueRows.map((r: any) => Number(r.id))
    }
  }

  for (const n of notes) {
    if (blockedUeIds.includes(Number(n.ue_id))) continue

    // Calcul note finale : si controle ET examen → 50/50 ; si un seul → copier ; sinon note directe
    let noteFinal: number | null = null
    const nc = n.note_controle != null ? parseFloat(String(n.note_controle)) : null
    const ne = n.note_examen != null ? parseFloat(String(n.note_examen)) : null

    if (nc !== null && ne !== null) {
      noteFinal = Math.round((nc * 0.5 + ne * 0.5) * 100) / 100
    } else if (nc !== null) {
      noteFinal = nc
    } else if (ne !== null) {
      noteFinal = ne
    } else if (n.note != null) {
      noteFinal = parseFloat(String(n.note))
    }

    if (noteFinal === null) continue

    await pool.query(
      `INSERT INTO notes (inscription_id,ue_id,note,note_controle,note_examen,session,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (inscription_id,ue_id,session) DO UPDATE
       SET note=$3, note_controle=$4, note_examen=$5`,
      [n.inscription_id, n.ue_id, noteFinal, nc, ne, n.session || 'normale', u(c).id]
    )
  }

  // Notifier les étudiants concernés (une notif par étudiant unique)
  try {
    const inscIds = [...new Set(notes.map((n: any) => n.inscription_id).filter(Boolean))]
    if (inscIds.length) {
      const { rows: inscUsers } = await pool.query(
        `SELECT DISTINCT i.id as inscription_id, et.user_id, et.prenom, et.nom
         FROM inscriptions i JOIN etudiants et ON et.id=i.etudiant_id
         WHERE i.id = ANY($1) AND et.user_id IS NOT NULL`,
        [inscIds]
      )
      for (const iu of inscUsers) {
        await createUserNotif(
          iu.user_id, 'note',
          '📊 Notes mises à jour',
          `De nouvelles notes ont été enregistrées dans votre espace. Consultez votre bulletin.`,
          { inscription_id: iu.inscription_id }
        )
      }
    }
  } catch { /* silencieux */ }

  return c.json({ message: 'Notes enregistrées.' })
})

// Profil enseignant du user connecté + ses classes

// ─── RAPPORTS ─────────────────────────────────────────────────────────────────
app.get('/rapports', requireAuth, async (c) => {
  // ── Résolution de l'année académique ──────────────────────────────────────
  const anneeIdParam = c.req.query('annee_id')
  let anneeRow: any = null
  if (anneeIdParam) {
    const { rows } = await pool.query('SELECT * FROM annees_academiques WHERE id=$1', [anneeIdParam])
    anneeRow = rows[0] ?? null
  }
  if (!anneeRow) {
    const { rows } = await pool.query("SELECT * FROM annees_academiques WHERE actif=true LIMIT 1")
    anneeRow = rows[0] ?? null
  }
  if (!anneeRow) {
    const { rows } = await pool.query("SELECT * FROM annees_academiques ORDER BY date_debut DESC LIMIT 1")
    anneeRow = rows[0] ?? null
  }
  const anneeId: number | null = anneeRow?.id ?? null
  const dateDebut: Date = anneeRow?.date_debut ? new Date(anneeRow.date_debut) : new Date(new Date().getFullYear(), 0, 1)
  const dateFin: Date   = anneeRow?.date_fin   ? new Date(anneeRow.date_fin)   : new Date(new Date().getFullYear(), 11, 31, 23, 59, 59)

  // ── Financier ────────────────────────────────────────────────────────────────
  // Encaissements de l'année : paiements confirmés dans la plage de l'année académique
  const [encAnnee, depAnnee] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(montant),0)::float AS val
       FROM paiements
       WHERE statut='confirme'
         AND COALESCE(confirmed_at, created_at) BETWEEN $1 AND $2`,
      [dateDebut, dateFin]
    ),
    pool.query(
      `SELECT COALESCE(SUM(montant),0)::float AS val
       FROM depenses
       WHERE statut='validee'
         AND COALESCE(date_depense, created_at::date) BETWEEN $1 AND $2`,
      [dateDebut, dateFin]
    ),
  ])

  // Taux recouvrement = encaissé / total attendu (écheances dues dans la période)
  const { rows: echRows } = await pool.query(
    anneeId
      ? `SELECT COALESCE(SUM(e.montant),0)::float AS attendu, COALESCE(SUM(CASE WHEN e.statut!='non_paye' THEN e.montant ELSE 0 END),0)::float AS recouvre
         FROM echeances e
         JOIN inscriptions i ON e.inscription_id = i.id
         WHERE i.annee_academique_id = $1`
      : `SELECT COALESCE(SUM(montant),0)::float AS attendu, COALESCE(SUM(CASE WHEN statut!='non_paye' THEN montant ELSE 0 END),0)::float AS recouvre
         FROM echeances WHERE mois BETWEEN $1 AND $2`,
    anneeId ? [anneeId] : [dateDebut, dateFin]
  )
  const attendu   = echRows[0]?.attendu   as number ?? 0
  const recouvre  = echRows[0]?.recouvre  as number ?? 0
  const encaisse_annee  = encAnnee.rows[0].val as number
  const depenses_annee  = depAnnee.rows[0].val as number
  const taux_recouvrement = attendu > 0 ? Math.round((recouvre / attendu) * 100) : 0

  // Évolution mensuelle sur la durée de l'année académique (max 12 mois)
  const { rows: evo6 } = await pool.query(`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', $1::date),
        LEAST(date_trunc('month', $2::date), date_trunc('month', NOW())),
        INTERVAL '1 month'
      ) AS m
    ),
    rec AS (
      SELECT date_trunc('month', COALESCE(confirmed_at, created_at)) AS m, COALESCE(SUM(montant),0) AS val
      FROM paiements WHERE statut='confirme'
        AND COALESCE(confirmed_at, created_at) BETWEEN $1 AND $2
      GROUP BY 1
    ),
    dep AS (
      SELECT date_trunc('month', COALESCE(date_depense, created_at::date)) AS m, COALESCE(SUM(montant),0) AS val
      FROM depenses WHERE statut='validee'
        AND COALESCE(date_depense, created_at::date) BETWEEN $1 AND $2
      GROUP BY 1
    )
    SELECT
      to_char(months.m, 'Mon YY') AS mois,
      COALESCE(rec.val, 0)::float AS recettes,
      COALESCE(dep.val, 0)::float AS depenses
    FROM months
    LEFT JOIN rec ON rec.m = months.m
    LEFT JOIN dep ON dep.m = months.m
    ORDER BY months.m
  `, [dateDebut, dateFin])

  // ── Pédagogique ── (filtré par année académique) ───────────────────────────
  const seanceFilter = anneeId ? `WHERE annee_academique_id = ${anneeId}` : ''
  const seanceFilterAnd = anneeId ? `AND s.annee_academique_id = ${anneeId}` : ''

  const [nbSeances, nbSeancesRealises, nbUes, nbNotes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS val FROM seances ${seanceFilter}`),
    pool.query(`SELECT COUNT(*)::int AS val FROM seances WHERE statut='effectue' ${anneeId ? `AND annee_academique_id = ${anneeId}` : ''}`),
    pool.query(anneeId
      ? `SELECT COUNT(DISTINCT ue.id)::int AS val FROM unites_enseignement ue JOIN classes cl ON ue.classe_id = cl.id WHERE cl.annee_academique_id = ${anneeId}`
      : `SELECT COUNT(*)::int AS val FROM unites_enseignement`),
    pool.query(anneeId
      ? `SELECT COUNT(DISTINCT n.inscription_id)::int AS val FROM notes n JOIN inscriptions i ON n.inscription_id = i.id WHERE i.annee_academique_id = ${anneeId}`
      : `SELECT COUNT(DISTINCT inscription_id)::int AS val FROM notes`),
  ])

  const nb_seances = nbSeances.rows[0].val as number
  const nb_seances_realisees = nbSeancesRealises.rows[0].val as number

  const { rows: presRows } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN p.statut='present' THEN 1 ELSE 0 END), 0)::int AS presents,
      COUNT(p.id)::int AS total
    FROM presences p
    JOIN seances s ON p.seance_id = s.id
    WHERE s.statut = 'effectue'
    ${seanceFilterAnd}
  `)
  const taux_presence = presRows[0]?.total > 0
    ? Math.round((presRows[0].presents / presRows[0].total) * 100) : 0

  // ── RH ── (filtré par année, volume horaire = heures effectivement réalisées) ─
  const [ensActifs, volH, modeRep, nbIntervenants] = await Promise.all([
    pool.query(anneeId
      ? `SELECT COUNT(DISTINCT enseignant_id)::int AS val FROM seances WHERE statut='effectue' AND annee_academique_id = ${anneeId}`
      : `SELECT COUNT(*)::int AS val FROM enseignants WHERE statut='actif'`),
    pool.query(`
      SELECT COALESCE(
        SUM(EXTRACT(EPOCH FROM (date_fin - date_debut)) / 3600), 0
      )::float AS val
      FROM seances
      WHERE statut = 'effectue'
      ${anneeId ? `AND annee_academique_id = ${anneeId}` : ''}
    `),
    pool.query(`
      SELECT mode, COUNT(*)::int AS cnt
      FROM seances
      WHERE mode IS NOT NULL
      ${anneeId ? `AND annee_academique_id = ${anneeId}` : ''}
      GROUP BY mode
    `),
    pool.query(`SELECT COUNT(*)::int AS val FROM enseignants WHERE statut='actif'`),
  ])

  const totalSeancesMode = modeRep.rows.reduce((s: number, r: any) => s + r.cnt, 0)
  const repartition_mode: Record<string, number> = {}
  for (const r of modeRep.rows) {
    repartition_mode[r.mode] = totalSeancesMode > 0 ? Math.round((r.cnt / totalSeancesMode) * 100) : 0
  }

  // ── Étudiants ── (filtré par année académique) ────────────────────────────
  // Pas d'alias dans inscFilter pour éviter les conflits selon la requête
  const inscFilter    = anneeId ? `AND annee_academique_id = ${anneeId}` : ''
  const inscFilterAlias = anneeId ? `AND i.annee_academique_id = ${anneeId}` : ''
  const [parFiliere, parStatut, evoInsc] = await Promise.all([
    pool.query(`
      SELECT COALESCE(f.nom, 'Non assignée') AS nom, COUNT(i.id)::int AS cnt
      FROM inscriptions i
      LEFT JOIN filieres f ON i.filiere_id = f.id
      WHERE i.statut NOT IN ('abandonne') ${inscFilterAlias}
      GROUP BY f.nom
      ORDER BY cnt DESC
    `),
    pool.query(`
      SELECT statut, COUNT(*)::int AS total
      FROM inscriptions
      WHERE TRUE ${inscFilter}
      GROUP BY statut
      ORDER BY total DESC
    `),
    pool.query(`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', $1::date),
          LEAST(date_trunc('month', $2::date), date_trunc('month', NOW())),
          INTERVAL '1 month'
        ) AS m
      ),
      ins AS (
        SELECT date_trunc('month', i.created_at) AS m, COUNT(*)::int AS cnt
        FROM inscriptions i
        WHERE TRUE ${inscFilterAlias}
        GROUP BY 1
      )
      SELECT to_char(months.m, 'Mon YY') AS mois, COALESCE(ins.cnt, 0)::int AS count
      FROM months
      LEFT JOIN ins ON ins.m = months.m
      ORDER BY months.m
    `, [dateDebut, dateFin]),
  ])

  const totalEtudiants = parFiliere.rows.reduce((s: number, r: any) => s + r.cnt, 0)

  return c.json({
    annee: anneeRow ? { id: anneeRow.id, libelle: anneeRow.libelle } : null,
    financier: {
      encaisse_annee,
      depenses_annee,
      solde: encaisse_annee - depenses_annee,
      taux_recouvrement,
      attendu,
      evolution_6_mois: evo6,
    },
    pedagogique: {
      nb_seances,
      nb_seances_realisees,
      taux_presence,
      nb_ues: nbUes.rows[0].val,
      nb_etudiants_notes: nbNotes.rows[0].val,
    },
    rh: {
      enseignants_actifs: nbIntervenants.rows[0].val,
      intervenants_actifs: ensActifs.rows[0].val,
      volume_horaire: Math.round(volH.rows[0].val),
      repartition_mode,
    },
    etudiants: {
      par_filiere: parFiliere.rows.map((r: any) => ({
        nom: r.nom,
        count: r.cnt,
        pct: totalEtudiants > 0 ? Math.round((r.cnt / totalEtudiants) * 100) : 0,
      })),
      par_statut: parStatut.rows,
      evolution_inscriptions: evoInsc.rows,
    },
  })
})

// ─── INFRASTRUCTURES ──────────────────────────────────────────────────────────
app.get('/infrastructures', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM infrastructures ORDER BY categorie, ordre, designation')
  return c.json(rows)
})
app.post('/infrastructures', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `INSERT INTO infrastructures (designation,categorie,nombre,etat,ordre) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [b.designation, b.categorie ?? 'Pédagogie', b.nombre ?? 1, b.etat ?? 'Bon/Fonctionnel', b.ordre ?? 0]
  )
  return c.json(rows[0], 201)
})
app.put('/infrastructures/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE infrastructures SET designation=$1,categorie=$2,nombre=$3,etat=$4,ordre=$5 WHERE id=$6 RETURNING *`,
    [b.designation, b.categorie, b.nombre, b.etat, b.ordre ?? 0, c.req.param('id')]
  )
  return c.json(rows[0])
})
app.delete('/infrastructures/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM infrastructures WHERE id=$1', [c.req.param('id')])
  return c.json({ ok: true })
})

// ─── MATÉRIELS PÉDAGOGIQUES ───────────────────────────────────────────────────
app.get('/materiels', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM materiels_pedagogiques ORDER BY ordre, designation')
  return c.json(rows)
})
app.post('/materiels', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `INSERT INTO materiels_pedagogiques (designation,nombre,etat,ordre) VALUES ($1,$2,$3,$4) RETURNING *`,
    [b.designation, b.nombre ?? 1, b.etat ?? 'Bon/Fonctionnel', b.ordre ?? 0]
  )
  return c.json(rows[0], 201)
})
app.put('/materiels/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE materiels_pedagogiques SET designation=$1,nombre=$2,etat=$3,ordre=$4 WHERE id=$5 RETURNING *`,
    [b.designation, b.nombre, b.etat, b.ordre ?? 0, c.req.param('id')]
  )
  return c.json(rows[0])
})
app.delete('/materiels/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM materiels_pedagogiques WHERE id=$1', [c.req.param('id')])
  return c.json({ ok: true })
})

// ─── RAPPORT MINISTÈRE ────────────────────────────────────────────────────────
app.get('/rapports-ministere', requireAuth, async (c) => {
  const anneeIdParam = c.req.query('annee_id')
  const type = c.req.query('type') ?? 'rentree' // 'rentree' | 'fin_annee'

  // Résolution année académique
  let anneeRow: any = null
  if (anneeIdParam) {
    const { rows } = await pool.query('SELECT * FROM annees_academiques WHERE id=$1', [anneeIdParam])
    anneeRow = rows[0] ?? null
  }
  if (!anneeRow) {
    const { rows } = await pool.query("SELECT * FROM annees_academiques WHERE actif=true LIMIT 1")
    anneeRow = rows[0] ?? null
  }
  const anneeId = anneeRow?.id ?? null

  // Paramètres établissement
  const { rows: paramsRows } = await pool.query("SELECT cle, valeur FROM parametres_systeme WHERE groupe='etablissement'")
  const params: Record<string, string> = {}
  for (const p of paramsRows) params[p.cle] = p.valeur

  if (type === 'rentree') {
    // Étudiants inscrits par classe (groupés)
    const { rows: etudiants } = await pool.query(`
      SELECT
        e.prenom, e.nom,
        TO_CHAR(e.date_naissance, 'DD/MM/YYYY') AS date_naissance,
        e.lieu_naissance,
        c.id AS classe_id, c.nom AS classe,
        COALESCE(f.nom, '') AS filiere,
        aa.date_debut, aa.date_fin
      FROM inscriptions i
      JOIN etudiants e    ON i.etudiant_id = e.id
      JOIN classes c      ON i.classe_id   = c.id
      LEFT JOIN filieres f ON i.filiere_id = f.id
      LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
      WHERE i.annee_academique_id = $1
        AND i.statut NOT IN ('abandonne', 'pre_inscrit')
      ORDER BY f.nom, c.nom, e.nom, e.prenom
    `, [anneeId])

    // Frais par classe (première échéance de chaque type)
    const { rows: fraisRows } = await pool.query(`
      SELECT DISTINCT ON (i.classe_id, e.type_echeance)
        i.classe_id,
        e.type_echeance,
        e.montant
      FROM echeances e
      JOIN inscriptions i ON e.inscription_id = i.id
      WHERE i.annee_academique_id = $1
      ORDER BY i.classe_id, e.type_echeance, e.montant DESC
    `, [anneeId])
    const fraisMap: Record<number, Record<string, number>> = {}
    for (const f of fraisRows) {
      if (!fraisMap[f.classe_id]) fraisMap[f.classe_id] = {}
      fraisMap[f.classe_id][f.type_echeance] = Number(f.montant)
    }

    // Unités d'enseignement par classe
    const { rows: ues } = await pool.query(`
      SELECT
        ue.id, ue.code, ue.intitule, ue.intitule_ue, ue.categorie_ue,
        ue.cm, ue.td, ue.tp, ue.tpe, ue.volume_horaire,
        ue.credits_ects, ue.semestre,
        c.id AS classe_id, c.nom AS classe,
        COALESCE(f.nom,'') AS filiere
      FROM unites_enseignement ue
      JOIN classes c      ON ue.classe_id   = c.id
      LEFT JOIN filieres f ON c.filiere_id  = f.id
      WHERE c.annee_academique_id = $1
      ORDER BY f.nom, c.nom, ue.semestre, ue.categorie_ue, ue.code
    `, [anneeId])

    // Formateurs
    const { rows: formateurs } = await pool.query(`
      SELECT
        nom, prenom,
        TO_CHAR(date_naissance,'DD/MM/YYYY') AS date_naissance,
        lieu_naissance, sexe, diplome, grade, type_contrat, statut, specialite
      FROM enseignants
      WHERE statut = 'actif'
      ORDER BY nom, prenom
    `)

    // Personnel administratif (PATS)
    const { rows: pats } = await pool.query(`
      SELECT
        nom, prenom,
        TO_CHAR(date_naissance,'DD/MM/YYYY') AS date_naissance,
        lieu_naissance, diplome, grade, poste, fonction, statut
      FROM personnel
      WHERE statut = 'actif'
      ORDER BY nom, prenom
    `)

    // Infrastructures
    const { rows: infrastructures } = await pool.query('SELECT * FROM infrastructures ORDER BY categorie, ordre, designation')

    // Matériels
    const { rows: materiels } = await pool.query('SELECT * FROM materiels_pedagogiques ORDER BY ordre, designation')

    return c.json({ type, annee: anneeRow, params, etudiants, fraisMap, ues, formateurs, pats, infrastructures, materiels })

  } else {
    // Fin d'année
    // Résultats par classe (jury_decisions clôturés)
    const { rows: resultats } = await pool.query(`
      SELECT
        e.prenom, e.nom,
        TO_CHAR(e.date_naissance,'DD/MM/YYYY') AS date_naissance,
        e.lieu_naissance,
        c.id AS classe_id, c.nom AS classe,
        COALESCE(f.nom,'') AS filiere,
        jd.decision,
        j.session
      FROM jury_decisions jd
      JOIN jurys j         ON jd.jury_id        = j.id
      JOIN inscriptions i  ON jd.inscription_id = i.id
      JOIN etudiants e     ON i.etudiant_id      = e.id
      JOIN classes c       ON i.classe_id        = c.id
      LEFT JOIN filieres f ON i.filiere_id       = f.id
      WHERE j.annee_academique_id = $1
        AND j.statut = 'cloture'
      ORDER BY f.nom, c.nom, j.session, e.nom, e.prenom
    `, [anneeId])

    // Modes d'enseignement utilisés cette année
    const { rows: modes } = await pool.query(`
      SELECT mode, COUNT(*)::int AS cnt
      FROM seances
      WHERE annee_academique_id = $1 AND mode IS NOT NULL
      GROUP BY mode ORDER BY cnt DESC
    `, [anneeId])

    // Statistiques séances
    const { rows: statsSeances } = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN statut='effectue' THEN 1 END)::int AS effectuees
      FROM seances WHERE annee_academique_id = $1
    `, [anneeId])

    return c.json({ type, annee: anneeRow, params, resultats, modes, statsSeances: statsSeances[0] })
  }
})

// ─── RAPPORTS RÉSULTATS (jury + notes) ───────────────────────────────────────
app.get('/rapports/resultats', requireAuth, async (c) => {
  // Résolution de l'année académique
  const anneeIdParam = c.req.query('annee_id')
  let anneeRow: any = null
  if (anneeIdParam) {
    const { rows } = await pool.query('SELECT * FROM annees_academiques WHERE id=$1', [anneeIdParam])
    anneeRow = rows[0] ?? null
  }
  if (!anneeRow) {
    const { rows } = await pool.query("SELECT * FROM annees_academiques WHERE actif=true LIMIT 1")
    anneeRow = rows[0] ?? null
  }
  if (!anneeRow) {
    const { rows } = await pool.query("SELECT * FROM annees_academiques ORDER BY date_debut DESC LIMIT 1")
    anneeRow = rows[0] ?? null
  }
  const anneeId: number | null = anneeRow?.id ?? null
  const anneeFilter = anneeId ? `AND j.annee_academique_id = ${anneeId}` : ''
  const inscAnneeFilter = anneeId ? `AND i.annee_academique_id = ${anneeId}` : ''

  // ── Taux de réussite par filière + session ─────────────────────────────────
  const { rows: parFiliere } = await pool.query(`
    SELECT
      COALESCE(f.nom, 'Non assignée') AS filiere,
      j.session,
      COUNT(jd.id)::int AS total,
      COUNT(CASE WHEN jd.decision = 'admis'      THEN 1 END)::int AS admis,
      COUNT(CASE WHEN jd.decision = 'rattrapage' THEN 1 END)::int AS rattrapage,
      COUNT(CASE WHEN jd.decision = 'redoublant' THEN 1 END)::int AS redoublant,
      COUNT(CASE WHEN jd.decision = 'exclus'     THEN 1 END)::int AS exclus,
      ROUND(
        COUNT(CASE WHEN jd.decision = 'admis' THEN 1 END)::numeric
        / NULLIF(COUNT(jd.id), 0) * 100
      )::int AS taux_reussite
    FROM jury_decisions jd
    JOIN jurys j         ON jd.jury_id       = j.id
    JOIN inscriptions i  ON jd.inscription_id = i.id
    LEFT JOIN filieres f ON i.filiere_id      = f.id
    WHERE j.statut = 'cloture' ${anneeFilter}
    GROUP BY f.nom, j.session
    ORDER BY f.nom, j.session
  `)

  // ── Moyennes par filière — une ligne par (filière, session) ──────────────
  // Utilise un CTE pour éviter les doublons dus à plusieurs jurys par classe
  const { rows: evolMoy } = await pool.query(`
    WITH jury_unique AS (
      SELECT DISTINCT ON (i.filiere_id, j.session)
        j.id AS jury_id, i.filiere_id, j.session
      FROM jurys j
      JOIN inscriptions i ON i.classe_id = j.classe_id
      WHERE j.statut = 'cloture' ${anneeFilter}
      ORDER BY i.filiere_id, j.session, j.id DESC
    ),
    moyennes AS (
      SELECT
        ju.filiere_id,
        ju.session,
        ROUND(AVG(
          CASE WHEN n.note IS NOT NULL THEN n.note
               ELSE COALESCE(n.note_controle,0)*0.4 + COALESCE(n.note_examen,0)*0.6
          END
        )::numeric, 2)::float AS moyenne
      FROM notes n
      JOIN inscriptions i ON n.inscription_id = i.id
      JOIN jury_unique ju ON ju.filiere_id = i.filiere_id AND ju.session = n.session
      GROUP BY ju.filiere_id, ju.session
    )
    SELECT COALESCE(f.nom, 'Non assignée') AS filiere, m.session, m.moyenne
    FROM moyennes m
    LEFT JOIN filieres f ON m.filiere_id = f.id
    ORDER BY m.session, f.nom
  `)

  // ── Global ─────────────────────────────────────────────────────────────────
  const { rows: glob } = await pool.query(`
    SELECT
      COUNT(jd.id)::int AS total_decisions,
      COUNT(DISTINCT j.id)::int AS total_jurys,
      COUNT(CASE WHEN jd.decision = 'admis' THEN 1 END)::int AS total_admis,
      ROUND(
        COUNT(CASE WHEN jd.decision = 'admis' THEN 1 END)::numeric
        / NULLIF(COUNT(jd.id), 0) * 100
      )::int AS taux_global
    FROM jury_decisions jd
    JOIN jurys j ON jd.jury_id = j.id
    WHERE j.statut = 'cloture' ${anneeFilter}
  `)

  // ── Top étudiants (meilleures moyennes sur la session normale) ─────────────
  const { rows: topEtudiants } = await pool.query(`
    SELECT
      e.prenom || ' ' || e.nom AS etudiant,
      e.numero_etudiant,
      COALESCE(f.nom, 'Non assignée') AS filiere,
      jd_top.session,
      jd_top.decision,
      ROUND(AVG(
        CASE WHEN n.note IS NOT NULL THEN n.note
             ELSE COALESCE(n.note_controle,0)*0.4 + COALESCE(n.note_examen,0)*0.6
        END
      )::numeric, 2)::float AS moyenne
    FROM (
      SELECT DISTINCT ON (jd.inscription_id, j.session)
        jd.inscription_id, jd.decision, j.session, j.id AS jury_id
      FROM jury_decisions jd
      JOIN jurys j ON jd.jury_id = j.id
      WHERE j.statut = 'cloture' AND jd.decision = 'admis' ${anneeFilter}
      ORDER BY jd.inscription_id, j.session
    ) jd_top
    JOIN inscriptions i  ON jd_top.inscription_id = i.id
    JOIN etudiants e     ON i.etudiant_id = e.id
    LEFT JOIN filieres f ON i.filiere_id  = f.id
    LEFT JOIN notes n    ON n.inscription_id = i.id AND n.session = jd_top.session
    GROUP BY e.prenom, e.nom, e.numero_etudiant, f.nom, jd_top.session, jd_top.decision
    ORDER BY moyenne DESC NULLS LAST
    LIMIT 10
  `)

  return c.json({
    annee: anneeRow ? { id: anneeRow.id, libelle: anneeRow.libelle } : null,
    par_filiere: parFiliere,
    evol_moyennes: evolMoy,
    global: glob[0] ?? { total_decisions: 0, total_jurys: 0, total_admis: 0, taux_global: 0 },
    top_etudiants: topEtudiants,
  })
})

// ─── CONVERSATIONS ────────────────────────────────────────────────────────────
app.get('/conversations', requireAuth, async (c) => {
  const userId = u(c).id
  const { rows } = await pool.query(`
    SELECT
      c.*,
      COALESCE(
        (SELECT json_agg(jsonb_build_object('id', us.id, 'nom', us.nom, 'prenom', us.prenom, 'role', us.role))
         FROM conversation_participants cp2
         JOIN users us ON cp2.user_id = us.id
         WHERE cp2.conversation_id = c.id),
        '[]'::json
      ) AS participants,
      (SELECT jsonb_build_object('contenu', m.contenu, 'created_at', m.created_at, 'sender',
          CASE WHEN ms.id IS NOT NULL THEN ms.prenom || ' ' || ms.nom ELSE NULL END)
       FROM messages m LEFT JOIN users ms ON m.sender_id = ms.id
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC LIMIT 1
      ) AS dernier_message,
      (SELECT COUNT(*)::int
       FROM messages m2
       LEFT JOIN conversation_participants cp3 ON cp3.conversation_id = m2.conversation_id AND cp3.user_id = $1
       WHERE m2.conversation_id = c.id
         AND (cp3.dernier_lu_at IS NULL OR m2.created_at > cp3.dernier_lu_at)
         AND m2.sender_id != $1
      ) AS nb_non_lus
    FROM conversations c
    WHERE EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $1)
    ORDER BY COALESCE(c.updated_at, c.created_at) DESC
  `, [userId])
  return c.json(rows)
})

app.get('/conversations/:id', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM conversations WHERE id=$1', [c.req.param('id')])
  if (!rows[0]) return c.json({ message: 'Conversation introuvable.' }, 404)
  const { rows: messages } = await pool.query(`
    SELECT m.*, jsonb_build_object('id',us.id,'nom',us.nom,'prenom',us.prenom) as sender
    FROM messages m LEFT JOIN users us ON m.sender_id = us.id
    WHERE m.conversation_id=$1 ORDER BY m.created_at ASC
  `, [c.req.param('id')])
  return c.json({ ...rows[0], messages })
})

// Créer une conversation groupée (classe, filière, tous, ou personne)
app.post('/conversations/groupe', requireAuth, async (c) => {
  const body = await c.req.json()
  const { cible, cible_id, sujet } = body as { cible: string; cible_id?: string; sujet?: string }

  let userIds: number[] = []
  let convNom = sujet || ''

  if (cible === 'tous') {
    // Tous les enseignants + étudiants ayant un compte actif
    const { rows } = await pool.query(`
      SELECT DISTINCT u.id FROM users u
      WHERE u.role = 'enseignant' AND u.statut = 'actif'
      UNION
      SELECT DISTINCT u.id FROM users u
      JOIN etudiants et ON u.email = et.email
      JOIN inscriptions i ON i.etudiant_id = et.id
      WHERE i.statut = 'inscrit_actif' AND u.statut = 'actif'
    `)
    userIds = rows.map((r: any) => Number(r.id))
    convNom = convNom || '📢 Message à tous'
  } else if (cible === 'classe' && cible_id) {
    // Récupérer infos de la classe (tronc commun ou pas)
    const { rows: cls } = await pool.query(`SELECT nom, est_tronc_commun FROM classes WHERE id=$1`, [cible_id])
    const className = cls[0]?.nom ?? 'Classe'
    const estTroncCommun = cls[0]?.est_tronc_commun ?? false

    // Étudiants inscrits directement OU dans une classe qui a ce tronc commun
    // Lien via email (etudiants.user_id n'est pas toujours renseigné)
    const { rows } = await pool.query(`
      SELECT DISTINCT u.id FROM inscriptions i
      JOIN etudiants et ON et.id = i.etudiant_id
      JOIN users u ON u.email = et.email
      WHERE (
        i.classe_id = $1
        OR ($2 AND i.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = $1))
      )
      AND i.statut = 'inscrit_actif' AND u.statut = 'actif'
    `, [cible_id, estTroncCommun])

    // Enseignants dont les UEs sont dans cette classe OU dans les classes du tronc commun
    const { rows: ens } = await pool.query(`
      SELECT DISTINCT u.id FROM unites_enseignement ue
      JOIN enseignants e ON e.id = ue.enseignant_id
      JOIN users u ON u.id = e.user_id
      WHERE (
        ue.classe_id = $1
        OR ($2 AND ue.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = $1))
      )
      AND u.statut = 'actif'
    `, [cible_id, estTroncCommun])

    userIds = [...rows, ...ens].map((r: any) => Number(r.id))
    convNom = convNom || `🏫 ${className}`
  } else if (cible === 'filiere' && cible_id) {
    // Tous les étudiants des classes de la filière
    const { rows: fil } = await pool.query(`SELECT nom FROM filieres WHERE id=$1`, [cible_id])
    const filName = fil[0]?.nom ?? 'Filière'
    const { rows } = await pool.query(`
      SELECT DISTINCT u.id FROM inscriptions i
      JOIN etudiants et ON et.id = i.etudiant_id
      JOIN users u ON u.email = et.email
      JOIN classes cl ON cl.id = i.classe_id
      WHERE cl.filiere_id=$1 AND i.statut='inscrit_actif' AND u.statut='actif'
    `, [cible_id])
    // Enseignants de la filière
    const { rows: ens } = await pool.query(`
      SELECT DISTINCT u.id FROM unites_enseignement ue
      JOIN enseignants e ON e.id = ue.enseignant_id
      JOIN users u ON u.id = e.user_id
      JOIN classes cl ON cl.id = ue.classe_id
      WHERE cl.filiere_id=$1 AND u.statut='actif'
    `, [cible_id])
    userIds = [...rows, ...ens].map((r: any) => Number(r.id))
    convNom = convNom || `📚 ${filName}`
  } else if (cible === 'personne' && cible_id) {
    // Message direct à une personne
    userIds = [Number(cible_id)]
    const { rows } = await pool.query(`SELECT nom,prenom FROM users WHERE id=$1`, [cible_id])
    convNom = convNom || (rows[0] ? `${rows[0].prenom} ${rows[0].nom}` : 'Message direct')
  }

  // Toujours inclure l'expéditeur
  userIds = Array.from(new Set([...userIds, Number(u(c).id)]))

  const type = userIds.length > 2 ? 'groupe' : 'direct'
  const { rows: convRows } = await pool.query(
    `INSERT INTO conversations (nom,type,couleur,created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
    [convNom, type, '#6366f1', u(c).id]
  )
  const conv = convRows[0]
  for (const uid of userIds) {
    await pool.query(
      `INSERT INTO conversation_participants (conversation_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [conv.id, uid]
    )
  }
  return c.json(conv, 201)
})

app.post('/conversations', requireAuth, async (c) => {
  const body = await c.req.json()
  const { rows } = await pool.query(
    "INSERT INTO conversations (nom,type,couleur,created_by) VALUES ($1,$2,$3,$4) RETURNING *",
    [body.nom || null, body.type || 'direct', body.couleur || '#3b82f6', u(c).id]
  )
  const conv = rows[0]
  await pool.query('INSERT INTO conversation_participants (conversation_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [conv.id, u(c).id])
  if (Array.isArray(body.participant_ids)) {
    for (const pid of body.participant_ids)
      await pool.query('INSERT INTO conversation_participants (conversation_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [conv.id, pid])
  }
  if (Array.isArray(body.user_ids)) {
    for (const pid of body.user_ids)
      await pool.query('INSERT INTO conversation_participants (conversation_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [conv.id, pid])
  }
  return c.json(conv, 201)
})

app.post('/conversations/:id/messages', requireAuth, async (c) => {
  const body = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO messages (conversation_id,sender_id,contenu) VALUES ($1,$2,$3) RETURNING *',
    [c.req.param('id'), u(c).id, body.contenu]
  )
  await pool.query('UPDATE conversations SET updated_at=NOW() WHERE id=$1', [c.req.param('id')])
  return c.json(rows[0], 201)
})

// Supprimer un message (expéditeur ou admin/dg)
app.delete('/messages/:id', requireAuth, async (c) => {
  const msgId = c.req.param('id')
  const userId = u(c).id
  const userRole = u(c).role
  const { rows } = await pool.query('SELECT * FROM messages WHERE id=$1', [msgId])
  if (!rows.length) return c.json({ message: 'Message introuvable.' }, 404)
  const msg = rows[0]
  // Seul l'expéditeur ou un admin/dg peut supprimer
  if (String(msg.sender_id) !== String(userId) && !['dg','dir_peda','coordinateur'].includes(userRole as string)) {
    return c.json({ message: 'Non autorisé.' }, 403)
  }
  await pool.query('DELETE FROM messages WHERE id=$1', [msgId])
  return c.json({ message: 'Message supprimé.' })
})

// Supprimer une conversation (créateur ou dg/coordinateur)
app.delete('/conversations/:id', requireAuth, async (c) => {
  const convId = c.req.param('id')
  const userId = u(c).id
  const userRole = u(c).role
  const { rows } = await pool.query('SELECT * FROM conversations WHERE id=$1', [convId])
  if (!rows.length) return c.json({ message: 'Conversation introuvable.' }, 404)
  const conv = rows[0]
  if (String(conv.created_by) !== String(userId) && !['dg','dir_peda','coordinateur'].includes(userRole as string)) {
    return c.json({ message: 'Non autorisé.' }, 403)
  }
  await pool.query('DELETE FROM messages WHERE conversation_id=$1', [convId])
  await pool.query('DELETE FROM conversation_participants WHERE conversation_id=$1', [convId])
  await pool.query('DELETE FROM conversations WHERE id=$1', [convId])
  return c.json({ message: 'Conversation supprimée.' })
})

// ─── ANNONCES ─────────────────────────────────────────────────────────────────
app.get('/annonces', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT a.*, jsonb_build_object('id',us.id,'nom',us.nom,'prenom',us.prenom) as auteur
    FROM annonces a LEFT JOIN users us ON a.created_by = us.id
    ORDER BY a.created_at DESC
  `)
  return c.json(rows)
})

const annonceRoles: MiddlewareHandler<Env> = role('dg', 'dir_peda', 'coordinateur', 'secretariat')

app.post('/annonces', requireAuth, annonceRoles, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    "INSERT INTO annonces (titre,type,contenu,destinataires,canaux,statut,epingle,created_by) VALUES ($1,$2,$3,$4,$5,'brouillon',$6,$7) RETURNING *",
    [b.titre, b.type || 'info', b.contenu, JSON.stringify(b.destinataires || ['tous']),
     JSON.stringify(b.canaux || ['messagerie']), b.epingle ?? false, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.put('/annonces/:id', requireAuth, annonceRoles, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE annonces SET titre=$1,type=$2,contenu=$3,destinataires=$4,canaux=$5,epingle=$6 WHERE id=$7 RETURNING *',
    [b.titre, b.type || 'info', b.contenu, JSON.stringify(b.destinataires || ['tous']),
     JSON.stringify(b.canaux || ['messagerie']), b.epingle ?? false, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/annonces/:id', requireAuth, annonceRoles, async (c) => {
  await pool.query('DELETE FROM annonces WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

app.post('/annonces/:id/publier', requireAuth, annonceRoles, async (c) => {
  const { rows } = await pool.query("UPDATE annonces SET statut='publie',publie_at=NOW() WHERE id=$1 RETURNING *", [c.req.param('id')])
  return c.json(rows[0])
})

// ─── ESPACE ETUDIANT ──────────────────────────────────────────────────────────
app.get('/espace-etudiant/dashboard', requireAuth, role('etudiant'), async (c) => {
  const currentUser = u(c) as any

  // 1. Find student by email
  const { rows: etudRows } = await pool.query(
    `SELECT * FROM etudiants WHERE email = $1`,
    [currentUser.email]
  )
  if (!etudRows[0]) return c.json({ message: 'Aucun étudiant lié à ce compte.' }, 404)
  const etudiant = etudRows[0]

  // 2. Find active inscription (prefer 'inscrit_actif', fallback to latest)
  const { rows: inscRows } = await pool.query(`
    SELECT i.*,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom,'date_debut_cours',c.date_debut_cours) ELSE NULL END as classe_obj,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code) ELSE NULL END as filiere_obj,
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_obj
    FROM inscriptions i
    LEFT JOIN classes c ON i.classe_id = c.id
    LEFT JOIN filieres f ON i.filiere_id = f.id
    LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
    WHERE i.etudiant_id = $1
    ORDER BY CASE WHEN i.statut = 'inscrit_actif' THEN 0 ELSE 1 END, i.id DESC
    LIMIT 1
  `, [etudiant.id])
  const insc = inscRows[0] || null

  // 2b. Check for FI (formation individuelle)
  const { rows: fiRows } = await pool.query(`
    SELECT fi.*,
      CASE WHEN tf.id IS NOT NULL THEN jsonb_build_object('id',tf.id,'nom',tf.nom) ELSE NULL END as type_formation,
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_academique_obj,
      COALESCE((SELECT json_agg(json_build_object(
        'id',fm.id,'matiere_nom',m.nom,'volume_horaire',fm.volume_horaire,'heures_effectuees',fm.heures_effectuees,
        'enseignant_nom',CASE WHEN ens.id IS NOT NULL THEN ens.prenom||' '||ens.nom ELSE NULL END
      )) FROM fi_modules fm LEFT JOIN matieres m ON fm.matiere_id=m.id LEFT JOIN enseignants ens ON fm.enseignant_id=ens.id
        WHERE fm.formation_individuelle_id=fi.id), '[]') as modules,
      COALESCE((SELECT json_agg(json_build_object(
        'id',fp.id,'type',fp.type,'montant',fp.montant,'montant_paye',fp.montant_paye,'statut',fp.statut,
        'date_echeance',fp.date_echeance,'date_paiement',fp.date_paiement
      )) FROM fi_paiements fp WHERE fp.formation_individuelle_id=fi.id), '[]') as fi_paiements
    FROM formations_individuelles fi
    LEFT JOIN types_formation tf ON fi.type_formation_id=tf.id
    LEFT JOIN annees_academiques aa ON fi.annee_academique_id=aa.id
    WHERE fi.etudiant_id=$1
    ORDER BY fi.created_at DESC LIMIT 1
  `, [etudiant.id])
  const fiData = fiRows[0] || null

  if (!insc && !fiData) return c.json({ message: 'Aucune inscription trouvée.' }, 404)

  // 3. Financial stats — classic
  let frais_totaux = 0, total_paye = 0, restant_du = 0
  let allPaiementsRows: any[] = []
  let allEcheancesRows: any[] = []
  if (insc) {
    const [echeancesRes, echeancesListRes, paiementsRes, allPaiementsRes] = await Promise.all([
      pool.query(`SELECT COALESCE(SUM(montant), 0)::float AS total FROM echeances WHERE inscription_id = $1`, [insc.id]),
      pool.query(`SELECT * FROM echeances WHERE inscription_id = $1 ORDER BY mois ASC`, [insc.id]),
      pool.query(`SELECT COALESCE(SUM(montant), 0)::float AS total FROM paiements WHERE inscription_id = $1 AND statut = 'confirme'`, [insc.id]),
      pool.query(`SELECT * FROM paiements WHERE inscription_id = $1 ORDER BY created_at DESC LIMIT 50`, [insc.id]),
    ])
    frais_totaux = echeancesRes.rows[0].total || 0
    total_paye = paiementsRes.rows[0].total || 0
    restant_du = Math.max(0, frais_totaux - total_paye)
    allPaiementsRows = allPaiementsRes.rows
    allEcheancesRows = echeancesListRes.rows
  }

  // 3b. Financial stats — FI (always computed separately)
  let fi_frais_totaux = 0, fi_total_paye = 0, fi_restant_du = 0
  if (fiData) {
    fi_frais_totaux = parseFloat(fiData.cout_total) || 0
    const fiPaiements = fiData.fi_paiements || []
    fi_total_paye = fiPaiements.reduce((s: number, p: any) => s + (parseFloat(p.montant_paye) || 0), 0)
    fi_restant_du = Math.max(0, fi_frais_totaux - fi_total_paye)
  }

  // Récupérer les tronc commun IDs de la classe (many-to-many) — utilisé par notes ET séances
  let troncCommunIds: number[] = []
  if (insc?.classe_id) {
    const { rows: classeInfoRows } = await pool.query(
      'SELECT tronc_commun_id FROM classe_tronc_commun WHERE classe_id=$1', [insc.classe_id]
    )
    troncCommunIds = classeInfoRows.map((r: any) => r.tronc_commun_id)
  }

  // 4. Notes (if classe exists)
  let notesData: any = { ues: [], moyenne_generale: null, mention: null, rang: null }
  if (insc?.classe_id) {

    // Charger les UEs : tronc commun EN PREMIER, puis spécifiques à la classe
    const [uesTroncRes, uesSpecRes, notesRes] = await Promise.all([
      troncCommunIds.length > 0
        ? pool.query(`SELECT * FROM unites_enseignement WHERE classe_id = ANY($1::int[]) ORDER BY ordre, code`, [troncCommunIds])
        : Promise.resolve({ rows: [] as any[] }),
      pool.query(`SELECT * FROM unites_enseignement WHERE classe_id = $1 ORDER BY ordre, code`, [insc.classe_id]),
      pool.query(`SELECT * FROM notes WHERE inscription_id = $1 AND session IN ('normale','rattrapage') ORDER BY session`, [insc.id]),
    ])
    const allUes = [...(uesTroncRes as any).rows, ...(uesSpecRes as any).rows]

    // Charger les coefficients depuis filiere_matiere pour la filière de l'étudiant
    const studentFiliereId = insc.filiere_id ?? null
    const filierePivotMap: Record<number, { coefficient: number; credits: number }> = {}
    if (studentFiliereId) {
      const { rows: pivotRows } = await pool.query(
        `SELECT matiere_id, coefficient::float as coefficient, credits FROM filiere_matiere WHERE filiere_id = $1`,
        [studentFiliereId]
      )
      pivotRows.forEach((p: any) => {
        filierePivotMap[p.matiere_id] = { coefficient: parseFloat(p.coefficient) || 1, credits: parseInt(p.credits) || 0 }
      })
    }

    const noteMap: Record<number, number> = {}
    // Priorité session normale > rattrapage
    notesRes.rows.forEach((n: any) => {
      if (noteMap[n.ue_id] === undefined || n.session === 'normale') {
        noteMap[n.ue_id] = parseFloat(n.note)
      }
    })

    let totalPts = 0, totalCoef = 0
    const ues = allUes.map((ue: any) => {
      const note = noteMap[ue.id] ?? null
      // Crédits et coefficient toujours depuis l'UE de la classe (classe-spécifique)
      const coef = parseFloat(ue.coefficient) || 1
      const credits = parseFloat(ue.credits_ects) || 0
      if (note !== null) { totalPts += note * coef; totalCoef += coef }
      return { ue_id: ue.id, intitule: ue.intitule || ue.code, coefficient: coef, credits, note }
    })

    const moyenne = totalCoef > 0 ? Math.round(totalPts / totalCoef * 100) / 100 : null
    let mention: string | null = null
    if (moyenne !== null) {
      if (moyenne >= 16) mention = 'Très Bien'
      else if (moyenne >= 14) mention = 'Bien'
      else if (moyenne >= 12) mention = 'Assez Bien'
      else if (moyenne >= 10) mention = 'Passable'
    }

    // Rang: compare moyennes of all inscriptions in same classe
    let rang: number | null = null
    if (moyenne !== null) {
      const { rows: classInscs } = await pool.query(
        `SELECT ins.id FROM inscriptions ins WHERE ins.classe_id = $1 AND ins.statut = 'inscrit_actif'`,
        [insc.classe_id]
      )
      const classInscIds = classInscs.map((r: any) => r.id)
      if (classInscIds.length > 1) {
        // Charger notes + UEs + filière de chaque inscription pour les coefficients corrects
        const { rows: allNotes } = await pool.query(
          `SELECT n.inscription_id, n.note, ue.coefficient as ue_coef, ue.matiere_id,
                  ins.filiere_id,
                  COALESCE(fm.coefficient, ue.coefficient, 1)::float as coef_effectif
           FROM notes n
           JOIN unites_enseignement ue ON n.ue_id = ue.id
           JOIN inscriptions ins ON n.inscription_id = ins.id
           LEFT JOIN filiere_matiere fm ON fm.filiere_id = ins.filiere_id AND fm.matiere_id = ue.matiere_id
           WHERE n.inscription_id = ANY($1) AND n.session = 'normale'`,
          [classInscIds]
        )
        const moyMap: Record<number, number> = {}
        for (const id of classInscIds) {
          const ns = allNotes.filter((n: any) => n.inscription_id === id)
          let tp = 0, tc = 0
          for (const n of ns) { tp += parseFloat(n.note) * (parseFloat(n.coef_effectif) || 1); tc += parseFloat(n.coef_effectif) || 1 }
          if (tc > 0) moyMap[id] = tp / tc
        }
        const myMoy = moyMap[insc.id]
        if (myMoy !== undefined) {
          rang = Object.values(moyMap).filter(m => m > myMoy).length + 1
        }
      }
    }

    notesData = { ues, moyenne_generale: moyenne, mention, rang }
  }

  // 5. Présences stats
  const { rows: presRows } = insc ? await pool.query(
    `SELECT statut, COUNT(*)::int as cnt FROM presences WHERE inscription_id = $1 GROUP BY statut`,
    [insc.id]
  ) : { rows: [] }
  let present = 0, retard = 0, absent = 0
  for (const r of presRows) {
    if (r.statut === 'present') present = r.cnt
    else if (r.statut === 'retard') retard = r.cnt
    else if (r.statut === 'absent') absent = r.cnt
  }
  const total = present + retard + absent
  const presencesData = {
    present, retard, absent, total,
    taux_presence: total > 0 ? Math.round(((present + retard) / total) * 100) : 100,
  }

  // 6a. Nettoyage HTML dans la DB (await — garanti à chaque requête)
  await pool.query(`
    UPDATE seances
    SET
      contenu_seance = trim(regexp_replace(contenu_seance, '<[^>]*>', ' ', 'g')),
      objectifs      = trim(regexp_replace(objectifs,      '<[^>]*>', ' ', 'g')),
      notes          = trim(regexp_replace(notes,          '<[^>]*>', ' ', 'g'))
    WHERE (contenu_seance IS NOT NULL AND contenu_seance LIKE '%<%')
       OR (objectifs      IS NOT NULL AND objectifs      LIKE '%<%')
       OR (notes          IS NOT NULL AND notes          LIKE '%<%')
  `).catch(() => {})

  // 6. Séances : semaine en cours + futures + tous les cours effectués
  let seancesSemaine: any[] = []
  let seancesPassees: any[] = []
  let seancesFutures: any[] = []
  const now = new Date()
  const day = now.getDay() === 0 ? 6 : now.getDay() - 1
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - day); weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999)

  if (insc?.classe_id) {
    // Inclure la classe de l'étudiant + ses troncs communs pour voir toutes les séances
    const classeIds = [insc.classe_id, ...troncCommunIds]
    // Nettoyage HTML directement en SQL (regexp_replace strip tags + entités)
    const stripHtmlSql = (col: string) =>
      `trim(regexp_replace(regexp_replace(${col}, '<[^>]*>', '', 'g'), '&[^;]{1,10};', ' ', 'g'))`
    const seanceQuery = `
      SELECT s.id, s.matiere, s.date_debut, s.date_fin, s.mode, s.salle, s.statut,
        ${stripHtmlSql('s.contenu_seance')} as contenu_seance,
        ${stripHtmlSql('s.objectifs')} as objectifs,
        ${stripHtmlSql('s.notes')} as notes,
        s.lien_visio,
        CASE WHEN iv.id IS NOT NULL THEN iv.prenom || ' ' || iv.nom ELSE NULL END as enseignant,
        pr.statut as presence_etudiant
      FROM seances s
      LEFT JOIN enseignants iv ON s.enseignant_id = iv.id
      LEFT JOIN presences pr ON pr.seance_id = s.id AND pr.inscription_id = $2
      WHERE s.classe_id = ANY($1::int[]) AND s.statut != 'annule'
    `
    const [{ rows: sWeek }, { rows: sPast }, { rows: sFuture }] = await Promise.all([
      pool.query(seanceQuery + ` AND s.date_debut >= $3 AND s.date_debut <= $4 ORDER BY s.date_debut ASC`,
        [classeIds, insc.id, now.toISOString(), weekEnd.toISOString()]),
      // Tous les cours effectués (pas de limite de date) pour permettre l'évaluation anonyme
      pool.query(seanceQuery + ` AND s.statut = 'effectue' ORDER BY s.date_debut DESC`,
        [classeIds, insc.id]),
      pool.query(seanceQuery + ` AND s.date_debut > $3 ORDER BY s.date_debut ASC`,
        [classeIds, insc.id, weekEnd.toISOString()]),
    ])
    seancesSemaine = sWeek
    seancesPassees = sPast
    seancesFutures = sFuture
  } else if (fiData) {
    // Séances FI : liées via fi_module_id
    const fiModuleIds = (fiData.modules || []).map((m: any) => m.id)
    if (fiModuleIds.length > 0) {
      const fiStripHtmlSql = (col: string) =>
        `trim(regexp_replace(regexp_replace(${col}, '<[^>]*>', '', 'g'), '&[^;]{1,10};', ' ', 'g'))`
      const fiSeanceQuery = `
        SELECT s.id, s.matiere, s.date_debut, s.date_fin, s.mode, s.salle, s.statut,
          ${fiStripHtmlSql('s.contenu_seance')} as contenu_seance,
          ${fiStripHtmlSql('s.objectifs')} as objectifs,
          ${fiStripHtmlSql('s.notes')} as notes,
          s.lien_visio,
          CASE WHEN iv.id IS NOT NULL THEN iv.prenom || ' ' || iv.nom ELSE NULL END as enseignant,
          NULL as presence_etudiant
        FROM seances s
        LEFT JOIN enseignants iv ON s.enseignant_id = iv.id
        WHERE s.fi_module_id = ANY($1) AND s.statut != 'annule'
      `
      const [{ rows: sWeek }, { rows: sPast }, { rows: sFuture }] = await Promise.all([
        pool.query(fiSeanceQuery + ` AND s.date_debut >= $2 AND s.date_debut <= $3 ORDER BY s.date_debut ASC`,
          [fiModuleIds, now.toISOString(), weekEnd.toISOString()]),
        // Tous les cours effectués pour permettre l'évaluation anonyme
        pool.query(fiSeanceQuery + ` AND s.statut = 'effectue' ORDER BY s.date_debut DESC`,
          [fiModuleIds]),
        pool.query(fiSeanceQuery + ` AND s.date_debut > $2 ORDER BY s.date_debut ASC`,
          [fiModuleIds, weekEnd.toISOString()]),
      ])
      seancesSemaine = sWeek
      seancesPassees = sPast
      seancesFutures = sFuture
    }
  }

  // 7. Annonces publiées récentes
  const { rows: annonces } = await pool.query(
    `SELECT id, titre, contenu, type, publie_at FROM annonces WHERE statut = 'publie' ORDER BY publie_at DESC LIMIT 5`
  )

  // 8. Conversations récentes
  const { rows: convRows } = await pool.query(`
    SELECT c.id, c.nom,
      (SELECT m.contenu FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as dernier_message,
      (SELECT COUNT(*)::int FROM messages m2
       LEFT JOIN conversation_participants cp3 ON cp3.conversation_id = m2.conversation_id AND cp3.user_id = $1
       WHERE m2.conversation_id = c.id
         AND (cp3.dernier_lu_at IS NULL OR m2.created_at > cp3.dernier_lu_at)
         AND m2.sender_id != $1) AS nb_non_lus
    FROM conversations c
    WHERE EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $1)
    ORDER BY COALESCE(c.updated_at, c.created_at) DESC
    LIMIT 5
  `, [currentUser.id])

  // 9. Documents de l'étudiant
  const { rows: docs } = await pool.query(
    `SELECT * FROM documents_etudiant WHERE etudiant_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [etudiant.id]
  )

  // DEBUG FI dashboard
  return c.json({
    etudiant: {
      id: etudiant.id,
      nom: etudiant.nom,
      prenom: etudiant.prenom,
      email: etudiant.email,
      numero_etudiant: etudiant.numero_etudiant,
      photo_url: etudiant.photo_url ?? null,
    },
    inscription: insc ? {
      id: insc.id,
      statut: insc.statut,
      classe_id: insc.classe_id ?? null,
      filiere: insc.filiere_obj?.nom ?? '—',
      filiere_id: insc.filiere_id ?? null,
      classe: insc.classe_obj?.nom ?? '—',
      date_debut_cours: insc.classe_obj?.date_debut_cours ?? null,
      date_inscription: insc.created_at ?? null,
      annee_academique: insc.annee_obj?.libelle ?? '—',
      frais_totaux,
      total_paye,
      restant_du,
    } : null,
    echeances: allEcheancesRows,
    // Formation individuelle
    formation_individuelle: fiData ? {
      id: fiData.id,
      statut: fiData.statut,
      type_formation: fiData.type_formation?.nom ?? 'Formation Individuelle',
      annee_academique: fiData.annee_academique_obj?.libelle ?? '—',
      cout_total: fi_frais_totaux,
      total_paye: fi_total_paye,
      restant_du: fi_restant_du,
      modules: fiData.modules,
      paiements: fiData.fi_paiements,
      date_debut: fiData.date_debut,
      date_fin: fiData.date_fin,
    } : null,
    notes: notesData,
    presences: presencesData,
    seances_semaine: cleanSeanceContent(seancesSemaine),
    seances_futures: cleanSeanceContent(seancesFutures),
    seances_passees: cleanSeanceContent(seancesPassees),
    _v: 'htmlToText-v3',
    paiements: allPaiementsRows,
    annonces,
    messages: convRows,
    documents: docs,
  })
})

// ─── GET /espace-etudiant/absences ────────────────────────────────────────────
app.get('/espace-etudiant/absences', requireAuth, role('etudiant'), async (c) => {
  const currentUser = u(c) as any
  const { rows: etudRows } = await pool.query('SELECT * FROM etudiants WHERE email=$1', [currentUser.email])
  if (!etudRows[0]) return c.json({ message: 'Étudiant introuvable.' }, 404)
  const { rows: inscRows } = await pool.query(
    `SELECT * FROM inscriptions WHERE etudiant_id=$1 ORDER BY CASE WHEN statut='inscrit_actif' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    [etudRows[0].id]
  )
  const insc = inscRows[0]
  if (!insc) return c.json({ absences: [], stats: { absent_justifie:0, absent_injustifie:0, retard:0, present:0, total:0, taux_presence:100, alerte:false } })

  const { rows: absRows } = await pool.query(`
    SELECT pr.id, pr.statut, COALESCE(pr.justifie,false) as justifie, pr.motif_justification,
      jsonb_build_object('id',s.id,'date_debut',s.date_debut,'date_fin',s.date_fin,'matiere',s.matiere) as seance,
      CASE WHEN ens.id IS NOT NULL THEN ens.prenom||' '||ens.nom ELSE NULL END as enseignant_nom
    FROM presences pr
    JOIN seances s ON pr.seance_id = s.id
    LEFT JOIN enseignants ens ON s.enseignant_id = ens.id
    WHERE pr.inscription_id=$1 AND pr.statut IN ('absent','retard')
    ORDER BY s.date_debut DESC LIMIT 100
  `, [insc.id])

  const { rows: statsRows } = await pool.query(`
    SELECT statut, COALESCE(justifie,false) as justifie, COUNT(*)::int as cnt
    FROM presences WHERE inscription_id=$1 GROUP BY statut, COALESCE(justifie,false)
  `, [insc.id])

  let absent_justifie=0, absent_injustifie=0, retard=0, present=0
  for (const r of statsRows) {
    if (r.statut==='absent' && r.justifie) absent_justifie+=r.cnt
    else if (r.statut==='absent') absent_injustifie+=r.cnt
    else if (r.statut==='retard') retard+=r.cnt
    else if (r.statut==='present') present+=r.cnt
  }
  const total = absent_justifie+absent_injustifie+retard+present
  const taux_presence = total>0 ? Math.round((present+retard)/total*100) : 100
  const alerte = absent_injustifie>=3 || (total>0 && absent_injustifie/total>=0.20)

  return c.json({ absences: absRows, stats: { absent_justifie, absent_injustifie, retard, present, total, taux_presence, alerte } })
})

// ─── AVIS QUALITÉ SÉANCES ─────────────────────────────────────────────────────

// Étudiant soumet un avis anonyme sur une séance effectuée
app.post('/seances/:id/avis', requireAuth, role('etudiant'), async (c) => {
  const seanceId = Number(c.req.param('id'))
  const { note, commentaire } = await c.req.json()
  if (!note || note < 1 || note > 5) return c.json({ message: 'Note entre 1 et 5 requise.' }, 400)
  if (!commentaire?.trim()) return c.json({ message: 'Commentaire requis.' }, 400)

  // Trouver l'inscription active de l'étudiant
  const currentUser = u(c) as any
  const { rows: etudRows } = await pool.query('SELECT id FROM etudiants WHERE email=$1', [currentUser.email])
  if (!etudRows[0]) return c.json({ message: 'Étudiant introuvable.' }, 404)

  const { rows: inscRows } = await pool.query(
    `SELECT id FROM inscriptions WHERE etudiant_id=$1 ORDER BY CASE WHEN statut='inscrit_actif' THEN 0 ELSE 1 END, id DESC LIMIT 1`,
    [etudRows[0].id]
  )
  if (!inscRows[0]) return c.json({ message: 'Inscription introuvable.' }, 404)

  // Vérifier que la séance est effectuée
  const { rows: seanceRows } = await pool.query('SELECT statut FROM seances WHERE id=$1', [seanceId])
  if (!seanceRows[0]) return c.json({ message: 'Séance introuvable.' }, 404)
  if (seanceRows[0].statut !== 'effectue') return c.json({ message: 'Seule une séance effectuée peut être évaluée.' }, 400)

  try {
    await pool.query(
      `INSERT INTO avis_seance (seance_id, inscription_id, note, commentaire) VALUES ($1,$2,$3,$4)`,
      [seanceId, inscRows[0].id, note, commentaire.trim()]
    )
  } catch (e: any) {
    if (e.code === '23505') return c.json({ message: 'Vous avez déjà évalué cette séance.' }, 409)
    throw e
  }
  return c.json({ success: true })
})

// Admin / enseignant : voir les avis d'une séance (anonymisés)
app.get('/seances/:id/avis', requireAuth, role('dg', 'dir_peda', 'coordinateur', 'secretariat', 'enseignant'), async (c) => {
  const seanceId = c.req.param('id')

  // Si enseignant, vérifier que c'est bien sa séance
  const currentUser = u(c) as any
  if (currentUser.role === 'enseignant') {
    const { rows: ensRows } = await pool.query('SELECT id FROM enseignants WHERE user_id=$1', [currentUser.id])
    if (ensRows[0]) {
      const { rows: seanceRows } = await pool.query('SELECT enseignant_id FROM seances WHERE id=$1', [seanceId])
      if (seanceRows[0]?.enseignant_id !== ensRows[0].id) {
        return c.json({ message: 'Accès refusé : ce n\'est pas votre séance.' }, 403)
      }
    }
  }

  const { rows } = await pool.query(
    `SELECT id, note, commentaire, created_at FROM avis_seance WHERE seance_id=$1 ORDER BY created_at DESC`,
    [seanceId]
  )
  const avg = rows.length > 0
    ? Math.round(rows.reduce((s: number, r: any) => s + r.note, 0) / rows.length * 10) / 10
    : null
  return c.json({ avis: rows, count: rows.length, moyenne: avg })
})

// Synthèse qualité par enseignant (admin/DG/dir_peda)
app.get('/avis/synthese', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const { rows } = await pool.query(`
    SELECT
      ens.id as enseignant_id,
      ens.prenom || ' ' || ens.nom as enseignant,
      COUNT(av.id)::int as total_avis,
      ROUND(AVG(av.note)::numeric, 1)::float as moyenne,
      COUNT(DISTINCT av.seance_id)::int as seances_evaluees
    FROM enseignants ens
    LEFT JOIN seances s ON s.enseignant_id = ens.id AND s.statut = 'effectue'
    LEFT JOIN avis_seance av ON av.seance_id = s.id
    GROUP BY ens.id, ens.prenom, ens.nom
    HAVING COUNT(av.id) > 0
    ORDER BY moyenne DESC NULLS LAST
  `)
  return c.json(rows)
})

// ─── GET /espace-parent/dashboard ────────────────────────────────────────────
app.get('/espace-parent/dashboard', requireAuth, role('parent'), async (c) => {
  const currentUser = u(c) as any
  const { rows: liens } = await pool.query(`
    SELECT pe.id as lien_id, pe.etudiant_id, e.nom, e.prenom, e.email as etudiant_email, e.numero_etudiant, e.photo_url
    FROM parent_etudiant pe JOIN etudiants e ON pe.etudiant_id=e.id
    WHERE pe.parent_user_id=$1
  `, [currentUser.id])
  if (!liens.length) return c.json({ enfants: [] })

  const enfants = []
  for (const lien of liens) {
    const etudiantId = lien.etudiant_id
    const { rows: inscRows } = await pool.query(`
      SELECT i.*,
        CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom) ELSE NULL END as classe_obj,
        CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom) ELSE NULL END as filiere_obj,
        CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_obj
      FROM inscriptions i
      LEFT JOIN classes c ON i.classe_id=c.id LEFT JOIN filieres f ON i.filiere_id=f.id
      LEFT JOIN annees_academiques aa ON i.annee_academique_id=aa.id
      WHERE i.etudiant_id=$1
      ORDER BY CASE WHEN i.statut='inscrit_actif' THEN 0 ELSE 1 END, i.id DESC LIMIT 1
    `, [etudiantId])
    const insc = inscRows[0] || null

    // Presences
    let presData = { present:0, retard:0, absent:0, absent_justifie:0, absent_injustifie:0, total:0, taux_presence:100, alerte:false }
    if (insc) {
      const { rows: prs } = await pool.query(
        `SELECT statut, COALESCE(justifie,false) as justifie, COUNT(*)::int as cnt FROM presences WHERE inscription_id=$1 GROUP BY statut, COALESCE(justifie,false)`,
        [insc.id]
      )
      let p=0,r=0,aj=0,ai=0
      for (const x of prs) {
        if (x.statut==='present') p+=x.cnt
        else if (x.statut==='retard') r+=x.cnt
        else if (x.statut==='absent' && x.justifie) aj+=x.cnt
        else if (x.statut==='absent') ai+=x.cnt
      }
      const t=p+r+aj+ai
      presData = { present:p, retard:r, absent:aj+ai, absent_justifie:aj, absent_injustifie:ai, total:t, taux_presence:t>0?Math.round((p+r)/t*100):100, alerte:ai>=3 }
    }

    // Notes
    let notesData: any = null
    if (insc?.classe_id) {
      const { rows: uesR } = await pool.query(`SELECT id, intitule, code, coefficient FROM unites_enseignement WHERE classe_id=$1`, [insc.classe_id])
      const { rows: notesR } = await pool.query(`SELECT ue_id, note FROM notes WHERE inscription_id=$1 AND session='normale'`, [insc.id])
      const nm: Record<number,number> = {}; for (const n of notesR) nm[n.ue_id]=parseFloat(n.note)
      let tp=0, tc=0
      const ues = uesR.map((ue:any) => { const coef=parseFloat(ue.coefficient)||1; const note=nm[ue.id]??null; if(note!==null){tp+=note*coef;tc+=coef}; return {intitule:ue.intitule||ue.code,coef,note} })
      const moy = tc>0 ? Math.round(tp/tc*100)/100 : null
      notesData = { ues, moyenne: moy, mention: moy===null?null:moy>=16?'Très Bien':moy>=14?'Bien':moy>=12?'Assez Bien':moy>=10?'Passable':'Insuffisant' }
    }

    // Paiements
    let paiData = { frais_totaux:0, total_paye:0, restant_du:0 }
    if (insc) {
      const [fr, py] = await Promise.all([
        pool.query(`SELECT COALESCE(SUM(montant),0)::float as t FROM echeances WHERE inscription_id=$1`, [insc.id]),
        pool.query(`SELECT COALESCE(SUM(montant),0)::float as t FROM paiements WHERE inscription_id=$1 AND statut='confirme'`, [insc.id]),
      ])
      paiData = { frais_totaux:fr.rows[0].t, total_paye:py.rows[0].t, restant_du:Math.max(0,fr.rows[0].t-py.rows[0].t) }
    }

    // Recent absences (last 10)
    let recentAbs: any[] = []
    if (insc) {
      const { rows: absR } = await pool.query(`
        SELECT pr.id, pr.statut, COALESCE(pr.justifie,false) as justifie, s.date_debut, s.matiere
        FROM presences pr JOIN seances s ON pr.seance_id=s.id
        WHERE pr.inscription_id=$1 AND pr.statut IN ('absent','retard')
        ORDER BY s.date_debut DESC LIMIT 10
      `, [insc.id])
      recentAbs = absR
    }

    enfants.push({
      etudiant: { id:etudiantId, nom:lien.nom, prenom:lien.prenom, email:lien.etudiant_email, numero_etudiant:lien.numero_etudiant, photo_url:lien.photo_url },
      inscription: insc ? { id:insc.id, classe:insc.classe_obj?.nom??'—', filiere:insc.filiere_obj?.nom??'—', annee_academique:insc.annee_obj?.libelle??'—', statut:insc.statut } : null,
      presences: presData,
      notes: notesData,
      paiements: paiData,
      absences_recentes: recentAbs,
    })
  }
  return c.json({ enfants })
})

// ─── POST /parent-lien ────────────────────────────────────────────────────────
app.post('/parent-lien', requireAuth, role('dg', 'secretariat'), async (c) => {
  const { parent_user_id, etudiant_id } = await c.req.json()
  if (!parent_user_id || !etudiant_id) return c.json({ message: 'parent_user_id et etudiant_id requis.' }, 400)
  const { rows: uRows } = await pool.query(`SELECT role FROM users WHERE id=$1`, [parent_user_id])
  if (!uRows[0]) return c.json({ message: 'Utilisateur introuvable.' }, 404)
  if (uRows[0].role !== 'parent') return c.json({ message: "Cet utilisateur n'a pas le rôle parent." }, 400)
  const { rows } = await pool.query(
    `INSERT INTO parent_etudiant (parent_user_id, etudiant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *`,
    [parent_user_id, etudiant_id]
  )
  return c.json(rows[0] ?? { parent_user_id, etudiant_id, already_exists: true }, rows[0] ? 201 : 200)
})

// ─── GET /parent-lien ─────────────────────────────────────────────────────────
app.get('/parent-lien', requireAuth, role('dg', 'secretariat', 'dir_peda'), async (c) => {
  const etudiantId = c.req.query('etudiant_id')
  const parentUserId = c.req.query('parent_user_id')
  let q = `SELECT pe.id, pe.parent_user_id, pe.etudiant_id, u.nom as parent_nom, u.prenom as parent_prenom, u.email as parent_email, e.nom as etudiant_nom, e.prenom as etudiant_prenom, e.numero_etudiant FROM parent_etudiant pe JOIN users u ON pe.parent_user_id=u.id JOIN etudiants e ON pe.etudiant_id=e.id`
  const params: any[] = []
  if (etudiantId) { q += ` WHERE pe.etudiant_id=$1`; params.push(etudiantId) }
  else if (parentUserId) { q += ` WHERE pe.parent_user_id=$1`; params.push(parentUserId) }
  const { rows } = await pool.query(q, params)
  return c.json(rows)
})

// ─── DELETE /parent-lien/:id ──────────────────────────────────────────────────
app.delete('/parent-lien/:id', requireAuth, role('dg', 'secretariat'), async (c) => {
  await pool.query(`DELETE FROM parent_etudiant WHERE id=$1`, [c.req.param('id')])
  return c.json({ success: true })
})

// ─── PUT /presences/:id/justifier ─────────────────────────────────────────────
app.put('/presences/:id/justifier', requireAuth, role('dg', 'dir_peda', 'coordinateur', 'secretariat'), async (c) => {
  const id = c.req.param('id')
  const { justifie, motif_justification } = await c.req.json().catch(() => ({ justifie: true, motif_justification: '' }))
  const { rows } = await pool.query(
    `UPDATE presences SET justifie=$1, motif_justification=$2 WHERE id=$3 RETURNING *`,
    [justifie ?? true, motif_justification ?? null, id]
  )
  if (!rows[0]) return c.json({ message: 'Présence introuvable.' }, 404)
  return c.json(rows[0])
})

// ─── TARIFS ───────────────────────────────────────────────────────────────────
app.get('/tarifs', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT t.*,
      jsonb_build_object('id',tf.id,'nom',tf.nom) as type_formation,
      jsonb_build_object('id',aa.id,'libelle',aa.libelle) as annee_academique
    FROM tarifs_enseignants t
    LEFT JOIN types_formation tf ON t.type_formation_id = tf.id
    LEFT JOIN annees_academiques aa ON t.annee_academique_id = aa.id
    ORDER BY t.created_at DESC
  `)
  return c.json(rows)
})

app.post('/tarifs', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `INSERT INTO tarifs_enseignants (type_formation_id,annee_academique_id,montant_horaire,date_effet,created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (type_formation_id,annee_academique_id) DO UPDATE SET montant_horaire=$3,date_effet=$4
     RETURNING *`,
    [b.type_formation_id, b.annee_academique_id, b.montant_horaire, b.date_effet, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.put('/tarifs/:id', requireAuth, role('dg'), async (c) => {
  const id = parseInt(c.req.param('id'))
  const b = await c.req.json() as any
  const { rows } = await pool.query(
    `UPDATE tarifs_enseignants SET montant_horaire=$1, date_effet=$2, updated_at=NOW()
     WHERE id=$3 RETURNING *`,
    [b.montant_horaire, b.date_effet, id]
  )
  if (!rows[0]) return c.json({ error: 'Tarif introuvable' }, 404)
  return c.json(rows[0])
})

app.delete('/tarifs/:id', requireAuth, role('dg'), async (c) => {
  const id = parseInt(c.req.param('id'))
  const { rows } = await pool.query('DELETE FROM tarifs_enseignants WHERE id=$1 RETURNING id', [id])
  if (!rows[0]) return c.json({ error: 'Tarif introuvable' }, 404)
  return c.json({ ok: true })
})

// ─── RELANCES AUTOMATIQUES ────────────────────────────────────────────────────

async function envoyerEmailRelance(opts: {
  to: string
  nomEtudiant: string
  montant: number
  echeanceMois: string
  joursAvant: number
  numeroEtudiant: string
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return { ok: false, error: 'BREVO_API_KEY non configuré (simulation)' }

  const { to, nomEtudiant, montant, echeanceMois, joursAvant, numeroEtudiant } = opts
  const montantFmt = new Intl.NumberFormat('fr-FR').format(montant) + ' FCFA'
  const moisFmt = new Date(echeanceMois + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  let sujet: string
  let intro: string
  if (joursAvant > 0) {
    sujet = `Rappel paiement – échéance dans ${joursAvant} jour(s)`
    intro = `Votre échéance mensuelle de <strong>${montantFmt}</strong> pour le mois de <strong>${moisFmt}</strong> arrive dans <strong>${joursAvant} jour(s)</strong>.`
  } else if (joursAvant === 0) {
    sujet = `⚠️ Échéance aujourd'hui – ${montantFmt}`
    intro = `Votre échéance mensuelle de <strong>${montantFmt}</strong> pour le mois de <strong>${moisFmt}</strong> est <strong>due aujourd'hui</strong>.`
  } else {
    sujet = `Retard de paiement – ${montantFmt}`
    intro = `Votre paiement de <strong>${montantFmt}</strong> pour le mois de <strong>${moisFmt}</strong> est en <strong>retard</strong>.`
  }

  const html = `
<!DOCTYPE html><html lang="fr"><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<div style="background:#1e3a5f;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
  <h2 style="margin:0">UPTECH Campus</h2>
</div>
<div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
  <p>Bonjour <strong>${nomEtudiant}</strong>,</p>
  <p>${intro}</p>
  <p>Merci de procéder au règlement avant la date d'échéance pour éviter tout blocage d'accès.</p>
  <p style="color:#6b7280;font-size:12px">Numéro étudiant : ${numeroEtudiant}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
  <p style="color:#9ca3af;font-size:11px">Ce message est envoyé automatiquement. Ne pas répondre directement à cet email.</p>
</div>
</body></html>`

  try {
    const fromEmail = process.env.BREVO_FROM_EMAIL || 'noreply@uptech.edu'
    const fromName  = process.env.BREVO_FROM_NAME  || 'UPTECH Campus'
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: to }],
        subject: sujet,
        htmlContent: html,
      }),
    })
    if (!resp.ok) {
      const errText = await resp.text()
      return { ok: false, error: errText }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// Cron Vercel — appelé tous les jours à 8h UTC
app.get('/cron/relances', async (c) => {
  // Vérifier le secret cron (optionnel mais recommandé)
  const secret = c.req.header('x-vercel-cron-signature') || c.req.query('secret')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && secret !== cronSecret) {
    return c.json({ message: 'Non autorisé.' }, 401)
  }

  const aujourd_hui = new Date()
  aujourd_hui.setHours(0, 0, 0, 0)
  const resultats: { etudiant_id: number; type: string; ok: boolean; error?: string }[] = []

  try {
    // Trouver les échéances non payées pour J-3, J-1, J+0 (aujourd'hui)
    const joursConfig = [-3, -1, 0] // négatif = avant échéance
    for (const joursAvant of joursConfig) {
      const dateCible = new Date(aujourd_hui)
      dateCible.setDate(dateCible.getDate() - joursAvant) // date de l'échéance ciblée
      const moisCible = dateCible.toISOString().slice(0, 7) // YYYY-MM

      const { rows: echeances } = await pool.query(`
        SELECT e.id as echeance_id, e.inscription_id, e.montant, e.mois,
          et.id as etudiant_id, et.nom, et.prenom, et.numero_etudiant,
          COALESCE(u.email, et.email) as email
        FROM echeances e
        JOIN inscriptions i ON i.id = e.inscription_id
        JOIN etudiants et ON et.id = i.etudiant_id
        LEFT JOIN users u ON u.id = et.user_id
        WHERE e.statut = 'non_paye'
          AND e.type_echeance = 'mensualite'
          AND TO_CHAR(e.mois, 'YYYY-MM') = $1
          AND i.statut IN ('inscrit_actif', 'pre_inscrit')
          AND COALESCE(u.email, et.email) IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM relances_paiement r
            WHERE r.echeance_id = e.id AND r.jours_avant = $2
              AND r.statut = 'envoye'
              AND r.created_at >= NOW() - INTERVAL '23 hours'
          )
      `, [moisCible, joursAvant])

      for (const ech of echeances) {
        const emailDest = ech.email as string
        if (!emailDest) continue

        const res = await envoyerEmailRelance({
          to: emailDest,
          nomEtudiant: `${ech.prenom} ${ech.nom}`,
          montant: parseFloat(ech.montant),
          echeanceMois: moisCible,
          joursAvant,
          numeroEtudiant: ech.numero_etudiant,
        })

        // Enregistrer dans la table relances (qu'il y ait eu erreur ou non)
        await pool.query(
          `INSERT INTO relances_paiement
            (inscription_id, echeance_id, etudiant_id, type_relance, jours_avant,
             email_destinataire, sujet, statut, erreur)
           VALUES ($1,$2,$3,'auto',$4,$5,$6,$7,$8)`,
          [
            ech.inscription_id, ech.echeance_id, ech.etudiant_id,
            joursAvant, emailDest,
            joursAvant > 0 ? `Rappel J-${joursAvant}` : joursAvant === 0 ? 'Échéance aujourd\'hui' : 'Retard paiement',
            res.ok ? 'envoye' : 'erreur',
            res.ok ? null : (res.error || null),
          ]
        ).catch(() => {})

        // Notification in-app pour l'étudiant
        try {
          const { rows: userRows } = await pool.query(
            `SELECT et.user_id FROM etudiants et WHERE et.id=$1 AND et.user_id IS NOT NULL`,
            [ech.etudiant_id]
          )
          if (userRows[0]?.user_id) {
            const moisFmt = new Date(moisCible + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
            const montantFmt = Number(ech.montant).toLocaleString('fr-FR')
            let titre = '⚠️ Rappel de paiement'
            let msg = ''
            if (joursAvant === -3) {
              titre = '🔔 Échéance dans 3 jours'
              msg = `Votre mensualité de ${montantFmt} FCFA (${moisFmt}) est due dans 3 jours.`
            } else if (joursAvant === -1) {
              titre = '⏰ Échéance demain'
              msg = `Votre mensualité de ${montantFmt} FCFA (${moisFmt}) est due demain. Pensez à régulariser.`
            } else {
              titre = '🚨 Paiement en retard'
              msg = `Votre mensualité de ${montantFmt} FCFA (${moisFmt}) était due aujourd'hui et reste impayée.`
            }
            await createUserNotif(userRows[0].user_id, 'echeance', titre, msg, { mois: moisCible, montant: ech.montant })
          }
        } catch { /* silencieux */ }

        resultats.push({ etudiant_id: ech.etudiant_id, type: `J${joursAvant >= 0 ? '+' : ''}${joursAvant}`, ok: res.ok, error: res.error })
      }
    }

    return c.json({ message: 'Cron relances terminé.', total: resultats.length, resultats })
  } catch (err: any) {
    return c.json({ message: err.message }, 500)
  }
})

// ─── ÉMARGEMENT PAR QR CODE ──────────────────────────────────────────────────
// POST /seances/:id/presence-qr — marque un étudiant présent via son matricule scanné
app.post('/seances/:id/presence-qr', requireAuth, async (c) => {
  const seanceId = c.req.param('id')
  const { numero_etudiant, statut = 'present' } = await c.req.json()
  if (!numero_etudiant) return c.json({ message: 'numero_etudiant requis.' }, 422)

  // 1. Trouver la séance pour connaître la classe
  const { rows: seanceRows } = await pool.query(
    `SELECT s.id, s.classe_id, s.statut AS seance_statut FROM seances s WHERE s.id = $1`, [seanceId]
  )
  if (!seanceRows[0]) return c.json({ message: 'Séance introuvable.' }, 404)
  const seance = seanceRows[0]

  // 2. Trouver l'inscription de l'étudiant dans cette classe
  const { rows: inscRows } = await pool.query(`
    SELECT i.id, e.nom, e.prenom, e.numero_etudiant, e.photo_path
    FROM inscriptions i
    JOIN etudiants e ON e.id = i.etudiant_id
    WHERE e.numero_etudiant = $1
      AND i.classe_id = $2
      AND i.statut = 'inscrit_actif'
    LIMIT 1
  `, [numero_etudiant, seance.classe_id])

  if (!inscRows[0]) return c.json({
    message: `Étudiant ${numero_etudiant} non trouvé dans cette classe.`,
    found: false,
  }, 404)

  const insc = inscRows[0]

  // 3. Enregistrer la présence
  const heureArrivee = new Date().toISOString()
  await pool.query(
    `INSERT INTO presences (seance_id, inscription_id, statut, heure_arrivee, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (seance_id, inscription_id) DO UPDATE SET statut=$3, heure_arrivee=$4`,
    [seanceId, insc.id, statut, heureArrivee, u(c).id]
  )

  return c.json({
    found: true,
    inscription_id: insc.id,
    etudiant: { nom: insc.nom, prenom: insc.prenom, numero_etudiant: insc.numero_etudiant },
    statut,
    heure_arrivee: heureArrivee,
  })
})

// Relance manuelle depuis la fiche étudiant (staff)
app.post('/relances/manual', requireAuth, role('secretariat', 'dg', 'resp_fin'), async (c) => {
  const b = await c.req.json() as { inscription_id: number; echeance_id?: number; mois?: string }
  if (!b.inscription_id) return c.json({ message: 'inscription_id requis.' }, 422)

  const { rows: inscRows } = await pool.query(`
    SELECT i.id, i.statut,
      et.id as etudiant_id, et.nom, et.prenom, et.numero_etudiant,
      COALESCE(u.email, et.email) as email
    FROM inscriptions i
    JOIN etudiants et ON et.id = i.etudiant_id
    LEFT JOIN users u ON u.id = et.user_id
    WHERE i.id = $1
  `, [b.inscription_id])

  if (!inscRows[0]) return c.json({ message: 'Inscription introuvable.' }, 404)
  const insc = inscRows[0]
  const emailDest = insc.email as string
  if (!emailDest) return c.json({ message: 'Aucun email trouvé pour cet étudiant.' }, 422)

  // Trouver la prochaine échéance non payée
  let moisCible = b.mois
  let echeanceId = b.echeance_id ?? null
  if (!moisCible) {
    const { rows: ech } = await pool.query(
      `SELECT id, mois, montant FROM echeances
       WHERE inscription_id = $1 AND statut = 'non_paye' AND type_echeance = 'mensualite'
       ORDER BY mois ASC LIMIT 1`,
      [b.inscription_id]
    )
    if (!ech[0]) return c.json({ message: 'Aucune échéance non payée trouvée.' }, 404)
    moisCible = (ech[0].mois as string).slice(0, 7)
    echeanceId = ech[0].id
  }

  // Récupérer le montant si on n'a que le mois
  const { rows: echRows } = await pool.query(
    `SELECT id, montant FROM echeances WHERE inscription_id=$1 AND TO_CHAR(mois,'YYYY-MM')=$2 LIMIT 1`,
    [b.inscription_id, moisCible]
  )
  const montant = echRows[0] ? parseFloat(echRows[0].montant) : 0
  if (!echeanceId && echRows[0]) echeanceId = echRows[0].id

  const res = await envoyerEmailRelance({
    to: emailDest,
    nomEtudiant: `${insc.prenom} ${insc.nom}`,
    montant,
    echeanceMois: moisCible!,
    joursAvant: 0,
    numeroEtudiant: insc.numero_etudiant,
  })

  const envoye_par = (u(c) as any).id
  await pool.query(
    `INSERT INTO relances_paiement
      (inscription_id, echeance_id, etudiant_id, type_relance, jours_avant,
       email_destinataire, sujet, statut, erreur, envoye_par)
     VALUES ($1,$2,$3,'manuel',0,$4,'Relance manuelle',$5,$6,$7)`,
    [b.inscription_id, echeanceId, insc.etudiant_id, emailDest,
     res.ok ? 'envoye' : 'erreur', res.ok ? null : (res.error || null), envoye_par]
  ).catch(() => {})

  if (!res.ok) return c.json({ message: `Relance échouée : ${res.error}`, simulated: !process.env.BREVO_API_KEY }, 500)
  return c.json({ message: 'Relance envoyée avec succès.', simulated: !process.env.BREVO_API_KEY })
})

// Historique des relances d'une inscription
app.get('/relances', requireAuth, async (c) => {
  const inscription_id = c.req.query('inscription_id')
  if (!inscription_id) return c.json([])
  const { rows } = await pool.query(
    `SELECT r.*, u.prenom || ' ' || u.nom AS envoye_par_nom
     FROM relances_paiement r
     LEFT JOIN users u ON u.id = r.envoye_par
     WHERE r.inscription_id = $1
     ORDER BY r.created_at DESC`,
    [inscription_id]
  )
  return c.json(rows)
})

// ─── STATISTIQUES CLÉS ÉTUDIANT ──────────────────────────────────────────────
app.get('/etudiants/:id/stats', requireAuth, async (c) => {
  const id = c.req.param('id')
  const { rows } = await pool.query(`
    WITH latest_insc AS (
      SELECT id AS inscription_id
      FROM inscriptions
      WHERE etudiant_id = $1 AND statut NOT IN ('abandonne')
      ORDER BY created_at DESC LIMIT 1
    ),
    notes_stat AS (
      SELECT ROUND(AVG(n.note)::numeric, 1) AS moyenne, COUNT(n.id)::int AS nb_notes
      FROM notes n JOIN latest_insc li ON n.inscription_id = li.inscription_id
    ),
    presence_stat AS (
      SELECT
        COUNT(p.id)::int AS total_seances,
        COUNT(CASE WHEN p.statut IN ('present','retard') THEN 1 END)::int AS presences_ok
      FROM presences p JOIN latest_insc li ON p.inscription_id = li.inscription_id
    ),
    docs_stat AS (
      SELECT
        COUNT(td.id)::int AS total_types,
        COALESCE((SELECT COUNT(*)::int FROM checklist_documents cd
          WHERE cd.etudiant_id = $1 AND cd.recu = true), 0) AS docs_recu
      FROM types_documents td WHERE td.actif = true
    ),
    paiements_stat AS (
      SELECT
        COUNT(e.id)::int AS total_echeances,
        COUNT(CASE WHEN e.statut = 'paye' THEN 1 END)::int AS echeances_payees
      FROM echeances e JOIN latest_insc li ON e.inscription_id = li.inscription_id
    )
    SELECT
      ns.moyenne::float                                                          AS moyenne,
      ns.nb_notes,
      ps.total_seances                                                           AS presences_total,
      ps.presences_ok,
      CASE WHEN ps.total_seances > 0
        THEN ROUND(ps.presences_ok::numeric / ps.total_seances * 100)::int
        ELSE NULL END                                                            AS taux_presence,
      ds.total_types                                                             AS docs_total,
      ds.docs_recu,
      CASE WHEN ds.total_types > 0
        THEN ROUND(ds.docs_recu::numeric / ds.total_types * 100)::int
        ELSE 0 END                                                               AS pct_dossier,
      pay.total_echeances,
      pay.echeances_payees,
      CASE WHEN pay.total_echeances > 0
        THEN ROUND(pay.echeances_payees::numeric / pay.total_echeances * 100)::int
        ELSE NULL END                                                            AS pct_paiements
    FROM notes_stat ns, presence_stat ps, docs_stat ds, paiements_stat pay
  `, [id])
  return c.json(rows[0] ?? {})
})

// ─── COMMENTAIRES / APPRÉCIATIONS INTERNES ───────────────────────────────────

app.get('/etudiants/:id/commentaires', requireAuth, async (c) => {
  // Étudiants n'ont pas accès à leurs propres commentaires internes
  const currentUser = u(c) as any
  if (currentUser.role === 'etudiant') return c.json({ message: 'Accès refusé.' }, 403)

  const { rows } = await pool.query(`
    SELECT ce.*,
      u.nom AS auteur_nom, u.prenom AS auteur_prenom,
      u.role AS auteur_role, u.photo_path AS auteur_photo
    FROM commentaires_etudiant ce
    JOIN users u ON u.id = ce.auteur_id
    WHERE ce.etudiant_id = $1
    ORDER BY ce.created_at DESC
  `, [c.req.param('id')])
  return c.json(rows)
})

app.post('/etudiants/:id/commentaires', requireAuth, async (c) => {
  const currentUser = u(c) as any
  if (currentUser.role === 'etudiant') return c.json({ message: 'Accès refusé.' }, 403)

  const b = await c.req.json() as { contenu?: string; categorie?: string }
  if (!b.contenu?.trim()) return c.json({ message: 'Le commentaire ne peut pas être vide.' }, 422)

  const validCategories = ['general', 'pedagogique', 'financier', 'disciplinaire', 'rh', 'positif']
  const categorie = validCategories.includes(b.categorie ?? '') ? b.categorie : 'general'

  const { rows } = await pool.query(`
    INSERT INTO commentaires_etudiant (etudiant_id, auteur_id, contenu, categorie)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [c.req.param('id'), currentUser.id, b.contenu.trim(), categorie])

  // Enrichir avec les infos auteur pour la réponse
  const { rows: enriched } = await pool.query(`
    SELECT ce.*,
      u.nom AS auteur_nom, u.prenom AS auteur_prenom,
      u.role AS auteur_role, u.photo_path AS auteur_photo
    FROM commentaires_etudiant ce
    JOIN users u ON u.id = ce.auteur_id
    WHERE ce.id = $1
  `, [rows[0].id])

  return c.json(enriched[0], 201)
})

app.put('/commentaires/:id', requireAuth, async (c) => {
  const currentUser = u(c) as any
  if (currentUser.role === 'etudiant') return c.json({ message: 'Accès refusé.' }, 403)

  const b = await c.req.json() as { contenu?: string; categorie?: string }
  if (!b.contenu?.trim()) return c.json({ message: 'Le commentaire ne peut pas être vide.' }, 422)

  // Seul l'auteur ou le DG peut modifier
  const { rows: existing } = await pool.query(
    'SELECT * FROM commentaires_etudiant WHERE id = $1', [c.req.param('id')]
  )
  if (!existing[0]) return c.json({ message: 'Commentaire introuvable.' }, 404)
  if (existing[0].auteur_id !== currentUser.id && currentUser.role !== 'dg')
    return c.json({ message: 'Vous ne pouvez modifier que vos propres commentaires.' }, 403)

  const validCategories = ['general', 'pedagogique', 'financier', 'disciplinaire', 'rh', 'positif']
  const categorie = b.categorie && validCategories.includes(b.categorie) ? b.categorie : existing[0].categorie

  await pool.query(
    `UPDATE commentaires_etudiant SET contenu = $1, categorie = $2, updated_at = NOW() WHERE id = $3`,
    [b.contenu.trim(), categorie, c.req.param('id')]
  )

  const { rows } = await pool.query(`
    SELECT ce.*,
      u.nom AS auteur_nom, u.prenom AS auteur_prenom,
      u.role AS auteur_role, u.photo_path AS auteur_photo
    FROM commentaires_etudiant ce
    JOIN users u ON u.id = ce.auteur_id
    WHERE ce.id = $1
  `, [c.req.param('id')])
  return c.json(rows[0])
})

app.delete('/commentaires/:id', requireAuth, async (c) => {
  const currentUser = u(c) as any
  if (currentUser.role === 'etudiant') return c.json({ message: 'Accès refusé.' }, 403)

  const { rows } = await pool.query(
    'SELECT * FROM commentaires_etudiant WHERE id = $1', [c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Commentaire introuvable.' }, 404)
  if (rows[0].auteur_id !== currentUser.id && currentUser.role !== 'dg')
    return c.json({ message: 'Vous ne pouvez supprimer que vos propres commentaires.' }, 403)

  await pool.query('DELETE FROM commentaires_etudiant WHERE id = $1', [c.req.param('id')])
  return c.json({ message: 'Commentaire supprimé.' })
})

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', async (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})


// ─── SUIVI ABSENCES ──────────────────────────────────────────────────────────
const absenceRoles = role('dg', 'dir_peda', 'coordinateur', 'secretariat', 'resp_fin')

// GET /absences/jour?date=YYYY-MM-DD
app.get('/absences/jour', requireAuth, absenceRoles, async (c) => {
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const classeId = c.req.query('classe_id') ? parseInt(c.req.query('classe_id')!) : null

  const classeFilterClean = classeId ? `AND s.classe_id = ${classeId}` : ''

  const { rows } = await pool.query(`
    SELECT
      COALESCE(pr.id, -1)                        AS id,
      COALESCE(pr.statut, 'absent')              AS statut,
      pr.heure_arrivee,
      jsonb_build_object(
        'id',e.id,'nom',e.nom,'prenom',e.prenom,
        'numero_etudiant',e.numero_etudiant
      ) AS etudiant,
      jsonb_build_object('id',cl.id,'nom',cl.nom) AS classe,
      jsonb_build_object(
        'id',s.id,'date_debut',s.date_debut,'date_fin',s.date_fin,
        'matiere',s.matiere,
        'enseignant',jsonb_build_object('id',ens.id,'nom',ens.nom,'prenom',ens.prenom)
      ) AS seance
    FROM seances s
    JOIN classes cl           ON cl.id = s.classe_id
    JOIN inscriptions i ON (
        i.classe_id = s.classe_id
        OR i.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = s.classe_id)
      ) AND i.statut IN ('inscrit_actif','pre_inscrit')
    JOIN etudiants e          ON e.id = i.etudiant_id
    LEFT JOIN presences pr    ON pr.seance_id = s.id AND pr.inscription_id = i.id
    LEFT JOIN enseignants ens ON ens.id = s.enseignant_id
    WHERE s.date_debut::date = $1
      AND s.statut = 'effectue'
      AND (pr.statut IN ('absent','retard') OR pr.id IS NULL)
      ${classeFilterClean}
    ORDER BY s.date_debut, cl.nom, e.nom
  `, [date])

  const total   = rows.length
  const absents = rows.filter((r: any) => r.statut === 'absent').length
  const retards = rows.filter((r: any) => r.statut === 'retard').length

  return c.json({ date, rows, total, absents, retards })
})

// GET /absences/semaine?date=YYYY-MM-DD (date quelconque dans la semaine)
app.get('/absences/semaine', requireAuth, absenceRoles, async (c) => {
  const raw = c.req.query('date') || new Date().toISOString().slice(0, 10)
  const d = new Date(raw)
  // Lundi de la semaine
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1
  const lundi = new Date(d); lundi.setDate(d.getDate() - day)
  const dimanche = new Date(lundi); dimanche.setDate(lundi.getDate() + 6)
  const debut = lundi.toISOString().slice(0, 10)
  const fin   = dimanche.toISOString().slice(0, 10)

  // Résumé par jour — inclut absences explicites ET implicites (pas de présence pour une séance émargée)
  const { rows: parJour } = await pool.query(`
    SELECT
      s.date_debut::date AS jour,
      COUNT(CASE WHEN COALESCE(pr.statut,'absent')='absent' THEN 1 END)::int  AS absents,
      COUNT(CASE WHEN pr.statut='retard'                    THEN 1 END)::int  AS retards,
      COUNT(DISTINCT i.etudiant_id)::int                                       AS nb_etudiants_concernes,
      COUNT(DISTINCT s.classe_id)::int                                         AS nb_classes
    FROM seances s
    JOIN inscriptions i ON (
        i.classe_id = s.classe_id
        OR i.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = s.classe_id)
      ) AND i.statut IN ('inscrit_actif','pre_inscrit')
    LEFT JOIN presences pr ON pr.seance_id = s.id AND pr.inscription_id = i.id
    WHERE s.date_debut::date BETWEEN $1 AND $2
      AND s.statut = 'effectue'
      AND (pr.statut IN ('absent','retard') OR pr.id IS NULL)
    GROUP BY s.date_debut::date
    ORDER BY jour
  `, [debut, fin])

  // Top absentéistes de la semaine — idem
  const { rows: topAbsents } = await pool.query(`
    SELECT
      e.id, e.nom, e.prenom, e.numero_etudiant,
      jsonb_build_object('id',cl.id,'nom',cl.nom) AS classe,
      COUNT(CASE WHEN COALESCE(pr.statut,'absent')='absent' THEN 1 END)::int AS nb_absences,
      COUNT(CASE WHEN pr.statut='retard'                    THEN 1 END)::int AS nb_retards
    FROM seances s
    JOIN inscriptions i ON (
        i.classe_id = s.classe_id
        OR i.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = s.classe_id)
      ) AND i.statut IN ('inscrit_actif','pre_inscrit')
    JOIN etudiants e     ON e.id = i.etudiant_id
    JOIN classes cl      ON cl.id = i.classe_id
    LEFT JOIN presences pr ON pr.seance_id = s.id AND pr.inscription_id = i.id
    WHERE s.date_debut::date BETWEEN $1 AND $2
      AND s.statut = 'effectue'
      AND (pr.statut IN ('absent','retard') OR pr.id IS NULL)
    GROUP BY e.id, e.nom, e.prenom, e.numero_etudiant, cl.id, cl.nom
    ORDER BY nb_absences DESC, nb_retards DESC
    LIMIT 20
  `, [debut, fin])

  const totalAbsents = parJour.reduce((s: number, r: any) => s + r.absents, 0)
  const totalRetards = parJour.reduce((s: number, r: any) => s + r.retards, 0)

  return c.json({ debut, fin, par_jour: parJour, top_absents: topAbsents, total_absents: totalAbsents, total_retards: totalRetards })
})

// GET /absences/mois?mois=YYYY-MM
app.get('/absences/mois', requireAuth, absenceRoles, async (c) => {
  const mois = c.req.query('mois') || new Date().toISOString().slice(0, 7)
  const debut = `${mois}-01`
  const fin   = new Date(new Date(debut).getFullYear(), new Date(debut).getMonth() + 1, 0).toISOString().slice(0, 10)

  // Résumé par jour du mois — absences explicites + implicites (pas de ligne presences pour séance émargée)
  const { rows: parJour } = await pool.query(`
    SELECT
      s.date_debut::date AS jour,
      COUNT(CASE WHEN COALESCE(pr.statut,'absent')='absent' THEN 1 END)::int AS absents,
      COUNT(CASE WHEN pr.statut='retard'                    THEN 1 END)::int AS retards
    FROM seances s
    JOIN inscriptions i ON (
        i.classe_id = s.classe_id
        OR i.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = s.classe_id)
      ) AND i.statut IN ('inscrit_actif','pre_inscrit')
    LEFT JOIN presences pr ON pr.seance_id = s.id AND pr.inscription_id = i.id
    WHERE s.date_debut::date BETWEEN $1 AND $2
      AND s.statut = 'effectue'
      AND (pr.statut IN ('absent','retard') OR pr.id IS NULL)
    GROUP BY s.date_debut::date
    ORDER BY jour
  `, [debut, fin])

  // Classement étudiants du mois — idem
  const { rows: classement } = await pool.query(`
    SELECT
      e.id, e.nom, e.prenom, e.numero_etudiant,
      jsonb_build_object('id',cl.id,'nom',cl.nom) AS classe,
      COUNT(CASE WHEN COALESCE(pr.statut,'absent')='absent' THEN 1 END)::int AS nb_absences,
      COUNT(CASE WHEN pr.statut='retard'                    THEN 1 END)::int AS nb_retards,
      COUNT(*)::int                                                           AS total_seances_concernees,
      ROUND(
        COUNT(CASE WHEN COALESCE(pr.statut,'absent')='absent' THEN 1 END)::numeric /
        NULLIF(COUNT(*),0) * 100, 1
      ) AS taux_absence
    FROM seances s
    JOIN inscriptions i ON (
        i.classe_id = s.classe_id
        OR i.classe_id IN (SELECT classe_id FROM classe_tronc_commun WHERE tronc_commun_id = s.classe_id)
      ) AND i.statut IN ('inscrit_actif','pre_inscrit')
    JOIN etudiants e     ON e.id = i.etudiant_id
    JOIN classes cl      ON cl.id = i.classe_id
    LEFT JOIN presences pr ON pr.seance_id = s.id AND pr.inscription_id = i.id
    WHERE s.date_debut::date BETWEEN $1 AND $2
      AND s.statut = 'effectue'
    GROUP BY e.id, e.nom, e.prenom, e.numero_etudiant, cl.id, cl.nom
    HAVING COUNT(CASE WHEN COALESCE(pr.statut,'absent')='absent' THEN 1 END) > 0
    ORDER BY nb_absences DESC, taux_absence DESC
    LIMIT 50
  `, [debut, fin])

  const totalAbsents = parJour.reduce((s: number, r: any) => s + r.absents, 0)
  const totalRetards = parJour.reduce((s: number, r: any) => s + r.retards, 0)
  const nbJoursAvecAbsence = parJour.length

  return c.json({ mois, debut, fin, par_jour: parJour, classement, total_absents: totalAbsents, total_retards: totalRetards, nb_jours: nbJoursAvecAbsence })
})

// GET /absences/classe?mois=YYYY-MM
app.get('/absences/classe', requireAuth, absenceRoles, async (c) => {
  const mois = c.req.query('mois') || new Date().toISOString().slice(0, 7)
  const debut = `${mois}-01`
  const fin   = new Date(new Date(debut).getFullYear(), new Date(debut).getMonth() + 1, 0).toISOString().slice(0, 10)

  const { rows } = await pool.query(`
    SELECT
      cl.id AS classe_id,
      cl.nom AS classe_nom,
      f.nom  AS filiere_nom,
      COUNT(DISTINCT s.id)::int                                           AS nb_seances,
      COUNT(DISTINCT i.etudiant_id)::int                                  AS nb_etudiants,
      COUNT(pr.id)::int                                                   AS total_presences,
      COUNT(CASE WHEN pr.statut='present'  THEN 1 END)::int              AS nb_presents,
      COUNT(CASE WHEN pr.statut='absent'   THEN 1 END)::int              AS nb_absents,
      COUNT(CASE WHEN pr.statut='retard'   THEN 1 END)::int              AS nb_retards,
      ROUND(
        COUNT(CASE WHEN pr.statut IN ('present','retard') THEN 1 END)::numeric /
        NULLIF(COUNT(pr.id),0) * 100, 1
      ) AS taux_presence,
      ROUND(
        COUNT(CASE WHEN pr.statut='absent' THEN 1 END)::numeric /
        NULLIF(COUNT(pr.id),0) * 100, 1
      ) AS taux_absence
    FROM classes cl
    LEFT JOIN filieres f          ON f.id = cl.filiere_id
    LEFT JOIN seances s           ON s.classe_id = cl.id
      AND s.date_debut::date BETWEEN $1 AND $2
      AND s.statut = 'effectue'
    LEFT JOIN presences pr        ON pr.seance_id = s.id
    LEFT JOIN inscriptions i      ON i.id = pr.inscription_id
    GROUP BY cl.id, cl.nom, f.nom
    HAVING COUNT(s.id) > 0
    ORDER BY taux_absence DESC NULLS LAST, cl.nom
  `, [debut, fin])

  return c.json({ mois, rows })
})

// ─── SUIVI ÉMARGEMENTS ──────────────────────────────────────────────────────
app.get('/suivi-emargements', requireAuth, role('dg', 'dir_peda', 'coordinateur', 'resp_fin', 'enseignant', 'secretariat'), async (c) => {
  const mois = c.req.query('mois') || new Date().toISOString().slice(0, 7) // YYYY-MM
  const anneeAcademiqueId = c.req.query('annee_academique_id')

  // Calculer le dernier jour réel du mois (évite l'erreur sur les mois < 31 jours)
  const debutMois = `${mois}-01`
  const finMois = new Date(new Date(debutMois).getFullYear(), new Date(debutMois).getMonth() + 1, 0).toISOString().slice(0, 10)

  // 1. Séances effectuées du mois avec détails enseignant/classe
  const params: any[] = [debutMois, finMois]
  let aaFilter = ''
  if (anneeAcademiqueId) {
    params.push(anneeAcademiqueId)
    aaFilter = ` AND s.annee_academique_id = $${params.length}`
  }

  const { rows: seancesJour } = await pool.query(`
    SELECT
      s.id, s.matiere, s.date_debut, s.date_fin, s.statut, s.mode,
      s.contenu_seance, s.signe_enseignant_at,
      EXTRACT(EPOCH FROM (s.date_fin - s.date_debut))/3600 AS heures,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom) as enseignant,
      jsonb_build_object('id',cl.id,'nom',cl.nom) as classe,
      (SELECT COUNT(*) FROM presences p WHERE p.seance_id = s.id AND p.statut = 'present')::int as nb_presents,
      (SELECT COUNT(*) FROM presences p WHERE p.seance_id = s.id)::int as nb_total
    FROM seances s
    LEFT JOIN enseignants e ON s.signe_enseignant_id = e.id
    LEFT JOIN classes cl ON s.classe_id = cl.id
    WHERE s.date_debut >= $1::date AND s.date_debut <= $2::date
      AND s.statut = 'effectue'${aaFilter}
    ORDER BY s.date_debut DESC
  `, params)

  // 2. Cumul par enseignant pour le mois
  const { rows: cumulEnseignants } = await pool.query(`
    SELECT
      e.id, e.nom, e.prenom,
      COUNT(s.id)::int as nb_seances,
      ROUND(SUM(EXTRACT(EPOCH FROM (s.date_fin - s.date_debut))/3600)::numeric, 1) as heures_total,
      COUNT(DISTINCT s.classe_id)::int as nb_classes,
      COUNT(DISTINCT DATE(s.date_debut))::int as nb_jours
    FROM seances s
    JOIN enseignants e ON s.signe_enseignant_id = e.id
    WHERE s.date_debut >= $1::date AND s.date_debut <= $2::date
      AND s.statut = 'effectue'${aaFilter}
    GROUP BY e.id, e.nom, e.prenom
    ORDER BY heures_total DESC
  `, params)

  // 3. Stats globales du mois
  const { rows: stats } = await pool.query(`
    SELECT
      COUNT(*)::int as total_seances,
      ROUND(SUM(EXTRACT(EPOCH FROM (s.date_fin - s.date_debut))/3600)::numeric, 1) as total_heures,
      COUNT(DISTINCT s.signe_enseignant_id)::int as nb_enseignants,
      COUNT(DISTINCT s.classe_id)::int as nb_classes,
      COUNT(DISTINCT DATE(s.date_debut))::int as nb_jours_actifs
    FROM seances s
    WHERE s.date_debut >= $1::date AND s.date_debut <= $2::date
      AND s.statut = 'effectue'${aaFilter}
  `, params)

  // 4. Détail par jour
  const { rows: parJour } = await pool.query(`
    SELECT
      DATE(s.date_debut) as jour,
      COUNT(*)::int as nb_seances,
      ROUND(SUM(EXTRACT(EPOCH FROM (s.date_fin - s.date_debut))/3600)::numeric, 1) as heures,
      COUNT(DISTINCT s.signe_enseignant_id)::int as nb_enseignants
    FROM seances s
    WHERE s.date_debut >= $1::date AND s.date_debut <= $2::date
      AND s.statut = 'effectue'${aaFilter}
    GROUP BY DATE(s.date_debut)
    ORDER BY jour
  `, params)

  return c.json({
    mois,
    stats: stats[0] || { total_seances: 0, total_heures: 0, nb_enseignants: 0, nb_classes: 0, nb_jours_actifs: 0 },
    par_jour: parJour,
    par_enseignant: cumulEnseignants,
    seances: seancesJour,
  })
})

// ─── VACATIONS ENSEIGNANTS ────────────────────────────────────────────────────

// GET /vacations — liste des vacations (avec filtres)
app.get('/vacations', requireAuth, async (c) => {
  // ── Migration inline garantie : s'assurer que les colonnes existent avant le SELECT ──
  await pool.query(`ALTER TABLE vacations ADD COLUMN IF NOT EXISTS type_formation_id INT`).catch(() => {})
  await pool.query(`ALTER TABLE vacations ADD COLUMN IF NOT EXISTS type_formation_libelle VARCHAR(100)`).catch(() => {})

  const mois = c.req.query('mois')
  const enseignantId = c.req.query('enseignant_id')
  const anneeId = c.req.query('annee_academique_id')
  const statut = c.req.query('statut')

  let where = 'WHERE 1=1'
  const params: any[] = []
  let idx = 1
  if (mois) { where += ` AND v.mois = $${idx++}`; params.push(mois) }
  if (enseignantId) { where += ` AND v.enseignant_id = $${idx++}`; params.push(parseInt(enseignantId)) }
  if (anneeId) { where += ` AND v.annee_academique_id = $${idx++}`; params.push(parseInt(anneeId)) }
  if (statut) { where += ` AND v.statut = $${idx++}`; params.push(statut) }

  const { rows } = await pool.query(`
    SELECT v.*,
      e.nom AS enseignant_nom, e.prenom AS enseignant_prenom,
      e.email AS enseignant_email, e.telephone AS enseignant_telephone,
      e.type_contrat, e.grade, e.specialite,
      aa.libelle AS annee_libelle,
      uv.nom AS valide_par_nom, uv.prenom AS valide_par_prenom,
      up.nom AS paye_par_nom, up.prenom AS paye_par_prenom
    FROM vacations v
    JOIN enseignants e ON e.id = v.enseignant_id
    LEFT JOIN annees_academiques aa ON aa.id = v.annee_academique_id
    LEFT JOIN users uv ON uv.id = v.valide_par
    LEFT JOIN users up ON up.id = v.paye_par
    ${where}
    ORDER BY v.mois DESC, e.nom, e.prenom
  `, params)

  return c.json(rows)
})

// POST /vacations/generer — génère automatiquement les vacations d'un mois (une ligne par type de formation)
app.post('/vacations/generer', requireAuth, async (c) => {
  const user = c.get('user') as any
  const { mois, annee_academique_id } = await c.req.json() as { mois: string; annee_academique_id?: number }
  if (!mois) return c.json({ error: 'mois requis (YYYY-MM)' }, 400)

  // ── Migration inline : garantir que les colonnes et l'index existent ──
  await pool.query(`ALTER TABLE vacations ADD COLUMN IF NOT EXISTS type_formation_id INT`).catch(() => {})
  await pool.query(`ALTER TABLE vacations ADD COLUMN IF NOT EXISTS type_formation_libelle VARCHAR(100)`).catch(() => {})
  await pool.query(`ALTER TABLE vacations DROP CONSTRAINT IF EXISTS vacations_enseignant_id_mois_key`).catch(() => {})
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vac_ens_mois_type'
      ) THEN
        CREATE UNIQUE INDEX idx_vac_ens_mois_type
          ON vacations (enseignant_id, mois, COALESCE(type_formation_id, 0));
      END IF;
    END $$
  `).catch(() => {})

  const debutMois = mois + '-01'
  const finMois = new Date(new Date(debutMois).getFullYear(), new Date(debutMois).getMonth() + 1, 0)
    .toISOString().slice(0, 10)

  // ── Étape 1 : résoudre le type_formation_id et le tarif pour chaque séance ──
  // Règles :
  //   - Classe normale  → filiere.type_formation_id → tarif correspondant
  //   - Tronc commun    → classe_tronc_commun → classe liée → filière → MAX tarif (type le plus élevé)
  // Puis on groupe par (enseignant_id, type_formation_id) pour additionner les heures.
  const { rows: cumuls } = await pool.query(`
    WITH seance_types AS (
      -- CTE 1 : résoudre type_formation_id ET tarif_filiere par séance
      SELECT
        s.enseignant_id,
        e.nom, e.prenom, e.tarif_horaire AS tarif_defaut,
        EXTRACT(EPOCH FROM (s.date_fin - s.date_debut)) / 3600 AS heures,
        -- Type de formation de la séance
        CASE
          WHEN COALESCE(c.est_tronc_commun, false) = false THEN f.type_formation_id
          ELSE
            (SELECT f3.type_formation_id
             FROM classe_tronc_commun ctc3
             JOIN classes c3 ON c3.id = ctc3.classe_id
             JOIN filieres f3 ON f3.id = c3.filiere_id
             LEFT JOIN tarifs_enseignants te3 ON te3.type_formation_id = f3.type_formation_id AND te3.montant_horaire > 0
             WHERE ctc3.tronc_commun_id = c.id AND f3.type_formation_id IS NOT NULL
             ORDER BY COALESCE(te3.montant_horaire, 0) DESC LIMIT 1)
        END AS type_formation_id,
        -- Tarif spécifique à la filière (priorité 1) — NULL si non défini ou 0
        CASE
          WHEN COALESCE(c.est_tronc_commun, false) = false THEN NULLIF(f.tarif_horaire, 0)
          ELSE
            (SELECT NULLIF(f3.tarif_horaire, 0)
             FROM classe_tronc_commun ctc3
             JOIN classes c3 ON c3.id = ctc3.classe_id
             JOIN filieres f3 ON f3.id = c3.filiere_id
             LEFT JOIN tarifs_enseignants te3 ON te3.type_formation_id = f3.type_formation_id AND te3.montant_horaire > 0
             WHERE ctc3.tronc_commun_id = c.id AND f3.type_formation_id IS NOT NULL
             ORDER BY COALESCE(te3.montant_horaire, 0) DESC LIMIT 1)
        END AS filiere_tarif
      FROM seances s
      JOIN enseignants e ON e.id = s.enseignant_id
      JOIN classes c ON c.id = s.classe_id
      LEFT JOIN filieres f ON f.id = c.filiere_id AND COALESCE(c.est_tronc_commun, false) = false
      WHERE s.statut = 'effectue'
        AND s.date_debut >= $1 AND s.date_debut <= $2
        AND s.enseignant_id IS NOT NULL
        AND s.fi_module_id IS NULL
    ),
    -- CTE 2 : résoudre le tarif effectif par séance (filière > type > individuel)
    seance_tarifs AS (
      SELECT
        st.*,
        COALESCE(
          st.filiere_tarif,
          (SELECT te.montant_horaire FROM tarifs_enseignants te
           WHERE te.type_formation_id = st.type_formation_id AND te.montant_horaire > 0
           ORDER BY te.montant_horaire DESC LIMIT 1),
          NULLIF(st.tarif_defaut, 0),
          0
        ) AS tarif_effectif
      FROM seance_types st
    )
    SELECT
      st.enseignant_id,
      st.nom, st.prenom,
      st.type_formation_id,
      tf.nom AS type_formation_libelle,
      SUM(st.heures) AS nb_heures,
      -- Tarif pondéré : si le prof enseigne dans 2 filières de même type avec des tarifs différents,
      -- on calcule le tarif moyen pondéré par les heures → le montant total reste exact.
      ROUND(SUM(st.heures * st.tarif_effectif) / NULLIF(SUM(st.heures), 0)) AS tarif_resolu
    FROM seance_tarifs st
    LEFT JOIN types_formation tf ON tf.id = st.type_formation_id
    GROUP BY st.enseignant_id, st.nom, st.prenom, st.type_formation_id, tf.nom
    HAVING SUM(st.heures) > 0
    ORDER BY st.nom, st.prenom, tf.nom NULLS LAST
  `, [debutMois, finMois + ' 23:59:59'])

  if (cumuls.length === 0) {
    return c.json({
      created: 0, updated: 0, total: 0,
      message: `Aucune séance marquée "effectuée" trouvée pour ${mois}. Marquez d'abord les séances comme effectuées dans l'emploi du temps.`
    })
  }

  // ── Étape 2 : Nettoyage des lignes en_attente stales avant recréation ──
  // On supprime TOUTES les lignes en_attente du mois pour les enseignants concernés.
  // Cela élimine les doublons (ex: ancienne ligne NULL + nouvelle ligne Académique)
  // Les lignes validées/payées ne sont PAS touchées.
  const enseignantIds = [...new Set(cumuls.map((r: any) => r.enseignant_id))]
  await pool.query(
    `DELETE FROM vacations WHERE mois = $1 AND statut = 'en_attente' AND enseignant_id = ANY($2)`,
    [mois, enseignantIds]
  )

  // ── Étape 3 : INSERT propre (plus de ON CONFLICT nécessaire après le nettoyage) ──
  let created = 0
  for (const row of cumuls) {
    const tarif = parseFloat(row.tarif_resolu) || 0
    const heures = parseFloat(row.nb_heures) || 0
    await pool.query(
      `INSERT INTO vacations (enseignant_id, annee_academique_id, mois, nb_heures, tarif_horaire,
                              type_formation_id, type_formation_libelle, statut, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'en_attente', $8)`,
      [row.enseignant_id, annee_academique_id || null, mois, heures, tarif,
       row.type_formation_id || null, row.type_formation_libelle || null, user.id]
    )
    created++
  }

  return c.json({
    created, updated: 0, total: cumuls.length,
    message: `${created} ligne(s) créée(s) (${enseignantIds.length} enseignant(s)) — lignes obsolètes nettoyées`
  })
})

// POST /vacations — créer/modifier manuellement une vacation
app.post('/vacations', requireAuth, async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json() as any
  const { enseignant_id, mois, nb_heures, tarif_horaire, annee_academique_id, note, type_formation_id, type_formation_libelle } = body

  if (!enseignant_id || !mois || nb_heures == null || tarif_horaire == null)
    return c.json({ error: 'enseignant_id, mois, nb_heures, tarif_horaire requis' }, 400)

  // Migration inline garantie
  await pool.query(`ALTER TABLE vacations ADD COLUMN IF NOT EXISTS type_formation_id INT`).catch(() => {})
  await pool.query(`ALTER TABLE vacations ADD COLUMN IF NOT EXISTS type_formation_libelle VARCHAR(100)`).catch(() => {})
  await pool.query(`ALTER TABLE vacations DROP CONSTRAINT IF EXISTS vacations_enseignant_id_mois_key`).catch(() => {})
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_vac_ens_mois_type') THEN
        CREATE UNIQUE INDEX idx_vac_ens_mois_type ON vacations (enseignant_id, mois, COALESCE(type_formation_id, 0));
      END IF;
    END $$
  `).catch(() => {})

  // Résoudre le libellé du type de formation si non fourni
  let typeLibelle = type_formation_libelle || null
  if (!typeLibelle && type_formation_id) {
    const tfRow = await pool.query('SELECT nom FROM types_formation WHERE id=$1', [type_formation_id])
    typeLibelle = tfRow.rows[0]?.nom || null
  }

  const { rows } = await pool.query(`
    INSERT INTO vacations (enseignant_id, annee_academique_id, mois, nb_heures, tarif_horaire,
                           type_formation_id, type_formation_libelle, note, statut, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'en_attente', $9)
    ON CONFLICT (enseignant_id, mois, COALESCE(type_formation_id, 0)) DO UPDATE
      SET nb_heures=$4, tarif_horaire=$5, type_formation_libelle=$7, note=$8, updated_at=NOW()
    RETURNING *
  `, [enseignant_id, annee_academique_id || null, mois, nb_heures, tarif_horaire,
      type_formation_id || null, typeLibelle, note || null, user.id])

  return c.json(rows[0])
})

// POST /vacations/:id/valider — valider une vacation (DG ou resp_fin)
app.post('/vacations/:id/valider', requireAuth, async (c) => {
  const user = c.get('user') as any
  if (!['dg', 'resp_fin'].includes(user.role)) return c.json({ error: 'Non autorisé' }, 403)
  const id = parseInt(c.req.param('id'))

  const { rows } = await pool.query(`
    UPDATE vacations SET statut='validee', valide_par=$1, valide_at=NOW(), updated_at=NOW()
    WHERE id=$2 AND statut='en_attente' RETURNING *
  `, [user.id, id])

  if (!rows[0]) return c.json({ error: 'Vacation introuvable ou déjà validée' }, 404)
  return c.json(rows[0])
})

// POST /vacations/:id/payer — marquer comme payée
app.post('/vacations/:id/payer', requireAuth, async (c) => {
  const user = c.get('user') as any
  if (!['dg', 'resp_fin'].includes(user.role)) return c.json({ error: 'Non autorisé' }, 403)
  const id = parseInt(c.req.param('id'))
  const { reference_paiement } = await c.req.json() as any

  const { rows } = await pool.query(`
    UPDATE vacations SET statut='payee', paye_par=$1, paye_at=NOW(), reference_paiement=$2, updated_at=NOW()
    WHERE id=$3 AND statut='validee' RETURNING *
  `, [user.id, reference_paiement || null, id])

  if (!rows[0]) return c.json({ error: 'Vacation introuvable ou non validée' }, 404)
  return c.json(rows[0])
})

// PUT /vacations/:id — modifier une vacation en attente
app.put('/vacations/:id', requireAuth, async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json() as any
  const { nb_heures, tarif_horaire, note } = body

  const { rows } = await pool.query(`
    UPDATE vacations SET nb_heures=$1, tarif_horaire=$2, note=$3, updated_at=NOW()
    WHERE id=$4 AND statut='en_attente' RETURNING *
  `, [nb_heures, tarif_horaire, note || null, id])

  if (!rows[0]) return c.json({ error: 'Vacation introuvable ou non modifiable' }, 404)
  return c.json(rows[0])
})

// PATCH /vacations/:id/tarif — correction du tarif horaire par le DG (tous statuts)
app.patch('/vacations/:id/tarif', requireAuth, role('dg'), async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json() as any
  const tarif_horaire = parseFloat(body.tarif_horaire)
  if (isNaN(tarif_horaire) || tarif_horaire <= 0) return c.json({ error: 'Taux horaire invalide' }, 422)

  // montant est une colonne GENERATED ALWAYS — se recalcule automatiquement
  const { rows } = await pool.query(`
    UPDATE vacations
    SET tarif_horaire = $1,
        updated_at    = NOW()
    WHERE id = $2
    RETURNING *
  `, [tarif_horaire, id])

  if (!rows[0]) return c.json({ error: 'Vacation introuvable' }, 404)
  return c.json(rows[0])
})

// DELETE /vacations/:id
app.delete('/vacations/:id', requireAuth, async (c) => {
  const user = c.get('user') as any
  if (!['dg', 'resp_fin'].includes(user.role)) return c.json({ error: 'Non autorisé' }, 403)
  const id = parseInt(c.req.param('id'))

  const { rows } = await pool.query('DELETE FROM vacations WHERE id=$1 AND statut=\'en_attente\' RETURNING id', [id])
  if (!rows[0]) return c.json({ error: 'Vacation introuvable ou non supprimable' }, 404)
  return c.json({ ok: true })
})

// GET /vacations/resume — résumé global par mois
app.get('/vacations/resume', requireAuth, async (c) => {
  const mois = c.req.query('mois')
  const anneeId = c.req.query('annee_academique_id')

  let where = 'WHERE 1=1'
  const params: any[] = []
  let idx = 1
  if (mois) { where += ` AND v.mois = $${idx++}`; params.push(mois) }
  if (anneeId) { where += ` AND v.annee_academique_id = $${idx++}`; params.push(parseInt(anneeId)) }

  const { rows } = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(v.nb_heures) AS total_heures,
      SUM(v.montant) AS total_montant,
      SUM(CASE WHEN v.statut='en_attente' THEN v.montant ELSE 0 END) AS montant_en_attente,
      SUM(CASE WHEN v.statut='validee' THEN v.montant ELSE 0 END) AS montant_valide,
      SUM(CASE WHEN v.statut='payee' THEN v.montant ELSE 0 END) AS montant_paye,
      COUNT(CASE WHEN v.statut='en_attente' THEN 1 END) AS nb_en_attente,
      COUNT(CASE WHEN v.statut='validee' THEN 1 END) AS nb_valide,
      COUNT(CASE WHEN v.statut='payee' THEN 1 END) AS nb_paye
    FROM vacations v ${where}
  `, params)

  return c.json(rows[0])
})

// ─── Jury endpoints ───────────────────────────────────────────────────────────
// Enseignants suggérés pour un jury (par classe + année)
// Niveau 1 : ont des séances dans la classe cette année
// Niveau 2 (fallback) : assignés à des UEs de la classe
app.get('/jurys/classe/:classeId/enseignants-suggests', requireAuth, async (c) => {
  const classeId = parseInt(c.req.param('classeId'))
  const anneeId  = c.req.query('annee_id') ? parseInt(c.req.query('annee_id')!) : null

  const { rows } = await pool.query(`
    SELECT id, nom, prenom, COALESCE(specialite,'') AS specialite,
           MAX(nb_seances) AS nb_seances,
           CASE WHEN MAX(nb_seances) > 0 THEN 'seance' ELSE 'ue' END AS source
    FROM (
      -- Niveau 1 : séances effectuées dans la classe (ou planifiées)
      SELECT e.id, e.nom, e.prenom, e.specialite,
             COUNT(s.id) AS nb_seances
      FROM enseignants e
      JOIN seances s ON s.enseignant_id = e.id
      WHERE s.classe_id = $1
        AND ($2::int IS NULL OR s.annee_academique_id = $2)
      GROUP BY e.id, e.nom, e.prenom, e.specialite

      UNION ALL

      -- Niveau 2 : assignés à des UEs de la classe (sans séances)
      SELECT e.id, e.nom, e.prenom, e.specialite, 0 AS nb_seances
      FROM enseignants e
      JOIN unites_enseignement ue ON ue.enseignant_id = e.id
      WHERE ue.classe_id = $1
    ) sub
    GROUP BY id, nom, prenom, specialite
    ORDER BY MAX(nb_seances) DESC, nom
  `, [classeId, anneeId])

  return c.json(rows)
})

app.get('/jurys/classe/:classeId', requireAuth, async (c) => {
  const classeId = c.req.param('classeId')
  const session = c.req.query('session') ?? 'normale'
  const { rows } = await pool.query(
    `SELECT j.*,
      json_agg(jm.* ORDER BY jm.ordre) FILTER (WHERE jm.id IS NOT NULL) as membres
     FROM jurys j
     LEFT JOIN jury_membres jm ON jm.jury_id = j.id
     WHERE j.classe_id = $1 AND j.session = $2
     GROUP BY j.id ORDER BY j.created_at DESC LIMIT 1`,
    [classeId, session]
  )
  return c.json(rows[0] ?? null)
})

app.post('/jurys', requireAuth, async (c) => {
  const body = await c.req.json()
  const { classe_id, annee_academique_id, session, date_deliberation } = body
  const userId = (c as any).get('userId')
  const { rows } = await pool.query(
    `INSERT INTO jurys (classe_id, annee_academique_id, session, date_deliberation, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [classe_id, annee_academique_id ?? null, session ?? 'normale', date_deliberation ?? null, userId]
  )
  return c.json(rows[0])
})

app.put('/jurys/:id/cloturer', requireAuth, async (c) => {
  const id = c.req.param('id')
  const { rows } = await pool.query(
    `UPDATE jurys SET statut='cloture' WHERE id=$1 RETURNING *`, [id]
  )
  return c.json(rows[0])
})

// Rouvrir un jury clôturé (DG uniquement)
app.put('/jurys/:id/rouvrir', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  const { rows } = await pool.query(
    `UPDATE jurys SET statut='ouvert' WHERE id=$1 RETURNING *`, [id]
  )
  if (!rows[0]) return c.json({ error: 'Jury introuvable' }, 404)
  return c.json(rows[0])
})

// Supprimer un jury (DG uniquement, cascade sur membres + décisions)
app.delete('/jurys/:id', requireAuth, role('dg'), async (c) => {
  const id = c.req.param('id')
  await pool.query(`DELETE FROM jurys WHERE id=$1`, [id])
  return c.json({ ok: true })
})

app.put('/jurys/:id', requireAuth, async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { date_deliberation, statut } = body
  const { rows } = await pool.query(
    `UPDATE jurys SET date_deliberation=$1, statut=$2 WHERE id=$3 RETURNING *`,
    [date_deliberation ?? null, statut ?? 'ouvert', id]
  )
  return c.json(rows[0])
})

app.post('/jurys/:id/membres', requireAuth, async (c) => {
  const juryId = c.req.param('id')
  const { membres } = await c.req.json()
  await pool.query(`DELETE FROM jury_membres WHERE jury_id=$1`, [juryId])
  for (let i = 0; i < membres.length; i++) {
    const m = membres[i]
    await pool.query(
      `INSERT INTO jury_membres (jury_id, nom, fonction, ordre) VALUES ($1,$2,$3,$4)`,
      [juryId, m.nom, m.fonction ?? '', i]
    )
  }
  const { rows } = await pool.query(`SELECT * FROM jury_membres WHERE jury_id=$1 ORDER BY ordre`, [juryId])
  return c.json(rows)
})

app.get('/jurys/:id/decisions', requireAuth, async (c) => {
  const juryId = c.req.param('id')
  const { rows } = await pool.query(
    `SELECT * FROM jury_decisions WHERE jury_id=$1`, [juryId]
  )
  return c.json(rows)
})

app.post('/jurys/:id/decisions', requireAuth, async (c) => {
  const juryId = c.req.param('id')
  const { decisions } = await c.req.json()
  for (const d of decisions) {
    await pool.query(
      `INSERT INTO jury_decisions (jury_id, inscription_id, decision, observation)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (jury_id, inscription_id) DO UPDATE SET decision=$3, observation=$4`,
      [juryId, d.inscription_id, d.decision, d.observation ?? null]
    )
  }
  const { rows } = await pool.query(`SELECT * FROM jury_decisions WHERE jury_id=$1`, [juryId])
  return c.json(rows)
})

// ─── NOTIFICATIONS ───────────────────────────────────────────────────────────

// Helper générique Brevo
async function sendBrevoEmail(to: string, subject: string, htmlContent: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) return { ok: false, error: 'BREVO_API_KEY non configuré' }
  const fromEmail = process.env.BREVO_FROM_EMAIL || 'noreply@uptech.edu'
  const fromName  = process.env.BREVO_FROM_NAME  || 'UPTECH Campus'
  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: [{ email: to }],
        subject,
        htmlContent,
      }),
    })
    if (!resp.ok) {
      const err = await resp.text()
      return { ok: false, error: err.slice(0, 300) }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// Remplacer les variables dans un template
function applyVars(text: string, vars: Record<string, string>): string {
  let out = text
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, v)
  }
  return out
}

// Email HTML wrapper standard
function emailHtml(corps: string, nomEtab = 'UPTECH Campus'): string {
  return `<!DOCTYPE html><html lang="fr"><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<div style="background:#E30613;color:white;padding:16px 24px;border-radius:8px 8px 0 0">
  <h2 style="margin:0">${nomEtab}</h2>
</div>
<div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
  ${corps}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="color:#9ca3af;font-size:11px">Ce message est envoyé automatiquement depuis la plateforme UPTECH Campus. Ne pas répondre directement à cet email.</p>
</div>
</body></html>`
}

// GET /notifications — historique
app.get('/notifications', requireAuth, role('dg', 'dir_peda', 'secretariat', 'resp_fin'), async (c) => {
  const limit  = parseInt(c.req.query('limit')  || '50')
  const offset = parseInt(c.req.query('offset') || '0')
  const type   = c.req.query('type') || ''

  const conds = type ? `WHERE n.type = $3` : ''
  const params: any[] = [limit, offset]
  if (type) params.push(type)

  const { rows } = await pool.query(`
    SELECT n.*,
      u.prenom || ' ' || u.nom AS envoye_par_nom
    FROM notifications n
    LEFT JOIN users u ON u.id = n.envoye_par
    ${conds}
    ORDER BY n.created_at DESC
    LIMIT $1 OFFSET $2
  `, params)

  const { rows: [cnt] } = await pool.query(
    `SELECT COUNT(*) AS total FROM notifications${type ? ' WHERE type=$1' : ''}`,
    type ? [type] : []
  )
  return c.json({ notifications: rows, total: parseInt(cnt.total) })
})

// GET /notification-templates
app.get('/notification-templates', requireAuth, role('dg', 'dir_peda', 'secretariat'), async (c) => {
  const { rows } = await pool.query(`SELECT * FROM notification_templates ORDER BY id`)
  return c.json(rows)
})

// PUT /notification-templates/:id
app.put('/notification-templates/:id', requireAuth, role('dg', 'dir_peda'), async (c) => {
  const id = parseInt(c.req.param('id'))
  const { sujet, corps } = await c.req.json()
  if (!sujet || !corps) return c.json({ error: 'sujet et corps requis' }, 400)
  const { rows } = await pool.query(
    `UPDATE notification_templates SET sujet=$1, corps=$2 WHERE id=$3 RETURNING *`,
    [sujet, corps, id]
  )
  if (!rows[0]) return c.json({ error: 'Template introuvable' }, 404)
  return c.json(rows[0])
})

// POST /notifications/send
app.post('/notifications/send', requireAuth, role('dg', 'dir_peda', 'secretariat'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const {
    type = 'custom',
    sujet: sujetOverride,
    corps: corpsOverride,
    canal = 'email',
    cible_type = 'tous',
    cible_id,
    annee_id,
    vars_extra = {},
  } = body

  // 1. Récupérer le template si non custom
  let sujetTpl = sujetOverride || ''
  let corpsTpl = corpsOverride || ''
  if ((!sujetTpl || !corpsTpl) && type !== 'custom') {
    const { rows: tpls } = await pool.query(
      `SELECT * FROM notification_templates WHERE type=$1`, [type]
    )
    if (tpls[0]) {
      sujetTpl = sujetTpl || tpls[0].sujet
      corpsTpl = corpsTpl || tpls[0].corps
    }
  }
  if (!sujetTpl || !corpsTpl) return c.json({ error: 'Sujet et corps requis' }, 400)

  // 2. Récupérer le nom établissement
  const { rows: paramRows } = await pool.query(
    `SELECT valeur FROM parametres_systeme WHERE cle='nom_etablissement'`
  ).catch(() => ({ rows: [] }))
  const nomEtab = paramRows[0]?.valeur || 'UPTECH Campus'

  // 3. Construire la requête de destinataires
  let query = `
    SELECT DISTINCT e.id, e.nom, e.prenom, e.numero_etudiant,
      COALESCE(u.email, e.email) AS email,
      COALESCE(u.telephone, e.telephone) AS telephone,
      f.nom AS filiere_nom,
      cl.nom AS classe_nom
    FROM etudiants e
    JOIN inscriptions i ON i.etudiant_id = e.id
    JOIN classes cl ON cl.id = i.classe_id
    LEFT JOIN filieres f ON f.id = cl.filiere_id
    LEFT JOIN users u ON u.id = e.user_id
    WHERE i.statut IN ('inscrit_actif', 'pre_inscrit')
  `
  const qparams: any[] = []

  if (annee_id) {
    qparams.push(annee_id)
    query += ` AND i.annee_academique_id = $${qparams.length}`
  }
  if (cible_type === 'classe' && cible_id) {
    qparams.push(cible_id)
    query += ` AND i.classe_id = $${qparams.length}`
  } else if (cible_type === 'filiere' && cible_id) {
    qparams.push(cible_id)
    query += ` AND cl.filiere_id = $${qparams.length}`
  } else if (cible_type === 'etudiant' && cible_id) {
    qparams.push(cible_id)
    query += ` AND e.id = $${qparams.length}`
  } else if (cible_type === 'jury' && cible_id) {
    qparams.push(cible_id)
    query += ` AND i.classe_id = (SELECT classe_id FROM jurys WHERE id=$${qparams.length})`
  }

  const { rows: etudiants } = await pool.query(query, qparams)
  if (etudiants.length === 0) return c.json({ error: 'Aucun destinataire trouvé' }, 400)

  // 4. Enregistrer la notification
  const { rows: [notif] } = await pool.query(
    `INSERT INTO notifications (type, sujet, corps, canal, nb_destinataires, cible_type, cible_id, annee_id, envoye_par)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [type, sujetTpl, corpsTpl, canal, etudiants.length, cible_type, cible_id || null, annee_id || null, user.id]
  )
  const notifId = notif.id

  // 5. Envoyer à chaque destinataire (batch non bloquant)
  let nbOk = 0; let nbErr = 0
  const sendPromises = etudiants.map(async (et: any) => {
    const emailDest = et.email as string | null
    if (!emailDest) { nbErr++; return }

    // Interpoler les variables
    const varsMap: Record<string, string> = {
      prenom: et.prenom || '',
      nom: et.nom || '',
      numero_etudiant: et.numero_etudiant || '',
      filiere: et.filiere_nom || '',
      classe: et.classe_nom || '',
      ...vars_extra,
    }
    const sujetFinal = applyVars(sujetTpl, varsMap)
    const corpsFinal = applyVars(corpsTpl, varsMap)
    const html = emailHtml(corpsFinal, nomEtab)

    if (canal === 'email' || canal === 'les_deux') {
      const res = await sendBrevoEmail(emailDest, sujetFinal, html)
      if (res.ok) nbOk++; else nbErr++
    }
    // SMS placeholder
    if (canal === 'sms' || canal === 'les_deux') {
      // TODO: intégrer Orange SMS / Twilio
      nbErr++
    }
  })

  await Promise.allSettled(sendPromises)

  await pool.query(
    `UPDATE notifications SET nb_envoyes=$1, nb_erreurs=$2 WHERE id=$3`,
    [nbOk, nbErr, notifId]
  ).catch(() => {})

  return c.json({
    id: notifId,
    nb_destinataires: etudiants.length,
    nb_envoyes: nbOk,
    nb_erreurs: nbErr,
    message: `Notification envoyée à ${nbOk}/${etudiants.length} destinataire(s)`,
  })
})

// ─── User notifications (cloche in-app) ──────────────────────────────────────

// GET /user-notifications — liste pour l'utilisateur connecté
app.get('/user-notifications', requireAuth, async (c) => {
  const userId = u(c).id
  const { rows } = await pool.query(
    `SELECT * FROM user_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
    [userId]
  )
  const unread = rows.filter((r: any) => !r.lu).length
  return c.json({ notifications: rows, unread })
})

// POST /user-notifications/read-all — marquer tout comme lu
app.post('/user-notifications/read-all', requireAuth, async (c) => {
  const userId = u(c).id
  await pool.query(
    `UPDATE user_notifications SET lu=TRUE, lu_at=NOW() WHERE user_id=$1 AND lu=FALSE`,
    [userId]
  )
  return c.json({ ok: true })
})

// POST /user-notifications/:id/read — marquer une notif comme lue
app.post('/user-notifications/:id/read', requireAuth, async (c) => {
  const userId = u(c).id
  await pool.query(
    `UPDATE user_notifications SET lu=TRUE, lu_at=NOW() WHERE id=$1 AND user_id=$2`,
    [c.req.param('id'), userId]
  )
  return c.json({ ok: true })
})

// ─── Vercel handler ───────────────────────────────────────────────────────────
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const host = (req.headers.host as string) || 'localhost'
    const url = new URL(req.url || '/', `https://${host}`)

    // Collect body for non-GET requests
    let bodyText: string | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      bodyText = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
        req.on('error', reject)
      })
    }

    // Build clean headers (no host/content-length to avoid conflicts)
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined && k !== 'host' && k !== 'content-length' && k !== 'transfer-encoding') {
        headers[k] = Array.isArray(v) ? v.join(', ') : v
      }
    }

    const request = new Request(url.toString(), {
      method: req.method || 'GET',
      headers,
      body: bodyText || undefined,
    })

    const response = await app.fetch(request)
    res.statusCode = response.status
    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value)
    })
    const buf = Buffer.from(await response.arrayBuffer())
    res.end(buf)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('API error:', message, stack)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ message, stack }))
  }
}
