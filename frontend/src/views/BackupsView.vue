<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/services/api'

// ── Types ───────────────────────────────────────────────────────────
interface BackupRun {
  id: number
  source: string
  status: 'running' | 'success' | 'failed'
  triggered_by_user_id: number | null
  triggered_by_email: string | null
  db_size_bytes: number | null
  table_count: number | null
  total_rows: number | null
  error_message: string | null
  started_at: string
  completed_at: string | null
  duration_ms: number | null
}

interface TableStat {
  table: string
  rows: number
  size_bytes: number
}

interface CurrentStats {
  db_size_bytes: number
  table_count: number
  total_rows: number
  tables_stats: TableStat[]
}

interface RunDetails extends BackupRun {
  tables_stats: TableStat[] | null
}

// ── State ───────────────────────────────────────────────────────────
const runs = ref<BackupRun[]>([])
const total = ref(0)
const loading = ref(false)
const snapshotting = ref(false)
const currentStats = ref<CurrentStats | null>(null)
const loadingStats = ref(false)
const selectedRun = ref<RunDetails | null>(null)
const error = ref('')
const success = ref('')

// ── Helpers ─────────────────────────────────────────────────────────
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('fr-FR')
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

const sourceLabel: Record<string, string> = {
  'manual-snapshot': 'Snapshot manuel',
  'neon-pitr': 'Neon PITR',
  'github-action': 'GitHub Action',
}

// ── API ─────────────────────────────────────────────────────────────
async function loadRuns() {
  loading.value = true
  try {
    const { data } = await api.get('/backups', { params: { limit: 50 } })
    runs.value = data.data
    total.value = data.total
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur chargement historique.'
  } finally {
    loading.value = false
  }
}

async function loadCurrentStats() {
  loadingStats.value = true
  try {
    const { data } = await api.get('/backups/stats/current')
    currentStats.value = data
  } catch (e) {
    console.error(e)
  } finally {
    loadingStats.value = false
  }
}

async function triggerSnapshot() {
  error.value = ''
  success.value = ''
  snapshotting.value = true
  try {
    const { data } = await api.post('/backups/snapshot')
    success.value = `Snapshot #${data.id} créé : ${formatNumber(data.total_rows)} lignes, ${formatBytes(data.db_size_bytes)}.`
    await loadRuns()
    await loadCurrentStats()
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Échec du snapshot.'
  } finally {
    snapshotting.value = false
  }
}

async function viewDetails(id: number) {
  try {
    const { data } = await api.get(`/backups/${id}`)
    selectedRun.value = data
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur.'
  }
}

// ── Computed ────────────────────────────────────────────────────────
const topTables = computed(() => {
  if (!currentStats.value) return []
  return [...currentStats.value.tables_stats].slice(0, 10)
})

// ── Lifecycle ───────────────────────────────────────────────────────
onMounted(() => {
  loadRuns()
  loadCurrentStats()
})
</script>

<template>
  <div class="bk-page">
    <!-- Header -->
    <div class="bk-header">
      <div>
        <h2>💾 Sauvegardes &amp; Restauration</h2>
        <p>Surveillance et journal des sauvegardes de la base de données.</p>
      </div>
      <button
        class="bk-btn bk-btn-primary"
        :disabled="snapshotting"
        @click="triggerSnapshot"
      >
        <span v-if="snapshotting">Snapshot en cours…</span>
        <span v-else>📸 Lancer un snapshot</span>
      </button>
    </div>

    <!-- Alerts -->
    <div v-if="error" class="bk-alert bk-alert-error">{{ error }}</div>
    <div v-if="success" class="bk-alert bk-alert-success">{{ success }}</div>

    <!-- ══════════ NEON PITR INFO ══════════ -->
    <div class="bk-card bk-card-info">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div class="bk-icon-circle">🛡️</div>
        <div style="flex:1;">
          <h3>Sauvegarde automatique continue — Neon PITR</h3>
          <p class="bk-muted">
            La base de données UPTECH Campus est hébergée sur <strong>Neon</strong>, qui effectue une
            <strong>sauvegarde continue (Point-In-Time Recovery)</strong> à la seconde près, sans intervention.
          </p>
          <ul class="bk-info-list">
            <li>✓ Historique de récupération : <strong>7 jours glissants</strong> (plan actuel)</li>
            <li>✓ Point de restauration disponible à la <strong>seconde près</strong></li>
            <li>✓ Aucune donnée ne peut être perdue au-delà de quelques secondes en cas de panne</li>
            <li>✓ La restauration se fait depuis la <a href="https://console.neon.tech" target="_blank" rel="noopener">console Neon</a> (branche → "Restore to…")</li>
          </ul>
          <p class="bk-warn">
            ⚠ Pour étendre l'historique à 30 jours, passez au plan Launch de Neon (19 $/mois).
          </p>
        </div>
      </div>
    </div>

    <!-- ══════════ STATS ACTUELLES ══════════ -->
    <div class="bk-card">
      <h3>État actuel de la base de données</h3>
      <div v-if="loadingStats" class="bk-muted">Chargement…</div>
      <div v-else-if="currentStats" class="bk-stats-grid">
        <div class="bk-stat">
          <div class="bk-stat-label">Taille totale</div>
          <div class="bk-stat-value">{{ formatBytes(currentStats.db_size_bytes) }}</div>
        </div>
        <div class="bk-stat">
          <div class="bk-stat-label">Tables</div>
          <div class="bk-stat-value">{{ formatNumber(currentStats.table_count) }}</div>
        </div>
        <div class="bk-stat">
          <div class="bk-stat-label">Lignes (estimation)</div>
          <div class="bk-stat-value">{{ formatNumber(currentStats.total_rows) }}</div>
        </div>
      </div>

      <h4 style="margin-top:20px;">Top 10 — tables par taille</h4>
      <table v-if="topTables.length" class="bk-table">
        <thead>
          <tr>
            <th>Table</th>
            <th style="text-align:right;">Lignes</th>
            <th style="text-align:right;">Taille</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in topTables" :key="t.table">
            <td><code>{{ t.table }}</code></td>
            <td style="text-align:right; font-variant-numeric:tabular-nums;">{{ formatNumber(t.rows) }}</td>
            <td style="text-align:right; font-variant-numeric:tabular-nums;">{{ formatBytes(t.size_bytes) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ══════════ HISTORIQUE ══════════ -->
    <div class="bk-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3>Journal des snapshots</h3>
        <button class="bk-btn bk-btn-secondary" @click="loadRuns">
          Actualiser
        </button>
      </div>
      <p class="bk-muted" style="margin-top:0;">
        Chaque snapshot enregistre les statistiques de la base à un instant T : taille, nombre de lignes, tables.
        Utile pour détecter une anomalie (chute soudaine du nombre de lignes) ou vérifier la croissance.
      </p>
      <div v-if="loading" class="bk-muted" style="padding:20px 0;">Chargement…</div>
      <div v-else-if="runs.length === 0" class="bk-muted" style="padding:20px 0; text-align:center;">
        Aucun snapshot enregistré. Cliquez sur "Lancer un snapshot" pour créer le premier.
      </div>
      <table v-else class="bk-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Source</th>
            <th>Statut</th>
            <th>Déclenché par</th>
            <th style="text-align:right;">Taille</th>
            <th style="text-align:right;">Tables</th>
            <th style="text-align:right;">Lignes</th>
            <th style="text-align:right;">Durée</th>
            <th style="width:60px;"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in runs" :key="r.id">
            <td style="font-variant-numeric:tabular-nums; font-size:12px;">{{ formatDate(r.started_at) }}</td>
            <td>
              <span class="bk-badge bk-badge-neutral">
                {{ sourceLabel[r.source] ?? r.source }}
              </span>
            </td>
            <td>
              <span
                class="bk-badge"
                :class="{
                  'bk-badge-success': r.status === 'success',
                  'bk-badge-warning': r.status === 'running',
                  'bk-badge-danger': r.status === 'failed',
                }"
              >
                {{ r.status === 'success' ? 'Réussi' : r.status === 'running' ? 'En cours' : 'Échec' }}
              </span>
            </td>
            <td style="font-size:12px;">{{ r.triggered_by_email ?? '—' }}</td>
            <td style="text-align:right; font-variant-numeric:tabular-nums; font-size:12px;">{{ formatBytes(r.db_size_bytes) }}</td>
            <td style="text-align:right; font-variant-numeric:tabular-nums; font-size:12px;">{{ formatNumber(r.table_count) }}</td>
            <td style="text-align:right; font-variant-numeric:tabular-nums; font-size:12px;">{{ formatNumber(r.total_rows) }}</td>
            <td style="text-align:right; font-variant-numeric:tabular-nums; font-size:12px;">{{ formatDuration(r.duration_ms) }}</td>
            <td>
              <button class="bk-btn-icon" title="Détails" @click="viewDetails(r.id)">👁</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="total > runs.length" class="bk-muted" style="text-align:center; margin-top:12px;">
        Affichage des 50 plus récents (total : {{ total }})
      </div>
    </div>

    <!-- ══════════ PROCÉDURE DE RESTAURATION ══════════ -->
    <div class="bk-card bk-card-doc">
      <h3>📘 Procédure de restauration</h3>
      <ol class="bk-steps">
        <li>
          <strong>En cas d'incident (suppression, corruption, erreur humaine)</strong>, identifier le moment précis
          avant l'incident (consulter le journal d'audit).
        </li>
        <li>
          Se connecter à la <a href="https://console.neon.tech" target="_blank" rel="noopener">console Neon</a> avec le compte administrateur.
        </li>
        <li>
          Ouvrir la branche <code>main</code> du projet UPTECH Campus → onglet <strong>"Restore"</strong>.
        </li>
        <li>
          Choisir <strong>"Restore to a specific point in time"</strong> et saisir la date/heure cible (quelques secondes avant l'incident).
        </li>
        <li>
          Valider — Neon crée une <strong>nouvelle branche</strong> de la BD à ce point. Vérifier les données sur cette branche avant de basculer.
        </li>
        <li>
          Une fois validé : réassigner la branche restaurée comme <code>main</code> (ou mettre à jour <code>DATABASE_URL</code> dans Vercel).
        </li>
        <li>
          Redéployer l'application et vérifier l'intégrité (utilisateurs, étudiants, paiements récents).
        </li>
        <li>
          Consigner l'incident et la restauration dans le journal d'audit manuel.
        </li>
      </ol>
    </div>

    <!-- ══════════ MODAL DÉTAILS ══════════ -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="selectedRun" class="bk-modal-overlay" @click.self="selectedRun = null">
          <div class="bk-modal">
            <div class="bk-modal-head">
              <h3>Snapshot #{{ selectedRun.id }}</h3>
              <button class="bk-modal-close" @click="selectedRun = null">✕</button>
            </div>
            <div class="bk-modal-body">
              <div class="bk-detail-row"><span>Démarré</span><span>{{ formatDate(selectedRun.started_at) }}</span></div>
              <div class="bk-detail-row"><span>Terminé</span><span>{{ formatDate(selectedRun.completed_at) }}</span></div>
              <div class="bk-detail-row"><span>Durée</span><span>{{ formatDuration(selectedRun.duration_ms) }}</span></div>
              <div class="bk-detail-row"><span>Déclenché par</span><span>{{ selectedRun.triggered_by_email ?? '—' }}</span></div>
              <div class="bk-detail-row"><span>Taille BD</span><span>{{ formatBytes(selectedRun.db_size_bytes) }}</span></div>
              <div class="bk-detail-row"><span>Tables</span><span>{{ formatNumber(selectedRun.table_count) }}</span></div>
              <div class="bk-detail-row"><span>Lignes (est.)</span><span>{{ formatNumber(selectedRun.total_rows) }}</span></div>
              <div v-if="selectedRun.error_message" class="bk-detail-row">
                <span>Erreur</span><span style="color:#dc2626;">{{ selectedRun.error_message }}</span>
              </div>

              <div v-if="selectedRun.tables_stats && selectedRun.tables_stats.length" style="margin-top:16px;">
                <h4 style="margin:0 0 8px; font-size:13px;">Détail par table</h4>
                <table class="bk-table bk-table-compact">
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th style="text-align:right;">Lignes</th>
                      <th style="text-align:right;">Taille</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="t in selectedRun.tables_stats" :key="t.table">
                      <td><code>{{ t.table }}</code></td>
                      <td style="text-align:right; font-variant-numeric:tabular-nums;">{{ formatNumber(t.rows) }}</td>
                      <td style="text-align:right; font-variant-numeric:tabular-nums;">{{ formatBytes(t.size_bytes) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div class="bk-modal-foot">
              <button class="bk-btn bk-btn-secondary" @click="selectedRun = null">Fermer</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.bk-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  font-family: 'Poppins', sans-serif;
}

.bk-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.bk-header h2 {
  font-size: 22px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}
.bk-header p {
  font-size: 13px;
  color: #6b7280;
  margin: 4px 0 0;
}

.bk-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.bk-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 8px;
}
.bk-card h4 {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin: 0 0 8px;
}

.bk-card-info { background: #eff6ff; border-color: #bfdbfe; }
.bk-card-info h3 { color: #1e40af; }

.bk-card-doc { background: #fafafa; }

.bk-icon-circle {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #dbeafe;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.bk-muted {
  font-size: 12.5px;
  color: #6b7280;
  line-height: 1.55;
  margin: 0;
}

.bk-info-list {
  margin: 10px 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: #1e3a8a;
  line-height: 1.85;
}
.bk-info-list li { padding: 2px 0; }
.bk-info-list a { color: #1d4ed8; text-decoration: underline; }

.bk-warn {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  margin-top: 8px;
}

.bk-alert {
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  font-size: 13px;
}
.bk-alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
.bk-alert-success { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }

.bk-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.bk-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.bk-btn-primary { background: #2563eb; color: #fff; }
.bk-btn-primary:hover:not(:disabled) { background: #1d4ed8; }

.bk-btn-secondary { background: #fff; color: #374151; border-color: #d1d5db; }
.bk-btn-secondary:hover:not(:disabled) { background: #f9fafb; }

.bk-btn-icon {
  padding: 4px 8px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.bk-btn-icon:hover { background: #f3f4f6; }

.bk-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-top: 8px;
}

.bk-stat {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 14px 16px;
}
.bk-stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #6b7280;
  margin-bottom: 6px;
}
.bk-stat-value {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  font-variant-numeric: tabular-nums;
}

.bk-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.bk-table thead tr {
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}
.bk-table th {
  padding: 8px 12px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #6b7280;
}
.bk-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #f3f4f6;
}
.bk-table tbody tr:hover { background: #f9fafb; }
.bk-table code {
  background: #f3f4f6;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: #374151;
}
.bk-table-compact th, .bk-table-compact td {
  padding: 6px 10px;
  font-size: 12px;
}

.bk-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}
.bk-badge-neutral { background: #f3f4f6; color: #6b7280; }
.bk-badge-success { background: #dcfce7; color: #15803d; }
.bk-badge-warning { background: #fef3c7; color: #92400e; }
.bk-badge-danger { background: #fee2e2; color: #991b1b; }

.bk-steps {
  margin: 8px 0;
  padding-left: 20px;
  font-size: 13px;
  color: #374151;
  line-height: 1.7;
}
.bk-steps li { margin-bottom: 6px; }
.bk-steps code {
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
}
.bk-steps a { color: #2563eb; text-decoration: underline; }

.bk-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.bk-modal {
  background: #fff;
  border-radius: 10px;
  max-width: 720px;
  width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0,0,0,0.2);
}
.bk-modal-head {
  padding: 14px 20px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.bk-modal-head h3 { margin: 0; font-size: 16px; }
.bk-modal-close {
  border: none;
  background: none;
  font-size: 16px;
  cursor: pointer;
  color: #6b7280;
  padding: 4px 8px;
}
.bk-modal-body {
  padding: 14px 20px;
  overflow-y: auto;
  flex: 1;
}
.bk-modal-foot {
  padding: 10px 20px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
}

.bk-detail-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  padding: 5px 0;
  font-size: 13px;
  border-bottom: 1px solid #f3f4f6;
}
.bk-detail-row span:first-child {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  align-self: center;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@media (max-width: 640px) {
  .bk-stats-grid { grid-template-columns: 1fr; }
  .bk-table { font-size: 11px; }
}
</style>
