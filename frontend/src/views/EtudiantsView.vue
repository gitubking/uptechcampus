<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))

// ── Interfaces ────────────────────────────────────────────────────────
interface InscriptionActive {
  id: number
  statut: string
  acces_bloque: boolean
  frais_inscription: number
  mensualite: number
  frais_tenue: number
  contrat_path: string | null
  filiere: { id: number; nom: string; code: string } | null
  niveau_entree: { id: number; nom: string } | null
  niveau_bourse: { id: number; nom: string; pourcentage: number } | null
  classe: { id: number; nom: string } | null
}

interface Etudiant {
  id: number
  numero_etudiant: string
  nom: string
  prenom: string
  email: string
  telephone: string | null
  photo_path: string | null
  inscription_active: InscriptionActive | null
}

interface Pagination {
  data: Etudiant[]
  current_page: number
  last_page: number
  total: number
}

interface TypeFormation { id: number; nom: string; code: string }
interface Filiere {
  id: number; nom: string; code: string
  type_formation_id: number | null
  frais_inscription: number; mensualite: number; duree_mois: number | null
}
interface NiveauEntree { id: number; nom: string; code: string; est_superieur_bac: boolean; actif: boolean }
interface NiveauBourse { id: number; nom: string; pourcentage: number; applique_inscription: boolean; actif: boolean }
interface AnneeAcademique { id: number; libelle: string; actif: boolean }

// ── Liste étudiants ──────────────────────────────────────────────────
const pagination = ref<Pagination>({ data: [], current_page: 1, last_page: 1, total: 0 })
const loading = ref(false)
const search = ref('')
const page = ref(1)

async function fetchEtudiants() {
  loading.value = true
  try {
    const { data } = await api.get('/etudiants', {
      params: { search: search.value || undefined, page: page.value },
    })
    pagination.value = data
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout>
watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; fetchEtudiants() }, 350)
})
watch(page, fetchEtudiants)

// ── Statuts ───────────────────────────────────────────────────────────
const statutLabel: Record<string, string> = {
  inscrit_actif: 'Actif', pre_inscrit: 'Pré-inscrit', en_examen: 'En examen',
  diplome: 'Diplômé', abandonne: 'Abandonné', suspendu: 'Suspendu',
}
const statutClass: Record<string, string> = {
  inscrit_actif: 'bg-green-100 text-green-700',
  pre_inscrit: 'bg-amber-100 text-amber-700',
  en_examen: 'bg-blue-100 text-blue-700',
  diplome: 'bg-purple-100 text-purple-700',
  abandonne: 'bg-red-100 text-red-700',
  suspendu: 'bg-orange-100 text-orange-700',
}

// ── Données refs (formulaires) ────────────────────────────────────────
const filieres = ref<Filiere[]>([])
const niveauxEntree = ref<NiveauEntree[]>([])
const niveauxBourse = ref<NiveauBourse[]>([])
const annees = ref<AnneeAcademique[]>([])
const typesFormation = ref<TypeFormation[]>([])
const refsLoaded = ref(false)

async function loadRefs() {
  if (refsLoaded.value) return
  const [f, ne, nb, a, t] = await Promise.all([
    api.get('/filieres'),
    api.get('/niveaux-entree'),
    api.get('/niveaux-bourse'),
    api.get('/annees-academiques'),
    api.get('/types-formation'),
  ])
  filieres.value = f.data
  niveauxEntree.value = (ne.data ?? []).filter((n: NiveauEntree) => n.actif)
  niveauxBourse.value = (nb.data ?? []).filter((b: NiveauBourse) => b.actif)
  annees.value = a.data
  typesFormation.value = t.data
  refsLoaded.value = true
}

// ── Panel (slide-over) ────────────────────────────────────────────────
type PanelMode = 'inscrire' | 'edit-etudiant' | 'gerer-inscription'
const showPanel = ref(false)
const panelMode = ref<PanelMode>('inscrire')
const panelLoading = ref(false)
const panelError = ref('')

// ── Formulaire étudiant ───────────────────────────────────────────────
const editingEtudiantId = ref<number | null>(null)
const studentForm = ref({
  prenom: '', nom: '', email: '', telephone: '',
  date_naissance: '', lieu_naissance: '', adresse: '', cni_numero: '',
  nom_parent: '', telephone_parent: '',
})

// ── Formulaire inscription ────────────────────────────────────────────
const selectedType = ref<number | null>(null)
const selectedFiliereObj = ref<Filiere | null>(null)
const inscriptionForm = ref({
  filiere_id: null as number | null,
  niveau_entree_id: null as number | null,
  niveau_bourse_id: null as number | null,
  annee_academique_id: null as number | null,
  frais_tenue: 0,
  statut: 'inscrit_actif',
})

const filteredFilieres = computed(() =>
  selectedType.value
    ? filieres.value.filter(f => f.type_formation_id === selectedType.value)
    : filieres.value
)
const fraisInscriptionPrevu = computed(() => {
  if (!selectedFiliereObj.value) return null
  let frais = selectedFiliereObj.value.frais_inscription
  const b = niveauxBourse.value.find(b => b.id === inscriptionForm.value.niveau_bourse_id)
  if (b?.applique_inscription) frais = frais * (1 - b.pourcentage / 100)
  return frais
})
const mensualitePrevu = computed(() => {
  if (!selectedFiliereObj.value) return null
  let m = selectedFiliereObj.value.mensualite
  const b = niveauxBourse.value.find(b => b.id === inscriptionForm.value.niveau_bourse_id)
  if (b) m = m * (1 - b.pourcentage / 100)
  return m
})
const selectedBourse = computed(() =>
  niveauxBourse.value.find(b => b.id === inscriptionForm.value.niveau_bourse_id) ?? null
)

function onTypeChange() {
  inscriptionForm.value.filiere_id = null
  selectedFiliereObj.value = null
}
function onFiliereChange() {
  selectedFiliereObj.value = filieres.value.find(f => f.id === inscriptionForm.value.filiere_id) ?? null
}

// ── Gestion inscription existante ─────────────────────────────────────
const currentEtudiant = ref<Etudiant | null>(null)
const currentInscription = ref<InscriptionActive | null>(null)
const updatingStatut = ref(false)
const uploadingContrat = ref(false)
const editingInscription = ref(false)
const savingInscription = ref(false)
const inscriptionEditType = ref<number | null>(null)
const inscriptionEditForm = ref({
  filiere_id: null as number | null,
  niveau_entree_id: null as number | null,
  niveau_bourse_id: null as number | null,
  frais_tenue: 0,
})
const filteredFilieresForEdit = computed(() =>
  inscriptionEditType.value
    ? filieres.value.filter(f => f.type_formation_id === inscriptionEditType.value)
    : filieres.value
)

// ── Ouverture des panels ──────────────────────────────────────────────
async function openInscrire() {
  panelMode.value = 'inscrire'
  panelError.value = ''
  editingEtudiantId.value = null
  studentForm.value = { prenom: '', nom: '', email: '', telephone: '', date_naissance: '', lieu_naissance: '', adresse: '', cni_numero: '', nom_parent: '', telephone_parent: '' }
  selectedType.value = null
  selectedFiliereObj.value = null
  const anneeActive = annees.value.find(a => a.actif)
  inscriptionForm.value = {
    filiere_id: null, niveau_entree_id: null, niveau_bourse_id: null,
    annee_academique_id: anneeActive?.id ?? annees.value[0]?.id ?? null,
    frais_tenue: 0, statut: 'inscrit_actif',
  }
  await loadRefs()
  showPanel.value = true
}

function openEditEtudiant(etudiant: Etudiant) {
  panelMode.value = 'edit-etudiant'
  panelError.value = ''
  editingEtudiantId.value = etudiant.id
  studentForm.value = {
    prenom: etudiant.prenom, nom: etudiant.nom, email: etudiant.email,
    telephone: etudiant.telephone ?? '', date_naissance: '', lieu_naissance: '', adresse: '', cni_numero: '',
    nom_parent: '', telephone_parent: '',
  }
  showPanel.value = true
}

async function openGererInscription(etudiant: Etudiant) {
  panelMode.value = 'gerer-inscription'
  panelError.value = ''
  currentEtudiant.value = etudiant
  currentInscription.value = null
  showPanel.value = true
  // Charger l'inscription complète
  try {
    const { data } = await api.get('/inscriptions', { params: { etudiant_id: etudiant.id, per_page: 1 } })
    const list = data.data ?? data
    currentInscription.value = list[0] ?? null
  } catch {
    panelError.value = 'Impossible de charger l\'inscription.'
  }
}

// ── Submit ────────────────────────────────────────────────────────────
async function submitInscrire() {
  panelError.value = ''
  panelLoading.value = true
  try {
    // 1. Créer l'étudiant
    const studentPayload = Object.fromEntries(
      Object.entries(studentForm.value).filter(([, v]) => v !== '')
    )
    const { data: etudiant } = await api.post('/etudiants', studentPayload)

    // 2. Créer l'inscription
    await api.post('/inscriptions', {
      etudiant_id: etudiant.id,
      filiere_id: inscriptionForm.value.filiere_id,
      niveau_entree_id: inscriptionForm.value.niveau_entree_id,
      niveau_bourse_id: inscriptionForm.value.niveau_bourse_id || null,
      annee_academique_id: inscriptionForm.value.annee_academique_id,
      frais_tenue: inscriptionForm.value.frais_tenue || 0,
      statut: inscriptionForm.value.statut,
    })

    showPanel.value = false
    fetchEtudiants()
  } catch (err: any) {
    const errs = err.response?.data?.errors as Record<string, string[]> | undefined
    panelError.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? err.response?.data?.message ?? 'Une erreur est survenue.'
  } finally {
    panelLoading.value = false
  }
}

async function submitEditEtudiant() {
  if (!editingEtudiantId.value) return
  panelError.value = ''
  panelLoading.value = true
  try {
    const payload = Object.fromEntries(
      Object.entries(studentForm.value).filter(([, v]) => v !== '')
    )
    await api.put(`/etudiants/${editingEtudiantId.value}`, payload)
    showPanel.value = false
    fetchEtudiants()
  } catch (err: any) {
    const errs = err.response?.data?.errors as Record<string, string[]> | undefined
    panelError.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? err.response?.data?.message ?? 'Une erreur est survenue.'
  } finally {
    panelLoading.value = false
  }
}

async function changerStatut(statut: string) {
  if (!currentInscription.value) return
  updatingStatut.value = true
  try {
    await api.put(`/inscriptions/${currentInscription.value.id}/statut`, { statut })
    currentInscription.value.statut = statut
    fetchEtudiants()
  } catch (err: any) {
    panelError.value = err.response?.data?.message ?? 'Erreur lors du changement de statut.'
  } finally {
    updatingStatut.value = false
  }
}

async function validerInscription() {
  if (!currentInscription.value) return
  if (!confirm('Confirmer la validation du dossier ? Un compte étudiant sera activé.')) return
  updatingStatut.value = true
  try {
    await api.post(`/inscriptions/${currentInscription.value.id}/valider`)
    currentInscription.value.statut = 'inscrit_actif'
    fetchEtudiants()
  } catch (err: any) {
    panelError.value = err.response?.data?.message ?? 'Erreur lors de la validation.'
  } finally {
    updatingStatut.value = false
  }
}

async function onUploadContrat(event: Event) {
  if (!currentInscription.value) return
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploadingContrat.value = true
  try {
    const fd = new FormData()
    fd.append('contrat', file)
    await api.post(`/inscriptions/${currentInscription.value.id}/contrat`, fd)
    currentInscription.value.statut = 'en_examen'
    currentInscription.value.contrat_path = 'uploaded'
    fetchEtudiants()
  } catch (err: any) {
    panelError.value = err.response?.data?.message ?? 'Erreur lors de l\'upload.'
  } finally {
    uploadingContrat.value = false
    ;(event.target as HTMLInputElement).value = ''
  }
}

function openEditInscription() {
  if (!currentInscription.value) return
  const insc = currentInscription.value
  // Trouver le type de formation depuis la filière
  const f = filieres.value.find(f => f.id === insc.filiere?.id)
  inscriptionEditType.value = f?.type_formation_id ?? null
  inscriptionEditForm.value = {
    filiere_id: insc.filiere?.id ?? null,
    niveau_entree_id: insc.niveau_entree?.id ?? null,
    niveau_bourse_id: insc.niveau_bourse?.id ?? null,
    frais_tenue: insc.frais_tenue ?? 0,
  }
  editingInscription.value = true
}

async function submitEditInscription() {
  if (!currentInscription.value) return
  savingInscription.value = true
  panelError.value = ''
  try {
    const { data } = await api.put(`/inscriptions/${currentInscription.value.id}`, inscriptionEditForm.value)
    currentInscription.value = {
      ...currentInscription.value,
      filiere: data.filiere,
      niveau_entree: data.niveau_entree,
      niveau_bourse: data.niveau_bourse,
      frais_inscription: data.frais_inscription,
      mensualite: data.mensualite,
    }
    editingInscription.value = false
    fetchEtudiants()
  } catch (err: any) {
    const errs = err.response?.data?.errors as Record<string, string[]> | undefined
    panelError.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? err.response?.data?.message ?? 'Erreur lors de la modification.'
  } finally {
    savingInscription.value = false
  }
}

function formatAmount(n: number | null) {
  if (n == null) return '—'
  return new Intl.NumberFormat('fr-FR').format(n) + ' FCFA'
}

const avatarColors = ['#E30613','#3b82f6','#7c3aed','#f97316','#0891b2','#be185d','#15803d','#92400e','#1d4ed8']
function avatarColor(prenom: string, nom: string): string {
  const idx = ((prenom.charCodeAt(0) ?? 0) + (nom.charCodeAt(0) ?? 0)) % avatarColors.length
  return avatarColors[idx] ?? '#E30613'
}

function statutBadgeClass(statut: string): string {
  const map: Record<string, string> = {
    inscrit_actif: 'uc-badge-active',
    pre_inscrit: 'uc-badge-preinsc',
    en_examen: 'uc-badge-examen',
    diplome: 'uc-badge-diplome',
    abandonne: 'uc-badge-abandon',
    suspendu: 'uc-badge-suspend',
  }
  return map[statut] ?? 'uc-badge-gray'
}

function statutDotClass(statut: string): string {
  const map: Record<string, string> = {
    inscrit_actif: 'dot-green',
    pre_inscrit: 'dot-blue',
    en_examen: 'dot-yellow',
    diplome: 'dot-purple',
    abandonne: 'dot-gray',
    suspendu: 'dot-red',
  }
  return map[statut] ?? 'dot-gray'
}

onMounted(() => {
  fetchEtudiants()
  loadRefs()
})
</script>

<template>
  <div class="uc-content">

    <!-- En-tête -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div>
        <h1 style="font-size:16px;font-weight:700;color:#111;">Étudiants</h1>
        <p style="font-size:11.5px;color:#888;margin-top:2px;">{{ pagination.total }} étudiant{{ pagination.total !== 1 ? 's' : '' }} au total</p>
      </div>
      <button v-if="canWrite" @click="openInscrire" class="uc-btn-primary" style="display:flex;align-items:center;gap:6px;padding:9px 16px;font-size:12.5px;">
        <span style="font-size:16px;line-height:1;">+</span> Nouvel étudiant
      </button>
    </div>

    <!-- Toolbar : Recherche -->
    <div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;">
      <div style="position:relative;flex:1;min-width:200px;">
        <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#bbb;font-size:14px;">🔍</span>
        <input v-model="search" type="text" placeholder="Rechercher par nom, prénom ou N° étudiant…" class="uc-search-input" />
      </div>
    </div>

    <!-- Tableau -->
    <div class="uc-table-wrap">
      <table class="uc-table">
        <thead>
          <tr>
            <th>N° Étudiant</th>
            <th>Étudiant</th>
            <th>Filière / Parcours</th>
            <th>Statut</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="5" style="padding:32px;text-align:center;color:#aaa;font-size:12px;">
              Chargement…
            </td>
          </tr>
          <tr v-else-if="pagination.data.length === 0">
            <td colspan="5" style="padding:32px;text-align:center;color:#aaa;font-size:12px;">
              Aucun étudiant trouvé
              <span v-if="search" style="display:block;font-size:11px;margin-top:4px;">Essayez d'autres termes de recherche</span>
            </td>
          </tr>
          <tr v-else v-for="etudiant in pagination.data" :key="etudiant.id"
            @click="router.push(`/etudiants/${etudiant.id}`)">
            <td class="td-num">{{ etudiant.numero_etudiant }}</td>
            <td>
              <div class="student-name">
                <div class="s-avatar" :style="{ background: avatarColor(etudiant.prenom, etudiant.nom) }">
                  {{ (etudiant.prenom[0] ?? '') + (etudiant.nom[0] ?? '') }}
                </div>
                <div class="s-name">
                  <strong>{{ etudiant.prenom }} {{ etudiant.nom }}</strong>
                  <span>{{ etudiant.email }}</span>
                </div>
              </div>
            </td>
            <td>
              <span v-if="etudiant.inscription_active?.filiere">
                {{ etudiant.inscription_active.filiere.nom }}<br>
                <span style="font-size:10.5px;color:#aaa;">{{ etudiant.inscription_active.filiere.code }}</span>
              </span>
              <span v-else style="color:#aaa;">—</span>
            </td>
            <td>
              <span v-if="etudiant.inscription_active" class="uc-badge" :class="statutBadgeClass(etudiant.inscription_active.statut)">
                <span class="badge-dot" :class="statutDotClass(etudiant.inscription_active.statut)"></span>
                {{ statutLabel[etudiant.inscription_active.statut] ?? etudiant.inscription_active.statut }}
              </span>
              <span v-else class="uc-badge uc-badge-gray">Non inscrit</span>
            </td>
            <td @click.stop>
              <div class="row-actions">
                <button v-if="canWrite" @click="openEditEtudiant(etudiant)" class="row-btn" title="Modifier">Modifier</button>
                <button v-if="canWrite && etudiant.inscription_active" @click="openGererInscription(etudiant)" class="row-btn" title="Gérer inscription">Inscription</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="pagination.last_page > 1" class="uc-pagination">
        <span class="uc-pagination-info">Page {{ pagination.current_page }} / {{ pagination.last_page }} — {{ pagination.total }} étudiants</span>
        <div class="uc-pagination-btns">
          <button :disabled="page <= 1" @click="page--" class="page-btn" :class="{ disabled: page <= 1 }">←</button>
          <button class="page-btn active">{{ page }}</button>
          <button :disabled="page >= pagination.last_page" @click="page++" class="page-btn" :class="{ disabled: page >= pagination.last_page }">→</button>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════
         SLIDE-OVER PANEL
         ═══════════════════════════════════════════════════════════ -->
    <Teleport to="body">
      <Transition name="overlay">
        <div v-if="showPanel" class="fixed inset-0 z-40 flex justify-end">
          <div class="absolute inset-0 bg-black/40" @click="showPanel = false" />
          <Transition name="panel">
            <div class="relative z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col h-full">

              <!-- Header Panel -->
              <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f0f0f0;position:sticky;top:0;background:#fff;z-index:1;">
                <h2 style="font-size:15px;font-weight:700;color:#111;">
                  <span v-if="panelMode === 'inscrire'">Inscrire un étudiant</span>
                  <span v-else-if="panelMode === 'edit-etudiant'">Modifier l'étudiant</span>
                  <span v-else>Gérer l'inscription — {{ currentEtudiant?.prenom }} {{ currentEtudiant?.nom }}</span>
                </h2>
                <button @click="showPanel = false" class="modal-close">✕</button>
              </div>

              <!-- Body Panel -->
              <div class="flex-1 overflow-y-auto" style="padding:22px;">
                <div v-if="panelError" style="margin-bottom:16px;padding:10px 14px;background:#fff0f0;border-left:3px solid #E30613;border-radius:4px;font-size:12.5px;color:#b91c1c;">
                  {{ panelError }}
                </div>

                <!-- ── MODE INSCRIRE ─────────────────────────────── -->
                <form v-if="panelMode === 'inscrire'" id="panel-form" @submit.prevent="submitInscrire">

                  <!-- Section étudiant -->
                  <div class="form-section-label">Informations personnelles</div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Prénom <span style="color:#E30613">*</span></label>
                      <input v-model="studentForm.prenom" required type="text" />
                    </div>
                    <div class="form-group">
                      <label>Nom <span style="color:#E30613">*</span></label>
                      <input v-model="studentForm.nom" required type="text" />
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Email <span style="color:#E30613">*</span></label>
                      <input v-model="studentForm.email" required type="email" />
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Téléphone</label>
                      <input v-model="studentForm.telephone" type="tel" />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Date de naissance</label>
                      <input v-model="studentForm.date_naissance" type="date" />
                    </div>
                    <div class="form-group">
                      <label>Lieu de naissance</label>
                      <input v-model="studentForm.lieu_naissance" type="text" />
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Adresse</label>
                      <textarea v-model="studentForm.adresse" rows="2" style="resize:none;"></textarea>
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>N° CNI</label>
                      <input v-model="studentForm.cni_numero" type="text" />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Nom du parent</label>
                      <input v-model="studentForm.nom_parent" type="text" placeholder="Nom complet" />
                    </div>
                    <div class="form-group">
                      <label>Tél. parent</label>
                      <input v-model="studentForm.telephone_parent" type="tel" placeholder="+221 77..." />
                    </div>
                  </div>

                  <!-- Section inscription -->
                  <div class="form-section-label" style="margin-top:8px;">Inscription</div>

                  <!-- Statut -->
                  <div class="form-row full" style="margin-bottom:12px;">
                    <div style="display:flex;gap:10px;">
                      <label class="radio-card" :class="{ active: inscriptionForm.statut === 'inscrit_actif' }">
                        <input type="radio" v-model="inscriptionForm.statut" value="inscrit_actif" style="display:none;" />
                        <div style="font-size:12px;font-weight:600;color:#111;">Inscrit actif</div>
                        <div style="font-size:10.5px;color:#888;">Dossier validé</div>
                      </label>
                      <label class="radio-card" :class="{ active: inscriptionForm.statut === 'pre_inscrit', orange: true }">
                        <input type="radio" v-model="inscriptionForm.statut" value="pre_inscrit" style="display:none;" />
                        <div style="font-size:12px;font-weight:600;color:#111;">Pré-inscrit</div>
                        <div style="font-size:10.5px;color:#888;">En attente</div>
                      </label>
                    </div>
                  </div>

                  <div class="form-row full">
                    <div class="form-group">
                      <label>Type de formation</label>
                      <select v-model="selectedType" @change="onTypeChange">
                        <option :value="null">— Tous les types —</option>
                        <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }} ({{ t.code }})</option>
                      </select>
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Filière <span style="color:#E30613">*</span></label>
                      <select v-model="inscriptionForm.filiere_id" @change="onFiliereChange" required>
                        <option :value="null">— Sélectionner une filière —</option>
                        <option v-for="f in filteredFilieres" :key="f.id" :value="f.id">{{ f.nom }} ({{ f.code }})</option>
                      </select>
                      <div v-if="selectedFiliereObj" style="margin-top:6px;padding:8px 10px;background:#fff5f5;border-radius:4px;font-size:11px;color:#E30613;display:flex;gap:12px;">
                        <span>Insc. : <strong>{{ new Intl.NumberFormat('fr-FR').format(selectedFiliereObj.frais_inscription) }} F</strong></span>
                        <span>Mens. : <strong>{{ new Intl.NumberFormat('fr-FR').format(selectedFiliereObj.mensualite) }} F</strong></span>
                        <span v-if="selectedFiliereObj.duree_mois">Durée : <strong>{{ selectedFiliereObj.duree_mois }} mois</strong></span>
                      </div>
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Niveau d'entrée <span style="color:#E30613">*</span></label>
                      <select v-model="inscriptionForm.niveau_entree_id" required>
                        <option :value="null">— Sélectionner un niveau —</option>
                        <option v-for="n in niveauxEntree" :key="n.id" :value="n.id">{{ n.nom }} — {{ n.est_superieur_bac ? 'Crédits ECTS' : 'Coefficients' }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Bourse</label>
                      <select v-model="inscriptionForm.niveau_bourse_id">
                        <option :value="null">— Aucune bourse —</option>
                        <option v-for="b in niveauxBourse" :key="b.id" :value="b.id">{{ b.nom }} ({{ b.pourcentage }}%)</option>
                      </select>
                      <div v-if="selectedBourse && selectedFiliereObj" style="margin-top:6px;padding:8px 10px;background:#f0fdf4;border-radius:4px;font-size:11px;color:#15803d;">
                        <p>Mensualité après bourse : <strong>{{ formatAmount(mensualitePrevu) }}</strong></p>
                        <p v-if="selectedBourse.applique_inscription">Frais inscription après bourse : <strong>{{ formatAmount(fraisInscriptionPrevu) }}</strong></p>
                      </div>
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Année académique <span style="color:#E30613">*</span></label>
                      <select v-model="inscriptionForm.annee_academique_id" required>
                        <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}{{ a.actif ? ' (en cours)' : '' }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Frais de tenue (FCFA)</label>
                      <input v-model.number="inscriptionForm.frais_tenue" type="number" min="0" placeholder="0" />
                    </div>
                  </div>

                  <!-- Résumé financier -->
                  <div v-if="selectedFiliereObj" style="background:#f9f9f9;border-radius:4px;padding:12px;margin-top:4px;margin-bottom:14px;">
                    <p style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Résumé financier</p>
                    <div class="fin-row"><span>Frais d'inscription</span><span>{{ formatAmount(fraisInscriptionPrevu) }}</span></div>
                    <div class="fin-row"><span>Mensualité</span><span>{{ formatAmount(mensualitePrevu) }}</span></div>
                    <div v-if="inscriptionForm.frais_tenue > 0" class="fin-row"><span>Tenue</span><span>{{ formatAmount(inscriptionForm.frais_tenue) }}</span></div>
                  </div>
                </form>

                <!-- ── MODE EDIT ÉTUDIANT ────────────────────────── -->
                <form v-else-if="panelMode === 'edit-etudiant'" id="panel-form" @submit.prevent="submitEditEtudiant">
                  <div class="form-section-label">Informations personnelles</div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Prénom <span style="color:#E30613">*</span></label>
                      <input v-model="studentForm.prenom" required type="text" />
                    </div>
                    <div class="form-group">
                      <label>Nom <span style="color:#E30613">*</span></label>
                      <input v-model="studentForm.nom" required type="text" />
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Email <span style="color:#E30613">*</span></label>
                      <input v-model="studentForm.email" required type="email" />
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Téléphone</label>
                      <input v-model="studentForm.telephone" type="tel" />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Date de naissance</label>
                      <input v-model="studentForm.date_naissance" type="date" />
                    </div>
                    <div class="form-group">
                      <label>Lieu de naissance</label>
                      <input v-model="studentForm.lieu_naissance" type="text" />
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>Adresse</label>
                      <textarea v-model="studentForm.adresse" rows="2" style="resize:none;"></textarea>
                    </div>
                  </div>
                  <div class="form-row full">
                    <div class="form-group">
                      <label>N° CNI</label>
                      <input v-model="studentForm.cni_numero" type="text" />
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group">
                      <label>Nom du parent</label>
                      <input v-model="studentForm.nom_parent" type="text" placeholder="Nom complet" />
                    </div>
                    <div class="form-group">
                      <label>Tél. parent</label>
                      <input v-model="studentForm.telephone_parent" type="tel" placeholder="+221 77..." />
                    </div>
                  </div>
                </form>

                <!-- ── MODE GÉRER INSCRIPTION ───────────────────── -->
                <div v-else-if="panelMode === 'gerer-inscription'">
                  <div v-if="!currentInscription" style="padding:32px;text-align:center;color:#aaa;font-size:12px;">Chargement…</div>
                  <div v-else>

                    <!-- Infos inscription — lecture -->
                    <div v-if="!editingInscription" style="background:#f9f9f9;border-radius:4px;padding:14px;margin-bottom:16px;">
                      <div class="info-row"><span class="info-label">Filière</span><span class="info-value">{{ currentInscription.filiere?.nom ?? '—' }}</span></div>
                      <div class="info-row"><span class="info-label">Niveau d'entrée</span><span class="info-value">{{ currentInscription.niveau_entree?.nom ?? '—' }}</span></div>
                      <div class="info-row"><span class="info-label">Bourse</span><span class="info-value">{{ currentInscription.niveau_bourse?.nom ?? 'Aucune' }}</span></div>
                      <div class="info-row"><span class="info-label">Classe</span><span class="info-value">{{ currentInscription.classe?.nom ?? 'Pool' }}</span></div>
                      <div class="info-row" style="border-top:1px solid #e5e5e5;padding-top:8px;margin-top:4px;"><span class="info-label">Frais inscription</span><span class="info-value">{{ formatAmount(currentInscription.frais_inscription) }}</span></div>
                      <div class="info-row"><span class="info-label">Mensualité</span><span class="info-value">{{ formatAmount(currentInscription.mensualite) }}</span></div>
                      <div v-if="currentInscription.frais_tenue > 0" class="info-row"><span class="info-label">Frais de tenue</span><span class="info-value">{{ formatAmount(currentInscription.frais_tenue) }}</span></div>
                      <div v-if="canWrite" style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e5e5;">
                        <button @click="openEditInscription" style="width:100%;padding:9px;background:#fff;border:1.5px solid #e5e5e5;border-radius:4px;font-size:12px;font-weight:600;color:#555;cursor:pointer;font-family:'Poppins',sans-serif;transition:all 0.15s;"
                          onmouseover="this.style.borderColor='#E30613';this.style.color='#E30613'"
                          onmouseout="this.style.borderColor='#e5e5e5';this.style.color='#555'">
                          ✏️ Modifier les paramètres d'inscription
                        </button>
                      </div>
                    </div>

                    <!-- Formulaire d'édition inscription -->
                    <div v-else style="background:#fff5f5;border-radius:4px;padding:14px;margin-bottom:16px;border:1px solid #fecaca;">
                      <p style="font-size:10.5px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;">Modifier l'inscription</p>
                      <div class="form-row full">
                        <div class="form-group">
                          <label>Type de formation</label>
                          <select v-model="inscriptionEditType" @change="inscriptionEditForm.filiere_id = null">
                            <option :value="null">— Tous les types —</option>
                            <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }}</option>
                          </select>
                        </div>
                      </div>
                      <div class="form-row full">
                        <div class="form-group">
                          <label>Filière <span style="color:#E30613">*</span></label>
                          <select v-model="inscriptionEditForm.filiere_id">
                            <option :value="null" disabled>— Choisir —</option>
                            <option v-for="f in filteredFilieresForEdit" :key="f.id" :value="f.id">{{ f.nom }}</option>
                          </select>
                        </div>
                      </div>
                      <div class="form-row full">
                        <div class="form-group">
                          <label>Niveau d'entrée <span style="color:#E30613">*</span></label>
                          <select v-model="inscriptionEditForm.niveau_entree_id">
                            <option :value="null" disabled>— Choisir —</option>
                            <option v-for="n in niveauxEntree" :key="n.id" :value="n.id">{{ n.nom }}</option>
                          </select>
                        </div>
                      </div>
                      <div class="form-row full">
                        <div class="form-group">
                          <label>Bourse</label>
                          <select v-model="inscriptionEditForm.niveau_bourse_id">
                            <option :value="null">Aucune bourse</option>
                            <option v-for="b in niveauxBourse" :key="b.id" :value="b.id">{{ b.nom }}</option>
                          </select>
                        </div>
                      </div>
                      <div class="form-row full">
                        <div class="form-group">
                          <label>Frais de tenue (FCFA)</label>
                          <input v-model.number="inscriptionEditForm.frais_tenue" type="number" min="0" placeholder="0" />
                        </div>
                      </div>
                      <div style="display:flex;gap:8px;margin-top:4px;">
                        <button @click="editingInscription = false" class="btn-ghost" style="flex:1;">Annuler</button>
                        <button @click="submitEditInscription" :disabled="savingInscription || !inscriptionEditForm.filiere_id || !inscriptionEditForm.niveau_entree_id"
                          class="uc-btn-primary" style="flex:1;padding:10px;font-size:12.5px;opacity:1;"
                          :style="{ opacity: (savingInscription || !inscriptionEditForm.filiere_id || !inscriptionEditForm.niveau_entree_id) ? '0.5' : '1' }">
                          {{ savingInscription ? 'Enregistrement…' : 'Enregistrer' }}
                        </button>
                      </div>
                    </div>

                    <!-- Statut actuel -->
                    <div style="margin-bottom:14px;">
                      <p style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Statut actuel</p>
                      <span class="uc-badge" :class="statutBadgeClass(currentInscription.statut)">
                        <span class="badge-dot" :class="statutDotClass(currentInscription.statut)"></span>
                        {{ statutLabel[currentInscription.statut] ?? currentInscription.statut }}
                      </span>
                      <span v-if="currentInscription.acces_bloque" style="margin-left:8px;font-size:11px;font-weight:600;color:#E30613;">🔒 Accès bloqué</span>
                    </div>

                    <!-- Actions selon statut -->
                    <div v-if="canWrite" style="display:flex;flex-direction:column;gap:8px;">
                      <!-- pre_inscrit → activer -->
                      <template v-if="currentInscription.statut === 'pre_inscrit'">
                        <button @click="changerStatut('inscrit_actif')" :disabled="updatingStatut" class="action-btn action-btn-green">
                          {{ updatingStatut ? 'En cours…' : '✓ Activer l\'inscription' }}
                        </button>
                        <label class="action-btn action-btn-ghost" style="cursor:pointer;">
                          {{ uploadingContrat ? 'Upload…' : '↑ Téléverser le contrat signé (PDF)' }}
                          <input type="file" accept=".pdf" class="hidden" :disabled="uploadingContrat" @change="onUploadContrat" />
                        </label>
                      </template>

                      <!-- en_examen → valider -->
                      <button v-else-if="currentInscription.statut === 'en_examen'" @click="validerInscription" :disabled="updatingStatut" class="action-btn action-btn-green">
                        {{ updatingStatut ? 'Validation…' : '✓ Valider le dossier' }}
                      </button>

                      <!-- inscrit_actif / suspendu / abandonne → changer statut -->
                      <div v-else-if="['inscrit_actif', 'suspendu', 'abandonne'].includes(currentInscription.statut)" class="form-group">
                        <label>Changer le statut</label>
                        <select :value="currentInscription.statut" :disabled="updatingStatut"
                          @change="changerStatut(($event.target as HTMLSelectElement).value)">
                          <option value="inscrit_actif">Actif</option>
                          <option value="suspendu">Suspendu</option>
                          <option value="abandonne">Abandonné</option>
                          <option value="diplome">Diplômé</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Footer Panel -->
              <div style="padding:14px 22px;border-top:1px solid #f0f0f0;display:flex;gap:10px;justify-content:flex-end;background:#fff;position:sticky;bottom:0;">
                <button @click="showPanel = false" class="btn-ghost">
                  {{ panelMode === 'gerer-inscription' ? 'Fermer' : 'Annuler' }}
                </button>
                <button v-if="panelMode !== 'gerer-inscription'"
                  type="submit" form="panel-form" :disabled="panelLoading"
                  class="uc-btn-primary" style="padding:10px 20px;font-size:13px;"
                  :style="{ opacity: panelLoading ? '0.6' : '1' }">
                  {{ panelLoading ? 'Enregistrement…' : (panelMode === 'inscrire' ? 'Créer & Inscrire' : 'Enregistrer') }}
                </button>
              </div>

            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
/* Transitions panel */
.overlay-enter-active, .overlay-leave-active { transition: opacity 0.2s; }
.overlay-enter-from, .overlay-leave-to { opacity: 0; }
.panel-enter-active, .panel-leave-active { transition: transform 0.25s ease; }
.panel-enter-from, .panel-leave-to { transform: translateX(100%); }

/* Search input */
.uc-search-input {
  width: 100%;
  border: 1.5px solid #e5e5e5;
  border-radius: 4px;
  padding: 9px 12px 9px 35px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  color: #111;
  outline: none;
  background: #fff;
  transition: border-color 0.2s;
}
.uc-search-input:focus { border-color: #E30613; }
.uc-search-input::placeholder { color: #ccc; }

/* Table */
.uc-table-wrap {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  overflow: hidden;
}
.uc-table { width: 100%; border-collapse: collapse; }
.uc-table thead tr { background: #f9f9f9; border-bottom: 2px solid #f0f0f0; }
.uc-table thead th {
  padding: 11px 14px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  color: #555;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  white-space: nowrap;
}
.uc-table tbody tr {
  border-bottom: 1px solid #f5f5f5;
  transition: background 0.12s;
  cursor: pointer;
}
.uc-table tbody tr:last-child { border-bottom: none; }
.uc-table tbody tr:hover { background: #fafafa; }
.uc-table tbody td {
  padding: 11px 14px;
  font-size: 12.5px;
  color: #222;
  vertical-align: middle;
}
.td-num { font-size: 11px; font-weight: 600; color: #888; font-family: monospace; }

/* Student avatar */
.student-name { display: flex; align-items: center; gap: 9px; }
.s-avatar {
  width: 30px; height: 30px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  color: #fff; flex-shrink: 0;
  text-transform: uppercase;
}
.s-name strong { display: block; font-size: 12.5px; font-weight: 600; color: #111; }
.s-name span { font-size: 10.5px; color: #aaa; }

/* Row actions */
.row-actions { display: flex; gap: 6px; opacity: 0; transition: opacity 0.15s; }
.uc-table tbody tr:hover .row-actions { opacity: 1; }
.row-btn {
  border: 1px solid #e5e5e5;
  background: #fff;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  color: #555;
  cursor: pointer;
  transition: all 0.15s;
  font-family: 'Poppins', sans-serif;
}
.row-btn:hover { border-color: #E30613; color: #E30613; }

/* Badges */
.uc-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 20px;
  font-size: 10.5px; font-weight: 600; white-space: nowrap;
}
.uc-badge-active { background: #f0fdf4; color: #15803d; }
.uc-badge-preinsc { background: #eff6ff; color: #1d4ed8; }
.uc-badge-suspend { background: #fff0f0; color: #b91c1c; }
.uc-badge-abandon { background: #f5f5f5; color: #888; }
.uc-badge-diplome { background: #fdf4ff; color: #7e22ce; }
.uc-badge-examen { background: #fefce8; color: #854d0e; }
.uc-badge-gray { background: #f5f5f5; color: #888; }

.badge-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.dot-green { background: #22c55e; }
.dot-blue { background: #3b82f6; }
.dot-red { background: #E30613; }
.dot-gray { background: #aaa; }
.dot-purple { background: #a855f7; }
.dot-yellow { background: #eab308; }

/* Pagination */
.uc-pagination {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; border-top: 1px solid #f0f0f0; background: #fafafa;
}
.uc-pagination-info { font-size: 11.5px; color: #888; }
.uc-pagination-btns { display: flex; gap: 4px; }
.page-btn {
  border: 1px solid #e5e5e5; background: #fff; border-radius: 4px;
  width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; color: #555; cursor: pointer; transition: all 0.15s;
  font-family: 'Poppins', sans-serif;
}
.page-btn:hover:not(.disabled) { border-color: #E30613; color: #E30613; }
.page-btn.active { background: #E30613; border-color: #E30613; color: #fff; }
.page-btn.disabled { opacity: 0.3; cursor: not-allowed; }

/* Modal close */
.modal-close {
  background: #f4f4f4; border: none; border-radius: 4px;
  width: 30px; height: 30px; cursor: pointer; font-size: 14px; color: #888;
  transition: all 0.15s; font-family: 'Poppins', sans-serif;
  display: flex; align-items: center; justify-content: center;
}
.modal-close:hover { background: #fff0f0; color: #E30613; }

/* Forms inside panel */
.form-section-label {
  font-size: 10px; font-weight: 700; color: #888;
  text-transform: uppercase; letter-spacing: 0.5px;
  padding: 0 0 8px; margin-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
  margin-top: 4px;
}
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.form-row.full { grid-template-columns: 1fr; }
.form-group label {
  display: block; font-size: 11px; font-weight: 600; color: #333;
  text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 5px;
}
.form-group input,
.form-group select,
.form-group textarea {
  width: 100%; border: 1.5px solid #e5e5e5; border-radius: 4px;
  padding: 9px 11px; font-family: 'Poppins', sans-serif; font-size: 12.5px;
  color: #111; outline: none; background: #fafafa; transition: border-color 0.2s;
}
.form-group input:focus,
.form-group select:focus,
.form-group textarea:focus { border-color: #E30613; background: #fff; }

/* Radio cards */
.radio-card {
  flex: 1; padding: 10px; border: 1.5px solid #e5e5e5; border-radius: 4px;
  cursor: pointer; transition: all 0.15s;
}
.radio-card.active { border-color: #22c55e; background: #f0fdf4; }
.radio-card.active.orange { border-color: #f59e0b; background: #fffbeb; }

/* Info rows (gestion inscription) */
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; }
.info-label { font-size: 11.5px; color: #888; font-weight: 500; }
.info-value { font-size: 12px; color: #111; font-weight: 600; }

/* Fin rows */
.fin-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
.fin-row span:first-child { color: #888; }
.fin-row span:last-child { font-weight: 700; color: #111; }

/* Action buttons */
.action-btn {
  width: 100%; padding: 10px; border-radius: 4px; font-family: 'Poppins', sans-serif;
  font-size: 12.5px; font-weight: 600; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  border: none;
}
.action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.action-btn-green { background: #22c55e; color: #fff; }
.action-btn-green:hover:not(:disabled) { background: #16a34a; }
.action-btn-ghost { background: #fff; color: #555; border: 1.5px solid #e5e5e5; }
.action-btn-ghost:hover:not(:disabled) { border-color: #111; color: #111; }

/* Footer ghost btn */
.btn-ghost {
  border: 1.5px solid #e5e5e5; background: #fff; border-radius: 4px;
  padding: 10px 20px; font-family: 'Poppins', sans-serif;
  font-size: 13px; font-weight: 600; color: #555; cursor: pointer; transition: all 0.15s;
}
.btn-ghost:hover { border-color: #111; color: #111; }
</style>
