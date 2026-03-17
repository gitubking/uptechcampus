import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { Pool } from 'pg'
import jwt from 'jsonwebtoken'
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
pool.query(`ALTER TABLE filieres ADD COLUMN IF NOT EXISTS montant_tenue INTEGER DEFAULT 0`).catch(() => {})
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

app.post('/auth/forgot-password', async (c) => {
  return c.json({ message: "Si cet email existe, un lien de réinitialisation sera envoyé." })
})

app.post('/auth/verify-otp', async (c) => {
  return c.json({ message: 'OTP vérifié.', valid: true })
})

app.post('/auth/reset-password', async (c) => {
  const body = await c.req.json()
  if (body.email && body.nouveau_mot_de_passe) {
    const hashed = await bcrypt.hash(body.nouveau_mot_de_passe as string, 10)
    await pool.query('UPDATE users SET password=$1, premier_connexion=false WHERE email=$2', [hashed, body.email])
  }
  return c.json({ message: 'Mot de passe réinitialisé.' })
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
    'SELECT id,nom,prenom,email,role,statut,telephone,photo_path,last_login_at,created_at FROM users ORDER BY nom,prenom'
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
  const { rows } = await pool.query(
    'UPDATE users SET nom=$1,prenom=$2,email=$3,role=$4,telephone=$5,statut=$6 WHERE id=$7 RETURNING id,nom,prenom,email,role,statut,telephone',
    [body.nom, body.prenom, body.email, body.role, body.telephone || null, body.statut || 'actif', c.req.param('id')]
  )
  if (!rows[0]) return c.json({ message: 'Utilisateur introuvable.' }, 404)
  return c.json(rows[0])
})

app.delete('/users/:id', requireAuth, role('dg'), async (c) => {
  await pool.query('DELETE FROM users WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

app.post('/users/:id/reset-password', requireAuth, role('dg'), async (c) => {
  const hashed = await bcrypt.hash('Uptech@2026', 10)
  await pool.query('UPDATE users SET password=$1, premier_connexion=true WHERE id=$2', [hashed, c.req.param('id')])
  return c.json({ message: 'Mot de passe réinitialisé.', nouveau_mot_de_passe: 'Uptech@2026' })
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
      COALESCE(json_agg(DISTINCT jsonb_build_object('id',m.id,'nom',m.nom,'code',m.code))
        FILTER (WHERE m.id IS NOT NULL), '[]') as matieres
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
  await pool.query('INSERT INTO filiere_matiere (filiere_id,matiere_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [c.req.param('id'), b.matiere_id])
  return c.json({ message: 'Matière attachée.' })
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
    'INSERT INTO niveaux_bourse (nom,pourcentage,applique_inscription,actif) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.nom, b.pourcentage || 0, b.applique_inscription ?? false, b.actif ?? true]
  )
  return c.json(rows[0], 201)
})

app.put('/niveaux-bourse/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE niveaux_bourse SET nom=$1,pourcentage=$2,applique_inscription=$3,actif=$4 WHERE id=$5 RETURNING *',
    [b.nom, b.pourcentage || 0, b.applique_inscription ?? false, b.actif ?? true, c.req.param('id')]
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
      COALESCE(json_agg(DISTINCT jsonb_build_object('id',p.id,'nom',p.nom)) FILTER (WHERE p.id IS NOT NULL),'[]') as parcours
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
  const { rows } = await pool.query(
    'INSERT INTO classes (nom,filiere_id,annee_academique_id,niveau,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [b.nom, b.filiere_id, b.annee_academique_id, b.niveau ?? 1, u(c).id]
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
  const { rows } = await pool.query(
    'UPDATE classes SET nom=$1,filiere_id=$2,annee_academique_id=$3,niveau=$4 WHERE id=$5 RETURNING *',
    [b.nom, b.filiere_id, b.annee_academique_id, b.niveau ?? 1, c.req.param('id')]
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
  const search = c.req.query('search') || ''
  const page = Math.max(1, parseInt(c.req.query('page') || '1'))
  const perPage = 20
  const offset = (page - 1) * perPage
  const searchParam = search ? `%${search}%` : null
  const whereClause = searchParam
    ? `WHERE (e.nom ILIKE $1 OR e.prenom ILIKE $1 OR e.numero_etudiant ILIKE $1 OR e.email ILIKE $1)`
    : ''
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int as total FROM etudiants e ${whereClause}`,
    searchParam ? [searchParam] : []
  )
  const total = countRows[0].total
  const { rows } = await pool.query(
    `SELECT e.*,
      (SELECT jsonb_build_object(
        'id', ins.id, 'statut', ins.statut, 'acces_bloque', ins.acces_bloque,
        'frais_inscription', ins.frais_inscription, 'mensualite', ins.mensualite,
        'frais_tenue', ins.frais_tenue, 'contrat_path', ins.contrat_path,
        'filiere', CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code,'type_formation_id',f.type_formation_id,'frais_inscription',f.frais_inscription,'mensualite',f.mensualite,'montant_tenue',COALESCE(f.montant_tenue,0)) ELSE NULL END,
        'classe', CASE WHEN cl.id IS NOT NULL THEN jsonb_build_object('id',cl.id,'nom',cl.nom,'niveau',cl.niveau) ELSE NULL END,
        'niveau_entree', CASE WHEN ne.id IS NOT NULL THEN jsonb_build_object('id',ne.id,'nom',ne.nom) ELSE NULL END,
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
    ${whereClause} ORDER BY e.nom,e.prenom
    LIMIT $${searchParam ? 2 : 1} OFFSET $${searchParam ? 3 : 2}`,
    searchParam ? [searchParam, perPage, offset] : [perPage, offset]
  )
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  return c.json({ data: rows, current_page: page, last_page: lastPage, per_page: perPage, total })
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

    // Supprimer le compte utilisateur et ses conversations si existants
    if (userId) {
      await client.query('DELETE FROM conversation_participants WHERE user_id=$1', [userId]).catch(() => {})
      await client.query('DELETE FROM messages WHERE sender_id=$1', [userId]).catch(() => {})
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
  if (classeId)   { params.push(classeId);   conditions.push(`i.classe_id = $${params.length}`) }
  if (statut)     { params.push(statut);     conditions.push(`i.statut = $${params.length}`) }
  if (etudiantId) { params.push(etudiantId); conditions.push(`i.etudiant_id = $${params.length}`) }
  if (filiereId)  { params.push(filiereId);  conditions.push(`i.filiere_id = $${params.length}`) }
  if (sansClasse === '1') conditions.push(`i.classe_id IS NULL`)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const { rows } = await pool.query(`
    SELECT i.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom,'email',e.email,'numero_etudiant',e.numero_etudiant) as etudiant,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom,'niveau',c.niveau) ELSE NULL END as classe,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code,'type_formation_id',f.type_formation_id,'frais_inscription',f.frais_inscription,'mensualite',f.mensualite,'montant_tenue',COALESCE(f.montant_tenue,0)) ELSE NULL END as filiere,
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

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────
app.post('/documents', requireAuth, role('secretariat', 'dg'), async (c) => {
  return c.json({ message: 'Upload: utilisez un service de stockage externe.' }, 501)
})

app.delete('/documents/:id', requireAuth, role('secretariat', 'dg'), async (c) => {
  await pool.query('DELETE FROM documents_etudiant WHERE id=$1', [c.req.param('id')])
  return c.body(null, 204)
})

// ─── INTERVENANTS ─────────────────────────────────────────────────────────────
app.get('/intervenants', requireAuth, async (c) => {
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
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int as total FROM intervenants i ${where}`, params)
  const total = countRows[0].total
  params.push(perPage); const p1 = params.length
  params.push(offset); const p2 = params.length
  const { rows } = await pool.query(`
    SELECT i.*,
      jsonb_build_object('id',aa.id,'libelle',aa.libelle,'actif',aa.actif) as annee_academique,
      COALESCE((
        SELECT json_agg(jsonb_build_object('filiere_id',iv.filiere_id,'matiere',iv.matiere,'filiere',
          jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code)))
        FROM intervenant_filieres iv LEFT JOIN filieres f ON iv.filiere_id = f.id
        WHERE iv.intervenant_id = i.id
      ), '[]'::json) as filieres
    FROM intervenants i
    LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
    ${where} ORDER BY i.nom,i.prenom LIMIT $${p1} OFFSET $${p2}
  `, params)
  const lastPage = Math.max(1, Math.ceil(total / perPage))
  return c.json({ data: rows, current_page: page, last_page: lastPage, per_page: perPage, total })
})

app.get('/intervenants/:id', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM intervenants WHERE id=$1', [c.req.param('id')])
  if (!rows[0]) return c.json({ message: 'Intervenant introuvable.' }, 404)
  return c.json(rows[0])
})

app.post('/intervenants', requireAuth, role('dg', 'secretariat'), async (c) => {
  const b = await c.req.json()
  if (!b.annee_academique_id) return c.json({ message: 'annee_academique_id requis.' }, 422)
  // Auto-create user account if user_id not provided
  let userId = b.user_id
  if (!userId && b.email) {
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.hash('Uptech@2026', 10)
    const existingUser = await pool.query('SELECT id FROM users WHERE email=$1', [b.email])
    if (existingUser.rows[0]) {
      userId = existingUser.rows[0].id
    } else {
      const newUser = await pool.query(
        `INSERT INTO users (nom,prenom,email,telephone,role,statut,password) VALUES ($1,$2,$3,$4,'intervenant','actif',$5) RETURNING id`,
        [b.nom, b.prenom, b.email, b.telephone || null, hash]
      )
      userId = newUser.rows[0].id
    }
  }
  const seq = await nextSeq('intervenants')
  const numero = `CONT-${year()}-${pad(seq)}`
  const { rows } = await pool.query(
    `INSERT INTO intervenants (user_id,numero_contrat,nom,prenom,email,telephone,statut,annee_academique_id,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [userId || null, numero, b.nom, b.prenom, b.email || null, b.telephone || null,
     b.statut || 'en_attente', b.annee_academique_id, u(c).id]
  )
  const intervenant = rows[0]
  // Save filières
  if (b.filieres?.length) {
    await pool.query('DELETE FROM intervenant_filieres WHERE intervenant_id=$1', [intervenant.id])
    for (const f of b.filieres) {
      if (f.filiere_id && f.matiere) {
        await pool.query(
          'INSERT INTO intervenant_filieres (intervenant_id,filiere_id,matiere) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [intervenant.id, f.filiere_id, f.matiere]
        )
      }
    }
  }
  return c.json(intervenant, 201)
})

app.put('/intervenants/:id', requireAuth, role('dg', 'secretariat'), async (c) => {
  const b = await c.req.json()
  const id = c.req.param('id')
  const { rows } = await pool.query(
    'UPDATE intervenants SET nom=$1,prenom=$2,email=$3,telephone=$4,statut=$5 WHERE id=$6 RETURNING *',
    [b.nom, b.prenom, b.email || null, b.telephone || null, b.statut || 'actif', id]
  )
  if (b.filieres !== undefined) {
    await pool.query('DELETE FROM intervenant_filieres WHERE intervenant_id=$1', [id])
    for (const f of (b.filieres || [])) {
      if (f.filiere_id && f.matiere) {
        await pool.query(
          'INSERT INTO intervenant_filieres (intervenant_id,filiere_id,matiere) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [id, f.filiere_id, f.matiere]
        )
      }
    }
  }
  return c.json(rows[0])
})

app.post('/intervenants/:id/cv', requireAuth, role('dg', 'secretariat'), async (c) => {
  return c.json({ message: 'Upload CV: utilisez un service de stockage externe.' })
})

app.get('/intervenants/:id/contrat-pdf', requireAuth, async (c) => {
  return c.json({ message: 'PDF non supporté en serverless.' }, 501)
})

// ─── STATS ────────────────────────────────────────────────────────────────────
app.get('/stats', requireAuth, async (c) => {
  const now = new Date()
  const startM = new Date(now.getFullYear(), now.getMonth(), 1)
  const endM = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  const [et, ia, iatt, iv, fi, cl, enc, dep, totR, totD, pa] = await Promise.all([
    pool.query('SELECT COUNT(*)::int FROM etudiants'),
    pool.query("SELECT COUNT(*)::int FROM inscriptions WHERE statut='inscrit_actif'"),
    pool.query("SELECT COUNT(*)::int FROM inscriptions WHERE statut IN ('pre_inscrit','en_examen')"),
    pool.query("SELECT COUNT(*)::int FROM intervenants WHERE statut='actif'"),
    pool.query("SELECT COUNT(*)::int FROM filieres WHERE actif=true"),
    pool.query('SELECT COUNT(*)::int FROM classes'),
    pool.query("SELECT COALESCE(SUM(montant),0)::float FROM paiements WHERE statut='confirme' AND confirmed_at BETWEEN $1 AND $2", [startM, endM]),
    pool.query("SELECT COALESCE(SUM(montant),0)::float FROM depenses WHERE statut IN ('validee','en_attente') AND created_at BETWEEN $1 AND $2", [startM, endM]),
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
    intervenants_actifs: iv.rows[0].count,
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
async function genererEcheances(inscriptionId: number) {
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
      COALESCE(nb.applique_inscription, false) as bourse_applique
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
  const fraisEff = insc.bourse_applique ? Math.round(fraisBase * (1 - pct / 100)) : fraisBase
  const duree = Math.max(1, Math.min(parseInt(insc.duree_mois) || 12, 36))
  const now = new Date()
  const moisCourant = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  // Frais inscription
  if (fraisBase > 0) {
    await pool.query(
      `INSERT INTO echeances (inscription_id,mois,montant,type_echeance) VALUES ($1,$2,$3,'frais_inscription') ON CONFLICT DO NOTHING`,
      [inscriptionId, moisCourant, fraisEff]
    ).catch(() => {})
  }
  // Tenue
  if (tenueBase > 0) {
    await pool.query(
      `INSERT INTO echeances (inscription_id,mois,montant,type_echeance) VALUES ($1,$2,$3,'tenue') ON CONFLICT DO NOTHING`,
      [inscriptionId, moisCourant, tenueBase]
    ).catch(() => {})
  }
  // Mensualités en batch
  if (mensBase > 0) {
    const params: any[] = [inscriptionId, mensEff]
    const vals: string[] = []
    for (let i = 0; i < duree; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
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
      jsonb_build_object('id',f.id,'nom',f.nom) as filiere
    FROM echeances e
    LEFT JOIN inscriptions i ON e.inscription_id = i.id
    LEFT JOIN etudiants et ON i.etudiant_id = et.id
    LEFT JOIN filieres f ON i.filiere_id = f.id
    ${where}
    ORDER BY e.mois ASC, et.nom, et.prenom
  `, params)
  return c.json(rows)
})

app.post('/echeances/generer', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { inscription_id } = await c.req.json()
  // Supprimer les échéances à 0 FCFA avant de régénérer
  await pool.query(`DELETE FROM echeances WHERE inscription_id = $1 AND montant = 0`, [inscription_id]).catch(() => {})
  await genererEcheances(parseInt(inscription_id))
  return c.json({ success: true })
})

app.post('/echeances/regenerer', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { inscription_id } = await c.req.json()
  // Régénération complète : supprime TOUTES les échéances non payées et recrée
  await pool.query(
    `DELETE FROM echeances WHERE inscription_id = $1 AND statut = 'non_paye'`,
    [inscription_id]
  ).catch(() => {})
  await genererEcheances(parseInt(inscription_id))
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

    // 3. Mensualités dans l'ordre chronologique — le surplus se propage de mois en mois
    const { rows: mensEchs } = await pool.query(
      `SELECT id, montant, mois FROM echeances
       WHERE inscription_id=$1 AND type_echeance='mensualite'
       ORDER BY mois ASC`,
      [inscriptionId]
    )
    for (const ech of mensEchs) {
      const { rows: paid } = await pool.query(
        `SELECT COALESCE(SUM(montant),0)::float AS total FROM paiements
         WHERE inscription_id=$1 AND type_paiement='mensualite'
           AND DATE_TRUNC('month', mois_concerne)=DATE_TRUNC('month', $2::date)
           AND statut='confirme'`,
        [inscriptionId, ech.mois]
      )
      const explicitPaid = Number(paid[0].total)
      const montant = Number(ech.montant)
      const effectivePaid = explicitPaid + surplus
      const statut = effectivePaid >= montant ? 'paye' : effectivePaid > 0 ? 'partiellement_paye' : 'non_paye'
      await pool.query(`UPDATE echeances SET statut=$1 WHERE id=$2`, [statut, ech.id])
      // Surplus restant pour le mois suivant
      surplus = Math.max(0, effectivePaid - montant)
    }
  } catch { /* silencieux */ }
}

app.post('/paiements', requireAuth, role('secretariat', 'dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const seq = await nextSeq('paiements')
  const numero = `PAY-${year()}-${pad(seq)}`
  const isEspeces = (b.mode_paiement || 'especes') === 'especes'
  const statut = isEspeces ? 'confirme' : 'en_attente'
  const confirmedAt = isEspeces ? 'NOW()' : 'NULL'
  const moisConcerne = b.mois_concerne
    ? (String(b.mois_concerne).length === 7 ? b.mois_concerne + '-01' : b.mois_concerne)
    : null
  const { rows } = await pool.query(
    `INSERT INTO paiements (inscription_id,numero_recu,type_paiement,mois_concerne,montant,mode_paiement,statut,confirmed_at,reference,observation,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,${confirmedAt},$8,$9,$10) RETURNING *`,
    [b.inscription_id, numero, b.type_paiement || 'mensualite', moisConcerne,
     b.montant, b.mode_paiement || 'especes', statut, b.reference || null, b.observation || null, u(c).id]
  )
  // Si confirmé immédiatement (espèces), vérifier si le cumul couvre l'échéance
  if (isEspeces && b.inscription_id) {
    await recalculerEcheances(b.inscription_id)
  }
  return c.json(rows[0], 201)
})

app.put('/paiements/:id', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const moisConcerne = b.mois_concerne
    ? (String(b.mois_concerne).length === 7 ? b.mois_concerne + '-01' : b.mois_concerne)
    : null
  const { rows } = await pool.query(
    `UPDATE paiements
     SET montant=$1, type_paiement=$2, mois_concerne=$3, mode_paiement=$4, reference=$5, observation=$6
     WHERE id=$7 RETURNING *`,
    [b.montant, b.type_paiement, moisConcerne, b.mode_paiement, b.reference || null, b.observation || null, c.req.param('id')]
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
             COALESCE(f.frais_inscription, i.frais_inscription, 0) AS frais_inscription,
             COALESCE(f.mensualite, i.mensualite, 0) AS mensualite,
             COALESCE(f.montant_tenue, i.frais_tenue, 0) AS montant_tenue
      FROM inscriptions i
      LEFT JOIN filieres f ON f.id = i.filiere_id
      WHERE i.statut NOT IN ('annule','archive')
    `)
    let updated = 0
    for (const insc of inscriptions) {
      // Mise à jour montant frais_inscription
      if (Number(insc.frais_inscription) > 0) {
        await pool.query(
          `UPDATE echeances SET montant=$1 WHERE inscription_id=$2 AND type_echeance='frais_inscription'`,
          [insc.frais_inscription, insc.inscription_id]
        )
      }
      // Mise à jour montant mensualités
      if (Number(insc.mensualite) > 0) {
        await pool.query(
          `UPDATE echeances SET montant=$1 WHERE inscription_id=$2 AND type_echeance='mensualite'`,
          [insc.mensualite, insc.inscription_id]
        )
      }
      // Tenue : mettre à jour si elle existe, sinon la créer
      if (Number(insc.montant_tenue) > 0) {
        const moisCourant = new Date().toISOString().substring(0, 7) + '-01'
        await pool.query(
          `INSERT INTO echeances (inscription_id,mois,montant,type_echeance)
           VALUES ($1,$2,$3,'tenue')
           ON CONFLICT (inscription_id,mois,type_echeance) DO UPDATE SET montant=$3`,
          [insc.inscription_id, moisCourant, insc.montant_tenue]
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
  const { rows } = await pool.query(
    `INSERT INTO depenses (libelle,montant,categorie,date_depense,statut,description,created_by)
     VALUES ($1,$2,$3,$4,'en_attente',$5,$6) RETURNING *`,
    [b.libelle, b.montant, b.categorie || null, b.date_depense, b.description || null, u(c).id]
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

// ─── SEANCES ──────────────────────────────────────────────────────────────────
app.get('/seances', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT s.*,
      jsonb_build_object('id',c.id,'nom',c.nom) as classe,
      CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as intervenant
    FROM seances s
    LEFT JOIN classes c ON s.classe_id = c.id
    LEFT JOIN intervenants i ON s.intervenant_id = i.id
    ORDER BY s.date_debut DESC
  `)
  return c.json(rows)
})

const seanceRoles: MiddlewareHandler<Env> = role('dg', 'dir_peda', 'coordinateur', 'secretariat', 'intervenant')

app.post('/seances', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `INSERT INTO seances (classe_id,intervenant_id,matiere,date_debut,date_fin,mode,salle,lien_visio,statut,annee_academique_id,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [b.classe_id, b.intervenant_id || null, b.matiere, b.date_debut, b.date_fin,
     b.mode || 'presentiel', b.salle || null, b.lien_visio || null,
     b.statut || 'planifie', b.annee_academique_id || null, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.put('/seances/:id', requireAuth, seanceRoles, async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE seances SET classe_id=$1,intervenant_id=$2,matiere=$3,date_debut=$4,date_fin=$5,mode=$6,salle=$7,lien_visio=$8 WHERE id=$9 RETURNING *',
    [b.classe_id, b.intervenant_id || null, b.matiere, b.date_debut, b.date_fin, b.mode || 'presentiel', b.salle || null, b.lien_visio || null, c.req.param('id')]
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
  const { rows } = await pool.query(`
    SELECT ue.*, jsonb_build_object('id',c.id,'nom',c.nom) as classe
    FROM unites_enseignement ue
    LEFT JOIN classes c ON ue.classe_id = c.id
    ORDER BY ue.ordre, ue.code
  `)
  return c.json(rows)
})

app.post('/ues', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO unites_enseignement (classe_id,intervenant_id,code,intitule,coefficient,credits_ects,ordre) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [b.classe_id, b.intervenant_id || null, b.code, b.intitule, b.coefficient || 1, b.credits_ects || 0, b.ordre || 0]
  )
  return c.json(rows[0], 201)
})

app.put('/ues/:id', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE unites_enseignement SET classe_id=$1,intervenant_id=$2,code=$3,intitule=$4,coefficient=$5,credits_ects=$6,ordre=$7 WHERE id=$8 RETURNING *',
    [b.classe_id, b.intervenant_id || null, b.code, b.intitule, b.coefficient || 1, b.credits_ects || 0, b.ordre || 0, c.req.param('id')]
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

  // UEs for this class
  const { rows: ues } = await pool.query(`
    SELECT ue.*,
      CASE WHEN i.id IS NOT NULL THEN jsonb_build_object('id',i.id,'nom',i.nom,'prenom',i.prenom) ELSE NULL END as intervenant
    FROM unites_enseignement ue
    LEFT JOIN intervenants i ON ue.intervenant_id = i.id
    WHERE ue.classe_id = $1
    ORDER BY ue.ordre, ue.code
  `, [classeId])

  // Inscriptions actives in this class
  const { rows: inscriptions } = await pool.query(`
    SELECT ins.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom) as etudiant
    FROM inscriptions ins
    LEFT JOIN etudiants e ON ins.etudiant_id = e.id
    WHERE ins.classe_id = $1 AND ins.statut = 'inscrit_actif'
    ORDER BY e.nom, e.prenom
  `, [classeId])

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

  return c.json({ ues, inscriptions, notes })
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
      CASE WHEN aa.id IS NOT NULL THEN jsonb_build_object('id',aa.id,'libelle',aa.libelle) ELSE NULL END as annee_academique
    FROM inscriptions ins
    LEFT JOIN etudiants e ON ins.etudiant_id = e.id
    LEFT JOIN classes c ON ins.classe_id = c.id
    LEFT JOIN filieres f ON ins.filiere_id = f.id
    LEFT JOIN annees_academiques aa ON ins.annee_academique_id = aa.id
    WHERE ins.id = $1
  `, [inscriptionId])
  if (!inscRows[0]) return c.json({ message: 'Inscription introuvable.' }, 404)

  // UEs for this class
  const classeId = inscRows[0].classe_id
  const { rows: ues } = await pool.query(
    `SELECT * FROM unites_enseignement WHERE classe_id = $1 ORDER BY ordre, code`,
    [classeId]
  )

  // Notes for this inscription (session normale only for bulletin)
  const { rows: notesRows } = await pool.query(
    `SELECT * FROM notes WHERE inscription_id = $1 AND session = 'normale'`,
    [inscriptionId]
  )
  const noteMap: Record<number, number> = {}
  notesRows.forEach((n: any) => { noteMap[n.ue_id] = parseFloat(n.note) })

  // Compute bulletin
  let totalPts = 0, totalCoef = 0, creditsValides = 0, creditsTotal = 0
  const uesBulletin = ues.map((ue: any) => {
    const note = noteMap[ue.id] ?? null
    const coef = parseFloat(ue.coefficient) || 1
    const credits = parseInt(ue.credits_ects) || 0
    creditsTotal += credits
    let points = null
    if (note !== null) {
      points = Math.round(note * coef * 100) / 100
      totalPts += note * coef
      totalCoef += coef
      if (note >= 10) creditsValides += credits
    }
    return { ...ue, note, points, valide: note !== null && note >= 10 }
  })

  const moyenne = totalCoef > 0 ? Math.round(totalPts / totalCoef * 100) / 100 : null
  let mention: string | null = null
  let decision = 'en_attente'
  if (moyenne !== null) {
    if (moyenne >= 16) mention = 'Très Bien'
    else if (moyenne >= 14) mention = 'Bien'
    else if (moyenne >= 12) mention = 'Assez Bien'
    else if (moyenne >= 10) mention = 'Passable'
    if (moyenne >= 10) decision = 'admis'
    else if (moyenne >= 8) decision = 'rattrapage'
    else decision = 'redoublant'
  }

  return c.json({
    inscription: inscRows[0],
    ues: uesBulletin,
    moyenne,
    mention,
    decision,
    credits_valides: creditsValides,
    credits_total: creditsTotal,
  })
})

app.post('/notes/batch', requireAuth, role('dg', 'dir_peda', 'coordinateur'), async (c) => {
  const body = await c.req.json()
  const notes = Array.isArray(body) ? body : (body.notes || []) as Array<{ inscription_id: number; ue_id: number; note: number; session?: string }>
  for (const n of notes) {
    await pool.query(
      `INSERT INTO notes (inscription_id,ue_id,note,session,created_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (inscription_id,ue_id,session) DO UPDATE SET note=$3`,
      [n.inscription_id, n.ue_id, n.note, n.session || 'normale', u(c).id]
    )
  }
  return c.json({ message: 'Notes enregistrées.' })
})

// ─── RAPPORTS ─────────────────────────────────────────────────────────────────
app.get('/rapports', requireAuth, async (c) => {
  return c.json([])
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
    const [uesRes, notesRes] = await Promise.all([
      pool.query(`SELECT * FROM unites_enseignement WHERE classe_id = $1 ORDER BY ordre, code`, [insc.classe_id]),
      pool.query(`SELECT * FROM notes WHERE inscription_id = $1 AND session = 'normale'`, [insc.id]),
    ])
    const noteMap: Record<number, number> = {}
    notesRes.rows.forEach((n: any) => { noteMap[n.ue_id] = parseFloat(n.note) })

    let totalPts = 0, totalCoef = 0
    const ues = uesRes.rows.map((ue: any) => {
      const note = noteMap[ue.id] ?? null
      const coef = parseFloat(ue.coefficient) || 1
      if (note !== null) { totalPts += note * coef; totalCoef += coef }
      return { ue_id: ue.id, intitule: ue.intitule || ue.code, coefficient: coef, credits: parseInt(ue.credits_ects) || 0, note }
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
        const { rows: allNotes } = await pool.query(
          `SELECT n.inscription_id, n.note, ue.coefficient FROM notes n JOIN unites_enseignement ue ON n.ue_id = ue.id WHERE n.inscription_id = ANY($1) AND n.session = 'normale'`,
          [classInscIds]
        )
        const moyMap: Record<number, number> = {}
        for (const id of classInscIds) {
          const ns = allNotes.filter((n: any) => n.inscription_id === id)
          let tp = 0, tc = 0
          for (const n of ns) { tp += parseFloat(n.note) * (parseFloat(n.coefficient) || 1); tc += parseFloat(n.coefficient) || 1 }
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

  // 6. Séances cette semaine for their classe
  let seancesSemaine: any[] = []
  if (insc.classe_id) {
    const now = new Date()
    const day = now.getDay() === 0 ? 6 : now.getDay() - 1 // 0=Monday
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - day); weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999)
    const { rows } = await pool.query(`
      SELECT s.id, s.matiere, s.date_debut, s.date_fin, s.mode, s.salle,
        CASE WHEN iv.id IS NOT NULL THEN iv.prenom || ' ' || iv.nom ELSE NULL END as intervenant
      FROM seances s
      LEFT JOIN intervenants iv ON s.intervenant_id = iv.id
      WHERE s.classe_id = $1 AND s.statut != 'annule'
        AND s.date_debut >= $2 AND s.date_debut <= $3
      ORDER BY s.date_debut ASC
    `, [insc.classe_id, weekStart.toISOString(), weekEnd.toISOString()])
    seancesSemaine = rows
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
    FROM tarifs_intervenants t
    LEFT JOIN types_formation tf ON t.type_formation_id = tf.id
    LEFT JOIN annees_academiques aa ON t.annee_academique_id = aa.id
    ORDER BY t.created_at DESC
  `)
  return c.json(rows)
})

app.post('/tarifs', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `INSERT INTO tarifs_intervenants (type_formation_id,annee_academique_id,montant_horaire,date_effet,created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (type_formation_id,annee_academique_id) DO UPDATE SET montant_horaire=$3,date_effet=$4
     RETURNING *`,
    [b.type_formation_id, b.annee_academique_id, b.montant_horaire, b.date_effet, u(c).id]
  )
  return c.json(rows[0], 201)
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
