<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import { useAuthStore } from '@/stores/auth'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcFormGrid from '@/components/ui/UcFormGrid.vue'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'

const auth = useAuthStore()
const toast = useToast()
const router = useRouter()
const canWrite = computed(() => ['dg', 'dir_peda', 'secretariat'].includes(auth.user?.role ?? ''))

interface AnneeAcademique { id: number; libelle: string; actif: boolean }
interface Enseignant {
  id: number; nom: string; prenom: string; email: string
  telephone: string | null; statut: string; numero_contrat: string
  specialite: string | null; grade: string | null
  type_contrat: string | null; tarif_horaire: number | null
  annee_academique_id: number; annee_academique?: AnneeAcademique
  mes_ues?: { code: string; intitule: string; classe?: { nom: string } }[]
}

const enseignants = ref<Enseignant[]>([])
const annees = ref<AnneeAcademique[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const refsError = ref('')
const showForm = ref(false)
const editTarget = ref<Enseignant | null>(null)
const search = ref('')
const filterStatut = ref('')
let searchTimer: ReturnType<typeof setTimeout>

const page = ref(1)
const total = ref(0)
const lastPage = ref(1)

const form = ref({
  nom: '', prenom: '', email: '', telephone: '',
  specialite: '', grade: '', type_contrat: 'vacataire', tarif_horaire: 0,
  statut: 'en_attente', annee_academique_id: '' as number | string | null,
})

const statutConfig: Record<string, { label: string; cls: string }> = {
  actif:      { label: 'Actif',       cls: 'ens-badge-actif' },
  en_attente: { label: 'En attente',  cls: 'ens-badge-attente' },
  inactif:    { label: 'Inactif',     cls: 'ens-badge-inactif' },
  suspendu:   { label: 'Suspendu',    cls: 'ens-badge-suspendu' },
}
const typeContratLabels: Record<string, string> = {
  vacataire: 'Vacataire', cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', stagiaire: 'Stagiaire'
}

function openCreate() {
  editTarget.value = null
  const anneeActive = annees.value.find(a => a.actif)
  form.value = {
    nom: '', prenom: '', email: '', telephone: '',
    specialite: '', grade: '', type_contrat: 'vacataire', tarif_horaire: 0,
    statut: 'en_attente',
    annee_academique_id: anneeActive?.id ?? annees.value[0]?.id ?? '',
  }
  error.value = ''
  showForm.value = true
}

function openEdit(i: Enseignant) {
  editTarget.value = i
  form.value = {
    nom: i.nom, prenom: i.prenom, email: i.email, telephone: i.telephone ?? '',
    specialite: i.specialite ?? '', grade: i.grade ?? '',
    type_contrat: i.type_contrat ?? 'vacataire',
    tarif_horaire: i.tarif_horaire ?? 0,
    statut: i.statut,
    annee_academique_id: i.annee_academique_id,
  }
  error.value = ''
  showForm.value = true
}

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; load() }, 350)
}

function waLink(e: Enseignant) {
  if (!e.telephone) return ''
  let p = e.telephone.replace(/[\s\-\.\(\)]/g, '')
  if (p.startsWith('00221')) p = '+' + p.slice(2)
  else if (/^\d{9}$/.test(p)) p = '+221' + p
  else if (/^221\d{9}$/.test(p)) p = '+' + p
  else if (!p.startsWith('+')) p = '+221' + p
  const msg = encodeURIComponent(`Bonjour ${e.prenom},\n\nNous vous contactons de la part d'Uptech Campus.`)
  return `https://wa.me/${p.replace('+','')}?text=${msg}`
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, any> = { page: page.value }
    if (search.value) params.search = search.value
    if (filterStatut.value) params.statut = filterStatut.value
    const { data } = await api.get('/enseignants', { params })
    enseignants.value = data.data as Enseignant[]
    total.value = data.total
    lastPage.value = data.last_page
  } finally { loading.value = false }
}

async function loadRefs() {
  try {
    const { data } = await api.get('/annees-academiques')
    annees.value = Array.isArray(data) ? data : []
  } catch (e: any) {
    refsError.value = 'Impossible de charger les années académiques'
  }
}

async function save() {
  saving.value = true; error.value = ''
  try {
    const payload: any = {
      nom: form.value.nom, prenom: form.value.prenom, email: form.value.email,
      telephone: form.value.telephone || null,
      specialite: form.value.specialite || null,
      grade: form.value.grade || null,
      type_contrat: form.value.type_contrat,
      tarif_horaire: Number(form.value.tarif_horaire) || 0,
      statut: form.value.statut,
      annee_academique_id: form.value.annee_academique_id || null,
    }
    if (editTarget.value) {
      const { data } = await api.put(`/enseignants/${editTarget.value.id}`, payload)
      const idx = enseignants.value.findIndex(i => i.id === data.id)
      if (idx !== -1) enseignants.value[idx] = { ...enseignants.value[idx], ...data }
    } else {
      await api.post('/enseignants', payload)
      await load()
    }
    showForm.value = false
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur lors de la sauvegarde'
  } finally { saving.value = false }
}

async function deleteEnseignant(i: Enseignant) {
  if (!confirm(`Supprimer ${i.prenom} ${i.nom} ?`)) return
  try {
    await api.delete(`/enseignants/${i.id}`)
    enseignants.value = enseignants.value.filter(e => e.id !== i.id)
    total.value--
  } catch (e: any) {
    toast.apiError(e, 'Impossible de supprimer')
  }
}

onMounted(async () => { await Promise.all([load(), loadRefs()]) })
</script>

<template>
  <div class="uc-content">

    <UcPageHeader title="Enseignants" subtitle="Formateurs, vacataires et intervenants">
      <template #actions>
        <a href="/emargement" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#E30613;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">
          ✍️ Émargement
        </a>
        <a href="/suivi-emargements" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#1e293b;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">
          📊 Suivi émargements
        </a>
        <a href="/cahier-de-textes" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;background:#1e293b;color:#fff;font-size:12px;font-weight:600;text-decoration:none;">
          📓 Cahier de textes
        </a>
        <button v-if="canWrite" @click="openCreate" class="ens-btn-add">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
          </svg>
          Nouvel enseignant
        </button>
      </template>
    </UcPageHeader>

    <!-- KPI Bar -->
    <div class="ens-kpi-row">
      <div class="ens-kpi">
        <span class="ens-kpi-val">{{ total }}</span>
        <span class="ens-kpi-lbl">Total</span>
      </div>
      <div class="ens-kpi">
        <span class="ens-kpi-val" style="color:#16a34a">{{ enseignants.filter(e=>e.statut==='actif').length }}</span>
        <span class="ens-kpi-lbl">Actifs</span>
      </div>
      <div class="ens-kpi">
        <span class="ens-kpi-val" style="color:#d97706">{{ enseignants.filter(e=>e.statut==='en_attente').length }}</span>
        <span class="ens-kpi-lbl">En attente</span>
      </div>
      <div class="ens-kpi">
        <span class="ens-kpi-val">{{ enseignants.filter(e=>e.type_contrat==='vacataire').length }}</span>
        <span class="ens-kpi-lbl">Vacataires</span>
      </div>
    </div>

    <!-- Filtres -->
    <div class="ens-filters">
      <div style="position:relative;flex:1;max-width:280px;">
        <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:#9ca3af;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
        </svg>
        <input v-model="search" @input="onSearchInput" placeholder="Rechercher un enseignant…" class="ens-search"/>
      </div>
      <select v-model="filterStatut" @change="page=1;load()" class="ens-select">
        <option value="">Tous les statuts</option>
        <option value="actif">Actif</option>
        <option value="en_attente">En attente</option>
        <option value="inactif">Inactif</option>
        <option value="suspendu">Suspendu</option>
      </select>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="ens-empty">Chargement…</div>

    <!-- Empty -->
    <div v-else-if="enseignants.length === 0" class="ens-empty">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:40px;height:40px;color:#d1d5db;margin-bottom:8px;">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
      </svg>
      <p style="color:#6b7280;font-size:13px;">Aucun enseignant trouvé</p>
    </div>

    <!-- Table -->
    <div v-else class="ens-table-wrap">
      <table class="ens-table">
        <thead>
          <tr>
            <th>Enseignant</th>
            <th>Type / Contrat</th>
            <th>Spécialité</th>
            <th>Matières enseignées</th>
            <th>Tarif / h</th>
            <th>Statut</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in enseignants" :key="e.id">
            <!-- Enseignant -->
            <td>
              <div style="display:flex;align-items:center;gap:10px;">
                <div class="ens-avatar">{{ e.prenom[0] }}{{ e.nom[0] }}</div>
                <div>
                  <div style="font-weight:600;font-size:13px;color:#111;">{{ e.prenom }} {{ e.nom }}</div>
                  <div style="font-size:11.5px;color:#6b7280;">{{ e.email }}</div>
                  <div v-if="e.telephone" style="font-size:11px;color:#9ca3af;">{{ e.telephone }}</div>
                </div>
              </div>
            </td>
            <!-- Type contrat -->
            <td>
              <div>
                <span class="ens-tag-contrat">{{ typeContratLabels[e.type_contrat ?? ''] ?? e.type_contrat ?? '—' }}</span>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:3px;font-family:monospace;">{{ e.numero_contrat }}</div>
            </td>
            <!-- Spécialité -->
            <td>
              <div style="font-size:12.5px;color:#374151;">{{ e.specialite ?? '—' }}</div>
              <div v-if="e.grade" style="font-size:11px;color:#9ca3af;">{{ e.grade }}</div>
            </td>
            <!-- Matières enseignées (via UEs dans les classes) -->
            <td>
              <div v-if="e.mes_ues?.length" style="display:flex;flex-wrap:wrap;gap:4px;">
                <span v-for="ue in e.mes_ues?.slice(0,3)" :key="ue.code" class="ens-tag-filiere"
                  :title="ue.classe?.nom ?? ''">
                  {{ ue.intitule?.substring(0,20) }}
                </span>
                <span v-if="(e.mes_ues?.length ?? 0) > 3" class="ens-tag-more">+{{ (e.mes_ues?.length ?? 0) - 3 }}</span>
              </div>
              <span v-else style="font-size:12px;color:#9ca3af;font-style:italic;">Aucune matière assignée</span>
            </td>
            <!-- Tarif -->
            <td>
              <span v-if="e.tarif_horaire" style="font-size:13px;font-weight:600;color:#374151;">
                {{ Math.round(e.tarif_horaire).toLocaleString('fr-FR') }} FCFA
              </span>
              <span v-else style="font-size:12px;color:#9ca3af;">—</span>
            </td>
            <!-- Statut -->
            <td>
              <span :class="statutConfig[e.statut]?.cls ?? 'ens-badge-inactif'">
                {{ statutConfig[e.statut]?.label ?? e.statut }}
              </span>
            </td>
            <!-- Actions -->
            <td style="text-align:right;">
              <div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;">
                <!-- WhatsApp -->
                <a v-if="e.telephone" :href="waLink(e)" target="_blank" class="ens-action-btn" title="WhatsApp" style="color:#16a34a;">
                  <svg viewBox="0 0 24 24" fill="currentColor" style="width:15px;height:15px;">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </a>
                <!-- Modifier -->
                <button v-if="canWrite" @click="openEdit(e)" class="ens-action-btn" title="Modifier">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                  </svg>
                </button>
                <!-- Voir fiche -->
                <button @click="router.push(`/enseignants/${e.id}`)" class="ens-action-btn ens-action-view" title="Voir la fiche">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="lastPage > 1" class="ens-pagination">
      <span style="font-size:12.5px;color:#6b7280;">Page {{ page }} / {{ lastPage }}</span>
      <div style="display:flex;gap:8px;">
        <button :disabled="page===1" @click="page--;load()" class="ens-page-btn">Précédent</button>
        <button :disabled="page===lastPage" @click="page++;load()" class="ens-page-btn">Suivant</button>
      </div>
    </div>

    <!-- Modal formulaire -->
    <UcModal v-model="showForm" :title="editTarget ? 'Modifier l\'enseignant' : 'Nouvel enseignant'" @close="showForm=false">
      <div v-if="!editTarget" class="ens-info-banner">
        Un compte sera créé automatiquement avec le mot de passe <strong>Uptech@2026</strong>
      </div>
      <div v-if="error" class="ens-error-banner">{{ error }}</div>

      <form @submit.prevent="save" style="display:flex;flex-direction:column;gap:14px;">
        <UcFormGrid :cols="2">
          <UcFormGroup label="Prénom" :required="true">
            <input v-model="form.prenom" required placeholder="Amadou"/>
          </UcFormGroup>
          <UcFormGroup label="Nom" :required="true">
            <input v-model="form.nom" required placeholder="DIALLO"/>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGrid :cols="2">
          <UcFormGroup label="Email" :required="true">
            <input v-model="form.email" type="email" required placeholder="prof@uptech.sn"/>
          </UcFormGroup>
          <UcFormGroup label="Téléphone">
            <input v-model="form.telephone" placeholder="77 000 00 00"/>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGrid :cols="2">
          <UcFormGroup label="Spécialité">
            <input v-model="form.specialite" placeholder="Développement Web, Infographie…"/>
          </UcFormGroup>
          <UcFormGroup label="Grade / Titre">
            <input v-model="form.grade" placeholder="Formateur, Expert, Ingénieur…"/>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGrid :cols="3">
          <UcFormGroup label="Type de contrat">
            <select v-model="form.type_contrat">
              <option value="vacataire">Vacataire</option>
              <option value="cdi">CDI</option>
              <option value="cdd">CDD</option>
              <option value="freelance">Freelance</option>
              <option value="stagiaire">Stagiaire</option>
            </select>
          </UcFormGroup>
          <UcFormGroup label="Tarif horaire (FCFA)">
            <input v-model.number="form.tarif_horaire" type="number" min="0" step="500" placeholder="5000"/>
          </UcFormGroup>
          <UcFormGroup label="Statut">
            <select v-model="form.statut">
              <option value="en_attente">En attente</option>
              <option value="actif">Actif</option>
              <option value="inactif">Inactif</option>
              <option value="suspendu">Suspendu</option>
            </select>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGroup v-if="!editTarget" label="Année académique" :required="true">
          <div v-if="refsError" style="color:#b91c1c;font-size:12px;margin-bottom:4px;">{{ refsError }} — <button type="button" @click="loadRefs" style="color:#E30613;background:none;border:none;cursor:pointer;padding:0;font-size:12px;text-decoration:underline;">Réessayer</button></div>
          <select v-model="form.annee_academique_id" required :disabled="annees.length === 0">
            <option value="" disabled>-- Sélectionner une année --</option>
            <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
          </select>
        </UcFormGroup>

        <!-- Info : affectation des matières se fait dans les classes -->
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 14px;font-size:12.5px;color:#1e40af;">
          💡 Les matières sont assignées à l'enseignant directement dans chaque classe, onglet <strong>Matières & UE</strong>.
        </div>
      </form>

      <template #footer>
        <button type="button" @click="showForm=false" class="ens-btn-cancel">Annuler</button>
        <button type="button" @click="save" :disabled="saving" class="ens-btn-save">
          {{ saving ? 'Enregistrement…' : (editTarget ? 'Enregistrer' : 'Créer l\'enseignant') }}
        </button>
      </template>
    </UcModal>

  </div>
</template>

<style scoped>
/* KPI Row */
.ens-kpi-row { display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap; }
.ens-kpi { background:#fff;border:1.5px solid #e5e7eb;border-radius:8px;padding:12px 20px;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:90px; }
.ens-kpi-val { font-size:22px;font-weight:700;color:#111;font-family:'Poppins',sans-serif; }
.ens-kpi-lbl { font-size:10.5px;color:#9ca3af;font-weight:500;text-transform:uppercase;letter-spacing:0.4px; }

/* Filters */
.ens-filters { display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center; }
.ens-search { width:100%;border:1.5px solid #e5e7eb;border-radius:6px;padding:8px 12px 8px 34px;font-family:'Poppins',sans-serif;font-size:12.5px;outline:none;background:#fff; }
.ens-search:focus { border-color:#E30613; }
.ens-select { border:1.5px solid #e5e7eb;border-radius:6px;padding:8px 12px;font-family:'Poppins',sans-serif;font-size:12px;color:#374151;background:#fff;outline:none;cursor:pointer; }
.ens-select:focus { border-color:#E30613; }

/* Table */
.ens-table-wrap { background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;overflow:hidden; }
.ens-table { width:100%;border-collapse:collapse; }
.ens-table thead tr { background:#f9fafb;border-bottom:1.5px solid #e5e7eb; }
.ens-table th { padding:10px 14px;font-size:10.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;text-align:left;white-space:nowrap; }
.ens-table td { padding:12px 14px;border-bottom:1px solid #f3f4f6;vertical-align:middle; }
.ens-table tbody tr:last-child td { border-bottom:none; }
.ens-table tbody tr:hover { background:#fafafa; }

/* Avatar */
.ens-avatar { width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#E30613,#ff6b6b);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#fff;flex-shrink:0;text-transform:uppercase; }

/* Badges */
.ens-badge-actif    { background:#f0fdf4;color:#15803d;padding:3px 10px;border-radius:20px;font-size:10.5px;font-weight:600;display:inline-flex;align-items:center; }
.ens-badge-attente  { background:#fefce8;color:#92400e;padding:3px 10px;border-radius:20px;font-size:10.5px;font-weight:600;display:inline-flex;align-items:center; }
.ens-badge-inactif  { background:#f5f5f5;color:#6b7280;padding:3px 10px;border-radius:20px;font-size:10.5px;font-weight:600;display:inline-flex;align-items:center; }
.ens-badge-suspendu { background:#fff0f0;color:#b91c1c;padding:3px 10px;border-radius:20px;font-size:10.5px;font-weight:600;display:inline-flex;align-items:center; }

/* Tags */
.ens-tag-contrat { background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600; }
.ens-tag-filiere { background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;font-size:10.5px;font-weight:500; }
.ens-tag-more    { background:#f3f4f6;color:#6b7280;padding:2px 7px;border-radius:4px;font-size:10.5px; }

/* Actions */
.ens-action-btn { padding:6px;background:none;border:none;cursor:pointer;color:#9ca3af;border-radius:6px;transition:all 0.15s;display:inline-flex;align-items:center;justify-content:center; }
.ens-action-btn:hover { background:#f3f4f6;color:#374151; }
.ens-action-view:hover { background:#fef2f2;color:#E30613; }

/* Pagination */
.ens-pagination { display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-top:1px solid #e5e7eb; }
.ens-page-btn { padding:6px 14px;border:1.5px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:'Poppins',sans-serif;background:#fff;cursor:pointer;color:#374151; }
.ens-page-btn:disabled { opacity:0.4;cursor:not-allowed; }
.ens-page-btn:not(:disabled):hover { border-color:#E30613;color:#E30613; }

/* Empty */
.ens-empty { display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:#9ca3af;font-size:13px; }

/* Btn */
.ens-btn-add { background:#E30613;color:#fff;border:none;border-radius:6px;padding:9px 16px;font-weight:600;font-family:'Poppins',sans-serif;cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:6px; }
.ens-btn-add:hover { background:#c00510; }
.ens-btn-cancel { border:1.5px solid #e5e7eb;background:#fff;border-radius:6px;padding:9px 20px;font-family:'Poppins',sans-serif;font-size:13px;font-weight:600;color:#555;cursor:pointer; }
.ens-btn-cancel:hover { border-color:#111;color:#111; }
.ens-btn-save { background:#E30613;color:#fff;border:none;border-radius:6px;padding:9px 20px;font-family:'Poppins',sans-serif;font-size:13px;font-weight:600;cursor:pointer; }
.ens-btn-save:disabled { opacity:0.5;cursor:not-allowed; }

/* Form */
.ens-form-select { flex:1;border:1.5px solid #e5e7eb;border-radius:6px;padding:7px 10px;font-family:'Poppins',sans-serif;font-size:12.5px;background:#fafafa;outline:none; }
.ens-info-banner { background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;font-size:12.5px;color:#1e40af;margin-bottom:12px; }
.ens-error-banner { background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 14px;font-size:12.5px;color:#b91c1c;margin-bottom:12px; }

@media (max-width: 768px) {
  .ens-table-wrap { overflow-x:auto;-webkit-overflow-scrolling:touch; }
  .ens-table { min-width:700px; }
  .ens-kpi-row { gap:8px; }
  .ens-filters { flex-direction:column;align-items:stretch; }
  .ens-filters > div { max-width:100% !important; }
}
</style>
