<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const auth        = useAuthStore()
const canWrite    = ['secretariat', 'dg'].includes(auth.user?.role ?? '')
const canValidate = auth.user?.role === 'dg'

// ── Types ──────────────────────────────────────────────────────────────────
interface User    { id: number; nom: string; prenom: string }
interface Depense {
  id: number; libelle: string; categorie: string; montant: number
  mode_paiement: string; statut: string; beneficiaire: string | null
  reference_facture: string | null; notes: string | null
  justificatif_path: string | null; date_depense: string
  created_at: string; validated_at: string | null
  createdBy?: User; validatedBy?: User
}

// ── State ──────────────────────────────────────────────────────────────────
const depenses      = ref<Depense[]>([])
const loading       = ref(true)
const showModal     = ref(false)
const showDetail    = ref(false)
const saving        = ref(false)
const uploadingJust = ref(false)
const selected      = ref<Depense | null>(null)
const justifFile    = ref<File | null>(null)

const filters = ref({ search: '', categorie: '', statut: '' })
const form    = ref({
  libelle: '', categorie: 'autre', montant: '' as string | number,
  mode_paiement: 'especes', beneficiaire: '', reference_facture: '',
  notes: '', date_depense: new Date().toISOString().slice(0, 10),
})

// ── KPIs ───────────────────────────────────────────────────────────────────
const totalCeMois   = computed(() => {
  const m = new Date().getMonth(); const y = new Date().getFullYear()
  return depenses.value
    .filter(d => ['validee','en_attente'].includes(d.statut) && new Date(d.date_depense).getMonth() === m && new Date(d.date_depense).getFullYear() === y)
    .reduce((s, d) => s + d.montant, 0)
})
const totalValidees = computed(() => depenses.value.filter(d => d.statut === 'validee').reduce((s, d) => s + d.montant, 0))
const totalAttente  = computed(() => depenses.value.filter(d => d.statut === 'en_attente').reduce((s, d) => s + d.montant, 0))

const repartition = computed(() => {
  const map: Record<string, number> = {}
  depenses.value.filter(d => d.statut !== 'rejetee').forEach(d => {
    map[d.categorie] = (map[d.categorie] ?? 0) + d.montant
  })
  const total = Object.values(map).reduce((s, v) => s + v, 0)
  return Object.entries(map)
    .map(([cat, val]) => ({ cat, val, pct: total ? Math.round(val / total * 100) : 0 }))
    .sort((a, b) => b.val - a.val)
    .slice(0, 6)
})

const evolutionMensuelle = computed(() => {
  const months: Record<string, number> = {}
  const now = new Date()
  for (let i = 2; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    months[key] = 0
  }
  depenses.value.filter(d => d.statut !== 'rejetee').forEach(d => {
    const date = new Date(d.date_depense)
    const key  = date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    if (key in months) months[key] = (months[key] ?? 0) + d.montant
  })
  const values = Object.values(months)
  const max = Math.max(...values, 1)
  return Object.entries(months).map(([label, val]) => ({ label, val, pct: Math.round(val / max * 100) }))
})

// ── Labels / couleurs ──────────────────────────────────────────────────────
const catLabels: Record<string, string> = {
  loyer_charges: 'Loyer & Charges', salaires: 'Salaires', materiel: 'Matériel',
  fournitures: 'Fournitures', internet_tel: 'Internet & Tél.', entretien: 'Entretien',
  communication: 'Communication', autre: 'Autre',
}
const catColors: Record<string, string> = {
  loyer_charges: 'bg-blue-100 text-blue-700', salaires: 'bg-violet-100 text-violet-700',
  materiel: 'bg-orange-100 text-orange-700', fournitures: 'bg-green-100 text-green-700',
  internet_tel: 'bg-cyan-100 text-cyan-700', entretien: 'bg-pink-100 text-pink-700',
  communication: 'bg-red-100 text-red-700', autre: 'bg-gray-100 text-gray-600',
}
const catBarColors: Record<string, string> = {
  loyer_charges: 'bg-blue-400', salaires: 'bg-violet-400', materiel: 'bg-orange-400',
  fournitures: 'bg-green-400', internet_tel: 'bg-cyan-400', entretien: 'bg-pink-400',
  communication: 'bg-red-400', autre: 'bg-gray-400',
}
const modeLabels: Record<string, string> = {
  virement: 'Virement', wave: 'Wave', orange_money: 'Orange Money',
  especes: 'Espèces', cheque: 'Chèque', prelevement: 'Prélèvement',
}
const statutBadge: Record<string, string> = {
  validee: 'bg-green-100 text-green-700', en_attente: 'bg-yellow-100 text-yellow-700', rejetee: 'bg-red-100 text-red-700',
}
const statutLabels: Record<string, string> = { validee: 'Validée', en_attente: 'En attente', rejetee: 'Rejetée' }

// ── Filtered ───────────────────────────────────────────────────────────────
const filtered = computed(() => {
  let list = depenses.value
  if (filters.value.categorie) list = list.filter(d => d.categorie === filters.value.categorie)
  if (filters.value.statut)    list = list.filter(d => d.statut === filters.value.statut)
  if (filters.value.search) {
    const s = filters.value.search.toLowerCase()
    list = list.filter(d =>
      d.libelle.toLowerCase().includes(s) ||
      (d.beneficiaire ?? '').toLowerCase().includes(s) ||
      (d.reference_facture ?? '').toLowerCase().includes(s),
    )
  }
  return list
})

// ── Méthodes ───────────────────────────────────────────────────────────────
async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/depenses', { params: { per_page: 200 } })
    depenses.value = data.data ?? data
  } finally {
    loading.value = false
  }
}

function openModal() {
  form.value = {
    libelle: '', categorie: 'autre', montant: '', mode_paiement: 'especes',
    beneficiaire: '', reference_facture: '', notes: '',
    date_depense: new Date().toISOString().slice(0, 10),
  }
  justifFile.value = null
  showModal.value = true
}

function openDetail(d: Depense) {
  selected.value = d
  showDetail.value = true
}

async function saveDepense() {
  if (!form.value.libelle || !form.value.montant) return
  saving.value = true
  try {
    const { data } = await api.post('/depenses', { ...form.value, montant: Number(form.value.montant) })
    // Upload justificatif si présent
    if (justifFile.value) {
      const fd = new FormData()
      fd.append('justificatif', justifFile.value)
      await api.post(`/depenses/${data.id}/justificatif`, fd)
    }
    showModal.value = false
    await load()
  } finally {
    saving.value = false
  }
}

async function validerDepense(d: Depense) {
  await api.post(`/depenses/${d.id}/valider`)
  await load()
  showDetail.value = false
}

async function rejeterDepense(d: Depense) {
  await api.post(`/depenses/${d.id}/rejeter`)
  await load()
  showDetail.value = false
}

function handleJustif(e: Event) {
  justifFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

function formatMontant(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n) + ' F'
}
function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR')
}

onMounted(load)
</script>

<template>
  <div class="uc-content">

    <!-- Header -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <h1 style="font-size:18px;font-weight:700;color:#111;margin:0;">Dépenses</h1>
        <p style="font-size:12px;color:#aaa;margin:3px 0 0;">Journal des dépenses de fonctionnement</p>
      </div>
      <button v-if="canWrite" @click="openModal" class="uc-btn-primary">
        <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0;">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Nouvelle dépense
      </button>
    </div>

    <!-- KPI cards -->
    <div class="uc-kpi-grid" style="margin-bottom:16px;">
      <div class="uc-kpi-card red">
        <div class="uc-kpi-icon">📉</div>
        <div class="uc-kpi-label">Total ce mois</div>
        <div class="uc-kpi-value">{{ loading ? '…' : formatMontant(totalCeMois) }}</div>
        <div class="uc-kpi-trend uc-trend-neu">Cumul mensuel</div>
      </div>
      <div class="uc-kpi-card orange">
        <div class="uc-kpi-icon">⏳</div>
        <div class="uc-kpi-label">En attente</div>
        <div class="uc-kpi-value">{{ loading ? '…' : formatMontant(totalAttente) }}</div>
        <div class="uc-kpi-trend uc-trend-neu">À valider</div>
      </div>
      <div class="uc-kpi-card green">
        <div class="uc-kpi-icon">✅</div>
        <div class="uc-kpi-label">Dépenses validées</div>
        <div class="uc-kpi-value">{{ loading ? '…' : formatMontant(totalValidees) }}</div>
        <div class="uc-kpi-trend uc-trend-up">Confirmées</div>
      </div>
      <div class="uc-kpi-card blue">
        <div class="uc-kpi-icon">📊</div>
        <div class="uc-kpi-label">Catégories actives</div>
        <div class="uc-kpi-value">{{ loading ? '…' : repartition.length }}</div>
        <div class="uc-kpi-trend uc-trend-neu">Ce mois</div>
      </div>
    </div>

    <!-- Layout 2 colonnes -->
    <div class="dep-main-grid">

      <!-- Journal des dépenses -->
      <div class="dep-table-wrap">
        <!-- Toolbar -->
        <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #f0f0f0;flex-wrap:wrap;">
          <div style="position:relative;flex:1;min-width:160px;">
            <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:#aaa;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input v-model="filters.search" type="text" placeholder="Rechercher…" class="dep-search" />
          </div>
          <select v-model="filters.categorie" class="dep-select">
            <option value="">Toutes catégories</option>
            <option v-for="(label, key) in catLabels" :key="key" :value="key">{{ label }}</option>
          </select>
          <select v-model="filters.statut" class="dep-select">
            <option value="">Tous statuts</option>
            <option value="validee">Validée</option>
            <option value="en_attente">En attente</option>
            <option value="rejetee">Rejetée</option>
          </select>
        </div>

        <div v-if="loading" style="padding:40px;text-align:center;font-size:12px;color:#aaa;">Chargement…</div>
        <div v-else-if="!filtered.length" style="padding:40px;text-align:center;font-size:12px;color:#aaa;font-style:italic;">Aucune dépense trouvée</div>
        <div v-else style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="background:#f9f9f9;border-bottom:2px solid #f0f0f0;">
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.4px;">Date</th>
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.4px;">Libellé</th>
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.4px;">Catégorie</th>
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.4px;">Mode</th>
                <th style="padding:10px 14px;text-align:right;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.4px;">Montant</th>
                <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.4px;">Statut</th>
                <th style="padding:10px 14px;"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in filtered" :key="d.id" style="border-bottom:1px solid #f5f5f5;transition:background 0.12s;" @mouseover="($event.currentTarget as HTMLElement).style.background='#fafafa'" @mouseout="($event.currentTarget as HTMLElement).style.background=''">
                <td style="padding:10px 14px;font-size:11.5px;color:#888;">{{ formatDate(d.date_depense) }}</td>
                <td style="padding:10px 14px;">
                  <p style="font-size:12.5px;font-weight:600;color:#111;margin:0;">{{ d.libelle }}</p>
                  <p v-if="d.beneficiaire" style="font-size:11px;color:#aaa;margin:0;">{{ d.beneficiaire }}</p>
                </td>
                <td style="padding:10px 14px;">
                  <span :class="'dep-cat-badge dep-cat-' + d.categorie">{{ catLabels[d.categorie] ?? d.categorie }}</span>
                </td>
                <td style="padding:10px 14px;font-size:12px;color:#666;">{{ modeLabels[d.mode_paiement] ?? d.mode_paiement }}</td>
                <td style="padding:10px 14px;text-align:right;font-size:13px;font-weight:700;color:#E30613;">{{ formatMontant(d.montant) }}</td>
                <td style="padding:10px 14px;">
                  <span :class="{
                    'dep-badge-validee': d.statut === 'validee',
                    'dep-badge-attente': d.statut === 'en_attente',
                    'dep-badge-rejetee': d.statut === 'rejetee',
                  }">{{ statutLabels[d.statut] ?? d.statut }}</span>
                </td>
                <td style="padding:10px 14px;">
                  <button @click="openDetail(d)" class="dep-btn-voir">Voir</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Colonne droite -->
      <div style="display:flex;flex-direction:column;gap:12px;">

        <!-- Répartition par catégorie -->
        <div class="dep-side-card">
          <div class="dep-side-title">Répartition par catégorie</div>
          <div v-if="!repartition.length" style="font-size:12px;color:#aaa;font-style:italic;">Aucune dépense</div>
          <div v-else>
            <div v-for="r in repartition" :key="r.cat" style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
                <span style="color:#333;">{{ catLabels[r.cat] ?? r.cat }}</span>
                <span style="color:#888;font-weight:600;">{{ r.pct }}%</span>
              </div>
              <div style="height:6px;background:#f0f0f0;border-radius:3px;overflow:hidden;">
                <div :style="{ width: r.pct + '%', background: ({loyer_charges:'#60a5fa',salaires:'#a78bfa',materiel:'#fb923c',fournitures:'#4ade80',internet_tel:'#22d3ee',entretien:'#f472b6',communication:'#818cf8',autre:'#9ca3af'})[r.cat] ?? '#9ca3af', height:'100%', borderRadius:'3px', transition:'all 0.3s' }"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Évolution mensuelle -->
        <div class="dep-side-card">
          <div class="dep-side-title">Évolution mensuelle</div>
          <div>
            <div v-for="e in evolutionMensuelle" :key="e.label" style="margin-bottom:12px;">
              <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px;">
                <span style="color:#555;text-transform:capitalize;">{{ e.label }}</span>
                <span style="font-weight:600;color:#111;">{{ formatMontant(e.val) }}</span>
              </div>
              <div style="height:7px;background:#f0f0f0;border-radius:3px;overflow:hidden;">
                <div :style="{ width: e.pct + '%', background: '#E30613', height: '100%', borderRadius: '3px', transition: 'all 0.3s' }"></div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- Modal Nouvelle dépense -->
    <Teleport to="body">
      <div v-if="showModal" style="position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);" @click="showModal = false"></div>
        <div class="dep-modal" style="position:relative;">
          <div class="dep-modal-header">
            <h2>Nouvelle dépense</h2>
            <button @click="showModal = false" style="background:none;border:none;cursor:pointer;color:#888;font-size:20px;line-height:1;">&times;</button>
          </div>
          <div style="padding:18px 22px;overflow-y:auto;max-height:calc(88vh - 120px);">
            <form @submit.prevent="saveDepense" style="display:flex;flex-direction:column;gap:14px;">
              <div class="dep-form-group">
                <label>Libellé <span style="color:#E30613;">*</span></label>
                <input v-model="form.libelle" type="text" required placeholder="Description de la dépense" />
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="dep-form-group">
                  <label>Date <span style="color:#E30613;">*</span></label>
                  <input v-model="form.date_depense" type="date" required />
                </div>
                <div class="dep-form-group">
                  <label>Montant (FCFA) <span style="color:#E30613;">*</span></label>
                  <input v-model="form.montant" type="number" min="0" required />
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="dep-form-group">
                  <label>Catégorie <span style="color:#E30613;">*</span></label>
                  <select v-model="form.categorie" required>
                    <option v-for="(label, key) in catLabels" :key="key" :value="key">{{ label }}</option>
                  </select>
                </div>
                <div class="dep-form-group">
                  <label>Mode de paiement <span style="color:#E30613;">*</span></label>
                  <select v-model="form.mode_paiement" required>
                    <option v-for="(label, key) in modeLabels" :key="key" :value="key">{{ label }}</option>
                  </select>
                </div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="dep-form-group">
                  <label>Bénéficiaire / Fournisseur</label>
                  <input v-model="form.beneficiaire" type="text" />
                </div>
                <div class="dep-form-group">
                  <label>Réf. facture</label>
                  <input v-model="form.reference_facture" type="text" />
                </div>
              </div>
              <div class="dep-form-group">
                <label>Notes</label>
                <textarea v-model="form.notes" rows="2" style="resize:none;"></textarea>
              </div>
              <div class="dep-form-group">
                <label>Justificatif</label>
                <label style="display:flex;align-items:center;gap:10px;padding:12px;border:2px dashed #e5e5e5;border-radius:4px;cursor:pointer;transition:border-color 0.2s;"
                  @mouseover="($event.currentTarget as HTMLElement).style.borderColor='#E30613'"
                  @mouseout="($event.currentTarget as HTMLElement).style.borderColor='#e5e5e5'">
                  <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#aaa;flex-shrink:0;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span style="font-size:12px;color:#888;">{{ justifFile ? justifFile.name : 'PDF, JPG, PNG (max 5 Mo)' }}</span>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" style="display:none;" @change="handleJustif" />
                </label>
              </div>
            </form>
          </div>
          <div class="dep-modal-footer">
            <button @click="showModal = false" class="dep-btn-cancel">Annuler</button>
            <button @click="saveDepense" :disabled="saving || !form.libelle || !form.montant" class="dep-btn-save">
              {{ saving ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Modal Détail dépense -->
    <Teleport to="body">
      <div v-if="showDetail && selected" style="position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;">
        <div style="position:absolute;inset:0;background:rgba(0,0,0,0.4);" @click="showDetail = false"></div>
        <div class="dep-modal dep-modal-sm" style="position:relative;">
          <div class="dep-modal-header">
            <div>
              <h2 style="font-size:14px;">{{ selected.libelle }}</h2>
              <div style="display:flex;gap:6px;margin-top:4px;">
                <span :class="'dep-cat-badge dep-cat-' + selected.categorie">{{ catLabels[selected.categorie] ?? selected.categorie }}</span>
                <span :class="{
                  'dep-badge-validee': selected.statut === 'validee',
                  'dep-badge-attente': selected.statut === 'en_attente',
                  'dep-badge-rejetee': selected.statut === 'rejetee',
                }">{{ statutLabels[selected.statut] ?? selected.statut }}</span>
              </div>
            </div>
            <button @click="showDetail = false" style="background:none;border:none;cursor:pointer;color:#888;font-size:20px;line-height:1;">&times;</button>
          </div>
          <div style="padding:18px 22px;">
            <div style="font-size:28px;font-weight:700;color:#E30613;margin-bottom:14px;">{{ formatMontant(selected.montant) }}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;font-size:12.5px;margin-bottom:12px;">
              <div><div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Date</div><div>{{ formatDate(selected.date_depense) }}</div></div>
              <div><div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Mode</div><div>{{ modeLabels[selected.mode_paiement] ?? selected.mode_paiement }}</div></div>
              <div v-if="selected.beneficiaire"><div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Bénéficiaire</div><div>{{ selected.beneficiaire }}</div></div>
              <div v-if="selected.reference_facture"><div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Réf. facture</div><div>{{ selected.reference_facture }}</div></div>
              <div><div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Saisi par</div><div>{{ selected.createdBy?.prenom }} {{ selected.createdBy?.nom }}</div></div>
              <div v-if="selected.validatedBy"><div style="font-size:10px;color:#aaa;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Validé par</div><div>{{ selected.validatedBy?.prenom }} {{ selected.validatedBy?.nom }}</div></div>
            </div>
            <p v-if="selected.notes" style="font-size:12px;color:#666;background:#f9f9f9;border-radius:4px;padding:10px;margin-bottom:12px;">{{ selected.notes }}</p>
            <div v-if="selected.justificatif_path" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f0fdf4;border-radius:4px;border:1px solid #bbf7d0;">
              <svg width="16" height="16" fill="none" stroke="#16a34a" viewBox="0 0 24 24" style="flex-shrink:0;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span style="font-size:11.5px;color:#333;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ selected.justificatif_path }}</span>
              <a :href="`http://localhost:8000/storage/${selected.justificatif_path}`" target="_blank" style="font-size:11.5px;color:#E30613;text-decoration:none;">Télécharger</a>
            </div>
          </div>
          <div class="dep-modal-footer">
            <button @click="showDetail = false" class="dep-btn-cancel">Fermer</button>
            <template v-if="canValidate && selected.statut === 'en_attente'">
              <button @click="rejeterDepense(selected)" style="background:#E30613;color:#fff;border:none;border-radius:4px;padding:9px 18px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;">Rejeter</button>
              <button @click="validerDepense(selected)" style="background:#16a34a;color:#fff;border:none;border-radius:4px;padding:9px 18px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;">Valider</button>
            </template>
          </div>
        </div>
      </div>
    </Teleport>

  </div>
</template>

<style scoped>
.dep-table-wrap {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  overflow: hidden;
}
.dep-search {
  width: 100%;
  border: 1.5px solid #e5e5e5;
  border-radius: 4px;
  padding: 8px 12px 8px 32px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  color: #111;
  outline: none;
  background: #fff;
  transition: border-color 0.2s;
}
.dep-search:focus { border-color: #E30613; }
.dep-search::placeholder { color: #ccc; }
.dep-select {
  border: 1.5px solid #e5e5e5;
  border-radius: 4px;
  padding: 8px 12px;
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: #444;
  background: #fff;
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s;
}
.dep-select:focus { border-color: #E30613; }
.dep-badge-validee { background:#f0fdf4;color:#15803d; display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600; }
.dep-badge-attente { background:#fefce8;color:#854d0e; display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600; }
.dep-badge-rejetee { background:#fff0f0;color:#b91c1c; display:inline-flex;align-items:center;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600; }
.dep-cat-badge { display:inline-flex;align-items:center;padding:3px 8px;border-radius:20px;font-size:10.5px;font-weight:600; }
.dep-cat-loyer_charges { background:#dbeafe;color:#1e40af; }
.dep-cat-salaires { background:#ede9fe;color:#5b21b6; }
.dep-cat-materiel { background:#ffedd5;color:#92400e; }
.dep-cat-fournitures { background:#dcfce7;color:#14532d; }
.dep-cat-internet_tel { background:#cffafe;color:#155e75; }
.dep-cat-entretien { background:#fce7f3;color:#9d174d; }
.dep-cat-communication { background:#e0e7ff;color:#3730a3; }
.dep-cat-autre { background:#f5f5f5;color:#666; }
.dep-btn-voir {
  border: 1.5px solid #e5e5e5;
  background: #fff;
  border-radius: 4px;
  padding: 4px 12px;
  font-family: 'Poppins', sans-serif;
  font-size: 11.5px;
  color: #555;
  cursor: pointer;
  transition: all 0.15s;
}
.dep-btn-voir:hover { border-color: #E30613; color: #E30613; }
.dep-side-card {
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
  padding: 16px;
}
.dep-side-title {
  font-size: 12.5px;
  font-weight: 700;
  color: #111;
  margin-bottom: 12px;
}
.dep-modal {
  background: #fff;
  border-radius: 8px;
  width: 520px;
  max-height: 88vh;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.25);
  display: flex;
  flex-direction: column;
}
.dep-modal-sm { width: 440px; }
.dep-modal-header {
  padding: 16px 22px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.dep-modal-header h2 { font-size: 15px; font-weight: 700; color: #111; margin: 0; }
.dep-modal-footer {
  padding: 14px 22px;
  border-top: 1px solid #f0f0f0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}
.dep-form-group { display: flex; flex-direction: column; gap: 5px; }
.dep-form-group label { font-size: 11px; font-weight: 600; color: #333; text-transform: uppercase; letter-spacing: 0.3px; }
.dep-form-group input, .dep-form-group select, .dep-form-group textarea {
  border: 1.5px solid #e5e5e5;
  border-radius: 4px;
  padding: 9px 11px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  color: #111;
  outline: none;
  background: #fafafa;
  transition: border-color 0.2s;
}
.dep-form-group input:focus, .dep-form-group select:focus, .dep-form-group textarea:focus { border-color: #E30613; background: #fff; }
.dep-btn-cancel {
  border: 1.5px solid #e5e5e5;
  background: #fff;
  border-radius: 4px;
  padding: 9px 18px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  color: #555;
  cursor: pointer;
  transition: all 0.15s;
}
.dep-btn-cancel:hover { border-color: #111; color: #111; }
.dep-btn-save {
  background: #E30613;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 9px 18px;
  font-family: 'Poppins', sans-serif;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.dep-btn-save:disabled { opacity: 0.5; cursor: not-allowed; }

.dep-main-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; margin-bottom: 16px; }

@media (max-width: 768px) {
  .dep-main-grid { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .dep-main-grid { grid-template-columns: 1fr; }
}
</style>
