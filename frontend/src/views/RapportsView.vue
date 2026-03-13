<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'

const auth = useAuthStore()
const canSee = computed(() => ['dg', 'resp_fin', 'dir_peda'].includes(auth.user?.role ?? ''))

type Tab = 'financier' | 'pedagogique' | 'rh' | 'etudiants'
const activeTab = ref<Tab>('financier')
const loading = ref(true)

interface RapportData {
  financier: {
    encaisse_annee: number; depenses_annee: number; solde: number
    taux_recouvrement: number
    evolution_6_mois: { mois: string; recettes: number; depenses: number }[]
  }
  pedagogique: {
    nb_seances: number; nb_seances_realisees: number; taux_presence: number
    nb_ues: number; nb_etudiants_notes: number
  }
  rh: {
    intervenants_actifs: number; volume_horaire: number
    repartition_mode: Record<string, number>
  }
  etudiants: {
    par_filiere: { nom: string; count: number; pct: number }[]
    par_statut: { statut: string; total: number }[]
    evolution_inscriptions: { mois: string; count: number }[]
  }
}

const data = ref<RapportData | null>(null)

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n)
}
function pct(n: number) { return `${n}%` }

// ── SVG HELPERS ──────────────────────────────────────────────────────
// Barres verticales
function barHeight(val: number, max: number, maxH = 80) {
  return max > 0 ? (val / max) * maxH : 0
}
// Donut
function donutPath(pctValue: number, color: string) {
  const r = 30, cx = 40, cy = 40
  const circ = 2 * Math.PI * r
  const dash = (pctValue / 100) * circ
  return { strokeDasharray: `${dash} ${circ}`, stroke: color }
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

// Export CSV simple
function exportCSV() {
  if (!data.value) return
  const tab = activeTab.value
  let rows: string[][] = []
  let filename = 'rapport.csv'

  if (tab === 'financier') {
    filename = 'rapport_financier.csv'
    rows = [
      ['Indicateur', 'Valeur'],
      ['Encaissé année', String(data.value.financier.encaisse_annee)],
      ['Dépenses année', String(data.value.financier.depenses_annee)],
      ['Solde trésorerie', String(data.value.financier.solde)],
      ['Taux recouvrement', pct(data.value.financier.taux_recouvrement)],
      [],
      ['Mois', 'Recettes', 'Dépenses'],
      ...data.value.financier.evolution_6_mois.map(m => [m.mois, String(m.recettes), String(m.depenses)]),
    ]
  } else if (tab === 'pedagogique') {
    filename = 'rapport_pedagogique.csv'
    rows = [
      ['Indicateur', 'Valeur'],
      ['Séances planifiées', String(data.value.pedagogique.nb_seances)],
      ['Séances réalisées', String(data.value.pedagogique.nb_seances_realisees)],
      ['Taux de présence', pct(data.value.pedagogique.taux_presence)],
      ['Unités d\'enseignement', String(data.value.pedagogique.nb_ues)],
      ['Étudiants notés', String(data.value.pedagogique.nb_etudiants_notes)],
    ]
  } else if (tab === 'rh') {
    filename = 'rapport_rh.csv'
    rows = [
      ['Indicateur', 'Valeur'],
      ['Intervenants actifs', String(data.value.rh.intervenants_actifs)],
      ['Volume horaire', `${data.value.rh.volume_horaire}h`],
      [],
      ['Mode', 'Pourcentage'],
      ...Object.entries(data.value.rh.repartition_mode).map(([k, v]) => [modeLabels[k] ?? k, pct(v)]),
    ]
  } else {
    filename = 'rapport_etudiants.csv'
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

async function load() {
  loading.value = true
  try {
    const { data: d } = await api.get('/rapports')
    data.value = d
  } finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="uc-content">

    <!-- En-tête -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <h1 style="font-size:18px;font-weight:700;color:#111;margin:0;">Rapports & Statistiques</h1>
        <p style="font-size:12px;color:#888;margin:4px 0 0;">Synthèse analytique de l'établissement</p>
      </div>
      <button @click="exportCSV" class="rp-btn-export">⬇ Exporter CSV</button>
    </div>

    <!-- Tabs -->
    <div class="rp-tabs">
      <button v-for="tab in ['financier', 'pedagogique', 'rh', 'etudiants']" :key="tab"
        @click="activeTab = tab as Tab"
        class="rp-tab" :class="activeTab === tab ? 'rp-tab--active' : ''">
        {{ tab === 'financier' ? 'Financier' : tab === 'pedagogique' ? 'Pédagogique' : tab === 'rh' ? 'RH' : 'Étudiants' }}
      </button>
    </div>

    <div v-if="loading" style="text-align:center;padding:60px;color:#aaa;font-size:13px;">Chargement…</div>
    <div v-else-if="!data" style="text-align:center;padding:60px;color:#E30613;font-size:13px;">Erreur de chargement.</div>
    <div v-else>

      <!-- FINANCIER -->
      <div v-if="activeTab === 'financier'" style="display:flex;flex-direction:column;gap:16px;">
        <div class="uc-kpi-grid">
          <div class="uc-kpi-card green">
            <div class="uc-kpi-icon">💰</div>
            <div class="uc-kpi-label">Encaissé (année)</div>
            <div class="uc-kpi-value">{{ fmt(data.financier.encaisse_annee) }}</div>
          </div>
          <div class="uc-kpi-card red">
            <div class="uc-kpi-icon">📉</div>
            <div class="uc-kpi-label">Dépenses (année)</div>
            <div class="uc-kpi-value">{{ fmt(data.financier.depenses_annee) }}</div>
          </div>
          <div class="uc-kpi-card" :class="data.financier.solde < 0 ? 'red' : 'blue'">
            <div class="uc-kpi-icon">⚖</div>
            <div class="uc-kpi-label">Solde trésorerie</div>
            <div class="uc-kpi-value">{{ fmt(data.financier.solde) }}</div>
          </div>
          <div class="uc-kpi-card orange">
            <div class="uc-kpi-icon">📊</div>
            <div class="uc-kpi-label">Taux recouvrement</div>
            <div class="uc-kpi-value">{{ pct(data.financier.taux_recouvrement) }}</div>
          </div>
        </div>
        <div class="rp-card">
          <h3 class="rp-card-title">Évolution mensuelle (6 mois)</h3>
          <div class="rp-bar-chart">
            <div v-for="m in data.financier.evolution_6_mois" :key="m.mois" class="rp-bar-group">
              <div class="rp-bar-pair">
                <div class="rp-bar" style="background:#22c55e;" :style="{ height: `${barHeight(m.recettes, Math.max(...data.financier.evolution_6_mois.map(x => Math.max(x.recettes, x.depenses))))}px` }" :title="`Recettes: ${fmt(m.recettes)}`"></div>
                <div class="rp-bar" style="background:#fca5a5;" :style="{ height: `${barHeight(m.depenses, Math.max(...data.financier.evolution_6_mois.map(x => Math.max(x.recettes, x.depenses))))}px` }" :title="`Dépenses: ${fmt(m.depenses)}`"></div>
              </div>
              <p class="rp-bar-label">{{ m.mois }}</p>
            </div>
          </div>
          <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;">
            <span style="display:flex;align-items:center;gap:4px;font-size:11px;color:#888;"><span style="width:10px;height:10px;background:#22c55e;border-radius:2px;display:inline-block;"></span> Recettes</span>
            <span style="display:flex;align-items:center;gap:4px;font-size:11px;color:#888;"><span style="width:10px;height:10px;background:#fca5a5;border-radius:2px;display:inline-block;"></span> Dépenses</span>
          </div>
        </div>
      </div>

      <!-- PÉDAGOGIQUE -->
      <div v-else-if="activeTab === 'pedagogique'" style="display:flex;flex-direction:column;gap:16px;">
        <div class="uc-kpi-grid" style="grid-template-columns:repeat(5,1fr);">
          <div class="uc-kpi-card blue"><div class="uc-kpi-label">Séances planifiées</div><div class="uc-kpi-value" style="font-size:22px;">{{ data.pedagogique.nb_seances }}</div></div>
          <div class="uc-kpi-card green"><div class="uc-kpi-label">Séances réalisées</div><div class="uc-kpi-value" style="font-size:22px;">{{ data.pedagogique.nb_seances_realisees }}</div></div>
          <div class="uc-kpi-card orange"><div class="uc-kpi-label">Taux présence</div><div class="uc-kpi-value" style="font-size:22px;">{{ pct(data.pedagogique.taux_presence) }}</div></div>
          <div class="uc-kpi-card blue"><div class="uc-kpi-label">Unités d'ens.</div><div class="uc-kpi-value" style="font-size:22px;">{{ data.pedagogique.nb_ues }}</div></div>
          <div class="uc-kpi-card purple"><div class="uc-kpi-label">Étudiants notés</div><div class="uc-kpi-value" style="font-size:22px;">{{ data.pedagogique.nb_etudiants_notes }}</div></div>
        </div>
        <div class="rp-card">
          <h3 class="rp-card-title">Taux de réalisation des séances</h3>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="flex:1;background:#f0f0f0;border-radius:20px;height:16px;overflow:hidden;">
              <div style="height:100%;background:#22c55e;border-radius:20px;transition:width 0.3s;"
                :style="{ width: `${data.pedagogique.nb_seances > 0 ? Math.round(data.pedagogique.nb_seances_realisees / data.pedagogique.nb_seances * 100) : 0}%` }"></div>
            </div>
            <span style="font-size:14px;font-weight:800;color:#333;min-width:40px;text-align:right;">
              {{ data.pedagogique.nb_seances > 0 ? Math.round(data.pedagogique.nb_seances_realisees / data.pedagogique.nb_seances * 100) : 0 }}%
            </span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#aaa;margin-top:4px;">
            <span>{{ data.pedagogique.nb_seances_realisees }} réalisées</span>
            <span>{{ data.pedagogique.nb_seances }} planifiées</span>
          </div>
        </div>
      </div>

      <!-- RH -->
      <div v-else-if="activeTab === 'rh'" style="display:flex;flex-direction:column;gap:16px;">
        <div class="uc-kpi-grid" style="grid-template-columns:repeat(3,1fr);">
          <div class="uc-kpi-card blue"><div class="uc-kpi-label">Intervenants actifs</div><div class="uc-kpi-value">{{ data.rh.intervenants_actifs }}</div></div>
          <div class="uc-kpi-card orange"><div class="uc-kpi-label">Volume horaire</div><div class="uc-kpi-value">{{ data.rh.volume_horaire }}h</div></div>
          <div class="uc-kpi-card green"><div class="uc-kpi-label">Modes utilisés</div><div class="uc-kpi-value">{{ Object.keys(data.rh.repartition_mode).length }}</div></div>
        </div>
        <div class="rp-card">
          <h3 class="rp-card-title">Répartition par mode d'enseignement</h3>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div v-for="(pctVal, mode) in data.rh.repartition_mode" :key="mode" style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:12px;color:#555;min-width:100px;flex-shrink:0;">{{ modeLabels[mode] ?? mode }}</span>
              <div style="flex:1;background:#f0f0f0;border-radius:20px;height:10px;overflow:hidden;">
                <div style="height:100%;border-radius:20px;transition:width 0.3s;" :style="{ width: `${pctVal}%`, backgroundColor: modeColors[mode] ?? '#94a3b8' }"></div>
              </div>
              <span style="font-size:12px;font-weight:700;color:#333;min-width:36px;text-align:right;">{{ pctVal }}%</span>
            </div>
            <div v-if="!Object.keys(data.rh.repartition_mode).length" style="text-align:center;padding:16px;color:#aaa;font-size:13px;">Aucune donnée de séance disponible.</div>
          </div>
        </div>
      </div>

      <!-- ÉTUDIANTS -->
      <div v-else-if="activeTab === 'etudiants'" style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="rp-card">
            <h3 class="rp-card-title">Répartition par filière</h3>
            <div v-if="!data.etudiants.par_filiere.length" style="text-align:center;padding:16px;color:#aaa;font-size:13px;">Aucune donnée.</div>
            <div v-else style="display:flex;flex-direction:column;gap:10px;">
              <div v-for="f in data.etudiants.par_filiere" :key="f.nom" style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:12px;color:#555;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ f.nom }}</span>
                <div style="width:100px;background:#f0f0f0;border-radius:20px;height:8px;overflow:hidden;flex-shrink:0;">
                  <div style="height:100%;background:#E30613;border-radius:20px;" :style="{ width: `${f.pct}%` }"></div>
                </div>
                <span style="font-size:11px;font-weight:700;color:#333;min-width:60px;text-align:right;">{{ f.count }} ({{ f.pct }}%)</span>
              </div>
            </div>
          </div>
          <div class="rp-card">
            <h3 class="rp-card-title">Répartition par statut</h3>
            <div v-if="!data.etudiants.par_statut.length" style="text-align:center;padding:16px;color:#aaa;font-size:13px;">Aucune donnée.</div>
            <div v-else style="display:flex;flex-direction:column;">
              <div v-for="s in data.etudiants.par_statut" :key="(s as any).statut" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f4f4f4;">
                <span style="font-size:13px;color:#555;">{{ statutLabels[(s as any).statut] ?? (s as any).statut }}</span>
                <span style="font-size:13px;font-weight:800;color:#333;">{{ (s as any).total }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="rp-card">
          <h3 class="rp-card-title">Évolution des inscriptions (6 mois)</h3>
          <div class="rp-bar-chart">
            <div v-for="m in data.etudiants.evolution_inscriptions" :key="m.mois" class="rp-bar-group">
              <span style="font-size:10px;font-weight:700;color:#E30613;display:block;text-align:center;margin-bottom:2px;">{{ m.count || '' }}</span>
              <div class="rp-bar" style="background:#E30613;width:24px;" :style="{ height: `${barHeight(m.count, Math.max(...data.etudiants.evolution_inscriptions.map(x => x.count), 1), 64)}px`, minHeight: m.count > 0 ? '4px' : '0' }"></div>
              <p class="rp-bar-label">{{ m.mois }}</p>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.rp-tabs { display:flex; border-bottom:2px solid #f0f0f0; margin-bottom:16px; }
.rp-tab { padding:10px 20px; font-size:12px; font-weight:600; border:none; border-bottom:3px solid transparent; background:none; cursor:pointer; color:#888; font-family:'Poppins',sans-serif; margin-bottom:-2px; }
.rp-tab--active { border-bottom-color:#E30613; color:#E30613; }
.rp-btn-export { border:1.5px solid #e5e5e5; background:#fff; color:#555; border-radius:4px; padding:8px 14px; font-size:12px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.rp-btn-export:hover { background:#f5f5f5; }
.rp-card { background:#fff; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.05); padding:20px; }
.rp-card-title { font-size:13px; font-weight:700; color:#333; margin:0 0 14px; }
.rp-bar-chart { display:flex; align-items:flex-end; justify-content:space-around; height:110px; gap:4px; }
.rp-bar-group { display:flex; flex-direction:column; align-items:center; flex:1; }
.rp-bar-pair { display:flex; align-items:flex-end; gap:2px; }
.rp-bar { border-radius:3px 3px 0 0; transition:height 0.3s; }
.rp-bar-label { font-size:10px; color:#888; margin-top:4px; text-align:center; }
</style>
