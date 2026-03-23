import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { Pool } from 'pg'
// @ts-ignore — CJS default export works at runtime
import jwt from 'jsonwebtoken'
// @ts-ignore — CJS default export works at runtime
import bcrypt from 'bcryptjs'
import type { IncomingMessage, ServerResponse } from 'http'

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
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS contenu_seance TEXT`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS objectifs TEXT`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS signe_enseignant_at TIMESTAMP`).catch(() => {})
pool.query(`ALTER TABLE seances ADD COLUMN IF NOT EXISTS signe_enseignant_id INT REFERENCES enseignants(id) ON DELETE SET NULL`).catch(() => {})
pool.query(`DO $$ BEGIN ALTER TABLE seances DROP CONSTRAINT IF EXISTS seances_statut_check; ALTER TABLE seances ADD CONSTRAINT seances_statut_check CHECK (statut IN ('planifie','confirme','annule','reporte','effectue')); EXCEPTION WHEN OTHERS THEN NULL; END $$`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS specialite VARCHAR(150)`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS grade VARCHAR(80)`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS type_contrat VARCHAR(30) DEFAULT 'vacataire'`).catch(() => {})
pool.query(`ALTER TABLE enseignants ADD COLUMN IF NOT EXISTS tarif_horaire DECIMAL(10,2) DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS tronc_commun_id INT REFERENCES classes(id) ON DELETE SET NULL`).catch(() => {})
pool.query(`ALTER TABLE filieres ADD COLUMN IF NOT EXISTS montant_tenue INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE niveaux_bourse ADD COLUMN IF NOT EXISTS applique_tenue BOOLEAN DEFAULT FALSE`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS coefficient DECIMAL(5,2) DEFAULT 1`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 0`).catch(() => {})
pool.query(`ALTER TABLE filiere_matiere ADD COLUMN IF NOT EXISTS ordre INTEGER DEFAULT 0`).catch(() => {})
// Lien UE → matière globale (pour coefficient cross-filière en tronc commun)
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS matiere_id INT REFERENCES matieres(id) ON DELETE SET NULL`).catch(() => {})
pool.query(`ALTER TABLE unites_enseignement ADD COLUMN IF NOT EXISTS volume_horaire INTEGER DEFAULT 0`).catch(() => {})
pool.query(`DO $$ BEGIN ALTER TABLE paiements DROP CONSTRAINT IF EXISTS paiements_type_paiement_check; ALTER TABLE paiements ADD CONSTRAINT paiements_type_paiement_check CHECK (type_paiement IN ('frais_inscription','mensualite','tenue','rattrapage','autre')); EXCEPTION WHEN OTHERS THEN NULL; END $$`).catch(() => {})
pool.query(`ALTER TABLE types_formation ADD COLUMN IF NOT EXISTS has_niveau BOOLEAN DEFAULT FALSE`).catch(() => {})
pool.query(`ALTER TABLE types_formation ADD COLUMN IF NOT EXISTS description TEXT`).catch(() => {})
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

const JWT_SECRET = process.env.JWT_SECRET || 'uptech-dev-secret-2026'

// ─── Types ────────────────────────────────────────────────────────────────────
type Env = { Variables: { user: Record<string, unknown> } }

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
async function nextSeq(table: string) {
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

  if (user.statut === 'bloque' || (user.bloque_jusqu_a && new Date(user.bloque_jusqu_a as string) > new Date()))
    return c.json({ message: 'Compte bloqué. Contactez un administrateur.', bloque: true }, 403)

  if (['inactif', 'suspendu'].includes(user.statut as string))
    return c.json({ message: 'Votre compte est inactif ou suspendu.' }, 403)

  if (!await bcrypt.compare(password as string, user.password as string)) {
    const attempts = ((user.tentatives_echec as number) || 0) + 1
    if (attempts >= 5) {
      await pool.query(
        "UPDATE users SET tentatives_echec=$1, statut='bloque', bloque_jusqu_a=NOW()+INTERVAL '24 hours' WHERE id=$2",
        [attempts, user.id]
      )
    } else {
      await pool.query('UPDATE users SET tentatives_echec=$1 WHERE id=$2', [attempts, user.id])
    }
    return c.json({ message: 'Identifiants incorrects.', tentatives_restantes: Math.max(0, 5 - attempts) }, 401)
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
app.get('/users', requireAuth, role('dg'), async (c) => {
  const { rows } = await pool.query(
    `SELECT id,nom,prenom,email,role,statut,telephone,photo_path,last_login_at,created_at
     FROM users WHERE role NOT IN ('enseignant','etudiant') ORDER BY nom,prenom`
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
    'INSERT INTO filieres (nom,code,description,actif,type_formation_id,frais_inscription,mensualite,duree_mois,montant_tenue) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [b.nom, b.code, b.description || null, b.actif ?? true, b.type_formation_id || null, b.frais_inscription || 0, b.mensualite || 0, b.duree_mois || null, b.montant_tenue || 0]
  )
  return c.json(rows[0], 201)
})

app.put('/filieres/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE filieres SET nom=$1,code=$2,description=$3,actif=$4,type_formation_id=$5,frais_inscription=$6,mensualite=$7,duree_mois=$8,montant_tenue=$9 WHERE id=$10 RETURNING *',
    [b.nom, b.code, b.description || null, b.actif ?? true, b.type_formation_id || null, b.frais_inscription || 0, b.mensualite || 0, b.duree_mois || null, b.montant_tenue || 0, c.req.param('id')]
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
    'INSERT INTO types_formation (nom,code,description,has_niveau) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.nom, b.code || null, b.description || null, b.has_niveau ?? false]
  )
  return c.json(rows[0], 201)
})

app.put('/types-formation/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE types_formation SET nom=$1,code=$2,description=$3,has_niveau=$4,actif=$5 WHERE id=$6 RETURNING *',
    [b.nom, b.code || null, b.description || null, b.has_niveau ?? false, b.actif ?? true, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.delete('/types-formation/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM types_formation WHERE id=$1', [c.req.param('id')])
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
      CASE WHEN tc.id IS NOT NULL THEN jsonb_build_object('id',tc.id,'nom',tc.nom) ELSE NULL END as tronc_commun
    FROM classes c
    LEFT JOIN filieres f ON c.filiere_id = f.id
    LEFT JOIN annees_academiques aa ON c.annee_academique_id = aa.id
    LEFT JOIN classes_parcours cp ON c.id = cp.classe_id
    LEFT JOIN parcours p ON cp.parcours_id = p.id
    LEFT JOIN classes tc ON c.tronc_commun_id = tc.id
    GROUP BY c.id,f.id,f.nom,f.code,f.type_formation_id,aa.id,aa.libelle,tc.id,tc.nom ORDER BY c.nom
  `)
  return c.json(rows)
})

app.post('/classes', requireAuth, role('dg', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const estTronc = b.est_tronc_commun ?? false
  const { rows } = await pool.query(
    'INSERT INTO classes (nom,filiere_id,annee_academique_id,niveau,est_tronc_commun,tronc_commun_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [b.nom, estTronc ? null : b.filiere_id, b.annee_academique_id, b.niveau ?? 1, estTronc, b.tronc_commun_id || null, u(c).id]
  )
  const classe = rows[0]
  if (Array.isArray(b.parcours_ids)) {
    for (const pid of b.parcours_ids)
      await pool.query('INSERT INTO classes_parcours (classe_id,parcours_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [classe.id, pid])
  }
  return c.json(classe, 201)
})

app.put('/classes/:id', requireAuth, role('dg', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const estTronc = b.est_tronc_commun ?? false
  const { rows } = await pool.query(
    'UPDATE classes SET nom=$1,filiere_id=$2,annee_academique_id=$3,niveau=$4,est_tronc_commun=$5,tronc_commun_id=$6 WHERE id=$7 RETURNING *',
    [b.nom, estTronc ? null : b.filiere_id, b.annee_academique_id, b.niveau ?? 1, estTronc, b.tronc_commun_id || null, c.req.param('id')]
  )
  await pool.query('DELETE FROM classes_parcours WHERE classe_id=$1', [c.req.param('id')])
  if (Array.isArray(b.parcours_ids)) {
    for (const pid of b.parcours_ids)
      await pool.query('INSERT INTO classes_parcours (classe_id,parcours_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.req.param('id'), pid])
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
  const perPage        = 20
  const offset         = (page - 1) * perPage

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

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const cte = `
    WITH ia AS (
      SELECT DISTINCT ON (ins.etudiant_id)
        ins.etudiant_id, ins.filiere_id, ins.classe_id, f.type_formation_id
      FROM inscriptions ins
      LEFT JOIN filieres f ON ins.filiere_id = f.id
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
      WHERE ins.etudiant_id = e.id
      ORDER BY ins.created_at DESC LIMIT 1
      ) as inscription_active
    FROM etudiants e
    LEFT JOIN ia ON ia.etudiant_id = e.id
    ${whereClause} ORDER BY e.nom, e.prenom
    LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  )
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  return c.json({ data: rows, current_page: page, last_page: lastPage, per_page: perPage, total })
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
        CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom,'niveau',c.niveau,
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
      await client.query(`DELETE FROM documents_etudiant WHERE inscription_id = ANY($1::int[])`, [inscIds])
      await client.query('DELETE FROM inscriptions WHERE etudiant_id=$1', [id])
    }

    // Documents restants liés directement à l'étudiant
    await client.query('DELETE FROM documents_etudiant WHERE etudiant_id=$1', [id])

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
    conditions.push(`(i.classe_id = $${params.length} OR i.classe_id IN (SELECT id FROM classes WHERE tronc_commun_id = $${params.length}))`)
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
  const { rows } = await pool.query(
    `INSERT INTO inscriptions (etudiant_id,filiere_id,classe_id,parcours_id,annee_academique_id,
      niveau_entree_id,niveau_bourse_id,statut,frais_inscription,mensualite,frais_tenue,reduction_type,reduction_valeur,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [b.etudiant_id, b.filiere_id || null, b.classe_id || null, b.parcours_id || null, b.annee_academique_id,
     b.niveau_entree_id || null, b.niveau_bourse_id || null, b.statut || 'pre_inscrit',
     fraisInscription, mensualite, fraisTenue,
     b.reduction_type || null, b.reduction_valeur || null, u(c).id]
  )
  // Générer les échéances immédiatement dès l'inscription
  genererEcheances(rows[0].id).catch(() => {})

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
  const { rows } = await pool.query(
    `UPDATE inscriptions SET filiere_id=$1,classe_id=$2,parcours_id=$3,annee_academique_id=$4,
      niveau_entree_id=$5,niveau_bourse_id=$6,statut=$7,frais_inscription=$8,mensualite=$9,
      frais_tenue=$10,reduction_type=$11,reduction_valeur=$12
     WHERE id=$13 RETURNING *`,
    [b.filiere_id || null, classeId, b.parcours_id || null, b.annee_academique_id,
     b.niveau_entree_id || null, b.niveau_bourse_id || null, b.statut || 'pre_inscrit',
     fraisInscription, mensualite, b.frais_tenue || 0,
     b.reduction_type || null, b.reduction_valeur || null, c.req.param('id')]
  )
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
  await genererEcheances(inscId).catch(() => {})
  return c.json(rows[0])
})

app.put('/inscriptions/:id/statut', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { statut } = await c.req.json()
  const { rows } = await pool.query('UPDATE inscriptions SET statut=$1 WHERE id=$2 RETURNING *', [statut, c.req.param('id')])
  return c.json(rows[0])
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

  // Séances ce mois
  const { rows: seancesMois } = await pool.query(`
    SELECT COUNT(*)::int as total,
      COALESCE(SUM(EXTRACT(EPOCH FROM (date_fin - date_debut))/3600), 0)::numeric(10,2) as heures
    FROM seances
    WHERE enseignant_id=$1
      AND statut IN ('planifie','confirme')
      AND date_trunc('month', date_debut::timestamptz) = $2::date
  `, [id, moisCourant + '-01'])

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
           WHERE cl.tronc_commun_id = c.id)
      END AS tarif_horaire
    FROM seances s
    JOIN classes c ON s.classe_id = c.id
    WHERE s.enseignant_id = $1 AND s.statut = 'effectue'
  `, [id])

  // Totaux
  const heuresTot = seancesDetail.reduce((sum: number, r: any) => sum + parseFloat(r.heures || 0), 0)
  const montantDu = Math.round(seancesDetail.reduce((sum: number, r: any) =>
    sum + parseFloat(r.heures || 0) * parseFloat(r.tarif_horaire || 0), 0))

  // Séances totales (toutes effectuées)
  const seancesTot = [{ total: seancesDetail.length, heures: heuresTot.toFixed(2) }]

  // Tarif moyen effectif pour affichage (montant_du / heures ou 0)
  const tarif = heuresTot > 0 ? Math.round(montantDu / heuresTot) : 0

  const heuresMois = parseFloat(seancesMois[0]?.heures) || 0

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

  return c.json({
    seances_ce_mois: seancesMois[0]?.total || 0,
    heures_ce_mois: heuresMois,
    seances_total: seancesTot[0]?.total || 0,
    heures_total: Math.round(heuresTot * 100) / 100,
    tarif_horaire: tarif,           // tarif moyen pondéré pour affichage
    montant_du: montantDu,          // calculé depuis tarifs_enseignants par type de formation
    montant_paye: vacPaye,
    montant_restant: Math.max(0, montantDu - vacPaye),
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
  return c.json({ message: 'PDF non supporté en serverless.' }, 501)
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

  const [kpis, monthly, cats, parFiliere, recentPay, recentDep, creances] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COALESCE(SUM(montant),0)::float FROM paiements WHERE ${payWhereSimple}) AS recettes_total,
        (SELECT COALESCE(SUM(montant),0)::float FROM depenses   WHERE ${depWhereSimple}) AS depenses_total
    `),
    pool.query(`
      WITH months AS (${monthsSql})
      SELECT
        to_char(m.m, 'YYYY-MM') AS mois,
        to_char(m.m, 'Mon YYYY') AS label,
        COALESCE((SELECT SUM(p.montant) FROM paiements p
          WHERE ${payWhere} AND date_trunc('month', COALESCE(p.confirmed_at, p.created_at)::timestamptz) = m.m
        ), 0)::float AS recettes,
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
  ])

  const r = kpis.rows[0]
  return c.json({
    kpis: {
      recettes_total: r.recettes_total,
      depenses_total: r.depenses_total,
      solde_net: (r.recettes_total as number) - (r.depenses_total as number),
      creances: creances.rows[0].total,
    },
    monthly: monthly.rows,
    categories: cats.rows,
    par_filiere: parFiliere.rows,
    recent: [
      ...recentPay.rows.map((row: any) => ({ ...row, sens: 'entree', libelle: row.etudiant || row.type_paiement })),
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
  const [et, ia, iatt, iv, fi, cl, enc, dep, totR, totD, pa] = await Promise.all([
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

// ─── ÉCHEANCES ────────────────────────────────────────────────────────────────
async function genererEcheances(inscriptionId: number, moisDebut?: string) {
  const { rows } = await pool.query(`
    SELECT
      -- Filière = source de vérité pour les tarifs de base.
      -- On prend f.mensualite si défini (> 0), sinon fallback sur i.mensualite
      COALESCE(NULLIF(f.mensualite, 0), i.mensualite, 0)          AS mensualite,
      COALESCE(NULLIF(f.frais_inscription, 0), i.frais_inscription, 0) AS frais_inscription,
      COALESCE(NULLIF(f.montant_tenue, 0), i.frais_tenue, 0)      AS frais_tenue,
      i.niveau_bourse_id,
      COALESCE(f.duree_mois, 12) as duree_mois,
      COALESCE(nb.pourcentage, 0) as bourse_pct,
      COALESCE(nb.applique_inscription, false) as bourse_applique,
      COALESCE(nb.applique_tenue, false)       as bourse_applique_tenue
    FROM inscriptions i
    LEFT JOIN filieres f ON i.filiere_id = f.id
    LEFT JOIN niveaux_bourse nb ON i.niveau_bourse_id = nb.id
    WHERE i.id = $1
  `, [inscriptionId])
  if (!rows[0]) return
  const insc = rows[0]
  const mensBase = parseFloat(insc.mensualite) || 0    // tarif filière (source de vérité)
  const fraisBase = parseFloat(insc.frais_inscription) || 0
  const tenueBase = parseFloat(insc.frais_tenue) || 0
  const pct = parseFloat(insc.bourse_pct) || 0
  const mensEff = Math.round(mensBase * (1 - pct / 100))
  // La bourse s'applique aux frais uniques (inscription + tenue) si le flag applique_inscription est activé
  const fraisEff = insc.bourse_applique ? Math.round(fraisBase * (1 - pct / 100)) : fraisBase
  const tenueEff = insc.bourse_applique_tenue ? Math.round(tenueBase * (1 - pct / 100)) : tenueBase
  const duree = Math.max(1, Math.min(parseInt(insc.duree_mois) || 12, 36))
  const now = moisDebut ? new Date(moisDebut + '-01T00:00:00') : new Date()
  const moisCourant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  // Frais inscription
  if (fraisBase > 0) {
    await pool.query(
      `INSERT INTO echeances (inscription_id,mois,montant,type_echeance) VALUES ($1,$2,$3,'frais_inscription') ON CONFLICT DO NOTHING`,
      [inscriptionId, moisCourant, fraisEff]
    ).catch(() => {})
  }
  // Tenue (avec réduction bourse si applicable)
  if (tenueBase > 0) {
    await pool.query(
      `INSERT INTO echeances (inscription_id,mois,montant,type_echeance) VALUES ($1,$2,$3,'tenue') ON CONFLICT DO NOTHING`,
      [inscriptionId, moisCourant, tenueEff]
    ).catch(() => {})
  }
  // Mensualités en batch
  if (mensBase > 0) {
    // Compter les mensualités déjà existantes pour ne pas dépasser duree
    const { rows: existantes } = await pool.query(
      `SELECT mois FROM echeances WHERE inscription_id = $1 AND type_echeance = 'mensualite' ORDER BY mois DESC`,
      [inscriptionId]
    )
    const nbExistantes = existantes.length
    const nbACreer = duree - nbExistantes
    if (nbACreer > 0) {
      // Partir du mois suivant le dernier existant, ou depuis moisDebut si aucun
      let startDate: Date
      if (nbExistantes > 0) {
        const d = new Date(existantes[0].mois.toString().substring(0, 10) + 'T00:00:00')
        startDate = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      } else {
        startDate = now
      }
      const params: any[] = [inscriptionId, mensEff]
      const vals: string[] = []
      for (let i = 0; i < nbACreer; i++) {
        const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1)
        const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
        params.push(m)
        vals.push(`($1,$${params.length},$2,'mensualite')`)
      }
      await pool.query(
        `INSERT INTO echeances (inscription_id,mois,montant,type_echeance) VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`,
        params
      ).catch(() => {})
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

app.post('/echeances/generer', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { inscription_id, mois_debut } = await c.req.json()
  await pool.query(`DELETE FROM echeances WHERE inscription_id = $1 AND montant = 0`, [inscription_id]).catch(() => {})
  await genererEcheances(parseInt(inscription_id), mois_debut || undefined)
  return c.json({ success: true })
})

app.post('/echeances/regenerer', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { inscription_id, mois_debut } = await c.req.json()
  const inscId = parseInt(inscription_id)

  // Récupérer duree_mois de la filière
  const { rows: inscRows } = await pool.query(
    `SELECT COALESCE(f.duree_mois, 12) as duree_mois
     FROM inscriptions i LEFT JOIN filieres f ON i.filiere_id = f.id
     WHERE i.id = $1`, [inscId]
  )
  const duree = Math.max(1, Math.min(parseInt(inscRows[0]?.duree_mois) || 12, 36))

  // Compter toutes les mensualités existantes
  const { rows: toutesEch } = await pool.query(
    `SELECT COUNT(*) as nb FROM echeances WHERE inscription_id = $1 AND type_echeance = 'mensualite'`,
    [inscId]
  )
  const nbTotal = parseInt(toutesEch[0]?.nb) || 0
  const nbSurplus = Math.max(0, nbTotal - duree)

  if (nbSurplus > 0) {
    // Supprimer les mensualités non-payées les plus récentes pour ramener au bon total
    await pool.query(
      `DELETE FROM echeances WHERE id IN (
        SELECT id FROM echeances
        WHERE inscription_id = $1 AND type_echeance = 'mensualite' AND statut = 'non_paye'
        ORDER BY mois DESC LIMIT $2
      )`, [inscId, nbSurplus]
    ).catch(() => {})
  }

  // Générer les mensualités manquantes
  await genererEcheances(inscId, mois_debut || undefined)
  return c.json({ success: true })
})

// ─── PAIEMENTS ────────────────────────────────────────────────────────────────
app.get('/paiements', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT p.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom) as etudiant
    FROM paiements p
    LEFT JOIN inscriptions i ON p.inscription_id = i.id
    LEFT JOIN etudiants e ON i.etudiant_id = e.id
    ORDER BY p.created_at DESC
  `)
  return c.json(rows)
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

// ─── DEPENSES ─────────────────────────────────────────────────────────────────
app.get('/depenses', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM depenses ORDER BY date_depense DESC,created_at DESC')
  return c.json(rows)
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
  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) return c.json({ message: 'Format mois invalide (YYYY-MM).' }, 422)

  // Vérifier doublons
  const { rows: existing } = await pool.query(
    `SELECT COUNT(*)::int as cnt FROM depenses WHERE mois_concerne=$1 AND type_source='vacation'`, [mois]
  )
  if (existing[0].cnt > 0) return c.json({ message: `Les vacations de ${mois} ont déjà été calculées.`, alreadyGenerated: true }, 409)

  // Récupérer les séances du mois par enseignant avec leur taux horaire
  const { rows: seances } = await pool.query(`
    SELECT
      e.id as enseignant_id,
      e.nom, e.prenom,
      SUM(EXTRACT(EPOCH FROM (s.date_fin::timestamptz - s.date_debut::timestamptz)) / 3600.0) as heures,
      COALESCE(
        (SELECT t.montant_horaire FROM tarifs_enseignants t
         JOIN classes cl2 ON cl2.id = s.classe_id
         JOIN filieres f2 ON f2.id = cl2.filiere_id
         WHERE f2.type_formation_id = t.type_formation_id
         ORDER BY t.date_effet DESC LIMIT 1),
        0
      ) as taux_horaire
    FROM seances s
    JOIN enseignants e ON s.enseignant_id = e.id
    WHERE date_trunc('month', s.date_debut::timestamptz) = date_trunc('month', ($1 || '-01')::timestamptz)
      AND s.statut = 'realise'
    GROUP BY e.id, e.nom, e.prenom, s.classe_id
  `, [mois])

  // Regrouper par enseignant (peut avoir plusieurs classes)
  const byEnseignant: Record<number, { nom: string; prenom: string; heures: number; montant: number }> = {}
  for (const row of seances) {
    const id = row.enseignant_id
    if (!byEnseignant[id]) byEnseignant[id] = { nom: row.nom, prenom: row.prenom, heures: 0, montant: 0 }
    byEnseignant[id].heures += Number(row.heures)
    byEnseignant[id].montant += Number(row.heures) * Number(row.taux_horaire)
  }

  const generated: unknown[] = []
  for (const [ensId, data] of Object.entries(byEnseignant)) {
    if (data.montant <= 0) continue
    const { rows } = await pool.query(
      `INSERT INTO depenses (libelle,montant,categorie,date_depense,statut,mode_paiement,type_source,source_id,mois_concerne,beneficiaire,created_by)
       VALUES ($1,$2,'salaires',$3,'en_attente','especes','vacation',$4,$5,$6,$7) RETURNING *`,
      [
        `Vacations ${data.prenom} ${data.nom} — ${mois} (${Math.round(data.heures * 10) / 10}h)`,
        Math.round(data.montant),
        `${mois}-01`, Number(ensId), mois, `${data.prenom} ${data.nom}`, u(c).id
      ]
    )
    generated.push(rows[0])
  }

  return c.json({ generated: generated.length, items: generated })
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

// Émargement complet : contenu + signature enseignant + clôture séance
app.post('/seances/:id/emarger', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { contenu_seance, objectifs, presences, enseignant_id } = b
  const id = c.req.param('id')

  // 1. Sauvegarder contenu + signer + passer en effectue
  const { rows } = await pool.query(
    `UPDATE seances SET
      contenu_seance=$1, objectifs=$2, statut='effectue',
      signe_enseignant_at=NOW(), signe_enseignant_id=$3
     WHERE id=$4 RETURNING *`,
    [contenu_seance || null, objectifs || null, enseignant_id || null, id]
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

  return c.json(rows[0])
})

// Sauvegarder le contenu sans clôturer
app.post('/seances/:id/contenu', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE seances SET contenu_seance=$1, objectifs=$2 WHERE id=$3 RETURNING *`,
    [b.contenu_seance || null, b.objectifs || null, c.req.param('id')]
  )
  return c.json(rows[0])
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

// ─── UES ──────────────────────────────────────────────────────────────────────
app.get('/ues', requireAuth, async (c) => {
  const classeId = c.req.query('classe_id')
  const params: any[] = []
  const where = classeId ? (params.push(classeId), `WHERE ue.classe_id = $${params.length}`) : ''
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
    ${where}
    ORDER BY ue.ordre, ue.code
  `, params)
  return c.json(rows)
})

app.post('/ues', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO unites_enseignement (classe_id,enseignant_id,code,intitule,coefficient,credits_ects,volume_horaire,ordre,matiere_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [b.classe_id, b.enseignant_id || null, b.code, b.intitule, b.coefficient || 1, b.credits_ects || 0, b.volume_horaire || 0, b.ordre || 0, b.matiere_id || null]
  )
  return c.json(rows[0], 201)
})

app.put('/ues/:id', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE unites_enseignement SET classe_id=$1,enseignant_id=$2,code=$3,intitule=$4,coefficient=$5,credits_ects=$6,volume_horaire=$7,ordre=$8,matiere_id=$9 WHERE id=$10 RETURNING *',
    [b.classe_id, b.enseignant_id || null, b.code, b.intitule, b.coefficient || 1, b.credits_ects || 0, b.volume_horaire || 0, b.ordre || 0, b.matiere_id || null, c.req.param('id')]
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

  // Récupérer le tronc_commun_id de cette classe
  const { rows: classeRows } = await pool.query('SELECT tronc_commun_id FROM classes WHERE id=$1', [classeId])
  const troncCommunId = classeRows[0]?.tronc_commun_id ?? null

  // UEs propres à la classe
  const { rows: uesSpecifiques } = await pool.query(`
    SELECT ue.*, false as is_tronc_commun,
      CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
    FROM unites_enseignement ue
    LEFT JOIN enseignants i ON ue.enseignant_id = i.id
    WHERE ue.classe_id = $1
    ORDER BY ue.ordre, ue.code
  `, [classeId])

  // UEs du tronc commun (si lié)
  let uesTronc: any[] = []
  if (troncCommunId) {
    const { rows } = await pool.query(`
      SELECT ue.*, true as is_tronc_commun,
        CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
      FROM unites_enseignement ue
      LEFT JOIN enseignants i ON ue.enseignant_id = i.id
      WHERE ue.classe_id = $1
      ORDER BY ue.ordre, ue.code
    `, [troncCommunId])
    uesTronc = rows
  }

  const ues = [...uesTronc, ...uesSpecifiques]

  // Vérifier si c'est une classe tronc commun
  const { rows: classeInfoRows } = await pool.query('SELECT est_tronc_commun FROM classes WHERE id=$1', [classeId])
  const estTroncCommun = classeInfoRows[0]?.est_tronc_commun ?? false

  // Inscriptions actives : classe directe + classes liées si tronc commun
  const { rows: inscriptions } = await pool.query(`
    SELECT ins.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom) as etudiant,
      jsonb_build_object('id',cl.id,'nom',cl.nom) as classe,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom) ELSE NULL END as filiere,
      CASE WHEN ne.id IS NOT NULL THEN jsonb_build_object('id',ne.id,'nom',ne.nom,'est_superieur_bac',ne.est_superieur_bac) ELSE NULL END as niveau_entree
    FROM inscriptions ins
    LEFT JOIN etudiants e ON ins.etudiant_id = e.id
    LEFT JOIN classes cl ON ins.classe_id = cl.id
    LEFT JOIN filieres f ON ins.filiere_id = f.id
    LEFT JOIN niveaux_entree ne ON ins.niveau_entree_id = ne.id
    WHERE (
      ins.classe_id = $1
      OR ($2 AND ins.classe_id IN (SELECT id FROM classes WHERE tronc_commun_id = $1))
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
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom,'numero_etudiant',e.numero_etudiant) as etudiant,
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

  // UEs de la classe + tronc commun éventuel
  const classeId = inscRows[0].classe_id
  const { rows: classeRows2 } = await pool.query('SELECT tronc_commun_id FROM classes WHERE id=$1', [classeId])
  const troncId = classeRows2[0]?.tronc_commun_id ?? null

  const { rows: uesSpecifiques } = await pool.query(
    `SELECT ue.*, false as is_tronc_commun,
       CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
     FROM unites_enseignement ue LEFT JOIN enseignants i ON ue.enseignant_id=i.id
     WHERE ue.classe_id=$1 ORDER BY ue.ordre,ue.code`, [classeId])

  let uesTronc: any[] = []
  if (troncId) {
    const { rows } = await pool.query(
      `SELECT ue.*, true as is_tronc_commun,
         CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as enseignant
       FROM unites_enseignement ue LEFT JOIN enseignants i ON ue.enseignant_id=i.id
       WHERE ue.classe_id=$1 ORDER BY ue.ordre,ue.code`, [troncId])
    uesTronc = rows
  }
  const allUes = [...uesTronc, ...uesSpecifiques]

  // Notes for this inscription (session normale only for bulletin)
  const { rows: notesRows } = await pool.query(
    `SELECT * FROM notes WHERE inscription_id = $1 AND session = 'normale'`,
    [inscriptionId]
  )
  const noteMap: Record<number, number> = {}
  notesRows.forEach((n: any) => { noteMap[n.ue_id] = parseFloat(n.note) })

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

  // Système : BAC+ → crédits (LMD), < BAC → coefficients
  const isLMD = inscRows[0]?.niveau_entree?.est_superieur_bac === true

  // Compute bulletin
  let totalPts = 0, totalWeight = 0, creditsValides = 0, creditsTotal = 0
  const uesBulletin = allUes.map((ue: any) => {
    const note = noteMap[ue.id] ?? null
    // Coefficient et crédits depuis filière (si matiere_id lié), sinon depuis UE
    const pivot = (ue.matiere_id && filierePivotMap[ue.matiere_id]) ? filierePivotMap[ue.matiere_id] : null
    const coef = pivot ? pivot.coefficient : (parseFloat(ue.coefficient) || 1)
    const credits = pivot ? pivot.credits : (parseInt(ue.credits_ects) || 0)
    // Poids effectif : crédits si LMD, coefficient sinon
    const weight = isLMD ? (credits || 1) : coef
    creditsTotal += credits
    let points = null
    if (note !== null) {
      points = Math.round(note * weight * 100) / 100
      totalPts += note * weight
      totalWeight += weight
      if (note >= 10) creditsValides += credits
    }
    return { ...ue, note, points, valide: note !== null && note >= 10, coef_effectif: weight, credits }
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

  return c.json({
    inscription: { ...inscRows[0], est_lmd: isLMD },
    ues: uesBulletin,
    ues_tronc_commun: uesBulletin.filter((u: any) => u.is_tronc_commun),
    ues_specifiques: uesBulletin.filter((u: any) => !u.is_tronc_commun),
    moyenne,
    mention,
    decision,
    credits_valides: creditsValides,
    credits_total: creditsTotal,
    has_tronc_commun: troncId !== null,
    est_lmd: isLMD,
  })
})

app.post('/notes/batch', requireAuth, role('dg', 'dir_peda', 'coordinateur', 'enseignant'), async (c) => {
  const body = await c.req.json()
  const notes = Array.isArray(body) ? body : (body.notes || []) as Array<{ inscription_id: number; ue_id: number; note: number; session?: string }>
  const userRole = u(c).role

  // Si enseignant : bloquer uniquement les UEs assignées à UN AUTRE enseignant
  let blockedUeIds: number[] = []
  if (userRole === 'enseignant') {
    const { rows: ensRows } = await pool.query(
      'SELECT id FROM enseignants WHERE user_id=$1', [u(c).id]
    )
    if (ensRows.length) {
      const enseignantId = ensRows[0].id
      // Bloquer les UEs qui ont un enseignant_id différent du prof connecté
      const { rows: ueRows } = await pool.query(
        'SELECT id FROM unites_enseignement WHERE enseignant_id IS NOT NULL AND enseignant_id != $1',
        [enseignantId]
      )
      blockedUeIds = ueRows.map((r: any) => Number(r.id))
    }
  }

  for (const n of notes) {
    // Ignorer uniquement si l'UE appartient à un autre prof
    if (blockedUeIds.includes(Number(n.ue_id))) continue
    await pool.query(
      `INSERT INTO notes (inscription_id,ue_id,note,session,created_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (inscription_id,ue_id,session) DO UPDATE SET note=$3`,
      [n.inscription_id, n.ue_id, n.note, n.session || 'normale', u(c).id]
    )
  }
  return c.json({ message: 'Notes enregistrées.' })
})

// Profil enseignant du user connecté + ses classes

// ─── RAPPORTS ─────────────────────────────────────────────────────────────────
app.get('/rapports', requireAuth, async (c) => {
  const now = new Date()
  const year = now.getFullYear()
  const startYear = new Date(year, 0, 1)
  const endYear = new Date(year, 11, 31, 23, 59, 59)

  // ── Financier ────────────────────────────────────────────────────────────────
  const [encAnnee, depAnnee, totalEcheances] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(montant),0)::float AS val FROM paiements WHERE statut='confirme' AND confirmed_at BETWEEN $1 AND $2`,
      [startYear, endYear]
    ),
    pool.query(
      `SELECT COALESCE(SUM(montant),0)::float AS val FROM depenses WHERE statut='validee' AND date_depense BETWEEN $1 AND $2`,
      [startYear, endYear]
    ),
    pool.query(
      `SELECT COALESCE(SUM(montant),0)::float AS val FROM echeances`
    ),
  ])

  const encaisse_annee = encAnnee.rows[0].val as number
  const depenses_annee = depAnnee.rows[0].val as number
  const total_echeances = totalEcheances.rows[0].val as number
  const taux_recouvrement = total_echeances > 0 ? Math.round((encaisse_annee / total_echeances) * 100) : 0

  // Évolution 6 derniers mois (recettes + dépenses)
  const { rows: evo6 } = await pool.query(`
    WITH months AS (
      SELECT generate_series(
        date_trunc('month', NOW() - INTERVAL '5 months'),
        date_trunc('month', NOW()),
        INTERVAL '1 month'
      ) AS m
    ),
    rec AS (
      SELECT date_trunc('month', confirmed_at) AS m, COALESCE(SUM(montant),0) AS val
      FROM paiements WHERE statut='confirme'
      GROUP BY 1
    ),
    dep AS (
      SELECT date_trunc('month', COALESCE(date_depense, created_at)) AS m, COALESCE(SUM(montant),0) AS val
      FROM depenses WHERE statut='validee'
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
  `)

  // ── Pédagogique ───────────────────────────────────────────────────────────────
  const [nbSeances, nbSeancesRealises, nbUes, nbNotes] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS val FROM seances`),
    pool.query(`SELECT COUNT(*)::int AS val FROM seances WHERE statut='effectue'`),
    pool.query(`SELECT COUNT(*)::int AS val FROM unites_enseignement`),
    pool.query(`SELECT COUNT(DISTINCT inscription_id)::int AS val FROM notes`),
  ])

  const nb_seances = nbSeances.rows[0].val as number
  const nb_seances_realisees = nbSeancesRealises.rows[0].val as number

  // Taux présence : nb présences confirmées / total inscriptions dans séances réalisées
  const { rows: presRows } = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN statut='present' THEN 1 ELSE 0 END), 0)::int AS presents,
      COUNT(*)::int AS total
    FROM presences
    JOIN seances s ON presences.seance_id = s.id
    WHERE s.statut = 'effectue'
  `)
  const taux_presence = presRows[0]?.total > 0
    ? Math.round((presRows[0].presents / presRows[0].total) * 100)
    : 0

  // ── RH ────────────────────────────────────────────────────────────────────────
  const [ensActifs, volH, modeRep] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS val FROM enseignants WHERE statut='actif'`),
    pool.query(`SELECT COALESCE(SUM(volume_horaire),0)::float AS val FROM unites_enseignement`),
    pool.query(`
      SELECT mode, COUNT(*)::int AS cnt
      FROM seances
      WHERE mode IS NOT NULL
      GROUP BY mode
    `),
  ])

  const totalSeancesMode = modeRep.rows.reduce((s: number, r: any) => s + r.cnt, 0)
  const repartition_mode: Record<string, number> = {}
  for (const r of modeRep.rows) {
    repartition_mode[r.mode] = totalSeancesMode > 0 ? Math.round((r.cnt / totalSeancesMode) * 100) : 0
  }

  // ── Étudiants ─────────────────────────────────────────────────────────────────
  const [parFiliere, parStatut, evoInsc] = await Promise.all([
    pool.query(`
      SELECT f.nom, COUNT(i.id)::int AS cnt
      FROM inscriptions i
      LEFT JOIN filieres f ON i.filiere_id = f.id
      WHERE i.statut NOT IN ('abandonne')
      GROUP BY f.nom
      ORDER BY cnt DESC
    `),
    pool.query(`
      SELECT statut, COUNT(*)::int AS total
      FROM inscriptions
      GROUP BY statut
      ORDER BY total DESC
    `),
    pool.query(`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', NOW() - INTERVAL '5 months'),
          date_trunc('month', NOW()),
          INTERVAL '1 month'
        ) AS m
      ),
      ins AS (
        SELECT date_trunc('month', created_at) AS m, COUNT(*)::int AS cnt
        FROM inscriptions
        GROUP BY 1
      )
      SELECT to_char(months.m, 'Mon YY') AS mois, COALESCE(ins.cnt, 0)::int AS count
      FROM months
      LEFT JOIN ins ON ins.m = months.m
      ORDER BY months.m
    `),
  ])

  const totalEtudiants = parFiliere.rows.reduce((s: number, r: any) => s + r.cnt, 0)

  return c.json({
    financier: {
      encaisse_annee,
      depenses_annee,
      solde: encaisse_annee - depenses_annee,
      taux_recouvrement,
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
      enseignants_actifs: ensActifs.rows[0].val,
      volume_horaire: volH.rows[0].val,
      repartition_mode,
    },
    etudiants: {
      par_filiere: parFiliere.rows.map((r: any) => ({
        nom: r.nom ?? 'Non assignée',
        count: r.cnt,
        pct: totalEtudiants > 0 ? Math.round((r.cnt / totalEtudiants) * 100) : 0,
      })),
      par_statut: parStatut.rows,
      evolution_inscriptions: evoInsc.rows,
    },
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
        OR ($2 AND i.classe_id IN (SELECT id FROM classes WHERE tronc_commun_id = $1))
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
        OR ($2 AND ue.classe_id IN (SELECT id FROM classes WHERE tronc_commun_id = $1))
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
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom) ELSE NULL END as classe_obj,
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
  if (!inscRows[0]) return c.json({ message: 'Aucune inscription trouvée.' }, 404)
  const insc = inscRows[0]

  // 3. Financial stats
  const [echeancesRes, paiementsRes, allPaiementsRes] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(montant), 0)::float AS total FROM echeances WHERE inscription_id = $1`, [insc.id]),
    pool.query(`SELECT COALESCE(SUM(montant), 0)::float AS total FROM paiements WHERE inscription_id = $1 AND statut = 'confirme'`, [insc.id]),
    pool.query(`SELECT * FROM paiements WHERE inscription_id = $1 ORDER BY created_at DESC LIMIT 20`, [insc.id]),
  ])
  const frais_totaux = echeancesRes.rows[0].total || 0
  const total_paye = paiementsRes.rows[0].total || 0
  const restant_du = Math.max(0, frais_totaux - total_paye)

  // 4. Notes (if classe exists)
  let notesData: any = { ues: [], moyenne_generale: null, mention: null, rang: null }
  if (insc.classe_id) {
    // Récupérer le tronc_commun_id de la classe de l'étudiant
    const { rows: classeInfoRows } = await pool.query(
      'SELECT tronc_commun_id FROM classes WHERE id=$1', [insc.classe_id]
    )
    const troncCommunId = classeInfoRows[0]?.tronc_commun_id ?? null

    // Charger les UEs : tronc commun EN PREMIER, puis spécifiques à la classe
    const [uesTroncRes, uesSpecRes, notesRes] = await Promise.all([
      troncCommunId
        ? pool.query(`SELECT * FROM unites_enseignement WHERE classe_id = $1 ORDER BY ordre, code`, [troncCommunId])
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
      // Priorité : coefficient de la filière (via matiere_id) > coefficient de l'UE
      const pivot = (ue.matiere_id && filierePivotMap[ue.matiere_id]) ? filierePivotMap[ue.matiere_id] : null
      const coef = pivot ? pivot.coefficient : (parseFloat(ue.coefficient) || 1)
      const credits = pivot ? pivot.credits : (parseInt(ue.credits_ects) || 0)
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
  const { rows: presRows } = await pool.query(
    `SELECT statut, COUNT(*)::int as cnt FROM presences WHERE inscription_id = $1 GROUP BY statut`,
    [insc.id]
  )
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

  // 6. Séances : semaine en cours + 30 derniers jours (avec statut émargement + présence étudiant)
  let seancesSemaine: any[] = []
  let seancesPassees: any[] = []
  if (insc.classe_id) {
    const now = new Date()
    const day = now.getDay() === 0 ? 6 : now.getDay() - 1
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - day); weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999)
    const past30 = new Date(now); past30.setDate(now.getDate() - 30); past30.setHours(0, 0, 0, 0)

    const seanceQuery = `
      SELECT s.id, s.matiere, s.date_debut, s.date_fin, s.mode, s.salle, s.statut,
        s.contenu_seance, s.objectifs, s.notes, s.lien_visio,
        CASE WHEN iv.id IS NOT NULL THEN iv.prenom || ' ' || iv.nom ELSE NULL END as enseignant,
        pr.statut as presence_etudiant
      FROM seances s
      LEFT JOIN enseignants iv ON s.enseignant_id = iv.id
      LEFT JOIN presences pr ON pr.seance_id = s.id AND pr.inscription_id = $2
      WHERE s.classe_id = $1 AND s.statut != 'annule'
    `
    // Séances à venir cette semaine (à partir de maintenant)
    const { rows: sWeek } = await pool.query(
      seanceQuery + ` AND s.date_debut >= $3 AND s.date_debut <= $4 ORDER BY s.date_debut ASC`,
      [insc.classe_id, insc.id, now.toISOString(), weekEnd.toISOString()]
    )
    // Séances passées : 30 derniers jours jusqu'à maintenant
    const { rows: sPast } = await pool.query(
      seanceQuery + ` AND s.date_debut >= $3 AND s.date_debut < $4 ORDER BY s.date_debut DESC LIMIT 30`,
      [insc.classe_id, insc.id, past30.toISOString(), now.toISOString()]
    )
    seancesSemaine = sWeek
    seancesPassees = sPast
  }

  // 7. Annonces publiées récentes
  const { rows: annonces } = await pool.query(
    `SELECT id, titre, type, publie_at FROM annonces WHERE statut = 'publie' ORDER BY publie_at DESC LIMIT 5`
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

  return c.json({
    etudiant: {
      id: etudiant.id,
      nom: etudiant.nom,
      prenom: etudiant.prenom,
      email: etudiant.email,
      numero_etudiant: etudiant.numero_etudiant,
      photo_url: etudiant.photo_url ?? null,
    },
    inscription: {
      id: insc.id,
      statut: insc.statut,
      filiere: insc.filiere_obj?.nom ?? '—',
      classe: insc.classe_obj?.nom ?? '—',
      annee_academique: insc.annee_obj?.libelle ?? '—',
      frais_totaux,
      total_paye,
      restant_du,
    },
    notes: notesData,
    presences: presencesData,
    seances_semaine: seancesSemaine,
    seances_passees: seancesPassees,
    paiements: allPaiementsRes.rows,
    annonces,
    messages: convRows,
    documents: docs,
  })
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

        resultats.push({ etudiant_id: ech.etudiant_id, type: `J${joursAvant >= 0 ? '+' : ''}${joursAvant}`, ok: res.ok, error: res.error })
      }
    }

    return c.json({ message: 'Cron relances terminé.', total: resultats.length, resultats })
  } catch (err: any) {
    return c.json({ message: err.message }, 500)
  }
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
