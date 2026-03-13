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
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } }
  } catch {
    return { connectionString: rawUrl, ssl: { rejectUnauthorized: false } }
  }
}
const pool = new Pool({ ...buildPoolConfig(), max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 })

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
    'INSERT INTO filieres (nom,code,description,actif,type_formation_id,frais_inscription,mensualite,duree_mois) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [b.nom, b.code, b.description || null, b.actif ?? true, b.type_formation_id || null, b.frais_inscription || 0, b.mensualite || 0, b.duree_mois || null]
  )
  return c.json(rows[0], 201)
})

app.put('/filieres/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE filieres SET nom=$1,code=$2,description=$3,actif=$4,type_formation_id=$5,frais_inscription=$6,mensualite=$7,duree_mois=$8 WHERE id=$9 RETURNING *',
    [b.nom, b.code, b.description || null, b.actif ?? true, b.type_formation_id || null, b.frais_inscription || 0, b.mensualite || 0, b.duree_mois || null, c.req.param('id')]
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
  const { rows } = await pool.query('SELECT * FROM niveaux_entree ORDER BY nom')
  return c.json(rows)
})

app.post('/niveaux-entree', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query('INSERT INTO niveaux_entree (nom,description) VALUES ($1,$2) RETURNING *', [b.nom, b.description || null])
  return c.json(rows[0], 201)
})

app.put('/niveaux-entree/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query('UPDATE niveaux_entree SET nom=$1,description=$2 WHERE id=$3 RETURNING *', [b.nom, b.description || null, c.req.param('id')])
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
    'INSERT INTO niveaux_bourse (nom,pourcentage,description) VALUES ($1,$2,$3) RETURNING *',
    [b.nom, b.pourcentage || 0, b.description || null]
  )
  return c.json(rows[0], 201)
})

app.put('/niveaux-bourse/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE niveaux_bourse SET nom=$1,pourcentage=$2,description=$3 WHERE id=$4 RETURNING *',
    [b.nom, b.pourcentage || 0, b.description || null, c.req.param('id')]
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
    'INSERT INTO types_formation (nom,code,description) VALUES ($1,$2,$3) RETURNING *',
    [b.nom, b.code || null, b.description || null]
  )
  return c.json(rows[0], 201)
})

app.put('/types-formation/:id', requireAuth, role('dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE types_formation SET nom=$1,code=$2,description=$3 WHERE id=$4 RETURNING *',
    [b.nom, b.code || null, b.description || null, c.req.param('id')]
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
      jsonb_build_object('id',f.id,'nom',f.nom,'code',f.code) as filiere,
      jsonb_build_object('id',aa.id,'libelle',aa.libelle) as annee_academique,
      COALESCE(json_agg(DISTINCT jsonb_build_object('id',p.id,'nom',p.nom)) FILTER (WHERE p.id IS NOT NULL),'[]') as parcours
    FROM classes c
    LEFT JOIN filieres f ON c.filiere_id = f.id
    LEFT JOIN annees_academiques aa ON c.annee_academique_id = aa.id
    LEFT JOIN classes_parcours cp ON c.id = cp.classe_id
    LEFT JOIN parcours p ON cp.parcours_id = p.id
    GROUP BY c.id,f.id,f.nom,f.code,aa.id,aa.libelle ORDER BY c.nom
  `)
  return c.json(rows)
})

app.post('/classes', requireAuth, role('dg', 'coordinateur'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'INSERT INTO classes (nom,filiere_id,annee_academique_id,created_by) VALUES ($1,$2,$3,$4) RETURNING *',
    [b.nom, b.filiere_id, b.annee_academique_id, u(c).id]
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
    'UPDATE classes SET nom=$1,filiere_id=$2,annee_academique_id=$3 WHERE id=$4 RETURNING *',
    [b.nom, b.filiere_id, b.annee_academique_id, c.req.param('id')]
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
  const { rows } = await pool.query('SELECT * FROM etudiants ORDER BY nom,prenom')
  return c.json(rows)
})

app.get('/etudiants/:id', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM etudiants WHERE id=$1', [c.req.param('id')])
  if (!rows[0]) return c.json({ message: 'Étudiant introuvable.' }, 404)
  return c.json(rows[0])
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
  return c.json({ message: 'Upload photo: utilisez Cloudinary et mettez à jour photo_path via PUT /etudiants/:id.' })
})

// ─── INSCRIPTIONS ─────────────────────────────────────────────────────────────
app.get('/inscriptions', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT i.*,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom,'email',e.email,'numero_etudiant',e.numero_etudiant) as etudiant,
      CASE WHEN c.id IS NOT NULL THEN jsonb_build_object('id',c.id,'nom',c.nom) ELSE NULL END as classe,
      CASE WHEN f.id IS NOT NULL THEN jsonb_build_object('id',f.id,'nom',f.nom) ELSE NULL END as filiere
    FROM inscriptions i
    LEFT JOIN etudiants e ON i.etudiant_id = e.id
    LEFT JOIN classes c ON i.classe_id = c.id
    LEFT JOIN filieres f ON i.filiere_id = f.id
    ORDER BY i.created_at DESC
  `)
  return c.json(rows)
})

app.post('/inscriptions', requireAuth, role('secretariat', 'dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `INSERT INTO inscriptions (etudiant_id,filiere_id,classe_id,parcours_id,annee_academique_id,
      niveau_entree_id,niveau_bourse_id,statut,frais_inscription,mensualite,frais_tenue,reduction_type,reduction_valeur,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [b.etudiant_id, b.filiere_id || null, b.classe_id || null, b.parcours_id || null, b.annee_academique_id,
     b.niveau_entree_id || null, b.niveau_bourse_id || null, b.statut || 'pre_inscrit',
     b.frais_inscription || 0, b.mensualite || 0, b.frais_tenue || 0,
     b.reduction_type || null, b.reduction_valeur || null, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.put('/inscriptions/:id', requireAuth, role('secretariat', 'dg'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    `UPDATE inscriptions SET filiere_id=$1,classe_id=$2,parcours_id=$3,annee_academique_id=$4,
      niveau_entree_id=$5,niveau_bourse_id=$6,statut=$7,frais_inscription=$8,mensualite=$9,
      frais_tenue=$10,reduction_type=$11,reduction_valeur=$12
     WHERE id=$13 RETURNING *`,
    [b.filiere_id || null, b.classe_id || null, b.parcours_id || null, b.annee_academique_id,
     b.niveau_entree_id || null, b.niveau_bourse_id || null, b.statut || 'pre_inscrit',
     b.frais_inscription || 0, b.mensualite || 0, b.frais_tenue || 0,
     b.reduction_type || null, b.reduction_valeur || null, c.req.param('id')]
  )
  return c.json(rows[0])
})

app.post('/inscriptions/:id/valider', requireAuth, role('secretariat', 'dg'), async (c) => {
  const { rows } = await pool.query(
    "UPDATE inscriptions SET statut='inscrit_actif',date_validation=NOW(),validated_by=$1 WHERE id=$2 RETURNING *",
    [u(c).id, c.req.param('id')]
  )
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
  const { rows } = await pool.query('UPDATE inscriptions SET classe_id=$1 WHERE id=$2 RETURNING *', [classe_id, c.req.param('id')])
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
  const { rows } = await pool.query(`
    SELECT i.*, aa.libelle as annee_academique_libelle
    FROM intervenants i
    LEFT JOIN annees_academiques aa ON i.annee_academique_id = aa.id
    ORDER BY i.nom,i.prenom
  `)
  return c.json(rows)
})

app.get('/intervenants/:id', requireAuth, async (c) => {
  const { rows } = await pool.query('SELECT * FROM intervenants WHERE id=$1', [c.req.param('id')])
  if (!rows[0]) return c.json({ message: 'Intervenant introuvable.' }, 404)
  return c.json(rows[0])
})

app.post('/intervenants', requireAuth, role('dg', 'secretariat'), async (c) => {
  const b = await c.req.json()
  if (!b.user_id) return c.json({ message: 'user_id requis.' }, 422)
  if (!b.annee_academique_id) return c.json({ message: 'annee_academique_id requis.' }, 422)
  const seq = await nextSeq('intervenants')
  const numero = `CONT-${year()}-${pad(seq)}`
  const { rows } = await pool.query(
    `INSERT INTO intervenants (user_id,numero_contrat,nom,prenom,email,telephone,statut,annee_academique_id,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [b.user_id, numero, b.nom, b.prenom, b.email || null, b.telephone || null,
     b.statut || 'en_attente', b.annee_academique_id, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.put('/intervenants/:id', requireAuth, role('dg', 'secretariat'), async (c) => {
  const b = await c.req.json()
  const { rows } = await pool.query(
    'UPDATE intervenants SET nom=$1,prenom=$2,email=$3,telephone=$4,statut=$5 WHERE id=$6 RETURNING *',
    [b.nom, b.prenom, b.email || null, b.telephone || null, b.statut || 'actif', c.req.param('id')]
  )
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

app.post('/paiements', requireAuth, role('secretariat', 'dg', 'resp_fin'), async (c) => {
  const b = await c.req.json()
  const seq = await nextSeq('paiements')
  const numero = `PAY-${year()}-${pad(seq)}`
  const { rows } = await pool.query(
    `INSERT INTO paiements (inscription_id,numero_recu,type_paiement,mois_concerne,montant,mode_paiement,statut,reference,observation,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'en_attente',$7,$8,$9) RETURNING *`,
    [b.inscription_id, numero, b.type_paiement || 'mensualite', b.mois_concerne || null,
     b.montant, b.mode_paiement || 'especes', b.reference || null, b.observation || null, u(c).id]
  )
  return c.json(rows[0], 201)
})

app.post('/paiements/:id/confirmer', requireAuth, role('dg', 'resp_fin'), async (c) => {
  const { rows } = await pool.query(
    "UPDATE paiements SET statut='confirme',confirmed_at=NOW(),confirmed_by=$1 WHERE id=$2 RETURNING *",
    [u(c).id, c.req.param('id')]
  )
  return c.json(rows[0])
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
  const { rows } = await pool.query(`
    SELECT n.*,
      jsonb_build_object('id',ue.id,'code',ue.code,'intitule',ue.intitule) as ue,
      jsonb_build_object('id',e.id,'nom',e.nom,'prenom',e.prenom) as etudiant
    FROM notes n
    LEFT JOIN unites_enseignement ue ON n.ue_id = ue.id
    LEFT JOIN inscriptions i ON n.inscription_id = i.id
    LEFT JOIN etudiants e ON i.etudiant_id = e.id
    ORDER BY n.created_at DESC
  `)
  return c.json(rows)
})

app.get('/notes/bulletin/:inscription_id', requireAuth, async (c) => {
  const { rows } = await pool.query(`
    SELECT n.*, jsonb_build_object('id',ue.id,'code',ue.code,'intitule',ue.intitule,'coefficient',ue.coefficient,'credits_ects',ue.credits_ects) as ue
    FROM notes n LEFT JOIN unites_enseignement ue ON n.ue_id = ue.id
    WHERE n.inscription_id=$1
  `, [c.req.param('inscription_id')])
  return c.json(rows)
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
  return c.json({ message: 'Dashboard étudiant' })
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
