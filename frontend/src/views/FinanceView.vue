<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
// finTab déclaré ici pour usage dans le template
const finTab = ref<'overview' | 'relances'>('overview')
import { Bar, Doughnut } from 'vue-chartjs'
import {
  Chart as ChartJS,
  Title, Tooltip, Legend,
  BarElement, CategoryScale, LinearScale,
  ArcElement,
} from 'chart.js'
import api from '@/services/api'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement)

// ─── Types ─────────────────────────────────────────────────────────────────
interface MonthData { mois: string; label: string; recettes: number; depenses: number }
interface Creance { etudiant_id: number; nom_complet: string; telephone: string | null; email: string | null; filiere: string | null; nb_echeances: number; montant_du: number; plus_ancienne: string | null; derniere_relance: string | null }
interface Relance { id: number; etudiant_id: number; nom_complet: string; montant_total: number; nb_echeances: number; type_contact: string; message: string | null; statut: string; created_at: string }
interface CatData { categorie: string; total: number; nb: number }
interface FiliereData { nom: string; recettes: number }
interface RecentTx { id: number; montant: number; libelle: string; date: string; sens: 'entree' | 'sortie'; categorie?: string; type_paiement?: string }
interface Kpis {
  recettes_total: number
  depenses_total: number
  recettes_mois: number
  depenses_mois: number
  solde_net: number
  creances: number
}

const loading = ref(true)
const kpis = ref<Kpis | null>(null)
const monthly = ref<MonthData[]>([])
const categories = ref<CatData[]>([])
const parFiliere = ref<FiliereData[]>([])
const recent = ref<RecentTx[]>([])

// ─── Filtre période ────────────────────────────────────────────────────────
const periodeMode  = ref<'mois' | 'annee' | 'tout'>('tout')
const periodeMois  = ref(new Date().toISOString().slice(0, 7))
const periodeAnnee = ref(String(new Date().getFullYear()))

const periodeLabel = computed(() => {
  if (periodeMode.value === 'tout')   return 'Toutes périodes'
  if (periodeMode.value === 'annee')  return `Année ${periodeAnnee.value}`
  return new Date(periodeMois.value + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
})

// ─── Labels mois ──────────────────────────────────────────────────────────
function moisLabel(iso: string) {
  const [y, m] = iso.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
}

// ─── Chart bar recettes vs dépenses ───────────────────────────────────────
const barData = computed(() => ({
  labels: monthly.value.map(m => moisLabel(m.mois)),
  datasets: [
    {
      label: 'Recettes',
      data: monthly.value.map(m => m.recettes),
      backgroundColor: 'rgba(34,197,94,0.75)',
      borderRadius: 5,
      borderSkipped: false,
    },
    {
      label: 'Dépenses',
      data: monthly.value.map(m => m.depenses),
      backgroundColor: 'rgba(227,6,19,0.75)',
      borderRadius: 5,
      borderSkipped: false,
    },
  ],
}))

const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { position: 'top' as const, labels: { font: { family: 'Inter', size: 11 }, boxWidth: 12 } },
    tooltip: {
      callbacks: {
        label: (ctx: any) => ` ${ctx.dataset.label}: ${Math.round(Number(ctx.raw)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`,
      },
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 10 } } },
    y: {
      grid: { color: '#f3f4f6' },
      ticks: {
        font: { family: 'Inter', size: 10 },
        callback: (v: any) => Math.round(Number(v)).toLocaleString('fr-FR', { maximumFractionDigits: 0 }),
      },
    },
  },
}

// ─── Donut catégories dépenses ─────────────────────────────────────────────
const catLabels: Record<string, string> = {
  loyer_charges: 'Loyer & Charges',
  salaires: 'Salaires',
  materiel: 'Matériel',
  fournitures: 'Fournitures',
  internet_tel: 'Internet & Tél.',
  entretien: 'Entretien',
  communication: 'Communication',
  autre: 'Autre',
}
const catColors = ['#E30613','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280']

const donutData = computed(() => ({
  labels: categories.value.map(c => catLabels[c.categorie] ?? c.categorie ?? 'Autre'),
  datasets: [{
    data: categories.value.map(c => c.total),
    backgroundColor: catColors.slice(0, categories.value.length),
    borderWidth: 2,
    borderColor: '#fff',
    hoverOffset: 6,
  }],
}))

const donutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '68%',
  plugins: {
    legend: { position: 'right' as const, labels: { font: { family: 'Inter', size: 11 }, boxWidth: 12, padding: 10 } },
    tooltip: {
      callbacks: {
        label: (ctx: any) => ` ${ctx.label}: ${Math.round(Number(ctx.raw)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} FCFA`,
      },
    },
  },
}

// ─── Tableau mensuel récapitulatif ─────────────────────────────────────────
const tableMonthly = computed(() =>
  [...monthly.value].reverse().map(m => ({
    ...m,
    solde: m.recettes - m.depenses,
  }))
)

// ─── Formatage ─────────────────────────────────────────────────────────────
const fmtOpts: Intl.NumberFormatOptions = { maximumFractionDigits: 0 }
function fmt(n: number | string) {
  return Math.round(Number(n ?? 0)).toLocaleString('fr-FR', fmtOpts) + ' FCFA'
}
function fmtN(n: number | string) {
  return Math.round(Number(n ?? 0)).toLocaleString('fr-FR', fmtOpts)
}
function fmtDate(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── Barre de progression filières ─────────────────────────────────────────
const maxFiliere = computed(() => Math.max(...parFiliere.value.map(f => f.recettes), 1))

// ─── Chargement ────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  const params: Record<string, string> = { mode: periodeMode.value }
  if (periodeMode.value === 'mois')  params.valeur = periodeMois.value
  if (periodeMode.value === 'annee') params.valeur = periodeAnnee.value
  try {
    const { data } = await api.get('/finance/overview', { params })
    kpis.value = data.kpis
    monthly.value = data.monthly
    categories.value = data.categories
    parFiliere.value = data.par_filiere
    recent.value = data.recent
  } finally {
    loading.value = false
  }
}

// Recharger automatiquement quand la période change
watch([periodeMode, periodeMois, periodeAnnee], load)
onMounted(load)

// ─── Créances & Relances ───────────────────────────────────────────────────
const creances = ref<Creance[]>([])
const relancesHist = ref<Relance[]>([])
const loadingCreances = ref(false)
const selectedCreances = ref<Set<number>>(new Set())
const showRelanceModal = ref(false)
const relanceTargets = ref<Creance[]>([])
const relanceForm = ref({ type_contact: 'whatsapp', message: '' })
const sendingRelance = ref(false)
const showHistorique = ref(false)

async function loadCreances() {
  loadingCreances.value = true
  try {
    const [cr, rel] = await Promise.all([
      api.get('/creances/etudiants'),
      api.get('/relances'),
    ])
    creances.value = cr.data
    relancesHist.value = rel.data
  } finally {
    loadingCreances.value = false }
}

watch(finTab, t => { if (t === 'relances') loadCreances() })

// ── WhatsApp helpers ──────────────────────────────────────────────────────
function formatPhone(phone: string | null): string {
  if (!phone) return ''
  let p = phone.replace(/[\s\-\.\(\)]/g, '')
  if (p.startsWith('00221')) p = '+' + p.slice(2)
  else if (/^\d{9}$/.test(p))  p = '+221' + p          // 9 chiffres → +221XXXXXXXXX
  else if (/^221\d{9}$/.test(p)) p = '+' + p            // 221XXXXXXXXX → +221XXXXXXXXX
  else if (!p.startsWith('+'))   p = '+221' + p          // fallback
  return p
}

function waLink(phone: string | null, message: string): string {
  const p = formatPhone(phone).replace('+', '')
  return p
    ? `https://wa.me/${p}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`
}

function generateMessage(t: Creance): string {
  return `Bonjour ${t.nom_complet},\n\nNous vous contactons de la part d'*Uptech Campus* concernant le règlement de votre scolarité.\n\n💰 *Montant dû :* ${Math.round(t.montant_du).toLocaleString('fr-FR')} FCFA\n📋 *Échéances :* ${t.nb_echeances} échéance${t.nb_echeances > 1 ? 's' : ''} en attente\n\nNous vous prions de bien vouloir régulariser cette situation dans les meilleurs délais.\n\nMerci de votre compréhension.\n\n_Uptech Campus_`
}

function openWhatsApp(target: Creance) {
  const msg = relanceTargets.value.length === 1
    ? relanceForm.value.message
    : generateMessage(target)
  window.open(waLink(target.telephone, msg), '_blank')
}

async function markSent(targets: Creance[]) {
  sendingRelance.value = true
  try {
    for (const target of targets) {
      await api.post('/relances', {
        etudiant_id: target.etudiant_id,
        montant_total: target.montant_du,
        nb_echeances: target.nb_echeances,
        type_contact: 'whatsapp',
        message: generateMessage(target),
        statut: 'envoyee'
      })
    }
    showRelanceModal.value = false
    selectedCreances.value = new Set()
    await loadCreances()
  } finally { sendingRelance.value = false }
}

function openRelance(targets: Creance[]) {
  relanceTargets.value = targets
  relanceForm.value = {
    type_contact: 'whatsapp',
    message: targets.length === 1 ? generateMessage(targets[0]!) : ''
  }
  showRelanceModal.value = true
}

async function sendRelance() {
  await markSent(relanceTargets.value)
}

function toggleSelectCreance(id: number) {
  if (selectedCreances.value.has(id)) selectedCreances.value.delete(id)
  else selectedCreances.value.add(id)
  selectedCreances.value = new Set(selectedCreances.value)
}

const allSelected = computed(() =>
  creances.value.length > 0 && creances.value.every(c => selectedCreances.value.has(c.etudiant_id))
)

function toggleSelectAll() {
  if (allSelected.value) {
    creances.value.forEach(c => selectedCreances.value.delete(c.etudiant_id))
  } else {
    creances.value.forEach(c => selectedCreances.value.add(c.etudiant_id))
  }
  selectedCreances.value = new Set(selectedCreances.value)
}

async function copyMessage() {
  try {
    await navigator.clipboard.writeText(relanceForm.value.message)
    alert('Message copié !')
  } catch {
    alert('Impossible de copier (HTTPS requis).')
  }
}

// ─── Export Excel (CSV) ───────────────────────────────────────────────────
function exportExcel() {
  const rows: string[][] = []
  rows.push([`Rapport financier — ${periodeLabel.value}`])
  rows.push([])
  rows.push(['Indicateur', 'Montant (FCFA)'])
  rows.push(['Recettes encaissées', String(Math.round(kpis.value?.recettes_total ?? 0))])
  rows.push(['Dépenses validées',   String(Math.round(kpis.value?.depenses_total ?? 0))])
  rows.push(['Solde net',           String(Math.round(kpis.value?.solde_net ?? 0))])
  rows.push(['Créances',            String(Math.round(kpis.value?.creances ?? 0))])
  rows.push([])
  rows.push(['Récapitulatif mensuel'])
  rows.push(['Mois', 'Recettes', 'Dépenses', 'Solde'])
  for (const m of tableMonthly.value)
    rows.push([m.label, String(Math.round(m.recettes)), String(Math.round(m.depenses)), String(Math.round(m.solde))])
  rows.push([])
  rows.push(['Dépenses par catégorie'])
  rows.push(['Catégorie', 'Total FCFA', 'Nb dépenses'])
  for (const c of categories.value)
    rows.push([catLabels[c.categorie] ?? c.categorie, String(Math.round(c.total)), String(c.nb)])
  rows.push([])
  rows.push(['Recettes par filière'])
  rows.push(['Filière', 'Recettes FCFA'])
  for (const f of parFiliere.value)
    rows.push([f.nom, String(Math.round(f.recettes))])

  const csv = rows.map(r =>
    r.map(cell => (cell.includes(',') || cell.includes('"') || cell.includes('\n'))
      ? `"${cell.replace(/"/g, '""')}"` : cell).join(',')
  ).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: `rapport_${periodeLabel.value.replace(/\s+/g,'_')}.csv` })
  a.click(); URL.revokeObjectURL(url)
}

// ─── Export PDF ───────────────────────────────────────────────────────────
function exportPDF() { window.print() }
</script>

<template>
  <div class="uc-content">
    <UcPageHeader title="Tableau de bord financier" subtitle="Vision globale des recettes, dépenses et trésorerie">
      <template #actions>
        <button @click="exportExcel" class="fin-btn-export">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          Excel
        </button>
        <button @click="exportPDF" class="fin-btn-export fin-btn-pdf">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
          PDF
        </button>
      </template>
    </UcPageHeader>

    <!-- ── Onglets ──────────────────────────────────────────────────── -->
    <div class="fin-tab-bar">
      <button :class="['fin-tab', {active: finTab==='overview'}]" @click="finTab='overview'">
        📊 Vue d'ensemble
      </button>
      <button :class="['fin-tab', {active: finTab==='relances'}]" @click="finTab='relances'">
        🔔 Créances &amp; Relances
        <span v-if="creances.length > 0" class="fin-tab-badge">{{ creances.length }}</span>
      </button>
    </div>

    <div v-if="finTab==='overview'">
    <!-- ── Sélecteur période ──────────────────────────────────────────── -->
    <div class="fin-periode-bar">
      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0;color:#666;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
      <span class="fin-periode-label-static">Période :</span>
      <div class="fin-periode-modes">
        <button :class="['fin-periode-mode', { active: periodeMode==='mois' }]"  @click="periodeMode='mois'">Par mois</button>
        <button :class="['fin-periode-mode', { active: periodeMode==='annee' }]" @click="periodeMode='annee'">Par année</button>
        <button :class="['fin-periode-mode', { active: periodeMode==='tout' }]"  @click="periodeMode='tout'">Tout</button>
      </div>
      <input v-if="periodeMode==='mois'"  v-model="periodeMois"  type="month" class="fin-input-sm" style="width:170px;" />
      <select v-else-if="periodeMode==='annee'" v-model="periodeAnnee" class="fin-input-sm" style="width:120px;">
        <option v-for="y in Array.from({length:10},(_,i)=>String(new Date().getFullYear()-i))" :key="y" :value="y">{{ y }}</option>
      </select>
      <span class="fin-periode-badge">
        <svg width="11" height="11" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4"/></svg>
        {{ periodeLabel }}
      </span>
    </div>

    <div v-if="loading" class="p-16 text-center text-gray-400 text-sm">Chargement…</div>

    <template v-else>

      <!-- ── KPI Cards ────────────────────────────────────────────────── -->
      <div class="uc-kpi-grid">

        <!-- Recettes -->
        <div class="uc-kpi-card green">
          <div class="uc-kpi-icon">
            <svg width="20" height="20" fill="none" stroke="#16a34a" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12" />
            </svg>
          </div>
          <div class="uc-kpi-label">Recettes encaissées</div>
          <div class="uc-kpi-value" style="font-size:16px;">{{ fmt(kpis!.recettes_total) }}</div>
          <div class="uc-kpi-trend uc-trend-up">{{ periodeLabel }}</div>
        </div>

        <!-- Dépenses -->
        <div class="uc-kpi-card red">
          <div class="uc-kpi-icon">
            <svg width="20" height="20" fill="none" stroke="var(--red)" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
            </svg>
          </div>
          <div class="uc-kpi-label">Dépenses validées</div>
          <div class="uc-kpi-value" style="font-size:16px;">{{ fmt(kpis!.depenses_total) }}</div>
          <div class="uc-kpi-trend uc-trend-down">{{ periodeLabel }}</div>
        </div>

        <!-- Solde net -->
        <div class="uc-kpi-card" :class="kpis!.solde_net >= 0 ? 'green' : 'red'">
          <div class="uc-kpi-icon">
            <svg width="20" height="20" fill="none" :stroke="kpis!.solde_net >= 0 ? '#16a34a' : 'var(--red)'" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div class="uc-kpi-label">Solde net</div>
          <div class="uc-kpi-value" style="font-size:16px;"
            :style="{ color: kpis!.solde_net >= 0 ? '#15803d' : 'var(--red)' }">
            {{ kpis!.solde_net >= 0 ? '+' : '' }}{{ fmt(kpis!.solde_net) }}
          </div>
          <div class="uc-kpi-trend" :class="kpis!.solde_net >= 0 ? 'uc-trend-up' : 'uc-trend-down'">
            {{ kpis!.solde_net >= 0 ? 'Trésorerie positive' : 'Trésorerie négative' }}
          </div>
        </div>

        <!-- Créances -->
        <div class="uc-kpi-card red">
          <div class="uc-kpi-icon">
            <svg width="20" height="20" fill="none" stroke="var(--red)" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div class="uc-kpi-label">Créances</div>
          <div class="uc-kpi-value" style="font-size:16px;">{{ fmt(kpis!.creances) }}</div>
          <div class="uc-kpi-trend uc-trend-down">Scolarités non réglées</div>
        </div>

      </div>

      <!-- ── Graphiques row 1 ─────────────────────────────────────────── -->
      <div style="display:grid; grid-template-columns:2fr 1fr; gap:16px; margin-bottom:16px;">

        <!-- Bar chart recettes vs dépenses -->
        <div class="uc-card">
          <div class="uc-card-header">
            <span class="uc-card-title">Recettes vs Dépenses — {{ periodeLabel }}</span>
          </div>
          <div class="uc-card-body" style="height:260px;">
            <Bar :data="barData" :options="barOptions" />
          </div>
        </div>

        <!-- Donut catégories -->
        <div class="uc-card">
          <div class="uc-card-header">
            <span class="uc-card-title">Dépenses par catégorie</span>
          </div>
          <div class="uc-card-body" style="height:260px; display:flex; align-items:center; justify-content:center;">
            <div v-if="categories.length === 0" style="color:var(--ink-400); font-size:12px; font-style:italic;">
              Aucune dépense validée
            </div>
            <div v-else style="width:100%; height:230px;">
              <Doughnut :data="donutData" :options="donutOptions" />
            </div>
          </div>
        </div>

      </div>

      <!-- ── Graphiques row 2 ─────────────────────────────────────────── -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px;">

        <!-- Recettes par filière -->
        <div class="uc-card">
          <div class="uc-card-header">
            <span class="uc-card-title">Recettes par filière</span>
          </div>
          <div class="uc-card-body">
            <div v-if="parFiliere.length === 0" style="color:var(--ink-400); font-size:12px; font-style:italic;">Aucune donnée</div>
            <div v-else style="display:flex; flex-direction:column; gap:12px;">
              <div v-for="f in parFiliere" :key="f.nom">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
                  <span style="font-size:12px; font-weight:500; color:var(--ink-700); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:60%;">{{ f.nom }}</span>
                  <span style="font-size:11.5px; font-weight:600; color:var(--ink-900); flex-shrink:0;">{{ fmt(f.recettes) }}</span>
                </div>
                <div style="height:6px; background:var(--ink-100); border-radius:4px; overflow:hidden;">
                  <div style="height:100%; border-radius:4px; background:linear-gradient(90deg, var(--red), #ff4444); transition:width 0.5s;"
                    :style="{ width: (f.recettes / maxFiliere * 100).toFixed(1) + '%' }" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Timeline transactions récentes -->
        <div class="uc-card">
          <div class="uc-card-header">
            <span class="uc-card-title">Transactions récentes</span>
          </div>
          <div class="uc-card-body" style="padding-top:8px;">
            <div v-if="recent.length === 0" style="color:var(--ink-400); font-size:12px; font-style:italic;">Aucune transaction</div>
            <div v-else style="display:flex; flex-direction:column; gap:2px; max-height:280px; overflow-y:auto;">
              <div v-for="tx in recent" :key="tx.sens + tx.id"
                style="display:flex; align-items:center; gap:10px; padding:8px 6px; border-radius:8px; transition:background 0.1s;"
                @mouseenter="($event.currentTarget as HTMLElement).style.background='var(--ink-50)'"
                @mouseleave="($event.currentTarget as HTMLElement).style.background='transparent'">
                <!-- Icône -->
                <div style="width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0;"
                  :style="{ background: tx.sens === 'entree' ? '#f0fdf4' : '#fff0f0' }">
                  <svg width="14" height="14" fill="none" viewBox="0 0 24 24"
                    :stroke="tx.sens === 'entree' ? '#16a34a' : 'var(--red)'">
                    <path v-if="tx.sens === 'entree'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M7 11l5-5m0 0l5 5m-5-5v12" />
                    <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
                  </svg>
                </div>
                <!-- Détail -->
                <div style="flex:1; min-width:0;">
                  <p style="font-size:12px; font-weight:500; color:var(--ink-800); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:0;">{{ tx.libelle }}</p>
                  <p style="font-size:10px; color:var(--ink-400); margin:1px 0 0;">{{ fmtDate(tx.date) }}</p>
                </div>
                <!-- Montant -->
                <span style="font-size:12.5px; font-weight:700; flex-shrink:0;"
                  :style="{ color: tx.sens === 'entree' ? '#16a34a' : 'var(--red)' }">
                  {{ tx.sens === 'entree' ? '+' : '−' }}{{ fmt(tx.montant) }}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ── Tableau récapitulatif mensuel ───────────────────────────── -->
      <div class="uc-card">
        <div class="uc-card-header">
          <span class="uc-card-title">Récapitulatif mensuel</span>
        </div>
        <div style="overflow-x:auto;">
          <table class="uc-table">
            <thead>
              <tr>
                <th>Mois</th>
                <th style="text-align:right; color:#15803d;">Recettes</th>
                <th style="text-align:right; color:var(--red);">Dépenses</th>
                <th style="text-align:right;">Solde</th>
                <th style="text-align:right; width:100px;">Barre</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in tableMonthly" :key="m.mois">
                <td style="font-weight:500; text-transform:capitalize;">{{ m.label }}</td>
                <td style="text-align:right; color:#15803d; font-weight:500;">
                  {{ m.recettes > 0 ? fmt(m.recettes) : '—' }}
                </td>
                <td style="text-align:right; color:var(--red); font-weight:500;">
                  {{ m.depenses > 0 ? fmt(m.depenses) : '—' }}
                </td>
                <td style="text-align:right; font-weight:700;"
                  :style="{ color: m.solde >= 0 ? '#15803d' : 'var(--red)' }">
                  {{ m.solde === 0 ? '—' : (m.solde > 0 ? '+' : '') + fmt(Math.abs(m.solde)) }}
                </td>
                <td style="text-align:right; padding-right:16px;">
                  <div v-if="m.recettes > 0 || m.depenses > 0" style="display:flex; align-items:center; gap:2px; justify-content:flex-end;">
                    <div style="height:6px; border-radius:3px; background:#22c55e; transition:width 0.3s;"
                      :style="{ width: Math.min(m.recettes / Math.max(...tableMonthly.map(x => Math.max(x.recettes, x.depenses)), 1) * 56, 56).toFixed(0) + 'px' }" />
                    <div style="height:6px; border-radius:3px; background:var(--red); transition:width 0.3s;"
                      :style="{ width: Math.min(m.depenses / Math.max(...tableMonthly.map(x => Math.max(x.recettes, x.depenses)), 1) * 56, 56).toFixed(0) + 'px' }" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </template>

    <!-- ── Compte de résultat (visible UNIQUEMENT à l'impression) ──── -->
    <div class="fin-print-only">
      <div class="fin-cr-header">
        <h2 class="fin-cr-title">Compte de résultat</h2>
        <p class="fin-cr-period">{{ periodeLabel }}</p>
      </div>
      <table class="fin-cr-table">
        <thead><tr><th colspan="2">PRODUITS</th></tr></thead>
        <tbody>
          <tr><td>Scolarités encaissées</td><td class="fin-cr-amt green">{{ fmt(kpis!.recettes_total) }}</td></tr>
          <tr class="fin-cr-subtotal"><td><strong>Total produits</strong></td><td class="fin-cr-amt green"><strong>{{ fmt(kpis!.recettes_total) }}</strong></td></tr>
        </tbody>
        <thead><tr><th colspan="2">CHARGES PAR CATÉGORIE</th></tr></thead>
        <tbody>
          <tr v-for="c in categories" :key="c.categorie">
            <td>{{ catLabels[c.categorie] ?? c.categorie }}</td>
            <td class="fin-cr-amt red">{{ fmt(c.total) }}</td>
          </tr>
          <tr class="fin-cr-subtotal"><td><strong>Total charges</strong></td><td class="fin-cr-amt red"><strong>{{ fmt(kpis!.depenses_total) }}</strong></td></tr>
        </tbody>
        <tbody>
          <tr class="fin-cr-result" :class="kpis!.solde_net >= 0 ? 'positive' : 'negative'">
            <td><strong>Résultat net</strong></td>
            <td class="fin-cr-amt"><strong>{{ kpis!.solde_net >= 0 ? '+' : '' }}{{ fmt(kpis!.solde_net) }}</strong></td>
          </tr>
        </tbody>
      </table>
      <table class="fin-cr-table" style="margin-top:24px;">
        <thead><tr><th>Mois</th><th class="fin-cr-amt">Recettes</th><th class="fin-cr-amt">Charges</th><th class="fin-cr-amt">Solde</th></tr></thead>
        <tbody>
          <tr v-for="m in tableMonthly" :key="m.mois" style="text-transform:capitalize;">
            <td>{{ m.label }}</td>
            <td class="fin-cr-amt green">{{ m.recettes > 0 ? fmt(m.recettes) : '—' }}</td>
            <td class="fin-cr-amt red">{{ m.depenses > 0 ? fmt(m.depenses) : '—' }}</td>
            <td class="fin-cr-amt" :style="{color: m.solde>=0?'#15803d':'#b91c1c'}">{{ m.solde===0?'—':(m.solde>0?'+':'')+fmt(Math.abs(m.solde)) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="fin-cr-footer">Document généré le {{ new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'}) }} · Uptech Campus</p>
    </div>

    </div><!-- end finTab=overview -->

    <!-- ══════════ CRÉANCES & RELANCES ══════════ -->
    <div v-else-if="finTab==='relances'" class="fin-relances-panel">

      <!-- Stats bar -->
      <div class="fin-stats-row">
        <div class="uc-kpi-card red">
          <div class="uc-kpi-label">Étudiants en retard</div>
          <div class="uc-kpi-value">{{ loadingCreances ? '…' : creances.length }}</div>
        </div>
        <div class="uc-kpi-card red">
          <div class="uc-kpi-label">Total impayé</div>
          <div class="uc-kpi-value">{{ loadingCreances ? '…' : fmt(creances.reduce((s,c) => s + c.montant_du, 0)) }}</div>
        </div>
        <div class="fin-stat-actions">
          <button v-if="creances.length > 0" @click="openRelance(creances)" class="uc-btn uc-btn-primary">
            🔔 Relancer tout ({{ creances.length }})
          </button>
          <button @click="loadCreances" class="uc-btn uc-btn-secondary">
            🔄 Actualiser
          </button>
        </div>
      </div>

      <!-- Bulk action bar -->
      <div v-if="selectedCreances.size > 0" class="uc-alert uc-alert-warning" style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <span style="font-size:12px;font-weight:600;">{{ selectedCreances.size }} étudiant(s) sélectionné(s)</span>
        <button @click="openRelance(creances.filter(c => selectedCreances.has(c.etudiant_id)))" class="uc-btn uc-btn-primary">
          🔔 Relancer la sélection ({{ selectedCreances.size }})
        </button>
        <button @click="selectedCreances = new Set()" class="uc-btn uc-btn-outline">
          Désélectionner
        </button>
      </div>

      <!-- Table créances -->
      <div class="uc-table-wrap">
        <div v-if="loadingCreances" class="fin-empty">Chargement…</div>
        <div v-else-if="creances.length === 0" class="fin-empty">
          Aucune créance en attente — tous les étudiants sont à jour !
        </div>
        <table v-else class="uc-table">
          <thead>
            <tr>
              <th style="width:34px;">
                <input type="checkbox" :checked="allSelected" @change="toggleSelectAll" style="cursor:pointer;width:14px;height:14px;" />
              </th>
              <th>Étudiant</th>
              <th>Filière</th>
              <th style="text-align:right;">Montant dû</th>
              <th style="text-align:center;">Nb échéances</th>
              <th>Dernière relance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cr in creances" :key="cr.etudiant_id"
              :class="{ 'fin-row-selected': selectedCreances.has(cr.etudiant_id) }">
              <td>
                <input type="checkbox" :checked="selectedCreances.has(cr.etudiant_id)" @change="toggleSelectCreance(cr.etudiant_id)" style="cursor:pointer;width:14px;height:14px;" />
              </td>
              <td>
                <p class="fin-td-name">{{ cr.nom_complet }}</p>
                <p v-if="cr.telephone" class="fin-td-sub">{{ cr.telephone }}</p>
              </td>
              <td>{{ cr.filiere ?? '—' }}</td>
              <td style="text-align:right;font-weight:700;color:var(--red);font-size:13px;">{{ fmt(cr.montant_du) }}</td>
              <td style="text-align:center;">{{ cr.nb_echeances }}</td>
              <td>
                <span v-if="cr.derniere_relance">{{ fmtDate(cr.derniere_relance) }}</span>
                <span v-else class="fin-never">Jamais</span>
              </td>
              <td>
                <button @click="openRelance([cr])" class="uc-btn uc-btn-outline" style="font-size:11.5px;padding:4px 12px;">
                  Relancer
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Historique des relances -->
      <div class="uc-card" style="margin-top:16px;">
        <div class="uc-card-header">
          <span class="uc-card-title">
            <button @click="showHistorique = !showHistorique" class="uc-btn uc-btn-secondary" style="font-size:12px;">
              {{ showHistorique ? '▲' : '▼' }} Historique des relances ({{ relancesHist.length }})
            </button>
          </span>
        </div>
        <div v-if="showHistorique" class="uc-table-wrap">
          <div v-if="relancesHist.length === 0" class="fin-empty">Aucune relance envoyée</div>
          <table v-else class="uc-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Étudiant</th>
                <th style="text-align:right;">Montant</th>
                <th>Canal</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in relancesHist" :key="r.id">
                <td style="color:var(--ink-400);">{{ fmtDate(r.created_at) }}</td>
                <td>{{ r.nom_complet }}</td>
                <td style="text-align:right;font-weight:600;color:var(--red);">{{ fmt(r.montant_total) }}</td>
                <td style="text-transform:capitalize;">{{ r.type_contact }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div><!-- end finTab=relances -->

    <!-- ══════════ MODAL RELANCE WHATSAPP ══════════ -->
    <div v-if="showRelanceModal" class="fin-modal-overlay">
      <div class="fin-modal">

        <!-- Header -->
        <div class="fin-modal-header">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="fin-wa-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.115.551 4.1 1.517 5.829L.057 23.007a.75.75 0 00.93.93l5.179-1.46A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.699-.498-5.256-1.371l-.376-.215-3.896 1.099 1.1-3.895-.215-.375A9.952 9.952 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
            </div>
            <div>
              <div class="fin-modal-title">Relance WhatsApp</div>
              <div class="fin-modal-sub">{{ relanceTargets.length }} étudiant{{ relanceTargets.length > 1 ? 's' : '' }}</div>
            </div>
          </div>
          <button @click="showRelanceModal=false" class="fin-close-btn">×</button>
        </div>

        <div class="fin-modal-body">

          <!-- Message éditable (1 étudiant) -->
          <div v-if="relanceTargets.length === 1">
            <label class="uc-label">Message</label>
            <textarea v-model="relanceForm.message" rows="8" class="uc-input" style="width:100%;resize:vertical;line-height:1.6;"></textarea>
            <p class="fin-hint">Les *textes en étoiles* apparaîtront en <strong>gras</strong> dans WhatsApp</p>
          </div>

          <!-- Liste par étudiant (multi) -->
          <div v-if="relanceTargets.length > 1">
            <label class="uc-label">Envoyer à chaque étudiant</label>
            <div class="fin-wa-list">
              <div v-for="t in relanceTargets" :key="t.etudiant_id" class="fin-wa-item">
                <div style="flex:1;min-width:0;">
                  <div class="fin-td-name">{{ t.nom_complet }}</div>
                  <div class="fin-td-sub">{{ fmt(t.montant_du) }} · {{ t.telephone ? formatPhone(t.telephone) : '⚠ Pas de numéro' }}</div>
                </div>
                <a v-if="t.telephone" :href="waLink(t.telephone, generateMessage(t))" target="_blank"
                  @click="() => {}" class="fin-wa-btn">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
                  Envoyer
                </a>
                <span v-else class="uc-badge uc-badge-red" style="white-space:nowrap;">Pas de numéro</span>
              </div>
            </div>
          </div>

          <!-- Info numéro (1 étudiant) -->
          <div v-if="relanceTargets.length === 1" class="uc-alert uc-alert-success" style="display:flex;align-items:center;gap:10px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
            <div>
              <div style="font-size:11px;font-weight:600;color:#15803d;">Numéro WhatsApp</div>
              <div style="font-size:12.5px;font-weight:600;">
                {{ relanceTargets[0]?.telephone ? formatPhone(relanceTargets[0].telephone) : '⚠ Aucun numéro enregistré' }}
              </div>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div class="fin-modal-footer">
          <button @click="showRelanceModal=false" class="uc-btn uc-btn-secondary">
            Annuler
          </button>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <!-- Bouton WhatsApp principal (1 étudiant) -->
            <a v-if="relanceTargets.length === 1 && relanceTargets[0]?.telephone"
              :href="waLink(relanceTargets[0].telephone, relanceForm.message)"
              target="_blank"
              class="fin-wa-btn fin-wa-btn-lg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
              Ouvrir WhatsApp
            </a>
            <button @click="sendRelance" :disabled="sendingRelance" class="uc-btn uc-btn-dark">
              {{ sendingRelance ? 'Enregistrement…' : '✓ Marquer envoyée(s)' }}
            </button>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
/* ─── Onglets ─────────────────────────────────────────────────────────── */
.fin-tab-bar { display:flex; gap:4px; margin-bottom:20px; border-bottom:2px solid var(--border); }
.fin-tab { padding:11px 20px; border:none; background:transparent; font-size:13px; font-weight:600; color:var(--ink-400); cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-2px; transition:all 0.15s var(--ease); display:inline-flex; align-items:center; gap:6px; }
.fin-tab.active { color:var(--red); border-bottom-color:var(--red); }
.fin-tab:hover:not(.active) { color:var(--ink-700); }
.fin-tab-badge { background:var(--red-light); color:var(--red); font-size:10px; font-weight:700; padding:2px 7px; border-radius:10px; border:1px solid rgba(227,6,19,0.15); }
.fin-relances-panel { padding-top:4px; }

/* ─── Stats row (relances) ────────────────────────────────────────────── */
.fin-stats-row { display:grid; grid-template-columns:1fr 1fr auto; gap:16px; margin-bottom:20px; align-items:stretch; }
.fin-stat-actions { display:flex; flex-direction:column; gap:8px; justify-content:center; }

/* ─── Période bar ─────────────────────────────────────────────────────── */
.fin-periode-bar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:var(--surface); border:1.5px solid var(--border); border-radius:var(--r); padding:10px 16px; margin-bottom:18px; box-shadow:var(--shadow-xs); }
.fin-periode-label-static { font-size:12px; font-weight:600; color:var(--ink-600); white-space:nowrap; }
.fin-periode-modes { display:flex; background:var(--ink-100); border-radius:var(--r-sm); padding:2px; gap:2px; }
.fin-periode-mode { padding:5px 13px; border:none; border-radius:5px; background:transparent; font-size:12px; font-weight:600; color:var(--ink-400); cursor:pointer; transition:all 0.15s; white-space:nowrap; }
.fin-periode-mode.active { background:var(--surface); color:var(--red); box-shadow:var(--shadow-xs); }
.fin-periode-mode:hover:not(.active) { color:var(--ink-700); }
.fin-input-sm { padding:6px 10px; border:1.5px solid var(--border); border-radius:var(--r-sm); font-size:12.5px; color:var(--ink-900); background:var(--surface); outline:none; transition:border-color 0.18s; }
.fin-input-sm:focus { border-color:var(--red); box-shadow:0 0 0 3px rgba(227,6,19,0.08); }
.fin-periode-badge { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:700; color:#15803d; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:var(--r-sm); padding:4px 10px; margin-left:auto; }

/* ─── Boutons export ──────────────────────────────────────────────────── */
.fin-btn-export { display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border:1.5px solid var(--border); border-radius:var(--r-sm); background:var(--surface); font-size:12px; font-weight:600; color:var(--ink-700); cursor:pointer; transition:all 0.15s; }
.fin-btn-export:hover { background:var(--ink-50); border-color:var(--border-strong); }
.fin-btn-pdf { border-color:var(--red); color:var(--red); }
.fin-btn-pdf:hover { background:var(--red-light); }

/* ─── Table helpers ───────────────────────────────────────────────────── */
.fin-empty { padding:40px; text-align:center; font-size:12.5px; color:var(--ink-300); font-style:italic; }
.fin-row-selected { background:var(--red-light) !important; }
.fin-td-name { font-size:12.5px; font-weight:600; color:var(--ink-900); margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fin-td-sub { font-size:11px; color:var(--ink-400); margin:2px 0 0; }
.fin-never { color:var(--ink-300); font-style:italic; font-size:11.5px; }

/* ─── Modal ───────────────────────────────────────────────────────────── */
.fin-modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(3px); }
.fin-modal { background:var(--surface); border-radius:var(--r-xl); box-shadow:var(--shadow-xl); width:100%; max-width:560px; max-height:90vh; display:flex; flex-direction:column; border:1px solid var(--border); }
.fin-modal-header { padding:20px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; flex-shrink:0; }
.fin-modal-title { font-size:15px; font-weight:700; color:var(--ink-900); }
.fin-modal-sub { font-size:11.5px; color:var(--ink-400); margin-top:2px; }
.fin-modal-body { padding:20px 24px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:16px; }
.fin-modal-footer { padding:16px 24px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; flex-shrink:0; gap:10px; flex-wrap:wrap; }
.fin-wa-icon { width:38px; height:38px; background:#25D366; border-radius:var(--r); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.fin-close-btn { background:none; border:none; font-size:22px; cursor:pointer; color:var(--ink-300); line-height:1; padding:6px; border-radius:var(--r-sm); transition:color 0.15s, background 0.15s; }
.fin-close-btn:hover { color:var(--ink-700); background:var(--ink-100); }
.fin-hint { font-size:11px; color:var(--ink-400); margin-top:6px; }
.fin-wa-list { display:flex; flex-direction:column; gap:8px; max-height:260px; overflow-y:auto; }
.fin-wa-item { display:flex; align-items:center; gap:10px; padding:10px 14px; background:var(--ink-50); border-radius:var(--r); border:1px solid var(--border); }
.fin-wa-btn { display:inline-flex; align-items:center; gap:5px; padding:7px 14px; background:#25D366; color:#fff; border-radius:var(--r-sm); font-size:12px; font-weight:600; text-decoration:none; white-space:nowrap; flex-shrink:0; transition:opacity 0.15s; }
.fin-wa-btn:hover { opacity:0.88; }
.fin-wa-btn-lg { padding:9px 20px; font-size:13px; font-weight:700; border-radius:var(--r); }

/* ─── Print-only ──────────────────────────────────────────────────────── */
.fin-print-only { display:none; }

/* ═══════════════════════════════════════════════════════════
   RESPONSIVE MOBILE
   ═══════════════════════════════════════════════════════════ */
@media (max-width: 768px) {

  /* ── Onglets : défilement horizontal ─────────────────────── */
  .fin-tab-bar {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    flex-wrap: nowrap;
    gap: 0;
  }
  .fin-tab-bar::-webkit-scrollbar { display: none; }
  .fin-tab { flex-shrink: 0; padding: 10px 14px; font-size: 12px; }

  /* ── Stats row : 2 cols + actions pleine largeur ─────────── */
  .fin-stats-row { grid-template-columns: 1fr 1fr; gap: 10px; }
  .fin-stat-actions {
    grid-column: 1 / -1;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
  }
  .fin-stat-actions .uc-btn { flex: 1; min-width: 130px; justify-content: center; }

  /* ── Période bar ──────────────────────────────────────────── */
  .fin-periode-bar { padding: 8px 10px; gap: 6px; }
  .fin-periode-mode { padding: 5px 9px; font-size: 11px; }
  .fin-periode-badge { margin-left: 0; font-size: 11px; }
  .fin-input-sm { font-size: 12px; }

  /* ── Boutons export ───────────────────────────────────────── */
  .fin-btn-export { padding: 7px 10px; font-size: 11.5px; }

  /* ── Helpers table ────────────────────────────────────────── */
  .fin-empty { padding: 28px 14px; font-size: 12px; }
  .fin-td-name { font-size: 12px; }
  .fin-td-sub  { font-size: 10.5px; }

  /* ── Modal WhatsApp ───────────────────────────────────────── */
  .fin-modal-overlay { padding: 10px; }
  .fin-modal { border-radius: var(--r-lg); max-height: 95vh; }
  .fin-modal-header { padding: 14px 16px; }
  .fin-modal-body   { padding: 14px 16px; gap: 12px; }
  .fin-modal-footer { padding: 12px 16px; flex-direction: column; align-items: stretch; }
  .fin-modal-footer > div { display: flex; gap: 8px; flex-wrap: wrap; }
  .fin-modal-footer .uc-btn,
  .fin-modal-footer .fin-wa-btn-lg { flex: 1; justify-content: center; text-align: center; }
  .fin-modal-title  { font-size: 14px; }
  .fin-wa-list { max-height: 200px; gap: 6px; }
  .fin-wa-item { padding: 8px 10px; }
  .fin-wa-btn { padding: 6px 10px; font-size: 11.5px; }
  .fin-wa-btn-lg { padding: 8px 14px; font-size: 12px; border-radius: var(--r); }
}

@media (max-width: 480px) {
  .fin-stats-row { grid-template-columns: 1fr; }
  .fin-tab { padding: 8px 10px; font-size: 11px; }
  .fin-modal-body { padding: 12px; }
  .fin-modal-header { padding: 12px; }
}
</style>

<style>
@media print {
  /* Masquer la navigation et les contrôles */
  .app-sidebar, .app-topbar     { display: none !important; }
  .uc-page-header-actions       { display: none !important; }
  .fin-periode-modes, .fin-input-sm, .fin-btn-export { display: none !important; }
  canvas                        { display: none !important; }
  .uc-kpi-grid, [style*="grid-template-columns"] { break-inside: avoid; }

  /* Afficher le compte de résultat */
  .fin-print-only               { display: block !important; }

  /* Mise en page propre */
  .uc-content { padding: 16px 24px !important; }

  /* Styles du CR */
  .fin-cr-header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #111; padding-bottom: 10px; }
  .fin-cr-title  { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .fin-cr-period { font-size: 13px; color: #555; margin: 0; }
  .fin-cr-table  { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
  .fin-cr-table th { background: #f0f0f0; padding: 8px 12px; text-align: left; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .fin-cr-table td { padding: 7px 12px; border-bottom: 1px solid #ebebeb; }
  .fin-cr-amt    { text-align: right !important; font-variant-numeric: tabular-nums; }
  .fin-cr-amt.green { color: #15803d; }
  .fin-cr-amt.red   { color: #b91c1c; }
  .fin-cr-subtotal td { background: #fafafa; font-size: 12.5px; border-top: 1.5px solid #ddd; }
  .fin-cr-result td   { font-size: 14px; border-top: 2.5px solid #111; padding-top: 10px; }
  .fin-cr-result.positive .fin-cr-amt { color: #15803d; }
  .fin-cr-result.negative .fin-cr-amt { color: #b91c1c; }
  .fin-cr-footer { margin-top: 16px; font-size: 10px; color: #999; text-align: right; font-style: italic; }
}
</style>
