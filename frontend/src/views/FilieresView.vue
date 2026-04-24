<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import * as XLSX from 'xlsx'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import { UcModal, UcFormGroup, UcFormGrid, UcPageHeader, UcTable } from '@/components/ui'

const auth = useAuthStore()
const toast = useToast()
const canWrite = computed(() => auth.user?.role === 'dg')

// ── Interfaces ───────────────────────────────────────────────────────
interface TypeFormation {
  id: number
  nom: string
  code: string
}

interface FiliereMatiere {
  id: number
  nom: string
  code: string
  pivot: { coefficient: number; credits: number; ordre: number }
}

interface MatiereGlobale {
  id: number
  nom: string
  code: string
  actif: boolean
}

interface Filiere {
  id: number
  nom: string
  code: string
  description: string | null
  actif: boolean
  type_formation_id: number | null
  type_formation: TypeFormation | null
  frais_inscription: number
  mensualite: number
  montant_tenue: number
  tarif_horaire: number
  duree_mois: number | null
  matieres: FiliereMatiere[]
}

// ── État général ─────────────────────────────────────────────────────
const filieres = ref<Filiere[]>([])
const typesFormation = ref<TypeFormation[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const showForm = ref(false)
const editTarget = ref<Filiere | null>(null)
const deleteTarget = ref<Filiere | null>(null)
const deleting = ref(false)
const confirmMsg = ref('')

const form = ref({
  nom: '',
  code: '',
  description: '',
  actif: true,
  type_formation_id: null as number | null,
  frais_inscription: 0,
  mensualite: 0,
  montant_tenue: 0,
  tarif_horaire: 0,
  duree_mois: null as number | null,
})

// ── Gestion des matières ──────────────────────────────────────────────
const showMatieres = ref(false)
const filiereForMatieres = ref<Filiere | null>(null)
const matieresGlobales = ref<MatiereGlobale[]>([])
const loadingMatiereGlobales = ref(false)
const showAttachForm = ref(false)
const attachingMatiere = ref(false)
const detachingMatiereId = ref<number | null>(null)
const formAttach = ref({ matiere_id: null as number | null, coefficient: 1, credits: 0, ordre: 0 })

// ── CRUD Filière ──────────────────────────────────────────────────────
function openCreate() {
  editTarget.value = null
  form.value = {
    nom: '', code: '', description: '', actif: true, type_formation_id: null,
    frais_inscription: 0, mensualite: 0, montant_tenue: 0, tarif_horaire: 0, duree_mois: null,
  }
  error.value = ''
  showForm.value = true
}

function openEdit(f: Filiere) {
  editTarget.value = f
  form.value = {
    nom: f.nom, code: f.code, description: f.description ?? '', actif: f.actif,
    type_formation_id: f.type_formation_id,
    frais_inscription: f.frais_inscription ?? 0,
    mensualite: f.mensualite ?? 0,
    montant_tenue: f.montant_tenue ?? 0,
    tarif_horaire: f.tarif_horaire ?? 0,
    duree_mois: f.duree_mois ?? null,
  }
  error.value = ''
  showForm.value = true
}

function closeForm() {
  showForm.value = false
  error.value = ''
}

async function load() {
  loading.value = true
  try {
    const [filieresRes, typesRes] = await Promise.all([
      api.get('/filieres'),
      api.get('/types-formation'),
    ])
    filieres.value = filieresRes.data
    typesFormation.value = typesRes.data
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  error.value = ''
  try {
    const payload = {
      ...form.value,
      frais_inscription: Number(form.value.frais_inscription),
      mensualite: Number(form.value.mensualite),
      montant_tenue: Number(form.value.montant_tenue),
      tarif_horaire: Number(form.value.tarif_horaire) || 0,
      duree_mois: form.value.duree_mois ? Number(form.value.duree_mois) : null,
    }
    if (editTarget.value) {
      const { data } = await api.put(`/filieres/${editTarget.value.id}`, payload)
      const idx = filieres.value.findIndex(f => f.id === data.id)
      if (idx !== -1) filieres.value[idx] = data
    } else {
      const { data } = await api.post('/filieres', payload)
      filieres.value.push(data)
    }
    closeForm()
  } catch (e: any) {
    const errs = e.response?.data?.errors as Record<string, string[]> | undefined
    error.value = e.response?.data?.message ?? (errs ? Object.values(errs)[0]?.[0] : undefined) ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api.delete(`/filieres/${deleteTarget.value.id}`)
    filieres.value = filieres.value.filter(f => f.id !== deleteTarget.value!.id)
    deleteTarget.value = null
    confirmMsg.value = ''
  } catch (e: any) {
    confirmMsg.value = e.response?.data?.message ?? 'Erreur'
  } finally {
    deleting.value = false
  }
}

// ── Gestion matières d'une filière ─────────────────────────────────
async function openMatieres(f: Filiere) {
  filiereForMatieres.value = f
  showAttachForm.value = false
  formAttach.value = { matiere_id: null, coefficient: 1, credits: 0, ordre: 0 }
  showMatieres.value = true

  if (matieresGlobales.value.length === 0) {
    loadingMatiereGlobales.value = true
    try {
      const { data } = await api.get('/matieres')
      matieresGlobales.value = data.filter((m: MatiereGlobale) => m.actif)
    } finally {
      loadingMatiereGlobales.value = false
    }
  }
}

const matieresDisponibles = computed(() => {
  if (!filiereForMatieres.value) return matieresGlobales.value
  const ids = new Set(filiereForMatieres.value.matieres.map(m => m.id))
  return matieresGlobales.value.filter(m => !ids.has(m.id))
})

async function attachMatiere() {
  if (!filiereForMatieres.value || !formAttach.value.matiere_id) return
  attachingMatiere.value = true
  try {
    const { data } = await api.post(
      `/filieres/${filiereForMatieres.value.id}/matieres`,
      formAttach.value
    )
    // data = filière complète rechargée
    const idx = filieres.value.findIndex(f => f.id === filiereForMatieres.value!.id)
    if (idx >= 0) filieres.value[idx] = data
    filiereForMatieres.value = data
    showAttachForm.value = false
    formAttach.value = { matiere_id: null, coefficient: 1, credits: 0, ordre: 0 }
  } catch (e: any) {
    toast.apiError(e, 'Erreur lors de l\'ajout')
  } finally {
    attachingMatiere.value = false
  }
}

async function detachMatiere(matiereId: number) {
  if (!filiereForMatieres.value) return
  if (!confirm('Retirer cette matière de la filière ?')) return
  detachingMatiereId.value = matiereId
  try {
    await api.delete(`/filieres/${filiereForMatieres.value.id}/matieres/${matiereId}`)
    filiereForMatieres.value = {
      ...filiereForMatieres.value,
      matieres: filiereForMatieres.value.matieres.filter(m => m.id !== matiereId),
    }
    const idx = filieres.value.findIndex(f => f.id === filiereForMatieres.value!.id)
    if (idx >= 0) filieres.value[idx] = { ...filieres.value[idx]!, matieres: filiereForMatieres.value!.matieres }
  } catch (e: any) {
    toast.apiError(e, 'Erreur lors de la suppression')
  } finally {
    detachingMatiereId.value = null
  }
}

// ── Import / Export maquette ─────────────────────────────────────────
const importFileInput = ref<HTMLInputElement | null>(null)
const importingMaquette = ref(false)
const importTarget = ref<Filiere | null>(null)
const importResult = ref('')
const showImportResult = ref(false)

function exportModele() {
  // Créer un fichier Excel modèle vide avec les bonnes colonnes et un exemple
  const header = ['Semestre', 'Code UE', 'Intitulé UE', 'Catégorie UE', 'Intitulé EC (Matière)', 'CM', 'TD', 'TP', 'TPE', 'VHT', 'Coefficient']
  const exemple = [1, 'InfM111', 'Informatique', 'majeure', 'Bureautique', 0, 0, 20, 20, 40, 3]
  const exemple2 = [1, 'InfM111', 'Informatique', 'majeure', 'Systèmes d\'exploitation', 0, 0, 10, 10, 20, 2]
  const exemple3 = [2, 'WebM121', 'Webmaster 1', 'majeure', 'Conception de site statique', 0, 0, 15, 15, 30, 5]

  const ws = XLSX.utils.aoa_to_sheet([header, exemple, exemple2, exemple3])

  // Largeurs de colonnes
  ws['!cols'] = [
    { wch: 10 }, // Semestre
    { wch: 12 }, // Code UE
    { wch: 30 }, // Intitulé UE
    { wch: 15 }, // Catégorie
    { wch: 40 }, // Intitulé EC
    { wch: 6 },  // CM
    { wch: 6 },  // TD
    { wch: 6 },  // TP
    { wch: 6 },  // TPE
    { wch: 8 },  // VHT
    { wch: 12 }, // Coefficient
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Maquette')

  // Ajouter une feuille d'instructions
  const instrWs = XLSX.utils.aoa_to_sheet([
    ['INSTRUCTIONS - Modèle de maquette pédagogique'],
    [''],
    ['Colonnes obligatoires :'],
    ['- Semestre : numéro du semestre (1, 2, 3...)'],
    ['- Code UE : code de l\'unité d\'enseignement (ex: InfM111)'],
    ['- Intitulé UE : nom de l\'unité d\'enseignement'],
    ['- Catégorie UE : majeure, mineure, ou renforcement'],
    ['- Intitulé EC : nom de l\'élément constitutif (matière)'],
    ['- CM, TD, TP, TPE : volumes horaires en heures'],
    ['- VHT : volume horaire total (CM + TD + TP + TPE)'],
    ['- Coefficient : coefficient de la matière (0 = LMD uniquement)'],
    [''],
    ['Règles :'],
    ['- Plusieurs EC peuvent appartenir à la même UE (même Code UE)'],
    ['- Les crédits sont calculés automatiquement : VHT / 20 = crédits'],
    ['- Si coefficient = 0, seuls les étudiants LMD suivent cette matière'],
    ['- Supprimez les lignes d\'exemple avant d\'importer'],
  ])
  instrWs['!cols'] = [{ wch: 70 }]
  XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions')

  XLSX.writeFile(wb, 'modele_maquette.xlsx')
}

function triggerImportMaquette(f: Filiere) {
  importTarget.value = f
  importResult.value = ''
  importFileInput.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !importTarget.value) return

  importingMaquette.value = true
  importResult.value = ''
  try {
    const data = await file.arrayBuffer()
    const wb = XLSX.read(data)
    const sheetName = wb.SheetNames[0]
    if (!sheetName) throw new Error('Feuille vide')
    const ws = wb.Sheets[sheetName]
    if (!ws) throw new Error('Feuille vide')

    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 })
    if (rows.length < 2) throw new Error('Le fichier ne contient aucune donnée (seulement l\'en-tête)')

    // Détecter l'en-tête (première ligne)
    const headerRow = (rows[0] || []).map((h: any) => String(h ?? '').toLowerCase().trim())
    const colIdx = {
      semestre: headerRow.findIndex((h: string) => h.includes('semestre')),
      codeUe: headerRow.findIndex((h: string) => h.includes('code')),
      intituleUe: headerRow.findIndex((h: string) => h.includes('intitul') && h.includes('ue')),
      categorie: headerRow.findIndex((h: string) => h.includes('cat')),
      intituleEc: headerRow.findIndex((h: string) => (h.includes('intitul') && (h.includes('ec') || h.includes('mati'))) || h === 'intitulé ec (matière)'),
      cm: headerRow.findIndex((h: string) => h === 'cm'),
      td: headerRow.findIndex((h: string) => h === 'td'),
      tp: headerRow.findIndex((h: string) => h === 'tp'),
      tpe: headerRow.findIndex((h: string) => h === 'tpe'),
      vht: headerRow.findIndex((h: string) => h === 'vht'),
      coefficient: headerRow.findIndex((h: string) => h.includes('coef')),
    }

    // Vérifier les colonnes essentielles
    if (colIdx.intituleEc === -1) {
      // Essayer une détection plus souple
      colIdx.intituleEc = headerRow.findIndex((h: string) => h.includes('ec') || h.includes('mati'))
    }
    if (colIdx.intituleEc === -1) throw new Error('Colonne "Intitulé EC" introuvable dans l\'en-tête')

    // Construire la structure semestres > UE > EC
    const semestresMap: Record<number, Record<string, { code: string; intitule_ue: string; categorie: string; ecs: any[] }>> = {}

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.length === 0) continue

      const ecNom = String(row[colIdx.intituleEc] ?? '').trim()
      if (!ecNom) continue

      const sem = parseInt(row[colIdx.semestre] ?? 1) || 1
      const codeUe = String(row[colIdx.codeUe] ?? '').trim() || 'UE'
      const intituleUe = String(row[colIdx.intituleUe] ?? '').trim() || codeUe
      const categorie = String(row[colIdx.categorie] ?? 'majeure').trim().toLowerCase()
      const cm = parseInt(row[colIdx.cm] ?? 0) || 0
      const td = parseInt(row[colIdx.td] ?? 0) || 0
      const tp = parseInt(row[colIdx.tp] ?? 0) || 0
      const tpe = parseInt(row[colIdx.tpe] ?? 0) || 0
      const vht = parseInt(row[colIdx.vht] ?? 0) || (cm + td + tp + tpe)
      const coefficient = parseFloat(row[colIdx.coefficient] ?? 1) || 0

      if (!semestresMap[sem]) semestresMap[sem] = {}
      if (!semestresMap[sem][codeUe]) {
        semestresMap[sem][codeUe] = { code: codeUe, intitule_ue: intituleUe, categorie, ecs: [] }
      }
      semestresMap[sem][codeUe].ecs.push({ intitule: ecNom, cm, td, tp, tpe, vht, coefficient })
    }

    // Convertir en format attendu par l'API
    const semestres = Object.entries(semestresMap).map(([num, uesMap]) => ({
      numero: parseInt(num),
      ues: Object.values(uesMap),
    }))

    if (semestres.length === 0) throw new Error('Aucune donnée valide trouvée dans le fichier')

    // Appel API
    const { data: result } = await api.post(`/filieres/${importTarget.value.id}/maquette`, { semestres })
    importResult.value = result.message || `Import réussi: ${result.total_filiere_matiere} matière(s) importée(s)`
    showImportResult.value = true

    // Recharger les filières
    await load()
  } catch (e: any) {
    importResult.value = e?.response?.data?.error || e.message || 'Erreur lors de l\'import'
    showImportResult.value = true
  } finally {
    importingMaquette.value = false
    input.value = '' // Reset file input
  }
}

async function exportMaquetteFiliere(f: Filiere) {
  try {
    const { data } = await api.get(`/filieres/${f.id}/maquette`)
    const semestres = Array.isArray(data) ? data : (data.semestres || [])

    const rows: any[][] = [['Semestre', 'Code UE', 'Intitulé UE', 'Catégorie UE', 'Intitulé EC (Matière)', 'CM', 'TD', 'TP', 'TPE', 'VHT', 'Coefficient']]

    for (const sem of semestres) {
      for (const ue of (sem.ues || [])) {
        for (const ec of (ue.ecs || [])) {
          rows.push([
            sem.numero,
            ue.code || '',
            ue.intitule_ue || '',
            ue.categorie || '',
            ec.intitule || '',
            ec.cm || 0,
            ec.td || 0,
            ec.tp || 0,
            ec.tpe || 0,
            ec.vht || 0,
            ec.coefficient ?? 0,
          ])
        }
      }
    }

    if (rows.length <= 1) {
      toast.warning('Aucune maquette à exporter pour cette filière.')
      return
    }

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [
      { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 40 },
      { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 12 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Maquette')
    XLSX.writeFile(wb, `maquette_${f.code || f.nom}.xlsx`)
  } catch (e: any) {
    toast.apiError(e, 'Erreur lors de l\'export')
  }
}

// ── Formatage ─────────────────────────────────────────────────────────
function formatMontant(val: number | null): string {
  if (val == null || val === 0) return '—'
  return new Intl.NumberFormat('fr-FR').format(val) + ' FCFA'
}

onMounted(load)
</script>

<template>
  <div class="uc-content">

    <!-- Header -->
    <UcPageHeader
      title="Filières"
      subtitle="Gestion des filières et programmes de formation"
    >
      <template #actions>
        <a href="/parcours" style="display:inline-flex;align-items:center;gap:7px;padding:8px 16px;background:#E30613;color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
          Parcours
        </a>
        <button @click="exportModele" class="fl-btn-modele" title="Télécharger le modèle Excel vide">📥 Modèle Excel</button>
        <button v-if="canWrite" @click="openCreate" class="uc-btn-primary">+ Nouvelle filière</button>
      </template>
    </UcPageHeader>

    <!-- Table -->
    <div v-if="loading" style="padding:40px;text-align:center;font-size:12px;color:#aaa;font-family:'Poppins',sans-serif;">Chargement…</div>
    <UcTable
      v-else
      :cols="[
        { key: 'code',    label: 'Code' },
        { key: 'filiere', label: 'Filière' },
        { key: 'type',    label: 'Type' },
        { key: 'frais',   label: 'Frais inscr.' },
        { key: 'mens',    label: 'Mensualité' },
        { key: 'tenue',   label: 'Tenue' },
        { key: 'tarif',   label: 'Tarif/h vacation' },
        { key: 'duree',   label: 'Durée' },
        { key: 'mat',     label: 'Matières' },
        { key: 'statut',  label: 'Statut' },
        { key: 'actions', label: 'Actions', align: 'right' },
      ]"
      :data="filieres"
      empty-text="Aucune filière"
    >
      <template #row="{ item: f }">
        <td><span style="font-size:11px;font-weight:700;color:#888;font-family:monospace;">{{ (f as any).code }}</span></td>
        <td>
          <p style="font-size:12.5px;font-weight:600;color:#111;margin:0;font-family:'Poppins',sans-serif;">{{ (f as any).nom }}</p>
          <p v-if="(f as any).description" style="font-size:11px;color:#aaa;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;font-family:'Poppins',sans-serif;">{{ (f as any).description }}</p>
        </td>
        <td style="font-size:12px;color:#555;font-family:'Poppins',sans-serif;">{{ (f as any).type_formation?.nom ?? '—' }}</td>
        <td style="font-size:12.5px;font-weight:600;color:#111;font-family:'Poppins',sans-serif;">{{ formatMontant((f as any).frais_inscription) }}</td>
        <td style="font-size:12.5px;font-weight:600;color:#111;font-family:'Poppins',sans-serif;">{{ formatMontant((f as any).mensualite) }}</td>
        <td style="font-size:12px;color:#555;font-family:'Poppins',sans-serif;">{{ (f as any).montant_tenue > 0 ? formatMontant((f as any).montant_tenue) : '—' }}</td>
        <td style="font-size:12px;font-family:'Poppins',sans-serif;">
          <span v-if="(f as any).tarif_horaire > 0" style="font-weight:700;color:#1d4ed8;">{{ formatMontant((f as any).tarif_horaire) }}/h</span>
          <span v-else style="color:#94a3b8;">type global</span>
        </td>
        <td style="font-size:12px;color:#555;font-family:'Poppins',sans-serif;">{{ (f as any).duree_mois ? (f as any).duree_mois + ' mois' : '—' }}</td>
        <td>
          <button @click="openMatieres(f as any)" class="fl-btn-matieres" title="Gérer les matières">
            {{ (f as any).matieres?.length ?? 0 }} matière{{ ((f as any).matieres?.length ?? 0) !== 1 ? 's' : '' }}
          </button>
        </td>
        <td>
          <span :class="(f as any).actif ? 'fl-badge-actif' : 'fl-badge-inactif'">{{ (f as any).actif ? 'Active' : 'Inactive' }}</span>
        </td>
        <td style="text-align:right;">
          <div style="display:flex;justify-content:flex-end;gap:4px;">
            <button v-if="canWrite" @click="triggerImportMaquette(f as any)" :disabled="importingMaquette" class="fl-btn-action" title="Importer maquette Excel">📤</button>
            <button @click="exportMaquetteFiliere(f as any)" class="fl-btn-action" title="Exporter maquette Excel">📥</button>
            <button @click="$router.push(`/filieres/${(f as any).id}/maquette`)" class="fl-btn-action" title="Voir maquette pédagogique" style="background:#f0fdf4;border-color:#86efac;color:#15803d;">📋</button>
            <button @click="openMatieres(f as any)" class="fl-btn-action" title="Matières">📚</button>
            <button v-if="canWrite" @click="openEdit(f as any)" class="fl-btn-action" title="Modifier">✏️</button>
            <button v-if="canWrite" @click="deleteTarget = (f as any); confirmMsg = ''" class="fl-btn-action fl-btn-danger" title="Supprimer">🗑️</button>
          </div>
        </td>
      </template>
    </UcTable>

    <!-- Modal Filière (create/edit) -->
    <UcModal
      v-model="showForm"
      :title="editTarget ? 'Modifier la filière' : 'Nouvelle filière'"
      width="560px"
      @close="closeForm"
    >
      <div v-if="error" style="background:#fff0f0;border:1px solid #fecaca;border-radius:4px;padding:10px 14px;font-size:12px;color:#b91c1c;margin-bottom:14px;font-family:'Poppins',sans-serif;">{{ error }}</div>
      <form @submit.prevent="save" style="display:flex;flex-direction:column;gap:14px;">
        <UcFormGrid :cols="2">
          <UcFormGroup label="Nom" :required="true">
            <input v-model="form.nom" required placeholder="Ex: Informatique" />
          </UcFormGroup>
          <UcFormGroup label="Code" :required="true">
            <input v-model="form.code" required placeholder="Ex: INFO" />
          </UcFormGroup>
        </UcFormGrid>
        <UcFormGroup label="Description">
          <textarea v-model="form.description" rows="2" style="resize:none;"></textarea>
        </UcFormGroup>
        <UcFormGroup label="Type de formation">
          <select v-model="form.type_formation_id">
            <option :value="null">— Sélectionner —</option>
            <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }} ({{ t.code }})</option>
          </select>
        </UcFormGroup>
        <UcFormGrid :cols="3">
          <UcFormGroup label="Frais inscription (F)" :required="true">
            <input v-model.number="form.frais_inscription" type="number" min="0" step="500" required />
          </UcFormGroup>
          <UcFormGroup label="Mensualité (F)" :required="true">
            <input v-model.number="form.mensualite" type="number" min="0" step="500" required />
          </UcFormGroup>
          <UcFormGroup label="Tenue (F)">
            <input v-model.number="form.montant_tenue" type="number" min="0" step="500" placeholder="0 = pas de tenue" />
          </UcFormGroup>
          <UcFormGroup label="Tarif vacation (F/h)" title="Tarif horaire spécifique à cette filière. Laissez 0 pour utiliser le tarif global du type de formation.">
            <input v-model.number="form.tarif_horaire" type="number" min="0" step="500" placeholder="0 = tarif du type de formation" />
          </UcFormGroup>
        </UcFormGrid>
        <UcFormGrid :cols="1">
          <UcFormGroup label="Durée (mois)" :required="true">
            <input v-model.number="form.duree_mois" type="number" min="1" max="120" required style="max-width:140px" />
          </UcFormGroup>
        </UcFormGrid>
        <div v-if="editTarget" style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:12px;font-weight:600;color:#333;text-transform:uppercase;letter-spacing:0.3px;font-family:'Poppins',sans-serif;">Filière active</label>
          <input type="checkbox" v-model="form.actif" style="width:16px;height:16px;accent-color:#E30613;" />
        </div>
      </form>
      <template #footer>
        <button @click="closeForm" class="fl-btn-cancel">Annuler</button>
        <button @click="save" :disabled="saving" class="fl-btn-save">{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
      </template>
    </UcModal>

    <!-- Modal confirmation suppression -->
    <UcModal
      :model-value="!!deleteTarget"
      title="Supprimer la filière ?"
      width="420px"
      @close="deleteTarget = null"
    >
      <p style="font-size:13px;color:#555;margin:0 0 4px;font-family:'Poppins',sans-serif;font-weight:600;">{{ deleteTarget?.nom }}</p>
      <p style="font-size:12px;color:#888;margin:0 0 6px;font-family:'Poppins',sans-serif;">Cette action est irréversible. La filière sera supprimée si aucune classe ou inscription ne l'utilise.</p>
      <p v-if="confirmMsg" style="font-size:12px;color:#E30613;margin:0;font-family:'Poppins',sans-serif;">{{ confirmMsg }}</p>
      <template #footer>
        <button @click="deleteTarget = null" class="fl-btn-cancel">Annuler</button>
        <button @click="confirmDelete" :disabled="deleting" class="fl-btn-save" :style="deleting ? 'opacity:0.6;cursor:not-allowed;' : ''">
          {{ deleting ? 'Suppression…' : 'Supprimer' }}
        </button>
      </template>
    </UcModal>

    <!-- Input file caché pour import maquette -->
    <input type="file" ref="importFileInput" accept=".xlsx,.xls,.csv" @change="handleImportFile" style="display:none" />

    <!-- Modal résultat import -->
    <UcModal v-model="showImportResult" title="Import maquette" width="480px" @close="showImportResult = false">
      <p style="font-size:13px;color:#333;margin:0;font-family:'Poppins',sans-serif;white-space:pre-line;">{{ importResult }}</p>
      <template #footer>
        <button @click="showImportResult = false" class="fl-btn-save">OK</button>
      </template>
    </UcModal>

    <!-- Modal Matières d'une filière -->
    <UcModal
      v-model="showMatieres"
      :title="`Matières — ${filiereForMatieres?.nom ?? ''}`"
      :subtitle="`${filiereForMatieres?.matieres?.length ?? 0} matière(s) dans cette filière`"
      width="680px"
      @close="showMatieres = false"
    >
      <template #footer v-if="canWrite && !showAttachForm">
        <button @click="showAttachForm = true" class="uc-btn-primary" style="font-size:12px;padding:7px 14px;">+ Ajouter une matière</button>
      </template>

      <!-- Formulaire d'ajout -->
      <div v-if="showAttachForm" style="background:#f8f8ff;border:1px solid #e0e0f0;border-radius:6px;padding:16px;margin-bottom:16px;">
        <h3 style="font-size:13px;font-weight:700;color:#333;margin:0 0 12px;font-family:'Poppins',sans-serif;">Associer une matière</h3>
        <div v-if="loadingMatiereGlobales" style="font-size:12px;color:#aaa;text-align:center;padding:8px;font-family:'Poppins',sans-serif;">Chargement…</div>
        <template v-else>
          <div v-if="matieresDisponibles.length === 0" style="font-size:12px;color:#888;text-align:center;padding:8px;font-family:'Poppins',sans-serif;">
            Toutes les matières ont déjà été ajoutées à cette filière.
          </div>
          <template v-else>
            <div style="display:flex;flex-direction:column;gap:10px;">
              <UcFormGroup label="Matière" :required="true">
                <select v-model="formAttach.matiere_id">
                  <option :value="null">— Sélectionner une matière —</option>
                  <option v-for="m in matieresDisponibles" :key="m.id" :value="m.id">{{ m.nom }} ({{ m.code }})</option>
                </select>
              </UcFormGroup>
              <UcFormGrid :cols="3">
                <UcFormGroup label="Coefficient" :required="true">
                  <input v-model.number="formAttach.coefficient" type="number" min="0" step="0.5" />
                </UcFormGroup>
                <UcFormGroup label="Crédits ECTS">
                  <input v-model.number="formAttach.credits" type="number" min="0" />
                </UcFormGroup>
                <UcFormGroup label="Ordre">
                  <input v-model.number="formAttach.ordre" type="number" min="0" />
                </UcFormGroup>
              </UcFormGrid>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
              <button @click="showAttachForm = false" class="fl-btn-cancel" style="padding:7px 14px;">Annuler</button>
              <button
                @click="attachMatiere"
                :disabled="!formAttach.matiere_id || attachingMatiere"
                class="fl-btn-save"
                style="padding:7px 14px;"
              >{{ attachingMatiere ? 'Ajout…' : 'Ajouter' }}</button>
            </div>
          </template>
        </template>
      </div>

      <!-- Liste des matières actuelles -->
      <div v-if="!filiereForMatieres?.matieres?.length" style="text-align:center;padding:40px 0;font-size:12px;color:#aaa;font-family:'Poppins',sans-serif;">
        Aucune matière associée à cette filière.
      </div>
      <UcTable
        v-else
        :cols="[
          { key: 'matiere',    label: 'Matière' },
          { key: 'coeff',      label: 'Coefficient', align: 'center' },
          { key: 'credits',    label: 'Crédits',     align: 'center' },
          { key: 'ordre',      label: 'Ordre',       align: 'center' },
          ...(canWrite ? [{ key: 'actions', label: '', align: 'right' }] : []),
        ]"
        :data="filiereForMatieres?.matieres ?? []"
        empty-text="Aucune matière"
      >
        <template #row="{ item: m }">
          <td>
            <p style="font-size:12.5px;font-weight:600;color:#111;margin:0;font-family:'Poppins',sans-serif;">{{ (m as any).nom }}</p>
            <span style="font-size:11px;font-family:monospace;color:#aaa;">{{ (m as any).code }}</span>
          </td>
          <td style="text-align:center;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:28px;border-radius:4px;background:#fff8e6;color:#b45309;font-size:13px;font-weight:700;font-family:'Poppins',sans-serif;">{{ (m as any).pivot?.coefficient ?? '—' }}</span>
          </td>
          <td style="text-align:center;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:28px;border-radius:4px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:700;font-family:'Poppins',sans-serif;">{{ (m as any).pivot?.credits ?? 0 }}</span>
          </td>
          <td style="text-align:center;font-size:12px;color:#aaa;font-family:'Poppins',sans-serif;">{{ (m as any).pivot?.ordre ?? 0 }}</td>
          <td v-if="canWrite" style="text-align:right;">
            <button
              @click="detachMatiere((m as any).id)"
              :disabled="detachingMatiereId === (m as any).id"
              class="fl-btn-action fl-btn-danger"
              title="Retirer de la filière"
            >&times;</button>
          </td>
        </template>
      </UcTable>
    </UcModal>

  </div>
</template>

<style scoped>
/* ── Wrapper principal ── */
.uc-content {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
  font-family: 'Poppins', sans-serif;
}

/* ── Bouton primaire rouge ── */
.uc-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  background: #E30613;
  color: #fff;
  border: none;
  border-radius: 5px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.uc-btn-primary:hover {
  background: #c0040f;
}

/* ── Badges statut ── */
.fl-badge-actif,
.fl-badge-inactif {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 600;
  font-family: 'Poppins', sans-serif;
  white-space: nowrap;
}
.fl-badge-actif {
  background: #e8faf0;
  color: #16a34a;
}
.fl-badge-inactif {
  background: #f4f4f4;
  color: #999;
}

/* ── Boutons d'action dans les lignes ── */
.fl-btn-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: #f5f5f5;
  border: 1px solid #e8e8e8;
  border-radius: 5px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s, border-color 0.15s;
}
.fl-btn-action:hover {
  background: #eee;
  border-color: #ddd;
}
.fl-btn-action.fl-btn-danger:hover {
  background: #fff0f0;
  border-color: #fecaca;
}

/* ── Bouton matières ── */
.fl-btn-matieres {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 99px;
  background: #f3f0ff;
  color: #6d28d9;
  border: none;
  font-size: 11px;
  font-weight: 600;
  font-family: 'Poppins', sans-serif;
  cursor: pointer;
  transition: background 0.15s;
}
.fl-btn-matieres:hover {
  background: #ede9fe;
}

/* ── Bouton modèle Excel ── */
.fl-btn-modele {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #bbf7d0;
  border-radius: 5px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.fl-btn-modele:hover {
  background: #dcfce7;
}

/* ── Boutons modal ── */
.fl-btn-cancel {
  padding: 8px 18px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  color: #555;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.fl-btn-cancel:hover {
  background: #f5f5f5;
}
.fl-btn-save {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  background: #E30613;
  color: #fff;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.fl-btn-save:hover:not(:disabled) {
  background: #c0040f;
}
.fl-btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
