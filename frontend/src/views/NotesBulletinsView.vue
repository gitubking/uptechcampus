<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcFormGrid from '@/components/ui/UcFormGrid.vue'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import UcTable from '@/components/ui/UcTable.vue'

const auth = useAuthStore()
const isEnseignant = computed(() => auth.user?.role === 'enseignant')
const canWrite = computed(() =>
  ['dg', 'dir_peda', 'coordinateur', 'enseignant'].includes(auth.user?.role ?? '')
)
// Profil enseignant connecté (ses UEs et ses classes)
const monProfil = ref<{ id: number; mes_ues: {id:number;classe_id:number;code:string;intitule:string}[]; mes_classes: {id:number;nom:string}[] } | null>(null)
// IDs des UEs dont le prof connecté peut saisir les notes (Number() pour éviter string vs number)
const mesUeIds = computed(() => monProfil.value?.mes_ues.map(u => Number(u.id)) ?? [])

interface UE {
  id: number; classe_id: number; enseignant_id: number | null; matiere_id?: number | null
  code: string; intitule: string; coefficient: number; credits_ects: number; ordre: number
  is_tronc_commun?: boolean
  enseignant?: { id: number; nom: string; prenom: string }
}
interface Bulletin {
  inscription: any; ues: any[]
  ues_tronc_commun?: any[]; ues_specifiques?: any[]
  moyenne: number | null; mention: string | null
  decision: string; credits_valides: number; credits_total: number
  has_tronc_commun?: boolean
}
interface Inscription {
  id: number
  filiere_id?: number | null
  filiere?: { id: number; nom: string } | null
  etudiant: { nom: string; prenom: string }
}
interface Note { id?: number; inscription_id: number; ue_id: number; note: number; session: string }

const activeTab = ref<'saisie' | 'jury' | 'bulletins'>('saisie')

const classes = ref<{ id: number; nom: string }[]>([])
const ues = ref<UE[]>([])
const uesTronc = computed(() => ues.value.filter(u => u.is_tronc_commun))
const uesSpecifiques = computed(() => ues.value.filter(u => !u.is_tronc_commun))
const hasTroncCommun = computed(() => uesTronc.value.length > 0)
const inscriptions = ref<Inscription[]>([])
const notesData = ref<Note[]>([])
// filiere_id → { matiere_id → { coefficient, credits } } — reçu de l'API pour calculs cross-filière
const filierePivots = ref<Record<number, Record<number, { coefficient: number; credits: number }>>>({})
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)

const filterClasse = ref('')
const filterSession = ref<'normale' | 'rattrapage'>('normale')

// Grille notes [inscription_id][ue_id] = valeur
const localNotes = ref<Record<number, Record<number, string>>>({})

// Retourne le coefficient effectif d'une UE pour un étudiant donné (cross-filière tronc commun)
function getCoef(ue: UE, inscriptionId: number): number {
  if (ue.is_tronc_commun && ue.matiere_id) {
    const insc = inscriptions.value.find(i => i.id === inscriptionId)
    const fId = insc?.filiere_id ?? insc?.filiere?.id
    const pivot = fId ? filierePivots.value[fId]?.[ue.matiere_id] : undefined
    if (pivot) {
      return pivot.coefficient
    }
  }
  return parseFloat(String(ue.coefficient)) || 1
}

// Moyenne pondérée pour un étudiant (coefficient cross-filière si tronc commun)
function moyennePonderee(inscriptionId: number): number | null {
  let totalPts = 0, totalCoef = 0
  let hasNote = false
  for (const ue of ues.value) {
    const v = localNotes.value[inscriptionId]?.[ue.id]
    if (v !== '' && v !== undefined && v !== null) {
      const n = parseFloat(v)
      const coef = getCoef(ue, inscriptionId)
      if (!isNaN(n)) { totalPts += n * coef; totalCoef += coef; hasNote = true }
    }
  }
  return hasNote && totalCoef > 0 ? Math.round(totalPts / totalCoef * 100) / 100 : null
}

function mention(moy: number | null): string {
  if (moy === null) return '—'
  if (moy >= 16) return 'Très Bien'
  if (moy >= 14) return 'Bien'
  if (moy >= 12) return 'Assez Bien'
  if (moy >= 10) return 'Passable'
  return '—'
}

function decisionClass(moy: number | null) {
  if (moy === null) return 'bg-gray-100 text-gray-600'
  if (moy >= 10) return 'bg-green-100 text-green-700'
  if (moy >= 8) return 'bg-orange-100 text-orange-700'
  return 'bg-red-100 text-red-700'
}
function decisionLabel(moy: number | null) {
  if (moy === null) return 'En attente'
  if (moy >= 10) return 'Admis'
  if (moy >= 8) return 'Rattrapage'
  return 'Redoublant'
}

function inputColor(v: string) {
  const n = parseFloat(v)
  if (isNaN(n) || v === '') return ''
  if (n < 10) return 'text-red-600'
  if (n < 14) return 'text-orange-500'
  return 'text-green-700'
}

async function loadNotes() {
  if (!filterClasse.value) return
  loading.value = true
  try {
    const { data } = await api.get('/notes', {
      params: { classe_id: filterClasse.value, session: filterSession.value }
    })
    ues.value = data.ues
    inscriptions.value = data.inscriptions
    notesData.value = data.notes
    filierePivots.value = data.filiere_pivots ?? {}

    // Initialiser localNotes
    localNotes.value = {}
    inscriptions.value.forEach(i => {
      const noteMap: Record<number, string> = {}
      ues.value.forEach(ue => { noteMap[ue.id] = '' })
      localNotes.value[i.id] = noteMap
    })
    notesData.value.forEach((n: Note) => {
      const noteMap = localNotes.value[n.inscription_id]
      if (noteMap) noteMap[n.ue_id] = String(n.note)
    })
  } finally {
    loading.value = false
  }
}

watch([filterClasse, filterSession], loadNotes)

async function enregistrerNotes() {
  saving.value = true
  saved.value = false
  try {
    const payload: Note[] = []
    inscriptions.value.forEach(i => {
      ues.value.forEach(ue => {
        const v = localNotes.value[i.id]?.[ue.id]
        if (v !== '' && v !== undefined) {
          const n = parseFloat(v)
          if (!isNaN(n)) {
            payload.push({ inscription_id: i.id, ue_id: ue.id, note: n, session: filterSession.value })
          }
        }
      })
    })
    if (payload.length) await api.post('/notes/batch', { notes: payload })
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } finally {
    saving.value = false
  }
}

// ─── UE CRUD ──────────────────────────────────────────────────────────
const showUeModal = ref(false)
const editUeId = ref<number | null>(null)
const ueForm = ref({ code: '', intitule: '', coefficient: '1', credits_ects: '0', ordre: '0', enseignant_id: '' })
const enseignants = ref<{ id: number; nom: string; prenom: string }[]>([])
const savingUe = ref(false)

async function openUeCreate() {
  editUeId.value = null
  ueForm.value = { code: '', intitule: '', coefficient: '1', credits_ects: '0', ordre: String(ues.value.length), enseignant_id: '' }
  showUeModal.value = true
}
async function openUeEdit(ue: UE) {
  editUeId.value = ue.id
  ueForm.value = { code: ue.code, intitule: ue.intitule, coefficient: String(ue.coefficient), credits_ects: String(ue.credits_ects), ordre: String(ue.ordre), enseignant_id: String(ue.enseignant_id ?? '') }
  showUeModal.value = true
}
async function saveUe() {
  savingUe.value = true
  try {
    const payload = {
      classe_id: Number(filterClasse.value),
      code: ueForm.value.code, intitule: ueForm.value.intitule,
      coefficient: parseFloat(ueForm.value.coefficient),
      credits_ects: parseInt(ueForm.value.credits_ects),
      ordre: parseInt(ueForm.value.ordre),
      enseignant_id: ueForm.value.enseignant_id ? Number(ueForm.value.enseignant_id) : null,
    }
    if (editUeId.value) await api.put(`/ues/${editUeId.value}`, payload)
    else await api.post('/ues', payload)
    showUeModal.value = false
    await loadNotes()
  } finally { savingUe.value = false }
}
async function deleteUe(ue: UE) {
  if (!confirm(`Supprimer l'UE "${ue.intitule}" ?`)) return
  await api.delete(`/ues/${ue.id}`)
  await loadNotes()
}

// ─── BULLETIN ─────────────────────────────────────────────────────────
const showBulletin = ref(false)
const bulletin = ref<Bulletin | null>(null)
const loadingBulletin = ref(false)

async function voirBulletin(insc: Inscription) {
  loadingBulletin.value = true
  showBulletin.value = true
  try {
    const { data } = await api.get(`/notes/bulletin/${insc.id}`)
    bulletin.value = data
  } finally { loadingBulletin.value = false }
}

function mentionColor(m: string | null) {
  const map: Record<string, string> = { 'Très Bien': 'text-green-600', 'Bien': 'text-green-500', 'Assez Bien': 'text-blue-500', 'Passable': 'text-orange-500' }
  return m ? (map[m] ?? 'text-gray-700') : 'text-gray-400'
}

async function load() {
  loading.value = true
  try {
    if (isEnseignant.value) {
      // Prof : charger uniquement son profil et ses classes
      const { data } = await api.get('/enseignants/me')
      monProfil.value = data
      classes.value = data.mes_classes ?? []
      // Pré-sélectionner la première classe si une seule
      if (classes.value.length === 1 && classes.value[0]) {
        filterClasse.value = String(classes.value[0].id)
        await loadNotes()
      }
    } else {
      // Admin : charger toutes les classes + enseignants
      const [cRes, iRes] = await Promise.all([api.get('/classes'), api.get('/enseignants')])
      classes.value = cRes.data
      enseignants.value = iRes.data
    }
  } finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <div class="uc-content">

    <UcPageHeader
      title="Notes & Bulletins"
      :subtitle="isEnseignant ? `Saisie des notes — ${monProfil?.mes_ues.length ?? 0} matière(s) assignée(s)` : 'Saisie des notes, jury et édition des bulletins'"
    />

    <!-- Bandeau info pour le prof -->
    <div v-if="isEnseignant && monProfil" class="nb-prof-banner">
      <span>👨‍🏫 Vous êtes connecté en tant qu'enseignant.</span>
      <span>Vous pouvez saisir les notes uniquement pour vos matières :
        <strong>{{ monProfil.mes_ues.map(u => u.code).join(', ') || '—' }}</strong>
      </span>
      <span style="color:#aaa;">Les cellules 🔒 appartiennent à d'autres enseignants.</span>
    </div>

    <!-- Sélecteurs + tabs -->
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
      <select v-model="filterClasse" class="nb-select">
        <option value="">Sélectionner une classe…</option>
        <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
      </select>
      <select v-model="filterSession" class="nb-select">
        <option value="normale">Session normale</option>
        <option value="rattrapage">Session rattrapage</option>
      </select>
      <button v-if="canWrite && filterClasse" @click="openUeCreate" class="nb-btn-ues">⚙ Gérer les UEs</button>
    </div>

    <!-- Tabs -->
    <div class="nb-tabs">
      <button v-for="tab in ['saisie', 'jury', 'bulletins']" :key="tab"
        @click="activeTab = tab as any"
        class="nb-tab" :class="activeTab === tab ? 'nb-tab--active' : ''">
        {{ tab === 'saisie' ? 'Saisie des notes' : tab === 'jury' ? 'Jury' : 'Bulletins' }}
      </button>
    </div>

    <div v-if="!filterClasse" class="nb-empty-state">
      Sélectionnez une classe pour accéder aux notes.
    </div>

    <!-- TAB SAISIE -->
    <div v-else-if="activeTab === 'saisie'">
      <div v-if="loading" class="nb-loading">Chargement…</div>
      <div v-else class="nb-table-wrap">
        <div class="nb-table-toolbar">
          <span style="font-size:12px;color:#555;">{{ inscriptions.length }} étudiant(s) · {{ ues.length }} UE(s)</span>
          <div style="display:flex;align-items:center;gap:10px;margin-left:auto;">
            <span v-if="saved" style="font-size:12px;color:#16a34a;font-weight:600;">✓ Enregistré</span>
            <button v-if="canWrite" @click="enregistrerNotes" :disabled="saving" class="nb-btn-save-notes">
              {{ saving ? 'Enregistrement…' : 'Enregistrer tout' }}
            </button>
          </div>
        </div>
        <div v-if="!ues.length" class="nb-loading">
          Aucune UE configurée.
          <button v-if="canWrite" @click="openUeCreate" style="color:#E30613;text-decoration:underline;background:none;border:none;cursor:pointer;font-family:'Poppins',sans-serif;margin-left:8px;">Créer des UEs →</button>
        </div>
        <div v-else-if="!inscriptions.length" class="nb-loading">Aucun étudiant inscrit dans cette classe.</div>
        <div v-else style="overflow-x:auto;">
          <table class="nb-table nb-table--saisie">
            <thead>
              <tr v-if="hasTroncCommun">
                <th class="nb-col-sticky nb-col-sticky--head" style="background:#f9f9f9;border:none;"></th>
                <th :colspan="uesTronc.length" style="text-align:center;background:#eff6ff;color:#1d4ed8;font-size:11px;padding:5px 8px;border-bottom:2px solid #bfdbfe;">
                  🏫 Tronc Commun ({{ uesTronc.length }} UE{{ uesTronc.length>1?'s':'' }})
                </th>
                <th :colspan="uesSpecifiques.length" style="text-align:center;background:#f0fdf4;color:#15803d;font-size:11px;padding:5px 8px;border-bottom:2px solid #86efac;">
                  📚 Matières Spécifiques ({{ uesSpecifiques.length }} UE{{ uesSpecifiques.length>1?'s':'' }})
                </th>
                <th style="background:#fff;border:none;"></th>
              </tr>
              <tr>
                <th class="nb-col-sticky nb-col-sticky--head" style="text-align:left;min-width:160px;">Étudiant</th>
                <th v-for="ue in ues" :key="ue.id"
                  :style="{ textAlign:'center', minWidth:'100px', background: ue.is_tronc_commun ? '#f0f9ff' : '#f0fdf4' }">
                  <div style="line-height:1.4;">
                    <span style="font-weight:700;color:#333;">{{ ue.code }}</span><br>
                    <span style="font-weight:400;text-transform:none;font-size:10px;color:#888;">{{ ue.intitule }}</span><br>
                    <span v-if="ue.is_tronc_commun && ue.matiere_id" style="color:#7c3aed;font-size:10px;" title="Coefficient selon la filière de chaque étudiant">Coef. ⚡ filière</span>
                    <span v-else style="color:#E30613;font-size:10px;">Coef. {{ ue.coefficient }}</span>
                  </div>
                </th>
                <th style="text-align:center;">Moyenne</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="insc in inscriptions" :key="insc.id">
                <td class="nb-col-sticky" style="font-weight:600;color:#333;white-space:nowrap;background:#fff;">
                  {{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}
                  <span v-if="(insc as any).classe" style="display:block;font-size:10px;color:#aaa;font-weight:400;">{{ (insc as any).classe?.nom }}</span>
                </td>
                <td v-for="ue in ues" :key="ue.id" style="padding:8px;"
                  :style="{ background: ue.is_tronc_commun ? '#f8fbff' : '#f9fff9' }">
                  <!-- Prof ne peut saisir que pour ses UEs -->
                  <input v-model="localNotes[insc.id]![ue.id]"
                    type="number" min="0" max="20" step="0.25"
                    :disabled="!canWrite || (isEnseignant && !mesUeIds.includes(ue.id))"
                    :placeholder="(isEnseignant && !mesUeIds.includes(ue.id)) ? '🔒' : '—'"
                    class="nb-note-input"
                    :class="{ 'nb-note-locked': isEnseignant && !mesUeIds.includes(ue.id) }"
                    :style="{ borderColor: localNotes[insc.id]?.[ue.id] && parseFloat(localNotes[insc.id]![ue.id]!) >= 10 ? '#22c55e' : localNotes[insc.id]?.[ue.id] && parseFloat(localNotes[insc.id]![ue.id]!) < 10 ? '#E30613' : '#e5e5e5' }"
                  />
                </td>
                <td style="text-align:center;font-weight:700;" :style="{ color: (moyennePonderee(insc.id) ?? 0) >= 10 ? '#16a34a' : '#E30613' }">
                  {{ moyennePonderee(insc.id)?.toFixed(2) ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB JURY -->
    <div v-else-if="activeTab === 'jury'">
      <div v-if="loading" class="nb-loading">Chargement…</div>
      <div v-else-if="!inscriptions.length" class="nb-empty-state">Aucun étudiant inscrit dans cette classe.</div>
      <div v-else class="nb-table-wrap">
        <div class="nb-table-toolbar">
          <span style="font-size:12px;color:#555;font-weight:600;">Récapitulatif jury — Session {{ filterSession }}</span>
        </div>
        <UcTable
          :cols="[
            { key: 'etudiant', label: 'Étudiant' },
            { key: 'moyenne', label: 'Moyenne', align: 'center' },
            { key: 'mention', label: 'Mention', align: 'center' },
            { key: 'credits', label: 'Crédits ECTS', align: 'center' },
            { key: 'decision', label: 'Décision', align: 'center' },
          ]"
          :data="inscriptions"
        >
          <template #row="{ item: insc }">
            <td style="font-weight:600;color:#333;">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</td>
            <td style="text-align:center;">
              <span style="font-size:16px;font-weight:800;" :style="{ color: (moyennePonderee(insc.id) ?? 0) >= 10 ? '#16a34a' : '#ea580c' }">
                {{ moyennePonderee(insc.id)?.toFixed(2) ?? '—' }}
              </span>
              <span style="font-size:10px;color:#aaa;">/20</span>
            </td>
            <td style="text-align:center;font-weight:600;" :class="mentionColor(mention(moyennePonderee(insc.id)))">
              {{ mention(moyennePonderee(insc.id)) }}
            </td>
            <td style="text-align:center;color:#555;font-size:13px;">
              <span v-if="moyennePonderee(insc.id) !== null">
                {{ ues.filter(ue => {
                  const v = localNotes[insc.id]?.[ue.id]
                  return v !== '' && !isNaN(parseFloat(v ?? '')) && parseFloat(v ?? '') >= 10
                }).reduce((s, ue) => s + ue.credits_ects, 0) }}/{{ ues.reduce((s, ue) => s + ue.credits_ects, 0) }}
              </span>
              <span v-else style="color:#ccc;">—</span>
            </td>
            <td style="text-align:center;">
              <span class="nb-decision-badge" :class="decisionClass(moyennePonderee(insc.id))">
                {{ decisionLabel(moyennePonderee(insc.id)) }}
              </span>
            </td>
          </template>
        </UcTable>
      </div>
    </div>

    <!-- TAB BULLETINS -->
    <div v-else-if="activeTab === 'bulletins'">
      <div v-if="loading" class="nb-loading">Chargement…</div>
      <div v-else-if="!inscriptions.length" class="nb-empty-state">Aucun étudiant inscrit dans cette classe.</div>
      <div v-else class="nb-table-wrap">
        <UcTable
          :cols="[
            { key: 'etudiant', label: 'Étudiant' },
            { key: 'moyenne', label: 'Moyenne', align: 'center' },
            { key: 'decision', label: 'Décision', align: 'center' },
            { key: 'actions', label: 'Actions', align: 'center' },
          ]"
          :data="inscriptions"
        >
          <template #row="{ item: insc }">
            <td style="font-weight:600;color:#333;">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</td>
            <td style="text-align:center;font-weight:800;" :style="{ color: (moyennePonderee(insc.id) ?? 0) >= 10 ? '#16a34a' : '#ea580c' }">
              {{ moyennePonderee(insc.id)?.toFixed(2) ?? '—' }}
            </td>
            <td style="text-align:center;">
              <span class="nb-decision-badge" :class="decisionClass(moyennePonderee(insc.id))">
                {{ decisionLabel(moyennePonderee(insc.id)) }}
              </span>
            </td>
            <td style="text-align:center;">
              <button @click="voirBulletin(insc)" class="nb-btn-bulletin">📄 Voir bulletin</button>
            </td>
          </template>
        </UcTable>
      </div>
    </div>

    <!-- Modal UE CRUD -->
    <UcModal
      v-model="showUeModal"
      :title="editUeId ? 'Modifier l\'UE' : 'Gérer les UEs'"
      width="480px"
      @close="showUeModal = false"
    >
      <!-- UEs existantes -->
      <div v-if="!editUeId && ues.length" style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #f0f0f0;">
        <p style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:8px;">UEs de la classe</p>
        <div style="max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">
          <div v-for="ue in ues" :key="ue.id" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:#f9f9f9;border-radius:4px;">
            <span style="font-size:12px;color:#333;"><strong>{{ ue.code }}</strong> — {{ ue.intitule }} <span style="color:#aaa;">(coef. {{ ue.coefficient }})</span></span>
            <div style="display:flex;gap:4px;">
              <button @click="openUeEdit(ue)" style="background:none;border:none;cursor:pointer;color:#aaa;font-size:13px;padding:2px 5px;">✏️</button>
              <button @click="deleteUe(ue)" style="background:none;border:none;cursor:pointer;color:#aaa;font-size:13px;padding:2px 5px;">🗑</button>
            </div>
          </div>
        </div>
        <hr style="margin:12px 0;">
        <p style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:8px;">Ajouter une UE</p>
      </div>

      <UcFormGrid :cols="2">
        <UcFormGroup label="Code" :required="true">
          <input v-model="ueForm.code" type="text" placeholder="UE-INFO-01" class="nb-input" style="width:100%;box-sizing:border-box;" />
        </UcFormGroup>
        <UcFormGroup label="Coefficient" :required="true">
          <input v-model="ueForm.coefficient" type="number" min="0" step="0.5" class="nb-input" style="width:100%;box-sizing:border-box;" />
        </UcFormGroup>
      </UcFormGrid>
      <UcFormGroup label="Intitulé" :required="true" style="margin-top:12px;">
        <input v-model="ueForm.intitule" type="text" placeholder="Ex : Algorithmique…" class="nb-input" style="width:100%;box-sizing:border-box;" />
      </UcFormGroup>
      <UcFormGrid :cols="2" style="margin-top:12px;">
        <UcFormGroup label="Crédits ECTS">
          <input v-model="ueForm.credits_ects" type="number" min="0" class="nb-input" style="width:100%;box-sizing:border-box;" />
        </UcFormGroup>
        <UcFormGroup label="Ordre affichage">
          <input v-model="ueForm.ordre" type="number" min="0" class="nb-input" style="width:100%;box-sizing:border-box;" />
        </UcFormGroup>
      </UcFormGrid>
      <UcFormGroup label="Enseignant" style="margin-top:12px;">
        <select v-model="ueForm.enseignant_id" class="nb-input" style="width:100%;box-sizing:border-box;">
          <option value="">— Sans enseignant —</option>
          <option v-for="i in enseignants" :key="i.id" :value="String(i.id)">{{ i.prenom }} {{ i.nom }}</option>
        </select>
      </UcFormGroup>

      <template #footer>
        <button @click="showUeModal = false" class="nb-btn-cancel">Fermer</button>
        <button @click="saveUe" :disabled="savingUe || !ueForm.code || !ueForm.intitule" class="nb-btn-save">
          {{ savingUe ? 'Enregistrement…' : (editUeId ? 'Modifier' : 'Ajouter') }}
        </button>
      </template>
    </UcModal>

    <!-- Modal Bulletin -->
    <UcModal
      v-model="showBulletin"
      title="Bulletin de notes"
      width="640px"
      @close="showBulletin = false"
    >
      <div v-if="loadingBulletin" class="nb-loading">Chargement…</div>
      <div v-else-if="bulletin" style="overflow-y:auto;">
        <!-- En-tête bulletin -->
        <div style="text-align:center;margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #f0f0f0;">
          <p style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.1em;">Uptech Campus</p>
          <h3 style="font-size:18px;font-weight:800;color:#111;margin:6px 0 0;">
            {{ bulletin.inscription.etudiant?.prenom }} {{ bulletin.inscription.etudiant?.nom }}
          </h3>
          <p style="font-size:12px;color:#888;margin:4px 0 0;">
            {{ bulletin.inscription.classe?.filiere?.nom ?? '—' }} · {{ bulletin.inscription.annee_academique?.libelle ?? '—' }}
          </p>
          <div style="display:flex;justify-content:center;gap:32px;margin-top:16px;">
            <div style="text-align:center;">
              <p style="font-size:28px;font-weight:800;margin:0;" :style="{ color: (bulletin.moyenne ?? 0) >= 10 ? '#16a34a' : '#E30613' }">{{ bulletin.moyenne?.toFixed(2) ?? '—' }}</p>
              <p style="font-size:10px;color:#aaa;margin:2px 0 0;">Moyenne générale</p>
            </div>
            <div style="text-align:center;">
              <p style="font-size:18px;font-weight:700;margin:0;" :class="mentionColor(bulletin.mention)">{{ bulletin.mention ?? '—' }}</p>
              <p style="font-size:10px;color:#aaa;margin:2px 0 0;">Mention</p>
            </div>
            <div style="text-align:center;">
              <p style="font-size:18px;font-weight:700;color:#E30613;margin:0;">{{ bulletin.credits_valides }}/{{ bulletin.credits_total }}</p>
              <p style="font-size:10px;color:#aaa;margin:2px 0 0;">Crédits ECTS</p>
            </div>
          </div>
        </div>
        <!-- Tableau UEs — Tronc commun -->
        <template v-if="bulletin.has_tronc_commun && bulletin.ues_tronc_commun?.length">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#1d4ed8;margin:0 0 6px;display:flex;align-items:center;gap:6px;">
            <span style="background:#eff6ff;border:1px solid #bfdbfe;padding:2px 8px;border-radius:6px;">🏫 Tronc Commun</span>
          </div>
          <table class="nb-table" style="margin-bottom:12px;">
            <thead><tr style="background:#f0f9ff;"><th>UE</th><th>Intitulé</th><th>Enseignant</th><th style="text-align:center;">Coef.</th><th style="text-align:center;">Note</th><th style="text-align:center;">Points</th><th style="text-align:center;">Crédits</th></tr></thead>
            <tbody>
              <tr v-for="ue in bulletin.ues_tronc_commun" :key="ue.id" style="background:#f8fbff;">
                <td style="font-family:monospace;font-size:11px;color:#1d4ed8;">{{ ue.code }}</td>
                <td style="color:#333;font-weight:600;">{{ ue.intitule }}</td>
                <td style="font-size:12px;color:#64748b;">{{ ue.enseignant ? `${ue.enseignant.prenom} ${ue.enseignant.nom}` : '—' }}</td>
                <td style="text-align:center;color:#555;">{{ ue.coefficient }}</td>
                <td style="text-align:center;font-weight:800;" :style="{ color: ue.note !== null ? (ue.note >= 10 ? '#16a34a' : '#E30613') : '#ccc' }">{{ ue.note !== null ? ue.note : '—' }}</td>
                <td style="text-align:center;color:#555;">{{ ue.points ?? '—' }}</td>
                <td style="text-align:center;">
                  <span v-if="ue.note !== null" style="padding:2px 6px;border-radius:4px;font-size:10.5px;font-weight:600;" :style="{ background: ue.valide ? '#f0fdf4' : '#fff0f0', color: ue.valide ? '#16a34a' : '#E30613' }">
                    {{ ue.valide ? `✓ ${ue.credits_ects}` : `✗ ${ue.credits_ects}` }}
                  </span>
                  <span v-else style="color:#ccc;">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#15803d;margin:0 0 6px;display:flex;align-items:center;gap:6px;">
            <span style="background:#f0fdf4;border:1px solid #86efac;padding:2px 8px;border-radius:6px;">📚 Matières Spécifiques</span>
          </div>
        </template>
        <!-- Tableau UEs — Spécifiques (ou toutes si pas de tronc commun) -->
        <table class="nb-table" style="margin-bottom:16px;">
          <thead><tr><th>UE</th><th>Intitulé</th><th>Enseignant</th><th style="text-align:center;">Coef.</th><th style="text-align:center;">Note</th><th style="text-align:center;">Points</th><th style="text-align:center;">Crédits</th></tr></thead>
          <tbody>
            <tr v-for="ue in (bulletin.has_tronc_commun ? bulletin.ues_specifiques : bulletin.ues)" :key="ue.id">
              <td style="font-family:monospace;font-size:11px;color:#888;">{{ ue.code }}</td>
              <td style="color:#333;">{{ ue.intitule }}</td>
              <td style="font-size:12px;color:#64748b;">{{ ue.enseignant ? `${ue.enseignant.prenom} ${ue.enseignant.nom}` : '—' }}</td>
              <td style="text-align:center;color:#555;">{{ ue.coefficient }}</td>
              <td style="text-align:center;font-weight:800;" :style="{ color: ue.note !== null ? (ue.note >= 10 ? '#16a34a' : '#E30613') : '#ccc' }">{{ ue.note !== null ? ue.note : '—' }}</td>
              <td style="text-align:center;color:#555;">{{ ue.points ?? '—' }}</td>
              <td style="text-align:center;">
                <span v-if="ue.note !== null" style="padding:2px 6px;border-radius:4px;font-size:10.5px;font-weight:600;" :style="{ background: ue.valide ? '#f0fdf4' : '#fff0f0', color: ue.valide ? '#16a34a' : '#E30613' }">
                  {{ ue.valide ? `✓ ${ue.credits_ects}` : `✗ ${ue.credits_ects}` }}
                </span>
                <span v-else style="color:#ccc;">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <!-- Décision jury -->
        <div style="padding:14px;border-radius:6px;border:1px solid;" :style="{ background: bulletin.decision === 'admis' ? '#f0fdf4' : bulletin.decision === 'rattrapage' ? '#fff7ed' : '#fff0f0', borderColor: bulletin.decision === 'admis' ? '#bbf7d0' : bulletin.decision === 'rattrapage' ? '#fed7aa' : '#fca5a5' }">
          <p style="font-size:10px;color:#aaa;text-transform:uppercase;margin:0 0 4px;">Décision du jury</p>
          <p style="font-size:16px;font-weight:800;margin:0;" :style="{ color: bulletin.decision === 'admis' ? '#16a34a' : bulletin.decision === 'rattrapage' ? '#c2410c' : '#E30613' }">
            {{ bulletin.decision === 'admis' ? '✓ Admis(e)' : bulletin.decision === 'rattrapage' ? '↻ Admis(e) en rattrapage' : bulletin.decision === 'redoublant' ? '✗ Redoublant(e)' : 'En attente' }}
          </p>
        </div>
        <!-- Signatures -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:24px;text-align:center;">
          <div style="border-top:1px solid #999;padding-top:6px;"><p style="font-size:10px;color:#888;">Le Directeur Pédagogique</p></div>
          <div style="border-top:1px solid #999;padding-top:6px;"><p style="font-size:10px;color:#888;">Le Directeur Général</p></div>
          <div style="border-top:1px solid #999;padding-top:6px;"><p style="font-size:10px;color:#888;">Cachet de l'école</p></div>
        </div>
      </div>

      <template #footer>
        <button @click="showBulletin = false" class="nb-btn-cancel">Fermer</button>
      </template>
    </UcModal>
  </div>
</template>

<style scoped>
.nb-select { border:1.5px solid #e5e5e5; border-radius:4px; padding:8px 11px; font-family:'Poppins',sans-serif; font-size:12px; color:#333; background:#fff; }
.nb-btn-ues { border:1.5px solid #e5e5e5; background:#fff; color:#555; border-radius:4px; padding:8px 12px; font-size:12px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.nb-btn-ues:hover { background:#f5f5f5; }

.nb-tabs { display:flex; border-bottom:2px solid #f0f0f0; margin-bottom:16px; }
.nb-tab { padding:10px 20px; font-size:12px; font-weight:600; border:none; border-bottom:3px solid transparent; background:none; cursor:pointer; color:#888; font-family:'Poppins',sans-serif; margin-bottom:-2px; }
.nb-tab--active { border-bottom-color:#E30613; color:#E30613; }

.nb-empty-state { background:#fff; border-radius:6px; padding:40px; text-align:center; color:#aaa; font-size:13px; box-shadow:0 2px 8px rgba(0,0,0,0.05); }
.nb-loading { text-align:center; padding:40px; color:#aaa; font-size:13px; }
.nb-table-wrap { background:#fff; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.05); overflow:hidden; }
.nb-table-toolbar { display:flex; align-items:center; padding:12px 16px; background:#f9f9f9; border-bottom:1px solid #f0f0f0; }
.nb-table { width:100%; border-collapse:collapse; }
.nb-table thead tr { background:#f9f9f9; }
.nb-table th { padding:10px 14px; text-align:left; font-size:11px; font-weight:600; color:#888; text-transform:uppercase; border-bottom:1px solid #f0f0f0; }
.nb-table td { padding:10px 14px; border-top:1px solid #f4f4f4; font-size:13px; vertical-align:middle; }
.nb-table tr:hover td { background:#fafafa; }
.nb-table--saisie .nb-col-sticky { position:sticky; left:0; z-index:1; }
.nb-table--saisie .nb-col-sticky--head { z-index:2; background:#f9f9f9 !important; }
.nb-table--saisie .nb-col-sticky { box-shadow:2px 0 6px -2px rgba(0,0,0,0.10); clip-path:inset(0 -8px 0 0); }
.nb-table--saisie tr:hover .nb-col-sticky { background:#fafafa !important; }

.nb-note-input { width:72px; text-align:center; border:1.5px solid #e5e5e5; border-radius:4px; padding:5px 4px; font-family:'Poppins',sans-serif; font-size:13px; font-weight:700; }
.nb-note-input:focus { outline:none; }
.nb-note-input:disabled { background:#f9f9f9; }
.nb-note-locked { background:#f3f4f6 !important; cursor:not-allowed; color:#ccc; font-size:12px; }
.nb-prof-banner { background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px 16px; margin-bottom:14px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; font-size:12.5px; color:#1d4ed8; }
.nb-prof-banner strong { color:#1e40af; }

.nb-decision-badge { padding:3px 9px; border-radius:20px; font-size:10.5px; font-weight:600; }
.bg-green-100 { background:#f0fdf4; } .text-green-700 { color:#15803d; }
.bg-orange-100 { background:#fff7ed; } .text-orange-600 { color:#ea580c; }
.bg-red-100 { background:#fff0f0; } .text-red-700 { color:#b91c1c; }
.bg-gray-100 { background:#f3f4f6; } .text-gray-600 { color:#555; }

.nb-btn-save-notes { background:#E30613; color:#fff; border:none; border-radius:4px; padding:7px 14px; font-size:12px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.nb-btn-save-notes:disabled { opacity:0.5; }
.nb-btn-bulletin { background:#f9f9f9; color:#333; border:1.5px solid #e5e5e5; border-radius:4px; padding:5px 10px; font-size:11px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.nb-btn-bulletin:hover { background:#f0f0f0; }

.nb-input { border:1.5px solid #e5e5e5; border-radius:4px; padding:8px 10px; font-family:'Poppins',sans-serif; font-size:13px; color:#333; }
.nb-input:focus { outline:none; border-color:#E30613; }
.nb-btn-cancel { flex:1; border:1.5px solid #e5e5e5; background:#fff; color:#555; border-radius:4px; padding:9px; font-size:13px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.nb-btn-save { flex:1; background:#E30613; color:#fff; border:none; border-radius:4px; padding:9px; font-size:13px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.nb-btn-save:disabled { opacity:0.5; }

@media (max-width: 768px) {
  .nb-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .nb-table { min-width: 480px; }
  .nb-table-toolbar { flex-wrap: wrap; gap: 8px; }
  .nb-tabs { overflow-x: auto; }
}
</style>
