import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { Pool } from 'pg'
// @ts-ignore — CJS default export works at runtime
import jwt from 'jsonwebtoken'
// @ts-ignore — CJS default export works at runtime
import bcrypt from 'bcryptjs'

// ─── DB ──────────────────────────────────────────────────────────────────────
function buildPoolConfig() {
  const rawUrl = process.env.DATABASE_URL || 'postgresql://localhost/placeholder'
  try {
    const u = new URL(rawUrl)
    u.searchParams.delete('sslmode')
    u.searchParams.set('pgbouncer', 'true')
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } }
  } catch {
    return { connectionString: rawUrl, ssl: { rejectUnauthorized: false } }
  }
}

export const pool = new Pool({ ...buildPoolConfig(), max: 1, idleTimeoutMillis: 5000, connectionTimeoutMillis: 8000 })

// ─── JWT ─────────────────────────────────────────────────────────────────────
export const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) throw new Error('JWT_SECRET manquant dans les variables d\'environnement')

// ─── Types ───────────────────────────────────────────────────────────────────
export type Env = { Variables: { user: Record<string, unknown> } }

// ─── Middleware ──────────────────────────────────────────────────────────────
export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return c.json({ message: 'Non authentifié.' }, 401)
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET!) as { userId: number }
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

export const role = (...roles: string[]): MiddlewareHandler<Env> => async (c, next) => {
  if (!roles.includes((c.get('user') as Record<string, string>).role))
    return c.json({ message: 'Accès refusé.' }, 403)
  await next()
}

export const u = (c: { get(key: 'user'): Record<string, unknown> }) => c.get('user')

// ─── UTILS ───────────────────────────────────────────────────────────────────
export function pad(n: number, len = 5) { return String(n).padStart(len, '0') }
export function year() { return new Date().getFullYear() }

const ALLOWED_SEQ_TABLES = new Set(['etudiants', 'enseignants', 'inscriptions', 'paiements', 'depenses', 'seances', 'formations_individuelles', 'contrats_fixes', 'personnel'])
export async function nextSeq(table: string) {
  if (!ALLOWED_SEQ_TABLES.has(table)) throw new Error(`nextSeq: table "${table}" non autorisée`)
  const { rows } = await pool.query(`SELECT COALESCE(MAX(id),0)+1 as next FROM ${table}`)
  return rows[0].next as number
}

export async function isPeriodeLocked(dateStr: string): Promise<boolean> {
  if (!dateStr) return false
  const periode = String(dateStr).slice(0, 7)
  const { rows } = await pool.query('SELECT id FROM clotures_mensuelles WHERE periode=$1', [periode])
  return rows.length > 0
}

// Re-export libs for route modules
export { jwt, bcrypt }
export type { MiddlewareHandler }
