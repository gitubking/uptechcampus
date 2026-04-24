<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'

const route  = useRoute()
const router = useRouter()
const toast = useToast()
const filiereId = computed(() => Number(route.params.id))

// ─── Types ────────────────────────────────────────────────────────────────────
interface LigneMaquette {
  filiere_id: number
  matiere_id: number
  matiere_nom: string
  matiere_code: string | null
  semestre: number
  code_ue: string
  intitule_ue: string
  coefficient: number
  credits: number
  vht: number
  cm: number
  td: number
  tp: number
  tpe: number
  ordre: number
}
interface UEGroup    { code_ue: string; intitule_ue: string; rows: LigneMaquette[] }
interface SemGroup   { numero: number; ues: UEGroup[] }
interface AnneeGroup { annee: number; label: string; semestres: SemGroup[] }

// ─── State ────────────────────────────────────────────────────────────────────
const filiere  = ref<{ id: number; nom: string; code: string } | null>(null)
const lignes   = ref<LigneMaquette[]>([])
const loading  = ref(true)

// ─── Load ─────────────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    const [fRes, mRes] = await Promise.all([
      api.get('/filieres'),
      api.get(`/filieres/${filiereId.value}/maquette`),
    ])
    const all = (fRes.data as any[])
    filiere.value = all.find((f: any) => f.id === filiereId.value) || null

    // L'API retourne une structure imbriquée : [{numero, ues:[{code, intitule_ue, ecs:[{matiere_id,...}]}]}]
    // On aplatit en LigneMaquette[]
    const data = Array.isArray(mRes.data) ? mRes.data : []
    const flat: LigneMaquette[] = []
    for (const sem of data) {
      for (const ue of (sem.ues || [])) {
        for (const ec of (ue.ecs || [])) {
          flat.push({
            filiere_id: filiereId.value,
            matiere_id: ec.matiere_id,
            matiere_nom: ec.intitule || '',
            matiere_code: ec.matiere_code || null,
            semestre:    sem.numero || 1,
            code_ue:     ue.code || '',
            intitule_ue: ue.intitule_ue || '',
            coefficient: parseFloat(ec.coefficient) || 0,
            credits:     ec.credits || 0,
            vht:         ec.vht || 0,
            cm:          ec.cm  || 0,
            td:          ec.td  || 0,
            tp:          ec.tp  || 0,
            tpe:         ec.tpe || 0,
            ordre:       ec.ordre || 0,
          })
        }
      }
    }
    lignes.value = flat
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ─── Grouping ─────────────────────────────────────────────────────────────────
const annees = computed<AnneeGroup[]>(() => {
  const semNums = [...new Set(lignes.value.map(l => l.semestre))].sort((a, b) => a - b)
  if (!semNums.length) return []

  // Group consecutive pairs → année
  const pairs: number[][] = []
  for (let i = 0; i < semNums.length; i += 2) pairs.push(semNums.slice(i, i + 2))

  return pairs.map((pair, idx) => ({
    annee: idx + 1,
    label: `Année ${idx + 1}`,
    semestres: pair.map(sn => {
      const sl = [...lignes.value.filter(l => l.semestre === sn)]
        .sort((a, b) => (a.ordre - b.ordre) || (a.matiere_nom || '').localeCompare(b.matiere_nom || ''))
      const ueMap = new Map<string, UEGroup>()
      for (const l of sl) {
        const key = (l.code_ue?.trim() || '') + '||' + (l.intitule_ue?.trim() || '') + '||' + (l.code_ue ? '' : l.matiere_id)
        if (!ueMap.has(key)) ueMap.set(key, { code_ue: l.code_ue || '', intitule_ue: l.intitule_ue || '', rows: [] })
        ueMap.get(key)!.rows.push(l)
      }
      return { numero: sn, ues: [...ueMap.values()] }
    }),
  }))
})

function semStats(sem: SemGroup) {
  const rows = sem.ues.flatMap(u => u.rows)
  return {
    nb:      rows.length,
    coef:    rows.reduce((s, r) => s + (Number(r.coefficient) || 0), 0),
    credits: rows.reduce((s, r) => s + (Number(r.credits)     || 0), 0),
    vh:      rows.reduce((s, r) => s + (Number(r.vht)         || 0), 0),
  }
}

// Prochain semestre disponible
const nextSem = computed(() => {
  const nums = lignes.value.map(l => l.semestre)
  return nums.length ? Math.max(...nums) + 1 : 1
})

// ─── Modal add / edit ─────────────────────────────────────────────────────────
const showModal   = ref(false)
const editTarget  = ref<LigneMaquette | null>(null)
const saving      = ref(false)
const form = ref({
  nom_matiere: '',
  semestre:    1,
  code_ue:     '',
  intitule_ue: '',
  coefficient: 1,
  credits:     0,
  vht:         0,
  cm: 0, td: 0, tp: 0, tpe: 0,
  ordre:       0,
})

const semestresListe = computed(() => {
  const existing = [...new Set(lignes.value.map(l => l.semestre))].sort((a, b) => a - b)
  const next = existing.length ? Math.max(...existing) + 1 : 2
  // Toujours inclure le prochain semestre disponible dans la liste
  return existing.length ? [...existing, next] : [1, 2]
})

function openAdd(semestre: number) {
  editTarget.value = null
  form.value = { nom_matiere: '', semestre, code_ue: '', intitule_ue: '', coefficient: 1, credits: 0, vht: 0, cm: 0, td: 0, tp: 0, tpe: 0, ordre: lignes.value.filter(l => l.semestre === semestre).length }
  showModal.value = true
}
function openEdit(l: LigneMaquette) {
  editTarget.value = l
  form.value = {
    nom_matiere: l.matiere_nom,
    semestre:    l.semestre,
    code_ue:     l.code_ue     || '',
    intitule_ue: l.intitule_ue || '',
    coefficient: Number(l.coefficient) || 0,
    credits:     Number(l.credits)     || 0,
    vht:         Number(l.vht)         || 0,
    cm:  Number(l.cm)  || 0,
    td:  Number(l.td)  || 0,
    tp:  Number(l.tp)  || 0,
    tpe: Number(l.tpe) || 0,
    ordre: Number(l.ordre) || 0,
  }
  showModal.value = true
}
async function save() {
  if (!form.value.nom_matiere.trim()) { toast.warning('Saisissez le nom de la matière (EC)') ; return }
  saving.value = true
  try {
    if (editTarget.value) {
      await api.put(`/filieres/${filiereId.value}/ligne-maquette/${editTarget.value.matiere_id}`, form.value)
    } else {
      await api.post(`/filieres/${filiereId.value}/ligne-maquette`, form.value)
    }
    showModal.value = false
    await load()
  } catch (e: any) {
    toast.apiError(e, 'Erreur lors de l\'enregistrement')
  } finally { saving.value = false }
}

// ─── Delete ───────────────────────────────────────────────────────────────────
const deleteTarget = ref<LigneMaquette | null>(null)
const deleting     = ref(false)
async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await api.delete(`/filieres/${filiereId.value}/matieres/${deleteTarget.value.matiere_id}`)
    deleteTarget.value = null
    await load()
  } catch (e: any) {
    toast.apiError(e, 'Erreur lors de la suppression')
  } finally { deleting.value = false }
}
</script>

<template>
  <!-- ══ Page header ════════════════════════════════════════════════════════════ -->
  <div class="mq-topbar">
    <div style="display:flex;align-items:center;gap:14px;">
      <button @click="router.push('/filieres')" class="mq-back">
        ← Filières
      </button>
      <div>
        <div class="mq-topbar-title">📚 Maquette pédagogique</div>
        <div class="mq-topbar-sub" v-if="filiere">
          {{ filiere.nom }}<span v-if="filiere.code"> · {{ filiere.code }}</span>
        </div>
      </div>
    </div>
    <button
      v-if="!loading && lignes.length > 0"
      @click="openAdd(nextSem)"
      class="mq-btn-primary"
    >+ Nouveau semestre</button>
  </div>

  <!-- ══ Loading ════════════════════════════════════════════════════════════════ -->
  <div v-if="loading" style="padding:60px;text-align:center;color:#888;font-size:13px;">
    Chargement de la maquette…
  </div>

  <div v-else class="mq-content">

    <!-- ── État vide ─────────────────────────────────────────────────────────── -->
    <div v-if="lignes.length === 0" class="mq-empty">
      <div style="font-size:48px;margin-bottom:14px;">📋</div>
      <div style="font-size:15px;font-weight:700;color:#333;margin-bottom:6px;">Maquette vide</div>
      <div style="font-size:12px;color:#999;margin-bottom:20px;">
        Aucune matière n'a encore été ajoutée à cette maquette pédagogique.
      </div>
      <button @click="openAdd(1)" class="mq-btn-primary">+ Ajouter une première matière</button>
    </div>

    <!-- ── Années ─────────────────────────────────────────────────────────────── -->
    <div v-for="an in annees" :key="an.annee" class="mq-annee-block">

      <!-- Header année -->
      <div class="mq-annee-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="font-size:15px;font-weight:800;">{{ an.label }}</span>
          <span class="mq-annee-sub">
            Semestre{{ an.semestres.length > 1 ? 's' : '' }}
            {{ an.semestres.map(s => s.numero).join(' &amp; ') }}
          </span>
        </div>
        <span style="font-size:11px;color:#8899cc;">
          {{ an.semestres.flatMap(s => s.ues.flatMap(u => u.rows)).length }} matière(s)
        </span>
      </div>

      <!-- Semestres -->
      <div v-for="sem in an.semestres" :key="sem.numero" class="mq-sem-wrap">
        <!-- Sem header -->
        <div class="mq-sem-header" :class="sem.numero % 2 === 1 ? 'odd' : 'even'">
          <span class="mq-sem-dot"></span>
          SEMESTRE {{ sem.numero }}
        </div>

        <!-- Table -->
        <div style="overflow-x:auto;">
          <table class="mq-table">
            <thead>
              <tr>
                <th style="width:95px;">Code UE</th>
                <th style="width:160px;">Intitulé UE</th>
                <th>Intitulé EC (Matière)</th>
                <th class="tc" style="width:90px;">Coefficient</th>
                <th class="tc" style="width:65px;">Crédit</th>
                <th class="tc" style="width:65px;">VH</th>
                <th style="width:115px;"></th>
                <th style="width:115px;"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="ue in sem.ues" :key="ue.code_ue + ue.intitule_ue + ue.rows[0]?.matiere_id">
                <tr v-for="(row, ri) in ue.rows" :key="row.matiere_id" class="mq-row">
                  <!-- Code UE (rowspan) -->
                  <td v-if="ri === 0" :rowspan="ue.rows.length" class="mq-td-code">
                    {{ row.code_ue || '—' }}
                  </td>
                  <!-- Intitulé UE (rowspan) -->
                  <td v-if="ri === 0" :rowspan="ue.rows.length" class="mq-td-ue">
                    {{ row.intitule_ue || '—' }}
                  </td>
                  <!-- EC nom -->
                  <td class="mq-td-ec">{{ row.matiere_nom }}</td>
                  <!-- Coef -->
                  <td class="tc">
                    <span class="mq-badge coef">{{ Number(row.coefficient) }}</span>
                  </td>
                  <!-- Crédit -->
                  <td class="tc">
                    <span class="mq-badge cr">{{ row.credits }}</span>
                  </td>
                  <!-- VH -->
                  <td class="tc">
                    <span v-if="Number(row.vht)" class="mq-badge vh">{{ row.vht }}h</span>
                    <span v-else style="color:#ccc;">—</span>
                  </td>
                  <!-- Modifier -->
                  <td>
                    <button @click="openEdit(row)" class="mq-act-edit">✏️ Modifier</button>
                  </td>
                  <!-- Supprimer -->
                  <td>
                    <button @click="deleteTarget = row" class="mq-act-del">🗑 Supprimer</button>
                  </td>
                </tr>
              </template>
              <tr v-if="sem.ues.length === 0" class="mq-row-empty">
                <td colspan="8">Aucune matière — cliquez sur « Ajouter » ci-dessous</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Totaux semestre -->
        <div class="mq-totaux">
          <span>Matières : <strong>{{ semStats(sem).nb }}</strong></span>
          <span>Coef. : <strong>{{ semStats(sem).coef }}</strong></span>
          <span>Crédits : <strong>{{ semStats(sem).credits }}</strong></span>
          <span v-if="semStats(sem).vh">VH : <strong>{{ semStats(sem).vh }}h</strong></span>
        </div>

        <!-- Ajouter matière -->
        <div class="mq-add-row" @click="openAdd(sem.numero)">
          <span>＋</span> Ajouter une matière au semestre {{ sem.numero }}
        </div>
      </div>
    </div>

  </div><!-- /mq-content -->

  <!-- ══ Modal Add / Edit ═══════════════════════════════════════════════════════ -->
  <Teleport to="body">
    <Transition name="mq-fade">
      <div v-if="showModal" class="mq-overlay" @click.self="showModal = false">
        <div class="mq-modal">
          <div class="mq-modal-head">
            <div>
              <div class="mq-modal-title">{{ editTarget ? 'Modifier la matière' : 'Ajouter une matière' }}</div>
              <div class="mq-modal-sub">Filière : {{ filiere?.nom }}</div>
            </div>
            <button @click="showModal = false" class="mq-modal-close">×</button>
          </div>
          <div class="mq-modal-body">

            <!-- Semestre + ordre -->
            <div class="mq-row2">
              <div class="mq-field">
                <label class="mq-lbl">Semestre <span class="req">*</span></label>
                <select v-model.number="form.semestre" class="mq-inp">
                  <option v-for="s in semestresListe" :key="s" :value="s">
                    Semestre {{ s }}{{ s === semestresListe[semestresListe.length - 1] && lignes.filter(l => l.semestre === s).length === 0 ? ' (nouveau)' : '' }}
                  </option>
                </select>
              </div>
              <div class="mq-field">
                <label class="mq-lbl">Ordre</label>
                <input type="number" v-model.number="form.ordre" class="mq-inp" min="0" placeholder="0" />
              </div>
            </div>

            <div class="mq-section-title" style="color:#1d4ed8;">UNITÉ D'ENSEIGNEMENT (UE)</div>
            <div class="mq-row2">
              <div class="mq-field" style="flex:1;">
                <label class="mq-lbl">Code UE</label>
                <input v-model="form.code_ue" class="mq-inp" placeholder="ex: UE101" />
              </div>
              <div class="mq-field" style="flex:2;">
                <label class="mq-lbl">Intitulé UE</label>
                <input v-model="form.intitule_ue" class="mq-inp" placeholder="ex: Sciences de gestion" />
              </div>
            </div>

            <div class="mq-section-title" style="color:#15803d;">ÉLÉMENT CONSTITUTIF (EC / MATIÈRE)</div>
            <div class="mq-field" style="margin-bottom:12px;">
              <label class="mq-lbl">Nom de la matière <span class="req">*</span></label>
              <input v-model="form.nom_matiere" class="mq-inp" placeholder="ex: Comptabilité générale" />
            </div>

            <div class="mq-row3">
              <div class="mq-field">
                <label class="mq-lbl">Coefficient</label>
                <input type="number" v-model.number="form.coefficient" class="mq-inp" min="0" step="0.5" />
              </div>
              <div class="mq-field">
                <label class="mq-lbl">Crédits</label>
                <input type="number" v-model.number="form.credits" class="mq-inp" min="0" />
              </div>
              <div class="mq-field">
                <label class="mq-lbl">VHT (h total)</label>
                <input type="number" v-model.number="form.vht" class="mq-inp" min="0" placeholder="0" />
              </div>
            </div>

            <div class="mq-section-title" style="color:#888;">VOLUMES DÉTAILLÉS (optionnel)</div>
            <div class="mq-row4">
              <div class="mq-field">
                <label class="mq-lbl">CM</label>
                <input type="number" v-model.number="form.cm" class="mq-inp" min="0" placeholder="0" />
              </div>
              <div class="mq-field">
                <label class="mq-lbl">TD</label>
                <input type="number" v-model.number="form.td" class="mq-inp" min="0" placeholder="0" />
              </div>
              <div class="mq-field">
                <label class="mq-lbl">TP</label>
                <input type="number" v-model.number="form.tp" class="mq-inp" min="0" placeholder="0" />
              </div>
              <div class="mq-field">
                <label class="mq-lbl">TPE</label>
                <input type="number" v-model.number="form.tpe" class="mq-inp" min="0" placeholder="0" />
              </div>
            </div>
          </div>
          <div class="mq-modal-foot">
            <button @click="showModal = false" class="mq-btn-cancel">Annuler</button>
            <button @click="save" :disabled="saving" class="mq-btn-primary">
              {{ saving ? 'Enregistrement…' : (editTarget ? 'Mettre à jour' : 'Ajouter') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- ══ Modal Suppression ══════════════════════════════════════════════════════ -->
  <Teleport to="body">
    <Transition name="mq-fade">
      <div v-if="deleteTarget" class="mq-overlay" @click.self="deleteTarget = null">
        <div class="mq-modal" style="max-width:460px;">
          <div class="mq-modal-head">
            <div class="mq-modal-title">Supprimer la matière ?</div>
            <button @click="deleteTarget = null" class="mq-modal-close">×</button>
          </div>
          <div class="mq-modal-body">
            <p style="font-size:13px;color:#333;margin-bottom:10px;">
              Vous allez retirer <strong>{{ deleteTarget?.matiere_nom }}</strong>
              (S{{ deleteTarget?.semestre }}) de cette maquette.
            </p>
            <p style="font-size:12px;color:#b91c1c;background:#fef2f2;border-radius:6px;padding:8px 12px;">
              ⚠️ La matière reste dans la base de données, seul le lien avec cette filière sera supprimé.
            </p>
          </div>
          <div class="mq-modal-foot">
            <button @click="deleteTarget = null" class="mq-btn-cancel">Annuler</button>
            <button @click="confirmDelete" :disabled="deleting" class="mq-btn-danger">
              {{ deleting ? 'Suppression…' : 'Supprimer' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* ── Layout ── */
.mq-topbar {
  background: #1a1a2e; color: #fff;
  padding: 14px 28px;
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.mq-back {
  background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px; padding: 6px 14px; font-size: 12px; cursor: pointer; font-weight: 600;
}
.mq-back:hover { background: rgba(255,255,255,0.18); }
.mq-topbar-title { font-size: 15px; font-weight: 700; }
.mq-topbar-sub   { font-size: 11px; color: #aab; margin-top: 2px; }

.mq-content {
  padding: 20px 28px;
  display: flex; flex-direction: column; gap: 16px;
  background: #f4f6f9; min-height: calc(100vh - 54px);
}

/* ── Empty ── */
.mq-empty {
  background: #fff; border-radius: 10px; border: 1px solid #e0e4ef;
  padding: 60px 40px; text-align: center;
}

/* ── Année block ── */
.mq-annee-block {
  background: #fff; border-radius: 10px; border: 1px solid #e0e4ef;
  overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.05);
}
.mq-annee-header {
  background: linear-gradient(90deg, #1a1a2e 0%, #2d3561 100%);
  color: #fff; padding: 10px 18px;
  display: flex; align-items: center; justify-content: space-between;
}
.mq-annee-sub {
  font-size: 11px; color: #8899cc;
  margin-left: 8px; font-weight: 400;
}

/* ── Semestre ── */
.mq-sem-wrap { border-top: 1px solid #eaecf4; }
.mq-sem-wrap:first-of-type { border-top: none; }
.mq-sem-header {
  padding: 8px 14px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
  display: flex; align-items: center; gap: 7px;
}
.mq-sem-header.odd  { background: #eff6ff; color: #1d4ed8; border-bottom: 1px solid #dbeafe; }
.mq-sem-header.even { background: #f0fdf4; color: #15803d; border-bottom: 1px solid #dcfce7; }
.mq-sem-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  background: currentColor;
}

/* ── Table ── */
.mq-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mq-table thead tr { background: #f7f8fc; }
.mq-table thead th {
  padding: 6px 10px; text-align: left; font-size: 10px; font-weight: 700;
  color: #888; border-bottom: 2px solid #e8eaf0; white-space: nowrap;
}
.mq-table thead th.tc { text-align: center; }
.mq-row { border-bottom: 1px solid #f0f2f8; }
.mq-row:last-child { border-bottom: none; }
.mq-row:hover { background: #fafbff; }
.mq-table tbody td { padding: 7px 10px; vertical-align: middle; }

/* Code UE */
.mq-td-code {
  font-family: monospace; font-size: 11px; font-weight: 700;
  color: #1a3a6b; background: #eef1fb;
  border-left: 3px solid #1a3a6b; white-space: nowrap;
}
/* Intitulé UE */
.mq-td-ue { font-weight: 700; font-size: 12px; color: #1a1a2e; background: #f2f4fb; }
/* EC */
.mq-td-ec { font-size: 12px; color: #444; }
/* num */
.tc { text-align: center; }

/* Badges */
.mq-badge {
  display: inline-block; border-radius: 4px;
  padding: 2px 8px; font-size: 11px; font-weight: 700;
}
.mq-badge.coef { background: #e0e7ff; color: #3730a3; }
.mq-badge.cr   { background: #dcfce7; color: #15803d; }
.mq-badge.vh   { background: #fef3c7; color: #92400e; }

/* Row empty */
.mq-row-empty td {
  text-align: center; color: #bbb; font-style: italic;
  padding: 14px; font-size: 12px;
}

/* Boutons action */
.mq-act-edit {
  background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;
  border-radius: 5px; padding: 3px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.mq-act-edit:hover { background: #dbeafe; }
.mq-act-del {
  background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca;
  border-radius: 5px; padding: 3px 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; white-space: nowrap;
}
.mq-act-del:hover { background: #fee2e2; }

/* Totaux */
.mq-totaux {
  padding: 6px 14px; background: #f7f8fc; border-top: 1px solid #eaecf4;
  display: flex; gap: 20px; font-size: 11px; color: #555;
}
.mq-totaux strong { color: #1a1a2e; }

/* Ajouter matière */
.mq-add-row {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; cursor: pointer; border-top: 1px dashed #dde3f4;
  color: #4338ca; font-size: 11px; font-weight: 600;
  background: #fafbff; transition: background 0.15s;
}
.mq-add-row:hover { background: #eef2ff; }
.mq-add-row span { font-size: 15px; line-height: 1; }

/* Buttons global */
.mq-btn-primary {
  background: #E30613; color: #fff; border: none;
  border-radius: 6px; padding: 8px 18px;
  font-size: 12px; font-weight: 700; cursor: pointer;
}
.mq-btn-primary:hover:not(:disabled) { background: #c0040f; }
.mq-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.mq-btn-cancel {
  background: #f3f4f6; color: #555; border: 1px solid #d1d5db;
  border-radius: 6px; padding: 8px 16px; font-size: 12px; font-weight: 600; cursor: pointer;
}
.mq-btn-cancel:hover { background: #e5e7eb; }
.mq-btn-danger {
  background: #b91c1c; color: #fff; border: none;
  border-radius: 6px; padding: 8px 18px; font-size: 12px; font-weight: 700; cursor: pointer;
}
.mq-btn-danger:hover:not(:disabled) { background: #991b1b; }
.mq-btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── Modal ── */
.mq-overlay {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
.mq-modal {
  background: #fff; border-radius: 10px;
  width: 100%; max-width: 560px; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
}
.mq-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 22px; border-bottom: 1px solid #f0f0f0; flex-shrink: 0;
}
.mq-modal-title { font-size: 14px; font-weight: 700; color: #111; }
.mq-modal-sub   { font-size: 11px; color: #aaa; margin-top: 3px; }
.mq-modal-close {
  background: none; border: none; cursor: pointer;
  color: #aaa; font-size: 22px; line-height: 1; padding: 0;
}
.mq-modal-body { flex: 1; overflow-y: auto; padding: 18px 22px; }
.mq-modal-foot {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px;
  padding: 14px 22px; border-top: 1px solid #f0f0f0;
  background: #fafafa; flex-shrink: 0;
}

/* Form helpers */
.mq-field { display: flex; flex-direction: column; gap: 4px; }
.mq-lbl   { font-size: 11px; font-weight: 600; color: #555; }
.req      { color: #E30613; margin-left: 2px; }
.mq-inp {
  padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 6px;
  font-size: 12px; color: #222; outline: none;
  font-family: inherit;
}
.mq-inp:focus { border-color: #1d4ed8; box-shadow: 0 0 0 2px rgba(29,78,216,0.12); }
.mq-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.mq-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.mq-row4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.mq-section-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  padding: 10px 0 6px; border-top: 1px solid #f0f0f0; margin-bottom: 8px; margin-top: 4px;
}

/* Transition modale */
.mq-fade-enter-active, .mq-fade-leave-active { transition: opacity 0.18s, transform 0.18s; }
.mq-fade-enter-from,  .mq-fade-leave-to      { opacity: 0; transform: scale(0.97); }

/* Responsive */
@media (max-width: 640px) {
  .mq-content { padding: 12px; }
  .mq-row2, .mq-row3, .mq-row4 { grid-template-columns: 1fr 1fr; }
  .mq-table thead th:nth-child(2),
  .mq-table tbody td:nth-child(2) { display: none; }
}
</style>
