<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcFormGrid from '@/components/ui/UcFormGrid.vue'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'

const auth = useAuthStore()

const canWrite = computed(() =>
  ['dg', 'dir_peda', 'coordinateur', 'secretariat'].includes(auth.user?.role ?? '')
)

interface Seance {
  id: number
  classe_id: number
  intervenant_id: number | null
  matiere: string
  date_debut: string
  date_fin: string
  mode: 'presentiel' | 'en_ligne' | 'hybride' | 'exam'
  salle: string | null
  lien_visio: string | null
  statut: 'planifie' | 'confirme' | 'annule' | 'reporte'
  notes: string | null
  annee_academique_id: number | null
  classe?: { id: number; nom: string; filiere?: { nom: string } }
  intervenant?: { id: number; nom: string; prenom: string }
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
interface IntervenantFiliere { id: number; filiere_id: number; matiere: string }
interface Classe { id: number; nom: string; filiere_id: number; filiere?: { id: number; nom: string } }
interface Intervenant { id: number; nom: string; prenom: string; filieres?: IntervenantFiliere[] }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }

const seances = ref<Seance[]>([])
const classes = ref<Classe[]>([])
const intervenants = ref<Intervenant[]>([])
const anneesAcademiques = ref<AnneeAcademique[]>([])
const filieres = ref<{ id: number; nom: string; matieres?: FiliereMatiere[] }[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')

// Filtres
const filterClasse = ref('')
const filterIntervenant = ref('')
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
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(currentWeekStart.value)
    d.setDate(d.getDate() + i)
    return d
  })
})

const weekLabel = computed(() => {
  const start = weekDays.value[0]!
  const end = weekDays.value[4]!
  const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)} ${end.getFullYear()}`
})

// Créneaux horaires 08h-19h
const timeSlots = Array.from({ length: 12 }, (_, i) => i + 8) // 8..19

function hourToRow(h: number, m = 0) { return (h - 8) * 2 + (m >= 30 ? 2 : 1) }

// Grille : pour chaque jour, les séances filtrées
const seancesFiltered = computed(() => {
  return seances.value.filter(s => {
    if (filterClasse.value && String(s.classe_id) !== String(filterClasse.value)) return false
    if (filterIntervenant.value && String(s.intervenant_id) !== String(filterIntervenant.value)) return false
    if (s.statut === 'annule') return false
    const d = new Date(s.date_debut)
    const start = weekDays.value[0]!; const end = weekDays.value[4]!
    end.setHours(23, 59, 59)
    return d >= start && d <= end
  })
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

function fmtTime(dt: string) {
  const d = new Date(dt)
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

// Modale création/édition
const showModal = ref(false)
const editId = ref<number | null>(null)
const form = ref({
  classe_id: '',
  intervenant_id: '',
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
  const today = weekDays.value[0]!
  form.value = {
    classe_id: filterClasse.value,
    intervenant_id: filterIntervenant.value,
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
  showModal.value = true
}

function openEdit(s: Seance) {
  editId.value = s.id
  const debut = new Date(s.date_debut)
  const fin = new Date(s.date_fin)
  form.value = {
    classe_id: String(s.classe_id),
    intervenant_id: String(s.intervenant_id ?? ''),
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
  if (!form.value.intervenant_id || !form.value.date) return false
  const start = new Date(`${form.value.date}T${form.value.heure_debut}`)
  const end = new Date(`${form.value.date}T${form.value.heure_fin}`)
  return seances.value.some(s => {
    if (s.statut === 'annule') return false
    if (editId.value && s.id === editId.value) return false
    if (String(s.intervenant_id) !== form.value.intervenant_id) return false
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
      intervenant_id: form.value.intervenant_id ? Number(form.value.intervenant_id) : null,
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

async function load() {
  loading.value = true
  try {
    const [sRes, cRes, iRes, aRes, fRes] = await Promise.all([
      api.get('/seances'),
      api.get('/classes'),
      api.get('/intervenants'),
      api.get('/annees-academiques'),
      api.get('/filieres'),
    ])
    seances.value = sRes.data
    classes.value = cRes.data
    // Handle paginated intervenants (paginator has .data) or plain array
    const iRaw = iRes.data
    intervenants.value = Array.isArray(iRaw) ? iRaw : (iRaw.data ?? [])
    anneesAcademiques.value = aRes.data
    filieres.value = fRes.data
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

// Arrondi à 0.5h près pour affichage
function roundHalf(n: number): number { return Math.round(n * 2) / 2 }

// Intervenants filtrés sur la filière de la classe sélectionnée
const intervenantsForClasse = computed(() => {
  const fId = filiereIdForClasse(form.value.classe_id)
  if (!fId) return intervenants.value
  const filtered = intervenants.value.filter(i =>
    i.filieres?.some(f => f.filiere_id === fId)
  )
  return filtered.length > 0 ? filtered : intervenants.value
})

// Matières disponibles pour le formulaire avec volume horaire et filtrage
const matieresForForm = computed((): MatiereOption[] => {
  const fId = filiereIdForClasse(form.value.classe_id)
  if (!fId) return []

  const allMatieres = matieresOfFiliere(fId)

  let candidates: FiliereMatiere[]
  if (form.value.intervenant_id) {
    const interv = intervenants.value.find(i => String(i.id) === String(form.value.intervenant_id))
    const assignedNoms = [...new Set(
      (interv?.filieres ?? [])
        .filter(f => f.filiere_id === fId)
        .map(f => f.matiere)
        .filter(Boolean)
    )]
    if (assignedNoms.length > 0) {
      candidates = assignedNoms.map(nom =>
        allMatieres.find(m => m.nom === nom) ?? { id: 0, nom, code: nom }
      )
    } else {
      candidates = allMatieres
    }
  } else {
    candidates = allMatieres
  }

  return candidates
    .map((m): MatiereOption => {
      const volumeTotal = m.pivot?.credits ?? 0
      const planifiees = heuresPlanifiees(form.value.classe_id, m.nom)
      const restantes = volumeTotal > 0 ? Math.max(0, volumeTotal - planifiees) : 0
      const label = volumeTotal > 0
        ? `${m.nom}  (${roundHalf(restantes)}h restantes / ${volumeTotal}h)`
        : m.nom
      return { ...m, volumeTotal, heuresPlanifiees: planifiees, heuresRestantes: restantes, label }
    })
    .filter(m =>
      m.volumeTotal === 0 || m.heuresRestantes > 0
    )
})

// Info de la matière sélectionnée (pour afficher le résumé sous le select)
const selectedMatiereInfo = computed((): MatiereOption | null => {
  if (!form.value.matiere || !form.value.classe_id) return null
  return matieresForForm.value.find(m => m.nom === form.value.matiere) ?? null
})

function onClasseChange() {
  form.value.intervenant_id = ''
  form.value.matiere = ''
}

function onIntervenantChange() {
  form.value.matiere = ''
}

onMounted(load)
</script>

<template>
  <div class="uc-content">

    <UcPageHeader
      title="Emplois du temps"
      subtitle="Planning des séances de cours"
    >
      <template #actions>
        <button v-if="canWrite" @click="openCreate" class="uc-btn-primary">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Ajouter une séance
        </button>
      </template>
    </UcPageHeader>

    <!-- Toolbar -->
    <div class="edt-toolbar">
      <select v-model="filterClasse" class="edt-select">
        <option value="">Toutes les classes</option>
        <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
      </select>
      <select v-model="filterIntervenant" class="edt-select">
        <option value="">Tous les intervenants</option>
        <option v-for="i in intervenants" :key="i.id" :value="String(i.id)">
          {{ i.prenom }} {{ i.nom }}
        </option>
      </select>

      <!-- Navigation semaine -->
      <div class="edt-week-nav">
        <button @click="currentWeekOffset--" class="edt-nav-btn">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span class="edt-week-label">{{ weekLabel }}</span>
        <button @click="currentWeekOffset++" class="edt-nav-btn">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button @click="currentWeekOffset = 0" class="edt-today-btn">
          Aujourd'hui
        </button>
      </div>
    </div>

    <!-- Légende modes -->
    <div class="edt-legend">
      <div v-for="(label, key) in modeLabel" :key="key" class="edt-legend-item">
        <span class="edt-legend-dot"
          :style="{ backgroundColor: key === 'presentiel' ? '#22c55e' : key === 'en_ligne' ? '#3b82f6' : key === 'hybride' ? '#f97316' : '#E30613' }">
        </span>
        <span class="edt-legend-text">{{ label }}</span>
      </div>
    </div>

    <!-- Grille -->
    <div v-if="loading" class="edt-loading">Chargement…</div>
    <div v-else class="edt-grid-wrap">
      <!-- En-tête jours -->
      <div class="edt-grid-header">
        <div class="edt-time-col-header"></div>
        <div v-for="day in weekDays" :key="day.toISOString()" class="edt-day-header">
          <p class="edt-day-name">
            {{ day.toLocaleDateString('fr-FR', { weekday: 'short' }) }}
          </p>
          <p class="edt-day-num">{{ day.getDate() }}</p>
        </div>
      </div>

      <!-- Corps de la grille -->
      <div class="edt-grid-body">
        <!-- Colonne heures -->
        <div class="edt-time-col">
          <div v-for="h in timeSlots" :key="h" class="edt-time-slot">
            <span class="edt-time-label">{{ String(h).padStart(2, '0') }}h</span>
          </div>
        </div>

        <!-- Colonnes jours -->
        <div v-for="day in weekDays" :key="day.toISOString()" class="edt-day-col">
          <!-- Lignes horizontales -->
          <div v-for="h in timeSlots" :key="h" class="edt-hour-row"></div>

          <!-- Séances -->
          <div v-for="s in seancesForDay(day)" :key="s.id"
            class="edt-seance"
            :class="`edt-seance--${s.mode}`"
            :style="{
              top: `${(seanceGridRow(s) - 1) * 32}px`,
              height: `${seanceGridSpan(s) * 32 - 4}px`,
            }"
            @click="toggleDetail(s)">
            <p class="edt-seance-matiere">{{ s.matiere }}</p>
            <p class="edt-seance-time">{{ fmtTime(s.date_debut) }} – {{ fmtTime(s.date_fin) }}</p>
            <p v-if="s.intervenant" class="edt-seance-interv">{{ s.intervenant.prenom }} {{ s.intervenant.nom }}</p>
            <span class="edt-mode-badge" :class="`edt-mode-badge--${s.mode}`">
              {{ modeLabel[s.mode] }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Popup détail séance -->
    <Teleport to="body">
      <div v-if="selectedSeance" class="edt-overlay" @click.self="selectedSeance = null">
        <div class="edt-detail-popup">
          <div class="edt-detail-header">
            <div>
              <h3 class="edt-detail-title">{{ selectedSeance.matiere }}</h3>
              <span class="edt-mode-badge" :class="`edt-mode-badge--${selectedSeance.mode}`">
                {{ modeLabel[selectedSeance.mode] }}
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
              <dt class="edt-detail-label">Intervenant</dt>
              <dd class="edt-detail-value">{{ selectedSeance.intervenant ? `${selectedSeance.intervenant.prenom} ${selectedSeance.intervenant.nom}` : '—' }}</dd>
            </div>
            <div class="edt-detail-row">
              <dt class="edt-detail-label">Horaire</dt>
              <dd class="edt-detail-value">{{ fmtTime(selectedSeance.date_debut) }} – {{ fmtTime(selectedSeance.date_fin) }}</dd>
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
        Cet intervenant a déjà une séance sur ce créneau.
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

        <!-- Intervenant — filtré sur la filière de la classe -->
        <UcFormGroup label="Intervenant">
          <select v-model="form.intervenant_id" class="edt-select" @change="onIntervenantChange"
            :disabled="!form.classe_id"
            :style="!form.classe_id ? 'opacity:0.5;cursor:not-allowed;' : ''">
            <option value="">— Sans intervenant —</option>
            <option v-for="i in intervenantsForClasse" :key="i.id" :value="String(i.id)">
              {{ i.prenom }} {{ i.nom }}
            </option>
          </select>
        </UcFormGroup>
      </UcFormGrid>

      <!-- Matière — liste intelligente (filière + intervenant + heures restantes) -->
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

  </div>
</template>

<style scoped>
.uc-content { padding: 24px; max-width: 1280px; background: #f4f4f4; min-height: 100vh; font-family: 'Poppins', sans-serif; }

.edt-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; }
.edt-select { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: 'Poppins', sans-serif; background: #fff; color: #111; outline: none; }
.edt-select:focus { border-color: #E30613; box-shadow: 0 0 0 2px rgba(227,6,19,0.12); }

.edt-week-nav { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.edt-nav-btn { padding: 8px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; color: #374151; }
.edt-nav-btn:hover { background: #f3f4f6; }
.edt-week-label { font-size: 13px; font-weight: 600; color: #374151; min-width: 200px; text-align: center; }
.edt-today-btn { padding: 6px 12px; font-size: 12px; font-weight: 500; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; color: #374151; }
.edt-today-btn:hover { background: #f3f4f6; }

.edt-legend { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
.edt-legend-item { display: flex; align-items: center; gap: 6px; }
.edt-legend-dot { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
.edt-legend-text { font-size: 12px; color: #6b7280; }

.edt-loading { text-align: center; padding: 48px; color: #9ca3af; font-size: 14px; }

.edt-grid-wrap { background: #fff; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); overflow: hidden; }
.edt-grid-header { display: grid; grid-template-columns: 60px repeat(5, 1fr); border-bottom: 1px solid #e5e7eb; }
.edt-time-col-header { background: #f9fafb; }
.edt-day-header { padding: 12px; text-align: center; border-left: 1px solid #e5e7eb; background: #f9fafb; }
.edt-day-name { font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
.edt-day-num { font-size: 14px; font-weight: 700; color: #111111; margin: 2px 0 0; }

.edt-grid-body { display: grid; grid-template-columns: 60px repeat(5, 1fr); min-height: 600px; }
.edt-time-col { border-right: 1px solid #f3f4f6; }
.edt-time-slot { height: 64px; display: flex; align-items: flex-start; justify-content: flex-end; padding-right: 8px; padding-top: 4px; }
.edt-time-label { font-size: 11px; color: #9ca3af; }
.edt-day-col { position: relative; border-left: 1px solid #f3f4f6; }
.edt-hour-row { height: 64px; border-bottom: 1px dashed #f3f4f6; }

.edt-seance { position: absolute; left: 2px; right: 2px; border-radius: 5px; border-left: 4px solid; padding: 4px 6px; cursor: pointer; overflow: hidden; transition: filter 0.15s; }
.edt-seance:hover { filter: brightness(0.95); }
.edt-seance--presentiel { background: #f0fdf4; border-color: #22c55e; }
.edt-seance--en_ligne { background: #eff6ff; border-color: #3b82f6; }
.edt-seance--hybride { background: #fff7ed; border-color: #f97316; }
.edt-seance--exam { background: #fff1f2; border-color: #E30613; }

.edt-seance-matiere { font-size: 11px; font-weight: 700; color: #111; margin: 0 0 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.edt-seance-time { font-size: 10px; color: #4b5563; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.edt-seance-interv { font-size: 10px; color: #6b7280; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.edt-mode-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-top: 2px; }
.edt-mode-badge--presentiel { background: #dcfce7; color: #15803d; }
.edt-mode-badge--en_ligne { background: #dbeafe; color: #1d4ed8; }
.edt-mode-badge--hybride { background: #ffedd5; color: #c2410c; }
.edt-mode-badge--exam { background: #ffe4e6; color: #be123c; }

.edt-overlay { position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; }
.edt-detail-popup { background: #fff; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,0.12); width: 400px; max-width: 95vw; padding: 24px; }
.edt-detail-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; }
.edt-detail-title { font-size: 18px; font-weight: 700; color: #111; margin: 0 0 6px; }
.edt-close-btn { background: none; border: none; color: #9ca3af; cursor: pointer; padding: 2px; }
.edt-close-btn:hover { color: #374151; }
.edt-detail-list { display: flex; flex-direction: column; gap: 8px; margin: 0; }
.edt-detail-row { display: flex; gap: 8px; font-size: 13px; }
.edt-detail-label { color: #6b7280; width: 96px; flex-shrink: 0; }
.edt-detail-value { color: #111; font-weight: 500; }
.edt-link { color: #E30613; text-decoration: underline; font-size: 11px; word-break: break-all; }
.edt-detail-actions { display: flex; gap: 8px; margin-top: 20px; }
.edt-btn-edit { flex: 1; padding: 8px 12px; font-size: 13px; font-weight: 500; background: #f3f4f6; color: #374151; border: none; border-radius: 6px; cursor: pointer; }
.edt-btn-edit:hover { background: #e5e7eb; }
.edt-btn-cancel { flex: 1; padding: 8px 12px; font-size: 13px; font-weight: 500; background: #fff1f2; color: #E30613; border: none; border-radius: 6px; cursor: pointer; }
.edt-btn-cancel:hover { background: #ffe4e6; }

.edt-alert-warning { display: flex; align-items: flex-start; gap: 8px; padding: 12px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; font-size: 13px; color: #92400e; margin-bottom: 16px; }
.edt-alert-error { padding: 12px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 6px; font-size: 13px; color: #be123c; margin-bottom: 16px; }

.edt-input { padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-family: 'Poppins', sans-serif; outline: none; width: 100%; box-sizing: border-box; }
.edt-input:focus { border-color: #E30613; box-shadow: 0 0 0 2px rgba(227,6,19,0.12); }
.edt-textarea { resize: none; }

/* Volume horaire */
.edt-vol-bar { margin-top: 8px; }
.edt-vol-bar-track { height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
.edt-vol-bar-fill { height: 100%; background: linear-gradient(90deg, #22c55e, #16a34a); border-radius: 999px; transition: width 0.4s ease; }
.edt-vol-stats { display: flex; align-items: center; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
.edt-vol-stat { font-size: 11px; font-weight: 500; }
.edt-vol-stat--done { color: #16a34a; }
.edt-vol-stat--total { color: #6b7280; }
.edt-vol-stat--rest { color: #E30613; font-weight: 700; }

.edt-btn-secondary { flex: 1; padding: 8px 16px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px; font-weight: 500; color: #374151; background: #fff; cursor: pointer; }
.edt-btn-secondary:hover { background: #f9fafb; }

.uc-btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px; background: #E30613; color: #fff; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'Poppins', sans-serif; transition: background 0.15s; }
.uc-btn-primary:hover { background: #c0050f; }
.uc-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 768px) {
  .edt-grid-header { overflow-x: auto; min-width: 0; grid-template-columns: 48px repeat(5, minmax(90px, 1fr)); }
  .edt-grid-body { overflow-x: auto; min-width: 0; grid-template-columns: 48px repeat(5, minmax(90px, 1fr)); }
  .edt-card { overflow-x: auto; }
}
</style>
