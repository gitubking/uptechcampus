<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { UcModal, UcFormGroup, UcFormGrid, UcPageHeader } from '@/components/ui'

const auth = useAuthStore()
const canWrite    = ['secretariat', 'resp_fin', 'dg'].includes(auth.user?.role ?? '')
const canValidate = ['resp_fin', 'dg'].includes(auth.user?.role ?? '')
const canCancel   = auth.user?.role === 'dg'
const canDelete   = auth.user?.role === 'dg'

interface User { id: number; name: string }
interface Exoneration {
  id: number
  inscription_id: number
  etudiant_id: number
  matricule: string | null
  etudiant_nom: string
  filiere_nom: string | null
  annee_libelle: string | null
  motif: string
  portee: string
  mois_concerne: string | null
  mode_calcul: 'pourcentage' | 'montant_fixe'
  valeur: number
  montant_applique: number
  libelle: string | null
  piece_justificative_url: string | null
  statut: 'en_attente' | 'validee' | 'rejetee' | 'annulee'
  date_effet: string | null
  date_fin: string | null
  motif_rejet: string | null
  motif_annulation: string | null
  notes: string | null
  created_at: string
  validee_at: string | null
  annulee_at: string | null
  demande_par_user?: User | null
  validee_par_user?: User | null
}

interface Inscription {
  id: number
  etudiant: { id: number; nom: string; prenom: string; numero_etudiant: string }
  filiere: { nom: string } | null
  annee_academique: { id: number; libelle: string } | null
  statut: string
}

const MOTIFS: Array<{ code: string; label: string }> = [
  { code: 'bourse_merite',      label: 'Bourse de mérite' },
  { code: 'bourse_sociale',     label: 'Bourse sociale' },
  { code: 'convention',         label: 'Convention / Partenariat' },
  { code: 'enfant_personnel',   label: 'Enfant du personnel' },
  { code: 'decision_dg',        label: 'Décision DG' },
  { code: 'autre',              label: 'Autre' },
]
const PORTEES: Array<{ code: string; label: string; description?: string }> = [
  { code: 'totale',                label: 'Totalité des frais',    description: 'Applique sur inscription + tenue + toutes les mensualités' },
  { code: 'inscription',           label: 'Frais d\'inscription uniquement' },
  { code: 'tenue',                 label: 'Tenue uniquement' },
  { code: 'mensualites_toutes',    label: 'Toutes les mensualités' },
  { code: 'mensualite_specifique', label: 'Une mensualité spécifique',  description: 'Précisez le mois concerné' },
]
function motifLabel(c: string) { return MOTIFS.find(m => m.code === c)?.label ?? c }
function porteeLabel(c: string) { return PORTEES.find(p => p.code === c)?.label ?? c }

// ── State ───────────────────────────────────────────────────────────────────
const exonerations = ref<Exoneration[]>([])
const inscriptions = ref<Inscription[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')

// Filtres
const fStatut = ref<'' | 'en_attente' | 'validee' | 'rejetee' | 'annulee'>('')
const fMotif = ref('')
const fSearch = ref('')

// Modal create/edit
const showForm = ref(false)
const editingId = ref<number | null>(null)
const form = ref({
  inscription_id: 0,
  motif: 'bourse_merite',
  portee: 'mensualites_toutes',
  mois_concerne: '',
  mode_calcul: 'pourcentage' as 'pourcentage' | 'montant_fixe',
  valeur: 0,
  libelle: '',
  piece_justificative_url: '',
  date_effet: new Date().toISOString().slice(0, 10),
  date_fin: '',
  notes: '',
})

// Rejet / Annulation
const showRejet = ref(false)
const rejetId = ref<number | null>(null)
const rejetMotif = ref('')
const showAnnuler = ref(false)
const annulerId = ref<number | null>(null)
const annulerMotif = ref('')

// Détail
const showDetail = ref(false)
const detail = ref<any>(null)

function fmtMoney(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)).replace(/\u202F/g, ' ') + ' FCFA'
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtMoisConcerne(d: string | null) {
  if (!d) return ''
  const dt = new Date(d)
  return dt.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}
function statutLabel(s: string) {
  return { en_attente: 'En attente', validee: 'Validée', rejetee: 'Rejetée', annulee: 'Annulée' }[s] ?? s
}
function statutClass(s: string) {
  return {
    en_attente: 'uc-badge uc-badge-warning',
    validee:    'uc-badge uc-badge-success',
    rejetee:    'uc-badge uc-badge-danger',
    annulee:    'uc-badge uc-badge-neutral',
  }[s] ?? 'uc-badge'
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, string> = {}
    if (fStatut.value) params.statut = fStatut.value
    if (fMotif.value)  params.motif = fMotif.value
    const { data } = await api.get('/exonerations', { params })
    exonerations.value = (data.data ?? data) as Exoneration[]
  } finally {
    loading.value = false
  }
}

async function loadInscriptions() {
  try {
    const { data } = await api.get('/inscriptions', { params: { statut: 'active' } })
    inscriptions.value = (data as Inscription[]).sort((a, b) =>
      `${a.etudiant.nom} ${a.etudiant.prenom}`.localeCompare(`${b.etudiant.nom} ${b.etudiant.prenom}`)
    )
  } catch { inscriptions.value = [] }
}

const filtered = computed(() => {
  const s = fSearch.value.trim().toLowerCase()
  if (!s) return exonerations.value
  return exonerations.value.filter(e =>
    (e.etudiant_nom || '').toLowerCase().includes(s) ||
    (e.matricule || '').toLowerCase().includes(s) ||
    (e.filiere_nom || '').toLowerCase().includes(s) ||
    (e.libelle || '').toLowerCase().includes(s)
  )
})

const totaux = computed(() => {
  const stats = { validee_count: 0, validee_montant: 0, en_attente_count: 0, annulee_count: 0 }
  for (const e of exonerations.value) {
    if (e.statut === 'validee')    { stats.validee_count++;    stats.validee_montant += Number(e.montant_applique) }
    if (e.statut === 'en_attente') { stats.en_attente_count++ }
    if (e.statut === 'annulee')    { stats.annulee_count++ }
  }
  return stats
})

function openCreate() {
  editingId.value = null
  form.value = {
    inscription_id: inscriptions.value[0]?.id ?? 0,
    motif: 'bourse_merite',
    portee: 'mensualites_toutes',
    mois_concerne: '',
    mode_calcul: 'pourcentage',
    valeur: 0,
    libelle: '',
    piece_justificative_url: '',
    date_effet: new Date().toISOString().slice(0, 10),
    date_fin: '',
    notes: '',
  }
  error.value = ''
  showForm.value = true
}

function openEdit(e: Exoneration) {
  editingId.value = e.id
  form.value = {
    inscription_id: e.inscription_id,
    motif: e.motif,
    portee: e.portee,
    mois_concerne: e.mois_concerne ? e.mois_concerne.slice(0, 7) : '',
    mode_calcul: e.mode_calcul,
    valeur: Number(e.valeur),
    libelle: e.libelle ?? '',
    piece_justificative_url: e.piece_justificative_url ?? '',
    date_effet: e.date_effet ? e.date_effet.slice(0, 10) : '',
    date_fin: e.date_fin ? e.date_fin.slice(0, 10) : '',
    notes: e.notes ?? '',
  }
  error.value = ''
  showForm.value = true
}

async function save() {
  if (!form.value.inscription_id) { error.value = 'Sélectionnez un étudiant.'; return }
  if (!(form.value.valeur > 0))   { error.value = 'Valeur doit être supérieure à 0.'; return }
  if (form.value.mode_calcul === 'pourcentage' && form.value.valeur > 100) {
    error.value = 'Un pourcentage ne peut pas dépasser 100%.'; return
  }
  if (form.value.portee === 'mensualite_specifique' && !form.value.mois_concerne) {
    error.value = 'Précisez le mois concerné.'; return
  }
  saving.value = true
  error.value = ''
  try {
    const payload = { ...form.value, mois_concerne: form.value.mois_concerne || null, date_fin: form.value.date_fin || null }
    if (editingId.value) {
      await api.put(`/exonerations/${editingId.value}`, payload)
    } else {
      await api.post('/exonerations', payload)
    }
    showForm.value = false
    await load()
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur'
  } finally {
    saving.value = false
  }
}

async function valider(e: Exoneration) {
  const msg = `Valider cette exonération pour ${e.etudiant_nom} ?\n\n${porteeLabel(e.portee)} — ${e.mode_calcul === 'pourcentage' ? e.valeur + '%' : fmtMoney(Number(e.valeur))}\n\nL'exonération sera appliquée aux échéances concernées.`
  if (!confirm(msg)) return
  try {
    await api.post(`/exonerations/${e.id}/valider`)
    await load()
  } catch (err: any) {
    alert(err.response?.data?.message ?? 'Erreur')
  }
}

function openRejet(e: Exoneration) { rejetId.value = e.id; rejetMotif.value = ''; showRejet.value = true }
async function confirmRejet() {
  if (!rejetId.value) return
  try {
    await api.post(`/exonerations/${rejetId.value}/rejeter`, { motif: rejetMotif.value || null })
    showRejet.value = false
    await load()
  } catch (err: any) { alert(err.response?.data?.message ?? 'Erreur') }
}

function openAnnuler(e: Exoneration) { annulerId.value = e.id; annulerMotif.value = ''; showAnnuler.value = true }
async function confirmAnnuler() {
  if (!annulerId.value) return
  try {
    await api.post(`/exonerations/${annulerId.value}/annuler`, { motif: annulerMotif.value || null })
    showAnnuler.value = false
    await load()
  } catch (err: any) { alert(err.response?.data?.message ?? 'Erreur') }
}

async function supprimer(e: Exoneration) {
  const warn = e.statut === 'validee'
    ? `Supprimer cette exonération VALIDÉE ?\nL'exonération sera retirée des échéances avant suppression.`
    : `Supprimer cette exonération ?`
  if (!confirm(warn)) return
  try {
    await api.delete(`/exonerations/${e.id}`)
    await load()
  } catch (err: any) { alert(err.response?.data?.message ?? 'Erreur') }
}

async function openDetail(e: Exoneration) {
  try {
    const { data } = await api.get(`/exonerations/${e.id}`)
    detail.value = data
    showDetail.value = true
  } catch (err: any) { alert(err.response?.data?.message ?? 'Erreur') }
}

onMounted(async () => {
  await Promise.all([load(), loadInscriptions()])
})
</script>

<template>
  <div class="uc-content">
    <UcPageHeader
      title="Exonérations"
      subtitle="Bourses, remises et décisions DG — suivi des exonérations accordées aux étudiants"
    >
      <template #actions>
        <button v-if="canWrite" @click="openCreate" class="uc-btn-primary">+ Nouvelle exonération</button>
      </template>
    </UcPageHeader>

    <!-- Stats -->
    <div class="stats-row">
      <div class="stat-card stat-ok">
        <div class="stat-label">Validées (montant)</div>
        <div class="stat-value">{{ fmtMoney(totaux.validee_montant) }}</div>
        <div class="stat-sub">{{ totaux.validee_count }} ligne(s)</div>
      </div>
      <div class="stat-card stat-warn">
        <div class="stat-label">En attente</div>
        <div class="stat-value">{{ totaux.en_attente_count }}</div>
      </div>
      <div class="stat-card stat-neutral">
        <div class="stat-label">Annulées</div>
        <div class="stat-value">{{ totaux.annulee_count }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total lignes</div>
        <div class="stat-value">{{ exonerations.length }}</div>
      </div>
    </div>

    <!-- Filtres -->
    <div class="filters">
      <select v-model="fStatut" @change="load" class="uc-input">
        <option value="">Tous statuts</option>
        <option value="en_attente">En attente</option>
        <option value="validee">Validées</option>
        <option value="rejetee">Rejetées</option>
        <option value="annulee">Annulées</option>
      </select>
      <select v-model="fMotif" @change="load" class="uc-input">
        <option value="">Tous motifs</option>
        <option v-for="m in MOTIFS" :key="m.code" :value="m.code">{{ m.label }}</option>
      </select>
      <input v-model="fSearch" placeholder="Recherche étudiant, matricule, filière…" class="uc-input" style="flex:1;min-width:200px;" />
    </div>

    <!-- Table -->
    <div class="uc-table-wrap">
      <div v-if="loading" class="uc-empty">Chargement…</div>
      <div v-else-if="filtered.length === 0" class="uc-empty">Aucune exonération</div>
      <table v-else class="uc-table">
        <thead>
          <tr>
            <th>Étudiant</th>
            <th>Filière / Année</th>
            <th>Motif</th>
            <th>Portée</th>
            <th style="text-align:right;">Valeur</th>
            <th style="text-align:right;">Appliqué</th>
            <th>Statut</th>
            <th>Demandé le</th>
            <th style="text-align:center;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in filtered" :key="e.id">
            <td>
              <div style="font-weight:600;">{{ e.etudiant_nom }}</div>
              <div style="font-size:11px;color:#64748b;font-family:monospace;">{{ e.matricule || '—' }}</div>
            </td>
            <td>
              <div>{{ e.filiere_nom || '—' }}</div>
              <div style="font-size:11px;color:#64748b;">{{ e.annee_libelle || '' }}</div>
            </td>
            <td>
              <div>{{ motifLabel(e.motif) }}</div>
              <div v-if="e.libelle" style="font-size:11px;color:#64748b;">{{ e.libelle }}</div>
            </td>
            <td>
              <div>{{ porteeLabel(e.portee) }}</div>
              <div v-if="e.mois_concerne" style="font-size:11px;color:#64748b;">{{ fmtMoisConcerne(e.mois_concerne) }}</div>
            </td>
            <td style="text-align:right;font-weight:700;">
              <span v-if="e.mode_calcul === 'pourcentage'">{{ Number(e.valeur) }}%</span>
              <span v-else>{{ fmtMoney(Number(e.valeur)) }}</span>
            </td>
            <td style="text-align:right;font-weight:700;color:#047857;">
              {{ Number(e.montant_applique) > 0 ? fmtMoney(Number(e.montant_applique)) : '—' }}
            </td>
            <td>
              <span :class="statutClass(e.statut)">{{ statutLabel(e.statut) }}</span>
              <div v-if="e.statut === 'rejetee' && e.motif_rejet" style="font-size:11px;color:#dc2626;margin-top:2px;">{{ e.motif_rejet }}</div>
              <div v-if="e.statut === 'annulee' && e.motif_annulation" style="font-size:11px;color:#64748b;margin-top:2px;">{{ e.motif_annulation }}</div>
            </td>
            <td style="font-size:12px;color:#64748b;">{{ fmtDate(e.created_at) }}</td>
            <td style="text-align:center;">
              <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
                <button @click="openDetail(e)" class="uc-btn-xs" style="background:#f8fafc;color:#334155;border-color:#e2e8f0;">👁️</button>
                <button v-if="canValidate && e.statut === 'en_attente'"
                        @click="valider(e)" class="uc-btn-xs"
                        style="background:#ecfdf5;color:#047857;border-color:#a7f3d0;">✓ Valider</button>
                <button v-if="canValidate && e.statut === 'en_attente'"
                        @click="openRejet(e)" class="uc-btn-xs"
                        style="background:#fef2f2;color:#dc2626;border-color:#fecaca;">✗ Rejeter</button>
                <button v-if="canWrite && (e.statut === 'en_attente' || e.statut === 'rejetee')"
                        @click="openEdit(e)" class="uc-btn-xs"
                        style="background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;">✏️</button>
                <button v-if="canCancel && e.statut === 'validee'"
                        @click="openAnnuler(e)" class="uc-btn-xs"
                        style="background:#fef3c7;color:#b45309;border-color:#fde68a;">↶ Annuler</button>
                <button v-if="canDelete"
                        @click="supprimer(e)" class="uc-btn-xs"
                        style="background:#fef2f2;color:#dc2626;border-color:#fecaca;">🗑️</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal create/edit -->
    <UcModal v-model="showForm"
      :title="editingId ? 'Modifier l\'exonération' : 'Nouvelle exonération'"
      width="620px"
      @close="error = ''">
      <div v-if="error" class="uc-alert uc-alert-error" style="margin-bottom:12px;">{{ error }}</div>
      <UcFormGrid :cols="2">
        <UcFormGroup label="Étudiant / Inscription" :required="true" :span="2">
          <select v-model.number="form.inscription_id" class="uc-input" :disabled="!!editingId">
            <option :value="0" disabled>— Choisir un étudiant —</option>
            <option v-for="i in inscriptions" :key="i.id" :value="i.id">
              {{ i.etudiant.nom }} {{ i.etudiant.prenom }} ({{ i.etudiant.numero_etudiant }}) — {{ i.filiere?.nom || '—' }} / {{ i.annee_academique?.libelle || '' }}
            </option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Motif" :required="true">
          <select v-model="form.motif" class="uc-input">
            <option v-for="m in MOTIFS" :key="m.code" :value="m.code">{{ m.label }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Portée" :required="true">
          <select v-model="form.portee" class="uc-input">
            <option v-for="p in PORTEES" :key="p.code" :value="p.code">{{ p.label }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup v-if="form.portee === 'mensualite_specifique'" label="Mois concerné" :required="true" :span="2">
          <input v-model="form.mois_concerne" type="month" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Mode de calcul" :required="true">
          <select v-model="form.mode_calcul" class="uc-input">
            <option value="pourcentage">Pourcentage (%)</option>
            <option value="montant_fixe">Montant fixe (FCFA)</option>
          </select>
        </UcFormGroup>
        <UcFormGroup :label="form.mode_calcul === 'pourcentage' ? 'Pourcentage (%)' : 'Montant (FCFA)'" :required="true">
          <input v-model.number="form.valeur" type="number" min="0" :max="form.mode_calcul === 'pourcentage' ? 100 : undefined" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Libellé / Justification" :span="2">
          <input v-model="form.libelle" class="uc-input" placeholder="Ex: Bourse d'excellence — 1er de promo 2025" />
        </UcFormGroup>
        <UcFormGroup label="Date d'effet">
          <input v-model="form.date_effet" type="date" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Date de fin (optionnel)">
          <input v-model="form.date_fin" type="date" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="URL pièce justificative" :span="2">
          <input v-model="form.piece_justificative_url" class="uc-input" placeholder="https://…" />
        </UcFormGroup>
        <UcFormGroup label="Notes internes" :span="2">
          <textarea v-model="form.notes" rows="2" class="uc-input" />
        </UcFormGroup>
      </UcFormGrid>
      <template #footer>
        <button @click="showForm = false" class="uc-btn-outline">Annuler</button>
        <button @click="save" :disabled="saving" class="uc-btn-primary">
          {{ saving ? 'Enregistrement…' : (editingId ? 'Mettre à jour' : 'Soumettre') }}
        </button>
      </template>
    </UcModal>

    <!-- Modal détail -->
    <UcModal v-model="showDetail" title="Détail de l'exonération" width="640px">
      <div v-if="detail" class="detail-box">
        <div class="detail-row"><span>Étudiant</span><strong>{{ detail.etudiant_nom }} ({{ detail.matricule || '—' }})</strong></div>
        <div class="detail-row"><span>Filière / Année</span><strong>{{ detail.filiere_nom || '—' }} — {{ detail.annee_libelle || '' }}</strong></div>
        <div class="detail-row"><span>Motif</span><strong>{{ motifLabel(detail.motif) }}</strong></div>
        <div class="detail-row"><span>Portée</span><strong>{{ porteeLabel(detail.portee) }}</strong></div>
        <div class="detail-row" v-if="detail.mois_concerne"><span>Mois concerné</span><strong>{{ fmtMoisConcerne(detail.mois_concerne) }}</strong></div>
        <div class="detail-row"><span>Mode / Valeur</span>
          <strong>
            <template v-if="detail.mode_calcul === 'pourcentage'">{{ Number(detail.valeur) }}%</template>
            <template v-else>{{ fmtMoney(Number(detail.valeur)) }}</template>
          </strong>
        </div>
        <div class="detail-row"><span>Montant appliqué</span><strong style="color:#047857;">{{ fmtMoney(Number(detail.montant_applique)) }}</strong></div>
        <div class="detail-row"><span>Statut</span><span :class="statutClass(detail.statut)">{{ statutLabel(detail.statut) }}</span></div>
        <div class="detail-row" v-if="detail.libelle"><span>Libellé</span><strong>{{ detail.libelle }}</strong></div>
        <div class="detail-row" v-if="detail.notes"><span>Notes</span><strong>{{ detail.notes }}</strong></div>
        <div class="detail-row" v-if="detail.piece_justificative_url">
          <span>Pièce</span>
          <a :href="detail.piece_justificative_url" target="_blank" rel="noopener noreferrer">Voir la pièce ↗</a>
        </div>

        <h4 style="margin:16px 0 8px;font-size:13px;color:#334155;">Échéances impactées</h4>
        <table v-if="detail.lignes?.length" class="uc-table" style="font-size:13px;">
          <thead>
            <tr>
              <th>Type</th>
              <th>Mois</th>
              <th style="text-align:right;">Montant échéance</th>
              <th style="text-align:right;">Montant exonéré</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in detail.lignes" :key="l.id">
              <td>{{ l.type_echeance }}</td>
              <td>{{ fmtMoisConcerne(l.mois) }}</td>
              <td style="text-align:right;">{{ fmtMoney(Number(l.montant_echeance)) }}</td>
              <td style="text-align:right;color:#047857;font-weight:700;">{{ fmtMoney(Number(l.montant)) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="uc-empty" style="padding:8px;">Aucune application (statut non validé ou portée vide)</div>
      </div>
      <template #footer>
        <button @click="showDetail = false" class="uc-btn-outline">Fermer</button>
      </template>
    </UcModal>

    <!-- Modal rejet -->
    <UcModal v-model="showRejet" title="Rejeter l'exonération" width="420px">
      <UcFormGroup label="Motif du rejet">
        <textarea v-model="rejetMotif" rows="3" class="uc-input" placeholder="Raison du rejet…" />
      </UcFormGroup>
      <template #footer>
        <button @click="showRejet = false" class="uc-btn-outline">Annuler</button>
        <button @click="confirmRejet" class="uc-btn-primary" style="background:#dc2626;border-color:#dc2626;">Confirmer le rejet</button>
      </template>
    </UcModal>

    <!-- Modal annulation -->
    <UcModal v-model="showAnnuler" title="Annuler l'exonération" width="420px">
      <div class="uc-alert uc-alert-warning" style="margin-bottom:12px;">
        L'exonération sera retirée des échéances. Les échéances seront recalculées.
      </div>
      <UcFormGroup label="Motif de l'annulation">
        <textarea v-model="annulerMotif" rows="3" class="uc-input" placeholder="Raison de l'annulation…" />
      </UcFormGroup>
      <template #footer>
        <button @click="showAnnuler = false" class="uc-btn-outline">Retour</button>
        <button @click="confirmAnnuler" class="uc-btn-primary" style="background:#b45309;border-color:#b45309;">Confirmer l'annulation</button>
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
.stat-ok      { border-left: 4px solid #10b981; }
.stat-warn    { border-left: 4px solid #f59e0b; }
.stat-neutral { border-left: 4px solid #64748b; }
.stat-label   { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
.stat-value   { font-size: 18px; font-weight: 700; color: #111; margin-top: 4px; }
.stat-sub     { font-size: 11px; color: #64748b; margin-top: 2px; }
.filters      { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.uc-badge {
  display: inline-block; padding: 2px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 600;
}
.uc-badge-success { background: #ecfdf5; color: #047857; }
.uc-badge-warning { background: #fef3c7; color: #b45309; }
.uc-badge-danger  { background: #fef2f2; color: #dc2626; }
.uc-badge-neutral { background: #f1f5f9; color: #475569; }
.detail-box { display: flex; flex-direction: column; gap: 6px; }
.detail-row {
  display: flex; justify-content: space-between; padding: 6px 0;
  border-bottom: 1px dashed #e5e7eb; font-size: 13px;
}
.detail-row span { color: #64748b; }
.detail-row strong { color: #111; }
</style>
