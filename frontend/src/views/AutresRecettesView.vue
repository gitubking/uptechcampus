<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { UcModal, UcFormGroup, UcFormGrid, UcPageHeader } from '@/components/ui'

const auth = useAuthStore()
const canWrite    = ['secretariat', 'resp_fin', 'dg'].includes(auth.user?.role ?? '')
const canValidate = ['resp_fin', 'dg'].includes(auth.user?.role ?? '')
const canDelete   = auth.user?.role === 'dg'

interface User { id: number; name: string }
interface Recette {
  id: number
  date_recette: string
  libelle: string
  client: string | null
  nature: string | null
  montant: number
  mode_encaissement: string
  reference_piece: string | null
  notes: string | null
  statut: 'en_attente' | 'validee' | 'rejetee'
  motif_rejet: string | null
  validated_at: string | null
  created_at: string
  created_by_user?: User
  validated_by_user?: User
}

const NATURES_SUGGEREES = [
  'Prestation de service',
  'Subvention',
  'Location de salle',
  'Vente support / manuel',
  'Formation externe',
  'Don',
  'Autre',
]
const MODES: Array<{ code: string; label: string }> = [
  { code: 'especes',      label: 'Espèces' },
  { code: 'virement',     label: 'Virement' },
  { code: 'cheque',       label: 'Chèque' },
  { code: 'wave',         label: 'Wave' },
  { code: 'orange_money', label: 'Orange Money' },
]
function modeLabel(c: string) { return MODES.find(m => m.code === c)?.label ?? c }

// ── State ───────────────────────────────────────────────────────────────────
const recettes = ref<Recette[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')

// Filtres
const fStatut = ref<'' | 'en_attente' | 'validee' | 'rejetee'>('')
const fAnnee = ref<string>(String(new Date().getFullYear()))
const fMois = ref<string>('')
const fSearch = ref('')

// Modal
const showForm = ref(false)
const editingId = ref<number | null>(null)
const form = ref({
  date_recette: new Date().toISOString().slice(0, 10),
  libelle: '',
  client: '',
  nature: NATURES_SUGGEREES[0],
  montant: 0,
  mode_encaissement: 'especes',
  reference_piece: '',
  notes: '',
})

// Rejet
const showRejet = ref(false)
const rejetId = ref<number | null>(null)
const rejetMotif = ref('')

function fmtMoney(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\u202F/g, ' ') + ' FCFA'
}
function fmtDate(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function statutLabel(s: string) {
  return { en_attente: 'En attente', validee: 'Validée', rejetee: 'Rejetée' }[s] ?? s
}
function statutClass(s: string) {
  return {
    en_attente: 'uc-badge uc-badge-warning',
    validee:    'uc-badge uc-badge-success',
    rejetee:    'uc-badge uc-badge-danger',
  }[s] ?? 'uc-badge'
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, string> = {}
    if (fStatut.value) params.statut = fStatut.value
    if (fAnnee.value) {
      if (fMois.value) {
        params.date_from = `${fAnnee.value}-${fMois.value}-01`
        const y = Number(fAnnee.value), m = Number(fMois.value)
        const lastDay = new Date(y, m, 0).getDate()
        params.date_to = `${fAnnee.value}-${fMois.value}-${String(lastDay).padStart(2, '0')}`
      } else {
        params.date_from = `${fAnnee.value}-01-01`
        params.date_to   = `${fAnnee.value}-12-31`
      }
    }
    const { data } = await api.get('/autres-recettes', { params })
    recettes.value = (data.data ?? data) as Recette[]
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => {
  const s = fSearch.value.trim().toLowerCase()
  if (!s) return recettes.value
  return recettes.value.filter(r =>
    (r.libelle || '').toLowerCase().includes(s) ||
    (r.client  || '').toLowerCase().includes(s) ||
    (r.nature  || '').toLowerCase().includes(s) ||
    (r.reference_piece || '').toLowerCase().includes(s)
  )
})

const totaux = computed(() => {
  const stats = { validee: 0, en_attente: 0, rejetee: 0, count: filtered.value.length }
  for (const r of filtered.value) {
    if (r.statut === 'validee')    stats.validee    += Number(r.montant)
    if (r.statut === 'en_attente') stats.en_attente += Number(r.montant)
    if (r.statut === 'rejetee')    stats.rejetee    += Number(r.montant)
  }
  return stats
})

function openCreate() {
  editingId.value = null
  form.value = {
    date_recette: new Date().toISOString().slice(0, 10),
    libelle: '',
    client: '',
    nature: NATURES_SUGGEREES[0],
    montant: 0,
    mode_encaissement: 'especes',
    reference_piece: '',
    notes: '',
  }
  error.value = ''
  showForm.value = true
}

function openEdit(r: Recette) {
  editingId.value = r.id
  form.value = {
    date_recette: r.date_recette.slice(0, 10),
    libelle: r.libelle,
    client: r.client ?? '',
    nature: r.nature ?? NATURES_SUGGEREES[0],
    montant: Number(r.montant),
    mode_encaissement: r.mode_encaissement,
    reference_piece: r.reference_piece ?? '',
    notes: r.notes ?? '',
  }
  error.value = ''
  showForm.value = true
}

async function save() {
  if (!form.value.libelle.trim())  { error.value = 'Libellé requis.'; return }
  if (!(form.value.montant > 0))   { error.value = 'Montant doit être supérieur à 0.'; return }
  if (!form.value.date_recette)    { error.value = 'Date requise.'; return }
  saving.value = true
  error.value = ''
  try {
    if (editingId.value) {
      await api.put(`/autres-recettes/${editingId.value}`, form.value)
    } else {
      await api.post('/autres-recettes', form.value)
    }
    showForm.value = false
    await load()
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

async function valider(r: Recette) {
  if (!confirm(`Valider la recette "${r.libelle}" (${fmtMoney(r.montant)}) ?`)) return
  try {
    await api.post(`/autres-recettes/${r.id}/valider`)
    await load()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  }
}

function openRejet(r: Recette) {
  rejetId.value = r.id
  rejetMotif.value = ''
  showRejet.value = true
}
async function confirmRejet() {
  if (!rejetId.value) return
  try {
    await api.post(`/autres-recettes/${rejetId.value}/rejeter`, { motif: rejetMotif.value || null })
    showRejet.value = false
    await load()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  }
}

async function supprimer(r: Recette) {
  if (!confirm(`Supprimer la recette "${r.libelle}" ?`)) return
  try {
    await api.delete(`/autres-recettes/${r.id}`)
    await load()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  }
}

onMounted(load)
</script>

<template>
  <div class="uc-content">
    <UcPageHeader
      title="Autres recettes"
      subtitle="Revenus hors paiements étudiants : prestations, subventions, locations, ventes…"
    >
      <template #actions>
        <button v-if="canWrite" @click="openCreate" class="uc-btn-primary">+ Nouvelle recette</button>
      </template>
    </UcPageHeader>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card stat-ok">
        <div class="stat-label">Validées</div>
        <div class="stat-value">{{ fmtMoney(totaux.validee) }}</div>
      </div>
      <div class="stat-card stat-warn">
        <div class="stat-label">En attente</div>
        <div class="stat-value">{{ fmtMoney(totaux.en_attente) }}</div>
      </div>
      <div class="stat-card stat-err">
        <div class="stat-label">Rejetées</div>
        <div class="stat-value">{{ fmtMoney(totaux.rejetee) }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Nombre de recettes</div>
        <div class="stat-value">{{ totaux.count }}</div>
      </div>
    </div>

    <!-- Filtres -->
    <div class="filters">
      <select v-model="fStatut" @change="load" class="uc-input">
        <option value="">Tous statuts</option>
        <option value="en_attente">En attente</option>
        <option value="validee">Validées</option>
        <option value="rejetee">Rejetées</option>
      </select>
      <select v-model="fAnnee" @change="load" class="uc-input">
        <option v-for="y in [new Date().getFullYear() + 1, new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2]"
                :key="y" :value="String(y)">{{ y }}</option>
      </select>
      <select v-model="fMois" @change="load" class="uc-input">
        <option value="">Toute l'année</option>
        <option v-for="(m, i) in ['Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc']"
                :key="m" :value="String(i + 1).padStart(2, '0')">{{ m }}</option>
      </select>
      <input v-model="fSearch" placeholder="Recherche libellé, client…" class="uc-input" style="flex:1;min-width:200px;" />
    </div>

    <!-- Table -->
    <div class="uc-table-wrap">
      <div v-if="loading" class="uc-empty">Chargement…</div>
      <div v-else-if="filtered.length === 0" class="uc-empty">Aucune recette</div>
      <table v-else class="uc-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Libellé</th>
            <th>Client</th>
            <th>Nature</th>
            <th style="text-align:right;">Montant</th>
            <th>Mode</th>
            <th>Réf. pièce</th>
            <th>Statut</th>
            <th style="text-align:center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.id">
            <td>{{ fmtDate(r.date_recette) }}</td>
            <td>
              <div style="font-weight:600;">{{ r.libelle }}</div>
              <div v-if="r.notes" style="font-size:11px;color:#64748b;">{{ r.notes }}</div>
              <div v-if="r.statut === 'rejetee' && r.motif_rejet" style="font-size:11px;color:#dc2626;">Motif : {{ r.motif_rejet }}</div>
            </td>
            <td>{{ r.client || '—' }}</td>
            <td>{{ r.nature || '—' }}</td>
            <td style="text-align:right;font-weight:700;">{{ fmtMoney(Number(r.montant)) }}</td>
            <td>{{ modeLabel(r.mode_encaissement) }}</td>
            <td style="font-family:monospace;font-size:12px;color:#64748b;">{{ r.reference_piece || '—' }}</td>
            <td><span :class="statutClass(r.statut)">{{ statutLabel(r.statut) }}</span></td>
            <td style="text-align:center;">
              <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
                <button v-if="canValidate && r.statut === 'en_attente'"
                        @click="valider(r)" class="uc-btn-xs"
                        style="background:#ecfdf5;color:#047857;border-color:#a7f3d0;">✓ Valider</button>
                <button v-if="canValidate && r.statut === 'en_attente'"
                        @click="openRejet(r)" class="uc-btn-xs"
                        style="background:#fef2f2;color:#dc2626;border-color:#fecaca;">✗ Rejeter</button>
                <button v-if="canWrite && r.statut !== 'validee'"
                        @click="openEdit(r)" class="uc-btn-xs"
                        style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">✏️</button>
                <button v-if="canDelete"
                        @click="supprimer(r)" class="uc-btn-xs"
                        style="background:#fef2f2;color:#dc2626;border-color:#fecaca;">🗑️</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal create/edit -->
    <UcModal v-model="showForm"
      :title="editingId ? 'Modifier la recette' : 'Nouvelle recette'"
      width="560px"
      @close="error = ''">
      <div v-if="error" class="uc-alert uc-alert-error" style="margin-bottom:12px;">{{ error }}</div>
      <UcFormGrid :cols="2">
        <UcFormGroup label="Date" :required="true">
          <input v-model="form.date_recette" type="date" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Montant (FCFA)" :required="true">
          <input v-model.number="form.montant" type="number" min="0" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Libellé / Désignation" :required="true" :span="2">
          <input v-model="form.libelle" class="uc-input" placeholder="Ex: Prestation formation Excel — Groupe ABC" />
        </UcFormGroup>
        <UcFormGroup label="Client / Payeur">
          <input v-model="form.client" class="uc-input" placeholder="Ex: Entreprise ABC / M. Ndiaye" />
        </UcFormGroup>
        <UcFormGroup label="Nature">
          <select v-model="form.nature" class="uc-input">
            <option v-for="n in NATURES_SUGGEREES" :key="n" :value="n">{{ n }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Mode d'encaissement">
          <select v-model="form.mode_encaissement" class="uc-input">
            <option v-for="m in MODES" :key="m.code" :value="m.code">{{ m.label }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Réf. pièce">
          <input v-model="form.reference_piece" class="uc-input" placeholder="Ex: FAC-2026-007" />
        </UcFormGroup>
        <UcFormGroup label="Notes" :span="2">
          <textarea v-model="form.notes" rows="2" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>
      <template #footer>
        <button @click="showForm = false" class="uc-btn-outline">Annuler</button>
        <button @click="save" :disabled="saving" class="uc-btn-primary">
          {{ saving ? 'Enregistrement…' : (editingId ? 'Mettre à jour' : 'Enregistrer') }}
        </button>
      </template>
    </UcModal>

    <!-- Modal rejet -->
    <UcModal v-model="showRejet" title="Rejeter la recette" width="420px">
      <UcFormGroup label="Motif du rejet">
        <textarea v-model="rejetMotif" rows="3" class="uc-input" placeholder="Raison du rejet…" />
      </UcFormGroup>
      <template #footer>
        <button @click="showRejet = false" class="uc-btn-outline">Annuler</button>
        <button @click="confirmRejet" class="uc-btn-primary" style="background:#dc2626;border-color:#dc2626;">Confirmer le rejet</button>
      </template>
    </UcModal>
  </div>
</template>

<style scoped>
.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px 16px;
}
.stat-ok   { border-left: 4px solid #10b981; }
.stat-warn { border-left: 4px solid #f59e0b; }
.stat-err  { border-left: 4px solid #dc2626; }
.stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
.stat-value { font-size: 18px; font-weight: 700; color: #111; margin-top: 4px; }
.filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.uc-badge {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
}
.uc-badge-success { background: #ecfdf5; color: #047857; }
.uc-badge-warning { background: #fef3c7; color: #b45309; }
.uc-badge-danger  { background: #fef2f2; color: #dc2626; }
</style>
