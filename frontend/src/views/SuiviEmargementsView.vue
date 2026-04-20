<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import api from '@/services/api'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import { openPrintWindow, uptechHeaderHTML, uptechFooterHTML, uptechPrintCSS } from '@/utils/uptechPrint'

// ── State ──
const loading = ref(true)
const loadError = ref('')
const moisSelected = ref(new Date().toISOString().slice(0, 7))
const tabActive = ref<'jour' | 'enseignant' | 'detail'>('jour')

interface Stats {
  total_seances: number
  total_heures: number
  nb_enseignants: number
  nb_classes: number
  nb_jours_actifs: number
}
interface JourRow { jour: string; nb_seances: number; heures: number; nb_enseignants: number }
interface EnseignantRow { id: number; nom: string; prenom: string; nb_seances: number; heures_total: number; nb_classes: number; nb_jours: number }
interface SeanceRow {
  id: number; matiere: string; date_debut: string; date_fin: string; statut: string; mode: string
  heures: number; contenu_seance?: string; signe_enseignant_at?: string
  enseignant?: { id: number; nom: string; prenom: string }
  classe?: { id: number; nom: string }
  nb_presents: number; nb_total: number
}

const stats = ref<Stats>({ total_seances: 0, total_heures: 0, nb_enseignants: 0, nb_classes: 0, nb_jours_actifs: 0 })
const parJour = ref<JourRow[]>([])
const parEnseignant = ref<EnseignantRow[]>([])
const seances = ref<SeanceRow[]>([])

// ── Load data ──
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await api.get(`/suivi-emargements?mois=${moisSelected.value}`)
    stats.value = data.stats || { total_seances: 0, total_heures: 0, nb_enseignants: 0, nb_classes: 0, nb_jours_actifs: 0 }
    parJour.value = data.par_jour || []
    parEnseignant.value = data.par_enseignant || []
    seances.value = data.seances || []
  } catch (e: any) {
    console.error(e)
    loadError.value = e?.response?.data?.message || e?.message || 'Erreur lors du chargement des données.'
  } finally {
    loading.value = false
  }
}

watch(moisSelected, load)
onMounted(load)

// ── Helpers ──
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}
function formatDateTime(d: string) {
  return new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function formatHeure(d: string) {
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

const moisLabel = computed(() => {
  const [y, m] = moisSelected.value.split('-')
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
  return `${months[parseInt(m || '1') - 1]} ${y}`
})

// Navigation mois
function moisPrecedent() {
  const d = new Date(moisSelected.value + '-01')
  d.setMonth(d.getMonth() - 1)
  moisSelected.value = d.toISOString().slice(0, 7)
}
function moisSuivant() {
  const d = new Date(moisSelected.value + '-01')
  d.setMonth(d.getMonth() + 1)
  moisSelected.value = d.toISOString().slice(0, 7)
}

// ── Filtres export ──
const filterEnseignant = ref('')
const filterClasse = ref('')

const seancesFiltrees = computed(() => {
  return seances.value.filter(s => {
    if (filterEnseignant.value) {
      const nomComplet = s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}`.toLowerCase() : ''
      if (!nomComplet.includes(filterEnseignant.value.toLowerCase())) return false
    }
    if (filterClasse.value) {
      if (!s.classe?.nom?.toLowerCase().includes(filterClasse.value.toLowerCase())) return false
    }
    return true
  })
})

// Enseignants uniques pour le filtre
const enseignantsUniques = computed(() => {
  const map = new Map<number, string>()
  for (const s of seances.value) {
    if (s.enseignant?.id && s.enseignant.nom) {
      map.set(s.enseignant.id, `${s.enseignant.prenom ?? ''} ${s.enseignant.nom}`.trim())
    }
  }
  return [...map.entries()].map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? ''))
})

// Classes uniques pour le filtre
const classesUniques = computed(() => {
  const map = new Map<number, string>()
  for (const s of seances.value) {
    if (s.classe?.id && s.classe.nom) map.set(s.classe.id, s.classe.nom)
  }
  return [...map.entries()].map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? ''))
})

// Sécurise les chaînes utilisateur injectées dans le HTML imprimable.
function escapeHtml(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

// ── Export impression HTML/print ──
// Utilise l'en-tête institutionnel UPTECH partagé pour uniformiser avec
// les reçus, autorisations d'absence et cahier de textes.
function exportPDF(parEns = false) {
  const data = seancesFiltrees.value
  if (!data.length) { toast.warning('Aucune séance à exporter.'); return }
  const totalH = data.reduce((s, r) => s + Number(r.heures || 0), 0)
  const emitDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  const renderRows = (rows: SeanceRow[]) => rows.map(s => `
    <tr>
      <td>${formatDate(s.date_debut)}</td>
      <td style="white-space:nowrap">${formatHeure(s.date_debut)} – ${formatHeure(s.date_fin)}</td>
      <td>${escapeHtml(s.classe?.nom ?? '—')}</td>
      <td>${escapeHtml(s.matiere)}</td>
      ${parEns ? '' : `<td>${escapeHtml(s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : '—')}</td>`}
      <td style="text-align:center;font-weight:700">${Number(s.heures).toFixed(1)}h</td>
      <td style="text-align:center">${s.nb_presents}/${s.nb_total}</td>
      <td>${escapeHtml(s.mode ?? '—')}</td>
    </tr>`).join('')

  const renderTable = (rows: SeanceRow[], footTotal: number) => `
    <table class="em-table">
      <thead><tr>
        <th style="width:68px">Date</th>
        <th style="width:78px">Horaire</th>
        <th style="width:80px">Classe</th>
        <th>Matière</th>
        ${parEns ? '' : '<th style="width:140px">Enseignant</th>'}
        <th style="width:50px">Durée</th>
        <th style="width:58px">Présences</th>
        <th style="width:70px">Mode</th>
      </tr></thead>
      <tbody>${renderRows(rows)}</tbody>
      <tfoot><tr>
        <td colspan="${parEns ? 4 : 5}" style="text-align:right;font-weight:700">TOTAL</td>
        <td style="text-align:center;font-weight:900;color:#E30613">${footTotal.toFixed(1)}h</td>
        <td colspan="2"></td>
      </tr></tfoot>
    </table>`

  let body = ''
  if (parEns) {
    const grouped = new Map<string, SeanceRow[]>()
    for (const s of data) {
      const key = s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : '—'
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(s)
    }
    let first = true
    for (const [ensNom, rows] of grouped) {
      const hEns = rows.reduce((s, r) => s + Number(r.heures || 0), 0)
      body += `
        <div class="em-group ${first ? '' : 'em-pb'}">
          <div class="em-group-title">
            <span>${escapeHtml(ensNom)}</span>
            <span class="em-group-meta">${rows.length} séance${rows.length > 1 ? 's' : ''} · ${hEns.toFixed(1)}h</span>
          </div>
          ${renderTable(rows, hEns)}
        </div>`
      first = false
    }
  } else {
    body = renderTable(data, totalH)
  }

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <title>Suivi des émargements — ${escapeHtml(moisLabel.value)}</title>
  <style>
    ${uptechPrintCSS()}
    @page{size:A4 landscape;margin:8mm}
    .abs-sub{display:flex;justify-content:space-between;align-items:center;padding:4px 16px;background:#fafafa;border-bottom:1px solid #eee;font-size:9px;color:#666}
    .abs-sub .left{font-weight:600;color:#E30613;text-transform:uppercase;letter-spacing:1px}
    .em-meta{padding:6px 16px 4px;display:flex;gap:12px;font-size:10px;color:#333;align-items:center}
    .em-meta strong{color:#111}
    .em-meta .em-total{margin-left:auto;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:2px 10px;border-radius:999px;font-weight:700;font-size:10px}
    .em-table{width:calc(100% - 32px);margin:6px 16px 10px;border-collapse:collapse;font-size:9px}
    .em-table thead th{background:#E30613;color:#fff;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:5px 4px;font-size:8px;border:1px solid #b40510;text-align:left}
    .em-table tbody td{padding:4px 6px;border:1px solid #eee;vertical-align:top;line-height:1.4}
    .em-table tbody tr:nth-child(even) td{background:#fafafa}
    .em-table tbody tr{page-break-inside:avoid}
    .em-table tfoot td{padding:6px;background:#f3f4f6;font-size:9px;border:1px solid #e5e7eb}
    .em-group{margin-top:10px}
    .em-group.em-pb{page-break-before:always}
    .em-group-title{display:flex;align-items:baseline;justify-content:space-between;padding:6px 16px 2px;border-bottom:1px dashed #e5e7eb;font-size:11px;font-weight:700;color:#111}
    .em-group-meta{font-size:9px;font-weight:600;color:#E30613}
  </style></head>
  <body>
    ${uptechHeaderHTML()}
    <div class="abs-sub">
      <span class="left">Pédagogie — Suivi des émargements</span>
      <span>Émis le ${emitDate}</span>
    </div>
    <div class="em-meta">
      <span><strong>Période :</strong> ${escapeHtml(moisLabel.value)}</span>
      <span><strong>Séances :</strong> ${data.length}</span>
      <span class="em-total">Total : ${totalH.toFixed(1)}h</span>
    </div>
    ${body}
    ${uptechFooterHTML('Document pédagogique — émargements')}
  </body></html>`

  openPrintWindow(html)
}
</script>

<template>
  <div class="se-content">
    <UcPageHeader title="Suivi des Émargements" subtitle="Vue globale des cours effectués et émargés" />

    <!-- Sélecteur de mois + filtres + export -->
    <div class="se-mois-nav">
      <button @click="moisPrecedent" class="se-nav-btn">&larr;</button>
      <span class="se-mois-label">{{ moisLabel }}</span>
      <button @click="moisSuivant" class="se-nav-btn">&rarr;</button>
      <input type="month" v-model="moisSelected" class="se-month-input" />

      <select v-model="filterEnseignant" class="se-month-input" style="min-width:160px;">
        <option value="">Tous les enseignants</option>
        <option v-for="e in enseignantsUniques" :key="e.id" :value="e.nom">{{ e.nom }}</option>
      </select>
      <select v-model="filterClasse" class="se-month-input" style="min-width:130px;">
        <option value="">Toutes les classes</option>
        <option v-for="c in classesUniques" :key="c.id" :value="c.nom">{{ c.nom }}</option>
      </select>

      <div style="display:flex;gap:8px;margin-left:auto;">
        <button @click="exportPDF(false)" class="se-export-btn">⬇ PDF global</button>
        <button @click="exportPDF(true)"  class="se-export-btn se-export-btn--secondary">⬇ PDF par enseignant</button>
      </div>
    </div>

    <div v-if="loading" class="se-loading">Chargement...</div>

    <div v-else-if="loadError" style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:20px 24px;color:#dc2626;font-size:13px;">
      ⚠️ {{ loadError }}
    </div>

    <div v-else>
      <!-- KPIs -->
      <div class="se-kpis">
        <div class="se-kpi">
          <div class="se-kpi-value">{{ stats.total_seances }}</div>
          <div class="se-kpi-label">Séances effectuées</div>
        </div>
        <div class="se-kpi">
          <div class="se-kpi-value">{{ stats.total_heures ?? 0 }}h</div>
          <div class="se-kpi-label">Heures totales</div>
        </div>
        <div class="se-kpi">
          <div class="se-kpi-value">{{ stats.nb_enseignants }}</div>
          <div class="se-kpi-label">Enseignants actifs</div>
        </div>
        <div class="se-kpi">
          <div class="se-kpi-value">{{ stats.nb_classes }}</div>
          <div class="se-kpi-label">Classes</div>
        </div>
        <div class="se-kpi">
          <div class="se-kpi-value">{{ stats.nb_jours_actifs }}</div>
          <div class="se-kpi-label">Jours actifs</div>
        </div>
      </div>

      <!-- Onglets -->
      <div class="se-tabs">
        <button :class="['se-tab', tabActive === 'jour' && 'active']" @click="tabActive = 'jour'">Par jour</button>
        <button :class="['se-tab', tabActive === 'enseignant' && 'active']" @click="tabActive = 'enseignant'">Par enseignant</button>
        <button :class="['se-tab', tabActive === 'detail' && 'active']" @click="tabActive = 'detail'">Détail séances</button>
      </div>

      <!-- Tab: Par jour -->
      <div v-if="tabActive === 'jour'" class="se-table-wrap">
        <div v-if="parJour.length === 0" class="se-empty">Aucun émargement ce mois-ci.</div>
        <table v-else class="se-table">
          <thead>
            <tr>
              <th>Jour</th>
              <th style="text-align:center">Séances</th>
              <th style="text-align:center">Heures</th>
              <th style="text-align:center">Enseignants</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="j in parJour" :key="j.jour">
              <td><strong>{{ formatDate(j.jour) }}</strong></td>
              <td style="text-align:center">
                <span class="se-badge se-badge-blue">{{ j.nb_seances }}</span>
              </td>
              <td style="text-align:center">
                <span class="se-badge se-badge-green">{{ j.heures }}h</span>
              </td>
              <td style="text-align:center">{{ j.nb_enseignants }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td><strong>TOTAL</strong></td>
              <td style="text-align:center"><strong>{{ stats.total_seances }}</strong></td>
              <td style="text-align:center"><strong>{{ stats.total_heures }}h</strong></td>
              <td style="text-align:center"><strong>{{ stats.nb_enseignants }}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Tab: Par enseignant -->
      <div v-if="tabActive === 'enseignant'" class="se-table-wrap">
        <div v-if="parEnseignant.length === 0" class="se-empty">Aucun émargement ce mois-ci.</div>
        <table v-else class="se-table">
          <thead>
            <tr>
              <th>Enseignant</th>
              <th style="text-align:center">Séances</th>
              <th style="text-align:center">Heures</th>
              <th style="text-align:center">Classes</th>
              <th style="text-align:center">Jours</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in parEnseignant" :key="e.id">
              <td><strong>{{ e.prenom }} {{ e.nom }}</strong></td>
              <td style="text-align:center">
                <span class="se-badge se-badge-blue">{{ e.nb_seances }}</span>
              </td>
              <td style="text-align:center">
                <span class="se-badge se-badge-green">{{ e.heures_total }}h</span>
              </td>
              <td style="text-align:center">{{ e.nb_classes }}</td>
              <td style="text-align:center">{{ e.nb_jours }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td><strong>TOTAL ({{ parEnseignant.length }} enseignants)</strong></td>
              <td style="text-align:center"><strong>{{ stats.total_seances }}</strong></td>
              <td style="text-align:center"><strong>{{ stats.total_heures }}h</strong></td>
              <td style="text-align:center"><strong>{{ stats.nb_classes }}</strong></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Tab: Détail séances -->
      <div v-if="tabActive === 'detail'" class="se-table-wrap">
        <div v-if="seancesFiltrees.length === 0" class="se-empty">Aucune séance émargée correspondant aux filtres.</div>
        <table v-else class="se-table se-table-detail">
          <thead>
            <tr>
              <th>Date</th>
              <th>Horaire</th>
              <th>Classe</th>
              <th>Matière</th>
              <th>Enseignant</th>
              <th style="text-align:center">Durée</th>
              <th style="text-align:center">Présences</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in seancesFiltrees" :key="s.id">
              <td>{{ formatDate(s.date_debut) }}</td>
              <td>{{ formatHeure(s.date_debut) }} – {{ formatHeure(s.date_fin) }}</td>
              <td><span class="se-badge se-badge-gray">{{ s.classe?.nom ?? '—' }}</span></td>
              <td><strong>{{ s.matiere }}</strong></td>
              <td>{{ s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : '—' }}</td>
              <td style="text-align:center">
                <span class="se-badge se-badge-green">{{ Number(s.heures).toFixed(1) }}h</span>
              </td>
              <td style="text-align:center">
                <span :class="['se-badge', s.nb_presents === s.nb_total ? 'se-badge-green' : 'se-badge-orange']">
                  {{ s.nb_presents }}/{{ s.nb_total }}
                </span>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5"><strong>TOTAL ({{ seancesFiltrees.length }} séances)</strong></td>
              <td style="text-align:center">
                <strong>{{ seancesFiltrees.reduce((s, r) => s + Number(r.heures || 0), 0).toFixed(1) }}h</strong>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.se-content { padding: 24px; max-width: 1280px; margin: 0 auto; font-family: 'Poppins', sans-serif; }

/* Navigation mois */
.se-mois-nav { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.se-nav-btn { width: 36px; height: 36px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
.se-nav-btn:hover { background: #f1f5f9; border-color: #cbd5e1; }
.se-mois-label { font-size: 18px; font-weight: 700; color: #1e293b; min-width: 200px; text-align: center; }
.se-month-input { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; font-size: 13px; color: #64748b; font-family: 'Poppins', sans-serif; }

/* KPIs */
.se-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
.se-kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; text-align: center; }
.se-kpi-value { font-size: 28px; font-weight: 800; color: #1e293b; }
.se-kpi-label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

/* Onglets */
.se-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; }
.se-tab { padding: 10px 20px; border: none; background: none; font-family: 'Poppins', sans-serif; font-size: 13px; font-weight: 600; color: #94a3b8; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.15s; }
.se-tab:hover { color: #475569; }
.se-tab.active { color: #E30613; border-bottom-color: #E30613; }

/* Table */
.se-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.se-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.se-table th { background: #f8fafc; padding: 10px 14px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #e2e8f0; }
.se-table td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; color: #334155; }
.se-table tbody tr:hover { background: #f8fafc; }
.se-table tfoot td { background: #f8fafc; border-top: 2px solid #e2e8f0; font-size: 12px; }
.se-table-detail { font-size: 12px; }
.se-table-detail td { padding: 8px 10px; }

/* Badges */
.se-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
.se-badge-blue { background: #eff6ff; color: #1d4ed8; }
.se-badge-green { background: #f0fdf4; color: #15803d; }
.se-badge-orange { background: #fff7ed; color: #c2410c; }
.se-badge-gray { background: #f1f5f9; color: #475569; }

.se-loading { text-align: center; padding: 60px; color: #94a3b8; font-size: 13px; }
.se-empty { text-align: center; padding: 40px; color: #94a3b8; font-size: 13px; }

/* Boutons export */
.se-export-btn {
  padding: 7px 14px; border-radius: 8px; border: 1.5px solid #1e293b;
  background: #1e293b; color: #fff; font-family: 'Poppins', sans-serif;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s; white-space: nowrap;
}
.se-export-btn:hover { background: #0f172a; }
.se-export-btn--secondary { background: #fff; color: #1e293b; }
.se-export-btn--secondary:hover { background: #f1f5f9; }
</style>
