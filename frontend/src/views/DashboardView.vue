<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import api from '@/services/api'

const auth = useAuthStore()
const router = useRouter()

const isEnseignant = computed(() => auth.user?.role === 'enseignant')

// ─────────────────────────────────────────────────────────
//  DASHBOARD ENSEIGNANT
// ─────────────────────────────────────────────────────────
interface MonProfil {
  id: number; nom: string; prenom: string; email: string
  telephone?: string; photo_path?: string
  mes_ues: { id: number; classe_id: number; code: string; intitule: string }[]
  mes_classes: { id: number; nom: string }[]
}
interface Seance {
  id: number; matiere: string; date_debut: string; date_fin: string
  mode: string; statut: string; contenu_seance?: string; signe_enseignant_at?: string
  classe?: { id: number; nom: string }
  enseignant?: { id: number; nom: string; prenom: string }
}

const monProfil   = ref<MonProfil | null>(null)
const seancesProf    = ref<Seance[]>([])
const loadingProf    = ref(true)
const avoirsVisibles = ref(false)   // masqué par défaut — confidentialité

const mesStats    = ref<{
  heures_total: number; heures_ce_mois: number; tarif_horaire: number
  montant_du: number; montant_du_classique: number; montant_du_fi: number
  montant_paye: number; montant_restant: number
  fi_heures_total: number; fi_heures_effectuees: number
  fi_nb_modules: number; fi_tarif_horaire: number
} | null>(null)

// ── Countdown live ──────────────────────────────────────
const now = ref(new Date())
let ticker: ReturnType<typeof setInterval> | null = null

const today    = new Date()
const todayStr = today.toISOString().slice(0, 10)

const mesSeances = computed(() =>
  seancesProf.value.filter(s => Number(s.enseignant?.id) === Number(monProfil.value?.id))
)
const seancesAujourdhui = computed(() =>
  mesSeances.value.filter(s => s.date_debut.slice(0, 10) === todayStr)
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))
)
const seancesAVenir = computed(() =>
  mesSeances.value
    .filter(s => s.date_debut.slice(0, 10) > todayStr && s.statut !== 'annule')
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))
    .slice(0, 6)
)
const seancesCeMois = computed(() => {
  const m = today.getMonth(), y = today.getFullYear()
  return mesSeances.value.filter(s => {
    const d = new Date(s.date_debut)
    return d.getMonth() === m && d.getFullYear() === y
  })
})
const seancesEffectueesCeMois = computed(() =>
  seancesCeMois.value.filter(s => s.statut === 'effectue')
)
const seancesNonEmargees = computed(() =>
  mesSeances.value.filter(s => {
    const fin = new Date(s.date_fin)
    return fin < now.value && s.statut !== 'effectue' && s.statut !== 'annule'
  }).sort((a, b) => b.date_debut.localeCompare(a.date_debut)).slice(0, 5)
)
const tauxEmargement = computed(() => {
  const total = seancesCeMois.value.filter(s => s.statut !== 'annule').length
  if (!total) return 100
  return Math.round(seancesEffectueesCeMois.value.length / total * 100)
})

// Prochain cours (futur le plus proche)
const prochainCours = computed(() =>
  [...mesSeances.value]
    .filter(s => new Date(s.date_debut) > now.value && s.statut !== 'annule')
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))[0] ?? null
)

// Séance en cours actuellement
const seanceEnCours = computed(() =>
  mesSeances.value.find(s => new Date(s.date_debut) <= now.value && new Date(s.date_fin) >= now.value) ?? null
)

const countdownText = computed(() => {
  if (seanceEnCours.value) return 'En cours'
  if (!prochainCours.value) return null
  const diff = new Date(prochainCours.value.date_debut).getTime() - now.value.getTime()
  if (diff <= 0) return 'En cours'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (h >= 24) { const d = Math.floor(h / 24); return `Dans ${d}j ${h % 24}h` }
  if (h > 0) return `Dans ${h}h ${m}min`
  if (m > 0) return `Dans ${m}min ${s}s`
  return `Dans ${s}s`
})

// Taux avoirs
const tauxPaiementAvoirs = computed(() => {
  if (!mesStats.value || !mesStats.value.montant_du) return 0
  return Math.min(100, Math.round((mesStats.value.montant_paye / mesStats.value.montant_du) * 100))
})

// SVG gauge (taux émargement)
const RADIUS = 40
const CIRC = 2 * Math.PI * RADIUS
const gaugeOffset = computed(() => CIRC - (tauxEmargement.value / 100) * CIRC)
const gaugeColor = computed(() =>
  tauxEmargement.value >= 80 ? '#4ade80' : tauxEmargement.value >= 50 ? '#fbbf24' : '#f87171'
)

// ── Helpers ─────────────────────────────────────────────
const COLORS = ['#6366f1','#10b981','#f97316','#3b82f6','#ec4899','#14b8a6','#f59e0b','#8b5cf6']

function modeIcon(mode: string) {
  return ({ presentiel: '🏫', en_ligne: '💻', hybride: '🔀', exam: '📝' } as any)[mode] ?? '📌'
}
function modeLabel2(mode: string) {
  return ({ presentiel: 'Présentiel', en_ligne: 'En ligne', hybride: 'Hybride', exam: 'Examen' } as any)[mode] ?? mode
}
function modeGrad(mode: string) {
  return ({
    presentiel: 'linear-gradient(135deg,#10b981,#059669)',
    en_ligne:   'linear-gradient(135deg,#3b82f6,#1d4ed8)',
    hybride:    'linear-gradient(135deg,#f59e0b,#d97706)',
    exam:       'linear-gradient(135deg,#ef4444,#dc2626)',
  } as any)[mode] ?? 'linear-gradient(135deg,#6366f1,#4f46e5)'
}
function fmtMontant(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n)
}
function fmtHeure(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}
function durationH(debut: string, fin: string) {
  return Math.round((new Date(fin).getTime() - new Date(debut).getTime()) / 3600000 * 10) / 10
}
function statutBadgeProf(statut: string) {
  const m: Record<string, string> = {
    planifie: 'db-badge-gray', confirme: 'db-badge-blue',
    effectue: 'db-badge-green', annule: 'db-badge-red', reporte: 'db-badge-orange',
  }
  return m[statut] ?? 'db-badge-gray'
}
function statutLabelProf(statut: string) {
  const m: Record<string, string> = {
    planifie: 'Planifiée', confirme: 'Confirmée',
    effectue: 'Émargée', annule: 'Annulée', reporte: 'Reportée',
  }
  return m[statut] ?? statut
}

// ── Formations individuelles du prof ──
const mesFI = ref<any[]>([])

async function loadEnseignant() {
  try {
    const [profilRes, seancesRes] = await Promise.all([
      api.get('/enseignants/me'),
      api.get('/seances'),
    ])
    monProfil.value   = profilRes.data
    seancesProf.value = seancesRes.data
    if (profilRes.data?.id) {
      try {
        const { data: stats } = await api.get(`/enseignants/${profilRes.data.id}/stats`)
        mesStats.value = stats
      } catch { /* silencieux */ }
      try {
        const { data: fi } = await api.get(`/enseignants/${profilRes.data.id}/formations-individuelles`)
        mesFI.value = fi
      } catch { /* silencieux */ }
    }
  } finally {
    loadingProf.value = false
  }
}

// ─────────────────────────────────────────────────────────
//  DASHBOARD ADMIN
// ─────────────────────────────────────────────────────────
const roleLabel: Record<string, string> = {
  dg: 'Directeur Général',
  coordinateur: 'Coordinateur',
  secretariat: 'Secrétariat',
  dir_peda: 'Directeur Pédagogique',
  resp_fin: 'Resp. Financier',
}

interface DernierPaiement {
  id: number
  numero_recu: string
  montant: number
  mode_paiement: string
  created_at: string
  inscription: {
    etudiant: { nom: string; prenom: string }
    classe: { filiere: { nom: string } }
  }
}

interface Stats {
  etudiants_total: number
  inscriptions_actives: number
  inscriptions_attente: number
  inscriptions_abandonnees: number
  inscriptions_suspendues: number
  enseignants_actifs: number
  filieres_actives: number
  classes_total: number
  encaisse_ce_mois: number
  impayes_total: number
  paiements_en_attente: number
  depenses_ce_mois: number
  solde_tresorerie: number
  derniers_paiements: DernierPaiement[]
}

const stats   = ref<Stats | null>(null)
const loading = ref(true)

const risqueCounts = ref({ red: 0, yellow: 0, green: 0 })
async function loadRisques() {
  try {
    const { data } = await api.get('/etudiants/risques')
    risqueCounts.value = {
      red:    data.filter((r: any) => r.risque_global === 'red').length,
      yellow: data.filter((r: any) => r.risque_global === 'yellow').length,
      green:  data.filter((r: any) => r.risque_global === 'green').length,
    }
  } catch { /* silencieux */ }
}

const canSeeFinance = computed(() =>
  auth.user?.role === 'dg' || auth.user?.role === 'resp_fin'
)

// ─── Stats avancées dashboard ──────────────────────────────────────
interface EvolPaiement { mois: string; montant: number }
interface ClasseRemplissage { id: number; nom: string; capacite: number; inscrits: number }
interface TopRetard { id: number; nom: string; prenom: string; numero_etudiant: string; montant_retard: number; nb_mois_retard: number }

const evolutionPaiements = ref<EvolPaiement[]>([])
const classesRemplissage = ref<ClasseRemplissage[]>([])
const topRetards = ref<TopRetard[]>([])
const tauxPresence = ref<number | null>(null)
const seancesEffectuees = ref(0)
const seancesTotalPassees = ref(0)
const loadingAvance = ref(true)

async function loadStatsAvancees() {
  try {
    const { data } = await api.get('/dashboard/stats-avancees')
    evolutionPaiements.value = data.evolution_paiements ?? []
    classesRemplissage.value = data.classes_remplissage ?? []
    topRetards.value = data.top_retards ?? []
    tauxPresence.value = data.taux_presence ?? null
    seancesEffectuees.value = data.seances_effectuees ?? 0
    seancesTotalPassees.value = data.seances_total_passees ?? 0
  } catch { /* silencieux */ }
  finally { loadingAvance.value = false }
}

// ── Mes priorités (par rôle) ────────────────────────────────────────
interface PrioritesData {
  pre_inscrits: number
  paiements_en_attente: { n: number; total: number }
  depenses_en_attente: { n: number; total: number }
  encaisse_aujourdhui: { n: number; total: number }
  encaisse_ce_mois: number
  impayes_actuels: { n: number; total: number }
  seances_sans_enseignant: number
  seances_aujourdhui: number
  presences_non_validees: number
  etudiants_en_retard: number
  classes_sans_date_debut: number
}
const priorites = ref<PrioritesData | null>(null)
const loadingPriorites = ref(true)
const prioritesError = ref<string | null>(null)
async function loadPriorites() {
  loadingPriorites.value = true
  prioritesError.value = null
  try {
    const { data } = await api.get('/dashboard/priorites')
    priorites.value = data
  } catch (e: any) {
    prioritesError.value = e?.response?.data?.message || e?.message || 'Impossible de charger les priorités.'
  } finally {
    loadingPriorites.value = false
  }
}

interface PrioriteCard {
  icon: string
  label: string
  value: string | number
  detail?: string
  color: 'red' | 'orange' | 'green' | 'blue' | 'purple' | 'neutral'
  route: string
  urgent?: boolean
}
const fmtFcfa = (n: number) => Math.round(n).toLocaleString('fr-FR') + ' FCFA'
const fmtFcfaShort = (n: number) => n >= 1_000_000
  ? (n / 1_000_000).toFixed(1) + 'M'
  : n >= 1_000 ? (n / 1_000).toFixed(0) + 'k' : Math.round(n).toLocaleString('fr-FR')

// Cartes priorité par rôle — chaque rôle voit 3 à 5 indicateurs actionnables.
// Fallback : si rôle inconnu on propose un set générique pour ne jamais laisser
// le widget vide.
const prioritesCards = computed<PrioriteCard[]>(() => {
  if (!priorites.value) return []
  const p = priorites.value
  const role = auth.user?.role

  if (role === 'dg') return [
    { icon: '💰', label: 'Encaissé ce mois', value: fmtFcfaShort(p.encaisse_ce_mois), detail: 'FCFA', color: 'green', route: '/paiements' },
    { icon: '⚠️', label: 'Impayés en cours', value: fmtFcfaShort(p.impayes_actuels.total), detail: `${p.impayes_actuels.n} échéance(s)`, color: 'red', route: '/suivi-paiements', urgent: p.impayes_actuels.n > 0 },
    { icon: '📋', label: 'Dépenses à valider', value: p.depenses_en_attente.n, detail: fmtFcfa(p.depenses_en_attente.total), color: 'orange', route: '/depenses', urgent: p.depenses_en_attente.n > 0 },
    { icon: '🚦', label: 'Étudiants à risque', value: risqueCounts.value.red, detail: `${risqueCounts.value.yellow} à surveiller`, color: 'red', route: '/etudiants' },
    { icon: '📝', label: 'Pré-inscrits', value: p.pre_inscrits, detail: 'en attente', color: 'blue', route: '/etudiants' },
  ]

  if (role === 'resp_fin') return [
    { icon: '💵', label: "Encaissé aujourd'hui", value: fmtFcfaShort(p.encaisse_aujourdhui.total), detail: `${p.encaisse_aujourdhui.n} paiement(s)`, color: 'green', route: '/paiements' },
    { icon: '💰', label: 'Encaissé ce mois', value: fmtFcfaShort(p.encaisse_ce_mois), detail: 'FCFA', color: 'green', route: '/paiements' },
    { icon: '⚠️', label: 'Impayés en cours', value: fmtFcfaShort(p.impayes_actuels.total), detail: `${p.impayes_actuels.n} échéance(s)`, color: 'red', route: '/suivi-paiements', urgent: p.impayes_actuels.n > 0 },
    { icon: '📋', label: 'Dépenses à valider', value: p.depenses_en_attente.n, detail: fmtFcfa(p.depenses_en_attente.total), color: 'orange', route: '/depenses', urgent: p.depenses_en_attente.n > 0 },
    { icon: '⏳', label: 'Paiements en attente', value: p.paiements_en_attente.n, detail: 'à confirmer', color: 'orange', route: '/paiements', urgent: p.paiements_en_attente.n > 0 },
  ]

  if (role === 'secretariat') return [
    { icon: '📝', label: 'Pré-inscriptions', value: p.pre_inscrits, detail: 'à valider', color: 'blue', route: '/etudiants', urgent: p.pre_inscrits > 0 },
    { icon: '⏳', label: 'Paiements en attente', value: p.paiements_en_attente.n, detail: 'à enregistrer', color: 'orange', route: '/paiements', urgent: p.paiements_en_attente.n > 0 },
    { icon: '⚠️', label: 'Étudiants en retard', value: p.etudiants_en_retard, detail: 'à relancer', color: 'red', route: '/suivi-paiements' },
    { icon: '📅', label: "Cours aujourd'hui", value: p.seances_aujourdhui, detail: 'planifiés', color: 'blue', route: '/emplois-du-temps' },
  ]

  if (role === 'dir_peda') return [
    { icon: '👨‍🏫', label: 'Séances sans enseignant', value: p.seances_sans_enseignant, detail: 'à assigner', color: 'orange', route: '/emplois-du-temps', urgent: p.seances_sans_enseignant > 0 },
    { icon: '📅', label: 'Classes sans date début', value: p.classes_sans_date_debut, detail: 'à configurer', color: 'orange', route: '/classes', urgent: p.classes_sans_date_debut > 0 },
    { icon: '🚦', label: 'Étudiants à risque', value: risqueCounts.value.red, detail: `${risqueCounts.value.yellow} à surveiller`, color: 'red', route: '/etudiants' },
    { icon: '✅', label: "Cours aujourd'hui", value: p.seances_aujourdhui, detail: 'planifiés', color: 'green', route: '/emplois-du-temps' },
    { icon: '📊', label: 'Taux présence', value: tauxPresence.value !== null ? tauxPresence.value + '%' : '—', detail: `${seancesEffectuees.value}/${seancesTotalPassees.value} séances`, color: 'purple', route: '/suivi-emargements' },
  ]

  if (role === 'coordinateur') return [
    { icon: '📅', label: "Cours aujourd'hui", value: p.seances_aujourdhui, detail: 'planifiés', color: 'blue', route: '/emplois-du-temps' },
    { icon: '👨‍🏫', label: 'Séances sans enseignant', value: p.seances_sans_enseignant, detail: 'à assigner', color: 'orange', route: '/emplois-du-temps', urgent: p.seances_sans_enseignant > 0 },
    { icon: '📋', label: 'Émargements à valider', value: p.presences_non_validees, detail: 'séances sans présences', color: 'orange', route: '/suivi-emargements' },
    { icon: '🎓', label: 'Classes', value: stats.value?.classes_total ?? 0, color: 'blue', route: '/classes' },
  ]

  // Rôle inconnu → set générique (encaissé mois + pré-inscrits + retards)
  return [
    { icon: '💰', label: 'Encaissé ce mois', value: fmtFcfaShort(p.encaisse_ce_mois), detail: 'FCFA', color: 'green', route: '/paiements' },
    { icon: '📝', label: 'Pré-inscrits', value: p.pre_inscrits, detail: 'en attente', color: 'blue', route: '/etudiants' },
    { icon: '⚠️', label: 'Étudiants en retard', value: p.etudiants_en_retard, detail: 'paiement', color: 'red', route: '/suivi-paiements' },
  ]
})

// SVG chart helpers
const CHART_W = 300
const CHART_H = 80
const chartBars = computed(() => {
  const vals = evolutionPaiements.value.map(e => e.montant)
  const maxVal = Math.max(...vals, 1)
  const bw = (CHART_W - 10) / vals.length - 4
  return vals.map((v, i) => ({
    x: i * ((CHART_W - 10) / vals.length) + 2,
    y: CHART_H - Math.round((v / maxVal) * (CHART_H - 10)),
    h: Math.round((v / maxVal) * (CHART_H - 10)),
    w: bw,
    v,
    mois: evolutionPaiements.value[i]?.mois ?? '',
  }))
})

const maxPaiement = computed(() => Math.max(...evolutionPaiements.value.map(e => e.montant), 1))

function fmtMoisCourt(iso: string) {
  const d = new Date(iso + '-01')
  return d.toLocaleDateString('fr-FR', { month: 'short' })
}

function remplissagePct(cl: ClasseRemplissage) {
  return Math.min(100, Math.round((cl.inscrits / (cl.capacite || 30)) * 100))
}
function remplissageColor(pct: number) {
  if (pct >= 90) return '#E30613'
  if (pct >= 70) return '#f97316'
  if (pct >= 40) return '#22c55e'
  return '#3b82f6'
}

const presenceGaugeR = 36
const presenceCirc = 2 * Math.PI * presenceGaugeR
const presenceOffset = computed(() =>
  tauxPresence.value !== null
    ? presenceCirc - (tauxPresence.value / 100) * presenceCirc
    : presenceCirc
)
const presenceColor = computed(() => {
  const t = tauxPresence.value ?? 0
  if (t >= 80) return '#22c55e'
  if (t >= 50) return '#f97316'
  return '#E30613'
})

async function loadAdmin() {
  try {
    const { data } = await api.get('/stats')
    stats.value = data
  } finally {
    loading.value = false
  }
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n)
}
function modeBadge(mode: string) {
  const map: Record<string, string> = {
    wave: 'bg-violet-100 text-violet-700',
    orange_money: 'bg-orange-100 text-orange-700',
    especes: 'bg-emerald-100 text-emerald-700',
    virement: 'bg-blue-100 text-blue-700',
    cheque: 'bg-gray-100 text-gray-700',
  }
  return map[mode] ?? 'bg-gray-100 text-gray-600'
}
function modeLabel(mode: string) {
  const map: Record<string, string> = {
    wave: 'Wave', orange_money: 'Orange Money', especes: 'Espèces',
    virement: 'Virement', cheque: 'Chèque',
  }
  return map[mode] ?? mode
}

onMounted(() => {
  if (isEnseignant.value) {
    loadEnseignant()
    ticker = setInterval(() => { now.value = new Date() }, 1000)
  } else {
    loadAdmin()
    loadRisques()
    loadStatsAvancees()
    loadPriorites()
  }
})
onUnmounted(() => { if (ticker) clearInterval(ticker) })
</script>

<template>
  <div class="uc-content">

    <!-- ═══════════════════════════════════════════════════════
         DASHBOARD ENSEIGNANT — VERSION MAXIMALE
    ════════════════════════════════════════════════════════ -->
    <template v-if="isEnseignant">

      <!-- ── HERO ── -->
      <div class="db-hero">
        <div class="db-hero-glow"></div>
        <div class="db-hero-content">
          <div class="db-hero-left">
            <div class="db-avatar">
              {{ ((monProfil?.prenom ?? auth.user?.prenom ?? '?').charAt(0) + (monProfil?.nom ?? auth.user?.nom ?? '?').charAt(0)).toUpperCase() }}
            </div>
            <div class="db-hero-info">
              <p class="db-greeting">Bonjour 👋</p>
              <h1 class="db-hero-name">{{ monProfil?.prenom ?? auth.user?.prenom ?? 'Enseignant' }} {{ monProfil?.nom ?? auth.user?.nom ?? '' }}</h1>
              <div class="db-hero-tags">
                <span class="db-tag db-tag--red">👨‍🏫 Enseignant</span>
                <span class="db-tag db-tag--ghost">{{ new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }}</span>
              </div>
            </div>
          </div>
          <div class="db-hero-kpis">
            <div class="db-hkpi">
              <div class="db-hkpi-val">{{ loadingProf ? '…' : (monProfil?.mes_classes?.length ?? 0) }}</div>
              <div class="db-hkpi-lbl">Classes</div>
            </div>
            <div class="db-hkpi">
              <div class="db-hkpi-val">{{ loadingProf ? '…' : (monProfil?.mes_ues?.length ?? 0) }}</div>
              <div class="db-hkpi-lbl">Matières</div>
            </div>
            <div class="db-hkpi">
              <div class="db-hkpi-val">{{ loadingProf ? '…' : seancesCeMois.length }}</div>
              <div class="db-hkpi-lbl">Séances / mois</div>
            </div>
            <div class="db-hkpi" :style="{ '--kpi-c': gaugeColor }">
              <div class="db-hkpi-val" :style="{ color: gaugeColor }">{{ loadingProf ? '…' : tauxEmargement + '%' }}</div>
              <div class="db-hkpi-lbl">Taux émargement</div>
            </div>
          </div>
        </div>

        <!-- Prochain cours strip -->
        <div v-if="!loadingProf && (prochainCours || seanceEnCours)" class="db-hero-next">
          <span class="db-hero-next-label">{{ seanceEnCours ? '🔴 En cours' : '⏱ Prochain cours' }}</span>
          <div class="db-hero-next-body">
            <span class="db-hero-next-mode" :style="{ background: modeGrad(seanceEnCours?.mode ?? prochainCours?.mode ?? '') }">
              {{ modeIcon(seanceEnCours?.mode ?? prochainCours?.mode ?? '') }}
            </span>
            <span class="db-hero-next-name">{{ seanceEnCours?.matiere ?? prochainCours?.matiere }}</span>
            <span class="db-hero-next-time">{{ fmtHeure(seanceEnCours?.date_debut ?? prochainCours?.date_debut ?? '') }}</span>
            <span class="db-hero-next-class">{{ seanceEnCours?.classe?.nom ?? prochainCours?.classe?.nom }}</span>
          </div>
          <span v-if="countdownText" class="db-hero-countdown">{{ countdownText }}</span>
        </div>
      </div>

      <!-- ── ALERTE non émargées ── -->
      <div v-if="!loadingProf && seancesNonEmargees.length" class="db-alert" @click="router.push('/emargement')">
        <span class="db-alert-icon">⚠️</span>
        <div class="db-alert-body">
          <strong>{{ seancesNonEmargees.length }} séance(s) sans émargement</strong>
          <span>
            <span v-for="(s, i) in seancesNonEmargees.slice(0,3)" :key="s.id">
              {{ s.matiere }} ({{ fmtDate(s.date_debut) }}){{ i < Math.min(seancesNonEmargees.length,3)-1 ? ', ' : '' }}
            </span>
            <span v-if="seancesNonEmargees.length > 3"> …+{{ seancesNonEmargees.length - 3 }} autres</span>
          </span>
        </div>
        <span class="db-alert-cta">Régulariser →</span>
      </div>

      <!-- ── AVOIRS banner ── -->
      <div class="db-avoirs">
        <div class="db-avoirs-header">
          <div class="db-avoirs-title">
            <span>💰</span> Mes avoirs — Rémunération
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button
              @click="avoirsVisibles = !avoirsVisibles"
              :title="avoirsVisibles ? 'Masquer les montants' : 'Afficher les montants'"
              style="background:rgba(255,255,255,0.12);border:none;border-radius:8px;padding:4px 9px;cursor:pointer;color:#fff;font-size:15px;line-height:1;">
              {{ avoirsVisibles ? '👁' : '🙈' }}
            </button>
            <button class="db-avoirs-link" @click="router.push('/emargement')">Voir le détail →</button>
          </div>
        </div>
        <div v-if="mesStats" class="db-avoirs-body">
          <!-- KPIs financiers -->
          <div class="db-avoirs-kpis">
            <div class="db-akpi">
              <div class="db-akpi-val">{{ Math.round((mesStats.heures_ce_mois ?? 0) * 2) / 2 }}h</div>
              <div class="db-akpi-lbl">Heures ce mois</div>
            </div>
            <div class="db-akpi">
              <div class="db-akpi-val">{{ mesStats.heures_total ?? 0 }}h</div>
              <div class="db-akpi-lbl">Total heures</div>
            </div>
            <div class="db-akpi">
              <div class="db-akpi-val db-akpi-secret" :class="{ 'db-akpi-masked': !avoirsVisibles }">
                {{ avoirsVisibles ? ((mesStats.tarif_horaire > 0 || mesStats.fi_tarif_horaire > 0) ? new Intl.NumberFormat('fr-FR').format(mesStats.tarif_horaire || mesStats.fi_tarif_horaire) + ' F/h' : '—') : '••••' }}
              </div>
              <div class="db-akpi-lbl">Tarif horaire{{ mesStats.fi_tarif_horaire > 0 && !mesStats.tarif_horaire ? ' (FI)' : '' }}</div>
            </div>
            <div class="db-akpi db-akpi--green">
              <div class="db-akpi-val db-akpi-secret" :class="{ 'db-akpi-masked': !avoirsVisibles }">{{ avoirsVisibles ? fmtMontant(mesStats.montant_du) : '••••' }}</div>
              <div class="db-akpi-lbl">Montant dû</div>
            </div>
            <div class="db-akpi db-akpi--blue">
              <div class="db-akpi-val db-akpi-secret" :class="{ 'db-akpi-masked': !avoirsVisibles }">{{ avoirsVisibles ? fmtMontant(mesStats.montant_paye) : '••••' }}</div>
              <div class="db-akpi-lbl">Déjà payé</div>
            </div>
            <div class="db-akpi" :class="mesStats.montant_restant > 0 ? 'db-akpi--red' : 'db-akpi--green'">
              <div class="db-akpi-val db-akpi-secret" :class="{ 'db-akpi-masked': !avoirsVisibles }">
                {{ avoirsVisibles ? (mesStats.montant_restant > 0 ? fmtMontant(mesStats.montant_restant) : '✓ Soldé') : '••••' }}
              </div>
              <div class="db-akpi-lbl">Solde restant</div>
            </div>
          </div>
          <!-- Détail FI -->
          <div v-if="mesStats.fi_nb_modules > 0 && avoirsVisibles" style="margin-top:8px;padding:8px 14px;background:rgba(99,102,241,0.15);border-radius:8px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;font-size:12px;">
            <span style="color:#c7d2fe;">🎓 FI</span>
            <span style="color:#e0e7ff;font-weight:600;">{{ mesStats.fi_heures_effectuees }}h / {{ mesStats.fi_heures_total }}h</span>
            <span style="color:#a5b4fc;">{{ new Intl.NumberFormat('fr-FR').format(mesStats.fi_tarif_horaire) }} F/h</span>
            <span style="color:#a5f3fc;font-weight:700;">Avoir : {{ fmtMontant(mesStats.montant_du_fi) }}</span>
            <div style="flex:1;min-width:60px;height:5px;background:rgba(255,255,255,0.12);border-radius:3px;overflow:hidden;">
              <div :style="`height:100%;width:${mesStats.fi_heures_total>0?Math.round(mesStats.fi_heures_effectuees/mesStats.fi_heures_total*100):0}%;background:#818cf8;border-radius:3px;`"></div>
            </div>
          </div>
          <!-- Barre progression paiement -->
          <div v-if="mesStats.montant_du > 0 && avoirsVisibles" class="db-avoirs-progress">
            <div class="db-avoirs-progress-header">
              <span style="font-size:11px;color:rgba(255,255,255,.45);">Avancement paiement</span>
              <strong style="font-size:11px;color:rgba(255,255,255,.7);">{{ tauxPaiementAvoirs }}%</strong>
            </div>
            <div class="db-avoirs-track">
              <div class="db-avoirs-fill" :style="{ width: tauxPaiementAvoirs + '%' }"></div>
            </div>
          </div>
        </div>
        <div v-else class="db-avoirs-empty">
          {{ loadingProf ? 'Chargement des avoirs…' : 'Aucune donnée de rémunération disponible' }}
        </div>
      </div>

      <!-- ── ACTIONS RAPIDES ── -->
      <div class="db-quick-actions">
        <button class="db-qa db-qa--primary" @click="router.push('/emargement')">
          <span class="db-qa-icon">✍️</span>
          <span>Émargement</span>
        </button>
        <button class="db-qa" @click="router.push('/notes-bulletins')">
          <span class="db-qa-icon">📋</span>
          <span>Mes notes</span>
        </button>
        <button class="db-qa" @click="router.push('/emplois-du-temps')">
          <span class="db-qa-icon">🗓️</span>
          <span>Planning</span>
        </button>
        <button class="db-qa" @click="router.push('/communication')">
          <span class="db-qa-icon">💬</span>
          <span>Messages</span>
        </button>
      </div>

      <!-- ── GRILLE PRINCIPALE ── -->
      <div class="db-grid">

        <!-- COL GAUCHE : Aujourd'hui + Prochaines séances -->
        <div class="db-col-left">

          <!-- Aujourd'hui -->
          <div class="db-card">
            <div class="db-card-header">
              <div class="db-card-header-left">
                <span class="db-card-dot" style="background:#E30613;"></span>
                <span class="db-card-title">Aujourd'hui</span>
              </div>
              <button class="db-card-link" @click="router.push('/emargement')">Émarger →</button>
            </div>
            <div v-if="loadingProf" class="db-empty">Chargement…</div>
            <div v-else-if="!seancesAujourdhui.length" class="db-empty-illus">
              <span>🎉</span><p>Journée libre !</p>
            </div>
            <div v-else class="db-timeline">
              <div v-for="s in seancesAujourdhui" :key="s.id"
                class="db-tl-item"
                :class="{
                  'db-tl-item--done': s.statut === 'effectue',
                  'db-tl-item--live': seanceEnCours?.id === s.id
                }"
                @click="router.push('/emargement')"
                :style="{ '--tl-clr': modeGrad(s.mode) }">
                <div class="db-tl-stripe"></div>
                <div class="db-tl-time">
                  <div class="db-tl-h">{{ fmtHeure(s.date_debut) }}</div>
                  <div class="db-tl-dur">{{ durationH(s.date_debut, s.date_fin) }}h</div>
                </div>
                <div class="db-tl-body">
                  <div class="db-tl-matiere">{{ s.matiere }}</div>
                  <div class="db-tl-meta">
                    {{ modeIcon(s.mode) }} {{ modeLabel2(s.mode) }} · 🏫 {{ s.classe?.nom ?? '—' }}
                  </div>
                </div>
                <div class="db-tl-right">
                  <span v-if="seanceEnCours?.id === s.id" class="db-live-badge">🔴 En cours</span>
                  <span v-else :class="['db-badge', statutBadgeProf(s.statut)]">{{ statutLabelProf(s.statut) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Prochaines séances -->
          <div class="db-card">
            <div class="db-card-header">
              <div class="db-card-header-left">
                <span class="db-card-title">🗓 Prochaines séances</span>
              </div>
              <button class="db-card-link" @click="router.push('/emplois-du-temps')">Planning →</button>
            </div>
            <div v-if="loadingProf" class="db-empty">Chargement…</div>
            <div v-else-if="!seancesAVenir.length" class="db-empty-illus">
              <span>📭</span><p>Aucune séance planifiée</p>
            </div>
            <div v-else>
              <div v-for="(s, idx) in seancesAVenir" :key="s.id"
                class="db-upcoming-row"
                @click="router.push('/emplois-du-temps')"
                :style="{ '--u-clr': COLORS[idx % COLORS.length] }">
                <div class="db-upcoming-date">
                  <div class="db-upcoming-day">{{ new Date(s.date_debut).getDate() }}</div>
                  <div class="db-upcoming-mon">{{ new Date(s.date_debut).toLocaleDateString('fr-FR', { month: 'short' }) }}</div>
                </div>
                <div class="db-upcoming-info">
                  <div class="db-upcoming-matiere">{{ s.matiere }}</div>
                  <div class="db-upcoming-meta">{{ s.classe?.nom ?? '—' }} · {{ fmtHeure(s.date_debut) }}–{{ fmtHeure(s.date_fin) }}</div>
                </div>
                <div class="db-upcoming-right">
                  <span class="db-mode-chip" :style="{ background: modeGrad(s.mode) }">{{ modeIcon(s.mode) }}</span>
                  <span :class="['db-badge', statutBadgeProf(s.statut)]">{{ statutLabelProf(s.statut) }}</span>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- COL DROITE -->
        <div class="db-col-right">

          <!-- Taux émargement SVG gauge -->
          <div class="db-card db-card--side">
            <div class="db-card-header">
              <div class="db-card-header-left">
                <span class="db-card-title">📊 Taux d'émargement</span>
              </div>
              <span class="db-card-period">Ce mois</span>
            </div>
            <div style="padding:16px 18px;">
              <div class="db-gauge-wrap">
                <svg width="110" height="110" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" :r="RADIUS" fill="none" stroke="#f1f5f9" stroke-width="8"/>
                  <circle cx="50" cy="50" :r="RADIUS" fill="none"
                    :stroke="gaugeColor"
                    stroke-width="8" stroke-linecap="round"
                    :stroke-dasharray="CIRC" :stroke-dashoffset="gaugeOffset"
                    transform="rotate(-90 50 50)"
                    style="transition: stroke-dashoffset 0.6s ease"/>
                  <text x="50" y="46" text-anchor="middle" font-size="16" font-weight="800" :fill="gaugeColor">
                    {{ tauxEmargement }}%
                  </text>
                  <text x="50" y="60" text-anchor="middle" font-size="7" fill="#9ca3af">émargement</text>
                </svg>
              </div>
              <div class="db-gauge-detail">
                <div class="db-gauge-row">
                  <span class="db-gauge-dot" style="background:#22c55e;"></span>
                  <span class="db-gauge-lbl">Émargées</span>
                  <strong class="db-gauge-val">{{ seancesEffectueesCeMois.length }}</strong>
                </div>
                <div class="db-gauge-row">
                  <span class="db-gauge-dot" style="background:#f59e0b;"></span>
                  <span class="db-gauge-lbl">Planifiées</span>
                  <strong class="db-gauge-val">{{ seancesCeMois.filter(s => s.statut !== 'annule').length }}</strong>
                </div>
                <div v-if="seancesNonEmargees.length" class="db-gauge-row">
                  <span class="db-gauge-dot" style="background:#ef4444;"></span>
                  <span class="db-gauge-lbl">À régulariser</span>
                  <strong class="db-gauge-val" style="color:#E30613;">{{ seancesNonEmargees.length }}</strong>
                </div>
              </div>
            </div>
          </div>

          <!-- Mes matières -->
          <div class="db-card db-card--side" v-if="monProfil?.mes_ues?.length">
            <div class="db-card-header">
              <div class="db-card-header-left">
                <span class="db-card-title">📚 Mes matières</span>
              </div>
              <button class="db-card-link" @click="router.push('/notes-bulletins')">Notes →</button>
            </div>
            <div class="db-matieres-list">
              <div v-for="(ue, idx) in monProfil.mes_ues" :key="ue.id" class="db-matiere-row" :style="{ '--m-clr': COLORS[idx % COLORS.length] }">
                <div class="db-matiere-stripe"></div>
                <div class="db-matiere-info">
                  <div class="db-matiere-nom">{{ ue.intitule }}</div>
                  <div class="db-matiere-meta">{{ monProfil.mes_classes.find(c => c.id === ue.classe_id)?.nom ?? '—' }}</div>
                </div>
                <div class="db-ue-code-chip">{{ ue.code }}</div>
              </div>
            </div>
          </div>

          <!-- Mes classes -->
          <div class="db-card db-card--side" v-if="monProfil?.mes_classes?.length">
            <div class="db-card-header">
              <div class="db-card-header-left">
                <span class="db-card-title">🏫 Mes classes</span>
              </div>
            </div>
            <div style="padding:8px 0;">
              <div v-for="cl in monProfil.mes_classes" :key="cl.id" class="db-classe-row">
                <div class="db-classe-av">{{ cl.nom.slice(0,2).toUpperCase() }}</div>
                <div class="db-classe-nom">{{ cl.nom }}</div>
                <div class="db-classe-count">
                  {{ monProfil.mes_ues.filter(u => u.classe_id === cl.id).length }} mat.
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      <!-- ── Formations individuelles assignées ── -->
      <div v-if="mesFI.length > 0" class="db-section" style="margin-top:20px;">
        <h2 class="db-section-title">🎓 Mes formations individuelles <span style="font-size:12px;color:#94a3b8;font-weight:400;">({{ mesFI.length }} module{{ mesFI.length > 1 ? 's' : '' }})</span></h2>
        <div class="db-fi-grid">
          <div v-for="m in mesFI" :key="m.id" class="db-fi-card">
            <div class="db-fi-header">
              <span class="db-fi-matiere">{{ m.matiere_nom }}</span>
              <span class="db-fi-badge" :style="{ background: m.fi_statut === 'en_cours' ? '#dbeafe' : '#dcfce7', color: m.fi_statut === 'en_cours' ? '#1e40af' : '#166534' }">
                {{ m.fi_statut === 'en_cours' ? 'En cours' : 'Terminé' }}
              </span>
            </div>
            <div class="db-fi-student">👤 {{ m.etudiant_prenom }} {{ m.etudiant_nom }}</div>
            <div class="db-fi-progress">
              <div class="db-fi-bar">
                <div class="db-fi-fill" :style="{ width: (m.volume_horaire > 0 ? Math.min(m.heures_effectuees / m.volume_horaire * 100, 100) : 0) + '%', background: m.heures_effectuees >= m.volume_horaire ? '#22c55e' : '#3b82f6' }" />
              </div>
              <span class="db-fi-hours">{{ m.heures_effectuees }}h / {{ m.volume_horaire }}h</span>
            </div>
          </div>
        </div>
      </div>

    </template>

    <!-- ═══════════════════════════════════════════════════════
         DASHBOARD ADMIN (DG, dir_peda, resp_fin, coord, secr)
    ════════════════════════════════════════════════════════ -->
    <template v-else>

      <!-- ══ MES PRIORITÉS — cartes dynamiques par rôle ══════════════ -->
      <div class="uc-priorities">
        <div class="uc-priorities-head">
          <span class="uc-priorities-title">🎯 Mes priorités</span>
          <span class="uc-priorities-sub">Actions clés pour {{ roleLabel[auth.user?.role ?? ''] ?? auth.user?.role ?? 'vous' }}</span>
        </div>

        <!-- Skeleton pendant le chargement -->
        <div v-if="loadingPriorites" class="uc-priorities-grid">
          <div v-for="n in 4" :key="n" class="uc-priority-card uc-priority-card--skeleton">
            <span class="uc-priority-icon" style="opacity:0.3">⋯</span>
            <div class="uc-priority-body">
              <div class="uc-priority-label" style="opacity:0.5">Chargement…</div>
              <div class="uc-priority-value" style="opacity:0.25">—</div>
            </div>
          </div>
        </div>

        <!-- Erreur de chargement -->
        <div v-else-if="prioritesError" style="padding:10px 14px;background:rgba(220,38,38,0.1);border:1px solid rgba(220,38,38,0.3);border-radius:8px;font-size:12.5px;color:#fca5a5;">
          ⚠️ {{ prioritesError }}
          <button @click="loadPriorites" style="margin-left:10px;background:rgba(255,255,255,0.1);color:#fff;border:none;padding:3px 10px;border-radius:4px;font-size:11px;cursor:pointer;">Réessayer</button>
        </div>

        <!-- Cartes -->
        <div v-else class="uc-priorities-grid">
          <button v-for="(c, i) in prioritesCards" :key="i"
            class="uc-priority-card"
            :class="[`uc-priority-card--${c.color}`, c.urgent ? 'uc-priority-card--urgent' : '']"
            @click="router.push(c.route)"
            :title="`Aller à ${c.route}`">
            <span class="uc-priority-icon">{{ c.icon }}</span>
            <div class="uc-priority-body">
              <div class="uc-priority-label">{{ c.label }}</div>
              <div class="uc-priority-value">{{ c.value }}</div>
              <div v-if="c.detail" class="uc-priority-detail">{{ c.detail }}</div>
            </div>
            <svg v-if="c.urgent" class="uc-priority-pulse" width="6" height="6" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>
          </button>
        </div>
      </div>

      <!-- KPI Pédagogie : 5 cartes -->
      <div class="uc-kpi-grid" style="margin-bottom:16px;">
        <div class="uc-kpi-card blue" @click="router.push('/etudiants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">🎓</div>
          <div class="uc-kpi-label">Étudiants inscrits</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.etudiants_total ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Total des dossiers</div>
        </div>
        <div class="uc-kpi-card green" @click="router.push('/etudiants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">✅</div>
          <div class="uc-kpi-label">Inscriptions actives</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.inscriptions_actives ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-up">En cours de formation</div>
        </div>
        <div class="uc-kpi-card orange" @click="router.push('/etudiants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">⏳</div>
          <div class="uc-kpi-label">En attente</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.inscriptions_attente ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Pré-inscriptions</div>
        </div>
        <div class="uc-kpi-card red" @click="router.push('/etudiants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">🚫</div>
          <div class="uc-kpi-label">Abandons</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.inscriptions_abandonnees ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-down">{{ stats?.inscriptions_suspendues ? `+ ${stats.inscriptions_suspendues} suspendu(s)` : 'Cette année' }}</div>
        </div>
        <div class="uc-kpi-card purple" @click="router.push('/enseignants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">👨‍🏫</div>
          <div class="uc-kpi-label">Enseignants actifs</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.enseignants_actifs ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Stable</div>
        </div>
      </div>

      <!-- Widget Suivi des risques -->
      <div class="uc-risk-widget" @click="router.push('/etudiants')" style="cursor:pointer;margin-bottom:16px;">
        <div class="uc-risk-title">🚦 Suivi des risques d'abandon</div>
        <div class="uc-risk-grid">
          <div class="uc-risk-card uc-risk-card--red">
            <div class="uc-risk-val">{{ risqueCounts.red }}</div>
            <div class="uc-risk-lbl">🔴 Risque élevé</div>
            <div class="uc-risk-sub">Présence &lt; 50%, retard &gt; 30j ou dossier vide</div>
          </div>
          <div class="uc-risk-card uc-risk-card--yellow">
            <div class="uc-risk-val">{{ risqueCounts.yellow }}</div>
            <div class="uc-risk-lbl">🟡 À surveiller</div>
            <div class="uc-risk-sub">Présence 50-75%, retard 15-30j ou dossier partiel</div>
          </div>
          <div class="uc-risk-card uc-risk-card--green">
            <div class="uc-risk-val">{{ risqueCounts.green }}</div>
            <div class="uc-risk-lbl">🟢 Situation OK</div>
            <div class="uc-risk-sub">Présence ≥ 75%, paiements à jour, dossier complet</div>
          </div>
        </div>
      </div>

      <!-- Trésorerie (DG + resp_fin) -->
      <template v-if="canSeeFinance">
        <div class="uc-tres-card">
          <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;font-weight:600;">
            Solde de trésorerie en temps réel — Visible uniquement DG + Responsable Financier
          </div>
          <div style="font-size:32px;font-weight:700;color:#fff;margin-bottom:4px;">
            {{ loading ? '…' : fmt(stats?.solde_tresorerie ?? 0) }}
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);">
            ● Calcul : total recettes encaissées − total dépenses enregistrées
          </div>
          <div class="uc-tres-subgrid">
            <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">Encaissé ce mois</div>
              <div style="font-size:18px;font-weight:700;color:#4ade80;">{{ loading ? '…' : fmt(stats?.encaisse_ce_mois ?? 0) }}</div>
            </div>
            <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">Impayés en cours</div>
              <div style="font-size:18px;font-weight:700;color:#f87171;">{{ loading ? '…' : fmt(stats?.impayes_total ?? 0) }}</div>
            </div>
            <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">En attente confirmation</div>
              <div style="font-size:18px;font-weight:700;color:#fbbf24;">{{ loading ? '…' : stats?.paiements_en_attente ?? 0 }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- Grille inférieure -->
      <div class="uc-dash-bottom-grid">

        <!-- Derniers paiements -->
        <div class="uc-card" v-if="canSeeFinance">
          <div class="uc-card-header">
            <span class="uc-card-title">Paiements récents</span>
            <a class="uc-card-link" @click="router.push('/paiements')">Voir tout</a>
          </div>
          <div class="uc-card-body" style="padding:0;">
            <div v-if="loading" style="padding:16px 20px;font-size:12px;color:#aaa;">Chargement…</div>
            <div v-else-if="!stats?.derniers_paiements?.length" style="padding:16px 20px;font-size:12px;color:#aaa;">Aucun paiement.</div>
            <div v-else>
              <div v-for="p in stats?.derniers_paiements?.slice(0,5)" :key="p.id"
                style="display:flex;align-items:center;gap:10px;padding:9px 20px;border-bottom:1px solid #f5f5f5;cursor:pointer;"
                @click="router.push('/paiements')">
                <div style="width:30px;height:30px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#555;flex-shrink:0;">
                  {{ (p.inscription?.etudiant?.prenom?.[0] ?? '') + (p.inscription?.etudiant?.nom?.[0] ?? '') }}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:12px;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    {{ p.inscription?.etudiant?.prenom }} {{ p.inscription?.etudiant?.nom }}
                  </div>
                  <div style="font-size:10.5px;color:#aaa;">{{ modeLabel(p.mode_paiement) }}</div>
                </div>
                <div style="font-size:12.5px;font-weight:700;color:#22c55e;white-space:nowrap;">
                  +{{ fmt(p.montant) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Filières & Classes -->
        <div class="uc-card">
          <div class="uc-card-header">
            <span class="uc-card-title">Pédagogie</span>
            <a class="uc-card-link" @click="router.push('/filieres')">Voir filières</a>
          </div>
          <div class="uc-card-body">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f5f5f5;">
              <span style="font-size:12.5px;font-weight:600;color:#111;">Filières actives</span>
              <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.filieres_actives ?? 0 }}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f5f5f5;">
              <span style="font-size:12.5px;font-weight:600;color:#111;">Classes configurées</span>
              <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.classes_total ?? 0 }}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
              <span style="font-size:12.5px;font-weight:600;color:#111;">Enseignants actifs</span>
              <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.enseignants_actifs ?? 0 }}</span>
            </div>
          </div>
        </div>

        <!-- Actions rapides -->
        <div class="uc-card">
          <div class="uc-card-header">
            <span class="uc-card-title">Actions rapides</span>
          </div>
          <div class="uc-card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button @click="router.push('/etudiants')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">🎓</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Nouvel étudiant</div>
            </button>
            <button v-if="canSeeFinance" @click="router.push('/paiements')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">💰</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Saisir paiement</div>
            </button>
            <button @click="router.push('/enseignants')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">👨‍🏫</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Enseignants</div>
            </button>
            <button @click="router.push('/classes')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">🏫</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Classes</div>
            </button>
            <button v-if="canSeeFinance" @click="router.push('/depenses')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">📊</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Dépenses</div>
            </button>
            <button @click="router.push('/rapports')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">📈</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Rapports</div>
            </button>
          </div>
        </div>

      </div>

      <!-- ══════════════════════════════════════════════════════
           WIDGETS AVANCÉS
      ═══════════════════════════════════════════════════════ -->
      <div class="db-adv-grid">

        <!-- 1. Graphique évolution paiements -->
        <div class="uc-card db-adv-card" v-if="canSeeFinance">
          <div class="uc-card-header">
            <span class="uc-card-title">📈 Évolution des paiements</span>
            <span class="db-adv-period">6 derniers mois</span>
          </div>
          <div class="db-chart-wrap">
            <div v-if="loadingAvance" class="db-adv-loading">Chargement…</div>
            <template v-else>
              <svg :width="CHART_W" :height="CHART_H + 22" style="width:100%;overflow:visible;" viewBox="0 0 300 102">
                <!-- Lignes de grille -->
                <line x1="0" :y1="CHART_H - (CHART_H-10)*0.25" x2="300" :y2="CHART_H - (CHART_H-10)*0.25" stroke="#f1f5f9" stroke-width="1"/>
                <line x1="0" :y1="CHART_H - (CHART_H-10)*0.5"  x2="300" :y2="CHART_H - (CHART_H-10)*0.5"  stroke="#f1f5f9" stroke-width="1"/>
                <line x1="0" :y1="CHART_H - (CHART_H-10)*0.75" x2="300" :y2="CHART_H - (CHART_H-10)*0.75" stroke="#f1f5f9" stroke-width="1"/>
                <!-- Barres -->
                <g v-for="(bar, i) in chartBars" :key="i">
                  <rect
                    :x="bar.x" :y="bar.y" :width="bar.w" :height="bar.h"
                    :fill="bar.v === maxPaiement ? '#E30613' : '#fca5a5'"
                    rx="3"
                    style="transition:height 0.4s,y 0.4s;"
                  />
                  <!-- Mois label -->
                  <text :x="bar.x + bar.w/2" :y="CHART_H + 14" text-anchor="middle" font-size="9" fill="#9ca3af">
                    {{ fmtMoisCourt(bar.mois) }}
                  </text>
                  <!-- Montant au survol → tooltip via title -->
                  <title>{{ fmtMoisCourt(bar.mois) }} : {{ fmt(bar.v) }}</title>
                </g>
              </svg>
              <!-- Légende min/max -->
              <div class="db-chart-legend">
                <span>{{ fmt(0) }}</span>
                <span style="color:#E30613;font-weight:700;">Max : {{ fmt(maxPaiement) }}</span>
              </div>
              <!-- Totaux rapides -->
              <div class="db-chart-totals">
                <div v-for="bar in chartBars.slice(-3)" :key="bar.mois" class="db-chart-month-pill">
                  <span class="db-cmp-label">{{ fmtMoisCourt(bar.mois) }}</span>
                  <span class="db-cmp-val">{{ bar.v > 0 ? fmt(bar.v) : '—' }}</span>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- 2. Taux de remplissage des classes -->
        <div class="uc-card db-adv-card">
          <div class="uc-card-header">
            <span class="uc-card-title">🏫 Remplissage des classes</span>
            <a class="uc-card-link" @click="router.push('/classes')">Gérer →</a>
          </div>
          <div class="db-fill-list">
            <div v-if="loadingAvance" class="db-adv-loading">Chargement…</div>
            <div v-else-if="!classesRemplissage.length" class="db-adv-empty">Aucune classe configurée</div>
            <div v-else v-for="cl in classesRemplissage" :key="cl.id" class="db-fill-row">
              <div class="db-fill-info">
                <span class="db-fill-nom">{{ cl.nom }}</span>
                <span class="db-fill-count">{{ cl.inscrits }} / {{ cl.capacite }}</span>
              </div>
              <div class="db-fill-track">
                <div class="db-fill-bar" :style="{ width: remplissagePct(cl) + '%', background: remplissageColor(remplissagePct(cl)) }"></div>
              </div>
              <span class="db-fill-pct" :style="{ color: remplissageColor(remplissagePct(cl)) }">{{ remplissagePct(cl) }}%</span>
            </div>
          </div>
        </div>

        <!-- 3. Top 5 retards de paiement -->
        <div class="uc-card db-adv-card" v-if="canSeeFinance">
          <div class="uc-card-header">
            <span class="uc-card-title">⚠️ Top retards paiement</span>
            <a class="uc-card-link" @click="router.push('/paiements')">Voir tout →</a>
          </div>
          <div style="padding:0;">
            <div v-if="loadingAvance" class="db-adv-loading" style="padding:16px 20px;">Chargement…</div>
            <div v-else-if="!topRetards.length" class="db-adv-empty" style="padding:16px 20px;">
              <span>✅</span> Aucun retard — situation saine !
            </div>
            <div v-else v-for="(et, rank) in topRetards" :key="et.id"
              class="db-retard-row"
              @click="router.push('/etudiants')">
              <div class="db-retard-rank" :class="rank === 0 ? 'db-retard-rank--1' : rank === 1 ? 'db-retard-rank--2' : ''">
                {{ rank + 1 }}
              </div>
              <div class="db-retard-info">
                <span class="db-retard-nom">{{ et.prenom }} {{ et.nom }}</span>
                <span class="db-retard-num">{{ et.numero_etudiant }}</span>
              </div>
              <div class="db-retard-amounts">
                <span class="db-retard-montant">{{ fmt(et.montant_retard) }}</span>
                <span class="db-retard-mois">{{ et.nb_mois_retard }} mois</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 4. Taux de présence global -->
        <div class="uc-card db-adv-card">
          <div class="uc-card-header">
            <span class="uc-card-title">📋 Taux de présence</span>
            <span class="db-adv-period">3 derniers mois</span>
          </div>
          <div class="db-presence-wrap">
            <div v-if="loadingAvance" class="db-adv-loading">Chargement…</div>
            <template v-else>
              <div class="db-presence-gauge">
                <svg width="100" height="100" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" :r="presenceGaugeR" fill="none" stroke="#f1f5f9" stroke-width="8"/>
                  <circle cx="50" cy="50" :r="presenceGaugeR" fill="none"
                    :stroke="presenceColor"
                    stroke-width="8" stroke-linecap="round"
                    :stroke-dasharray="presenceCirc"
                    :stroke-dashoffset="presenceOffset"
                    transform="rotate(-90 50 50)"
                    style="transition:stroke-dashoffset 0.6s ease;"/>
                  <text x="50" y="45" text-anchor="middle" font-size="15" font-weight="800" :fill="presenceColor">
                    {{ tauxPresence !== null ? tauxPresence + '%' : 'N/A' }}
                  </text>
                  <text x="50" y="59" text-anchor="middle" font-size="7" fill="#9ca3af">présence</text>
                </svg>
              </div>
              <div class="db-presence-detail">
                <div class="db-pd-row">
                  <span class="db-pd-dot" style="background:#22c55e;"></span>
                  <span class="db-pd-lbl">Séances émargées</span>
                  <strong class="db-pd-val">{{ seancesEffectuees }}</strong>
                </div>
                <div class="db-pd-row">
                  <span class="db-pd-dot" style="background:#e5e7eb;"></span>
                  <span class="db-pd-lbl">Total séances passées</span>
                  <strong class="db-pd-val">{{ seancesTotalPassees }}</strong>
                </div>
                <div class="db-pd-status" :style="{ background: presenceColor + '18', color: presenceColor }">
                  {{ tauxPresence === null ? 'Pas encore de données' : tauxPresence >= 80 ? '✅ Taux satisfaisant' : tauxPresence >= 50 ? '⚠️ À améliorer' : '🔴 Taux insuffisant' }}
                </div>
              </div>
            </template>
          </div>
        </div>

      </div>

    </template>

  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════
   MES PRIORITÉS — widget par rôle
════════════════════════════════════════════════════════ */
.uc-priorities {
  background: linear-gradient(135deg, #0f172a, #1e293b);
  border-radius: 14px;
  padding: 16px 18px;
  margin-bottom: 18px;
  color: #fff;
}
.uc-priorities-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; margin-bottom: 12px; flex-wrap: wrap;
}
.uc-priorities-title {
  font-size: 15px; font-weight: 700; color: #fff;
}
.uc-priorities-sub {
  font-size: 12px; color: rgba(255, 255, 255, 0.5);
}
.uc-priorities-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.uc-priority-card {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  color: #fff;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: all 0.15s;
  overflow: hidden;
  min-width: 0;
}
.uc-priority-card:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateY(-1px);
  border-color: rgba(255, 255, 255, 0.18);
}
.uc-priority-icon {
  font-size: 22px;
  flex-shrink: 0;
  width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}
.uc-priority-body { flex: 1; min-width: 0; }
.uc-priority-label {
  font-size: 10.5px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: rgba(255, 255, 255, 0.55);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.uc-priority-value {
  font-size: 22px; font-weight: 800; color: #fff;
  margin-top: 1px; line-height: 1.1;
}
.uc-priority-detail {
  font-size: 10.5px; color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.uc-priority-card--red    .uc-priority-icon { background: rgba(220, 38, 38, 0.18); }
.uc-priority-card--red    .uc-priority-value { color: #fca5a5; }
.uc-priority-card--orange .uc-priority-icon { background: rgba(217, 119, 6, 0.18); }
.uc-priority-card--orange .uc-priority-value { color: #fcd34d; }
.uc-priority-card--green  .uc-priority-icon { background: rgba(22, 163, 74, 0.18); }
.uc-priority-card--green  .uc-priority-value { color: #86efac; }
.uc-priority-card--blue   .uc-priority-icon { background: rgba(37, 99, 235, 0.18); }
.uc-priority-card--blue   .uc-priority-value { color: #93c5fd; }
.uc-priority-card--purple .uc-priority-icon { background: rgba(147, 51, 234, 0.18); }
.uc-priority-card--purple .uc-priority-value { color: #d8b4fe; }

.uc-priority-card--urgent {
  border-color: rgba(239, 68, 68, 0.35);
  box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.15);
}
.uc-priority-pulse {
  position: absolute; top: 8px; right: 8px;
  fill: #ef4444;
  animation: uc-pulse 1.8s ease-in-out infinite;
}
@keyframes uc-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(1.4); }
}

/* ═══════════════════════════════════════════════════════
   DASHBOARD ENSEIGNANT — VERSION MAXIMALE
════════════════════════════════════════════════════════ */

/* ── HERO ── */
.db-hero {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1a0a0a 100%);
  border-radius: 16px; margin-bottom: 14px; color: #fff;
}
.db-hero-glow {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 80% 40%, rgba(227,6,19,.2) 0%, transparent 65%);
  pointer-events: none;
}
.db-hero-content {
  position: relative; display: flex; align-items: center;
  justify-content: space-between; gap: 20px;
  padding: 24px 28px; flex-wrap: wrap;
}
.db-hero-left { display: flex; align-items: center; gap: 18px; }
.db-avatar {
  width: 62px; height: 62px; border-radius: 50%;
  background: linear-gradient(135deg, #E30613, #b91c1c);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 800; color: #fff; flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(255,255,255,.12);
}
.db-hero-info { display: flex; flex-direction: column; gap: 5px; }
.db-greeting { font-size: 12px; color: rgba(255,255,255,.45); margin: 0; }
.db-hero-name { font-size: 22px; font-weight: 800; color: #fff; margin: 0; }
.db-hero-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.db-tag { font-size: 11.5px; font-weight: 600; padding: 3px 11px; border-radius: 20px; }
.db-tag--red { background: #E30613; color: #fff; }
.db-tag--ghost { background: rgba(255,255,255,.1); color: rgba(255,255,255,.65); }

.db-hero-kpis { display: flex; gap: 10px; }
.db-hkpi {
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
  border-radius: 12px; padding: 14px 18px; text-align: center; min-width: 70px;
}
.db-hkpi-val { font-size: 20px; font-weight: 800; color: #fff; }
.db-hkpi-lbl { font-size: 10px; color: rgba(255,255,255,.45); margin-top: 4px; white-space: nowrap; }

/* Prochain cours strip */
.db-hero-next {
  position: relative; border-top: 1px solid rgba(255,255,255,.08);
  padding: 12px 28px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.db-hero-next-label { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.4); text-transform: uppercase; letter-spacing: 1px; white-space: nowrap; }
.db-hero-next-body { display: flex; align-items: center; gap: 10px; flex: 1; flex-wrap: wrap; }
.db-hero-next-mode { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
.db-hero-next-name { font-size: 14px; font-weight: 700; color: #fff; }
.db-hero-next-time { font-size: 12px; color: rgba(255,255,255,.5); }
.db-hero-next-class { font-size: 11px; color: rgba(255,255,255,.4); }
.db-hero-countdown {
  font-size: 12px; font-weight: 700; color: #fbbf24;
  background: rgba(251,191,36,.12); border-radius: 20px; padding: 3px 12px; white-space: nowrap;
}

/* ── ALERT ── */
.db-alert {
  display: flex; align-items: center; gap: 12px;
  background: #fffbeb; border: 1.5px solid #fde68a; border-radius: 12px;
  padding: 14px 18px; margin-bottom: 14px; cursor: pointer;
  transition: box-shadow .15s;
}
.db-alert:hover { box-shadow: 0 4px 14px rgba(245,158,11,.15); }
.db-alert-icon { font-size: 22px; flex-shrink: 0; }
.db-alert-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.db-alert-body strong { font-size: 13px; font-weight: 700; color: #92400e; }
.db-alert-body span { font-size: 11.5px; color: #b45309; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-alert-cta { font-size: 12px; font-weight: 700; color: #d97706; white-space: nowrap; flex-shrink: 0; }

/* ── AVOIRS banner ── */
.db-avoirs {
  background: linear-gradient(135deg, #0f172a, #1e293b);
  border-radius: 14px; padding: 18px 24px; margin-bottom: 14px; color: #fff;
}
.db-avoirs-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}
.db-avoirs-title { font-size: 13px; font-weight: 700; color: rgba(255,255,255,.7); display: flex; align-items: center; gap: 8px; }
.db-avoirs-link {
  font-size: 11.5px; font-weight: 600; color: rgba(255,255,255,.4);
  background: none; border: none; cursor: pointer;
}
.db-avoirs-link:hover { color: rgba(255,255,255,.75); }
.db-avoirs-body { display: flex; flex-direction: column; gap: 14px; }
.db-avoirs-kpis { display: flex; flex-wrap: wrap; gap: 0; }
.db-akpi { display: flex; flex-direction: column; gap: 3px; padding: 0 20px; border-right: 1px solid rgba(255,255,255,.1); }
.db-akpi:first-child { padding-left: 0; }
.db-akpi:last-child { border-right: none; }
.db-akpi-val { font-size: 18px; font-weight: 800; color: #f1f5f9; transition: filter .25s; }
.db-akpi-secret { transition: filter .25s; }
.db-akpi-masked { filter: blur(6px); user-select: none; opacity: .7; }
.db-akpi-lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .4px; }
.db-akpi--green .db-akpi-val { color: #4ade80; }
.db-akpi--blue  .db-akpi-val { color: #60a5fa; }
.db-akpi--red   .db-akpi-val { color: #f87171; }
/* Barre progression */
.db-avoirs-progress-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
.db-avoirs-track { height: 6px; background: rgba(255,255,255,.1); border-radius: 999px; overflow: hidden; }
.db-avoirs-fill { height: 100%; background: linear-gradient(90deg, #4ade80, #22c55e); border-radius: 999px; transition: width .5s ease; }
.db-avoirs-empty { font-size: 12px; color: rgba(255,255,255,.3); }

/* ── QUICK ACTIONS ── */
.db-quick-actions {
  display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap;
}
.db-qa {
  flex: 1; min-width: 80px;
  display: flex; flex-direction: column; align-items: center; gap: 5px;
  padding: 12px 10px; background: #fff; border: 1.5px solid #e5e7eb; border-radius: 12px;
  font-size: 12px; font-weight: 600; color: #374151; cursor: pointer;
  transition: all .15s; font-family: 'Poppins', sans-serif;
}
.db-qa:hover { border-color: #E30613; color: #E30613; background: #fff5f5; }
.db-qa--primary { background: #fff0f0; border-color: #fca5a5; color: #E30613; }
.db-qa--primary:hover { background: #fee2e2; border-color: #E30613; }
.db-qa-icon { font-size: 22px; }

/* ── GRILLE ── */
.db-grid { display: grid; grid-template-columns: 1fr 280px; gap: 16px; align-items: start; }
.db-col-left { display: flex; flex-direction: column; gap: 14px; }
.db-col-right { display: flex; flex-direction: column; gap: 14px; }

/* ── CARDS ── */
.db-card {
  background: #fff; border-radius: 12px; border: 1px solid #f0f0f0;
  overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.db-card--side {}
.db-card-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 18px; border-bottom: 1px solid #f4f4f5;
}
.db-card-header-left { display: flex; align-items: center; gap: 8px; }
.db-card-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.db-card-title { font-size: 13.5px; font-weight: 700; color: #111; }
.db-card-link {
  font-size: 12px; font-weight: 600; color: #E30613;
  background: none; border: none; cursor: pointer;
}
.db-card-link:hover { text-decoration: underline; }
.db-card-period { font-size: 11px; color: #9ca3af; background: #f8fafc; padding: 2px 8px; border-radius: 20px; }

/* ── TIMELINE aujourd'hui ── */
.db-timeline { display: flex; flex-direction: column; }
.db-tl-item {
  display: flex; align-items: center; gap: 0;
  border-bottom: 1px solid #f4f4f5; cursor: pointer;
  transition: background .12s; overflow: hidden;
}
.db-tl-item:last-child { border-bottom: none; }
.db-tl-item:hover { background: #fafafa; }
.db-tl-item--done { opacity: .65; }
.db-tl-item--live { background: #fff5f5; }
.db-tl-stripe { width: 4px; align-self: stretch; background: var(--tl-clr, linear-gradient(135deg,#6366f1,#4f46e5)); flex-shrink: 0; }
.db-tl-time {
  padding: 12px 14px; min-width: 52px; text-align: center; flex-shrink: 0;
  display: flex; flex-direction: column; align-items: center; gap: 2px;
}
.db-tl-h { font-size: 12px; font-weight: 700; color: #E30613; }
.db-tl-dur { font-size: 9.5px; color: #9ca3af; }
.db-tl-body { flex: 1; padding: 12px 0; min-width: 0; }
.db-tl-matiere { font-size: 13px; font-weight: 700; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-tl-meta { font-size: 11px; color: #64748b; margin-top: 2px; }
.db-tl-right { padding: 12px 14px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.db-live-badge {
  font-size: 10.5px; font-weight: 700; color: #fff;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  border-radius: 20px; padding: 3px 9px;
  animation: pulse-live 1.5s ease-in-out infinite;
}
@keyframes pulse-live { 0%,100% { opacity: 1 } 50% { opacity: .6 } }

/* ── PROCHAINES SÉANCES ── */
.db-upcoming-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 18px; border-bottom: 1px solid #f4f4f5;
  cursor: pointer; transition: background .12s;
  border-left: 3px solid var(--u-clr, #6366f1);
}
.db-upcoming-row:last-child { border-bottom: none; }
.db-upcoming-row:hover { background: #fafafa; }
.db-upcoming-date { min-width: 36px; text-align: center; background: #f8fafc; border-radius: 8px; padding: 5px 6px; flex-shrink: 0; }
.db-upcoming-day { font-size: 16px; font-weight: 800; color: #111; line-height: 1; }
.db-upcoming-mon { font-size: 9.5px; color: #888; text-transform: uppercase; }
.db-upcoming-info { flex: 1; min-width: 0; }
.db-upcoming-matiere { font-size: 13px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-upcoming-meta { font-size: 11px; color: #888; margin-top: 1px; }
.db-upcoming-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.db-mode-chip { width: 26px; height: 26px; border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }

/* ── BADGES ── */
.db-badge { font-size: 10px; font-weight: 700; border-radius: 20px; padding: 3px 9px; white-space: nowrap; flex-shrink: 0; }
.db-badge-gray   { background: #f3f4f6; color: #6b7280; }
.db-badge-blue   { background: #dbeafe; color: #1d4ed8; }
.db-badge-green  { background: #dcfce7; color: #15803d; }
.db-badge-red    { background: #fee2e2; color: #b91c1c; }
.db-badge-orange { background: #fff7ed; color: #c2410c; }

/* ── GAUGE émargement ── */
.db-gauge-wrap { display: flex; justify-content: center; margin-bottom: 14px; }
.db-gauge-detail { display: flex; flex-direction: column; gap: 7px; }
.db-gauge-row { display: flex; align-items: center; gap: 8px; }
.db-gauge-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.db-gauge-lbl { font-size: 12px; color: #555; flex: 1; }
.db-gauge-val { font-size: 13px; font-weight: 700; color: #111; }

/* ── MATIÈRES ── */
.db-matieres-list { display: flex; flex-direction: column; }
.db-matiere-row {
  display: flex; align-items: center; gap: 0;
  border-bottom: 1px solid #f4f4f5; overflow: hidden;
}
.db-matiere-row:last-child { border-bottom: none; }
.db-matiere-stripe { width: 3px; background: var(--m-clr, #6366f1); align-self: stretch; flex-shrink: 0; }
.db-matiere-info { flex: 1; padding: 10px 14px; min-width: 0; }
.db-matiere-nom { font-size: 12.5px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-matiere-meta { font-size: 10.5px; color: #888; margin-top: 1px; }
.db-ue-code-chip { font-size: 9.5px; font-weight: 800; background: #E30613; color: #fff; border-radius: 6px; padding: 2px 7px; margin-right: 14px; flex-shrink: 0; white-space: nowrap; }

/* ── CLASSES ── */
.db-classe-row { display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #f4f4f5; }
.db-classe-row:last-child { border-bottom: none; }
.db-classe-av {
  width: 34px; height: 34px; border-radius: 9px;
  background: linear-gradient(135deg, #dbeafe, #bfdbfe);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 800; color: #1d4ed8; flex-shrink: 0;
}
.db-classe-nom { flex: 1; font-size: 13px; font-weight: 600; color: #111; }
.db-classe-count { font-size: 11px; color: #888; background: #f5f5f5; border-radius: 20px; padding: 2px 9px; }

/* ── EMPTY STATES ── */
.db-empty { padding: 20px; text-align: center; font-size: 12.5px; color: #aaa; }
.db-empty-illus { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 16px; font-size: 13px; color: #bbb; }
.db-empty-illus span { font-size: 32px; }

/* ─── Dashboard Admin (existant) ───────────────────────── */
.uc-risk-widget {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 16px 20px; transition: box-shadow 0.15s;
}
.uc-risk-widget:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.07); }
.uc-risk-title { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 12px; }
.uc-risk-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.uc-risk-card { border-radius: 10px; padding: 12px 14px; }
.uc-risk-card--red    { background: #fef2f2; border: 1px solid #fecaca; }
.uc-risk-card--yellow { background: #fffbeb; border: 1px solid #fde68a; }
.uc-risk-card--green  { background: #f0fdf4; border: 1px solid #bbf7d0; }
.uc-risk-val { font-size: 28px; font-weight: 800; color: #111; line-height: 1; }
.uc-risk-card--red    .uc-risk-val { color: #b91c1c; }
.uc-risk-card--yellow .uc-risk-val { color: #92400e; }
.uc-risk-card--green  .uc-risk-val { color: #15803d; }
.uc-risk-lbl { font-size: 12px; font-weight: 700; margin: 4px 0 2px; }
.uc-risk-sub { font-size: 10.5px; color: #888; line-height: 1.4; }
@media (max-width: 768px) { .uc-risk-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px)  { .uc-risk-grid { grid-template-columns: 1fr; } }

/* ═══════════════════════════════════════
   RESPONSIVE TABLETTE (≤ 900px)
═══════════════════════════════════════ */
@media (max-width: 900px) {
  .db-grid { grid-template-columns: 1fr; }
  .db-col-right { flex-direction: row; flex-wrap: wrap; }
  .db-col-right .db-card--side { flex: 1; min-width: 240px; }
}

/* ═══════════════════════════════════════
   RESPONSIVE MOBILE (≤ 768px)
═══════════════════════════════════════ */
@media (max-width: 768px) {
  /* Hero */
  .db-hero-content { flex-direction: column; align-items: flex-start; padding: 18px 20px; gap: 16px; }
  .db-hero-kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; width: 100%; }
  .db-hkpi { min-width: unset; }
  .db-hero-name { font-size: 18px; }
  .db-avatar { width: 52px; height: 52px; font-size: 18px; }

  /* Prochain cours strip */
  .db-hero-next { flex-wrap: wrap; padding: 10px 20px; gap: 8px; }
  .db-hero-next-body { flex-wrap: wrap; gap: 6px; }

  /* Alert */
  .db-alert { flex-wrap: wrap; gap: 8px; }
  .db-alert-body span { white-space: normal; }

  /* Avoirs */
  .db-avoirs { padding: 14px 16px; }
  .db-avoirs-kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 0; }
  .db-akpi { padding: 0 10px; border-right: none; }
  .db-akpi:nth-child(3n) { border-right: none; }

  /* Grille → 1 colonne */
  .db-grid { grid-template-columns: 1fr; gap: 12px; }
  .db-col-right { flex-direction: column; }

  /* Quick actions */
  .db-quick-actions { gap: 8px; }
  .db-qa { min-width: 70px; }

  /* Classes */
  .db-classe-nom { font-size: 12px; }
}

/* ═══════════════════════════════════════
   RESPONSIVE TÉLÉPHONE (≤ 480px)
═══════════════════════════════════════ */
@media (max-width: 480px) {
  /* Base */
  .uc-content { padding: 12px; }

  /* Hero */
  .db-hero { border-radius: 12px; }
  .db-hero-content { padding: 14px 16px; }
  .db-hero-name { font-size: 16px; }
  .db-avatar { width: 44px; height: 44px; font-size: 16px; }
  .db-hero-kpis { grid-template-columns: repeat(2, 1fr); gap: 6px; }
  .db-hkpi { padding: 10px 12px; }
  .db-hkpi-val { font-size: 16px; }
  .db-hkpi-lbl { font-size: 9px; }

  /* Avoirs → 2 colonnes */
  .db-avoirs { padding: 12px 14px; border-radius: 12px; }
  .db-avoirs-kpis { grid-template-columns: repeat(2, 1fr); }
  .db-akpi-val { font-size: 16px; }
  .db-akpi-lbl { font-size: 9px; }

  /* Alert */
  .db-alert { padding: 10px 12px; }
  .db-alert-body strong { font-size: 12px; }

  /* Quick actions → 2×2 */
  .db-quick-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .db-qa { min-width: unset; }

  /* Upcoming */
  .db-upcoming-row { padding: 9px 12px; }
  .db-upcoming-matiere { font-size: 12px; }

  /* Badges */
  .db-badge { font-size: 9px; padding: 2px 7px; }

  /* Admin risk grid */
  .uc-risk-grid { grid-template-columns: 1fr; }
}

/* ── Formations individuelles prof ── */
.db-section { background:#fff; border:1.5px solid #e5e7eb; border-radius:12px; padding:18px; }
.db-section-title { font-size:15px; font-weight:700; color:#111; margin:0 0 14px; }
.db-fi-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px; }
.db-fi-card { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:14px; }
.db-fi-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.db-fi-matiere { font-weight:700; font-size:14px; color:#1e293b; }
.db-fi-badge { font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px; }
.db-fi-student { font-size:12px; color:#64748b; margin-bottom:10px; }
.db-fi-progress { display:flex; align-items:center; gap:10px; }
.db-fi-bar { flex:1; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden; }
.db-fi-fill { height:100%; border-radius:3px; transition:width .3s; }
.db-fi-hours { font-size:11px; color:#64748b; font-weight:500; white-space:nowrap; }

/* ══════��════════════════════════════════════��══════════════════
   WIDGETS AVANCÉS DASHBOARD ADMIN
═══════════════════════════════════════════════════��═══════════ */
.db-adv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 14px;
}
.db-adv-card { min-height: 200px; }
.db-adv-period { font-size: 10.5px; color: #9ca3af; font-weight: 500; }
.db-adv-loading { padding: 24px 16px; font-size: 12px; color: #aaa; text-align: center; }
.db-adv-empty { font-size: 12px; color: #aaa; padding: 24px 16px; text-align: center; }

/* ── Graphique barres ── */
.db-chart-wrap { padding: 14px 16px 10px; }
.db-chart-legend {
  display: flex; justify-content: space-between;
  font-size: 10px; color: #9ca3af; margin-top: 4px;
}
.db-chart-totals {
  display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;
}
.db-chart-month-pill {
  display: flex; flex-direction: column; align-items: center;
  background: #f9fafb; border: 1px solid #f0f0f0;
  border-radius: 8px; padding: 6px 10px; min-width: 70px;
}
.db-cmp-label { font-size: 10px; color: #9ca3af; text-transform: capitalize; }
.db-cmp-val { font-size: 11.5px; font-weight: 700; color: #111; margin-top: 2px; }

/* ── Remplissage classes ── */
.db-fill-list { padding: 8px 16px 12px; display: flex; flex-direction: column; gap: 10px; }
.db-fill-row { display: flex; align-items: center; gap: 8px; }
.db-fill-info { display: flex; flex-direction: column; min-width: 100px; }
.db-fill-nom { font-size: 11.5px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 110px; }
.db-fill-count { font-size: 10px; color: #9ca3af; }
.db-fill-track { flex: 1; height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; }
.db-fill-bar { height: 100%; border-radius: 3px; transition: width 0.5s ease; }
.db-fill-pct { font-size: 11px; font-weight: 700; min-width: 34px; text-align: right; }

/* ── Top retards ── */
.db-retard-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 16px; border-bottom: 1px solid #f5f5f5;
  cursor: pointer; transition: background 0.12s;
}
.db-retard-row:hover { background: #fff9f9; }
.db-retard-rank {
  width: 22px; height: 22px; border-radius: 50%;
  background: #f1f5f9; display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #6b7280; flex-shrink: 0;
}
.db-retard-rank--1 { background: #fef2f2; color: #E30613; }
.db-retard-rank--2 { background: #fff7ed; color: #f97316; }
.db-retard-info { flex: 1; min-width: 0; }
.db-retard-nom { font-size: 12px; font-weight: 600; color: #111; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.db-retard-num { font-size: 10px; color: #9ca3af; }
.db-retard-amounts { text-align: right; }
.db-retard-montant { font-size: 12px; font-weight: 700; color: #E30613; display: block; }
.db-retard-mois { font-size: 10px; color: #9ca3af; }

/* ── Présence gauge ── */
.db-presence-wrap { display: flex; align-items: center; gap: 16px; padding: 14px 16px; }
.db-presence-gauge { flex-shrink: 0; }
.db-presence-detail { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.db-pd-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; }
.db-pd-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.db-pd-lbl { flex: 1; color: #6b7280; }
.db-pd-val { font-weight: 700; color: #111; }
.db-pd-status {
  font-size: 11px; font-weight: 600; padding: 5px 10px;
  border-radius: 6px; margin-top: 4px; text-align: center;
}

/* ── Responsive ── */
@media (max-width: 900px) {
  .db-adv-grid { grid-template-columns: 1fr; }
}
@media (max-width: 640px) {
  .db-presence-wrap { flex-direction: column; align-items: flex-start; }
}
</style>
