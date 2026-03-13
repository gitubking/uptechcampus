<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
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
    frais_inscription: 0, mensualite: 0, duree_mois: null,
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
    alert(e?.response?.data?.message || 'Erreur lors de l\'ajout')
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
    alert(e?.response?.data?.message || 'Erreur lors de la suppression')
  } finally {
    detachingMatiereId.value = null
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
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <h1 style="font-size:18px;font-weight:700;color:#111;margin:0;font-family:'Poppins',sans-serif;">Filières</h1>
        <p style="font-size:12px;color:#aaa;margin:3px 0 0;font-family:'Poppins',sans-serif;">Gestion des filières et programmes de formation</p>
      </div>
      <button v-if="canWrite" @click="openCreate" class="uc-btn-primary">+ Nouvelle filière</button>
    </div>

    <!-- Table -->
    <div class="fl-table-wrap">
      <div v-if="loading" style="padding:40px;text-align:center;font-size:12px;color:#aaa;font-family:'Poppins',sans-serif;">Chargement…</div>
      <div v-else-if="!filieres.length" style="padding:40px;text-align:center;font-size:12px;color:#aaa;font-family:'Poppins',sans-serif;">Aucune filière</div>
      <table v-else>
        <thead>
          <tr>
            <th>Code</th>
            <th>Filière</th>
            <th>Type</th>
            <th>Frais inscr.</th>
            <th>Mensualité</th>
            <th>Durée</th>
            <th>Matières</th>
            <th>Statut</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in filieres" :key="f.id">
            <td><span style="font-size:11px;font-weight:700;color:#888;font-family:monospace;">{{ f.code }}</span></td>
            <td>
              <p style="font-size:12.5px;font-weight:600;color:#111;margin:0;font-family:'Poppins',sans-serif;">{{ f.nom }}</p>
              <p v-if="f.description" style="font-size:11px;color:#aaa;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;font-family:'Poppins',sans-serif;">{{ f.description }}</p>
            </td>
            <td style="font-size:12px;color:#555;font-family:'Poppins',sans-serif;">{{ f.type_formation?.nom ?? '—' }}</td>
            <td style="font-size:12.5px;font-weight:600;color:#111;font-family:'Poppins',sans-serif;">{{ formatMontant(f.frais_inscription) }}</td>
            <td style="font-size:12.5px;font-weight:600;color:#111;font-family:'Poppins',sans-serif;">{{ formatMontant(f.mensualite) }}</td>
            <td style="font-size:12px;color:#555;font-family:'Poppins',sans-serif;">{{ f.duree_mois ? f.duree_mois + ' mois' : '—' }}</td>
            <td>
              <button @click="openMatieres(f)" class="fl-btn-matieres" title="Gérer les matières">
                {{ f.matieres?.length ?? 0 }} matière{{ (f.matieres?.length ?? 0) !== 1 ? 's' : '' }}
              </button>
            </td>
            <td>
              <span :class="f.actif ? 'fl-badge-actif' : 'fl-badge-inactif'">{{ f.actif ? 'Active' : 'Inactive' }}</span>
            </td>
            <td style="text-align:right;">
              <div style="display:flex;justify-content:flex-end;gap:4px;">
                <button @click="openMatieres(f)" class="fl-btn-action" title="Matières">📚</button>
                <button v-if="canWrite" @click="openEdit(f)" class="fl-btn-action" title="Modifier">✏️</button>
                <button v-if="canWrite" @click="deleteTarget = f; confirmMsg = ''" class="fl-btn-action fl-btn-danger" title="Supprimer">🗑️</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Modal Filière (create/edit) -->
    <Teleport to="body">
      <div v-if="showForm" style="position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);" @click="closeForm"></div>
        <div class="fl-modal" style="position:relative;">
          <div class="fl-modal-header">
            <h2>{{ editTarget ? 'Modifier la filière' : 'Nouvelle filière' }}</h2>
            <button @click="closeForm" style="background:none;border:none;cursor:pointer;color:#888;font-size:20px;line-height:1;">&times;</button>
          </div>
          <div style="padding:18px 22px;overflow-y:auto;max-height:calc(88vh - 130px);">
            <div v-if="error" style="background:#fff0f0;border:1px solid #fecaca;border-radius:4px;padding:10px 14px;font-size:12px;color:#b91c1c;margin-bottom:14px;font-family:'Poppins',sans-serif;">{{ error }}</div>
            <form @submit.prevent="save" style="display:flex;flex-direction:column;gap:14px;">
              <div class="fl-form-grid-2">
                <div class="fl-form-group">
                  <label>Nom <span style="color:#E30613;">*</span></label>
                  <input v-model="form.nom" required placeholder="Ex: Informatique" />
                </div>
                <div class="fl-form-group">
                  <label>Code <span style="color:#E30613;">*</span></label>
                  <input v-model="form.code" required placeholder="Ex: INFO" />
                </div>
              </div>
              <div class="fl-form-group">
                <label>Description</label>
                <textarea v-model="form.description" rows="2" style="resize:none;"></textarea>
              </div>
              <div class="fl-form-group">
                <label>Type de formation</label>
                <select v-model="form.type_formation_id">
                  <option :value="null">— Sélectionner —</option>
                  <option v-for="t in typesFormation" :key="t.id" :value="t.id">{{ t.nom }} ({{ t.code }})</option>
                </select>
              </div>
              <div class="fl-form-grid-3">
                <div class="fl-form-group">
                  <label>Frais inscription (F) <span style="color:#E30613;">*</span></label>
                  <input v-model.number="form.frais_inscription" type="number" min="0" step="500" required />
                </div>
                <div class="fl-form-group">
                  <label>Mensualité (F) <span style="color:#E30613;">*</span></label>
                  <input v-model.number="form.mensualite" type="number" min="0" step="500" required />
                </div>
                <div class="fl-form-group">
                  <label>Durée (mois) <span style="color:#E30613;">*</span></label>
                  <input v-model.number="form.duree_mois" type="number" min="1" max="120" required />
                </div>
              </div>
              <div v-if="editTarget" style="display:flex;align-items:center;gap:10px;">
                <label style="font-size:12px;font-weight:600;color:#333;text-transform:uppercase;letter-spacing:0.3px;font-family:'Poppins',sans-serif;">Filière active</label>
                <input type="checkbox" v-model="form.actif" style="width:16px;height:16px;accent-color:#E30613;" />
              </div>
            </form>
          </div>
          <div class="fl-modal-footer">
            <button @click="closeForm" class="fl-btn-cancel">Annuler</button>
            <button @click="save" :disabled="saving" class="fl-btn-save">{{ saving ? 'Enregistrement…' : 'Enregistrer' }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal confirmation suppression -->
    <Teleport to="body">
      <div v-if="deleteTarget" style="position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);" @click="deleteTarget = null"></div>
        <div style="position:relative;background:#fff;border-radius:8px;width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.25);padding:24px;">
          <h3 style="font-size:15px;font-weight:700;color:#111;margin:0 0 8px;font-family:'Poppins',sans-serif;">Supprimer la filière ?</h3>
          <p style="font-size:13px;color:#555;margin:0 0 4px;font-family:'Poppins',sans-serif;font-weight:600;">{{ deleteTarget.nom }}</p>
          <p style="font-size:12px;color:#888;margin:0 0 6px;font-family:'Poppins',sans-serif;">Cette action est irréversible. La filière sera supprimée si aucune classe ou inscription ne l'utilise.</p>
          <p v-if="confirmMsg" style="font-size:12px;color:#E30613;margin:0 0 6px;font-family:'Poppins',sans-serif;">{{ confirmMsg }}</p>
          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
            <button @click="deleteTarget = null" class="fl-btn-cancel">Annuler</button>
            <button @click="confirmDelete" :disabled="deleting" style="background:#E30613;color:#fff;border:none;border-radius:4px;padding:9px 18px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;opacity:1;" :style="deleting ? 'opacity:0.6;cursor:not-allowed;' : ''">
              {{ deleting ? 'Suppression…' : 'Supprimer' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal Matières d'une filière -->
    <Teleport to="body">
      <div v-if="showMatieres" style="position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);" @click="showMatieres = false"></div>
        <div style="position:relative;background:#fff;border-radius:8px;width:100%;max-width:680px;box-shadow:0 20px 60px rgba(0,0,0,0.25);display:flex;flex-direction:column;max-height:85vh;">

          <!-- En-tête -->
          <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid #f0f0f0;">
            <div>
              <h2 style="font-size:14px;font-weight:700;color:#111;margin:0;font-family:'Poppins',sans-serif;">Matières — {{ filiereForMatieres?.nom }}</h2>
              <p style="font-size:11px;color:#aaa;margin:2px 0 0;font-family:'Poppins',sans-serif;">{{ filiereForMatieres?.matieres?.length ?? 0 }} matière(s) dans cette filière</p>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <button
                v-if="canWrite && !showAttachForm"
                @click="showAttachForm = true"
                class="uc-btn-primary"
                style="font-size:12px;padding:7px 14px;"
              >+ Ajouter une matière</button>
              <button @click="showMatieres = false" style="background:none;border:none;cursor:pointer;color:#aaa;font-size:20px;line-height:1;padding:4px;">&times;</button>
            </div>
          </div>

          <!-- Corps scrollable -->
          <div style="flex:1;overflow-y:auto;padding:18px 22px;">

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
                    <div class="fl-form-group">
                      <label>Matière <span style="color:#E30613;">*</span></label>
                      <select v-model="formAttach.matiere_id">
                        <option :value="null">— Sélectionner une matière —</option>
                        <option v-for="m in matieresDisponibles" :key="m.id" :value="m.id">{{ m.nom }} ({{ m.code }})</option>
                      </select>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                      <div class="fl-form-group">
                        <label>Coefficient <span style="color:#E30613;">*</span></label>
                        <input v-model.number="formAttach.coefficient" type="number" min="0" step="0.5" />
                      </div>
                      <div class="fl-form-group">
                        <label>Crédits ECTS</label>
                        <input v-model.number="formAttach.credits" type="number" min="0" />
                      </div>
                      <div class="fl-form-group">
                        <label>Ordre</label>
                        <input v-model.number="formAttach.ordre" type="number" min="0" />
                      </div>
                    </div>
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
            <div v-else class="fl-table-wrap" style="margin-top:0;">
              <table>
                <thead>
                  <tr>
                    <th>Matière</th>
                    <th style="text-align:center;">Coefficient</th>
                    <th style="text-align:center;">Crédits</th>
                    <th style="text-align:center;">Ordre</th>
                    <th v-if="canWrite" style="text-align:right;"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in filiereForMatieres?.matieres" :key="m.id">
                    <td>
                      <p style="font-size:12.5px;font-weight:600;color:#111;margin:0;font-family:'Poppins',sans-serif;">{{ m.nom }}</p>
                      <span style="font-size:11px;font-family:monospace;color:#aaa;">{{ m.code }}</span>
                    </td>
                    <td style="text-align:center;">
                      <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:28px;border-radius:4px;background:#fff8e6;color:#b45309;font-size:13px;font-weight:700;font-family:'Poppins',sans-serif;">{{ m.pivot?.coefficient ?? '—' }}</span>
                    </td>
                    <td style="text-align:center;">
                      <span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:28px;border-radius:4px;background:#eff6ff;color:#1d4ed8;font-size:13px;font-weight:700;font-family:'Poppins',sans-serif;">{{ m.pivot?.credits ?? 0 }}</span>
                    </td>
                    <td style="text-align:center;font-size:12px;color:#aaa;font-family:'Poppins',sans-serif;">{{ m.pivot?.ordre ?? 0 }}</td>
                    <td v-if="canWrite" style="text-align:right;">
                      <button
                        @click="detachMatiere(m.id)"
                        :disabled="detachingMatiereId === m.id"
                        class="fl-btn-action fl-btn-danger"
                        title="Retirer de la filière"
                      >&times;</button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

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

/* ── Table wrapper ── */
.fl-table-wrap {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #ebebeb;
  overflow: hidden;
}
.fl-table-wrap table {
  width: 100%;
  border-collapse: collapse;
  font-family: 'Poppins', sans-serif;
}
.fl-table-wrap thead tr {
  background: #fafafa;
  border-bottom: 1px solid #ebebeb;
}
.fl-table-wrap th {
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  text-align: left;
  white-space: nowrap;
}
.fl-table-wrap tbody tr {
  border-bottom: 1px solid #f4f4f4;
  transition: background 0.1s;
}
.fl-table-wrap tbody tr:last-child {
  border-bottom: none;
}
.fl-table-wrap tbody tr:hover {
  background: #fdf8f8;
}
.fl-table-wrap td {
  padding: 11px 14px;
  font-size: 12.5px;
  color: #333;
  vertical-align: middle;
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

/* ── Modal ── */
.fl-modal {
  background: #fff;
  border-radius: 8px;
  width: 100%;
  max-width: 560px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.fl-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 22px;
  border-bottom: 1px solid #f0f0f0;
}
.fl-modal-header h2 {
  font-size: 14px;
  font-weight: 700;
  color: #111;
  margin: 0;
  font-family: 'Poppins', sans-serif;
}
.fl-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px;
  border-top: 1px solid #f0f0f0;
  background: #fafafa;
}

/* ── Formulaire ── */
.fl-form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.fl-form-group label {
  font-size: 11.5px;
  font-weight: 600;
  color: #444;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-family: 'Poppins', sans-serif;
}
.fl-form-group input,
.fl-form-group select,
.fl-form-group textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 5px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  color: #222;
  background: #fff;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s;
}
.fl-form-group input:focus,
.fl-form-group select:focus,
.fl-form-group textarea:focus {
  border-color: #E30613;
  box-shadow: 0 0 0 2px rgba(227, 6, 19, 0.08);
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

.fl-form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fl-form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

@media (max-width: 768px) {
  .fl-form-grid-2 { grid-template-columns: 1fr; }
  .fl-form-grid-3 { grid-template-columns: 1fr; }
}
</style>
