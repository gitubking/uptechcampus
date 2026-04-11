<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'

const auth = useAuthStore()
const isEnseignant = computed(() => auth.user?.role === 'enseignant')
const canWrite = computed(() =>
  ['dg', 'dir_peda', 'coordinateur', 'secretariat', 'enseignant'].includes(auth.user?.role ?? '')
)
// Profil enseignant connecté (pour filtrer ses séances)
const monEnseignantId = ref<number | null>(null)
const showConfirmEmarger = ref(false)
const errorEmarger = ref('')

interface Seance {
  id: number
  matiere: string
  date_debut: string
  date_fin: string
  mode: string
  statut: string
  notes?: string
  contenu_seance?: string
  objectifs?: string
  chapitre?: string
  objectifs_atteints?: 'oui' | 'partiel' | 'non' | null
  remarques?: string
  signe_enseignant_at?: string
  signe_enseignant_id?: number
  classe?: { id: number; nom: string }
  enseignant?: { id: number; nom: string; prenom: string }
  fi_module_id?: number | null
}
interface Inscription {
  id: number
  etudiant: { nom: string; prenom: string; numero_etudiant?: string }
  classe?: { id: number; nom: string }
}
interface Presence {
  seance_id: number
  inscription_id: number
  statut: 'present' | 'retard' | 'absent' | 'excuse'
  heure_arrivee?: string
}

const seances        = ref<Seance[]>([])
const classes        = ref<{ id: number; nom: string }[]>([])
const inscriptions   = ref<Inscription[]>([])
const loading        = ref(true)
const loadingInscrits = ref(false)
const saving         = ref(false)
const savingContenu  = ref(false)
const success        = ref(false)
const successContenu = ref(false)

// Avoirs enseignant
const mesStats = ref<{
  heures_total: number; heures_ce_mois: number
  tarif_horaire: number; montant_du: number
  montant_du_classique: number; montant_du_fi: number
  montant_paye: number; montant_restant: number
  fi_heures_total: number; fi_heures_effectuees: number
  fi_nb_modules: number; fi_tarif_horaire: number
} | null>(null)

const filterClasse = ref('')
const filterDate   = ref(new Date().toISOString().slice(0, 10))
const filterStatut = ref('')
const selectedSeance = ref<Seance | null>(null)

// Présences locales
const localPresences = ref<Record<number, 'present' | 'retard' | 'absent' | 'excuse'>>({})

// Contenu de séance
const contenuForm = ref({ contenu_seance: '', objectifs: '', chapitre: '', objectifs_atteints: '', remarques: '' })

// Today's date string (YYYY-MM-DD)
const todayStr = new Date().toISOString().slice(0, 10)

// ── Live ticker ──
const now = ref(new Date())
let ticker: ReturnType<typeof setInterval> | null = null

// Séance currently in progress (for enseignant)
const seanceEnCours = computed(() =>
  seancesAEmarger.value.find(s =>
    new Date(s.date_debut) <= now.value && new Date(s.date_fin) >= now.value
  ) ?? null
)

// Countdown to next séance (for enseignant)
const prochainSeance = computed(() =>
  [...seancesAEmarger.value]
    .filter(s => new Date(s.date_debut) > now.value)
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))[0] ?? null
)

const countdownText = computed(() => {
  if (seanceEnCours.value) return 'En cours'
  if (!prochainSeance.value) return null
  const diff = new Date(prochainSeance.value.date_debut).getTime() - now.value.getTime()
  if (diff <= 0) return 'En cours'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  if (h >= 24) { const d = Math.floor(h / 24); return `Dans ${d}j ${h % 24}h` }
  if (h > 0) return `Dans ${h}h ${m}min`
  if (m > 0) return `Dans ${m}min ${s}s`
  return `Dans ${s}s`
})

// Urgency of a séance card
function seanceUrgency(s: Seance): 'live' | 'overdue' | 'today' | 'future' {
  const fin = new Date(s.date_fin)
  const debut = new Date(s.date_debut)
  if (debut <= now.value && fin >= now.value) return 'live'
  if (fin < now.value) return 'overdue'
  if (s.date_debut.slice(0, 10) === todayStr) return 'today'
  return 'future'
}

// Search within séances cards
const searchMatiere = ref('')
const seancesAEmargerFiltrees = computed(() =>
  seancesAEmarger.value
    .filter(s => !searchMatiere.value || s.matiere.toLowerCase().includes(searchMatiere.value.toLowerCase()))
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))
)

// Search within student list in presence panel
const searchStudent = ref('')
const inscriptionsFiltrees = computed(() =>
  !searchStudent.value
    ? inscriptions.value
    : inscriptions.value.filter(i =>
        (i.etudiant.prenom + ' ' + i.etudiant.nom).toLowerCase().includes(searchStudent.value.toLowerCase())
      )
)

// SVG gauge for taux présence
const RADIUS_P = 38
const CIRC_P = 2 * Math.PI * RADIUS_P
const gaugeOffsetP = computed(() => CIRC_P - (tauxPresence.value / 100) * CIRC_P)
const gaugeColorP = computed(() =>
  tauxPresence.value >= 80 ? '#22c55e' : tauxPresence.value >= 50 ? '#f97316' : '#E30613'
)

// Monthly grouping for historique
const historiqueParMois = computed(() => {
  const map = new Map<string, { label: string; seances: typeof historiqueEmargements.value; heures: number }>()
  for (const s of historiqueEmargements.value) {
    const d = new Date(s.date_debut)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    if (!map.has(key)) map.set(key, { label, seances: [], heures: 0 })
    const entry = map.get(key)!
    entry.seances.push(s)
    entry.heures += (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 3600000
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, v]) => v)
})

// Mode helpers
function modeGrad(mode: string) {
  return ({
    presentiel: 'linear-gradient(135deg,#10b981,#059669)',
    en_ligne: 'linear-gradient(135deg,#3b82f6,#1d4ed8)',
    hybride: 'linear-gradient(135deg,#f59e0b,#d97706)',
    exam: 'linear-gradient(135deg,#ef4444,#dc2626)',
  } as any)[mode] ?? 'linear-gradient(135deg,#6366f1,#4f46e5)'
}
function modeIcon(mode: string) {
  return ({ presentiel: '🏫', en_ligne: '💻', hybride: '🔀', exam: '📝' } as any)[mode] ?? '📌'
}
function modeLabel(mode: string) {
  return ({ presentiel: 'Présentiel', en_ligne: 'En ligne', hybride: 'Hybride', exam: 'Examen' } as any)[mode] ?? mode
}

const seancesFiltrees = computed(() => {
  return seances.value.filter(s => {
    // Prof : ne voir que ses séances
    // Inclure aussi les séances de sa classe où enseignant_id est null (affectation de classe)
    if (isEnseignant.value && monEnseignantId.value) {
      const estSonProf = Number(s.enseignant?.id) === monEnseignantId.value
      const estSaClasse = mesClasseIds.value.includes(Number(s.classe?.id))
      if (!estSonProf && !estSaClasse) return false
    }
    if (filterClasse.value && String(s.classe?.id) !== String(filterClasse.value)) return false
    if (filterStatut.value && s.statut !== filterStatut.value) return false
    if (filterDate.value) {
      // Comparer YYYY-MM-DD du timestamp (robuste face aux fuseaux horaires)
      const raw = String(s.date_debut)
      const seanceDate = raw.length >= 10 ? raw.slice(0, 10) : ''
      return seanceDate === filterDate.value
    }
    return true
  })
})

// IDs des classes du prof (pour afficher ses séances même si enseignant_id non renseigné)
const mesClasseIds = computed<number[]>(() => {
  if (!isEnseignant.value || !monEnseignantId.value) return []
  return [...new Set(
    seances.value
      .filter(s => Number(s.enseignant?.id) === monEnseignantId.value)
      .map(s => Number(s.classe?.id))
      .filter(id => id > 0)
  )]
})

const compteurs = computed(() => {
  const vals = Object.values(localPresences.value)
  return {
    present: vals.filter(v => v === 'present').length,
    retard:  vals.filter(v => v === 'retard').length,
    absent:  vals.filter(v => v === 'absent').length,
    excuse:  vals.filter(v => v === 'excuse').length,
    total:   inscriptions.value.length,
  }
})

const tauxPresence = computed(() => {
  if (!compteurs.value.total) return 0
  return Math.round((compteurs.value.present + compteurs.value.retard) / compteurs.value.total * 100)
})

const estCloturee = computed(() => selectedSeance.value?.statut === 'effectue')
const seanceEstFuture = computed(() =>
  selectedSeance.value ? new Date(selectedSeance.value.date_debut) > now.value : false
)

function fmtTime(dt: string) {
  return new Date(dt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(dt: string) {
  return new Date(dt).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
}
function fmtDateTime(dt: string) {
  return new Date(dt).toLocaleString('fr-FR', { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

function statutBadge(s: string) {
  const map: Record<string, string> = {
    planifie: 'em-badge-planifie',
    confirme: 'em-badge-confirme',
    effectue: 'em-badge-effectue',
    annule:   'em-badge-annule',
    reporte:  'em-badge-reporte',
  }
  return map[s] ?? 'em-badge-planifie'
}
function statutLabel(s: string) {
  return { planifie: 'Planifiée', confirme: 'Confirmée', effectue: '✓ Émargée', annule: 'Annulée', reporte: 'Reportée' }[s] ?? s
}

function setPresence(id: number, st: 'present' | 'retard' | 'absent' | 'excuse') {
  if (estCloturee.value) return
  localPresences.value[id] = st
}
function marquerTousPresents() {
  if (estCloturee.value) return
  inscriptions.value.forEach(i => { localPresences.value[i.id] = 'present' })
}

async function selectSeance(s: Seance) {
  searchStudent.value = ''
  selectedSeance.value = s
  contenuForm.value = {
    contenu_seance:      s.contenu_seance ?? '',
    objectifs:           s.objectifs ?? '',
    chapitre:            s.chapitre ?? '',
    objectifs_atteints:  s.objectifs_atteints ?? '',
    remarques:           s.remarques ?? '',
  }
  loadingInscrits.value = true
  try {
    // Pour les séances FI : charger uniquement l'étudiant concerné
    const iPromise = s.fi_module_id
      ? api.get(`/seances/${s.id}/fi-etudiant`)
      : api.get('/inscriptions', { params: { classe_id: s.classe?.id, statut: 'inscrit_actif' } })
    const [iRes, pRes] = await Promise.all([
      iPromise,
      api.get(`/seances/${s.id}/presences`),
    ])
    inscriptions.value = iRes.data.data ?? iRes.data
    const presenceMap: Record<number, Presence> = {}
    ;(pRes.data as Presence[]).forEach(p => { presenceMap[p.inscription_id] = p })
    localPresences.value = {}
    inscriptions.value.forEach(i => {
      localPresences.value[i.id] = presenceMap[i.id]?.statut ?? 'absent'
    })
  } finally {
    loadingInscrits.value = false
  }
}

async function sauvegarderPresences() {
  if (!selectedSeance.value) return
  saving.value = true; success.value = false
  try {
    const payload = inscriptions.value.map(i => ({
      inscription_id: i.id,
      statut: localPresences.value[i.id] ?? 'absent',
    }))
    await api.post(`/seances/${selectedSeance.value.id}/presences`, { presences: payload })
    success.value = true
    setTimeout(() => { success.value = false }, 3000)
  } finally { saving.value = false }
}

async function sauvegarderContenu() {
  if (!selectedSeance.value) return
  savingContenu.value = true; successContenu.value = false
  try {
    await api.post(`/seances/${selectedSeance.value.id}/contenu`, contenuForm.value)
    successContenu.value = true
    selectedSeance.value.contenu_seance = contenuForm.value.contenu_seance
    selectedSeance.value.objectifs = contenuForm.value.objectifs
    setTimeout(() => { successContenu.value = false }, 3000)
  } finally { savingContenu.value = false }
}

function demanderEmarger() {
  if (!selectedSeance.value) return
  if (seanceEstFuture.value) return
  showConfirmEmarger.value = true
}

async function emargerEtCloturer() {
  if (!selectedSeance.value) return
  if (seanceEstFuture.value) return
  showConfirmEmarger.value = false
  errorEmarger.value = ''
  saving.value = true
  try {
    const payload = inscriptions.value.map(i => ({
      inscription_id: i.id,
      statut: localPresences.value[i.id] ?? 'absent',
    }))
    const { data } = await api.post(`/seances/${selectedSeance.value.id}/emarger`, {
      ...contenuForm.value,
      presences: payload,
      enseignant_id: selectedSeance.value.enseignant?.id ?? null,
    })
    // Mettre à jour la séance localement
    selectedSeance.value = { ...selectedSeance.value, ...data }
    const idx = seances.value.findIndex(s => s.id === data.id)
    if (idx !== -1) seances.value[idx] = { ...seances.value[idx], ...data }
  } catch (e: any) {
    errorEmarger.value = e?.response?.data?.message ?? 'Erreur lors de l\'émargement. Réessayez.'
  } finally { saving.value = false }
}

async function load() {
  if (!auth.user) return
  loading.value = true
  try {
    // Toujours charger toutes les séances + toutes les classes
    const [sRes, cRes] = await Promise.all([
      api.get('/seances'),
      api.get('/classes'),
    ])
    seances.value = sRes.data
    classes.value = cRes.data

    // Si enseignant : récupérer son ID profil pour filtrer côté client
    if (isEnseignant.value) {
      try {
        const { data: profil } = await api.get('/enseignants/me')
        // Forcer en number pour éviter "1" (string) !== 1 (number)
        monEnseignantId.value = profil.id ? Number(profil.id) : null

        // Charger les stats / avoirs de ce prof
        try {
          const { data: stats } = await api.get(`/enseignants/${profil.id}/stats`)
          mesStats.value = stats
        } catch {}

        // Restreindre la liste des classes à celles de ses séances
        const sClasseIds = new Set(
          seances.value
            .filter(s => Number(s.enseignant?.id) === Number(profil.id))
            .map(s => Number(s.classe?.id))
            .filter(id => id > 0)
        )
        classes.value = classes.value
          .filter((c: any) => sClasseIds.has(Number(c.id)))
          .sort((a: any, b: any) => a.nom.localeCompare(b.nom))
      } catch (e) {
        console.error('[Émargement] Erreur profil enseignant:', e)
      }
    }
  } finally {
    loading.value = false
  }
}

// Historique : toutes les séances émargées du prof, triées par date desc
const historiqueEmargements = computed(() => {
  if (!isEnseignant.value || !monEnseignantId.value) return []
  return seances.value
    .filter(s => s.statut === 'effectue' && Number(s.enseignant?.id) === monEnseignantId.value)
    .sort((a, b) => new Date(b.date_debut).getTime() - new Date(a.date_debut).getTime())
})

// Séances à émarger pour le prof (planifiées ou confirmées, filtrées par classe/date)
const seancesAEmarger = computed(() => {
  if (!isEnseignant.value) return []
  return seances.value.filter(s => {
    if (monEnseignantId.value) {
      const estSonProf = Number(s.enseignant?.id) === monEnseignantId.value
      const estSaClasse = mesClasseIds.value.includes(Number(s.classe?.id))
      if (!estSonProf && !estSaClasse) return false
    }
    if (!['planifie', 'confirme'].includes(s.statut)) return false
    if (filterClasse.value && String(s.classe?.id) !== String(filterClasse.value)) return false
    if (filterDate.value) {
      const seanceDate = String(s.date_debut).slice(0, 10)
      if (seanceDate !== filterDate.value) return false
    }
    return true
  })
})

function dureeh(s: Seance) {
  return ((new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 3600000).toFixed(1)
}

// Heures émargées calculées localement (depuis les séances effectuées)
const heuresEmargeesLocales = computed(() => {
  return historiqueEmargements.value.reduce((total, s) => {
    const mins = (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 60000
    return total + mins / 60
  }, 0)
})

// Taux d'émargement (séances effectuées / total des séances du prof)
const tauxEmargement = computed(() => {
  if (!isEnseignant.value || !monEnseignantId.value) return 0
  const total = seances.value.filter(s => {
    const estSonProf = Number(s.enseignant?.id) === monEnseignantId.value
    const estSaClasse = mesClasseIds.value.includes(Number(s.classe?.id))
    return estSonProf || estSaClasse
  }).length
  if (!total) return 0
  return Math.round((historiqueEmargements.value.length / total) * 100)
})

// ── Admin : stats du jour ──
function seanceDateStr(s: Seance): string {
  // Robuste : gère ISO "2026-03-28T..." et toString "Wed Mar 28..."
  const raw = String(s.date_debut)
  if (raw.length >= 10 && raw[4] === '-') return raw.slice(0, 10)
  const d = new Date(s.date_debut)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const seancesAujourdHui = computed(() =>
  seances.value.filter(s => seanceDateStr(s) === todayStr)
)
const seancesEmargéesAujourdHui = computed(() =>
  seancesAujourdHui.value.filter(s => s.statut === 'effectue')
    .sort((a, b) => new Date(b.date_debut).getTime() - new Date(a.date_debut).getTime())
)
const seancesRestantesAujourdHui = computed(() =>
  seancesAujourdHui.value.filter(s => ['planifie', 'confirme'].includes(s.statut))
    .sort((a, b) => new Date(a.date_debut).getTime() - new Date(b.date_debut).getTime())
)
const heuresAujourdHui = computed(() => {
  const h = seancesEmargéesAujourdHui.value.reduce((t, s) =>
    t + (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 3600000, 0)
  return h.toFixed(1)
})
const enseignantsActifsAujourdHui = computed(() =>
  new Set(seancesEmargéesAujourdHui.value.map(s => s.enseignant?.id).filter(Boolean)).size
)

// ── Admin : émargements du mois en cours ──
const moisCourant = todayStr.slice(0, 7) // "2026-03"
const seancesEmargéesMois = computed(() =>
  seances.value
    .filter(s => s.statut === 'effectue' && seanceDateStr(s).slice(0, 7) === moisCourant)
    .sort((a, b) => new Date(b.date_debut).getTime() - new Date(a.date_debut).getTime())
)
const heuresMois = computed(() => {
  const h = seancesEmargéesMois.value.reduce((t, s) =>
    t + (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 3600000, 0)
  return h.toFixed(1)
})
const enseignantsMois = computed(() =>
  new Set(seancesEmargéesMois.value.map(s => s.enseignant?.id).filter(Boolean)).size
)
// Cumul par enseignant pour le mois
const cumulEnseignantsMois = computed(() => {
  const map = new Map<number, { id: number; nom: string; prenom: string; seances: number; heures: number }>()
  for (const s of seancesEmargéesMois.value) {
    if (!s.enseignant?.id) continue
    const eid = s.enseignant.id
    if (!map.has(eid)) map.set(eid, { id: eid, nom: s.enseignant.nom, prenom: s.enseignant.prenom, seances: 0, heures: 0 })
    const entry = map.get(eid)!
    entry.seances++
    entry.heures += (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 3600000
  }
  return [...map.values()].sort((a, b) => b.heures - a.heures)
})
const moisCourantLabel = computed(() => {
  const months = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
  const [y, m] = moisCourant.split('-') as [string, string]
  return `${months[parseInt(m || '1') - 1]} ${y}`
})

function fmtMontant(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n)
}

// Charger dès que l'auth est disponible + à chaque remontage de la vue
watch(() => auth.user, (user) => {
  if (user) load()
  if (isEnseignant.value && !ticker) ticker = setInterval(() => { now.value = new Date() }, 1000)
}, { immediate: true })
onMounted(() => {
  if (auth.user) load()
  if (isEnseignant.value) ticker = setInterval(() => { now.value = new Date() }, 1000)
})
onUnmounted(() => { if (ticker) clearInterval(ticker) })
</script>

<template>
  <div class="uc-content">

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- LAYOUT ENSEIGNANT — pleine largeur                      -->
    <!-- ════════════════════════════════════════════════════════ -->
    <template v-if="isEnseignant">

      <!-- ── Hero compact ── -->
      <div class="em-hero">
        <div class="em-hero-glow"></div>
        <div class="em-hero-content">
          <div class="em-hero-left">
            <div class="em-hero-avatar">
              {{ (auth.user?.prenom ?? '?').charAt(0) }}{{ (auth.user?.nom ?? '?').charAt(0) }}
            </div>
            <div class="em-hero-info">
              <div class="em-hero-label">Émargement</div>
              <div class="em-hero-name">{{ auth.user?.prenom }} {{ auth.user?.nom }}</div>
              <div class="em-hero-date">{{ new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }) }}</div>
            </div>
          </div>
          <div class="em-hero-kpis">
            <div class="em-hkpi">
              <div class="em-hkpi-val">{{ seancesAEmarger.filter(s => s.date_debut.slice(0,10) === todayStr).length }}</div>
              <div class="em-hkpi-lbl">Aujourd'hui</div>
            </div>
            <div class="em-hkpi">
              <div class="em-hkpi-val">{{ seancesAEmarger.length }}</div>
              <div class="em-hkpi-lbl">À émarger</div>
            </div>
            <div class="em-hkpi">
              <div class="em-hkpi-val" :style="{ color: tauxEmargement >= 80 ? '#4ade80' : tauxEmargement >= 50 ? '#fbbf24' : '#f87171' }">
                {{ tauxEmargement }}%
              </div>
              <div class="em-hkpi-lbl">Taux</div>
            </div>
            <div class="em-hkpi">
              <div class="em-hkpi-val">{{ Math.round(heuresEmargeesLocales * 2) / 2 }}h</div>
              <div class="em-hkpi-lbl">Heures</div>
            </div>
          </div>
        </div>
        <!-- Live / Prochain strip -->
        <div v-if="!loading && (seanceEnCours || prochainSeance)" class="em-hero-strip">
          <span v-if="seanceEnCours" class="em-live-pill">🔴 EN COURS</span>
          <span v-else class="em-hero-strip-label">⏱ Prochain cours</span>
          <div class="em-hero-strip-body">
            <span class="em-mode-badge" :style="{ background: modeGrad(seanceEnCours?.mode ?? prochainSeance?.mode ?? '') }">
              {{ modeIcon(seanceEnCours?.mode ?? prochainSeance?.mode ?? '') }}
            </span>
            <strong>{{ seanceEnCours?.matiere ?? prochainSeance?.matiere }}</strong>
            <span class="em-hero-strip-meta">{{ seanceEnCours?.classe?.nom ?? prochainSeance?.classe?.nom }} · {{ fmtTime(seanceEnCours?.date_debut ?? prochainSeance?.date_debut ?? '') }}</span>
          </div>
          <span v-if="countdownText" class="em-countdown-chip">{{ countdownText }}</span>
        </div>
      </div>

      <!-- ── Avoirs banner ── -->
      <div class="em-avoirs-banner" :class="{ 'em-avoirs-banner--loading': !mesStats && loading }">
        <div class="em-avoirs-banner-head">
          <div class="em-avoirs-banner-icon">💰</div>
          <div>
            <div class="em-avoirs-banner-title">Mes avoirs</div>
            <div class="em-avoirs-banner-sub">Récapitulatif de vos heures et paiements</div>
          </div>
        </div>
        <div v-if="mesStats" class="em-avoirs-kpis">
          <div class="em-akpi">
            <span class="em-akpi-val">{{ Math.round(heuresEmargeesLocales * 2) / 2 }}h</span>
            <span class="em-akpi-label">Heures effectuées</span>
          </div>
          <div class="em-akpi-sep"></div>
          <div class="em-akpi">
            <span class="em-akpi-val">{{ (mesStats.tarif_horaire > 0 || mesStats.fi_tarif_horaire > 0) ? fmtMontant(mesStats.tarif_horaire || mesStats.fi_tarif_horaire) : '—' }}</span>
            <span class="em-akpi-label">Tarif horaire{{ mesStats.fi_tarif_horaire > 0 && mesStats.tarif_horaire > 0 ? ' (classique)' : mesStats.fi_tarif_horaire > 0 ? ' (FI)' : '' }}</span>
          </div>
          <div class="em-akpi-sep"></div>
          <div class="em-akpi em-akpi--green">
            <span class="em-akpi-val">{{ fmtMontant(mesStats.montant_du) }}</span>
            <span class="em-akpi-label">Montant dû</span>
          </div>
          <div class="em-akpi-sep"></div>
          <div class="em-akpi em-akpi--blue">
            <span class="em-akpi-val">{{ fmtMontant(mesStats.montant_paye) }}</span>
            <span class="em-akpi-label">Déjà payé</span>
          </div>
          <div class="em-akpi-sep"></div>
          <div class="em-akpi" :class="mesStats.montant_restant > 0 ? 'em-akpi--red' : 'em-akpi--green'">
            <span class="em-akpi-val">{{ mesStats.montant_restant > 0 ? fmtMontant(mesStats.montant_restant) : '✓ Soldé' }}</span>
            <span class="em-akpi-label">Solde restant</span>
          </div>
        </div>
        <!-- Détail FI si le prof a des modules FI -->
        <div v-if="mesStats && mesStats.fi_nb_modules > 0" style="margin-top:8px;padding:10px 16px;background:rgba(99,102,241,0.15);border-radius:10px;display:flex;flex-wrap:wrap;gap:12px;align-items:center;">
          <span style="font-size:12px;color:#c7d2fe;">🎓 Formations individuelles</span>
          <span style="font-size:13px;color:#e0e7ff;font-weight:600;">{{ mesStats.fi_heures_effectuees }}h / {{ mesStats.fi_heures_total }}h émargées</span>
          <span style="font-size:12px;color:#a5b4fc;">Tarif FI : {{ fmtMontant(mesStats.fi_tarif_horaire) }}/h</span>
          <span style="font-size:13px;color:#a5f3fc;font-weight:700;">Avoir FI : {{ fmtMontant(mesStats.montant_du_fi) }}</span>
          <div style="flex:1;min-width:80px;height:6px;background:rgba(255,255,255,0.15);border-radius:3px;overflow:hidden;">
            <div :style="`height:100%;width:${mesStats.fi_heures_total>0?Math.round(mesStats.fi_heures_effectuees/mesStats.fi_heures_total*100):0}%;background:#818cf8;border-radius:3px;`"></div>
          </div>
        </div>
        <div v-else-if="loading" class="em-avoirs-kpis" style="align-items:center;color:rgba(255,255,255,.35);font-size:13px;">
          Chargement des avoirs…
        </div>
        <div v-else class="em-avoirs-kpis" style="align-items:center;color:rgba(255,255,255,.35);font-size:13px;">
          Aucune donnée d'avoir disponible
        </div>
      </div>

      <!-- ── Toolbar filtres ── -->
      <div class="em-toolbar">
        <div class="em-toolbar-left">
          <select v-model="filterClasse" class="em-select em-select-bar">
            <option value="">Toutes les classes</option>
            <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
          </select>
          <div class="em-date-wrap">
            <input v-model="filterDate" type="date" class="em-select em-select-bar" />
            <button v-if="filterDate" @click="filterDate = ''" class="em-btn-clear" title="Voir toutes les dates">✕</button>
          </div>
          <div class="em-search-wrap">
            <svg class="em-search-icon" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input v-model="searchMatiere" type="text" placeholder="Rechercher une matière…" class="em-search-input" />
            <button v-if="searchMatiere" @click="searchMatiere=''" class="em-btn-clear-sm">✕</button>
          </div>
        </div>
        <button @click="load" :disabled="loading" class="em-btn-refresh">
          <svg :style="loading ? 'animation:spin 1s linear infinite' : ''" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Actualiser
        </button>
      </div>

      <!-- ── Section séances à émarger ── -->
      <section class="em-section">
        <div class="em-section-header">
          <h3 class="em-section-title">
            ✍️ Séances à émarger
          </h3>
          <span v-if="!loading" class="em-section-count">{{ seancesAEmargerFiltrees.length }} séance(s)</span>
        </div>

        <div v-if="loading" class="em-empty-section">
          <div class="em-spinner"></div>
          <p>Chargement des séances…</p>
        </div>
        <div v-else-if="!seancesAEmargerFiltrees.length" class="em-empty-section">
          <span style="font-size:36px;">📭</span>
          <p>Aucune séance planifiée{{ filterDate ? ' pour le ' + new Date(filterDate + 'T00:00').toLocaleDateString('fr-FR', {day:'numeric',month:'long'}) : '' }}</p>
        </div>
        <div v-else class="em-cards-grid">
          <div v-for="s in seancesAEmargerFiltrees" :key="s.id"
            class="em-seance-card"
            :class="{
              'em-seance-card--active': selectedSeance?.id === s.id,
              'em-seance-card--live': seanceUrgency(s) === 'live',
              'em-seance-card--overdue': seanceUrgency(s) === 'overdue',
            }"
            @click="selectSeance(s)">

            <!-- Mode gradient top bar -->
            <div class="em-sc-modebar" :style="{ background: modeGrad(s.mode) }">
              <span class="em-sc-mode-icon">{{ modeIcon(s.mode) }}</span>
              <span class="em-sc-mode-label">{{ modeLabel(s.mode) }}</span>
              <span v-if="seanceUrgency(s) === 'live'" class="em-sc-live-badge">🔴 En cours</span>
              <span v-else-if="seanceUrgency(s) === 'overdue'" class="em-sc-overdue-badge">⚠️ En retard</span>
            </div>

            <div class="em-sc-body">
              <div class="em-sc-header">
                <span class="em-sc-matiere">{{ s.matiere }}</span>
                <span class="em-statut-dot" :class="statutBadge(s.statut)">{{ statutLabel(s.statut) }}</span>
              </div>
              <div class="em-sc-classe">{{ s.fi_module_id ? '🎓 Individuel' : '🏫 ' + (s.classe?.nom ?? '') }}</div>
              <div class="em-sc-time">
                🕐 {{ fmtDate(s.date_debut) }} · {{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}
              </div>
              <div class="em-sc-footer">
                <span class="em-sc-duree">⏱ {{ dureeh(s) }}h de cours</span>
                <span class="em-sc-action" :class="selectedSeance?.id === s.id ? 'em-sc-action--open' : ''">
                  {{ selectedSeance?.id === s.id ? '▲ Ouvert' : '▼ Ouvrir' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ── Panneau détail séance sélectionnée ── -->
      <div v-if="selectedSeance" class="em-detail-panel">

        <!-- Header du panneau -->
        <div class="em-detail-header" :style="{ background: modeGrad(selectedSeance.mode) }">
          <div class="em-detail-header-left">
            <div class="em-detail-mode-icon">{{ modeIcon(selectedSeance.mode) }}</div>
            <div class="em-detail-header-info">
              <div class="em-detail-matiere">{{ selectedSeance.matiere }}</div>
              <div class="em-detail-meta">
                🏫 {{ selectedSeance.classe?.nom }} &nbsp;·&nbsp;
                📅 {{ fmtDate(selectedSeance.date_debut) }} &nbsp;·&nbsp;
                🕐 {{ fmtTime(selectedSeance.date_debut) }}–{{ fmtTime(selectedSeance.date_fin) }}
                &nbsp;({{ dureeh(selectedSeance) }}h)
              </div>
            </div>
          </div>
          <div class="em-detail-header-right">
            <span class="em-statut-badge" :class="statutBadge(selectedSeance.statut)">{{ statutLabel(selectedSeance.statut) }}</span>
            <button @click="selectedSeance = null" class="em-btn-close-white" title="Fermer">✕</button>
          </div>
        </div>

        <div class="em-detail-body">

          <!-- Contenu séance -->
          <div class="em-block">
            <div class="em-block-title">
              📝 Contenu de la séance
            </div>
            <div class="em-form-group">
              <label class="em-label">Objectifs du cours</label>
              <RichTextEditor v-model="contenuForm.objectifs" :disabled="estCloturee" :rows="2" placeholder="Ex: Comprendre les bases du HTML, créer une structure de page web…" />
            </div>
            <div class="em-form-group">
              <label class="em-label">Contenu enseigné <span style="color:#E30613">*</span></label>
              <RichTextEditor v-model="contenuForm.contenu_seance" :disabled="estCloturee" :rows="4" placeholder="Décrivez ce qui a été traité durant cette séance : chapitres, exercices, notions abordées…" />
            </div>
            <div v-if="!estCloturee && canWrite" class="em-save-contenu">
              <button @click="sauvegarderContenu" :disabled="savingContenu" class="em-btn-secondary">
                {{ savingContenu ? 'Sauvegarde…' : '💾 Sauvegarder le contenu' }}
              </button>
              <span v-if="successContenu" class="em-success-msg">✓ Contenu sauvegardé</span>
            </div>
            <div v-if="estCloturee && (selectedSeance.contenu_seance || selectedSeance.objectifs)" class="em-contenu-readonly">
              <div v-if="selectedSeance.objectifs"><strong>Objectifs :</strong><div class="em-rich-display" v-html="selectedSeance.objectifs"></div></div>
              <div v-if="selectedSeance.contenu_seance" style="margin-top:6px;"><strong>Contenu :</strong><div class="em-rich-display" v-html="selectedSeance.contenu_seance"></div></div>
            </div>
          </div>

          <!-- Présences -->
          <div class="em-block">
            <div class="em-block-title">👥 Présences</div>

            <!-- KPIs + gauge -->
            <div class="em-presence-overview">
              <div class="em-kpis">
                <div class="em-kpi em-kpi-present"><span class="em-kpi-val">{{ compteurs.present }}</span><span class="em-kpi-label">Présents</span></div>
                <div class="em-kpi em-kpi-retard"><span class="em-kpi-val">{{ compteurs.retard }}</span><span class="em-kpi-label">Retards</span></div>
                <div class="em-kpi em-kpi-absent"><span class="em-kpi-val">{{ compteurs.absent }}</span><span class="em-kpi-label">Absents</span></div>
                <div class="em-kpi em-kpi-excuse"><span class="em-kpi-val">{{ compteurs.excuse }}</span><span class="em-kpi-label">Excusés</span></div>
              </div>
              <div class="em-gauge-side">
                <svg width="90" height="90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" :r="RADIUS_P" fill="none" stroke="#f1f5f9" stroke-width="8"/>
                  <circle cx="50" cy="50" :r="RADIUS_P" fill="none"
                    :stroke="gaugeColorP" stroke-width="8" stroke-linecap="round"
                    :stroke-dasharray="CIRC_P" :stroke-dashoffset="gaugeOffsetP"
                    transform="rotate(-90 50 50)"
                    style="transition: stroke-dashoffset 0.6s ease"/>
                  <text x="50" y="46" text-anchor="middle" font-size="17" font-weight="800" :fill="gaugeColorP">{{ tauxPresence }}%</text>
                  <text x="50" y="60" text-anchor="middle" font-size="8" fill="#9ca3af">présence</text>
                </svg>
              </div>
            </div>

            <!-- Barre de progression colorée -->
            <div class="em-progress">
              <div class="em-progress-present" :style="{ width: `${Math.round(compteurs.present/Math.max(compteurs.total,1)*100)}%` }"></div>
              <div class="em-progress-retard"  :style="{ width: `${Math.round(compteurs.retard/Math.max(compteurs.total,1)*100)}%` }"></div>
              <div class="em-progress-absent"  :style="{ width: `${Math.round(compteurs.absent/Math.max(compteurs.total,1)*100)}%` }"></div>
            </div>

            <!-- Actions rapides -->
            <div v-if="canWrite && !estCloturee" class="em-quick-actions">
              <button @click="marquerTousPresents" class="em-btn-all-present">✓ Tous présents</button>
              <div class="em-student-search">
                <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <input v-model="searchStudent" type="text" placeholder="Chercher un étudiant…" class="em-student-search-input" />
                <button v-if="searchStudent" @click="searchStudent=''" style="border:none;background:none;cursor:pointer;color:#aaa;font-size:11px;">✕</button>
              </div>
            </div>

            <div v-if="loadingInscrits" class="em-empty">Chargement des étudiants…</div>
            <div v-else-if="!inscriptions.length" class="em-empty">Aucun étudiant trouvé pour cette séance.</div>
            <div v-else class="em-students">
              <div v-for="insc in inscriptionsFiltrees" :key="insc.id"
                class="em-student"
                :class="`em-student--${localPresences[insc.id] ?? 'absent'}`">
                <div class="em-avatar" :class="`em-av-${localPresences[insc.id] ?? 'absent'}`">
                  {{ (insc.etudiant.prenom[0] ?? '') + (insc.etudiant.nom[0] ?? '') }}
                </div>
                <div class="em-student-info">
                  <p class="em-student-name">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</p>
                  <p v-if="insc.etudiant.numero_etudiant" class="em-student-sub">{{ insc.etudiant.numero_etudiant }}</p>
                </div>
                <span class="em-badge" :class="`em-badge-${localPresences[insc.id] ?? 'absent'}`">
                  {{ ({ present: '✓ Présent', retard: '⏰ Retard', absent: '✗ Absent', excuse: '📋 Excusé' } as any)[localPresences[insc.id] ?? 'absent'] }}
                </span>
                <div v-if="canWrite && !estCloturee" class="em-toggles">
                  <button v-for="st in ['present','retard','absent','excuse']" :key="st"
                    @click="setPresence(insc.id, st as any)" class="em-toggle"
                    :class="`em-toggle-${st}${(localPresences[insc.id] ?? 'absent') === st ? '--active' : ''}`"
                    :title="({ present:'Présent', retard:'Retard', absent:'Absent', excuse:'Excusé' } as any)[st]">
                    {{ ({ present:'P', retard:'R', absent:'A', excuse:'E' } as any)[st] }}
                  </button>
                </div>
                <div v-else-if="estCloturee" class="em-locked-icon">🔒</div>
              </div>
            </div>
          </div>

          <!-- Footer émargement -->
          <div v-if="canWrite" class="em-block em-block-footer">
            <div v-if="estCloturee" class="em-cloture-done">
              <div class="em-cloture-done-icon">✅</div>
              <div>
                <strong>Séance émargée et clôturée</strong>
                <p v-if="selectedSeance.signe_enseignant_at">Le {{ fmtDateTime(selectedSeance.signe_enseignant_at) }}</p>
              </div>
            </div>
            <div v-else class="em-footer-actions">
              <button @click="sauvegarderPresences" :disabled="saving || !inscriptions.length || seanceEstFuture" class="em-btn-secondary">
                {{ saving ? 'Sauvegarde…' : '💾 Sauvegarder les présences' }}
              </button>
              <button @click="demanderEmarger" :disabled="saving || !inscriptions.length || seanceEstFuture" class="em-btn-emarger"
                :title="seanceEstFuture ? 'La séance n\'a pas encore commencé' : ''">
                ✍️ Émarger et clôturer la séance
              </button>
              <span v-if="success" class="em-success-msg">✓ Présences enregistrées</span>
            </div>
            <p v-if="seanceEstFuture" class="em-hint" style="color:#d97706;">
              ⏳ Cette séance n'a pas encore commencé. L'émargement sera disponible dès le début de la séance.
            </p>
            <p v-else-if="!estCloturee && !contenuForm.contenu_seance.trim()" class="em-hint">
              ℹ️ Pensez à renseigner le contenu de la séance avant de clôturer.
            </p>
          </div>

        </div>
      </div>

      <!-- ── Historique des émargements ── -->
      <section v-if="historiqueEmargements.length" class="em-section">
        <div class="em-section-header">
          <h3 class="em-section-title">📋 Mes émargements</h3>
          <span class="em-section-count">
            {{ historiqueEmargements.length }} séances · <strong>{{ Math.round(heuresEmargeesLocales * 2) / 2 }}h</strong>
          </span>
        </div>

        <!-- Par mois -->
        <div v-for="mois in historiqueParMois" :key="mois.label" class="em-mois-group">
          <div class="em-mois-header">
            <span class="em-mois-label">{{ mois.label }}</span>
            <span class="em-mois-stats">{{ mois.seances.length }} séances · {{ Math.round(mois.heures * 2) / 2 }}h</span>
          </div>
          <div class="em-historique-wrap">
            <table class="em-historique-table">
              <thead>
                <tr>
                  <th>Matière</th>
                  <th>Classe</th>
                  <th>Date</th>
                  <th>Horaire</th>
                  <th>Durée</th>
                  <th>Émargé le</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in mois.seances" :key="s.id">
                  <td class="em-ht-mat">
                    <span class="em-ht-mode-chip" :style="{ background: modeGrad(s.mode) }">{{ modeIcon(s.mode) }}</span>
                    {{ s.matiere }}
                  </td>
                  <td>{{ s.classe?.nom ?? '—' }}</td>
                  <td>{{ new Date(s.date_debut).toLocaleDateString('fr-FR', { day:'numeric', month:'short' }) }}</td>
                  <td>{{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}</td>
                  <td class="em-ht-duree">{{ dureeh(s) }}h</td>
                  <td style="font-size:11px;color:#888;">{{ s.signe_enseignant_at ? fmtDateTime(s.signe_enseignant_at) : '—' }}</td>
                  <td><span class="em-statut-dot em-badge-effectue">✓ Émargée</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

    </template>

    <!-- ════════════════════════════════════════════════════════ -->
    <!-- LAYOUT ADMIN / SECRÉTARIAT / COORDINATEUR — 2 colonnes -->
    <!-- ════════════════════════════════════════════════════════ -->
    <template v-else>
      <UcPageHeader title="Émargement" subtitle="Suivi des émargements et saisie des présences">
        <template #actions>
          <a href="/suivi-emargements" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#1e293b;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">📊 Suivi émargements</a>
          <a href="/cahier-de-textes" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#E30613;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">📓 Cahier de textes</a>
        </template>
      </UcPageHeader>

      <!-- ── Bandeau du jour ── -->
      <div class="em-today-banner">
        <div class="em-today-stat">
          <div class="em-today-val">{{ seancesAujourdHui.length }}</div>
          <div class="em-today-lbl">Séances du jour</div>
        </div>
        <div class="em-today-stat em-today-done">
          <div class="em-today-val">{{ seancesEmargéesAujourdHui.length }}</div>
          <div class="em-today-lbl">Émargées</div>
        </div>
        <div class="em-today-stat em-today-pending">
          <div class="em-today-val">{{ seancesRestantesAujourdHui.length }}</div>
          <div class="em-today-lbl">Restantes</div>
        </div>
        <div class="em-today-stat">
          <div class="em-today-val">{{ heuresAujourdHui }}h</div>
          <div class="em-today-lbl">Heures émargées</div>
        </div>
        <div class="em-today-stat">
          <div class="em-today-val">{{ enseignantsActifsAujourdHui }}</div>
          <div class="em-today-lbl">Enseignants actifs</div>
        </div>
      </div>

      <!-- ── Séances émargées aujourd'hui (détail rapide) ── -->
      <div v-if="seancesEmargéesAujourdHui.length > 0" class="em-today-detail">
        <h3 class="em-today-detail-title">Émargements du jour</h3>
        <div class="em-today-list">
          <div v-for="s in seancesEmargéesAujourdHui" :key="s.id" class="em-today-item" @click="selectSeance(s)">
            <div class="em-today-item-time">{{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}</div>
            <div class="em-today-item-info">
              <strong>{{ s.matiere }}</strong>
              <span class="em-today-item-classe">{{ s.classe?.nom }}</span>
            </div>
            <div class="em-today-item-prof">{{ s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : '—' }}</div>
            <span class="em-today-item-badge">✓ Émargée</span>
          </div>
        </div>
      </div>

      <div v-if="seancesRestantesAujourdHui.length > 0" class="em-today-detail" style="margin-top:12px;">
        <h3 class="em-today-detail-title" style="color:#c2410c;">Séances à émarger aujourd'hui</h3>
        <div class="em-today-list">
          <div v-for="s in seancesRestantesAujourdHui" :key="s.id" class="em-today-item em-today-item-pending" @click="selectSeance(s)">
            <div class="em-today-item-time">{{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}</div>
            <div class="em-today-item-info">
              <strong>{{ s.matiere }}</strong>
              <span class="em-today-item-classe">{{ s.classe?.nom }}</span>
            </div>
            <div class="em-today-item-prof">{{ s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : '—' }}</div>
            <span class="em-today-item-badge" style="background:#fff7ed;color:#c2410c;">En attente</span>
          </div>
        </div>
      </div>

      <div v-if="seancesAujourdHui.length === 0 && !loading" class="em-today-detail">
        <p style="text-align:center;color:#94a3b8;font-size:12px;margin:0;padding:10px 0;font-family:'Poppins',sans-serif;">Aucune séance prévue aujourd'hui.</p>
      </div>

      <!-- ── Récap du mois ── -->
      <div style="margin-top:20px;">
        <h3 style="font-size:15px;font-weight:700;color:#1e293b;margin:0 0 12px;font-family:'Poppins',sans-serif;">
          Émargements — {{ moisCourantLabel }}
          <span style="font-size:12px;font-weight:500;color:#64748b;margin-left:8px;">{{ seancesEmargéesMois.length }} séance(s) · {{ heuresMois }}h · {{ enseignantsMois }} enseignant(s)</span>
        </h3>

        <!-- Cumul par enseignant -->
        <div v-if="cumulEnseignantsMois.length > 0" class="em-mois-table-wrap">
          <table class="em-mois-table">
            <thead>
              <tr>
                <th>Enseignant</th>
                <th style="text-align:center">Séances</th>
                <th style="text-align:center">Heures</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in cumulEnseignantsMois" :key="e.id">
                <td><strong>{{ e.prenom }} {{ e.nom }}</strong></td>
                <td style="text-align:center"><span class="em-mois-badge em-mois-badge-blue">{{ e.seances }}</span></td>
                <td style="text-align:center"><span class="em-mois-badge em-mois-badge-green">{{ e.heures.toFixed(1) }}h</span></td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td><strong>TOTAL</strong></td>
                <td style="text-align:center"><strong>{{ seancesEmargéesMois.length }}</strong></td>
                <td style="text-align:center"><strong>{{ heuresMois }}h</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <!-- Liste détaillée du mois -->
        <div v-if="seancesEmargéesMois.length > 0" class="em-mois-table-wrap" style="margin-top:12px;">
          <table class="em-mois-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Horaire</th>
                <th>Classe</th>
                <th>Matière</th>
                <th>Enseignant</th>
                <th style="text-align:center">Durée</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in seancesEmargéesMois" :key="s.id" @click="selectSeance(s)" style="cursor:pointer;">
                <td>{{ new Date(s.date_debut).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) }}</td>
                <td>{{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}</td>
                <td><span class="em-mois-badge em-mois-badge-gray">{{ s.classe?.nom ?? '—' }}</span></td>
                <td><strong>{{ s.matiere }}</strong></td>
                <td>{{ s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : '—' }}</td>
                <td style="text-align:center"><span class="em-mois-badge em-mois-badge-green">{{ ((new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 3600000).toFixed(1) }}h</span></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="!loading" style="text-align:center;color:#94a3b8;font-size:12px;padding:16px;font-family:'Poppins',sans-serif;">
          Aucun émargement ce mois-ci.
        </div>
      </div>

      <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />

      <div class="em-grid">

        <!-- ── Colonne gauche : liste séances ── -->
        <div class="em-left">
          <div class="em-card">
            <div class="em-card-header">Séances</div>
            <div class="em-filters">
              <select v-model="filterClasse" class="em-select">
                <option value="">Toutes les classes</option>
                <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
              </select>
              <div style="display:flex;gap:4px;align-items:center;">
                <input v-model="filterDate" type="date" class="em-select" style="flex:1;" />
                <button v-if="filterDate" @click="filterDate = ''"
                  title="Afficher toutes les dates"
                  style="padding:5px 7px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;font-size:11px;color:#6b7280;white-space:nowrap;">
                  ✕ Tout
                </button>
              </div>
              <select v-model="filterStatut" class="em-select">
                <option value="">Tous les statuts</option>
                <option value="planifie">Planifiées</option>
                <option value="confirme">Confirmées</option>
                <option value="effectue">Émargées</option>
                <option value="annule">Annulées</option>
              </select>
              <button @click="load" :disabled="loading"
                title="Actualiser les séances"
                style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;display:flex;align-items:center;gap:5px;font-size:12px;color:#374151;white-space:nowrap;flex-shrink:0;">
                <svg :style="loading ? 'animation:spin 1s linear infinite' : ''" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
                Actualiser
              </button>
            </div>
            <div v-if="loading" class="em-empty">Chargement…</div>
            <div v-else-if="!seancesFiltrees.length" class="em-empty">Aucune séance trouvée</div>
            <div v-else class="em-list">
              <button v-for="s in seancesFiltrees" :key="s.id"
                @click="selectSeance(s)"
                class="em-item"
                :class="[selectedSeance?.id === s.id ? 'em-item--active' : '', s.statut === 'effectue' ? 'em-item--done' : '']">
                <div class="em-item-top">
                  <span class="em-item-mat">{{ s.matiere }}</span>
                  <span class="em-statut-dot" :class="statutBadge(s.statut)">{{ statutLabel(s.statut) }}</span>
                </div>
                <p class="em-item-meta">{{ s.classe?.nom }} · {{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}</p>
                <p v-if="s.enseignant" class="em-item-prof">{{ s.enseignant.prenom }} {{ s.enseignant.nom }}</p>
              </button>
            </div>
          </div>
        </div>

        <!-- ── Colonne droite : détail ── -->
        <div class="em-right">
          <div v-if="!selectedSeance" class="em-placeholder">
            <svg width="40" height="40" fill="none" stroke="#ddd" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            <p>Sélectionnez une séance</p>
          </div>

          <div v-else class="em-detail">

            <!-- Bloc 1 : Info séance -->
            <div class="em-block em-block-info">
              <div class="em-info-left">
                <h2 class="em-seance-titre">{{ selectedSeance.matiere }}</h2>
                <p class="em-seance-sub">
                  {{ selectedSeance.classe?.nom }} · {{ fmtDate(selectedSeance.date_debut) }} · {{ fmtTime(selectedSeance.date_debut) }}–{{ fmtTime(selectedSeance.date_fin) }}
                </p>
                <p v-if="selectedSeance.enseignant" class="em-seance-prof">
                  👨‍🏫 {{ selectedSeance.enseignant.prenom }} {{ selectedSeance.enseignant.nom }}
                </p>
              </div>
              <div class="em-info-right">
                <span class="em-statut-badge" :class="statutBadge(selectedSeance.statut)">{{ statutLabel(selectedSeance.statut) }}</span>
                <div v-if="estCloturee && selectedSeance.signe_enseignant_at" class="em-signe-info">
                  Émargé le {{ fmtDateTime(selectedSeance.signe_enseignant_at) }}
                </div>
              </div>
            </div>

            <!-- Bloc 2 : Contenu séance -->
            <div class="em-block">
              <div class="em-block-title">
                <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                Contenu de la séance
              </div>
              <div class="em-form-group">
                <label class="em-label">Chapitre(s) abordé(s) <span style="color:#E30613">*</span></label>
                <input v-model="contenuForm.chapitre" :disabled="estCloturee" class="uc-input" placeholder="Ex: Chapitre 3 — Les structures conditionnelles" />
              </div>
              <div class="em-form-group">
                <label class="em-label">Objectifs planifiés</label>
                <RichTextEditor v-model="contenuForm.objectifs" :disabled="estCloturee" :rows="2" placeholder="Ex: Comprendre les bases du HTML, créer une structure de page web…" />
              </div>
              <div class="em-form-group">
                <label class="em-label">Objectifs atteints</label>
                <div style="display:flex;gap:8px;margin-top:2px;">
                  <button v-for="opt in [{v:'oui',l:'✅ Oui',c:'#16a34a'},{v:'partiel',l:'⚠️ Partiel',c:'#ea580c'},{v:'non',l:'❌ Non',c:'#E30613'}]" :key="opt.v"
                    type="button" :disabled="estCloturee"
                    @click="!estCloturee && (contenuForm.objectifs_atteints = contenuForm.objectifs_atteints === opt.v ? '' : opt.v)"
                    :style="{padding:'5px 12px',borderRadius:'6px',border:'2px solid',fontSize:'12px',fontWeight:'600',cursor:estCloturee?'default':'pointer',
                      borderColor: contenuForm.objectifs_atteints === opt.v ? opt.c : '#e2e8f0',
                      background: contenuForm.objectifs_atteints === opt.v ? opt.c + '18' : '#fff',
                      color: contenuForm.objectifs_atteints === opt.v ? opt.c : '#64748b'}">
                    {{ opt.l }}
                  </button>
                </div>
              </div>
              <div class="em-form-group">
                <label class="em-label">Contenu enseigné <span style="color:#E30613">*</span></label>
                <RichTextEditor v-model="contenuForm.contenu_seance" :disabled="estCloturee" :rows="3" placeholder="Décrivez ce qui a été traité durant cette séance…" />
              </div>
              <div class="em-form-group">
                <label class="em-label">Remarques pédagogiques</label>
                <textarea v-model="contenuForm.remarques" :disabled="estCloturee" class="uc-input" rows="2" placeholder="Difficultés rencontrées, points à revoir, suggestions…" style="resize:vertical;"></textarea>
              </div>
              <div v-if="!estCloturee && canWrite" class="em-save-contenu">
                <button @click="sauvegarderContenu" :disabled="savingContenu" class="em-btn-secondary">
                  {{ savingContenu ? 'Sauvegarde…' : '💾 Sauvegarder le contenu' }}
                </button>
                <span v-if="successContenu" class="em-success-msg">✓ Contenu sauvegardé</span>
              </div>
              <div v-if="estCloturee && (selectedSeance.contenu_seance || selectedSeance.objectifs || selectedSeance.chapitre)" class="em-contenu-readonly">
                <div v-if="selectedSeance.chapitre" style="margin-bottom:5px;"><strong>Chapitre :</strong> {{ selectedSeance.chapitre }}</div>
                <div v-if="selectedSeance.objectifs_atteints" style="margin-bottom:5px;">
                  <strong>Objectifs atteints :</strong>
                  <span :style="{marginLeft:'6px',padding:'2px 8px',borderRadius:'4px',fontSize:'11px',fontWeight:'700',
                    background: selectedSeance.objectifs_atteints==='oui'?'#dcfce7':selectedSeance.objectifs_atteints==='partiel'?'#ffedd5':'#fee2e2',
                    color: selectedSeance.objectifs_atteints==='oui'?'#16a34a':selectedSeance.objectifs_atteints==='partiel'?'#ea580c':'#E30613'}">
                    {{ selectedSeance.objectifs_atteints==='oui'?'✅ Oui':selectedSeance.objectifs_atteints==='partiel'?'⚠️ Partiel':'❌ Non' }}
                  </span>
                </div>
                <div v-if="selectedSeance.objectifs"><strong>Objectifs :</strong><div class="em-rich-display" v-html="selectedSeance.objectifs"></div></div>
                <div v-if="selectedSeance.contenu_seance" style="margin-top:6px;"><strong>Contenu :</strong><div class="em-rich-display" v-html="selectedSeance.contenu_seance"></div></div>
                <div v-if="selectedSeance.remarques" style="margin-top:6px;"><strong>Remarques :</strong> {{ selectedSeance.remarques }}</div>
              </div>
            </div>

            <!-- Bloc 3 : Présences -->
            <div class="em-block">
              <div class="em-block-title">
                <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                Présences
              </div>
              <div class="em-kpis">
                <div class="em-kpi em-kpi-present"><span class="em-kpi-val">{{ compteurs.present }}</span><span class="em-kpi-label">Présents</span></div>
                <div class="em-kpi em-kpi-retard"><span class="em-kpi-val">{{ compteurs.retard }}</span><span class="em-kpi-label">Retards</span></div>
                <div class="em-kpi em-kpi-absent"><span class="em-kpi-val">{{ compteurs.absent }}</span><span class="em-kpi-label">Absents</span></div>
                <div class="em-kpi em-kpi-excuse"><span class="em-kpi-val">{{ compteurs.excuse }}</span><span class="em-kpi-label">Excusés</span></div>
                <div class="em-kpi em-kpi-taux">
                  <span class="em-kpi-val" :style="{ color: tauxPresence >= 80 ? '#16a34a' : tauxPresence >= 50 ? '#ea580c' : '#E30613' }">{{ tauxPresence }}%</span>
                  <span class="em-kpi-label">Taux présence</span>
                </div>
              </div>
              <div class="em-progress">
                <div class="em-progress-present" :style="{ width: `${Math.round(compteurs.present/Math.max(compteurs.total,1)*100)}%` }"></div>
                <div class="em-progress-retard"  :style="{ width: `${Math.round(compteurs.retard/Math.max(compteurs.total,1)*100)}%` }"></div>
                <div class="em-progress-absent"  :style="{ width: `${Math.round(compteurs.absent/Math.max(compteurs.total,1)*100)}%` }"></div>
              </div>
              <div v-if="canWrite && !estCloturee" class="em-quick-actions">
                <button @click="marquerTousPresents" class="em-btn-all-present">✓ Tous présents</button>
              </div>
              <div v-if="loadingInscrits" class="em-empty">Chargement…</div>
              <div v-else-if="!inscriptions.length" class="em-empty">Aucun étudiant trouvé pour cette séance.</div>
              <div v-else class="em-students">
                <div v-for="insc in inscriptions" :key="insc.id" class="em-student">
                  <div class="em-avatar">{{ (insc.etudiant.prenom[0] ?? '') + (insc.etudiant.nom[0] ?? '') }}</div>
                  <div class="em-student-info">
                    <p class="em-student-name">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</p>
                    <p v-if="insc.classe" class="em-student-sub">{{ insc.classe.nom }}</p>
                  </div>
                  <span class="em-badge" :class="`em-badge-${localPresences[insc.id] ?? 'absent'}`">
                    {{ ({ present: 'Présent', retard: 'Retard', absent: 'Absent', excuse: 'Excusé' } as any)[localPresences[insc.id] ?? 'absent'] }}
                  </span>
                  <div v-if="canWrite && !estCloturee" class="em-toggles">
                    <button v-for="st in ['present','retard','absent','excuse']" :key="st"
                      @click="setPresence(insc.id, st as any)" class="em-toggle"
                      :class="`em-toggle-${st}${(localPresences[insc.id] ?? 'absent') === st ? '--active' : ''}`">
                      {{ ({ present:'P', retard:'R', absent:'A', excuse:'E' } as any)[st] }}
                    </button>
                  </div>
                  <div v-else-if="estCloturee" class="em-locked-icon">🔒</div>
                </div>
              </div>
            </div>

            <!-- Bloc 4 : Footer émargement -->
            <div v-if="canWrite" class="em-block em-block-footer">
              <div v-if="estCloturee" class="em-cloture-done">
                <div class="em-cloture-done-icon">✅</div>
                <div>
                  <strong>Séance émargée et clôturée</strong>
                  <p v-if="selectedSeance.signe_enseignant_at">Le {{ fmtDateTime(selectedSeance.signe_enseignant_at) }}</p>
                </div>
              </div>
              <div v-else class="em-footer-actions">
                <button @click="sauvegarderPresences" :disabled="saving || !inscriptions.length || seanceEstFuture" class="em-btn-secondary">
                  {{ saving ? 'Sauvegarde…' : '💾 Sauvegarder les présences' }}
                </button>
                <button @click="emargerEtCloturer" :disabled="saving || !inscriptions.length || seanceEstFuture" class="em-btn-emarger"
                  :title="seanceEstFuture ? 'La séance n\'a pas encore commencé' : ''">
                  ✍️ Émarger et clôturer la séance
                </button>
                <span v-if="success" class="em-success-msg">✓ Présences enregistrées</span>
              </div>
              <p v-if="seanceEstFuture" class="em-hint" style="color:#d97706;">
                ⏳ Cette séance n'a pas encore commencé. L'émargement sera disponible dès le début de la séance.
              </p>
              <p v-else-if="!estCloturee && !contenuForm.contenu_seance.trim()" class="em-hint">
                ℹ️ Pensez à renseigner le contenu de la séance avant de clôturer.
              </p>
            </div>

          </div>
        </div>
      </div>
    </template>

  </div>

  <!-- ── Modale confirmation émargement ── -->
  <Teleport to="body">
    <div v-if="showConfirmEmarger" class="em-confirm-overlay" @click.self="showConfirmEmarger=false">
      <div class="em-confirm-box">
        <div class="em-confirm-icon">✍️</div>
        <h3 class="em-confirm-title">Confirmer l'émargement</h3>
        <p class="em-confirm-msg">
          Vous allez clôturer la séance <strong>{{ selectedSeance?.matiere }}</strong>.<br>
          Cette action est <strong>irréversible</strong> — la séance sera marquée comme effectuée.
        </p>
        <div v-if="errorEmarger" class="em-confirm-error">⚠️ {{ errorEmarger }}</div>
        <div class="em-confirm-actions">
          <button @click="showConfirmEmarger=false" class="em-confirm-btn-cancel">Annuler</button>
          <button @click="emargerEtCloturer" :disabled="saving" class="em-confirm-btn-ok">
            {{ saving ? 'Émargement en cours…' : '✅ Oui, émarger maintenant' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ════════════════════════════════════════════════════════ */
/* Bandeau du jour (admin)                                  */
/* ════════════════════════════════════════════════════════ */
.em-today-banner { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.em-today-stat { flex: 1; min-width: 120px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; text-align: center; }
.em-today-stat.em-today-done { border-color: #bbf7d0; background: #f0fdf4; }
.em-today-stat.em-today-pending { border-color: #fed7aa; background: #fff7ed; }
.em-today-val { font-size: 26px; font-weight: 800; color: #1e293b; font-family: 'Poppins', sans-serif; }
.em-today-done .em-today-val { color: #15803d; }
.em-today-pending .em-today-val { color: #c2410c; }
.em-today-lbl { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; font-family: 'Poppins', sans-serif; }

.em-today-detail { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
.em-today-detail-title { font-size: 13px; font-weight: 700; color: #15803d; margin: 0 0 10px; font-family: 'Poppins', sans-serif; }
.em-today-list { display: flex; flex-direction: column; gap: 6px; }
.em-today-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: 8px; background: #f8fafc; border: 1px solid #f1f5f9; cursor: pointer; transition: all 0.15s; }
.em-today-item:hover { background: #eff6ff; border-color: #bfdbfe; }
.em-today-item-pending { background: #fffbeb; border-color: #fef3c7; }
.em-today-item-pending:hover { background: #fef9c3; }
.em-today-item-time { font-size: 12px; font-weight: 700; color: #475569; min-width: 100px; font-family: 'Poppins', sans-serif; }
.em-today-item-info { flex: 1; font-size: 12.5px; color: #1e293b; font-family: 'Poppins', sans-serif; }
.em-today-item-classe { font-size: 11px; color: #64748b; margin-left: 8px; background: #f1f5f9; padding: 1px 6px; border-radius: 8px; }
.em-today-item-prof { font-size: 11px; color: #64748b; min-width: 120px; font-family: 'Poppins', sans-serif; }
.em-today-item-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; background: #f0fdf4; color: #15803d; white-space: nowrap; font-family: 'Poppins', sans-serif; }

/* ════════════════════════════════════════════════════════ */
/* Tables mois (admin)                                     */
/* ════════════════════════════════════════════════════════ */
.em-mois-table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.em-mois-table { width: 100%; border-collapse: collapse; font-size: 12.5px; font-family: 'Poppins', sans-serif; }
.em-mois-table th { background: #f8fafc; padding: 9px 12px; text-align: left; font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.3px; border-bottom: 1px solid #e2e8f0; }
.em-mois-table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; }
.em-mois-table tbody tr:hover { background: #f8fafc; }
.em-mois-table tfoot td { background: #f8fafc; border-top: 2px solid #e2e8f0; }
.em-mois-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
.em-mois-badge-blue { background: #eff6ff; color: #1d4ed8; }
.em-mois-badge-green { background: #f0fdf4; color: #15803d; }
.em-mois-badge-gray { background: #f1f5f9; color: #475569; }

/* ════════════════════════════════════════════════════════ */
/* Grille admin (2 colonnes)                               */
/* ════════════════════════════════════════════════════════ */
.em-grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }

/* ── Carte gauche ── */
.em-card { background: #fff; border-radius: 10px; border: 1px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); overflow: hidden; }
.em-card-header { padding: 12px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #888; background: #fafafa; border-bottom: 1px solid #f0f0f0; letter-spacing: .5px; }
.em-filters { padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; border-bottom: 1px solid #f0f0f0; }
.em-select { width: 100%; box-sizing: border-box; border: 1.5px solid #e5e5e5; border-radius: 6px; padding: 7px 10px; font-size: 12px; color: #333; background: #fff; font-family: inherit; }
.em-empty { padding: 24px; text-align: center; color: #aaa; font-size: 13px; }
.em-list { max-height: 520px; overflow-y: auto; }
.em-item { width: 100%; text-align: left; padding: 11px 14px; border: none; background: none; cursor: pointer; border-bottom: 1px solid #f9f9f9; border-left: 3px solid transparent; font-family: inherit; transition: background .15s; }
.em-item:hover { background: #fafafa; }
.em-item--active { background: #fff5f5 !important; border-left-color: #E30613; }
.em-item--done { opacity: .8; }
.em-item-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.em-item-mat { font-size: 12.5px; font-weight: 600; color: #222; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.em-item-meta { font-size: 11px; color: #999; margin: 3px 0 0; }
.em-item-prof { font-size: 11px; color: #bbb; margin: 1px 0 0; }

/* Statut dots */
.em-statut-dot { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; }
.em-badge-planifie { background: #eff6ff; color: #2563eb; }
.em-badge-confirme { background: #f0fdf4; color: #16a34a; }
.em-badge-effectue { background: #f0fdf4; color: #15803d; }
.em-badge-annule   { background: #fff0f0; color: #b91c1c; }
.em-badge-reporte  { background: #fffbeb; color: #92400e; }

/* ── Droite ── */
.em-right {}
.em-placeholder { background: #fff; border-radius: 10px; border: 1px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 260px; color: #bbb; font-size: 13px; }
.em-detail { display: flex; flex-direction: column; gap: 12px; }

.em-block { background: #fff; border-radius: 10px; border: 1px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); overflow: hidden; }
.em-block-title { display: flex; align-items: center; gap: 7px; padding: 12px 16px; font-size: 12px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .5px; background: #fafafa; border-bottom: 1px solid #f0f0f0; }

/* Bloc info séance */
.em-block-info { padding: 16px 20px; display: flex; align-items: flex-start; gap: 16px; }
.em-info-left { flex: 1; }
.em-seance-titre { font-size: 16px; font-weight: 700; color: #111; margin: 0; }
.em-seance-sub { font-size: 12px; color: #888; margin: 4px 0 0; }
.em-seance-prof { font-size: 12px; color: #555; margin: 4px 0 0; }
.em-info-right { text-align: right; flex-shrink: 0; }
.em-statut-badge { display: inline-block; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; }
.em-signe-info { font-size: 10.5px; color: #aaa; margin-top: 6px; }

/* Contenu séance */
.em-form-group { padding: 10px 16px 0; }
.em-label { display: block; font-size: 11.5px; font-weight: 600; color: #555; margin-bottom: 5px; }
.em-rich-display { margin-top: 4px; font-size: 13px; color: #333; line-height: 1.6; }
.em-rich-display ul, .em-rich-display ol { padding-left: 20px; margin: 4px 0; }
.em-rich-display li { margin: 2px 0; }
.em-save-contenu { display: flex; align-items: center; gap: 10px; padding: 10px 16px 14px; }
.em-contenu-readonly { padding: 12px 16px; font-size: 13px; color: #444; line-height: 1.6; border-top: 1px solid #f0f0f0; margin-top: 8px; }

/* KPIs présences */
.em-kpis { display: grid; grid-template-columns: repeat(5,1fr); border-bottom: 1px solid #f0f0f0; }
.em-kpi { padding: 12px 8px; text-align: center; border-right: 1px solid #f0f0f0; }
.em-kpi:last-child { border-right: none; }
.em-kpi-val { display: block; font-size: 20px; font-weight: 800; }
.em-kpi-label { display: block; font-size: 10px; color: #aaa; margin-top: 2px; }
.em-kpi-present .em-kpi-val { color: #16a34a; }
.em-kpi-retard  .em-kpi-val { color: #ea580c; }
.em-kpi-absent  .em-kpi-val { color: #E30613; }
.em-kpi-excuse  .em-kpi-val { color: #888; }

/* Barre progression */
.em-progress { height: 5px; background: #f0f0f0; display: flex; overflow: hidden; }
.em-progress-present { background: #22c55e; transition: width .3s; }
.em-progress-retard  { background: #f97316; transition: width .3s; }
.em-progress-absent  { background: #E30613; transition: width .3s; }

.em-quick-actions { padding: 10px 16px; border-bottom: 1px solid #f0f0f0; background: #fafafa; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.em-btn-all-present { background: #22c55e; color: #fff; border: none; border-radius: 5px; padding: 6px 14px; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
.em-btn-all-present:hover { background: #16a34a; }

/* Liste étudiants */
.em-students { max-height: 340px; overflow-y: auto; }
.em-student { display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-bottom: 1px solid #f9f9f9; }
.em-avatar { width: 32px; height: 32px; border-radius: 50%; background: #fde8e8; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #E30613; flex-shrink: 0; text-transform: uppercase; }
.em-student-info { flex: 1; min-width: 0; }
.em-student-name { font-size: 13px; font-weight: 600; color: #222; margin: 0; }
.em-student-sub { font-size: 10.5px; color: #aaa; margin: 0; }
.em-badge { padding: 3px 8px; border-radius: 20px; font-size: 10.5px; font-weight: 600; white-space: nowrap; }
.em-badge-present { background: #f0fdf4; color: #15803d; }
.em-badge-retard  { background: #fff7ed; color: #c2410c; }
.em-badge-absent  { background: #fff0f0; color: #b91c1c; }
.em-badge-excuse  { background: #f3f4f6; color: #555; }
.em-toggles { display: flex; gap: 3px; }
.em-toggle { border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer; font-family: inherit; }
.em-toggle-present { background: #f0fdf4; color: #15803d; }
.em-toggle-present--active { background: #22c55e; color: #fff; }
.em-toggle-retard  { background: #fff7ed; color: #c2410c; }
.em-toggle-retard--active  { background: #f97316; color: #fff; }
.em-toggle-absent  { background: #fff0f0; color: #b91c1c; }
.em-toggle-absent--active  { background: #E30613; color: #fff; }
.em-toggle-excuse  { background: #f3f4f6; color: #555; }
.em-toggle-excuse--active  { background: #888; color: #fff; }
.em-locked-icon { font-size: 14px; color: #ccc; }

/* Footer bloc */
.em-block-footer { padding: 16px 20px; }
.em-footer-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.em-btn-secondary { background: #f3f4f6; color: #374151; border: 1.5px solid #e5e7eb; border-radius: 6px; padding: 9px 16px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
.em-btn-secondary:hover { background: #e5e7eb; }
.em-btn-secondary:disabled { opacity: .5; cursor: not-allowed; }
.em-btn-emarger { background: #E30613; color: #fff; border: none; border-radius: 6px; padding: 9px 20px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
.em-btn-emarger:hover { background: #c00; }
.em-btn-emarger:disabled { opacity: .45; cursor: not-allowed; }

/* ── Modale confirmation ── */
.em-confirm-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(15,23,42,0.55); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.em-confirm-box {
  background: #fff; border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  padding: 32px 28px; width: 420px; max-width: 95vw;
  text-align: center;
}
.em-confirm-icon { font-size: 48px; margin-bottom: 12px; }
.em-confirm-title { font-size: 20px; font-weight: 800; color: #111; margin: 0 0 10px; }
.em-confirm-msg { font-size: 14px; color: #555; line-height: 1.6; margin: 0 0 20px; }
.em-confirm-error { background: #fef2f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #b91c1c; margin-bottom: 16px; }
.em-confirm-actions { display: flex; gap: 12px; }
.em-confirm-btn-cancel {
  flex: 1; padding: 12px; font-size: 14px; font-weight: 600;
  background: #f3f4f6; color: #374151; border: none; border-radius: 10px; cursor: pointer;
}
.em-confirm-btn-cancel:hover { background: #e5e7eb; }
.em-confirm-btn-ok {
  flex: 2; padding: 12px; font-size: 14px; font-weight: 700;
  background: linear-gradient(135deg, #E30613, #c0050f); color: #fff;
  border: none; border-radius: 10px; cursor: pointer;
  box-shadow: 0 4px 12px rgba(227,6,19,0.35);
}
.em-confirm-btn-ok:hover { opacity: 0.88; }
.em-confirm-btn-ok:disabled { opacity: 0.5; cursor: not-allowed; }
.em-success-msg { color: #16a34a; font-size: 12px; font-weight: 600; }
.em-hint { margin: 8px 0 0; font-size: 11.5px; color: #f59e0b; }
.em-cloture-done { display: flex; align-items: center; gap: 14px; background: #f0fdf4; border-radius: 8px; padding: 14px 18px; }
.em-cloture-done-icon { font-size: 24px; }
.em-cloture-done strong { font-size: 13.5px; color: #15803d; }
.em-cloture-done p { font-size: 12px; color: #888; margin: 3px 0 0; }

@media (max-width: 900px) {
  .em-grid { grid-template-columns: 1fr; }
  .em-kpis { grid-template-columns: repeat(3,1fr); }
  .em-kpi:nth-child(3) { border-right: none; }
  .em-students { max-height: none; }
  .em-list { max-height: 280px; }
}
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* ════════════════════════════════════════════════════════ */
/* Layout Enseignant — pleine largeur                      */
/* ════════════════════════════════════════════════════════ */

/* ── Bannière Avoirs ── */
.em-avoirs-banner {
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  border-radius: 14px;
  padding: 20px 28px;
  margin-bottom: 20px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 28px;
  flex-wrap: wrap;
}
.em-avoirs-banner--loading { opacity: .7; }
.em-avoirs-banner-head { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.em-avoirs-banner-icon { font-size: 28px; }
.em-avoirs-banner-title { font-size: 16px; font-weight: 800; color: #fff; }
.em-avoirs-banner-sub { font-size: 11.5px; color: #94a3b8; margin-top: 1px; }
.em-avoirs-kpis { display: flex; align-items: stretch; gap: 0; flex: 1; flex-wrap: wrap; }
.em-akpi { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 0 24px; }
.em-akpi-val { font-size: 22px; font-weight: 800; color: #f1f5f9; line-height: 1.1; }
.em-akpi-label { font-size: 10.5px; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; }
.em-akpi--green .em-akpi-val { color: #4ade80; }
.em-akpi--blue  .em-akpi-val { color: #60a5fa; }
.em-akpi--red   .em-akpi-val { color: #f87171; }
.em-akpi-sep { width: 1px; background: rgba(255,255,255,.12); margin: 4px 0; flex-shrink: 0; }

/* ── Barre de filtres pleine largeur ── */
.em-filters-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.em-select-bar {
  border: 1.5px solid #e5e5e5;
  border-radius: 7px;
  padding: 8px 12px;
  font-size: 12.5px;
  color: #333;
  background: #fff;
  font-family: inherit;
  min-width: 160px;
}
.em-btn-clear {
  padding: 7px 10px;
  border: 1.5px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 11px;
  color: #6b7280;
  white-space: nowrap;
  font-family: inherit;
}
.em-btn-clear:hover { background: #f9fafb; }
.em-btn-refresh {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  border: 1.5px solid #e5e7eb;
  border-radius: 7px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
  color: #374151;
  font-family: inherit;
  margin-left: auto;
}
.em-btn-refresh:hover { background: #f9fafb; }
.em-btn-refresh:disabled { opacity: .5; cursor: not-allowed; }

/* ── Section header ── */
.em-section { margin-bottom: 24px; }
.em-section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 14px;
}
.em-section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700; color: #111; margin: 0;
}
.em-section-count { font-size: 12px; color: #888; font-weight: 500; }
.em-empty-section {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 48px 24px;
  background: #fff;
  border-radius: 12px;
  border: 1.5px dashed #e5e7eb;
  color: #aaa; font-size: 13px; text-align: center;
}

/* ── Cards séances (grille) ── */
.em-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.em-seance-card {
  background: #fff;
  border: 2px solid #f0f0f0;
  border-radius: 12px;
  padding: 16px 18px;
  cursor: pointer;
  transition: border-color .2s, box-shadow .2s, transform .15s;
  box-shadow: 0 1px 4px rgba(0,0,0,.04);
}
.em-seance-card:hover {
  border-color: #fca5a5;
  box-shadow: 0 4px 16px rgba(227,6,19,.08);
  transform: translateY(-1px);
}
.em-seance-card--active {
  border-color: #E30613 !important;
  box-shadow: 0 4px 20px rgba(227,6,19,.15) !important;
  background: #fff5f5;
}
.em-sc-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.em-sc-matiere { font-size: 15px; font-weight: 700; color: #111; flex: 1; line-height: 1.3; }
.em-sc-classe { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #555; margin-bottom: 5px; }
.em-sc-time { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #777; margin-bottom: 12px; }
.em-sc-footer { display: flex; align-items: center; justify-content: space-between; }
.em-sc-duree { font-size: 12px; font-weight: 600; background: #f0f9ff; color: #0284c7; padding: 3px 8px; border-radius: 20px; }
.em-sc-action { font-size: 11px; color: #E30613; font-weight: 600; }

/* ── Panneau détail (pleine largeur) ── */
.em-detail-panel {
  background: #fff;
  border: 2px solid #E30613;
  border-radius: 14px;
  margin-bottom: 24px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(227,6,19,.1);
}
.em-detail-panel-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 14px 20px;
  background: #fff5f5;
  border-bottom: 1.5px solid #fecaca;
  flex-wrap: wrap;
}
.em-detail-panel-title { font-size: 14px; color: #111; }
.em-btn-close {
  border: none; background: none; cursor: pointer;
  font-size: 16px; color: #9ca3af; padding: 4px 8px;
  border-radius: 6px; font-family: inherit; line-height: 1;
}
.em-btn-close:hover { background: #fee2e2; color: #E30613; }
.em-detail-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }

/* ── Historique table ── */
.em-historique-wrap {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f0f0f0;
  overflow-x: auto;
  box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.em-historique-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.em-historique-table thead tr {
  background: #fafafa;
  border-bottom: 2px solid #f0f0f0;
}
.em-historique-table th {
  padding: 12px 16px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: .5px;
  white-space: nowrap;
}
.em-historique-table td {
  padding: 12px 16px;
  border-bottom: 1px solid #f9f9f9;
  color: #374151;
  vertical-align: middle;
}
.em-historique-table tbody tr:hover { background: #fafafa; }
.em-historique-table tbody tr:last-child td { border-bottom: none; }
.em-historique-table tfoot td { background: #f9fafb; border-top: 2px solid #f0f0f0; }
.em-ht-mat { font-weight: 600; color: #111; }
.em-ht-duree { font-weight: 700; color: #16a34a; }

@media (max-width: 900px) {
  .em-grid { grid-template-columns: 1fr; }
  .em-kpis { grid-template-columns: repeat(3,1fr); }
  .em-kpi:nth-child(3) { border-right: none; }
  .em-students { max-height: none; }
  .em-list { max-height: 280px; }
  .em-avoirs-banner { flex-direction: column; align-items: flex-start; }
  .em-akpi { padding: 8px 0; }
  .em-akpi-sep { width: 100%; height: 1px; }
  .em-cards-grid { grid-template-columns: 1fr; }
}

/* ════════════════ HERO ENSEIGNANT ════════════════ */
.em-hero {
  position: relative; overflow: hidden;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1a0a0a 100%);
  border-radius: 16px; margin-bottom: 16px; color: #fff;
}
.em-hero-glow {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 80% 40%, rgba(227,6,19,.18) 0%, transparent 65%);
  pointer-events: none;
}
.em-hero-content {
  position: relative; display: flex; align-items: center;
  justify-content: space-between; gap: 20px;
  padding: 20px 24px; flex-wrap: wrap;
}
.em-hero-left { display: flex; align-items: center; gap: 14px; }
.em-hero-avatar {
  width: 52px; height: 52px; border-radius: 50%;
  background: linear-gradient(135deg, #E30613, #b91c1c);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 800; color: #fff; flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(255,255,255,.1); text-transform: uppercase;
}
.em-hero-label { font-size: 10px; color: rgba(255,255,255,.4); text-transform: uppercase; letter-spacing: 1px; }
.em-hero-name { font-size: 18px; font-weight: 800; color: #fff; margin: 2px 0; }
.em-hero-date { font-size: 11px; color: rgba(255,255,255,.4); }
.em-hero-kpis { display: flex; gap: 8px; flex-wrap: wrap; }
.em-hkpi {
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
  border-radius: 10px; padding: 10px 16px; text-align: center; min-width: 60px;
}
.em-hkpi-val { font-size: 18px; font-weight: 800; color: #fff; }
.em-hkpi-lbl { font-size: 9.5px; color: rgba(255,255,255,.4); margin-top: 3px; white-space: nowrap; }

/* Live strip */
.em-hero-strip {
  position: relative; border-top: 1px solid rgba(255,255,255,.07);
  padding: 10px 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.em-live-pill {
  font-size: 9.5px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  border-radius: 20px; padding: 3px 10px; white-space: nowrap;
  animation: pulse-live 1.5s ease-in-out infinite;
}
@keyframes pulse-live { 0%,100% { opacity:1 } 50% { opacity:.6 } }
.em-hero-strip-label { font-size: 9.5px; font-weight: 700; color: rgba(255,255,255,.35); text-transform: uppercase; letter-spacing: .8px; white-space: nowrap; }
.em-hero-strip-body { display: flex; align-items: center; gap: 8px; flex: 1; flex-wrap: wrap; }
.em-mode-badge { width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
.em-hero-strip-body strong { font-size: 13px; color: #fff; }
.em-hero-strip-meta { font-size: 11px; color: rgba(255,255,255,.45); }
.em-countdown-chip {
  font-size: 11.5px; font-weight: 700; color: #fbbf24;
  background: rgba(251,191,36,.12); border-radius: 20px; padding: 3px 12px; white-space: nowrap;
}

/* ════════════════ TOOLBAR ════════════════ */
.em-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 18px; flex-wrap: wrap;
}
.em-toolbar-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1; }
.em-date-wrap { display: flex; gap: 5px; align-items: center; }
.em-search-wrap {
  display: flex; align-items: center; gap: 6px;
  border: 1.5px solid #e5e5e5; border-radius: 7px;
  padding: 0 10px; background: #fff; min-width: 180px; flex: 1; max-width: 250px;
}
.em-search-icon { color: #aaa; flex-shrink: 0; }
.em-search-input { border: none; outline: none; font-size: 12.5px; color: #333; font-family: inherit; flex: 1; padding: 7px 0; background: none; }
.em-btn-clear-sm { border: none; background: none; cursor: pointer; color: #aaa; font-size: 11px; padding: 2px; }

/* ════════════════ SÉANCE CARDS ════════════════ */
.em-seance-card--live { border-color: #ef4444 !important; }
.em-seance-card--live .em-sc-modebar { animation: pulse-border 2s ease-in-out infinite; }
@keyframes pulse-border { 0%,100% { opacity:1 } 50% { opacity:.8 } }
.em-seance-card--overdue { border-color: #f97316 !important; }

.em-sc-modebar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 10px 10px 0 0; margin: -16px -18px 12px;
}
.em-sc-mode-icon { font-size: 16px; }
.em-sc-mode-label { font-size: 11px; font-weight: 700; color: rgba(255,255,255,.9); flex: 1; }
.em-sc-live-badge {
  font-size: 9.5px; font-weight: 800; color: #fff;
  background: rgba(255,255,255,.25); border-radius: 20px; padding: 2px 8px;
  animation: pulse-live 1.5s ease-in-out infinite;
}
.em-sc-overdue-badge {
  font-size: 9.5px; font-weight: 800; color: #fff;
  background: rgba(255,255,255,.25); border-radius: 20px; padding: 2px 8px;
}
.em-sc-body { padding: 0; }
.em-sc-action--open { color: #E30613 !important; font-weight: 700; }

/* ════════════════ DÉTAIL PANEL ════════════════ */
.em-detail-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; padding: 16px 20px; flex-wrap: wrap;
}
.em-detail-header-left { display: flex; align-items: center; gap: 14px; flex: 1; }
.em-detail-mode-icon { font-size: 28px; flex-shrink: 0; }
.em-detail-header-info { flex: 1; }
.em-detail-matiere { font-size: 18px; font-weight: 800; color: #fff; }
.em-detail-meta { font-size: 12px; color: rgba(255,255,255,.7); margin-top: 3px; }
.em-detail-header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.em-btn-close-white {
  border: 1.5px solid rgba(255,255,255,.3); background: rgba(255,255,255,.1);
  color: rgba(255,255,255,.7); border-radius: 8px; padding: 5px 10px;
  cursor: pointer; font-size: 14px; font-family: inherit; line-height: 1;
}
.em-btn-close-white:hover { background: rgba(255,255,255,.2); color: #fff; }

/* ════════════════ PRESENCE OVERVIEW ════════════════ */
.em-presence-overview { display: flex; align-items: center; justify-content: space-between; }
.em-kpis { flex: 1; display: grid; grid-template-columns: repeat(4,1fr); border-bottom: 1px solid #f0f0f0; }
.em-gauge-side { padding: 16px 18px; border-left: 1px solid #f0f0f0; flex-shrink: 0; }

/* ════════════════ STUDENT SEARCH ════════════════ */
.em-student-search {
  display: flex; align-items: center; gap: 5px;
  border: 1.5px solid #e5e5e5; border-radius: 6px;
  padding: 0 8px; background: #fff; flex: 1; max-width: 220px;
}
.em-student-search-input { border: none; outline: none; font-size: 12px; font-family: inherit; padding: 5px 0; flex: 1; background: none; }

/* Student color theming by status */
.em-student--present { background: #f0fdf4; }
.em-student--retard  { background: #fff7ed; }
.em-student--absent  { background: #fff9f9; }
.em-av-present { background: #dcfce7 !important; color: #15803d !important; }
.em-av-retard  { background: #ffedd5 !important; color: #c2410c !important; }
.em-av-absent  { background: #fee2e2 !important; color: #b91c1c !important; }
.em-av-excuse  { background: #f3f4f6 !important; color: #6b7280 !important; }

/* ════════════════ HISTORIQUE PAR MOIS ════════════════ */
.em-mois-group { margin-bottom: 20px; }
.em-mois-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0 10px;
  border-bottom: 2px solid #f0f0f0;
  margin-bottom: 0;
}
.em-mois-label { font-size: 14px; font-weight: 700; color: #111; text-transform: capitalize; }
.em-mois-stats { font-size: 12px; color: #888; }
.em-ht-mode-chip {
  width: 20px; height: 20px; border-radius: 5px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; vertical-align: middle; margin-right: 6px;
}

/* ════════════════ SPINNER ════════════════ */
.em-spinner {
  width: 28px; height: 28px; border-radius: 50%;
  border: 3px solid #f0f0f0; border-top-color: #E30613;
  animation: spin 0.8s linear infinite;
}

/* ════════════════ RESPONSIVE ════════════════ */
@media (max-width: 768px) {
  .em-hero-content { padding: 16px 18px; flex-direction: column; align-items: flex-start; }
  .em-hero-kpis { width: 100%; display: grid; grid-template-columns: repeat(4,1fr); }
  .em-hero-strip { padding: 8px 18px; }
  .em-toolbar { flex-direction: column; align-items: stretch; }
  .em-toolbar-left { flex-direction: column; align-items: stretch; }
  .em-search-wrap { max-width: none; }
  .em-presence-overview { flex-direction: column-reverse; }
  .em-kpis { grid-template-columns: repeat(2,1fr); }
  .em-gauge-side { border-left: none; border-bottom: 1px solid #f0f0f0; width: 100%; display: flex; justify-content: center; }
}
@media (max-width: 480px) {
  .em-hero-kpis { grid-template-columns: repeat(2,1fr); }
  .em-hkpi { padding: 8px 10px; }
  .em-hkpi-val { font-size: 15px; }
  .em-cards-grid { grid-template-columns: 1fr; }
  .em-detail-header { flex-direction: column; align-items: flex-start; }
  .em-detail-header-right { width: 100%; justify-content: flex-end; }
}
</style>
