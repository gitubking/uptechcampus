<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import * as XLSX from 'xlsx'

const toast = useToast()

// ── Types ───────────────────────────────────────────────────────────
interface AuditLog {
  id: number
  created_at: string
  user_id: number | null
  user_email: string | null
  user_prenom: string | null
  user_nom: string | null
  user_role: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  description: string | null
  metadata: any
  ip_address: string | null
  user_agent: string | null
  severity: 'info' | 'warning' | 'critical'
}

interface FacetsResponse {
  actions: { action: string; n: number }[]
  entity_types: { entity_type: string; n: number }[]
  users: { user_id: number; user_email: string; user_prenom: string; user_nom: string; user_role: string; n: number }[]
}

// ── State ───────────────────────────────────────────────────────────
const loading = ref(false)
const logs = ref<AuditLog[]>([])
const total = ref(0)
const facets = ref<FacetsResponse>({ actions: [], entity_types: [], users: [] })

const filters = ref({
  search: '',
  action: '',
  entity_type: '',
  severity: '',
  user_id: '',
  date_from: '',
  date_to: '',
})
const limit = ref(50)
const offset = ref(0)

const selectedLog = ref<AuditLog | null>(null)

// ── Helpers ─────────────────────────────────────────────────────────
const roleLabel: Record<string, string> = {
  dg: 'DG',
  dir_peda: 'Dir. Péda',
  resp_fin: 'Resp. Fin.',
  coordinateur: 'Coord.',
  secretariat: 'Secrétariat',
  enseignant: 'Enseignant',
  etudiant: 'Étudiant',
  parent: 'Parent',
}

const severityLabel: Record<string, string> = {
  info: 'Info',
  warning: 'Avertissement',
  critical: 'Critique',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function userLabel(log: AuditLog) {
  if (!log.user_id) return 'Système / Anonyme'
  const nom = [log.user_prenom, log.user_nom].filter(Boolean).join(' ')
  return nom || log.user_email || `Utilisateur #${log.user_id}`
}

function actionLabel(action: string) {
  return action.replace(/_/g, ' ')
}

// ── Data loading ────────────────────────────────────────────────────
async function loadFacets() {
  try {
    const { data } = await api.get('/audit-logs/facets')
    facets.value = data
  } catch (e) {
    console.error('Facets load error', e)
  }
}

async function loadLogs() {
  loading.value = true
  try {
    const params: Record<string, any> = { limit: limit.value, offset: offset.value }
    if (filters.value.search) params.search = filters.value.search
    if (filters.value.action) params.action = filters.value.action
    if (filters.value.entity_type) params.entity_type = filters.value.entity_type
    if (filters.value.severity) params.severity = filters.value.severity
    if (filters.value.user_id) params.user_id = filters.value.user_id
    if (filters.value.date_from) params.date_from = filters.value.date_from
    if (filters.value.date_to) params.date_to = filters.value.date_to

    const { data } = await api.get('/audit-logs', { params })
    logs.value = data.data
    total.value = data.total
  } catch (e) {
    console.error('Logs load error', e)
    logs.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  offset.value = 0
  loadLogs()
}

function resetFilters() {
  filters.value = {
    search: '', action: '', entity_type: '', severity: '',
    user_id: '', date_from: '', date_to: '',
  }
  offset.value = 0
  loadLogs()
}

// ── Pagination ──────────────────────────────────────────────────────
const currentPage = computed(() => Math.floor(offset.value / limit.value) + 1)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

function prevPage() {
  if (offset.value >= limit.value) {
    offset.value -= limit.value
    loadLogs()
  }
}
function nextPage() {
  if (offset.value + limit.value < total.value) {
    offset.value += limit.value
    loadLogs()
  }
}

// ── Export ──────────────────────────────────────────────────────────
async function exportExcel() {
  try {
    const params: Record<string, any> = { limit: 5000, offset: 0 }
    if (filters.value.search) params.search = filters.value.search
    if (filters.value.action) params.action = filters.value.action
    if (filters.value.entity_type) params.entity_type = filters.value.entity_type
    if (filters.value.severity) params.severity = filters.value.severity
    if (filters.value.user_id) params.user_id = filters.value.user_id
    if (filters.value.date_from) params.date_from = filters.value.date_from
    if (filters.value.date_to) params.date_to = filters.value.date_to

    const { data } = await api.get('/audit-logs', { params })
    const rows = (data.data as AuditLog[]).map((l) => ({
      'Date': formatDate(l.created_at),
      'Utilisateur': userLabel(l),
      'Email': l.user_email ?? '',
      'Rôle': l.user_role ? (roleLabel[l.user_role] ?? l.user_role) : '',
      'Action': l.action,
      'Entité': l.entity_type ?? '',
      'ID entité': l.entity_id ?? '',
      'Sévérité': severityLabel[l.severity] ?? l.severity,
      'Description': l.description ?? '',
      'IP': l.ip_address ?? '',
      'Métadonnées': l.metadata ? JSON.stringify(l.metadata) : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Journal audit')
    const date = new Date().toISOString().split('T')[0]
    XLSX.writeFile(wb, `journal-audit-${date}.xlsx`)
  } catch (e) {
    console.error('Export error', e)
    toast.error('Erreur lors de l\'export')
  }
}

// ── Watchers ────────────────────────────────────────────────────────
watch(limit, () => {
  offset.value = 0
  loadLogs()
})

// ── Lifecycle ───────────────────────────────────────────────────────
onMounted(() => {
  loadFacets()
  loadLogs()
})
</script>

<template>
  <div class="uc-page">
    <!-- Header -->
    <div class="uc-page-header">
      <div>
        <h2 class="uc-page-title">📋 Journal d'audit</h2>
        <p class="uc-page-subtitle">
          Historique complet des actions sensibles · {{ total }} entrée{{ total > 1 ? 's' : '' }}
        </p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="uc-btn uc-btn-secondary" @click="loadLogs">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualiser
        </button>
        <button class="uc-btn uc-btn-primary" @click="exportExcel">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
          Exporter Excel
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="uc-card" style="margin-bottom:16px;">
      <div class="uc-filter-grid">
        <div class="uc-filter-field">
          <label>Recherche</label>
          <input
            v-model="filters.search"
            type="text"
            placeholder="Description, email, action..."
            class="uc-input"
            @keyup.enter="applyFilters"
          />
        </div>
        <div class="uc-filter-field">
          <label>Action</label>
          <select v-model="filters.action" class="uc-input">
            <option value="">Toutes</option>
            <option v-for="a in facets.actions" :key="a.action" :value="a.action">
              {{ actionLabel(a.action) }} ({{ a.n }})
            </option>
          </select>
        </div>
        <div class="uc-filter-field">
          <label>Entité</label>
          <select v-model="filters.entity_type" class="uc-input">
            <option value="">Toutes</option>
            <option v-for="e in facets.entity_types" :key="e.entity_type" :value="e.entity_type">
              {{ e.entity_type }} ({{ e.n }})
            </option>
          </select>
        </div>
        <div class="uc-filter-field">
          <label>Sévérité</label>
          <select v-model="filters.severity" class="uc-input">
            <option value="">Toutes</option>
            <option value="info">Info</option>
            <option value="warning">Avertissement</option>
            <option value="critical">Critique</option>
          </select>
        </div>
        <div class="uc-filter-field">
          <label>Utilisateur</label>
          <select v-model="filters.user_id" class="uc-input">
            <option value="">Tous</option>
            <option v-for="u in facets.users" :key="u.user_id" :value="u.user_id">
              {{ u.user_prenom }} {{ u.user_nom }} ({{ u.n }})
            </option>
          </select>
        </div>
        <div class="uc-filter-field">
          <label>Du</label>
          <input v-model="filters.date_from" type="date" class="uc-input" />
        </div>
        <div class="uc-filter-field">
          <label>Au</label>
          <input v-model="filters.date_to" type="date" class="uc-input" />
        </div>
      </div>
      <div style="display:flex; gap:8px; margin-top:12px;">
        <button class="uc-btn uc-btn-primary" @click="applyFilters">
          Appliquer les filtres
        </button>
        <button class="uc-btn uc-btn-secondary" @click="resetFilters">
          Réinitialiser
        </button>
      </div>
    </div>

    <!-- Table -->
    <div class="uc-card" style="padding:0; overflow:hidden;">
      <div v-if="loading" style="padding:40px; text-align:center; color:#6b7280;">
        Chargement...
      </div>
      <div v-else-if="logs.length === 0" style="padding:40px; text-align:center; color:#6b7280;">
        Aucune entrée trouvée avec ces filtres.
      </div>
      <div v-else style="overflow-x:auto;">
        <table class="uc-table">
          <thead>
            <tr>
              <th>Date / Heure</th>
              <th>Utilisateur</th>
              <th>Action</th>
              <th>Entité</th>
              <th>Description</th>
              <th>IP</th>
              <th style="width:60px;">Détails</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="log in logs" :key="log.id">
              <td style="white-space:nowrap; font-variant-numeric:tabular-nums; font-size:12px;">
                {{ formatDate(log.created_at) }}
              </td>
              <td>
                <div style="display:flex; flex-direction:column;">
                  <span style="font-weight:500;">{{ userLabel(log) }}</span>
                  <span v-if="log.user_role" class="uc-badge uc-badge-neutral" style="width:fit-content; margin-top:2px;">
                    {{ roleLabel[log.user_role] ?? log.user_role }}
                  </span>
                </div>
              </td>
              <td>
                <span
                  class="uc-badge"
                  :class="{
                    'uc-badge-info': log.severity === 'info',
                    'uc-badge-warning': log.severity === 'warning',
                    'uc-badge-danger': log.severity === 'critical',
                  }"
                >
                  {{ actionLabel(log.action) }}
                </span>
              </td>
              <td style="font-size:12px;">
                <span v-if="log.entity_type">{{ log.entity_type }}</span>
                <span v-if="log.entity_id" style="color:#6b7280;"> #{{ log.entity_id }}</span>
              </td>
              <td style="max-width:400px; font-size:12px;">{{ log.description }}</td>
              <td style="font-family:monospace; font-size:11px; color:#6b7280;">{{ log.ip_address ?? '—' }}</td>
              <td>
                <button class="uc-btn-icon" title="Voir détails" @click="selectedLog = log">
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="total > 0" class="uc-pagination">
        <div style="display:flex; align-items:center; gap:8px;">
          <label style="font-size:12px; color:#6b7280;">Par page :</label>
          <select v-model.number="limit" class="uc-input" style="width:auto; padding:4px 8px;">
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
          </select>
          <span style="font-size:12px; color:#6b7280;">
            {{ offset + 1 }}–{{ Math.min(offset + limit, total) }} sur {{ total }}
          </span>
        </div>
        <div style="display:flex; gap:6px;">
          <button
            class="uc-btn uc-btn-secondary"
            :disabled="offset === 0"
            @click="prevPage"
          >
            ← Précédent
          </button>
          <span style="padding:6px 12px; font-size:12px; color:#374151;">
            Page {{ currentPage }} / {{ totalPages }}
          </span>
          <button
            class="uc-btn uc-btn-secondary"
            :disabled="offset + limit >= total"
            @click="nextPage"
          >
            Suivant →
          </button>
        </div>
      </div>
    </div>

    <!-- Details modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="selectedLog" class="uc-modal-overlay" @click.self="selectedLog = null">
          <div class="uc-modal-box" style="max-width:720px; max-height:85vh; display:flex; flex-direction:column;">
            <div class="uc-modal-header">
              <div>
                <h3 class="uc-modal-title">Détails de l'événement #{{ selectedLog.id }}</h3>
                <p class="uc-modal-subtitle">{{ formatDate(selectedLog.created_at) }}</p>
              </div>
              <button class="uc-modal-close" @click="selectedLog = null">✕</button>
            </div>
            <div class="uc-modal-body" style="overflow-y:auto;">
              <div class="uc-detail-grid">
                <div class="uc-detail-row">
                  <span class="uc-detail-label">Action</span>
                  <span>
                    <span
                      class="uc-badge"
                      :class="{
                        'uc-badge-info': selectedLog.severity === 'info',
                        'uc-badge-warning': selectedLog.severity === 'warning',
                        'uc-badge-danger': selectedLog.severity === 'critical',
                      }"
                    >
                      {{ actionLabel(selectedLog.action) }}
                    </span>
                    <span style="margin-left:8px; font-size:12px; color:#6b7280;">
                      ({{ severityLabel[selectedLog.severity] }})
                    </span>
                  </span>
                </div>
                <div class="uc-detail-row">
                  <span class="uc-detail-label">Utilisateur</span>
                  <span>{{ userLabel(selectedLog) }}</span>
                </div>
                <div v-if="selectedLog.user_email" class="uc-detail-row">
                  <span class="uc-detail-label">Email</span>
                  <span>{{ selectedLog.user_email }}</span>
                </div>
                <div v-if="selectedLog.user_role" class="uc-detail-row">
                  <span class="uc-detail-label">Rôle</span>
                  <span>{{ roleLabel[selectedLog.user_role] ?? selectedLog.user_role }}</span>
                </div>
                <div v-if="selectedLog.entity_type" class="uc-detail-row">
                  <span class="uc-detail-label">Entité</span>
                  <span>{{ selectedLog.entity_type }} <span v-if="selectedLog.entity_id" style="color:#6b7280;">#{{ selectedLog.entity_id }}</span></span>
                </div>
                <div v-if="selectedLog.description" class="uc-detail-row">
                  <span class="uc-detail-label">Description</span>
                  <span>{{ selectedLog.description }}</span>
                </div>
                <div v-if="selectedLog.ip_address" class="uc-detail-row">
                  <span class="uc-detail-label">Adresse IP</span>
                  <span style="font-family:monospace;">{{ selectedLog.ip_address }}</span>
                </div>
                <div v-if="selectedLog.user_agent" class="uc-detail-row">
                  <span class="uc-detail-label">User-Agent</span>
                  <span style="font-size:11px; color:#6b7280; word-break:break-all;">{{ selectedLog.user_agent }}</span>
                </div>
              </div>

              <div v-if="selectedLog.metadata" style="margin-top:16px;">
                <h4 style="font-size:13px; font-weight:600; margin-bottom:8px; color:#374151;">Métadonnées</h4>
                <pre class="uc-json-block">{{ JSON.stringify(selectedLog.metadata, null, 2) }}</pre>
              </div>
            </div>
            <div class="uc-modal-footer">
              <button class="uc-btn uc-btn-secondary" @click="selectedLog = null">Fermer</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.uc-page {
  padding: 24px;
  max-width: 1600px;
  margin: 0 auto;
}

.uc-page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.uc-page-title {
  font-size: 22px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.uc-page-subtitle {
  font-size: 13px;
  color: #6b7280;
  margin: 4px 0 0;
}

.uc-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.uc-filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}

.uc-filter-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.uc-filter-field label {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.uc-input {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  background: #fff;
  width: 100%;
  box-sizing: border-box;
  font-family: inherit;
}

.uc-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.uc-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}

.uc-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.uc-btn-primary {
  background: #2563eb;
  color: #fff;
}
.uc-btn-primary:hover:not(:disabled) {
  background: #1d4ed8;
}

.uc-btn-secondary {
  background: #fff;
  color: #374151;
  border-color: #d1d5db;
}
.uc-btn-secondary:hover:not(:disabled) {
  background: #f9fafb;
}

.uc-btn-icon {
  padding: 6px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  color: #6b7280;
}
.uc-btn-icon:hover {
  background: #f3f4f6;
  color: #374151;
}

.uc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.uc-table thead tr {
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}

.uc-table th {
  padding: 10px 12px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #6b7280;
}

.uc-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #f3f4f6;
  vertical-align: middle;
}

.uc-table tbody tr:hover {
  background: #f9fafb;
}

.uc-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  text-transform: capitalize;
}
.uc-badge-neutral { background: #f3f4f6; color: #6b7280; }
.uc-badge-info { background: #dbeafe; color: #1e40af; }
.uc-badge-warning { background: #fef3c7; color: #92400e; }
.uc-badge-danger { background: #fee2e2; color: #991b1b; }

.uc-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid #e5e7eb;
  background: #fafafa;
  flex-wrap: wrap;
  gap: 8px;
}

.uc-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.uc-modal-box {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  width: 100%;
}

.uc-modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.uc-modal-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #111827;
}

.uc-modal-subtitle {
  font-size: 12px;
  color: #6b7280;
  margin: 2px 0 0;
}

.uc-modal-close {
  border: none;
  background: none;
  font-size: 18px;
  cursor: pointer;
  color: #6b7280;
  padding: 4px 8px;
}

.uc-modal-body {
  padding: 16px 20px;
}

.uc-modal-footer {
  padding: 12px 20px;
  border-top: 1px solid #e5e7eb;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.uc-detail-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.uc-detail-row {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  font-size: 13px;
  align-items: start;
}

.uc-detail-label {
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding-top: 2px;
}

.uc-json-block {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 6px;
  font-size: 11px;
  font-family: 'Courier New', monospace;
  overflow-x: auto;
  max-height: 300px;
  overflow-y: auto;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
