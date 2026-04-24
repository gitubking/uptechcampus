<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcFormGrid from '@/components/ui/UcFormGrid.vue'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const auth = useAuthStore()
const toast = useToast()

const isEnseignant = computed(() => auth.user?.role === 'enseignant')
const isEtudiant = computed(() => auth.user?.role === 'etudiant')
const monEnseignantId = ref<number | null>(null)
const monClasseId = ref<number | null>(null)
const mesTroncCommunIds = ref<number[]>([])

const canWrite = computed(() =>
  ['dg', 'dir_peda', 'coordinateur', 'secretariat'].includes(auth.user?.role ?? '')
)

interface Seance {
  id: number
  classe_id: number
  enseignant_id: number | null
  matiere: string
  date_debut: string
  date_fin: string
  mode: 'presentiel' | 'en_ligne' | 'hybride' | 'exam'
  salle: string | null
  lien_visio: string | null
  statut: 'planifie' | 'confirme' | 'annule' | 'reporte' | 'effectue'
  notes: string | null
  annee_academique_id: number | null
  groupe_serie?: string | null
  fi_module_id?: number | null
  classe?: { id: number; nom: string; filiere?: { nom: string } }
  enseignant?: { id: number; nom: string; prenom: string }
}

interface Matiere { id: number; nom: string; code: string }
interface FiliereMatiere extends Matiere {
  pivot?: { coefficient: number; credits: number; ordre: number }
}
interface MatiereOption extends FiliereMatiere {
  volumeTotal: number    // credits du pivot (0 = non configuré)
  heuresPlanifiees: number
  heuresRestantes: number
  label: string          // texte affiché dans le <option>
}
interface EnseignantFiliere { id: number; filiere_id: number; matiere: string }
interface UESimple { id: number; intitule: string; code: string; enseignant_id: number | null; matiere_id: number | null; volume_horaire?: number; credits_ects?: number; classe_id?: number; coefficient?: number }
interface Classe { id: number; nom: string; filiere_id: number | null; est_tronc_commun?: boolean; filiere?: { id: number; nom: string }; troncs_commun?: { id: number; nom: string }[] }
interface Enseignant { id: number; nom: string; prenom: string; filieres?: EnseignantFiliere[] }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }

const seances = ref<Seance[]>([])
const classes = ref<Classe[]>([])
const enseignants = ref<Enseignant[]>([])
const anneesAcademiques = ref<AnneeAcademique[]>([])
const filieres = ref<{ id: number; nom: string; matieres?: FiliereMatiere[] }[]>([])
const uesForSelectedClasse = ref<UESimple[]>([])
const allUes = ref<UESimple[]>([])
const congesInstitut = ref<{ id: number; nom: string; date_debut: string; date_fin: string; type: string }[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const loadError = ref('')

// Live time + week/view toggles
const now = ref(new Date())
let ticker: ReturnType<typeof setInterval> | null = null
const showWeekend = ref(false)
const viewMode = ref<'grid' | 'list'>('grid')
const viewAll = ref(false)  // "Tout mon planning" — enseignant uniquement
const pdfColor = ref(true)

// Filtres
const filterClasse = ref('')
const filterEnseignant = ref('')
const currentWeekOffset = ref(0)

// Semaine courante
const currentWeekStart = computed(() => {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now.setDate(diff))
  monday.setDate(monday.getDate() + currentWeekOffset.value * 7)
  monday.setHours(0, 0, 0, 0)
  return monday
})

const weekDays = computed(() => {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(currentWeekStart.value)
    d.setDate(d.getDate() + i)
    return d
  })
  return showWeekend.value ? days : days.slice(0, 5)
})

const weekLabel = computed(() => {
  const start = weekDays.value[0]!
  const end = weekDays.value[weekDays.value.length - 1]!
  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)} ${end.getFullYear()}`
})

const todayStr = computed(() => new Date().toISOString().slice(0, 10))
function isToday(d: Date) { return d.toISOString().slice(0, 10) === todayStr.value }

// Vérifier si un jour tombe dans une période de congé et retourner le nom
function getConge(d: Date): { nom: string; type: string } | null {
  const ds = d.toISOString().slice(0, 10)
  const match = congesInstitut.value.find(cg => {
    const cgStart = String(cg.date_debut).slice(0, 10)
    const cgEnd = String(cg.date_fin).slice(0, 10)
    return ds >= cgStart && ds <= cgEnd
  })
  return match ? { nom: match.nom, type: match.type } : null
}

// Vérifier si toute la semaine est en congé
const weekConge = computed(() => {
  if (weekDays.value.length === 0) return null
  const conges = weekDays.value.map(d => getConge(d))
  // Si tous les jours de la semaine sont en congé avec le même nom
  if (conges.every(c => c !== null)) {
    const noms = [...new Set(conges.map(c => c!.nom))]
    if (noms.length === 1) return noms[0]
    return noms.join(' / ')
  }
  return null
})

// Créneaux horaires 08h-19h
const timeSlots = Array.from({ length: 12 }, (_, i) => i + 8) // 8..19

function hourToRow(h: number, m = 0) { return (h - 8) * 2 + (m >= 30 ? 2 : 1) }

// Grille : pour chaque jour, les séances filtrées
const seancesFiltered = computed(() => {
  return seances.value.filter(s => {
    if (filterClasse.value && String(s.classe_id) !== String(filterClasse.value)) return false
    if (filterEnseignant.value && String(s.enseignant_id) !== String(filterEnseignant.value)) return false
    if (s.statut === 'annule') return false
    // En mode "tout mon planning", pas de filtre semaine
    if (viewAll.value && (isEnseignant.value || isEtudiant.value)) return true
    const d = new Date(s.date_debut)
    const start = weekDays.value[0]!; const end = new Date(weekDays.value[weekDays.value.length - 1]!)
    end.setHours(23, 59, 59)
    return d >= start && d <= end
  })
})

// Dates distinctes triées pour la vue "Tout mon planning"
const allDates = computed(() => {
  const seen = new Set<string>()
  const dates: Date[] = []
  for (const s of seancesFiltered.value) {
    const key = new Date(s.date_debut).toISOString().slice(0, 10)
    if (!seen.has(key)) { seen.add(key); dates.push(new Date(s.date_debut)) }
  }
  return dates.sort((a, b) => a.getTime() - b.getTime())
})

function seancesForDay(dayDate: Date) {
  return seancesFiltered.value.filter(s => {
    const d = new Date(s.date_debut)
    return d.getFullYear() === dayDate.getFullYear() &&
      d.getMonth() === dayDate.getMonth() &&
      d.getDate() === dayDate.getDate()
  })
}

function seanceGridRow(s: Seance) {
  const d = new Date(s.date_debut)
  return hourToRow(d.getHours(), d.getMinutes())
}
function seanceGridSpan(s: Seance) {
  const start = new Date(s.date_debut)
  const end = new Date(s.date_fin)
  const mins = (end.getTime() - start.getTime()) / 60000
  return Math.max(1, Math.round(mins / 30))
}

const modeBadge: Record<string, string> = {
  presentiel: 'bg-green-100 text-green-700 border-green-200',
  en_ligne:   'bg-blue-100 text-blue-700 border-blue-200',
  hybride:    'bg-orange-100 text-orange-700 border-orange-200',
  exam:       'bg-red-100 text-red-700 border-red-200',
}
const modeCard: Record<string, string> = {
  presentiel: 'bg-green-50 border-l-4 border-green-400',
  en_ligne:   'bg-blue-50 border-l-4 border-blue-400',
  hybride:    'bg-orange-50 border-l-4 border-orange-400',
  exam:       'bg-red-50 border-l-4 border-red-400',
}
const modeLabel: Record<string, string> = {
  presentiel: 'Présentiel', en_ligne: 'En ligne', hybride: 'Hybride', exam: 'Examen',
}
const modeIcon: Record<string, string> = {
  presentiel: '🏫', en_ligne: '💻', hybride: '🔀', exam: '📝',
}

/* ── Palette couleurs par matière ─────────────────────────── */
const MATIERE_PALETTE = [
  { from: '#6366f1', to: '#4f46e5' },  // violet indigo
  { from: '#10b981', to: '#059669' },  // émeraude
  { from: '#f97316', to: '#ea580c' },  // orange ardent
  { from: '#3b82f6', to: '#2563eb' },  // bleu électrique
  { from: '#ec4899', to: '#db2777' },  // rose fuchsia
  { from: '#14b8a6', to: '#0d9488' },  // turquoise
  { from: '#f59e0b', to: '#d97706' },  // ambre doré
  { from: '#8b5cf6', to: '#7c3aed' },  // violet pourpre
  { from: '#ef4444', to: '#dc2626' },  // rouge vif
  { from: '#06b6d4', to: '#0891b2' },  // cyan
  { from: '#84cc16', to: '#65a30d' },  // vert lime
  { from: '#f43f5e', to: '#e11d48' },  // rose vif
  { from: '#a855f7', to: '#9333ea' },  // mauve
  { from: '#0ea5e9', to: '#0284c7' },  // sky blue
  { from: '#22d3ee', to: '#06b6d4' },  // cyan clair
  { from: '#fb923c', to: '#f97316' },  // pêche
]

function hashMatiere(nom: string): number {
  let h = 0
  for (let i = 0; i < nom.length; i++) h = ((h << 5) - h + nom.charCodeAt(i)) | 0
  return Math.abs(h) % MATIERE_PALETTE.length
}

function matiereGradient(nom: string): string {
  if (!nom) return 'linear-gradient(135deg,#94a3b8,#64748b)'
  const c = MATIERE_PALETTE[hashMatiere(nom)]!
  return `linear-gradient(135deg, ${c.from} 0%, ${c.to} 100%)`
}

function matiereColor(nom: string): string {
  if (!nom) return '#94a3b8'
  return MATIERE_PALETTE[hashMatiere(nom)]!.from
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// Couleur de fond vive (comme l'app) à partir de la couleur de la matière
function matiereBgRgb(nom: string): [number, number, number] {
  return hexToRgb(matiereColor(nom))
}

function matiereTextRgb(_nom: string): [number, number, number] {
  return [255, 255, 255]
}

/* Liste des matières uniques de la semaine affichée */
const matieresSemaine = computed(() => {
  const seen = new Set<string>()
  const list: { nom: string; gradient: string }[] = []
  for (const s of seancesFiltered.value) {
    if (s.matiere && !seen.has(s.matiere)) {
      seen.add(s.matiere)
      list.push({ nom: s.matiere, gradient: matiereGradient(s.matiere) })
    }
  }
  return list
})

// ── KPIs hero ──────────────────────────────────────────────────────────
const kpiSemaine = computed(() => seancesFiltered.value.length)

const kpiAujourdhui = computed(() => {
  const t = todayStr.value
  return seances.value.filter(s => {
    if (s.statut === 'annule') return false
    return new Date(s.date_debut).toISOString().slice(0, 10) === t
  }).length
})

const kpiHeures = computed(() => {
  const total = seancesFiltered.value.reduce((acc, s) => {
    return acc + (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 3600000
  }, 0)
  return Math.round(total * 2) / 2
})

const kpiEmargement = computed(() => {
  const total = seancesFiltered.value.length
  if (!total) return 0
  const done = seancesFiltered.value.filter(s => s.statut === 'effectue').length
  return Math.round(done / total * 100)
})

// Position ligne heure courante (px depuis top du corps)
// Chaque heure = 64px, grille commence à 8h
const nowLineTop = computed(() => {
  const h = now.value.getHours()
  const m = now.value.getMinutes()
  if (h < 8 || h > 19) return -1
  return (h - 8) * 64 + (m / 60) * 64
})

function fmtTime(dt: string) {
  const d = new Date(dt)
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Modale création/édition
const showModal = ref(false)
const editId = ref<number | null>(null)
const form = ref({
  classe_id: '',
  enseignant_id: '',
  matiere: '',
  date: '',
  heure_debut: '08:00',
  heure_fin: '10:00',
  mode: 'presentiel' as Seance['mode'],
  salle: '',
  lien_visio: '',
  annee_academique_id: '',
  notes: '',
})

function openCreate() {
  editId.value = null
  uesForSelectedClasse.value = []
  const today = weekDays.value[0]!
  form.value = {
    classe_id: filterClasse.value,
    enseignant_id: filterEnseignant.value,
    matiere: '',
    date: today.toISOString().slice(0, 10),
    heure_debut: '08:00',
    heure_fin: '10:00',
    mode: 'presentiel',
    salle: '',
    lien_visio: '',
    annee_academique_id: String(anneesAcademiques.value.find(a => a.actif)?.id ?? ''),
    notes: '',
  }
  // Si la classe pré-filtrée est un tronc commun, charger ses UEs
  if (filterClasse.value) {
    const c = classes.value.find(c => String(c.id) === String(filterClasse.value))
    if (c?.est_tronc_commun) loadUesForClasse(filterClasse.value)
  }
  showModal.value = true
}

function openEdit(s: Seance) {
  editId.value = s.id
  uesForSelectedClasse.value = []
  const debut = new Date(s.date_debut)
  const fin = new Date(s.date_fin)
  form.value = {
    classe_id: String(s.classe_id),
    enseignant_id: String(s.enseignant_id ?? ''),
    matiere: s.matiere,
    date: debut.toISOString().slice(0, 10),
    heure_debut: debut.toTimeString().slice(0, 5),
    heure_fin: fin.toTimeString().slice(0, 5),
    mode: s.mode,
    salle: s.salle ?? '',
    lien_visio: s.lien_visio ?? '',
    annee_academique_id: String(s.annee_academique_id ?? ''),
    notes: s.notes ?? '',
  }
  // Si la classe est un tronc commun, charger ses UEs
  const c = classes.value.find(c => String(c.id) === String(s.classe_id))
  if (c?.est_tronc_commun) loadUesForClasse(String(s.classe_id))
  selectedSeance.value = null
  showModal.value = true
}

// Popup détail
const selectedSeance = ref<Seance | null>(null)

function toggleDetail(s: Seance) {
  selectedSeance.value = selectedSeance.value?.id === s.id ? null : s
}

// Détection conflit
function hasConflict() {
  if (!form.value.enseignant_id || !form.value.date) return false
  const start = new Date(`${form.value.date}T${form.value.heure_debut}`)
  const end = new Date(`${form.value.date}T${form.value.heure_fin}`)
  return seances.value.some(s => {
    if (s.statut === 'annule') return false
    if (editId.value && s.id === editId.value) return false
    if (String(s.enseignant_id) !== form.value.enseignant_id) return false
    const sStart = new Date(s.date_debut)
    const sEnd = new Date(s.date_fin)
    return start < sEnd && end > sStart
  })
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const payload = {
      classe_id: Number(form.value.classe_id),
      enseignant_id: form.value.enseignant_id ? Number(form.value.enseignant_id) : null,
      matiere: form.value.matiere,
      date_debut: `${form.value.date} ${form.value.heure_debut}:00`,
      date_fin: `${form.value.date} ${form.value.heure_fin}:00`,
      mode: form.value.mode,
      salle: form.value.salle || null,
      lien_visio: form.value.lien_visio || null,
      annee_academique_id: form.value.annee_academique_id ? Number(form.value.annee_academique_id) : null,
      notes: form.value.notes || null,
    }
    if (editId.value) {
      await api.put(`/seances/${editId.value}`, payload)
    } else {
      await api.post('/seances', payload)
    }
    showModal.value = false
    await load()
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur lors de la sauvegarde'
  } finally {
    saving.value = false
  }
}

async function annuler(s: Seance) {
  if (!confirm(`Annuler la séance "${s.matiere}" ?`)) return
  await api.post(`/seances/${s.id}/annuler`)
  selectedSeance.value = null
  await load()
}

// ── Gestion des séries ────────────────────────────────────────────────
const showSerieModal = ref(false)
const savingSerie = ref(false)
const serieGroupeId = ref('')
const serieSeances = ref<Seance[]>([])
const serieForm = ref({ enseignant_id: '', matiere: '', mode: '', salle: '', heure_debut: '', heure_fin: '', a_partir_de: '', jours: [] as number[], date_fin: '' })

const jourNomsMap: Record<number, string> = { 0: 'Dimanche', 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' }

function nbSeancesSerie(groupeId: string | null | undefined): number {
  if (!groupeId) return 0
  return seances.value.filter(s => s.groupe_serie === groupeId && s.statut !== 'annule').length
}

// Jours de la semaine utilisés dans la série
const serieJours = computed(() => {
  const days = new Set<number>()
  serieSeances.value.forEach(s => {
    if (s.statut !== 'annule') days.add(new Date(s.date_debut).getDay())
  })
  return Array.from(days).sort().map(d => jourNomsMap[d] || String(d))
})

// Séances qui seront affectées par la modification (filtré par a_partir_de)
const serieSeancesAffectees = computed(() => {
  let list = serieSeances.value.filter(s => s.statut === 'planifie')
  if (serieForm.value.a_partir_de) {
    list = list.filter(s => s.date_debut >= serieForm.value.a_partir_de)
  }
  return list
})

// Plage de dates de la série
const seriePlage = computed(() => {
  const planifiees = serieSeances.value.filter(s => s.statut !== 'annule')
  if (!planifiees.length) return null
  const dates = planifiees.map(s => s.date_debut).sort()
  return {
    debut: new Date(dates[0] as string).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }),
    fin: new Date(dates[dates.length - 1] as string).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }),
    total: planifiees.length,
    planifiees: serieSeances.value.filter(s => s.statut === 'planifie').length,
    effectuees: serieSeances.value.filter(s => s.statut === 'effectue').length,
  }
})

async function openSerieEdit(s: Seance) {
  const gid = s.groupe_serie
  if (!gid) return
  serieGroupeId.value = gid
  try {
    const { data } = await api.get(`/seances/groupe/${gid}`)
    serieSeances.value = data
  } catch { serieSeances.value = [] }
  const planifiees = serieSeances.value.filter(s => s.statut === 'planifie')
  const first = planifiees[0] || s
  // Extraire les jours uniques de la série
  const joursSet = new Set<number>()
  serieSeances.value.filter(ss => ss.statut !== 'annule').forEach(ss => joursSet.add(new Date(ss.date_debut).getDay()))
  // Date de fin = dernière séance planifiée
  const datesSorted = planifiees.map(ss => ss.date_debut).sort()
  const lastDate = datesSorted.length > 0 ? (datesSorted[datesSorted.length - 1] as string).slice(0, 10) : ''

  serieForm.value = {
    enseignant_id: first.enseignant_id ? String(first.enseignant_id) : '',
    matiere: first.matiere,
    mode: first.mode,
    salle: first.salle || '',
    heure_debut: first.date_debut ? new Date(first.date_debut).toTimeString().slice(0, 5) : '',
    heure_fin: first.date_fin ? new Date(first.date_fin).toTimeString().slice(0, 5) : '',
    a_partir_de: '',
    jours: Array.from(joursSet).sort(),
    date_fin: lastDate,
  }
  selectedSeance.value = null
  showSerieModal.value = true
}

function toggleSerieJour(jour: number) {
  const idx = serieForm.value.jours.indexOf(jour)
  if (idx >= 0) {
    if (serieForm.value.jours.length > 1) serieForm.value.jours.splice(idx, 1)
  } else {
    serieForm.value.jours.push(jour)
    serieForm.value.jours.sort()
  }
}

async function saveSerie() {
  savingSerie.value = true
  try {
    const payload: any = {
      enseignant_id: serieForm.value.enseignant_id ? Number(serieForm.value.enseignant_id) : null,
      matiere: serieForm.value.matiere,
      mode: serieForm.value.mode,
      salle: serieForm.value.salle || null,
    }
    if (serieForm.value.heure_debut && serieForm.value.heure_fin) {
      payload.heure_debut = serieForm.value.heure_debut
      payload.heure_fin = serieForm.value.heure_fin
    }
    if (serieForm.value.a_partir_de) {
      payload.a_partir_de = serieForm.value.a_partir_de
    }
    if (serieForm.value.jours.length > 0) {
      payload.jours = serieForm.value.jours
    }
    if (serieForm.value.date_fin) {
      payload.date_fin = serieForm.value.date_fin
    }
    await api.put(`/seances/groupe/${serieGroupeId.value}`, payload)
    showSerieModal.value = false
    await load()
  } catch (e: any) {
    toast.apiError(e, 'Erreur')
  } finally {
    savingSerie.value = false
  }
}

async function deleteSerie(gid: string) {
  const dateFilter = showSerieModal.value && serieForm.value.a_partir_de ? serieForm.value.a_partir_de : ''
  const nb = dateFilter ? serieSeancesAffectees.value.length : nbSeancesSerie(gid)
  const msg = dateFilter
    ? `Supprimer les ${nb} séance(s) planifiée(s) à partir du ${new Date(dateFilter).toLocaleDateString('fr-FR')} ?`
    : `Supprimer les ${nb} séance(s) planifiée(s) de cette série ?`
  if (!confirm(msg)) return
  try {
    const url = dateFilter
      ? `/seances/groupe/${gid}?a_partir_de=${dateFilter}`
      : `/seances/groupe/${gid}`
    await api.delete(url)
    selectedSeance.value = null
    showSerieModal.value = false
    await load()
  } catch (e: any) {
    toast.apiError(e, 'Erreur')
  }
}

// ── Planification en série (répétition hebdo) ─────────────────────────
const showRepeat = ref(false)
const savingRepeat = ref(false)
const repeatResult = ref<{ total_crees: number; total_exclues: number; exclues: { date: string; jour?: string; raison: string }[] } | null>(null)
// UEs chargées pour la classe sélectionnée dans le formulaire répétition (chargement spécifique)
const repeatClasseUes = ref<UESimple[]>([])
const loadingRepeatUes = ref(false)
async function loadRepeatClasseUes(classeId: string | number) {
  if (!classeId) { repeatClasseUes.value = []; return }
  loadingRepeatUes.value = true
  try {
    const { data } = await api.get('/ues', { params: { classe_id: classeId } })
    repeatClasseUes.value = Array.isArray(data) ? data : (data.data ?? [])
  } catch { repeatClasseUes.value = [] }
  finally { loadingRepeatUes.value = false }
}
const repeatForm = ref({
  classe_id: '',
  enseignant_id: '',
  matiere: '',
  heure_debut: '08:00',
  heure_fin: '10:00',
  jours: [1] as number[],
  date_debut: '',
  date_fin: '',
  mode: 'presentiel' as string,
  salle: '',
  annee_academique_id: '',
})

const joursSemaine = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
]

function toggleJour(jour: number) {
  const idx = repeatForm.value.jours.indexOf(jour)
  if (idx >= 0) {
    if (repeatForm.value.jours.length > 1) repeatForm.value.jours.splice(idx, 1)
  } else {
    repeatForm.value.jours.push(jour)
    repeatForm.value.jours.sort()
  }
}

// Disponibilités de l'enseignant sélectionné
const enseignantDispos = ref<{ jour: number; heure_debut: string; heure_fin: string }[]>([])
const loadingDispos = ref(false)

async function loadEnseignantDispos(ensId: string) {
  if (!ensId) { enseignantDispos.value = []; return }
  loadingDispos.value = true
  try {
    const { data } = await api.get(`/enseignants/${ensId}/disponibilites`)
    enseignantDispos.value = data
  } catch { enseignantDispos.value = [] }
  finally { loadingDispos.value = false }
}

// Charger les dispos + auto-sélectionner matière quand on change d'enseignant
watch(() => repeatForm.value.enseignant_id, (newId) => {
  if (!showRepeat.value) return
  loadEnseignantDispos(newId)
  repeatForm.value.matiere = ''
  if (newId && repeatForm.value.classe_id) {
    // Attendre que les UEs soient chargées puis auto-sélectionner si 1 seule affectée
    setTimeout(() => {
      const assigned = repeatProfAssignedCount.value
      const mats = matieresForRepeat.value
      if (assigned === 1 && mats.length === 1 && mats[0]) repeatForm.value.matiere = mats[0].nom
    }, 200)
  }
})

// Charger les UEs de la classe + réinitialiser matière quand on change de classe
watch(() => repeatForm.value.classe_id, async (newClasseId) => {
  repeatForm.value.matiere = ''
  repeatClasseUes.value = []
  if (!newClasseId) return
  await loadRepeatClasseUes(newClasseId)
  // Auto-sélectionner si prof sélectionné et 1 seule matière affectée
  if (repeatForm.value.enseignant_id) {
    const assigned = repeatProfAssignedCount.value
    const mats = matieresForRepeat.value
    if (assigned === 1 && mats.length === 1 && mats[0]) repeatForm.value.matiere = mats[0].nom
  }
})

function openRepeat() {
  repeatResult.value = null
  const actif = anneesAcademiques.value.find(a => a.actif)
  repeatForm.value = {
    classe_id: filterClasse.value || '',
    enseignant_id: filterEnseignant.value || '',
    matiere: '',
    heure_debut: '08:00',
    heure_fin: '10:00',
    jours: [1],
    date_debut: '',
    date_fin: '',
    mode: 'presentiel',
    salle: '',
    annee_academique_id: actif ? String(actif.id) : '',
  }
  enseignantDispos.value = []
  repeatClasseUes.value = []
  if (repeatForm.value.enseignant_id) loadEnseignantDispos(repeatForm.value.enseignant_id)
  // Charger les UEs de la classe pré-sélectionnée (depuis filterClasse)
  if (repeatForm.value.classe_id) loadRepeatClasseUes(repeatForm.value.classe_id)
  showRepeat.value = true
}

// Matières disponibles pour la classe choisie dans le formulaire de répétition
// Utilise repeatClasseUes (chargé spécifiquement pour la classe sélectionnée)
// Si un enseignant est sélectionné → filtrer aux seules UEs qui lui sont affectées
const matieresForRepeat = computed((): MatiereOption[] => {
  const classeId = repeatForm.value.classe_id
  if (!classeId) return []
  const ensId = repeatForm.value.enseignant_id ? Number(repeatForm.value.enseignant_id) : null

  // UEs chargées pour cette classe spécifiquement
  let ues = [...repeatClasseUes.value]
  if (ensId) {
    const uesAvecProf = ues.filter(u => Number(u.enseignant_id) === ensId)
    // Si le prof a des UEs affectées → n'afficher que les siennes ; sinon fallback tout
    if (uesAvecProf.length > 0) ues = uesAvecProf
  }

  // Dédoublonner par intitulé et construire les MatiereOption
  const seen = new Set<string>()
  const result: MatiereOption[] = []
  for (const u of ues) {
    const nom = u.intitule
    if (seen.has(nom)) continue
    seen.add(nom)
    const progress = getModuleProgress(classeId, nom)
    const volumeTotal = progress?.total ?? u.volume_horaire ?? 0
    const planifiees = progress?.planifiees ?? heuresPlanifiees(classeId, nom)
    const restantes = volumeTotal > 0 ? Math.max(0, volumeTotal - planifiees) : 0
    result.push({
      id: u.matiere_id ?? u.id, nom, code: u.code,
      volumeTotal, heuresPlanifiees: planifiees, heuresRestantes: restantes,
      label: volumeTotal > 0 ? `${nom}  (${roundHalf(restantes)}h restantes / ${volumeTotal}h)` : nom,
    })
  }

  // Fallback filière si aucune UE chargée (données pas encore disponibles et pas de filtre prof)
  if (result.length === 0 && !ensId && !loadingRepeatUes.value) {
    const classe = classes.value.find(c => String(c.id) === String(classeId))
    const fId = classe?.filiere_id
    if (fId) {
      const filiere = filieres.value.find(f => f.id === fId)
      const mats = filiere?.matieres ?? []
      return mats.map((m): MatiereOption => {
        const progress = getModuleProgress(classeId, m.nom)
        const volumeTotal = progress?.total ?? m.pivot?.credits ?? 0
        const planif = progress?.planifiees ?? heuresPlanifiees(classeId, m.nom)
        const rest = volumeTotal > 0 ? Math.max(0, volumeTotal - planif) : 0
        return { ...m, volumeTotal, heuresPlanifiees: planif, heuresRestantes: rest,
          label: volumeTotal > 0 ? `${m.nom}  (${roundHalf(rest)}h restantes / ${volumeTotal}h)` : m.nom }
      })
    }
  }

  return result
})

// Nombre de matières RÉELLEMENT affectées au prof sélectionné dans la classe chargée
const repeatProfAssignedCount = computed(() => {
  const ensId = repeatForm.value.enseignant_id ? Number(repeatForm.value.enseignant_id) : null
  if (!ensId) return null
  const assigned = repeatClasseUes.value.filter(u => Number(u.enseignant_id) === ensId)
  return new Set(assigned.map(u => u.intitule)).size
})

// Info module sélectionné dans le repeat form
const repeatModuleInfo = computed(() => {
  if (!repeatForm.value.classe_id || !repeatForm.value.matiere) return null
  return getModuleProgress(repeatForm.value.classe_id, repeatForm.value.matiere)
})

// Durée d'une séance en heures
const repeatSeanceDuree = computed(() => {
  const parts1 = repeatForm.value.heure_debut.split(':')
  const parts2 = repeatForm.value.heure_fin.split(':')
  const h1 = Number(parts1[0] ?? 0), m1 = Number(parts1[1] ?? 0)
  const h2 = Number(parts2[0] ?? 0), m2 = Number(parts2[1] ?? 0)
  if (isNaN(h1) || isNaN(h2)) return 0
  return (h2 * 60 + m2 - h1 * 60 - m1) / 60
})

// Nombre de séances nécessaires pour couvrir les heures restantes
const repeatNbSeances = computed(() => {
  const info = repeatModuleInfo.value
  if (!info || info.restantes <= 0 || repeatSeanceDuree.value <= 0) return 0
  return Math.ceil(info.restantes / repeatSeanceDuree.value)
})

// Nombre de séances par semaine
const repeatSeancesParSemaine = computed(() => repeatForm.value.jours.length)

// Auto-calcul de la date de fin quand on a toutes les infos
watch(
  () => [repeatForm.value.classe_id, repeatForm.value.matiere, repeatForm.value.heure_debut,
         repeatForm.value.heure_fin, repeatForm.value.jours.length, repeatForm.value.date_debut],
  () => {
    const nb = repeatNbSeances.value
    const dateDebut = repeatForm.value.date_debut
    const jours = repeatForm.value.jours
    if (!nb || !dateDebut || jours.length === 0) return

    // Avec N jours/semaine, il faut ceil(nb / N) semaines
    const nbSemaines = Math.ceil(nb / jours.length)
    const cursor = new Date(dateDebut)
    cursor.setDate(cursor.getDate() + nbSemaines * 7)
    // Marge d'1 semaine pour les congés
    cursor.setDate(cursor.getDate() + 7)
    repeatForm.value.date_fin = cursor.toISOString().slice(0, 10)
  },
  { immediate: false }
)

async function saveRepeat() {
  savingRepeat.value = true
  repeatResult.value = null
  try {
    const { data } = await api.post('/seances/repeter', {
      classe_id: Number(repeatForm.value.classe_id),
      enseignant_id: repeatForm.value.enseignant_id ? Number(repeatForm.value.enseignant_id) : null,
      matiere: repeatForm.value.matiere,
      heure_debut: repeatForm.value.heure_debut,
      heure_fin: repeatForm.value.heure_fin,
      jours: repeatForm.value.jours,
      date_debut: repeatForm.value.date_debut,
      date_fin: repeatForm.value.date_fin,
      mode: repeatForm.value.mode,
      salle: repeatForm.value.salle || null,
      annee_academique_id: repeatForm.value.annee_academique_id ? Number(repeatForm.value.annee_academique_id) : null,
    })
    repeatResult.value = data
    await load()
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur lors de la planification'
  } finally {
    savingRepeat.value = false
  }
}

// ── Export PDF (print-friendly, noir & blanc) ───────────────────────────────
async function exportPDF(allClasses?: boolean | Event) {
  if (allClasses instanceof Event) allClasses = false
  const exportAll = allClasses === true
  // Charger le logo SVG officiel et le convertir en PNG base64
  let logoBase64 = ''
  try {
    const resp = await fetch('/uptech-logo-print.svg')
    const svgText = await resp.text()
    // Nettoyer le SVG pour le rendre compatible avec Image()
    const cleanSvg = svgText
      .replace(/<\?xml[^?]*\?>/, '')
      .replace(/<!DOCTYPE[^>]*>/, '')
    const svgBlob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
      img.src = url
    })
    // Ratio 339:107 ≈ 3.17:1
    const cw = 1017, ch = 321
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, cw, ch)
    logoBase64 = canvas.toDataURL('image/png')
    URL.revokeObjectURL(url)
  } catch { /* pas de logo */ }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const days = weekDays.value
  const jourNoms = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
  const start = days[0]!
  const end = days[days.length - 1]!
  const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  const rightX = 283
  const pageHeight = doc.internal.pageSize.height

  const enseignantNom = filterEnseignant.value
    ? (() => { const e = enseignants.value.find(i => String(i.id) === String(filterEnseignant.value)); return e ? `${e.prenom} ${e.nom}` : '' })()
    : ''

  // Déterminer les classes à exporter
  // Ne jamais exporter un tronc commun seul — ses séances sont incluses dans chaque classe membre
  const seancesSource = exportAll ? seances.value.filter(s => s.statut !== 'annule') : seancesFiltered.value
  let classesToExport: { id: number | null; nom: string; classeIds: number[] }[] = []
  if (filterClasse.value && !exportAll) {
    const cl = classes.value.find(c => String(c.id) === String(filterClasse.value))
    // Si c'est un tronc commun sélectionné, inclure les séances du tronc uniquement
    const ids = cl ? [Number(cl.id)] : []
    if (cl && !cl.est_tronc_commun && cl.troncs_commun?.length) {
      ids.push(...cl.troncs_commun.map((tc: any) => Number(tc.id)))
    }
    classesToExport = [{ id: cl ? Number(cl.id) : null, nom: cl?.nom || 'Classe', classeIds: ids }]
  } else {
    // Trouver toutes les classes ayant des séances cette semaine (directement ou via tronc commun)
    const classIdsThisWeek = new Set<number>()
    for (const s of seancesSource) {
      const sd = new Date(s.date_debut)
      if (sd >= start && sd <= end && s.classe_id) {
        classIdsThisWeek.add(Number(s.classe_id))
      }
    }
    // Exclure les troncs commun de la liste des pages
    const regularClasses = classes.value.filter(c => !c.est_tronc_commun)
    classesToExport = regularClasses
      .filter(c => {
        // La classe a ses propres séances cette semaine
        if (classIdsThisWeek.has(Number(c.id))) return true
        // Ou un de ses troncs commun a des séances cette semaine
        if (c.troncs_commun?.some((tc: any) => classIdsThisWeek.has(Number(tc.id)))) return true
        return false
      })
      .sort((a, b) => a.nom.localeCompare(b.nom))
      .map(c => {
        const ids = [Number(c.id)]
        if (c.troncs_commun?.length) {
          ids.push(...c.troncs_commun.map((tc: any) => Number(tc.id)))
        }
        return { id: Number(c.id), nom: c.nom, classeIds: ids }
      })
    // Si aucune séance, exporter une page vide
    if (classesToExport.length === 0) {
      classesToExport = [{ id: null, nom: 'Toutes les classes', classeIds: [] }]
    }
  }

  const totalPages = classesToExport.length

  // Générer une page par classe
  for (let pageIdx = 0; pageIdx < classesToExport.length; pageIdx++) {
    const currentClasse = classesToExport[pageIdx]!
    if (pageIdx > 0) doc.addPage()

    // ─── En-tête ───
    if (logoBase64) {
      // Logo officiel noir — ratio 3.17:1 — hauteur 12mm → largeur ~38mm
      doc.addImage(logoBase64, 'PNG', 14, 5, 38, 12)
    } else {
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(0)
      doc.text("UP'TECH", 14, 14)
    }
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0)
    doc.text('EMPLOI DU TEMPS', 14, 24)

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`Semaine du ${fmtDate(start)} au ${fmtDate(end)}`, rightX, 13, { align: 'right' })
    doc.text(currentClasse.nom, rightX, 19, { align: 'right' })
    if (enseignantNom) doc.text(enseignantNom, rightX, 25, { align: 'right' })

    // Numéro de page si multi-classes
    if (totalPages > 1) {
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.text(`Page ${pageIdx + 1}/${totalPages}`, rightX, 25, { align: 'right' })
    }

    doc.setDrawColor(0)
    doc.setLineWidth(0.5)
    doc.line(14, 28, rightX, 28)

    // ─── Layout de la grille visuelle ───
    const gridLeft = 14
    const gridRight = rightX
    const hourLabelW = 12
    const gridTop = 32
    const startHour = 8
    const endHour = 20
    const totalHours = endHour - startHour
    const hourH = (pageHeight - gridTop - 30) / totalHours // hauteur par heure
    const colW = (gridRight - gridLeft - hourLabelW) / days.length
    const colLeft = gridLeft + hourLabelW
    const useColor = pdfColor.value

    // ─── En-tête jours (fond bleu foncé comme l'app) ───
    const dayHeaderH = 12
    for (let i = 0; i < days.length; i++) {
      const x = colLeft + i * colW
      const day = days[i]!
      const conge = getConge(day)
      // Fond
      if (useColor) {
        doc.setFillColor(30, 41, 59) // slate-800
      } else {
        doc.setFillColor(240, 240, 240)
      }
      doc.rect(x, gridTop, colW, dayHeaderH, 'F')
      // Bordure
      doc.setDrawColor(useColor ? 51 : 200, useColor ? 65 : 200, useColor ? 85 : 200)
      doc.setLineWidth(0.3)
      doc.rect(x, gridTop, colW, dayHeaderH)
      // Texte jour
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(useColor ? 255 : 0)
      const jourLabel = `${(jourNoms[day.getDay()] ?? '').toUpperCase()}.`
      doc.text(jourLabel, x + colW / 2, gridTop + 4.5, { align: 'center' })
      doc.setFontSize(11)
      doc.text(`${day.getDate()}`, x + colW / 2, gridTop + 10, { align: 'center' })
      // Nombre de séances ce jour
      const daySeancesCount = seancesSource.filter(s => {
        const sd = new Date(s.date_debut)
        const matchDay = sd.getFullYear() === day.getFullYear() && sd.getMonth() === day.getMonth() && sd.getDate() === day.getDate()
        const matchClasse = currentClasse.id === null || currentClasse.classeIds.includes(Number(s.classe_id))
        return matchDay && matchClasse
      }).length
      if (daySeancesCount > 0 && useColor) {
        // Petit badge vert
        const badgeX = x + colW / 2 + 8
        doc.setFillColor(34, 197, 94)
        doc.circle(badgeX, gridTop + 9, 2.5, 'F')
        doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(255)
        doc.text(`${daySeancesCount}`, badgeX, gridTop + 10, { align: 'center' })
      }
      if (conge) {
        doc.setFontSize(5); doc.setFont('helvetica', 'italic')
        doc.setTextColor(useColor ? 200 : 120)
        doc.text(conge.nom, x + colW / 2, gridTop + dayHeaderH - 1, { align: 'center', maxWidth: colW - 2 })
      }
    }

    const bodyTop = gridTop + dayHeaderH

    // ─── Lignes horaires et labels ───
    for (let h = 0; h <= totalHours; h++) {
      const y = bodyTop + h * hourH
      doc.setDrawColor(220); doc.setLineWidth(0.15)
      doc.line(gridLeft, y, gridRight, y)
      if (h < totalHours) {
        doc.setFontSize(7); doc.setFont('helvetica', 'normal')
        doc.setTextColor(140)
        doc.text(`${String(startHour + h).padStart(2, '0')}h`, gridLeft + 1, y + 3.5)
      }
    }

    // Lignes verticales de la grille
    for (let i = 0; i <= days.length; i++) {
      const x = colLeft + i * colW
      doc.setDrawColor(230); doc.setLineWidth(0.15)
      doc.line(x, bodyTop, x, bodyTop + totalHours * hourH)
    }
    // Ligne verticale gauche (labels)
    doc.line(gridLeft, bodyTop, gridLeft, bodyTop + totalHours * hourH)

    // ─── Congés (fond grisé) ───
    for (let i = 0; i < days.length; i++) {
      const conge = getConge(days[i]!)
      if (conge) {
        const x = colLeft + i * colW
        doc.setFillColor(235, 235, 235)
        doc.rect(x, bodyTop, colW, totalHours * hourH, 'F')
        doc.setFontSize(8); doc.setFont('helvetica', 'bold')
        doc.setTextColor(160)
        doc.text('CONGÉ', x + colW / 2, bodyTop + totalHours * hourH / 2 - 2, { align: 'center' })
        doc.setFontSize(6); doc.setFont('helvetica', 'italic')
        doc.text(conge.nom, x + colW / 2, bodyTop + totalHours * hourH / 2 + 3, { align: 'center', maxWidth: colW - 4 })
      }
    }

    // ─── Blocs de séances ───
    for (let i = 0; i < days.length; i++) {
      const day = days[i]!
      if (getConge(day)) continue
      const daySeances = seancesSource.filter(s => {
        const sd = new Date(s.date_debut)
        const matchDay = sd.getFullYear() === day.getFullYear() && sd.getMonth() === day.getMonth() && sd.getDate() === day.getDate()
        const matchClasse = currentClasse.id === null || currentClasse.classeIds.includes(Number(s.classe_id))
        return matchDay && matchClasse
      })
      for (const s of daySeances) {
        const sd = new Date(s.date_debut)
        const ed = new Date(s.date_fin)
        const sh = sd.getHours() + sd.getMinutes() / 60
        const eh = ed.getHours() + ed.getMinutes() / 60
        const top = bodyTop + (sh - startHour) * hourH + 0.5
        const h = (eh - sh) * hourH - 1
        const x = colLeft + i * colW + 1
        const w = colW - 2
        const r = 2 // border radius

        if (useColor) {
          const [cr, cg, cb] = hexToRgb(matiereColor(s.matiere))
          doc.setFillColor(cr, cg, cb)
        } else {
          doc.setFillColor(245, 245, 245)
        }

        // Rectangle arrondi
        doc.roundedRect(x, top, w, h, r, r, 'F')
        if (!useColor) {
          doc.setDrawColor(180); doc.setLineWidth(0.2)
          doc.roundedRect(x, top, w, h, r, r, 'S')
        }

        // Texte dans le bloc
        const tx = x + 2
        let ty = top + 3.5
        const maxW = w - 4

        // Matière (gras)
        doc.setFontSize(7); doc.setFont('helvetica', 'bold')
        doc.setTextColor(useColor ? 255 : 0)
        doc.text(s.matiere || '', tx, ty, { maxWidth: maxW })
        ty += 3.5

        // Horaire
        const shStr = `${String(Math.floor(sh)).padStart(2, '0')}:${String(sd.getMinutes()).padStart(2, '0')}`
        const ehStr = `${String(Math.floor(eh)).padStart(2, '0')}:${String(ed.getMinutes()).padStart(2, '0')}`
        doc.setFontSize(5.5); doc.setFont('helvetica', 'normal')
        doc.setTextColor(useColor ? 255 : 80, useColor ? 255 : 80, useColor ? 255 : 80)
        if (ty + 2 < top + h) { doc.text(`${shStr}–${ehStr}`, tx, ty, { maxWidth: maxW }); ty += 3 }

        // Prof
        if (s.enseignant && ty + 2 < top + h) {
          doc.setFontSize(5.5)
          doc.text(`${s.enseignant.prenom} ${s.enseignant.nom}`, tx, ty, { maxWidth: maxW })
          ty += 3
        }

        // Classe
        if (s.classe && ty + 2 < top + h) {
          doc.setFontSize(5)
          doc.text(s.classe.nom, tx, ty, { maxWidth: maxW })
          ty += 3
        }

        // Salle
        if (s.salle && ty + 2 < top + h) {
          doc.setFontSize(5)
          doc.text(`Salle: ${s.salle}`, tx, ty, { maxWidth: maxW })
        }
      }
    }

    // ─── Zone de signature ───
    const sigY = pageHeight - 28

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(0)
    doc.text(`Fait à Dakar, le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`, 14, sigY)

    const sigRightX = 220
    doc.text('Le Directeur des Études', sigRightX, sigY)
    doc.setDrawColor(0)
    doc.setLineWidth(0.3)
    doc.line(sigRightX, sigY + 10, sigRightX + 55, sigY + 10)
    doc.setFontSize(7)
    doc.setFont('helvetica', 'italic')
    doc.text('Signature et cachet', sigRightX + 10, sigY + 13)

    // ─── Pied de page ───
    doc.setFontSize(6)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(160)
    doc.text('UPTECH Campus — Document généré automatiquement', 14, pageHeight - 5)
  }

  // Nom du fichier
  const dateStr = start.toISOString().slice(0, 10)
  if (filterClasse.value && !exportAll) {
    const nom = classesToExport[0]!.nom.replace(/\s+/g, '_')
    doc.save(`EDT_${dateStr}_${nom}.pdf`)
  } else {
    doc.save(`EDT_${dateStr}_toutes_classes.pdf`)
  }
}

// ── Export PDF combiné (toutes les classes sur 1 seule page) ─────────────────
async function exportPDFCombined() {
  let logoBase64 = ''
  try {
    const resp = await fetch('/uptech-logo-print.svg')
    const svgText = await resp.text()
    const cleanSvg = svgText.replace(/<\?xml[^?]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '')
    const svgBlob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)
    const img = new Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = url })
    const cw = 1017, ch = 321
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, cw, ch)
    logoBase64 = canvas.toDataURL('image/png'); URL.revokeObjectURL(url)
  } catch { /* pas de logo */ }

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const days = weekDays.value
  const jourNoms = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
  const start = days[0]!
  const end = days[days.length - 1]!
  const fmtDate = (d: Date) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
  const rightX = 283
  const pageHeight = doc.internal.pageSize.height

  // En-tête
  if (logoBase64) {
    doc.addImage(logoBase64, 'PNG', 14, 5, 38, 12)
  } else {
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(0); doc.text("UP'TECH", 14, 14)
  }
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0)
  doc.text('EMPLOI DU TEMPS — TOUTES LES CLASSES', 14, 24)
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text(`Semaine du ${fmtDate(start)} au ${fmtDate(end)}`, rightX, 13, { align: 'right' })
  doc.setDrawColor(0); doc.setLineWidth(0.5); doc.line(14, 28, rightX, 28)

  // Toutes les séances actives (hors tronc commun isolés)
  const allSeances = seances.value.filter(s => s.statut !== 'annule')

  // En-tête du tableau
  const head = [days.map(d => {
    const conge = getConge(d)
    const jourLabel = `${jourNoms[d.getDay()]} ${d.getDate()}`
    return conge ? `${jourLabel}\n${conge.nom}` : jourLabel
  })]

  // Corps : pour chaque créneau horaire, empiler les séances de toutes les classes
  const body: string[][] = []
  const cellMatieres: Map<string, string> = new Map()
  for (let h = 8; h < 20; h++) {
    const rowIdx = h - 8
    const row: string[] = []
    for (let colIdx = 0; colIdx < days.length; colIdx++) {
      const day = days[colIdx]!
      const conge = getConge(day)
      if (conge) {
        row.push(h === 12 ? `CONGÉ\n${conge.nom}` : '')
      } else {
        const daySeances = allSeances.filter(s => {
          const sd = new Date(s.date_debut)
          return sd.getFullYear() === day.getFullYear() &&
            sd.getMonth() === day.getMonth() &&
            sd.getDate() === day.getDate()
        })
        const seancesAtHour = daySeances.filter(s => {
          const sh = new Date(s.date_debut).getHours()
          const eh = new Date(s.date_fin).getHours()
          return h >= sh && h < eh
        })
        const starting = seancesAtHour.filter(s => new Date(s.date_debut).getHours() === h)
        if (starting.length > 0) {
          cellMatieres.set(`${rowIdx},${colIdx}`, starting[0]!.matiere)
          const lines = starting.map(s => {
            const sh = new Date(s.date_debut).getHours()
            const eh = new Date(s.date_fin).getHours()
            const em = new Date(s.date_fin).getMinutes()
            const classNom = s.classe?.nom || ''
            const prof = s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : ''
            return [
              `[${classNom}] ${s.matiere}`,
              `${String(sh).padStart(2, '0')}h-${String(eh).padStart(2, '0')}h${em > 0 ? em : ''}`,
              prof,
            ].filter(Boolean).join(' | ')
          })
          row.push(lines.join('\n'))
        } else if (seancesAtHour.length > 0) {
          cellMatieres.set(`${rowIdx},${colIdx}`, seancesAtHour[0]!.matiere)
          row.push('│')
        } else {
          row.push('')
        }
      }
    }
    body.push(row)
  }

  // Dessiner le tableau
  autoTable(doc, {
    startY: 32,
    head,
    body,
    theme: 'grid',
    styles: { fontSize: 6, cellPadding: 1, lineColor: [80, 80, 80], lineWidth: 0.2, textColor: [0, 0, 0], font: 'helvetica' },
    headStyles: {
      fillColor: pdfColor.value ? [227, 6, 19] as any : [240, 240, 240] as any,
      textColor: pdfColor.value ? [255, 255, 255] as any : [0, 0, 0] as any,
      fontStyle: 'bold', fontSize: 7, halign: 'center',
    },
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const dayIdx = data.column.index
        if (dayIdx < days.length && getConge(days[dayIdx]!)) {
          data.cell.styles.fillColor = [235, 235, 235]
          data.cell.styles.textColor = [120, 120, 120]
          data.cell.styles.fontStyle = 'italic'
          data.cell.styles.halign = 'center'
        } else if (pdfColor.value) {
          const mat = cellMatieres.get(`${data.row.index},${dayIdx}`)
          if (mat) {
            data.cell.styles.fillColor = matiereBgRgb(mat)
            data.cell.styles.textColor = matiereTextRgb(mat)
          }
        } else if (data.cell.raw && data.cell.raw !== '│' && data.cell.raw !== '' && dayIdx < days.length && !getConge(days[dayIdx]!)) {
          data.cell.styles.fillColor = [252, 252, 252]
        }
      }
    },
    margin: { left: 14, right: 14 },
  })

  // Signature
  const finalY = (doc as any).lastAutoTable?.finalY ?? pageHeight - 50
  const sigY = Math.min(finalY + 12, pageHeight - 40)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(0)
  doc.text(`Fait à Dakar, le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`, 14, sigY)
  const sigRightX = 220
  doc.text('Le Directeur des Études', sigRightX, sigY)
  doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line(sigRightX, sigY + 18, sigRightX + 55, sigY + 18)
  doc.setFontSize(7); doc.setFont('helvetica', 'italic'); doc.text('Signature et cachet', sigRightX + 10, sigY + 22)
  doc.setFontSize(6); doc.setFont('helvetica', 'italic'); doc.setTextColor(160)
  doc.text('UPTECH Campus — Document généré automatiquement', 14, pageHeight - 5)

  const dateStr = start.toISOString().slice(0, 10)
  doc.save(`EDT_${dateStr}_combiné.pdf`)
}

async function load() {
  loading.value = true
  try {
    const [sRes, cRes, iRes, aRes, fRes, ueRes, cgRes] = await Promise.all([
      api.get('/seances'),
      api.get('/classes'),
      api.get('/enseignants'),
      api.get('/annees-academiques'),
      api.get('/filieres'),
      api.get('/ues'),
      api.get('/conges-institut'),
    ])
    seances.value = sRes.data
    classes.value = cRes.data
    // Handle paginated enseignants (paginator has .data) or plain array
    const iRaw = iRes.data
    enseignants.value = Array.isArray(iRaw) ? iRaw : (iRaw.data ?? [])
    anneesAcademiques.value = aRes.data
    filieres.value = fRes.data
    const ueRaw = ueRes.data
    allUes.value = Array.isArray(ueRaw) ? ueRaw : (ueRaw.data ?? [])
    congesInstitut.value = cgRes.data

    // Enseignant : filtrer pour ne voir que ses propres séances et classes
    if (isEnseignant.value) {
      try {
        const { data: profil } = await api.get('/enseignants/me')
        monEnseignantId.value = profil.id ? Number(profil.id) : null
        if (monEnseignantId.value) {
          seances.value = seances.value.filter(
            (s: Seance) => Number(s.enseignant_id) === monEnseignantId.value
          )
          const mesClasseIdsSet = new Set(
            seances.value.map((s: Seance) => Number(s.classe_id)).filter(id => id > 0)
          )
          classes.value = classes.value.filter((c: Classe) => mesClasseIdsSet.has(Number(c.id)))
          filterEnseignant.value = String(monEnseignantId.value)
        }
      } catch (e) {
        console.error('[EDT] Erreur profil enseignant:', e)
      }
    }

    // Étudiant : filtrer pour ne voir que les séances de sa classe + troncs communs
    if (isEtudiant.value) {
      try {
        const { data: dashboard } = await api.get('/espace-etudiant/dashboard')
        const classeId = dashboard.inscription?.classe_id
        if (classeId) {
          monClasseId.value = Number(classeId)
          const maClasse = classes.value.find((c: Classe) => Number(c.id) === Number(classeId))
          const tcIds = (maClasse?.troncs_commun || []).map((tc: { id: number }) => Number(tc.id))
          mesTroncCommunIds.value = tcIds
          const allowedIds = new Set([Number(classeId), ...tcIds])
          seances.value = seances.value.filter(
            (s: Seance) => allowedIds.has(Number(s.classe_id))
          )
          classes.value = classes.value.filter((c: Classe) => allowedIds.has(Number(c.id)))

          // Auto-naviguer vers la semaine de la prochaine séance active (ou la plus récente)
          const seancesActives = seances.value.filter(s => s.statut !== 'annule')
          if (seancesActives.length > 0) {
            const nowMs = Date.now()
            // Trier par date_debut croissante
            const sorted = [...seancesActives].sort(
              (a, b) => new Date(a.date_debut).getTime() - new Date(b.date_debut).getTime()
            )
            // Chercher la prochaine séance future, sinon la dernière passée
            const prochaine = sorted.find(s => new Date(s.date_debut).getTime() >= nowMs)
            const cible = prochaine || sorted[sorted.length - 1]!
            if (cible) {
              const cibleDate = new Date(cible.date_debut)
              // Calculer le lundi de la semaine de cette séance
              const cibleDay = cibleDate.getDay()
              const cibleMonday = new Date(cibleDate)
              cibleMonday.setDate(cibleDate.getDate() - (cibleDay === 0 ? 6 : cibleDay - 1))
              cibleMonday.setHours(0, 0, 0, 0)
              // Calculer le lundi de cette semaine
              const today = new Date()
              const todayDay = today.getDay()
              const thisMonday = new Date(today)
              thisMonday.setDate(today.getDate() - (todayDay === 0 ? 6 : todayDay - 1))
              thisMonday.setHours(0, 0, 0, 0)
              // Offset en semaines
              const diffWeeks = Math.round((cibleMonday.getTime() - thisMonday.getTime()) / (7 * 86400000))
              if (diffWeeks !== 0) currentWeekOffset.value = diffWeeks
            }
          }
        }
      } catch (e) {
        console.error('[EDT] Erreur profil étudiant:', e)
      }
    }
  } catch (e: any) {
    loadError.value = e?.message || String(e)
    console.error('[EDT] Erreur load():', e)
  } finally {
    loading.value = false
  }
}

// ── Smart select helpers ────────────────────────────────────────────────────

// filiere_id of the currently-selected classe
function filiereIdForClasse(classeId: string | number | null): number | null {
  if (!classeId) return null
  const c = classes.value.find(c => String(c.id) === String(classeId))
  return c?.filiere_id ?? null
}

// Toutes les FiliereMatiere d'une filière (avec données pivot)
function matieresOfFiliere(filiereId: number | null): FiliereMatiere[] {
  if (!filiereId) return []
  return filieres.value.find(f => f.id === filiereId)?.matieres ?? []
}

// Heures déjà planifiées pour une matière dans une classe (séances non annulées)
function heuresPlanifiees(classeId: string | number, matiereNom: string): number {
  if (!classeId || !matiereNom) return 0
  return seances.value
    .filter(s =>
      String(s.classe_id) === String(classeId) &&
      s.matiere === matiereNom &&
      s.statut !== 'annule'
    )
    .reduce((total, s) => {
      const mins = (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 60000
      return total + mins / 60
    }, 0)
}

// Heures déjà effectuées (émargées) pour une matière dans une classe
function heuresEffectuees(classeId: string | number, matiereNom: string): number {
  if (!classeId || !matiereNom) return 0
  return seances.value
    .filter(s =>
      String(s.classe_id) === String(classeId) &&
      s.matiere === matiereNom &&
      s.statut === 'effectue'
    )
    .reduce((total, s) => {
      const mins = (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 60000
      return total + mins / 60
    }, 0)
}

// Progression d'un module : total configuré vs heures planifiées (toutes séances non annulées)
function getModuleProgress(classeId: string | number, matiereNom: string): {
  total: number; planifiees: number; effectuees: number; restantes: number; pct: number; nbSeances: number
} | null {
  if (!classeId || !matiereNom) return null

  // Source 1 : volume_horaire dans l'UE de cette classe (champ "Volume horaire (h)" du formulaire)
  const ueMatch = allUes.value.find(u =>
    String(u.classe_id) === String(classeId) &&
    u.intitule === matiereNom &&
    (u.volume_horaire ?? 0) > 0
  )
  let total = ueMatch?.volume_horaire ?? 0

  // Source 1b : credits_ects de l'UE (si volume_horaire non renseigné)
  if (total === 0 && ueMatch && (ueMatch.credits_ects ?? 0) > 0) {
    total = ueMatch.credits_ects ?? 0
  }

  // Source 2 : credits dans le pivot filière_matière (si pas de UE configurée)
  if (total === 0) {
    const classe = classes.value.find(c => String(c.id) === String(classeId))
    if (classe?.filiere_id) {
      const filiere = filieres.value.find(f => f.id === classe.filiere_id)
      const mat = filiere?.matieres?.find(m => m.nom === matiereNom)
      // Ne pas utiliser coefficient : c'est un facteur de pondération, pas un volume horaire
      total = mat?.pivot?.credits ?? 0
    }
  }

  if (total === 0) return null

  const planif    = heuresPlanifiees(classeId, matiereNom)
  const done      = heuresEffectuees(classeId, matiereNom)
  const restantes = Math.max(0, total - planif)
  const nbSeances = seances.value.filter(s =>
    String(s.classe_id) === String(classeId) &&
    s.matiere === matiereNom &&
    s.statut !== 'annule'
  ).length
  return {
    total,
    planifiees: roundHalf(planif),
    effectuees: roundHalf(done),
    restantes:  roundHalf(restantes),
    pct: Math.min(100, Math.round(planif / total * 100)),
    nbSeances,
  }
}

// Progression pour les séances de formation individuelle (basée sur fi_module_id)
function getFiModuleProgress(fiModuleId: number): {
  total: number; planifiees: number; effectuees: number; restantes: number; pct: number; nbSeances: number
} | null {
  if (!fiModuleId) return null
  // Toutes les séances de ce fi_module
  const moduleSessions = seances.value.filter(s => s.fi_module_id === fiModuleId && s.statut !== 'annule')
  if (moduleSessions.length === 0) return null

  let planifiees = 0
  let effectuees = 0
  for (const s of moduleSessions) {
    const mins = (new Date(s.date_fin).getTime() - new Date(s.date_debut).getTime()) / 60000
    const h = Math.round(mins / 30) / 2
    planifiees += h
    if (s.statut === 'effectue') effectuees += h
  }

  // On ne connaît pas le total ici directement, mais on peut l'estimer
  // Le total sera le nombre initial de séances * durée (avant émargement)
  // Pour l'instant, on utilise planifiees comme proxy du total planifié
  const total = planifiees
  const restantes = Math.max(0, total - effectuees)
  return {
    total: roundHalf(total),
    planifiees: roundHalf(planifiees),
    effectuees: roundHalf(effectuees),
    restantes: roundHalf(restantes),
    pct: total > 0 ? Math.min(100, Math.round(effectuees / total * 100)) : 0,
    nbSeances: moduleSessions.length,
  }
}

// Heures restantes APRÈS une séance donnée (dégressif par date)
function heuresRestantesApres(s: Seance): number | null {
  // Cas FI : basé sur fi_module_id
  if (s.fi_module_id) {
    const fiProgress = getFiModuleProgress(s.fi_module_id)
    if (!fiProgress) return null
    const moduleSessions = seances.value
      .filter(ss => ss.fi_module_id === s.fi_module_id && ss.statut !== 'annule')
      .sort((a, b) => a.date_debut.localeCompare(b.date_debut))
    let cumul = 0
    for (const ss of moduleSessions) {
      const mins = (new Date(ss.date_fin).getTime() - new Date(ss.date_debut).getTime()) / 60000
      cumul += mins / 60
      if (ss.id === s.id) break
    }
    return roundHalf(Math.max(0, fiProgress.total - cumul))
  }
  // Cas classique : basé sur classe_id + matiere
  const progress = getModuleProgress(s.classe_id, s.matiere)
  if (!progress) return null
  const moduleSessions = seances.value
    .filter(ss => String(ss.classe_id) === String(s.classe_id) && ss.matiere === s.matiere && ss.statut !== 'annule')
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))
  let cumul = 0
  for (const ss of moduleSessions) {
    const mins = (new Date(ss.date_fin).getTime() - new Date(ss.date_debut).getTime()) / 60000
    cumul += mins / 60
    if (ss.id === s.id) break
  }
  return roundHalf(Math.max(0, progress.total - cumul))
}

// Progression totale pour une séance (classique ou FI)
function getSeanceProgress(s: Seance) {
  if (s.fi_module_id) return getFiModuleProgress(s.fi_module_id)
  if (s.classe_id) return getModuleProgress(s.classe_id, s.matiere)
  return null
}

// Arrondi à 0.5h près pour affichage
function roundHalf(n: number): number { return Math.round(n * 2) / 2 }

// Enseignants filtrés : seulement ceux affectés à une UE dans la classe sélectionnée
const enseignantsForClasse = computed(() => {
  if (!form.value.classe_id) return enseignants.value
  const ues = uesForSelectedClasse.value
  if (ues.length === 0) return enseignants.value
  const assignedIds = new Set(ues.filter(u => u.enseignant_id).map(u => String(u.enseignant_id)))
  if (assignedIds.size === 0) return enseignants.value
  return enseignants.value.filter(i => assignedIds.has(String(i.id)))
})

// Matières disponibles pour le formulaire — depuis les UEs de la classe
const matieresForForm = computed((): MatiereOption[] => {
  if (!form.value.classe_id) return []

  let ues = uesForSelectedClasse.value

  // Si pas d'UEs chargées, fallback sur l'ancien système (matières de la filière)
  if (ues.length === 0) {
    const fId = filiereIdForClasse(form.value.classe_id)
    if (!fId) return []
    const allMatieres = matieresOfFiliere(fId)
    return allMatieres.map((m): MatiereOption => {
      const volumeTotal = m.pivot?.credits ?? 0
      const planifiees = heuresPlanifiees(form.value.classe_id, m.nom)
      const restantes = volumeTotal > 0 ? Math.max(0, volumeTotal - planifiees) : 0
      const label = volumeTotal > 0
        ? `${m.nom}  (${roundHalf(restantes)}h restantes / ${volumeTotal}h)`
        : m.nom
      return { ...m, volumeTotal, heuresPlanifiees: planifiees, heuresRestantes: restantes, label }
    }).filter(m => m.volumeTotal === 0 || m.heuresRestantes > 0)
  }

  // Si un enseignant est sélectionné, ne montrer que ses UEs
  if (form.value.enseignant_id) {
    const filtered = ues.filter(u => String(u.enseignant_id) === String(form.value.enseignant_id))
    if (filtered.length > 0) ues = filtered
  }

  // Dédupliquer par intitulé
  const seen = new Set<string>()
  return ues
    .filter(u => { if (seen.has(u.intitule)) return false; seen.add(u.intitule); return true })
    .map((u): MatiereOption => {
      const volumeTotal = u.volume_horaire ?? 0
      const planifiees = heuresPlanifiees(form.value.classe_id, u.intitule)
      const restantes = volumeTotal > 0 ? Math.max(0, volumeTotal - planifiees) : 0
      const label = volumeTotal > 0
        ? `${u.intitule}  (${roundHalf(restantes)}h restantes / ${volumeTotal}h)`
        : u.intitule
      return {
        id: u.matiere_id ?? 0,
        nom: u.intitule,
        code: u.code,
        volumeTotal,
        heuresPlanifiees: planifiees,
        heuresRestantes: restantes,
        label,
      }
    })
    .filter(m => m.volumeTotal === 0 || m.heuresRestantes > 0)
})

// Info de la matière sélectionnée (pour afficher le résumé sous le select)
const selectedMatiereInfo = computed((): MatiereOption | null => {
  if (!form.value.matiere || !form.value.classe_id) return null
  return matieresForForm.value.find(m => m.nom === form.value.matiere) ?? null
})

const isTroncCommunSelected = computed(() => {
  if (!form.value.classe_id) return false
  const c = classes.value.find(c => String(c.id) === String(form.value.classe_id))
  return c?.est_tronc_commun ?? false
})

async function loadUesForClasse(classeId: string) {
  if (!classeId) { uesForSelectedClasse.value = []; return }
  const { data } = await api.get('/ues', { params: { classe_id: classeId } })
  uesForSelectedClasse.value = Array.isArray(data) ? data : (data.data ?? [])
}

function onClasseChange() {
  form.value.enseignant_id = ''
  form.value.matiere = ''
  uesForSelectedClasse.value = []
  // Toujours charger les UEs de la classe pour filtrer enseignants et matières
  if (form.value.classe_id) loadUesForClasse(form.value.classe_id)
}

function onEnseignantChange() {
  form.value.matiere = ''
}

onMounted(() => {
  load()
  ticker = setInterval(() => { now.value = new Date() }, 30000)
})
onUnmounted(() => { if (ticker) clearInterval(ticker) })
</script>

<template>
  <div class="uc-content">

    <!-- ══ HERO ══ -->
    <div class="edt-hero">
      <div class="edt-hero-glow"></div>
      <div class="edt-hero-content">
        <div class="edt-hero-left">
          <div class="edt-hero-icon">📅</div>
          <div>
            <h1 class="edt-hero-title">{{ (isEnseignant || isEtudiant) ? 'Mon emploi du temps' : 'Emplois du temps' }}</h1>
            <p class="edt-hero-sub">{{ (isEnseignant || isEtudiant) ? 'Mes séances de la semaine' : 'Planning hebdomadaire des séances' }}</p>
          </div>
        </div>
        <div class="edt-hero-kpis">
          <div class="edt-hkpi">
            <div class="edt-hkpi-val">{{ loading ? '…' : kpiSemaine }}</div>
            <div class="edt-hkpi-lbl">Cette semaine</div>
          </div>
          <div class="edt-hkpi edt-hkpi--blue">
            <div class="edt-hkpi-val">{{ loading ? '…' : kpiAujourdhui }}</div>
            <div class="edt-hkpi-lbl">Aujourd'hui</div>
          </div>
          <div class="edt-hkpi edt-hkpi--green">
            <div class="edt-hkpi-val">{{ loading ? '…' : kpiHeures }}h</div>
            <div class="edt-hkpi-lbl">Heures planif.</div>
          </div>
          <div class="edt-hkpi edt-hkpi--purple">
            <div class="edt-hkpi-val">{{ loading ? '…' : kpiEmargement }}%</div>
            <div class="edt-hkpi-lbl">Émargées</div>
          </div>
        </div>
        <div class="edt-hero-actions">
          <button v-if="canWrite" @click="openCreate" class="edt-hero-btn">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
            Nouvelle séance
          </button>
          <button v-if="canWrite" @click="openRepeat" class="edt-hero-btn" style="background:#1e40af;">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            Planifier en série
          </button>
        </div>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="edt-toolbar">
      <select v-if="!isEtudiant" v-model="filterClasse" class="edt-select">
        <option value="">Toutes les classes</option>
        <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
      </select>
      <select v-if="!isEnseignant && !isEtudiant" v-model="filterEnseignant" class="edt-select">
        <option value="">Tous les enseignants</option>
        <option v-for="i in enseignants" :key="i.id" :value="String(i.id)">
          {{ i.prenom }} {{ i.nom }}
        </option>
      </select>

      <!-- Bouton "Tout mon planning" (enseignant uniquement) -->
      <button v-if="isEnseignant || isEtudiant"
        @click="viewAll = !viewAll; if (viewAll) viewMode = 'list'"
        :style="{
          padding:'6px 14px', borderRadius:'8px', border:'none', cursor:'pointer',
          fontWeight:'600', fontSize:'12px', transition:'all .15s',
          background: viewAll ? '#1e293b' : '#f1f5f9',
          color: viewAll ? '#fff' : '#475569',
        }">
        {{ viewAll ? '📅 Par semaine' : '📋 Tout mon planning' }}
      </button>

      <!-- Navigation semaine -->
      <div v-if="!viewAll" class="edt-week-nav">
        <button @click="currentWeekOffset--" class="edt-nav-btn">‹</button>
        <span class="edt-week-label">{{ weekLabel }}</span>
        <button @click="currentWeekOffset++" class="edt-nav-btn">›</button>
        <button @click="currentWeekOffset = 0" class="edt-today-btn">Aujourd'hui</button>
      </div>
      <div v-else style="font-size:12px;color:#64748b;align-self:center;">
        {{ seancesFiltered.length }} séance{{ seancesFiltered.length !== 1 ? 's' : '' }} au total
      </div>

      <!-- Toggles -->
      <div class="edt-toggles">
        <button :class="['edt-tog', !showWeekend && 'edt-tog--active']" @click="showWeekend = false">Lun–Ven</button>
        <button :class="['edt-tog', showWeekend && 'edt-tog--active']" @click="showWeekend = true">7 jours</button>
      </div>
      <div class="edt-toggles">
        <button :class="['edt-tog', viewMode==='grid' && 'edt-tog--active']" @click="viewMode='grid'" title="Vue grille">⊞</button>
        <button :class="['edt-tog', viewMode==='list' && 'edt-tog--active']" @click="viewMode='list'" title="Vue liste">☰</button>
      </div>
      <div class="edt-pdf-group">
        <label class="edt-radio-label">
          <input type="radio" :value="true" v-model="pdfColor" /> <span style="color:#E30613;">Couleur</span>
        </label>
        <label class="edt-radio-label">
          <input type="radio" :value="false" v-model="pdfColor" /> N&B
        </label>
        <button @click="exportPDF" class="edt-export-btn" title="Exporter en PDF">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          PDF
        </button>
        <button v-if="!isEtudiant" @click="() => exportPDF(true)" class="edt-export-btn" title="Toutes les classes, 1 page par classe">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          PDF Toutes
        </button>
        <button v-if="!isEtudiant" @click="() => exportPDFCombined()" class="edt-export-btn" title="Toutes les classes combinées sur 1 feuille">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          PDF Combiné
        </button>
      </div>
    </div>

    <!-- Légende matières de la semaine -->
    <div v-if="matieresSemaine.length" class="edt-legend">
      <span class="edt-legend-title">📚 Cette semaine :</span>
      <div v-for="m in matieresSemaine" :key="m.nom" class="edt-legend-item">
        <span class="edt-legend-dot" :style="{ background: m.gradient }"></span>
        <span class="edt-legend-text">{{ m.nom }}</span>
      </div>
    </div>

    <!-- Bannière semaine de fête -->
    <div v-if="weekConge" class="edt-conge-banner">
      <div class="edt-conge-banner-icon">🎉</div>
      <div class="edt-conge-banner-text">
        <strong>Semaine de congé</strong>
        <span>{{ weekConge }}</span>
      </div>
    </div>

    <!-- Grille -->
    <div v-if="loadError" style="background:#fee2e2;border:1px solid #ef4444;border-radius:6px;padding:12px;margin:0 0 12px;color:#991b1b;font-size:13px;">
      Erreur de chargement : {{ loadError }}
    </div>
    <div v-if="loading" class="edt-loading">Chargement…</div>
    <div v-if="!loading && viewMode === 'grid'" class="edt-grid-wrap">
      <!-- En-tête jours -->
      <div class="edt-grid-header" :style="{ gridTemplateColumns: '56px repeat(' + weekDays.length + ', 1fr)' }">
        <div class="edt-time-col-header"></div>
        <div v-for="day in weekDays" :key="day.toISOString()" class="edt-day-header"
          :class="{
            'edt-day-header--weekend': day.getDay() === 0 || day.getDay() === 6,
            'edt-day-header--today': isToday(day),
            'edt-day-header--conge': !!getConge(day)
          }">
          <p class="edt-day-name">
            {{ day.toLocaleDateString('fr-FR', { weekday: 'short' }) }}
          </p>
          <div class="edt-day-num-wrap" :class="{ 'edt-day-num-wrap--today': isToday(day) }">
            <p class="edt-day-num">{{ day.getDate() }}</p>
          </div>
          <!-- Badge congé sur le jour -->
          <div v-if="getConge(day)" class="edt-conge-badge">
            🎊 {{ getConge(day)!.nom }}
          </div>
          <div v-if="seancesForDay(day).length" class="edt-day-dot">
            {{ seancesForDay(day).length }}
          </div>
        </div>
      </div>

      <!-- Corps de la grille -->
      <div class="edt-grid-body" :style="{ gridTemplateColumns: '56px repeat(' + weekDays.length + ', 1fr)' }">
        <!-- Colonne heures -->
        <div class="edt-time-col">
          <div v-for="h in timeSlots" :key="h" class="edt-time-slot">
            <span class="edt-time-label">{{ String(h).padStart(2, '0') }}h</span>
          </div>
        </div>

        <!-- Colonnes jours -->
        <div v-for="day in weekDays" :key="day.toISOString()" class="edt-day-col"
          :class="{
            'edt-day-col--weekend': day.getDay() === 0 || day.getDay() === 6,
            'edt-day-col--today': isToday(day),
            'edt-day-col--conge': !!getConge(day)
          }">
          <!-- Lignes horizontales -->
          <div v-for="h in timeSlots" :key="h" class="edt-hour-row"
            :class="{ 'edt-hour-row--half': true }"></div>

          <!-- Ligne heure courante -->
          <div v-if="isToday(day) && nowLineTop >= 0"
            class="edt-now-line"
            :style="{ top: nowLineTop + 'px' }">
            <div class="edt-now-dot"></div>
          </div>

          <!-- Séances -->
          <div v-for="s in seancesForDay(day)" :key="s.id"
            class="edt-seance"
            :class="s.statut === 'effectue' ? 'edt-seance--done' : ''"
            :style="{
              top: `${(seanceGridRow(s) - 1) * 32}px`,
              height: `${seanceGridSpan(s) * 32 - 4}px`,
              background: matiereGradient(s.matiere),
            }"
            @click="toggleDetail(s)">
            <div class="edt-seance-inner">
              <span class="edt-seance-icon">{{ modeIcon[s.mode] }}</span>
              <p class="edt-seance-matiere">{{ s.matiere }}</p>
            </div>
            <p class="edt-seance-time">⏰ {{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}</p>
            <p v-if="s.enseignant" class="edt-seance-interv">👤 {{ s.enseignant.prenom }} {{ s.enseignant.nom }}</p>
            <p v-if="s.classe" class="edt-seance-interv">🏷 {{ s.classe.nom }}</p>
            <!-- Heures restantes du module (dégressif par séance) -->
            <template v-if="heuresRestantesApres(s) !== null">
              <div class="edt-seance-prog-wrap">
                <div class="edt-seance-prog-bar">
                  <div class="edt-seance-prog-fill"
                    :style="{ width: (getSeanceProgress(s)?.total ? Math.min(100, Math.round((getSeanceProgress(s)!.total - heuresRestantesApres(s)!) / getSeanceProgress(s)!.total * 100)) : 0) + '%', background: s.fi_module_id ? '#6366f1' : '' }">
                  </div>
                </div>
                <span class="edt-seance-prog-label">
                  <span v-if="heuresRestantesApres(s)! > 0">
                    {{ heuresRestantesApres(s) }}h rest.
                  </span>
                  <span v-else>✓ Terminé</span>
                </span>
              </div>
            </template>
            <span v-if="s.fi_module_id && !s.classe" class="edt-seance-interv" style="color:#6366f1;">📋 FI</span>
            <span v-if="s.statut === 'effectue'" class="edt-seance-emarge-badge">✓ Émargé</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ══ VUE LISTE ══ -->
    <div v-if="!loading && viewMode === 'list'" class="edt-list">
      <template v-for="day in (viewAll ? allDates : weekDays)" :key="day.toISOString()">
        <div v-if="seancesForDay(day).length" class="edt-list-day">
          <div class="edt-list-day-header" :class="{ 'edt-list-day-header--today': isToday(day) }">
            <span class="edt-list-day-name">{{ day.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }}</span>
            <span class="edt-list-day-count">{{ seancesForDay(day).length }} séance{{ seancesForDay(day).length > 1 ? 's' : '' }}</span>
          </div>
          <div class="edt-list-seances">
            <div v-for="s in seancesForDay(day).slice().sort((a,b) => new Date(a.date_debut).getTime() - new Date(b.date_debut).getTime())"
              :key="s.id"
              class="edt-list-row"
              @click="toggleDetail(s)">
              <div class="edt-list-bar" :style="{ background: matiereGradient(s.matiere) }"></div>
              <div class="edt-list-time">
                <span>{{ fmtTime(s.date_debut) }}</span>
                <span class="edt-list-time-sep">—</span>
                <span>{{ fmtTime(s.date_fin) }}</span>
              </div>
              <div class="edt-list-info">
                <div class="edt-list-matiere">{{ modeIcon[s.mode] }} {{ s.matiere }}</div>
                <div class="edt-list-meta">
                  <span v-if="s.classe">🏷 {{ s.classe.nom }}</span>
                  <span v-if="s.enseignant">· 👤 {{ s.enseignant.prenom }} {{ s.enseignant.nom }}</span>
                  <span v-if="s.salle">· 📍 {{ s.salle }}</span>
                </div>
              </div>
              <div class="edt-list-status">
                <span v-if="s.statut === 'effectue'" class="edt-list-badge edt-list-badge--done">✓ Émargé</span>
                <span v-else-if="s.statut === 'confirme'" class="edt-list-badge edt-list-badge--confirmed">Confirmé</span>
                <span v-else class="edt-list-badge">Planifié</span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-if="seancesFiltered.length === 0" class="edt-list-empty">
        {{ viewAll ? 'Aucune séance programmée' : 'Aucune séance cette semaine' }}
      </div>
    </div>

    <!-- Popup détail séance -->
    <Teleport to="body">
      <div v-if="selectedSeance" class="edt-overlay" @click.self="selectedSeance = null">
        <div class="edt-detail-popup">
          <div class="edt-detail-header" :style="{ background: matiereGradient(selectedSeance.matiere) }">
            <div>
              <h3 class="edt-detail-title">{{ selectedSeance.matiere }}</h3>
              <span class="edt-mode-badge edt-mode-badge--popup">
                {{ modeIcon[selectedSeance.mode] }} {{ modeLabel[selectedSeance.mode] }}
              </span>
            </div>
            <button @click="selectedSeance = null" class="edt-close-btn">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <dl class="edt-detail-list">
            <div class="edt-detail-row">
              <dt class="edt-detail-label">Classe</dt>
              <dd class="edt-detail-value">{{ selectedSeance.classe?.nom ?? '—' }}</dd>
            </div>
            <div class="edt-detail-row">
              <dt class="edt-detail-label">Enseignant</dt>
              <dd class="edt-detail-value">{{ selectedSeance.enseignant ? `${selectedSeance.enseignant.prenom} ${selectedSeance.enseignant.nom}` : '—' }}</dd>
            </div>
            <div class="edt-detail-row">
              <dt class="edt-detail-label">Horaire</dt>
              <dd class="edt-detail-value">{{ fmtTime(selectedSeance.date_debut) }} – {{ fmtTime(selectedSeance.date_fin) }}</dd>
            </div>
            <!-- Progression du module (classique) -->
            <div v-if="selectedSeance.classe_id && getModuleProgress(selectedSeance.classe_id, selectedSeance.matiere)"
              class="edt-detail-row edt-detail-row--prog">
              <dt class="edt-detail-label">Progression</dt>
              <dd style="flex:1;min-width:0;">
                <div class="edt-popup-prog-bar">
                  <div class="edt-popup-prog-fill"
                    :style="{ width: getModuleProgress(selectedSeance.classe_id, selectedSeance.matiere)!.pct + '%' }">
                  </div>
                </div>
                <div class="edt-popup-prog-stats">
                  <span class="edt-prog-done">
                    📅 {{ getModuleProgress(selectedSeance.classe_id, selectedSeance.matiere)!.planifiees }}h planifiées
                    ({{ getModuleProgress(selectedSeance.classe_id, selectedSeance.matiere)!.nbSeances }} séance{{ getModuleProgress(selectedSeance.classe_id, selectedSeance.matiere)!.nbSeances > 1 ? 's' : '' }})
                  </span>
                  <span style="color:#888;font-size:11px;">
                    · ✓ {{ getModuleProgress(selectedSeance.classe_id, selectedSeance.matiere)!.effectuees }}h émargées
                  </span>
                  <span class="edt-prog-total">
                    / {{ getModuleProgress(selectedSeance.classe_id, selectedSeance.matiere)!.total }}h total
                  </span>
                  <span class="edt-prog-rest">
                    · {{ getModuleProgress(selectedSeance.classe_id, selectedSeance.matiere)!.restantes }}h restantes
                  </span>
                </div>
              </dd>
            </div>
            <!-- Progression du module (formation individuelle) -->
            <div v-else-if="selectedSeance.fi_module_id && getFiModuleProgress(selectedSeance.fi_module_id)"
              class="edt-detail-row edt-detail-row--prog">
              <dt class="edt-detail-label">Formation individuelle</dt>
              <dd style="flex:1;min-width:0;">
                <div style="font-size:11px;color:#6366f1;font-weight:600;margin-bottom:4px;">📋 Module FI</div>
                <div class="edt-popup-prog-bar">
                  <div class="edt-popup-prog-fill"
                    :style="{ width: getFiModuleProgress(selectedSeance.fi_module_id)!.pct + '%', background: '#6366f1' }">
                  </div>
                </div>
                <div class="edt-popup-prog-stats">
                  <span class="edt-prog-done">
                    📅 {{ getFiModuleProgress(selectedSeance.fi_module_id)!.planifiees }}h planifiées
                    ({{ getFiModuleProgress(selectedSeance.fi_module_id)!.nbSeances }} séance{{ getFiModuleProgress(selectedSeance.fi_module_id)!.nbSeances > 1 ? 's' : '' }})
                  </span>
                  <span style="color:#888;font-size:11px;">
                    · ✓ {{ getFiModuleProgress(selectedSeance.fi_module_id)!.effectuees }}h émargées
                  </span>
                  <span class="edt-prog-rest">
                    · {{ getFiModuleProgress(selectedSeance.fi_module_id)!.restantes }}h restantes à émarger
                  </span>
                </div>
              </dd>
            </div>
            <div v-if="selectedSeance.salle" class="edt-detail-row">
              <dt class="edt-detail-label">Salle</dt>
              <dd class="edt-detail-value">{{ selectedSeance.salle }}</dd>
            </div>
            <div v-if="selectedSeance.lien_visio" class="edt-detail-row">
              <dt class="edt-detail-label">Lien visio</dt>
              <dd><a :href="selectedSeance.lien_visio" target="_blank" class="edt-link">{{ selectedSeance.lien_visio }}</a></dd>
            </div>
            <div v-if="selectedSeance.notes" class="edt-detail-row">
              <dt class="edt-detail-label">Notes</dt>
              <dd class="edt-detail-value" style="font-size: 12px;">{{ selectedSeance.notes }}</dd>
            </div>
          </dl>
          <div v-if="canWrite" class="edt-detail-actions">
            <button @click="openEdit(selectedSeance!)" class="edt-btn-edit">Modifier</button>
            <button @click="annuler(selectedSeance!)" class="edt-btn-cancel">Annuler la séance</button>
          </div>
          <!-- Actions série -->
          <div v-if="canWrite && selectedSeance!.groupe_serie" style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;">
            <div style="font-size:11px;color:#64748b;margin-bottom:6px;">
              Cette séance fait partie d'une série ({{ nbSeancesSerie(selectedSeance!.groupe_serie) }} séances)
            </div>
            <div style="display:flex;gap:6px;">
              <button @click="openSerieEdit(selectedSeance!)" style="flex:1;padding:6px 10px;font-size:12px;font-weight:600;background:#1e40af;color:#fff;border:none;border-radius:6px;cursor:pointer;">
                Modifier la série
              </button>
              <button @click="deleteSerie(selectedSeance!.groupe_serie!)" style="padding:6px 10px;font-size:12px;font-weight:600;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;">
                Supprimer la série
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal création/édition -->
    <UcModal
      v-model="showModal"
      :title="editId ? 'Modifier la séance' : 'Nouvelle séance'"
      @close="showModal = false"
    >
      <!-- Alerte conflit -->
      <div v-if="hasConflict()" class="edt-alert-warning">
        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
        </svg>
        Cet enseignant a déjà une séance sur ce créneau.
      </div>

      <div v-if="error" class="edt-alert-error">{{ error }}</div>

      <UcFormGrid :cols="2">
        <!-- Classe -->
        <UcFormGroup label="Classe" :required="true">
          <select v-model="form.classe_id" required class="edt-select" @change="onClasseChange">
            <option value="">Sélectionner…</option>
            <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
          </select>
        </UcFormGroup>

        <!-- Enseignant — filtré sur la filière de la classe -->
        <UcFormGroup label="Enseignant">
          <select v-model="form.enseignant_id" class="edt-select" @change="onEnseignantChange"
            :disabled="!form.classe_id"
            :style="!form.classe_id ? 'opacity:0.5;cursor:not-allowed;' : ''">
            <option value="">— Sans enseignant —</option>
            <option v-for="i in enseignantsForClasse" :key="i.id" :value="String(i.id)">
              {{ i.prenom }} {{ i.nom }}
            </option>
          </select>
        </UcFormGroup>
      </UcFormGrid>

      <!-- Matière — liste intelligente (filière + enseignant + heures restantes) -->
      <UcFormGroup label="Matière" :required="true" style="margin-top:12px;">
        <!-- Select quand il y a des matières disponibles -->
        <template v-if="matieresForForm.length > 0">
          <select v-model="form.matiere" required class="edt-select" style="width:100%;">
            <option value="">— Sélectionner une matière —</option>
            <option v-for="m in matieresForForm" :key="m.id || m.nom" :value="m.nom">
              {{ m.label }}
            </option>
          </select>

          <!-- Encadré récapitulatif des heures pour la matière choisie -->
          <div v-if="selectedMatiereInfo && selectedMatiereInfo.volumeTotal > 0"
            class="edt-vol-bar">
            <div class="edt-vol-bar-track">
              <div class="edt-vol-bar-fill"
                :style="{
                  width: Math.min(100, Math.round(
                    (selectedMatiereInfo.heuresPlanifiees / selectedMatiereInfo.volumeTotal) * 100
                  )) + '%'
                }">
              </div>
            </div>
            <div class="edt-vol-stats">
              <span class="edt-vol-stat edt-vol-stat--done">
                {{ roundHalf(selectedMatiereInfo.heuresPlanifiees) }}h planifiées
              </span>
              <span class="edt-vol-stat edt-vol-stat--total">
                / {{ selectedMatiereInfo.volumeTotal }}h total
              </span>
              <span class="edt-vol-stat edt-vol-stat--rest">
                · {{ roundHalf(selectedMatiereInfo.heuresRestantes) }}h restantes
              </span>
            </div>
          </div>
        </template>

        <!-- Tronc commun sélectionné mais UEs pas encore chargées ou vides -->
        <template v-else-if="isTroncCommunSelected">
          <div style="font-size:12px;color:#e67e22;background:#fff8f0;border:1px solid #fed7aa;border-radius:6px;padding:8px 12px;">
            ⚠️ Aucune matière affectée à cette classe tronc commun.
            Assignez d'abord un enseignant + matière dans l'onglet <strong>Enseignants</strong> de la classe.
          </div>
        </template>

        <!-- Saisie libre si aucune matière liée ou filière non choisie -->
        <template v-else>
          <input v-model="form.matiere" type="text" required
            :placeholder="form.classe_id ? 'Saisir le nom de la matière' : 'Sélectionnez d\'abord une classe'"
            class="edt-input"
            :disabled="!form.classe_id"
            :style="!form.classe_id ? 'opacity:0.5;cursor:not-allowed;' : ''" />
          <span v-if="form.classe_id && filiereIdForClasse(form.classe_id)"
            style="font-size:11px;color:#9ca3af;margin-top:2px;">
            Toutes les matières de cette filière sont déjà couvertes — saisie libre
          </span>
        </template>
      </UcFormGroup>

      <UcFormGrid :cols="2" style="margin-top:12px;">
        <UcFormGroup label="Date" :required="true">
          <input v-model="form.date" type="date" required class="edt-input" />
        </UcFormGroup>
        <UcFormGroup label="Heure début" :required="true">
          <input v-model="form.heure_debut" type="time" required class="edt-input" />
        </UcFormGroup>
        <UcFormGroup label="Heure fin" :required="true">
          <input v-model="form.heure_fin" type="time" required class="edt-input" />
        </UcFormGroup>
        <UcFormGroup label="Mode" :required="true">
          <select v-model="form.mode" class="edt-select">
            <option value="presentiel">Présentiel</option>
            <option value="en_ligne">En ligne</option>
            <option value="hybride">Hybride</option>
            <option value="exam">Examen</option>
          </select>
        </UcFormGroup>
        <UcFormGroup v-if="form.mode !== 'en_ligne'" label="Salle">
          <input v-model="form.salle" type="text" placeholder="Ex : Salle A" class="edt-input" />
        </UcFormGroup>
        <UcFormGroup v-if="form.mode !== 'presentiel' && form.mode !== 'exam'" label="Lien visio" style="grid-column:1/-1;">
          <input v-model="form.lien_visio" type="url" placeholder="https://meet.google.com/…" class="edt-input" />
        </UcFormGroup>
      </UcFormGrid>

      <UcFormGroup label="Notes" style="margin-top:12px;">
        <textarea v-model="form.notes" rows="2" placeholder="Remarques éventuelles…" class="edt-input edt-textarea"></textarea>
      </UcFormGroup>

      <template #footer>
        <button @click="showModal = false" class="edt-btn-secondary">Annuler</button>
        <button @click="save" :disabled="saving || !form.classe_id || !form.matiere" class="uc-btn-primary" style="flex:1;">
          {{ saving ? 'Enregistrement…' : (editId ? 'Modifier' : 'Créer') }}
        </button>
      </template>
    </UcModal>

    <!-- Modal modification d'une série -->
    <UcModal v-model="showSerieModal" title="Modifier la série" @close="showSerieModal = false">
      <!-- Info série : plage, compteurs -->
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 14px;margin-bottom:12px;font-size:12px;color:#0369a1;">
        <div v-if="seriePlage" style="margin-bottom:6px;">
          <strong>{{ seriePlage.debut }}</strong> → <strong>{{ seriePlage.fin }}</strong>
          &nbsp;·&nbsp; {{ seriePlage.total }} séance(s) au total
          <span v-if="seriePlage.effectuees" style="color:#065f46;"> · {{ seriePlage.effectuees }} effectuée(s)</span>
          <span v-if="seriePlage.planifiees" style="color:#0369a1;"> · {{ seriePlage.planifiees }} planifiée(s)</span>
        </div>
        <div style="color:#0c4a6e;font-weight:600;">
          {{ serieSeancesAffectees.length }} séance(s) seront affectées par cette modification.
        </div>
      </div>

      <!-- Jours de répétition -->
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:6px;">Jours de répétition</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          <button
            v-for="j in joursSemaine" :key="j.value"
            @click="toggleSerieJour(j.value)"
            type="button"
            :style="{
              padding: '6px 14px', borderRadius: '16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none',
              background: serieForm.jours.includes(j.value) ? '#1e40af' : '#e5e7eb',
              color: serieForm.jours.includes(j.value) ? '#fff' : '#374151',
            }"
          >{{ j.label }}</button>
        </div>
      </div>

      <!-- Filtre : à partir de + date fin -->
      <UcFormGrid>
        <UcFormGroup label="Modifier à partir du">
          <input v-model="serieForm.a_partir_de" type="date" class="uc-input" />
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">
            Laissez vide pour modifier toutes les séances planifiées.
          </div>
        </UcFormGroup>
        <UcFormGroup label="Nouvelle date de fin">
          <input v-model="serieForm.date_fin" type="date" class="uc-input" />
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">
            Si vous changez les jours, les séances seront redistribuées jusqu'à cette date.
          </div>
        </UcFormGroup>
      </UcFormGrid>

      <UcFormGrid>
        <UcFormGroup label="Enseignant">
          <select v-model="serieForm.enseignant_id" class="uc-input">
            <option value="">— Aucun —</option>
            <option v-for="e in enseignants" :key="e.id" :value="String(e.id)">{{ e.prenom }} {{ e.nom }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Matière">
          <input v-model="serieForm.matiere" type="text" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>

      <UcFormGrid>
        <UcFormGroup label="Heure début">
          <input v-model="serieForm.heure_debut" type="time" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Heure fin">
          <input v-model="serieForm.heure_fin" type="time" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>

      <UcFormGrid>
        <UcFormGroup label="Mode">
          <select v-model="serieForm.mode" class="uc-input">
            <option value="presentiel">Présentiel</option>
            <option value="en_ligne">En ligne</option>
            <option value="hybride">Hybride</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Salle">
          <input v-model="serieForm.salle" type="text" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>

      <template #footer>
        <button @click="deleteSerie(serieGroupeId)" style="padding:8px 14px;font-size:13px;font-weight:600;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;border-radius:6px;cursor:pointer;">
          {{ serieForm.a_partir_de ? 'Supprimer à partir du ' + serieForm.a_partir_de : 'Supprimer la série' }}
        </button>
        <div style="flex:1"></div>
        <button @click="showSerieModal = false" class="edt-btn-secondary">Annuler</button>
        <button @click="saveSerie" :disabled="savingSerie" class="uc-btn-primary">
          {{ savingSerie ? 'Enregistrement…' : (serieForm.a_partir_de ? 'Modifier ' + serieSeancesAffectees.length + ' séance(s)' : 'Modifier toute la série') }}
        </button>
      </template>
    </UcModal>

    <!-- Modal planification en série -->
    <UcModal v-model="showRepeat" :title="repeatResult ? 'Résultat de la planification' : 'Planifier en série (répétition hebdomadaire)'" @close="showRepeat = false">
      <!-- Résultat -->
      <div v-if="repeatResult" style="padding:8px 0;">
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:14px 16px;margin-bottom:12px;">
          <div style="font-weight:700;color:#065f46;font-size:15px;margin-bottom:4px;">{{ repeatResult.total_crees }} séance(s) créée(s)</div>
          <div v-if="repeatResult.total_exclues" style="font-size:12px;color:#92400e;">{{ repeatResult.total_exclues }} date(s) exclue(s) :</div>
          <ul v-if="repeatResult.exclues?.length" style="margin:6px 0 0 16px;font-size:12px;color:#78716c;">
            <li v-for="(ex, i) in repeatResult.exclues" :key="i">{{ ex.date }} <template v-if="ex.jour">({{ ex.jour }})</template> — {{ ex.raison }}</li>
          </ul>
        </div>
        <button @click="showRepeat = false" class="uc-btn-primary" style="width:100%;">Fermer</button>
      </div>

      <!-- Formulaire -->
      <div v-else>
        <UcFormGrid>
          <UcFormGroup label="Classe" required>
            <select v-model="repeatForm.classe_id" class="uc-input">
              <option value="">— Sélectionner —</option>
              <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
            </select>
          </UcFormGroup>
          <UcFormGroup label="Enseignant">
            <select v-model="repeatForm.enseignant_id" class="uc-input">
              <option value="">— Aucun —</option>
              <option v-for="e in enseignants" :key="e.id" :value="String(e.id)">{{ e.prenom }} {{ e.nom }}</option>
            </select>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGroup required>
          <template #label>
            <span>Matière</span>
            <!-- Badge vert : le prof a des matières affectées dans cette classe -->
            <span v-if="repeatProfAssignedCount !== null && repeatProfAssignedCount > 0"
              style="margin-left:8px;font-size:10px;background:#dbeafe;color:#1d4ed8;padding:1px 7px;border-radius:10px;font-weight:600;">
              {{ repeatProfAssignedCount }} affectée(s) au prof
            </span>
            <!-- Badge orange : prof sélectionné mais aucune matière affectée → affichage de toutes les matières de la classe -->
            <span v-if="repeatProfAssignedCount !== null && repeatProfAssignedCount === 0 && matieresForRepeat.length > 0"
              style="margin-left:8px;font-size:10px;background:#fef3c7;color:#b45309;padding:1px 7px;border-radius:10px;font-weight:600;">
              Aucune affectée — toutes les matières affichées
            </span>
            <!-- Badge rouge : aucune matière pour cette classe -->
            <span v-if="repeatForm.enseignant_id && repeatForm.classe_id && matieresForRepeat.length === 0"
              style="margin-left:8px;font-size:10px;background:#fef2f2;color:#dc2626;padding:1px 7px;border-radius:10px;font-weight:600;">
              Aucune matière dans cette classe
            </span>
          </template>
          <select v-if="matieresForRepeat.length > 0" v-model="repeatForm.matiere" class="uc-input">
            <option value="">— Sélectionner —</option>
            <option v-for="m in matieresForRepeat" :key="m.nom" :value="m.nom">{{ m.label }}</option>
          </select>
          <input v-else v-model="repeatForm.matiere" type="text" class="uc-input" placeholder="Ex: Développement Web, Anglais…" />
        </UcFormGroup>

        <!-- Résumé du module -->
        <div v-if="repeatModuleInfo && repeatModuleInfo.total > 0" style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;margin-bottom:10px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <span style="font-size:12px;font-weight:600;color:#0369a1;">Volume horaire du module</span>
            <span style="font-size:12px;color:#64748b;">{{ repeatModuleInfo.planifiees }}h planifiées / {{ repeatModuleInfo.total }}h total</span>
          </div>
          <div style="height:6px;background:#e0f2fe;border-radius:4px;overflow:hidden;">
            <div :style="{ width: repeatModuleInfo.pct + '%', height: '100%', background: repeatModuleInfo.pct >= 100 ? '#22c55e' : '#0284c7', borderRadius: '4px', transition: 'width 0.3s' }"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;">
            <span style="font-size:11px;color:#0369a1;font-weight:600;">{{ repeatModuleInfo.restantes }}h restantes</span>
            <span v-if="repeatNbSeances > 0 && repeatSeanceDuree > 0" style="font-size:11px;color:#64748b;">
              = {{ repeatNbSeances }} séance(s) de {{ repeatSeanceDuree }}h
            </span>
          </div>
        </div>

        <!-- Disponibilités du prof -->
        <div v-if="enseignantDispos.length > 0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:10px;">
          <div style="font-size:12px;font-weight:600;color:#166534;margin-bottom:6px;">Disponibilités déclarées par l'enseignant</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <span v-for="d in enseignantDispos" :key="d.jour + d.heure_debut"
              style="font-size:11px;background:#dcfce7;color:#166534;padding:3px 8px;border-radius:4px;">
              {{ joursSemaine.find(j => j.value === d.jour)?.label ?? d.jour }} {{ d.heure_debut.slice(0,5) }}–{{ d.heure_fin.slice(0,5) }}
            </span>
          </div>
        </div>
        <div v-else-if="repeatForm.enseignant_id && !loadingDispos" style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:8px 14px;margin-bottom:10px;font-size:11px;color:#92400e;">
          Aucune disponibilité déclarée — toutes les dates seront acceptées.
        </div>

        <UcFormGroup label="Jours de répétition" required>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button v-for="j in joursSemaine" :key="j.value"
              type="button"
              @click="toggleJour(j.value)"
              :style="{
                padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                border: repeatForm.jours.includes(j.value) ? '2px solid #1d4ed8' : '1.5px solid #cbd5e1',
                background: repeatForm.jours.includes(j.value) ? '#dbeafe' : '#fff',
                color: repeatForm.jours.includes(j.value) ? '#1d4ed8' : '#64748b',
              }"
            >{{ j.label }}</button>
          </div>
          <p v-if="repeatForm.jours.length > 1" style="font-size:11px;color:#64748b;margin-top:4px;">
            {{ repeatForm.jours.length }} jours/semaine sélectionnés — le module sera couvert plus rapidement.
          </p>
        </UcFormGroup>

        <UcFormGroup label="Mode">
          <select v-model="repeatForm.mode" class="uc-input">
            <option value="presentiel">Présentiel</option>
            <option value="en_ligne">En ligne</option>
            <option value="hybride">Hybride</option>
          </select>
        </UcFormGroup>

        <UcFormGrid>
          <UcFormGroup label="Heure début" required>
            <input v-model="repeatForm.heure_debut" type="time" class="uc-input" />
          </UcFormGroup>
          <UcFormGroup label="Heure fin" required>
            <input v-model="repeatForm.heure_fin" type="time" class="uc-input" />
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGrid>
          <UcFormGroup label="Date début période" required>
            <input v-model="repeatForm.date_debut" type="date" class="uc-input" />
          </UcFormGroup>
          <UcFormGroup :label="repeatNbSeances > 0 ? `Date fin (calculée auto — ${repeatNbSeances} séances)` : 'Date fin période'" required>
            <input v-model="repeatForm.date_fin" type="date" class="uc-input" />
            <p v-if="repeatNbSeances > 0" style="font-size:11px;color:#64748b;margin-top:3px;">
              Calculée auto : {{ repeatNbSeances }} séances de {{ repeatSeanceDuree }}h
              <template v-if="repeatSeancesParSemaine > 1"> ({{ repeatSeancesParSemaine }}x/sem. = ~{{ Math.ceil(repeatNbSeances / repeatSeancesParSemaine) }} sem.)</template>
              pour couvrir {{ repeatModuleInfo?.restantes }}h restantes (+1 sem. marge congés)
            </p>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGroup label="Salle">
          <input v-model="repeatForm.salle" type="text" class="uc-input" placeholder="Ex: Salle A, Amphi…" />
        </UcFormGroup>

        <UcFormGroup label="Année académique">
          <select v-model="repeatForm.annee_academique_id" class="uc-input">
            <option value="">— Aucune —</option>
            <option v-for="a in anneesAcademiques" :key="a.id" :value="String(a.id)">{{ a.libelle }}</option>
          </select>
        </UcFormGroup>

        <div v-if="error" style="color:#dc2626;font-size:12px;margin-top:6px;">{{ error }}</div>
      </div>

      <template #footer>
        <template v-if="!repeatResult">
          <button @click="showRepeat = false" class="edt-btn-secondary">Annuler</button>
          <button
            @click="saveRepeat"
            :disabled="savingRepeat || !repeatForm.classe_id || !repeatForm.matiere || !repeatForm.date_debut || !repeatForm.date_fin"
            class="uc-btn-primary" style="flex:1;"
          >
            {{ savingRepeat ? 'Génération en cours…' : 'Générer les séances' }}
          </button>
        </template>
      </template>
    </UcModal>

  </div>
</template>

<style scoped>
/* ════════════════════════════════════════════════════════
   BASE
════════════════════════════════════════════════════════ */
.uc-content {
  padding: 24px;
  max-width: 1400px;
  background: linear-gradient(135deg, #f0f4ff 0%, #fafafa 60%, #fff5f5 100%);
  min-height: 100vh;
  font-family: 'Poppins', sans-serif;
}

/* ════════════════════════════════════════════════════════
   TOOLBAR
════════════════════════════════════════════════════════ */
.edt-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  background: #fff;
  border-radius: 12px;
  padding: 12px 16px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.edt-select {
  padding: 8px 14px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  font-family: 'Poppins', sans-serif;
  background: #f9fafb;
  color: #111;
  outline: none;
  transition: border-color 0.2s;
}
.edt-select:focus { border-color: #E30613; box-shadow: 0 0 0 3px rgba(227,6,19,0.1); }

.edt-week-nav { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.edt-nav-btn {
  padding: 8px 12px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  color: #374151;
  transition: all 0.15s;
  font-size: 14px;
  font-weight: 600;
}
.edt-nav-btn:hover { background: #E30613; color: #fff; border-color: #E30613; }
.edt-week-label {
  font-size: 13px;
  font-weight: 700;
  color: #1e293b;
  min-width: 210px;
  text-align: center;
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.edt-today-btn {
  padding: 8px 16px;
  font-size: 12px;
  font-weight: 700;
  border: 2px solid #E30613;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  color: #E30613;
  transition: all 0.15s;
  letter-spacing: 0.02em;
}
.edt-today-btn:hover { background: #E30613; color: #fff; }

.edt-pdf-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.edt-radio-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #374151;
  cursor: pointer;
  white-space: nowrap;
}
.edt-radio-label input[type="radio"] {
  accent-color: #E30613;
  width: 14px;
  height: 14px;
}
.edt-export-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 700;
  border: 2px solid #374151;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  color: #374151;
  white-space: nowrap;
}
.edt-export-btn:hover { background: #374151; color: #fff; }

/* ════════════════════════════════════════════════════════
   LÉGENDE
════════════════════════════════════════════════════════ */
.edt-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 10px 16px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 6px rgba(0,0,0,0.05);
  flex-wrap: wrap;
}
.edt-legend-title { font-size: 12px; font-weight: 700; color: #64748b; white-space: nowrap; }
.edt-legend-item { display: flex; align-items: center; gap: 6px; }
.edt-legend-dot {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  display: inline-block;
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  flex-shrink: 0;
}
.edt-legend-text { font-size: 12px; font-weight: 600; color: #374151; }

.edt-loading { text-align: center; padding: 48px; color: #9ca3af; font-size: 14px; }

/* ════════════════════════════════════════════════════════
   GRILLE — WRAPPER
════════════════════════════════════════════════════════ */
.edt-grid-wrap {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  border: 1px solid rgba(0,0,0,0.04);
}

/* ════════════════════════════════════════════════════════
   GRILLE — EN-TÊTE JOURS
════════════════════════════════════════════════════════ */
.edt-grid-header {
  display: grid;
  grid-template-columns: 56px repeat(7, 1fr);
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
  border-radius: 16px 16px 0 0;
}
.edt-time-col-header {
  background: transparent;
  border-right: 1px solid rgba(255,255,255,0.1);
}
.edt-day-header {
  padding: 14px 8px 10px;
  text-align: center;
  border-left: 1px solid rgba(255,255,255,0.08);
  position: relative;
  transition: background 0.2s;
}
.edt-day-header--weekend {
  background: rgba(255,255,255,0.04);
}
.edt-day-header--today {
  background: linear-gradient(180deg, rgba(227,6,19,0.25) 0%, rgba(227,6,19,0.08) 100%);
}
.edt-day-header--conge {
  background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%) !important;
  border-bottom: 3px solid #ef4444 !important;
}
.edt-conge-badge {
  font-size: 10px;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #ef4444, #f97316);
  border: none;
  border-radius: 10px;
  padding: 3px 8px;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
  animation: edt-conge-pulse 2s ease-in-out infinite;
}
@keyframes edt-conge-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; transform: scale(1.02); }
}
.edt-conge-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 50%, #fecaca 100%);
  border: 2px solid #ef4444;
  border-radius: 14px;
  padding: 18px 24px;
  margin-bottom: 14px;
  box-shadow: 0 4px 16px rgba(239,68,68,0.15);
}
.edt-conge-banner-icon {
  font-size: 36px;
  animation: edt-conge-bounce 1.5s ease-in-out infinite;
}
@keyframes edt-conge-bounce {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}
.edt-conge-banner-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.edt-conge-banner-text strong {
  font-size: 14px;
  color: #dc2626;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.edt-conge-banner-text span {
  font-size: 20px;
  font-weight: 800;
  color: #991b1b;
}
.edt-day-name {
  font-size: 10px;
  color: rgba(255,255,255,0.6);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 6px;
}
.edt-day-num-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  margin: 0 auto;
}
.edt-day-num-wrap--today {
  background: #E30613;
  box-shadow: 0 4px 12px rgba(227,6,19,0.4);
}
.edt-day-num {
  font-size: 15px;
  font-weight: 800;
  color: #fff;
  margin: 0;
  line-height: 1;
}
.edt-day-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: rgba(255,255,255,0.15);
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
  color: #fff;
  margin-top: 4px;
}

/* ════════════════════════════════════════════════════════
   GRILLE — CORPS
════════════════════════════════════════════════════════ */
.edt-grid-body {
  display: grid;
  grid-template-columns: 56px repeat(7, 1fr);
  min-height: 640px;
}
.edt-time-col { border-right: 1px solid #f1f5f9; background: #fafbfc; }
.edt-time-slot {
  height: 64px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding-right: 10px;
  padding-top: 4px;
}
.edt-time-label { font-size: 10px; font-weight: 600; color: #94a3b8; }

.edt-day-col {
  position: relative;
  border-left: 1px solid #f1f5f9;
  background: #fff;
  transition: background 0.2s;
}
.edt-day-col--weekend {
  background: linear-gradient(180deg, #fef9f0 0%, #fffdf7 100%);
}
.edt-day-col--today {
  background: linear-gradient(180deg, rgba(227,6,19,0.03) 0%, #fff 80%);
}
.edt-day-col--conge {
  background: repeating-linear-gradient(
    -45deg,
    rgba(239,68,68,0.06),
    rgba(239,68,68,0.06) 8px,
    rgba(249,115,22,0.04) 8px,
    rgba(249,115,22,0.04) 16px
  );
  position: relative;
}
.edt-day-col--conge::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(239,68,68,0.08) 0%, rgba(249,115,22,0.03) 100%);
  pointer-events: none;
  z-index: 0;
}
.edt-day-col--conge::after {
  content: '🎉 CONGÉ';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(-25deg);
  font-size: 26px;
  font-weight: 900;
  color: rgba(239,68,68,0.18);
  letter-spacing: 4px;
  pointer-events: none;
  white-space: nowrap;
  z-index: 1;
}
.edt-hour-row {
  height: 64px;
  border-bottom: 1px solid #f1f5f9;
  position: relative;
}
.edt-hour-row::after {
  content: '';
  position: absolute;
  bottom: 50%;
  left: 0; right: 0;
  border-bottom: 1px dashed #f1f5f9;
}

/* ════════════════════════════════════════════════════════
   SÉANCES — CARTES
════════════════════════════════════════════════════════ */
.edt-seance {
  position: absolute;
  left: 3px;
  right: 3px;
  border-radius: 10px;
  padding: 6px 8px;
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
}
.edt-seance:hover {
  transform: translateY(-1px) scale(1.01);
  box-shadow: 0 6px 20px rgba(0,0,0,0.18);
  z-index: 10;
}

/* Couleur de fond appliquée en inline via matiereGradient() */
/* Émargé — légèrement atténué */
.edt-seance--done { opacity: 0.82; }

.edt-seance-inner { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; }
.edt-seance-icon { font-size: 12px; line-height: 1; flex-shrink: 0; }
.edt-seance-matiere {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0,0,0,0.15);
}
.edt-seance-time {
  font-size: 9.5px;
  color: rgba(255,255,255,0.85);
  margin: 0 0 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.edt-seance-interv {
  font-size: 9px;
  color: rgba(255,255,255,0.75);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Progression heures restantes (carte grille) ── */
.edt-seance-prog-wrap { margin-top: 4px; }
.edt-seance-prog-bar {
  height: 3px;
  background: rgba(255,255,255,0.25);
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 2px;
}
.edt-seance-prog-fill {
  height: 100%;
  background: rgba(255,255,255,0.9);
  border-radius: 999px;
  transition: width .3s;
}
.edt-seance-prog-label {
  font-size: 9px;
  font-weight: 700;
  display: block;
  white-space: nowrap;
  color: rgba(255,255,255,0.95);
}
.edt-seance-emarge-badge {
  display: inline-block;
  font-size: 9px;
  font-weight: 700;
  background: rgba(255,255,255,0.25);
  color: #fff;
  border-radius: 4px;
  padding: 1px 5px;
  margin-top: 3px;
  border: 1px solid rgba(255,255,255,0.35);
}

/* ════════════════════════════════════════════════════════
   POPUP DÉTAIL
════════════════════════════════════════════════════════ */
.edt-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(15,23,42,0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.edt-detail-popup {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.18);
  width: 420px;
  max-width: 95vw;
  overflow: hidden;
}
.edt-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 20px 16px;
  background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
}
.edt-detail-title {
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 6px;
}
.edt-close-btn {
  background: rgba(255,255,255,0.1);
  border: none;
  color: rgba(255,255,255,0.7);
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  transition: all 0.15s;
}
.edt-close-btn:hover { background: rgba(255,255,255,0.2); color: #fff; }

.edt-detail-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin: 0;
  padding: 0 20px 4px;
}
.edt-detail-row {
  display: flex;
  gap: 10px;
  font-size: 13px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
.edt-detail-row:last-child { border-bottom: none; }
.edt-detail-label {
  color: #94a3b8;
  width: 96px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 1px;
}
.edt-detail-value { color: #1e293b; font-weight: 600; }
.edt-link { color: #3b82f6; text-decoration: underline; font-size: 12px; word-break: break-all; }

.edt-detail-actions {
  display: flex;
  gap: 10px;
  padding: 16px 20px 20px;
  background: #f8fafc;
  border-top: 1px solid #f1f5f9;
}
.edt-btn-edit {
  flex: 1;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.edt-btn-edit:hover { opacity: 0.88; }
.edt-btn-cancel {
  flex: 1;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 600;
  background: linear-gradient(135deg, #ef4444, #dc2626);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.edt-btn-cancel:hover { opacity: 0.88; }

/* ── Progression popup ── */
.edt-detail-row--prog { flex-direction: column; gap: 6px; }
.edt-detail-row--prog dt { width: auto; }
.edt-popup-prog-bar {
  height: 10px;
  background: #f1f5f9;
  border-radius: 999px;
  overflow: hidden;
  margin-bottom: 6px;
}
.edt-popup-prog-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981, #059669);
  border-radius: 999px;
  transition: width .4s ease;
}
.edt-popup-prog-stats { display: flex; gap: 8px; font-size: 11.5px; flex-wrap: wrap; align-items: center; }
.edt-prog-done  { color: #10b981; font-weight: 700; }
.edt-prog-total { color: #94a3b8; }
.edt-prog-rest  { color: #ef4444; font-weight: 700; }

/* Badges mode dans popup */
.edt-mode-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.edt-mode-badge--presentiel { background: linear-gradient(135deg,#10b981,#059669); color:#fff; }
.edt-mode-badge--en_ligne   { background: linear-gradient(135deg,#3b82f6,#2563eb); color:#fff; }
.edt-mode-badge--hybride    { background: linear-gradient(135deg,#f97316,#ea580c); color:#fff; }
.edt-mode-badge--exam       { background: linear-gradient(135deg,#ef4444,#dc2626); color:#fff; }
.edt-mode-badge--popup      { background: rgba(255,255,255,0.2); color:#fff; border: 1px solid rgba(255,255,255,0.35); }

/* ════════════════════════════════════════════════════════
   FORMULAIRE
════════════════════════════════════════════════════════ */
.edt-alert-warning {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  background: linear-gradient(135deg,#fffbeb,#fef3c7);
  border: 2px solid #fde68a;
  border-radius: 10px;
  font-size: 13px;
  color: #92400e;
  margin-bottom: 16px;
  font-weight: 500;
}
.edt-alert-error {
  padding: 12px 16px;
  background: linear-gradient(135deg,#fff1f2,#ffe4e6);
  border: 2px solid #fecdd3;
  border-radius: 10px;
  font-size: 13px;
  color: #be123c;
  margin-bottom: 16px;
  font-weight: 500;
}

.edt-input {
  padding: 9px 14px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  font-family: 'Poppins', sans-serif;
  outline: none;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.2s;
  background: #f9fafb;
}
.edt-input:focus { border-color: #E30613; box-shadow: 0 0 0 3px rgba(227,6,19,0.1); background: #fff; }
.edt-textarea { resize: none; }

/* Volume horaire */
.edt-vol-bar { margin-top: 10px; }
.edt-vol-bar-track { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.edt-vol-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #10b981, #059669);
  border-radius: 999px;
  transition: width 0.4s ease;
}
.edt-vol-stats { display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.edt-vol-stat { font-size: 12px; font-weight: 600; }
.edt-vol-stat--done  { color: #10b981; }
.edt-vol-stat--total { color: #64748b; }
.edt-vol-stat--rest  { color: #E30613; font-weight: 700; }

.edt-btn-secondary {
  flex: 1;
  padding: 10px 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s;
}
.edt-btn-secondary:hover { background: #f9fafb; border-color: #d1d5db; }

.uc-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: linear-gradient(135deg, #E30613, #c0050f);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  transition: opacity 0.15s;
  box-shadow: 0 4px 12px rgba(227,6,19,0.3);
}
.uc-btn-primary:hover { opacity: 0.88; }
.uc-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }

/* ════════════════════════════════════════════════════════
   RESPONSIVE
════════════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .edt-grid-wrap { overflow-x: auto; }
  .edt-grid-header { min-width: 720px; grid-template-columns: 48px repeat(7, minmax(95px, 1fr)); }
  .edt-grid-body   { min-width: 720px; grid-template-columns: 48px repeat(7, minmax(95px, 1fr)); }
  .edt-toolbar { padding: 10px 12px; }
}

/* ════════════════════════════════════════════════════════
   HERO
════════════════════════════════════════════════════════ */
.edt-hero {
  position: relative;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #1a0a0a 100%);
  border-radius: 16px;
  margin-bottom: 16px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(15,23,42,0.18);
}
.edt-hero-glow {
  position: absolute;
  top: -60px; right: -60px;
  width: 280px; height: 280px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(227,6,19,0.18) 0%, transparent 70%);
  pointer-events: none;
}
.edt-hero-content {
  position: relative;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 20px 28px;
  flex-wrap: wrap;
}
.edt-hero-left { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.edt-hero-icon {
  width: 48px; height: 48px;
  background: rgba(255,255,255,0.07);
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
  border: 1px solid rgba(255,255,255,0.1);
}
.edt-hero-title { font-size: 20px; font-weight: 800; color: #fff; margin: 0 0 2px; }
.edt-hero-sub { font-size: 12px; color: rgba(255,255,255,0.5); margin: 0; }

.edt-hero-kpis { display: flex; gap: 8px; flex-wrap: wrap; }
.edt-hkpi {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px;
  padding: 10px 16px;
  text-align: center;
  min-width: 80px;
  cursor: default;
  transition: background 0.15s;
}
.edt-hkpi:hover { background: rgba(255,255,255,0.12); }
.edt-hkpi--blue  { border-color: rgba(59,130,246,0.4); }
.edt-hkpi--green { border-color: rgba(16,185,129,0.4); }
.edt-hkpi--purple { border-color: rgba(139,92,246,0.4); }
.edt-hkpi-val { font-size: 18px; font-weight: 800; color: #fff; line-height: 1.1; }
.edt-hkpi--blue  .edt-hkpi-val { color: #60a5fa; }
.edt-hkpi--green .edt-hkpi-val { color: #34d399; }
.edt-hkpi--purple .edt-hkpi-val { color: #a78bfa; }
.edt-hkpi-lbl { font-size: 10px; color: rgba(255,255,255,0.45); font-weight: 600; margin-top: 2px; text-transform: uppercase; letter-spacing: .04em; }

.edt-hero-actions { margin-left: auto; }
.edt-hero-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 18px;
  background: linear-gradient(135deg, #E30613, #c0050f);
  color: #fff; border: none; border-radius: 10px;
  font-size: 13px; font-weight: 700; cursor: pointer;
  font-family: 'Poppins', sans-serif;
  box-shadow: 0 4px 14px rgba(227,6,19,0.35);
  transition: opacity 0.15s;
}
.edt-hero-btn:hover { opacity: 0.88; }

/* ── Toolbar toggles ── */
.edt-toggles {
  display: flex;
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}
.edt-tog {
  padding: 7px 12px;
  font-size: 12px; font-weight: 600;
  border: none; background: #fff; cursor: pointer;
  color: #6b7280;
  font-family: 'Poppins', sans-serif;
  transition: all 0.15s;
}
.edt-tog + .edt-tog { border-left: 1.5px solid #e5e7eb; }
.edt-tog--active { background: #1e293b; color: #fff; }
.edt-tog:hover:not(.edt-tog--active) { background: #f9fafb; }

/* ── Ligne heure courante ── */
.edt-now-line {
  position: absolute;
  left: 0; right: 0;
  z-index: 5;
  pointer-events: none;
  display: flex;
  align-items: center;
}
.edt-now-line::after {
  content: '';
  flex: 1;
  height: 2px;
  background: linear-gradient(90deg, #E30613 0%, rgba(227,6,19,0.2) 100%);
  border-radius: 1px;
}
.edt-now-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #E30613;
  flex-shrink: 0;
  box-shadow: 0 0 6px rgba(227,6,19,0.6);
  margin-right: 2px;
}

/* ════════════════════════════════════════════════════════
   VUE LISTE
════════════════════════════════════════════════════════ */
.edt-list { display: flex; flex-direction: column; gap: 12px; }
.edt-list-day {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  overflow: hidden;
  border: 1px solid rgba(0,0,0,0.04);
}
.edt-list-day-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 18px;
  background: linear-gradient(135deg, #f8fafc, #f1f5f9);
  border-bottom: 1px solid #e5e7eb;
}
.edt-list-day-header--today {
  background: linear-gradient(135deg, #fff1f2, #fef2f2);
  border-bottom-color: #fecaca;
}
.edt-list-day-name { font-size: 13.5px; font-weight: 700; color: #1e293b; text-transform: capitalize; }
.edt-list-day-header--today .edt-list-day-name { color: #E30613; }
.edt-list-day-count { font-size: 11px; font-weight: 600; color: #94a3b8; background: #fff; border-radius: 20px; padding: 2px 10px; border: 1px solid #e5e7eb; }

.edt-list-seances { display: flex; flex-direction: column; }
.edt-list-row {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 18px;
  border-bottom: 1px solid #f8fafc;
  cursor: pointer;
  transition: background 0.12s;
  position: relative;
}
.edt-list-row:last-child { border-bottom: none; }
.edt-list-row:hover { background: #f8fafc; }
.edt-list-bar {
  width: 4px; height: 44px;
  border-radius: 3px;
  flex-shrink: 0;
}
.edt-list-time {
  display: flex; flex-direction: column; align-items: center;
  min-width: 60px; text-align: center;
  font-size: 12px; font-weight: 700; color: #374151;
}
.edt-list-time-sep { color: #9ca3af; font-size: 10px; line-height: 1; }
.edt-list-info { flex: 1; min-width: 0; }
.edt-list-matiere { font-size: 13.5px; font-weight: 700; color: #1e293b; margin-bottom: 3px; }
.edt-list-meta { font-size: 11.5px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.edt-list-status { flex-shrink: 0; }
.edt-list-badge {
  display: inline-block; font-size: 10.5px; font-weight: 700;
  padding: 3px 9px; border-radius: 20px;
  background: #f1f5f9; color: #64748b;
  border: 1px solid #e5e7eb;
}
.edt-list-badge--done { background: #f0fdf4; color: #15803d; border-color: #bbf7d0; }
.edt-list-badge--confirmed { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.edt-list-empty { text-align: center; padding: 48px; color: #9ca3af; font-size: 14px; background: #fff; border-radius: 12px; }

/* ── Responsive hero ── */
@media (max-width: 900px) {
  .edt-hero-content { padding: 16px 20px; gap: 14px; }
  .edt-hero-kpis { gap: 6px; }
}
@media (max-width: 640px) {
  .edt-hero-kpis { display: grid; grid-template-columns: repeat(2,1fr); width: 100%; }
  .edt-hero-actions { width: 100%; }
  .edt-hero-btn { width: 100%; justify-content: center; }
  .edt-toggles { flex: 1; }
}
</style>
