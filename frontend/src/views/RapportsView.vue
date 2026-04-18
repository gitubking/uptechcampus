<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import * as XLSX from 'xlsx'

const auth = useAuthStore()

type Tab = 'financier' | 'pedagogique' | 'rh' | 'etudiants' | 'resultats'
const activeTab    = ref<Tab>('financier')
const loading      = ref(true)
const loadingRes   = ref(false)
const annees       = ref<{ id: number; libelle: string; actif: boolean }[]>([])
const selectedAnneeId = ref<number | null>(null)

interface RapportData {
  annee: { id: number; libelle: string } | null
  financier: {
    encaisse_annee: number; depenses_annee: number; solde: number
    taux_recouvrement: number; attendu: number
    evolution_6_mois: { mois: string; recettes: number; depenses: number }[]
  }
  pedagogique: {
    nb_seances: number; nb_seances_realisees: number; taux_presence: number
    nb_ues: number; nb_etudiants_notes: number
  }
  rh: {
    enseignants_actifs: number; intervenants_actifs: number
    volume_horaire: number
    repartition_mode: Record<string, number>
  }
  etudiants: {
    par_filiere: { nom: string; count: number; pct: number }[]
    par_statut: { statut: string; total: number }[]
    evolution_inscriptions: { mois: string; count: number }[]
  }
}

interface ResultatsData {
  annee: { id: number; libelle: string } | null
  par_filiere: {
    filiere: string; session: string; total: number
    admis: number; rattrapage: number; redoublant: number; exclus: number
    taux_reussite: number
  }[]
  evol_moyennes: { filiere: string; session: string; moyenne: number }[]
  global: { total_decisions: number; total_jurys: number; total_admis: number; taux_global: number }
  top_etudiants: {
    etudiant: string; numero_etudiant: string; filiere: string
    session: string; decision: string; moyenne: number
  }[]
}

const data      = ref<RapportData | null>(null)
const resultats = ref<ResultatsData | null>(null)

interface DemographicsData {
  total: number
  total_inscriptions?: number
  sexe: { masculin: number; feminin: number; non_renseigne: number }
  handicap: {
    handicape: number
    valides: number
    par_type: { type_handicap: string; nb: number }[]
  }
  statut_professionnel?: {
    salarie: number; independant: number; sans_emploi: number
    etudiant: number; autre: number; non_renseigne: number
  }
  regime_formation?: { initiale: number; continue: number; non_renseigne: number }
}
const demographics = ref<DemographicsData | null>(null)

// ── Formatters ───────────────────────────────────────────────────────────────
function fmtPDF(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA'
}
function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n)
}
function pct(n: number) { return `${n}%` }
function barHeight(val: number, max: number, maxH = 80) {
  return max > 0 ? (val / max) * maxH : 0
}

const modeColors: Record<string, string> = {
  presentiel: '#22c55e', en_ligne: '#3b82f6', hybride: '#f97316', exam: '#ef4444',
}
const modeLabels: Record<string, string> = {
  presentiel: 'Présentiel', en_ligne: 'En ligne', hybride: 'Hybride', exam: 'Examen',
}
const statutLabels: Record<string, string> = {
  inscrit_actif: 'Inscrit actif', inscrit: 'Inscrit', pre_inscrit: 'Pré-inscrit',
  en_examen: 'En examen', abandonne: 'Abandonné', diplome: 'Diplômé',
}
const sessionLabel: Record<string, string> = {
  normale: 'Normale', rattrapage: 'Rattrapage', speciale: 'Spéciale',
}

function tauxColor(t: number) {
  if (t >= 75) return '#15803d'
  if (t >= 50) return '#d97706'
  return '#dc2626'
}
function tauxBg(t: number) {
  if (t >= 75) return '#f0fdf4'
  if (t >= 50) return '#fef3c7'
  return '#fef2f2'
}

// ── Chargement ────────────────────────────────────────────────────────────────
async function loadAnnees() {
  try {
    const { data: rows } = await api.get('/annees-academiques')
    annees.value = rows
    const active = rows.find((a: any) => a.actif)
    selectedAnneeId.value = active?.id ?? rows[0]?.id ?? null
  } catch { /* ignore */ }
}

async function load() {
  loading.value = true
  resultats.value = null
  try {
    const params = selectedAnneeId.value ? `?annee_id=${selectedAnneeId.value}` : ''
    const { data: d } = await api.get(`/rapports${params}`)
    data.value = d
  } finally { loading.value = false }
}

async function loadDemographics() {
  try {
    const { data: d } = await api.get('/stats/etudiants/demographics')
    demographics.value = d
  } catch { /* silent : feature optionnelle */ }
}

async function loadResultats() {
  loadingRes.value = true
  try {
    const params = selectedAnneeId.value ? `?annee_id=${selectedAnneeId.value}` : ''
    const { data: d } = await api.get(`/rapports/resultats${params}`)
    resultats.value = d
  } finally { loadingRes.value = false }
}

function switchTab(tab: Tab) {
  activeTab.value = tab
  if (tab === 'resultats' && !resultats.value) loadResultats()
}

// Quand l'année change → recharger
watch(selectedAnneeId, () => {
  resultats.value = null
  load()
  if (activeTab.value === 'resultats') loadResultats()
})

onMounted(async () => {
  await loadAnnees()
  await load()
  loadDemographics()
})

// ── Export Excel (Résultats) ──────────────────────────────────────────────────
function exportExcel() {
  if (!resultats.value) return
  const wb = XLSX.utils.book_new()
  const libelle = resultats.value.annee?.libelle ?? 'resultats'

  const ws1 = XLSX.utils.aoa_to_sheet([
    ['Filière', 'Session', 'Total délibérés', 'Admis', 'Rattrapage', 'Redoublants', 'Exclus', 'Taux réussite (%)'],
    ...resultats.value.par_filiere.map(r => [
      r.filiere, sessionLabel[r.session] ?? r.session,
      r.total, r.admis, r.rattrapage, r.redoublant, r.exclus, r.taux_reussite,
    ]),
  ])
  ws1['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws1, 'Résultats par filière')

  const ws2 = XLSX.utils.aoa_to_sheet([
    ['Filière', 'Session', 'Moyenne générale /20'],
    ...resultats.value.evol_moyennes.map(r => [r.filiere, sessionLabel[r.session] ?? r.session, r.moyenne]),
  ])
  ws2['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 22 }]
  XLSX.utils.book_append_sheet(wb, ws2, 'Moyennes')

  const ws3 = XLSX.utils.aoa_to_sheet([
    ['#', 'Étudiant', 'N° Étudiant', 'Filière', 'Session', 'Moyenne /20'],
    ...resultats.value.top_etudiants.map((r, i) => [
      i + 1, r.etudiant, r.numero_etudiant ?? '', r.filiere,
      sessionLabel[r.session] ?? r.session, r.moyenne,
    ]),
  ])
  ws3['!cols'] = [{ wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wb, ws3, 'Top étudiants')

  XLSX.writeFile(wb, `resultats_${libelle.replace(/\s+/g, '_')}.xlsx`)
}

// ── Export CSV (autres onglets) ────────────────────────────────────────────────
function exportCSV() {
  if (!data.value) return
  const tab = activeTab.value
  let rows: string[][] = []
  let filename = 'rapport.csv'
  const libelle = data.value.annee?.libelle ?? 'rapport'

  if (tab === 'financier') {
    filename = `financier_${libelle}.csv`
    rows = [
      ['Indicateur', 'Valeur'],
      ['Encaissé', fmtPDF(data.value.financier.encaisse_annee)],
      ['Dépenses', fmtPDF(data.value.financier.depenses_annee)],
      ['Solde', fmtPDF(data.value.financier.solde)],
      ['Montant attendu (écheances)', fmtPDF(data.value.financier.attendu)],
      ['Taux recouvrement', pct(data.value.financier.taux_recouvrement)],
      [],
      ['Mois', 'Recettes', 'Dépenses'],
      ...data.value.financier.evolution_6_mois.map(m => [m.mois, String(m.recettes), String(m.depenses)]),
    ]
  } else if (tab === 'pedagogique') {
    filename = `pedagogique_${libelle}.csv`
    rows = [
      ['Indicateur', 'Valeur'],
      ['Séances planifiées', String(data.value.pedagogique.nb_seances)],
      ['Séances réalisées', String(data.value.pedagogique.nb_seances_realisees)],
      ['Taux de présence', pct(data.value.pedagogique.taux_presence)],
      ['Unités d\'enseignement', String(data.value.pedagogique.nb_ues)],
      ['Étudiants notés', String(data.value.pedagogique.nb_etudiants_notes)],
    ]
  } else if (tab === 'rh') {
    filename = `rh_${libelle}.csv`
    rows = [
      ['Indicateur', 'Valeur'],
      ['Enseignants actifs', String(data.value.rh.enseignants_actifs)],
      ['Intervenants (ont enseigné)', String(data.value.rh.intervenants_actifs)],
      ['Volume horaire effectué', `${data.value.rh.volume_horaire}h`],
      [],
      ['Mode', 'Pourcentage'],
      ...Object.entries(data.value.rh.repartition_mode).map(([k, v]) => [modeLabels[k] ?? k, pct(v)]),
    ]
  } else {
    filename = `etudiants_${libelle}.csv`
    rows = [
      ['Filière', 'Nombre', 'Pourcentage'],
      ...data.value.etudiants.par_filiere.map(f => [f.nom, String(f.count), pct(f.pct)]),
      [],
      ['Statut', 'Nombre'],
      ...(data.value.etudiants.par_statut as any[]).map((s: any) => [statutLabels[s.statut] ?? s.statut, String(s.total)]),
    ]
  }

  const csv = rows.map(r => r.join(';')).join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="uc-content">

    <!-- ── En-tête ── -->
    <div class="rp-topbar">
      <div>
        <h1 class="rp-title">Rapports & Statistiques</h1>
        <p class="rp-subtitle">
          Synthèse analytique
          <span v-if="data?.annee" class="rp-annee-badge">{{ data.annee.libelle }}</span>
        </p>
      </div>
      <div class="rp-topbar-right">
        <a href="/rapports-ministere" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#E30613;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">
          🏛️ Rapports ministériels
        </a>
        <!-- Sélecteur d'année -->
        <select v-if="annees.length" v-model="selectedAnneeId" class="rp-year-select">
          <option v-for="a in annees" :key="a.id" :value="a.id">
            {{ a.libelle }}{{ a.actif ? ' ✓' : '' }}
          </option>
        </select>
        <!-- Export -->
        <button v-if="activeTab === 'resultats' && resultats" @click="exportExcel" class="rp-btn-export rp-btn-excel">
          📊 Excel
        </button>
        <button v-else-if="activeTab !== 'resultats' && data" @click="exportCSV" class="rp-btn-export">
          ⬇ CSV
        </button>
      </div>
    </div>

    <!-- ── Tabs ── -->
    <div class="rp-tabs">
      <button v-for="tab in (['financier','pedagogique','rh','etudiants','resultats'] as Tab[])" :key="tab"
        @click="switchTab(tab)"
        class="rp-tab" :class="activeTab === tab ? 'rp-tab--active' : ''">
        {{ tab === 'financier'   ? '💰 Financier'
         : tab === 'pedagogique' ? '📚 Pédagogique'
         : tab === 'rh'         ? '👥 RH'
         : tab === 'etudiants'  ? '🎓 Étudiants'
         :                        '🏆 Résultats' }}
      </button>
    </div>

    <!-- ── Chargement général ── -->
    <div v-if="loading && activeTab !== 'resultats'" class="rp-loading">Chargement…</div>
    <div v-else-if="!data && activeTab !== 'resultats'" class="rp-err">Erreur de chargement.</div>
    <div v-else>

      <!-- ════ FINANCIER ════ -->
      <div v-if="activeTab === 'financier' && data" class="rp-tab-content">
        <div class="uc-kpi-grid">
          <div class="uc-kpi-card green">
            <div class="uc-kpi-icon">💰</div>
            <div class="uc-kpi-label">Encaissé</div>
            <div class="uc-kpi-value">{{ fmt(data.financier.encaisse_annee) }}</div>
          </div>
          <div class="uc-kpi-card red">
            <div class="uc-kpi-icon">📉</div>
            <div class="uc-kpi-label">Dépenses</div>
            <div class="uc-kpi-value">{{ fmt(data.financier.depenses_annee) }}</div>
          </div>
          <div class="uc-kpi-card" :class="data.financier.solde < 0 ? 'red' : 'blue'">
            <div class="uc-kpi-icon">⚖</div>
            <div class="uc-kpi-label">Solde net</div>
            <div class="uc-kpi-value">{{ fmt(data.financier.solde) }}</div>
          </div>
          <div class="uc-kpi-card orange">
            <div class="uc-kpi-icon">📊</div>
            <div class="uc-kpi-label">Taux recouvrement</div>
            <div class="uc-kpi-value">{{ pct(data.financier.taux_recouvrement) }}</div>
            <div v-if="data.financier.attendu" style="font-size:10px;color:#888;margin-top:4px;">
              sur {{ fmt(data.financier.attendu) }} attendu
            </div>
          </div>
        </div>

        <!-- Barre recouvrement -->
        <div class="rp-card">
          <h3 class="rp-card-title">Recouvrement des créances</h3>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
            <div style="flex:1;background:#f0f0f0;border-radius:20px;height:18px;overflow:hidden;">
              <div style="height:100%;border-radius:20px;transition:width 0.4s;"
                :style="{ width: `${Math.min(data.financier.taux_recouvrement,100)}%`,
                          background: data.financier.taux_recouvrement >= 75 ? '#22c55e' : data.financier.taux_recouvrement >= 50 ? '#f59e0b' : '#ef4444' }">
              </div>
            </div>
            <span style="font-size:16px;font-weight:800;min-width:48px;text-align:right;"
              :style="{ color: tauxColor(data.financier.taux_recouvrement) }">
              {{ data.financier.taux_recouvrement }}%
            </span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;">
            <span>{{ fmt(data.financier.encaisse_annee) }} encaissé</span>
            <span>{{ fmt(data.financier.attendu) }} attendu</span>
          </div>
        </div>

        <!-- Évolution mensuelle -->
        <div class="rp-card">
          <h3 class="rp-card-title">Évolution mensuelle</h3>
          <div v-if="!data.financier.evolution_6_mois.length" class="rp-empty">Aucune donnée sur la période.</div>
          <template v-else>
            <div class="rp-bar-chart">
              <div v-for="m in data.financier.evolution_6_mois" :key="m.mois" class="rp-bar-group">
                <div class="rp-bar-pair">
                  <div class="rp-bar" style="background:#22c55e;width:14px;"
                    :style="{ height: `${barHeight(m.recettes, Math.max(...data.financier.evolution_6_mois.map(x => Math.max(x.recettes, x.depenses)), 1))}px` }"
                    :title="`Recettes: ${fmt(m.recettes)}`"></div>
                  <div class="rp-bar" style="background:#fca5a5;width:14px;"
                    :style="{ height: `${barHeight(m.depenses, Math.max(...data.financier.evolution_6_mois.map(x => Math.max(x.recettes, x.depenses)), 1))}px` }"
                    :title="`Dépenses: ${fmt(m.depenses)}`"></div>
                </div>
                <p class="rp-bar-label">{{ m.mois }}</p>
              </div>
            </div>
            <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;">
              <span class="rp-legend"><span style="background:#22c55e;"></span> Recettes</span>
              <span class="rp-legend"><span style="background:#fca5a5;"></span> Dépenses</span>
            </div>
          </template>
        </div>
      </div>

      <!-- ════ PÉDAGOGIQUE ════ -->
      <div v-else-if="activeTab === 'pedagogique' && data" class="rp-tab-content">
        <div class="uc-kpi-grid rp-kpi-5">
          <div class="uc-kpi-card blue">
            <div class="uc-kpi-label">Séances planifiées</div>
            <div class="uc-kpi-value rp-kpi-big">{{ data.pedagogique.nb_seances }}</div>
          </div>
          <div class="uc-kpi-card green">
            <div class="uc-kpi-label">Séances réalisées</div>
            <div class="uc-kpi-value rp-kpi-big">{{ data.pedagogique.nb_seances_realisees }}</div>
          </div>
          <div class="uc-kpi-card orange">
            <div class="uc-kpi-label">Taux présence</div>
            <div class="uc-kpi-value rp-kpi-big">{{ pct(data.pedagogique.taux_presence) }}</div>
          </div>
          <div class="uc-kpi-card blue">
            <div class="uc-kpi-label">Unités d'ens.</div>
            <div class="uc-kpi-value rp-kpi-big">{{ data.pedagogique.nb_ues }}</div>
          </div>
          <div class="uc-kpi-card purple">
            <div class="uc-kpi-label">Étudiants notés</div>
            <div class="uc-kpi-value rp-kpi-big">{{ data.pedagogique.nb_etudiants_notes }}</div>
          </div>
        </div>

        <div class="rp-card">
          <h3 class="rp-card-title">Taux de réalisation des séances</h3>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="flex:1;background:#f0f0f0;border-radius:20px;height:16px;overflow:hidden;">
              <div style="height:100%;background:#22c55e;border-radius:20px;transition:width 0.3s;"
                :style="{ width: `${data.pedagogique.nb_seances > 0 ? Math.round(data.pedagogique.nb_seances_realisees / data.pedagogique.nb_seances * 100) : 0}%` }"></div>
            </div>
            <span style="font-size:15px;font-weight:800;color:#333;min-width:44px;text-align:right;">
              {{ data.pedagogique.nb_seances > 0 ? Math.round(data.pedagogique.nb_seances_realisees / data.pedagogique.nb_seances * 100) : 0 }}%
            </span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-top:6px;">
            <span>{{ data.pedagogique.nb_seances_realisees }} réalisées</span>
            <span>{{ data.pedagogique.nb_seances - data.pedagogique.nb_seances_realisees }} restantes</span>
            <span>{{ data.pedagogique.nb_seances }} planifiées</span>
          </div>
        </div>

        <div class="rp-card">
          <h3 class="rp-card-title">Taux de présence des étudiants</h3>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="flex:1;background:#f0f0f0;border-radius:20px;height:16px;overflow:hidden;">
              <div style="height:100%;border-radius:20px;transition:width 0.3s;"
                :style="{ width: `${data.pedagogique.taux_presence}%`,
                          background: data.pedagogique.taux_presence >= 75 ? '#22c55e' : data.pedagogique.taux_presence >= 50 ? '#f59e0b' : '#ef4444' }"></div>
            </div>
            <span style="font-size:15px;font-weight:800;min-width:44px;text-align:right;"
              :style="{ color: tauxColor(data.pedagogique.taux_presence) }">
              {{ data.pedagogique.taux_presence }}%
            </span>
          </div>
          <p v-if="data.pedagogique.taux_presence === 0" style="font-size:11px;color:#aaa;margin-top:6px;">Aucune présence enregistrée pour l'instant.</p>
        </div>
      </div>

      <!-- ════ RH ════ -->
      <div v-else-if="activeTab === 'rh' && data" class="rp-tab-content">
        <div class="uc-kpi-grid" style="grid-template-columns:repeat(3,1fr);">
          <div class="uc-kpi-card blue">
            <div class="uc-kpi-icon">👨‍🏫</div>
            <div class="uc-kpi-label">Enseignants actifs</div>
            <div class="uc-kpi-value">{{ data.rh.enseignants_actifs }}</div>
          </div>
          <div class="uc-kpi-card purple">
            <div class="uc-kpi-icon">🎤</div>
            <div class="uc-kpi-label">Intervenants (ont enseigné)</div>
            <div class="uc-kpi-value">{{ data.rh.intervenants_actifs }}</div>
          </div>
          <div class="uc-kpi-card orange">
            <div class="uc-kpi-icon">⏱</div>
            <div class="uc-kpi-label">Volume horaire effectué</div>
            <div class="uc-kpi-value">{{ data.rh.volume_horaire }}h</div>
          </div>
        </div>
        <div class="rp-card">
          <h3 class="rp-card-title">Répartition par mode d'enseignement</h3>
          <div v-if="!Object.keys(data.rh.repartition_mode).length" class="rp-empty">
            Aucune séance enregistrée pour cette année.
          </div>
          <div v-else style="display:flex;flex-direction:column;gap:10px;">
            <div v-for="(pctVal, mode) in data.rh.repartition_mode" :key="mode" style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:12px;color:#555;min-width:110px;flex-shrink:0;">{{ modeLabels[mode] ?? mode }}</span>
              <div style="flex:1;background:#f0f0f0;border-radius:20px;height:10px;overflow:hidden;">
                <div style="height:100%;border-radius:20px;transition:width 0.3s;"
                  :style="{ width: `${pctVal}%`, backgroundColor: modeColors[mode] ?? '#94a3b8' }"></div>
              </div>
              <span style="font-size:12px;font-weight:700;color:#333;min-width:36px;text-align:right;">{{ pctVal }}%</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ════ ÉTUDIANTS ════ -->
      <div v-else-if="activeTab === 'etudiants' && data" class="rp-tab-content">
        <div class="rp-grid-2">
          <div class="rp-card">
            <h3 class="rp-card-title">Répartition par filière</h3>
            <div v-if="!data.etudiants.par_filiere.length" class="rp-empty">Aucune inscription cette année.</div>
            <div v-else style="display:flex;flex-direction:column;gap:10px;">
              <div v-for="f in data.etudiants.par_filiere" :key="f.nom" style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:12px;color:#555;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" :title="f.nom">{{ f.nom }}</span>
                <div style="width:90px;background:#f0f0f0;border-radius:20px;height:8px;overflow:hidden;flex-shrink:0;">
                  <div style="height:100%;background:#E30613;border-radius:20px;" :style="{ width: `${f.pct}%` }"></div>
                </div>
                <span style="font-size:11px;font-weight:700;color:#333;min-width:64px;text-align:right;">{{ f.count }} ({{ f.pct }}%)</span>
              </div>
            </div>
          </div>
          <div class="rp-card">
            <h3 class="rp-card-title">Répartition par statut</h3>
            <div v-if="!data.etudiants.par_statut.length" class="rp-empty">Aucune donnée.</div>
            <div v-else style="display:flex;flex-direction:column;">
              <div v-for="s in data.etudiants.par_statut" :key="(s as any).statut"
                style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f4f4f4;">
                <span style="font-size:13px;color:#555;">{{ statutLabels[(s as any).statut] ?? (s as any).statut }}</span>
                <span style="font-size:14px;font-weight:800;color:#111;">{{ (s as any).total }}</span>
              </div>
            </div>
          </div>
        </div>
        <!-- Démographie : sexe + handicap -->
        <div v-if="demographics && demographics.total > 0" class="rp-grid-2">
          <div class="rp-card">
            <h3 class="rp-card-title">Répartition par sexe</h3>
            <p style="font-size:11px;color:#888;margin:-4px 0 12px;">
              Sur {{ demographics.total }} étudiant(s) actif(s) ou pré-inscrit(s)
            </p>
            <div style="display:flex;flex-direction:column;gap:14px;">
              <div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                  <span style="color:#1e40af;font-weight:600;">♂ Masculin</span>
                  <span style="font-weight:700;">{{ demographics.sexe.masculin }} ({{ demographics.total ? Math.round(demographics.sexe.masculin / demographics.total * 100) : 0 }}%)</span>
                </div>
                <div style="height:8px;background:#f0f0f0;border-radius:20px;overflow:hidden;">
                  <div style="height:100%;background:#3b82f6;border-radius:20px;"
                    :style="{ width: `${demographics.total ? (demographics.sexe.masculin / demographics.total * 100) : 0}%` }"></div>
                </div>
              </div>
              <div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                  <span style="color:#9d174d;font-weight:600;">♀ Féminin</span>
                  <span style="font-weight:700;">{{ demographics.sexe.feminin }} ({{ demographics.total ? Math.round(demographics.sexe.feminin / demographics.total * 100) : 0 }}%)</span>
                </div>
                <div style="height:8px;background:#f0f0f0;border-radius:20px;overflow:hidden;">
                  <div style="height:100%;background:#ec4899;border-radius:20px;"
                    :style="{ width: `${demographics.total ? (demographics.sexe.feminin / demographics.total * 100) : 0}%` }"></div>
                </div>
              </div>
              <div v-if="demographics.sexe.non_renseigne > 0">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                  <span style="color:#6b7280;">Non renseigné</span>
                  <span style="font-weight:700;color:#6b7280;">{{ demographics.sexe.non_renseigne }}</span>
                </div>
                <div style="height:8px;background:#f0f0f0;border-radius:20px;overflow:hidden;">
                  <div style="height:100%;background:#9ca3af;border-radius:20px;"
                    :style="{ width: `${demographics.total ? (demographics.sexe.non_renseigne / demographics.total * 100) : 0}%` }"></div>
                </div>
              </div>
            </div>
          </div>
          <div class="rp-card">
            <h3 class="rp-card-title">Inclusion — situation de handicap</h3>
            <div style="display:flex;align-items:center;gap:18px;margin-top:10px;">
              <div style="flex-shrink:0;width:90px;height:90px;border-radius:50%;background:#fef3c7;color:#78350f;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;">
                {{ demographics.handicap.handicape }}
              </div>
              <div style="flex:1;min-width:0;">
                <p style="font-size:13px;font-weight:600;color:#78350f;margin:0 0 4px;">
                  ♿ Personnes en situation de handicap
                </p>
                <p style="font-size:11px;color:#888;margin:0 0 8px;">
                  Soit {{ demographics.total ? Math.round(demographics.handicap.handicape / demographics.total * 100) : 0 }}% de l'effectif actif.
                </p>
                <div v-if="demographics.handicap.par_type.length" style="display:flex;flex-direction:column;gap:4px;">
                  <div v-for="t in demographics.handicap.par_type" :key="t.type_handicap"
                    style="display:flex;justify-content:space-between;font-size:12px;padding:4px 8px;background:#fffbeb;border-radius:4px;">
                    <span>{{ t.type_handicap }}</span>
                    <span style="font-weight:700;">{{ t.nb }}</span>
                  </div>
                </div>
                <p v-else-if="demographics.handicap.handicape === 0" style="font-size:11px;color:#aaa;margin:0;">
                  Aucun étudiant déclaré pour le moment.
                </p>
              </div>
            </div>
          </div>
        </div>
        <!-- Statut professionnel + régime de formation -->
        <div v-if="demographics && demographics.total > 0" class="rp-grid-2">
          <div class="rp-card">
            <h3 class="rp-card-title">Statut professionnel</h3>
            <p style="font-size:11px;color:#888;margin:-4px 0 12px;">
              Sur {{ demographics.total }} étudiant(s) actif(s) ou pré-inscrit(s)
            </p>
            <div v-if="demographics.statut_professionnel" style="display:flex;flex-direction:column;gap:10px;">
              <div v-for="row in [
                { key: 'salarie',     label: '💼 Salarié·e',                color: '#16a34a' },
                { key: 'independant', label: '🧑‍💻 Indépendant·e',          color: '#7c3aed' },
                { key: 'sans_emploi', label: '🔍 Sans emploi',              color: '#dc2626' },
                { key: 'etudiant',    label: '🎓 Étudiant·e temps plein',   color: '#3b82f6' },
                { key: 'autre',       label: 'Autre',                        color: '#64748b' },
                { key: 'non_renseigne', label: 'Non renseigné',              color: '#9ca3af' },
              ]" :key="row.key" v-show="(demographics.statut_professionnel as any)[row.key] > 0 || row.key === 'salarie' || row.key === 'sans_emploi'">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                  <span :style="{ color: row.color, fontWeight: 600 }">{{ row.label }}</span>
                  <span style="font-weight:700;">
                    {{ (demographics.statut_professionnel as any)[row.key] }}
                    ({{ demographics.total ? Math.round((demographics.statut_professionnel as any)[row.key] / demographics.total * 100) : 0 }}%)
                  </span>
                </div>
                <div style="height:8px;background:#f0f0f0;border-radius:20px;overflow:hidden;">
                  <div style="height:100%;border-radius:20px;"
                    :style="{ width: `${demographics.total ? ((demographics.statut_professionnel as any)[row.key] / demographics.total * 100) : 0}%`, background: row.color }"></div>
                </div>
              </div>
            </div>
            <div v-else class="rp-empty">Donnée non disponible.</div>
          </div>
          <div class="rp-card">
            <h3 class="rp-card-title">Régime de formation</h3>
            <p style="font-size:11px;color:#888;margin:-4px 0 12px;">
              Sur {{ demographics.total_inscriptions ?? 0 }} inscription(s) active(s) ou pré-inscrite(s)
            </p>
            <div v-if="demographics.regime_formation" style="display:flex;align-items:stretch;gap:14px;">
              <div style="flex:1;background:#e0f2fe;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:11px;font-weight:600;color:#075985;margin-bottom:6px;">🎓 Formation initiale</div>
                <div style="font-size:30px;font-weight:800;color:#0c4a6e;">{{ demographics.regime_formation.initiale }}</div>
                <div style="font-size:11px;color:#0369a1;margin-top:4px;">
                  {{ demographics.total_inscriptions ? Math.round(demographics.regime_formation.initiale / demographics.total_inscriptions * 100) : 0 }}%
                </div>
              </div>
              <div style="flex:1;background:#fef3c7;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:11px;font-weight:600;color:#854d0e;margin-bottom:6px;">🔄 Formation continue</div>
                <div style="font-size:30px;font-weight:800;color:#713f12;">{{ demographics.regime_formation.continue }}</div>
                <div style="font-size:11px;color:#a16207;margin-top:4px;">
                  {{ demographics.total_inscriptions ? Math.round(demographics.regime_formation.continue / demographics.total_inscriptions * 100) : 0 }}%
                </div>
              </div>
              <div v-if="demographics.regime_formation.non_renseigne > 0"
                style="flex:1;background:#f3f4f6;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:11px;font-weight:600;color:#4b5563;margin-bottom:6px;">Non renseigné</div>
                <div style="font-size:30px;font-weight:800;color:#374151;">{{ demographics.regime_formation.non_renseigne }}</div>
                <div style="font-size:11px;color:#6b7280;margin-top:4px;">
                  {{ demographics.total_inscriptions ? Math.round(demographics.regime_formation.non_renseigne / demographics.total_inscriptions * 100) : 0 }}%
                </div>
              </div>
            </div>
            <div v-else class="rp-empty">Donnée non disponible.</div>
          </div>
        </div>
        <div class="rp-card">
          <h3 class="rp-card-title">Évolution des inscriptions</h3>
          <div v-if="!data.etudiants.evolution_inscriptions.some(m => m.count > 0)" class="rp-empty">Aucune inscription sur la période.</div>
          <div v-else class="rp-bar-chart">
            <div v-for="m in data.etudiants.evolution_inscriptions" :key="m.mois" class="rp-bar-group">
              <span style="font-size:10px;font-weight:700;color:#E30613;display:block;text-align:center;margin-bottom:2px;">{{ m.count || '' }}</span>
              <div class="rp-bar" style="background:#E30613;width:24px;"
                :style="{ height: `${barHeight(m.count, Math.max(...data.etudiants.evolution_inscriptions.map(x => x.count), 1), 64)}px`, minHeight: m.count > 0 ? '4px' : '0' }"></div>
              <p class="rp-bar-label">{{ m.mois }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- ════ RÉSULTATS ACADÉMIQUES ════ -->
      <div v-else-if="activeTab === 'resultats'">
        <div v-if="loadingRes" class="rp-loading">Chargement des résultats…</div>
        <div v-else-if="!resultats" class="rp-err">Erreur de chargement.</div>
        <div v-else class="rp-tab-content">

          <!-- KPIs -->
          <div class="uc-kpi-grid">
            <div class="uc-kpi-card blue">
              <div class="uc-kpi-icon">⚖</div>
              <div class="uc-kpi-label">Jurys clôturés</div>
              <div class="uc-kpi-value" style="font-size:28px;">{{ resultats.global.total_jurys }}</div>
            </div>
            <div class="uc-kpi-card orange">
              <div class="uc-kpi-icon">🎓</div>
              <div class="uc-kpi-label">Étudiants délibérés</div>
              <div class="uc-kpi-value" style="font-size:28px;">{{ resultats.global.total_decisions }}</div>
            </div>
            <div class="uc-kpi-card green">
              <div class="uc-kpi-icon">✅</div>
              <div class="uc-kpi-label">Admis</div>
              <div class="uc-kpi-value" style="font-size:28px;">{{ resultats.global.total_admis }}</div>
            </div>
            <div class="uc-kpi-card"
              :class="resultats.global.taux_global >= 75 ? 'green' : resultats.global.taux_global >= 50 ? 'orange' : 'red'">
              <div class="uc-kpi-icon">📈</div>
              <div class="uc-kpi-label">Taux réussite global</div>
              <div class="uc-kpi-value" style="font-size:28px;">{{ resultats.global.taux_global }}%</div>
            </div>
          </div>

          <!-- Aucun jury -->
          <div v-if="!resultats.par_filiere.length" class="rp-card rp-empty-card">
            <div style="font-size:40px;margin-bottom:12px;">📋</div>
            <p style="font-size:14px;font-weight:600;color:#555;margin:0 0 6px;">Aucun jury clôturé</p>
            <p style="font-size:12px;color:#aaa;margin:0;">Les résultats apparaîtront ici une fois les jurys de délibération clôturés.</p>
          </div>

          <template v-else>
            <!-- Tableau résultats par filière -->
            <div class="rp-card">
              <h3 class="rp-card-title">Résultats par filière et session</h3>
              <div style="overflow-x:auto;">
                <table class="uc-table" style="min-width:680px;">
                  <thead>
                    <tr>
                      <th>Filière</th>
                      <th>Session</th>
                      <th style="text-align:center;">Total</th>
                      <th style="text-align:center;color:#15803d;">Admis</th>
                      <th style="text-align:center;color:#d97706;">Rattrapage</th>
                      <th style="text-align:center;color:#dc2626;">Redoublants</th>
                      <th style="text-align:center;color:#7c3aed;">Exclus</th>
                      <th style="text-align:center;">Taux réussite</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="r in resultats.par_filiere" :key="r.filiere + r.session">
                      <td style="font-weight:600;color:#111;">{{ r.filiere }}</td>
                      <td>
                        <span class="rp-session-badge" :class="`rp-session-${r.session}`">
                          {{ sessionLabel[r.session] ?? r.session }}
                        </span>
                      </td>
                      <td style="text-align:center;font-weight:700;">{{ r.total }}</td>
                      <td style="text-align:center;"><span style="color:#15803d;font-weight:700;">{{ r.admis }}</span></td>
                      <td style="text-align:center;"><span style="color:#d97706;font-weight:600;">{{ r.rattrapage }}</span></td>
                      <td style="text-align:center;"><span style="color:#dc2626;font-weight:600;">{{ r.redoublant }}</span></td>
                      <td style="text-align:center;"><span style="color:#7c3aed;font-weight:600;">{{ r.exclus }}</span></td>
                      <td style="text-align:center;">
                        <span class="rp-taux-badge"
                          :style="{ background: tauxBg(r.taux_reussite), color: tauxColor(r.taux_reussite) }">
                          {{ r.taux_reussite }}%
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- Moyennes par filière -->
            <div v-if="resultats.evol_moyennes.length" class="rp-card">
              <h3 class="rp-card-title">Moyennes générales par filière</h3>
              <div style="display:flex;flex-direction:column;gap:12px;">
                <div v-for="r in resultats.evol_moyennes" :key="r.filiere + r.session"
                  style="display:flex;align-items:center;gap:12px;">
                  <span style="font-size:12px;color:#555;min-width:150px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" :title="r.filiere">{{ r.filiere }}</span>
                  <span class="rp-session-badge" :class="`rp-session-${r.session}`" style="flex-shrink:0;">
                    {{ sessionLabel[r.session] ?? r.session }}
                  </span>
                  <div style="flex:1;background:#f0f0f0;border-radius:20px;height:10px;overflow:hidden;">
                    <div style="height:100%;border-radius:20px;transition:width 0.4s;"
                      :style="{ width: `${(r.moyenne / 20) * 100}%`, backgroundColor: tauxColor(r.moyenne * 5) }"></div>
                  </div>
                  <span style="font-size:13px;font-weight:800;min-width:56px;text-align:right;"
                    :style="{ color: tauxColor(r.moyenne * 5) }">
                    {{ r.moyenne }}/20
                  </span>
                </div>
              </div>
            </div>

            <!-- Top 10 étudiants -->
            <div v-if="resultats.top_etudiants.length" class="rp-card">
              <h3 class="rp-card-title">🏆 Top 10 — Meilleures moyennes</h3>
              <table class="uc-table">
                <thead>
                  <tr>
                    <th style="text-align:center;width:40px;">#</th>
                    <th>Étudiant</th>
                    <th>Filière</th>
                    <th>Session</th>
                    <th style="text-align:center;">Moyenne</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(e, idx) in resultats.top_etudiants" :key="e.numero_etudiant + e.session">
                    <td style="text-align:center;font-size:16px;">
                      {{ idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1 }}
                    </td>
                    <td>
                      <div style="font-weight:700;color:#111;font-size:13px;">{{ e.etudiant }}</div>
                      <div v-if="e.numero_etudiant" style="font-size:11px;color:#aaa;font-family:monospace;">{{ e.numero_etudiant }}</div>
                    </td>
                    <td style="font-size:12px;color:#555;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ e.filiere }}</td>
                    <td>
                      <span class="rp-session-badge" :class="`rp-session-${e.session}`">
                        {{ sessionLabel[e.session] ?? e.session }}
                      </span>
                    </td>
                    <td style="text-align:center;">
                      <span style="font-size:16px;font-weight:800;" :style="{ color: tauxColor(e.moyenne * 5) }">{{ e.moyenne }}</span>
                      <span style="font-size:11px;color:#aaa;">/20</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ── Topbar ── */
.rp-topbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; gap:12px; flex-wrap:wrap; }
.rp-title  { font-size:18px; font-weight:700; color:#111; margin:0; }
.rp-subtitle { font-size:12px; color:#888; margin:4px 0 0; display:flex; align-items:center; gap:8px; }
.rp-annee-badge { background:#f1f5f9; color:#475569; border-radius:20px; padding:2px 10px; font-size:11px; font-weight:600; }
.rp-topbar-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

/* ── Year select ── */
.rp-year-select {
  border:1.5px solid #e5e5e5; border-radius:4px; padding:7px 12px;
  font-size:12px; font-weight:600; font-family:'Poppins',sans-serif;
  color:#333; background:#fff; cursor:pointer;
}
.rp-year-select:focus { outline:none; border-color:#E30613; }

/* ── Export buttons ── */
.rp-btn-export { border:1.5px solid #e5e5e5; background:#fff; color:#555; border-radius:4px; padding:8px 14px; font-size:12px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.rp-btn-export:hover { background:#f5f5f5; }
.rp-btn-excel { border-color:#16a34a; color:#16a34a; background:#f0fdf4; }
.rp-btn-excel:hover { background:#dcfce7; }

/* ── Tabs ── */
.rp-tabs { display:flex; border-bottom:2px solid #f0f0f0; margin-bottom:16px; gap:2px; flex-wrap:wrap; }
.rp-tab { padding:10px 18px; font-size:12px; font-weight:600; border:none; border-bottom:3px solid transparent; background:none; cursor:pointer; color:#888; font-family:'Poppins',sans-serif; margin-bottom:-2px; transition:color 0.15s; }
.rp-tab--active { border-bottom-color:#E30613; color:#E30613; }
.rp-tab:hover:not(.rp-tab--active) { color:#555; }

/* ── Card ── */
.rp-card { background:#fff; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.05); padding:20px; }
.rp-card-title { font-size:13px; font-weight:700; color:#333; margin:0 0 14px; }
.rp-tab-content { display:flex; flex-direction:column; gap:16px; }
.rp-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }

/* ── KPI 5 cols ── */
.rp-kpi-5 { grid-template-columns: repeat(5, 1fr); }
.rp-kpi-big { font-size:24px !important; }

/* ── Bar chart ── */
.rp-bar-chart { display:flex; align-items:flex-end; justify-content:space-around; height:110px; gap:4px; }
.rp-bar-group { display:flex; flex-direction:column; align-items:center; flex:1; }
.rp-bar-pair { display:flex; align-items:flex-end; gap:3px; }
.rp-bar { border-radius:3px 3px 0 0; transition:height 0.3s; }
.rp-bar-label { font-size:10px; color:#888; margin-top:4px; text-align:center; }
.rp-legend { display:flex; align-items:center; gap:5px; font-size:11px; color:#888; }
.rp-legend span { width:10px; height:10px; border-radius:2px; display:inline-block; }

/* ── States ── */
.rp-loading { text-align:center; padding:60px; color:#aaa; font-size:13px; }
.rp-err { text-align:center; padding:60px; color:#E30613; font-size:13px; }
.rp-empty { text-align:center; padding:20px; color:#aaa; font-size:13px; }
.rp-empty-card { text-align:center; padding:40px; }

/* ── Session badges ── */
.rp-session-badge { display:inline-block; padding:2px 9px; border-radius:20px; font-size:11px; font-weight:600; }
.rp-session-normale    { background:#eff6ff; color:#1d4ed8; }
.rp-session-rattrapage { background:#fef3c7; color:#92400e; }
.rp-session-speciale   { background:#f3e8ff; color:#6b21a8; }

/* ── Taux badge ── */
.rp-taux-badge { display:inline-block; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:800; }

/* ── Responsive ── */
@media (max-width:900px) {
  .rp-kpi-5 { grid-template-columns: repeat(3, 1fr) !important; }
  .rp-grid-2 { grid-template-columns: 1fr; }
}
@media (max-width:600px) {
  .rp-kpi-5 { grid-template-columns: repeat(2, 1fr) !important; }
  .rp-tabs  { gap:0; }
  .rp-tab   { padding:8px 12px; font-size:11px; }
}
</style>
