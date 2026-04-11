<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'

const auth = useAuthStore()
const role = computed(() => auth.user?.role ?? '')
const canValidateEncaissement = computed(() => ['dg', 'resp_fin'].includes(role.value))
const canValidateDepense = computed(() => role.value === 'dg')

// ── Types ─────────────────────────────────────────────────────────────────────
interface Paiement {
  id: number; numero_recu: string; montant: number
  mode_paiement: string; type_paiement: string
  statut: string; created_at: string; confirmed_at: string | null
  etudiant?: { nom: string; prenom: string } | null
  created_by_user?: { name: string } | null
  confirmed_by_user?: { name: string } | null
}
interface Depense {
  id: number; libelle: string; categorie: string; montant: number
  mode_paiement: string | null; statut: string; beneficiaire: string | null
  date_depense: string; created_at: string; validated_at: string | null
  motif_rejet: string | null
  created_by_user?: { name: string } | null
  validated_by_user?: { name: string } | null
}

// ── Onglet actif ──────────────────────────────────────────────────────────────
const tab = ref<'encaissements' | 'depenses'>('encaissements')

// ── Filtres ───────────────────────────────────────────────────────────────────
const filterMode = ref<'jour' | 'semaine' | 'mois' | 'plage'>('jour')
const filterJour  = ref(new Date().toISOString().slice(0, 10))
const filterMois  = ref(new Date().toISOString().slice(0, 7))
const filterFrom  = ref(new Date().toISOString().slice(0, 10))
const filterTo    = ref(new Date().toISOString().slice(0, 10))

// ── Données ───────────────────────────────────────────────────────────────────
const paiements = ref<Paiement[]>([])
const depenses  = ref<Depense[]>([])
const loading   = ref(false)
const actioning = ref<number | null>(null)
const errorMsg  = ref('')
const successMsg = ref('')

// ── Calcul plage selon mode ───────────────────────────────────────────────────
function getPlage(): { from: string; to: string } {
  const today = new Date()
  if (filterMode.value === 'jour') {
    return { from: filterJour.value, to: filterJour.value }
  }
  if (filterMode.value === 'semaine') {
    // Lundi de la semaine courante
    const day = today.getDay() || 7
    const mon = new Date(today)
    mon.setDate(today.getDate() - day + 1)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    return {
      from: mon.toISOString().slice(0, 10),
      to:   sun.toISOString().slice(0, 10),
    }
  }
  if (filterMode.value === 'mois') {
    const [y, m] = filterMois.value.split('-')
    const last = new Date(Number(y), Number(m), 0).getDate()
    return { from: `${filterMois.value}-01`, to: `${filterMois.value}-${String(last).padStart(2, '0')}` }
  }
  return { from: filterFrom.value, to: filterTo.value }
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const { from, to } = getPlage()
    const params = { date_from: from, date_to: to, per_page: 500 }
    const [pRes, dRes] = await Promise.all([
      api.get('/paiements', { params }),
      api.get('/depenses',  { params }),
    ])
    paiements.value = pRes.data.data ?? []
    depenses.value  = dRes.data.data ?? []
  } catch {
    errorMsg.value = 'Erreur lors du chargement des données.'
  } finally {
    loading.value = false
  }
}

// Recharge si les filtres changent
watch([filterMode, filterJour, filterMois, filterFrom, filterTo], load)
onMounted(load)

// ── Groupement par jour ───────────────────────────────────────────────────────
function dateKey(iso: string) { return iso.slice(0, 10) }

function groupByDay<T extends { created_at?: string; date_depense?: string; confirmed_at?: string | null }>(items: T[]) {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = dateKey((item.date_depense ?? item.confirmed_at ?? item.created_at) as string)
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, items]) => ({ date, items }))
}

const paiementsParJour = computed(() => groupByDay(paiements.value))
const depensesParJour  = computed(() => groupByDay(depenses.value))

function totalJourP(items: Paiement[]) {
  return items.filter(p => p.statut === 'confirme').reduce((s, p) => s + Number(p.montant), 0)
}
function totalJourD(items: Depense[]) {
  return items.filter(d => d.statut === 'validee').reduce((s, d) => s + Number(d.montant), 0)
}

const totalEncaissements = computed(() =>
  paiements.value.filter(p => p.statut === 'confirme').reduce((s, p) => s + Number(p.montant), 0)
)
const totalDepenses = computed(() =>
  depenses.value.filter(d => d.statut === 'validee').reduce((s, d) => s + Number(d.montant), 0)
)
const soldeNet = computed(() => totalEncaissements.value - totalDepenses.value)

// ── Labels helpers ────────────────────────────────────────────────────────────
const modeLabels: Record<string, string> = {
  especes: 'Espèces', wave: 'Wave', orange_money: 'Orange Money',
  virement: 'Virement', cheque: 'Chèque',
}
const typeLabels: Record<string, string> = {
  frais_inscription: 'Inscription', mensualite: 'Mensualité', rattrapage: 'Rattrapage',
}
const catLabels: Record<string, string> = {
  salaire: 'Salaire', loyer: 'Loyer', fournitures: 'Fournitures',
  maintenance: 'Maintenance', marketing: 'Marketing', autre: 'Autre',
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtMontant(n: number) {
  return n.toLocaleString('fr-FR') + ' FCFA'
}
function statutPaiement(s: string) {
  return ({ confirme: { label: 'Confirmé', cls: 'cai-badge-ok' }, en_attente: { label: 'En attente', cls: 'cai-badge-wait' }, rejete: { label: 'Rejeté', cls: 'cai-badge-rej' } } as any)[s] ?? { label: s, cls: 'cai-badge-wait' }
}
function statutDepense(s: string) {
  return ({ validee: { label: 'Validée', cls: 'cai-badge-ok' }, en_attente: { label: 'En attente', cls: 'cai-badge-wait' }, rejetee: { label: 'Rejetée', cls: 'cai-badge-rej' } } as any)[s] ?? { label: s, cls: 'cai-badge-wait' }
}

// ── Actions ───────────────────────────────────────────────────────────────────
function flash(msg: string, ok = true) {
  if (ok) successMsg.value = msg
  else errorMsg.value = msg
  setTimeout(() => { successMsg.value = ''; errorMsg.value = '' }, 3500)
}

async function confirmerPaiement(p: Paiement) {
  actioning.value = p.id
  try {
    const { data } = await api.post(`/paiements/${p.id}/confirmer`)
    const idx = paiements.value.findIndex(x => x.id === p.id)
    if (idx !== -1) paiements.value[idx] = { ...paiements.value[idx], ...data }
    flash('Paiement confirmé.')
  } catch (e: any) {
    flash(e?.response?.data?.message ?? 'Erreur.', false)
  } finally { actioning.value = null }
}

async function rejeterPaiement(p: Paiement) {
  if (!confirm('Rejeter ce paiement ?')) return
  actioning.value = p.id
  try {
    const { data } = await api.post(`/paiements/${p.id}/rejeter`)
    const idx = paiements.value.findIndex(x => x.id === p.id)
    if (idx !== -1) paiements.value[idx] = { ...paiements.value[idx], ...data }
    flash('Paiement rejeté.')
  } catch (e: any) {
    flash(e?.response?.data?.message ?? 'Erreur.', false)
  } finally { actioning.value = null }
}

async function validerDepense(d: Depense) {
  actioning.value = d.id
  try {
    const { data } = await api.post(`/depenses/${d.id}/valider`)
    const idx = depenses.value.findIndex(x => x.id === d.id)
    if (idx !== -1) depenses.value[idx] = { ...depenses.value[idx], ...data }
    flash('Dépense validée.')
  } catch (e: any) {
    flash(e?.response?.data?.message ?? 'Erreur.', false)
  } finally { actioning.value = null }
}

async function rejeterDepense(d: Depense) {
  if (!confirm('Rejeter cette dépense ?')) return
  actioning.value = d.id
  try {
    const { data } = await api.post(`/depenses/${d.id}/rejeter`)
    const idx = depenses.value.findIndex(x => x.id === d.id)
    if (idx !== -1) depenses.value[idx] = { ...depenses.value[idx], ...data }
    flash('Dépense rejetée.')
  } catch (e: any) {
    flash(e?.response?.data?.message ?? 'Erreur.', false)
  } finally { actioning.value = null }
}
</script>

<template>
  <div class="uc-content">
    <UcPageHeader title="Journal de caisse" subtitle="Encaissements et dépenses journaliers" />

    <!-- Toast -->
    <div v-if="successMsg" class="cai-toast cai-toast-ok">{{ successMsg }}</div>
    <div v-if="errorMsg"   class="cai-toast cai-toast-err">{{ errorMsg }}</div>

    <!-- ── KPIs ── -->
    <div class="cai-kpi-row">
      <div class="cai-kpi cai-kpi-green">
        <span class="cai-kpi-val">{{ fmtMontant(totalEncaissements) }}</span>
        <span class="cai-kpi-lbl">Encaissé (confirmé)</span>
      </div>
      <div class="cai-kpi cai-kpi-red">
        <span class="cai-kpi-val">{{ fmtMontant(totalDepenses) }}</span>
        <span class="cai-kpi-lbl">Dépensé (validé)</span>
      </div>
      <div class="cai-kpi" :class="soldeNet >= 0 ? 'cai-kpi-blue' : 'cai-kpi-orange'">
        <span class="cai-kpi-val">{{ fmtMontant(soldeNet) }}</span>
        <span class="cai-kpi-lbl">Solde net</span>
      </div>
      <div class="cai-kpi">
        <span class="cai-kpi-val">{{ paiements.filter(p => p.statut === 'en_attente').length }}</span>
        <span class="cai-kpi-lbl">Paiements en attente</span>
      </div>
      <div class="cai-kpi">
        <span class="cai-kpi-val">{{ depenses.filter(d => d.statut === 'en_attente').length }}</span>
        <span class="cai-kpi-lbl">Dépenses en attente</span>
      </div>
    </div>

    <!-- ── Filtres ── -->
    <div class="cai-filter-bar">
      <div class="cai-filter-modes">
        <button v-for="m in (['jour','semaine','mois','plage'] as const)" :key="m"
          @click="filterMode = m" :class="['cai-mode-btn', filterMode === m && 'cai-mode-btn--active']">
          {{ { jour: 'Aujourd\'hui', semaine: 'Cette semaine', mois: 'Par mois', plage: 'Plage de dates' }[m] }}
        </button>
      </div>
      <div class="cai-filter-inputs">
        <template v-if="filterMode === 'jour'">
          <input type="date" v-model="filterJour" class="cai-input" />
        </template>
        <template v-else-if="filterMode === 'mois'">
          <input type="month" v-model="filterMois" class="cai-input" />
        </template>
        <template v-else-if="filterMode === 'plage'">
          <input type="date" v-model="filterFrom" class="cai-input" />
          <span style="color:#6b7280;font-size:12px;">au</span>
          <input type="date" v-model="filterTo" class="cai-input" />
        </template>
        <button @click="load" class="cai-btn-refresh" title="Rafraîchir">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- ── Tabs ── -->
    <div class="cai-tabs">
      <button @click="tab='encaissements'" :class="['cai-tab', tab==='encaissements' && 'cai-tab--active']">
        💰 Encaissements
        <span class="cai-tab-count">{{ paiements.length }}</span>
      </button>
      <button @click="tab='depenses'" :class="['cai-tab', tab==='depenses' && 'cai-tab--active']">
        💸 Dépenses
        <span class="cai-tab-count">{{ depenses.length }}</span>
      </button>
    </div>

    <!-- ── Loading ── -->
    <div v-if="loading" class="cai-empty">Chargement…</div>

    <!-- ══════════════ ENCAISSEMENTS ══════════════ -->
    <template v-else-if="tab === 'encaissements'">
      <div v-if="!paiements.length" class="cai-empty">Aucun paiement sur cette période.</div>
      <div v-else>
        <div v-for="groupe in paiementsParJour" :key="groupe.date" class="cai-day-block">
          <!-- En-tête du jour -->
          <div class="cai-day-header">
            <div class="cai-day-label">{{ fmtDate(groupe.date) }}</div>
            <div class="cai-day-totals">
              <span class="cai-day-total-green">
                Total confirmé : {{ fmtMontant(totalJourP(groupe.items)) }}
              </span>
              <span class="cai-day-count">{{ groupe.items.length }} transaction(s)</span>
            </div>
          </div>

          <!-- Table -->
          <div class="cai-table-wrap">
            <table class="cai-table">
              <thead>
                <tr>
                  <th>N° Reçu</th>
                  <th>Étudiant</th>
                  <th>Type</th>
                  <th>Mode</th>
                  <th>Montant</th>
                  <th>Statut</th>
                  <th>Saisi par</th>
                  <th v-if="canValidateEncaissement" style="text-align:right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in groupe.items" :key="p.id">
                  <td><span style="font-family:monospace;font-size:11.5px;color:#6b7280;">{{ p.numero_recu }}</span></td>
                  <td>
                    <span style="font-weight:600;font-size:13px;">
                      {{ p.etudiant?.prenom }} {{ p.etudiant?.nom }}
                    </span>
                  </td>
                  <td><span class="cai-tag">{{ typeLabels[p.type_paiement] ?? p.type_paiement }}</span></td>
                  <td><span class="cai-tag cai-tag-mode">{{ modeLabels[p.mode_paiement] ?? p.mode_paiement }}</span></td>
                  <td><strong>{{ fmtMontant(p.montant) }}</strong></td>
                  <td>
                    <span :class="statutPaiement(p.statut).cls">{{ statutPaiement(p.statut).label }}</span>
                  </td>
                  <td><span style="font-size:11.5px;color:#9ca3af;">{{ p.created_by_user?.name ?? '—' }}</span></td>
                  <td v-if="canValidateEncaissement" style="text-align:right;">
                    <div v-if="p.statut === 'en_attente'" style="display:flex;gap:6px;justify-content:flex-end;">
                      <button @click="confirmerPaiement(p)" :disabled="actioning === p.id" class="cai-btn-ok">
                        {{ actioning === p.id ? '…' : '✓ Confirmer' }}
                      </button>
                      <button @click="rejeterPaiement(p)" :disabled="actioning === p.id" class="cai-btn-rej">
                        ✕ Rejeter
                      </button>
                    </div>
                    <span v-else-if="p.statut === 'confirme'" style="font-size:11px;color:#16a34a;">
                      Confirmé par {{ p.confirmed_by_user?.name ?? '—' }}
                    </span>
                    <span v-else style="font-size:11px;color:#9ca3af;">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Total global -->
        <div class="cai-global-total">
          <span>Total encaissé (confirmé) sur la période</span>
          <strong>{{ fmtMontant(totalEncaissements) }}</strong>
        </div>
      </div>
    </template>

    <!-- ══════════════ DÉPENSES ══════════════ -->
    <template v-else>
      <div v-if="!depenses.length" class="cai-empty">Aucune dépense sur cette période.</div>
      <div v-else>
        <div v-for="groupe in depensesParJour" :key="groupe.date" class="cai-day-block">
          <!-- En-tête du jour -->
          <div class="cai-day-header">
            <div class="cai-day-label">{{ fmtDate(groupe.date) }}</div>
            <div class="cai-day-totals">
              <span class="cai-day-total-red">
                Total validé : {{ fmtMontant(totalJourD(groupe.items)) }}
              </span>
              <span class="cai-day-count">{{ groupe.items.length }} dépense(s)</span>
            </div>
          </div>

          <!-- Note info DG -->
          <div v-if="!canValidateDepense && groupe.items.some(d => d.statut === 'en_attente')"
            class="cai-info-dg">
            ℹ️ Les dépenses en attente nécessitent la validation du Directeur Général.
          </div>

          <!-- Table -->
          <div class="cai-table-wrap">
            <table class="cai-table">
              <thead>
                <tr>
                  <th>Libellé</th>
                  <th>Catégorie</th>
                  <th>Bénéficiaire</th>
                  <th>Mode</th>
                  <th>Montant</th>
                  <th>Statut</th>
                  <th>Saisi par</th>
                  <th v-if="canValidateDepense" style="text-align:right;">Actions DG</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="d in groupe.items" :key="d.id">
                  <td>
                    <div style="font-weight:600;font-size:13px;">{{ d.libelle }}</div>
                    <div v-if="d.motif_rejet" style="font-size:11px;color:#b91c1c;">
                      Motif rejet : {{ d.motif_rejet }}
                    </div>
                  </td>
                  <td><span class="cai-tag">{{ catLabels[d.categorie] ?? d.categorie }}</span></td>
                  <td><span style="font-size:12.5px;color:#374151;">{{ d.beneficiaire ?? '—' }}</span></td>
                  <td><span class="cai-tag cai-tag-mode">{{ modeLabels[d.mode_paiement ?? ''] ?? d.mode_paiement ?? '—' }}</span></td>
                  <td><strong>{{ fmtMontant(d.montant) }}</strong></td>
                  <td>
                    <span :class="statutDepense(d.statut).cls">{{ statutDepense(d.statut).label }}</span>
                  </td>
                  <td><span style="font-size:11.5px;color:#9ca3af;">{{ d.created_by_user?.name ?? '—' }}</span></td>
                  <td v-if="canValidateDepense" style="text-align:right;">
                    <div v-if="d.statut === 'en_attente'" style="display:flex;gap:6px;justify-content:flex-end;">
                      <button @click="validerDepense(d)" :disabled="actioning === d.id" class="cai-btn-ok">
                        {{ actioning === d.id ? '…' : '✓ Valider' }}
                      </button>
                      <button @click="rejeterDepense(d)" :disabled="actioning === d.id" class="cai-btn-rej">
                        ✕ Rejeter
                      </button>
                    </div>
                    <span v-else-if="d.statut === 'validee'" style="font-size:11px;color:#16a34a;">
                      Validé par {{ d.validated_by_user?.name ?? '—' }}
                    </span>
                    <span v-else style="font-size:11px;color:#9ca3af;">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Total global -->
        <div class="cai-global-total">
          <span>Total dépensé (validé) sur la période</span>
          <strong>{{ fmtMontant(totalDepenses) }}</strong>
        </div>
      </div>
    </template>

  </div>
</template>

<style scoped>
/* KPIs */
.cai-kpi-row { display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap; }
.cai-kpi { background:#fff;border:1.5px solid #e5e7eb;border-radius:8px;padding:12px 18px;display:flex;flex-direction:column;gap:2px;min-width:140px; }
.cai-kpi-val { font-size:18px;font-weight:700;font-family:'Poppins',sans-serif;color:#111; }
.cai-kpi-lbl { font-size:10.5px;color:#9ca3af;font-weight:500;text-transform:uppercase;letter-spacing:0.4px; }
.cai-kpi-green .cai-kpi-val { color:#16a34a; }
.cai-kpi-red   .cai-kpi-val { color:#E30613; }
.cai-kpi-blue  .cai-kpi-val { color:#1d4ed8; }
.cai-kpi-orange .cai-kpi-val { color:#d97706; }

/* Filtres */
.cai-filter-bar { display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;padding:12px 14px;background:#fff;border:1.5px solid #e5e7eb;border-radius:8px; }
.cai-filter-modes { display:flex;gap:6px;flex-wrap:wrap; }
.cai-mode-btn { padding:6px 13px;border:1.5px solid #e5e7eb;border-radius:6px;font-size:12px;font-family:'Poppins',sans-serif;background:#fff;cursor:pointer;color:#374151;white-space:nowrap; }
.cai-mode-btn--active { background:#E30613;color:#fff;border-color:#E30613; }
.cai-filter-inputs { display:flex;align-items:center;gap:8px;flex-wrap:wrap; }
.cai-input { border:1.5px solid #e5e7eb;border-radius:6px;padding:6px 10px;font-family:'Poppins',sans-serif;font-size:12.5px;color:#374151;background:#fff;outline:none; }
.cai-input:focus { border-color:#E30613; }
.cai-btn-refresh { background:#f3f4f6;border:1.5px solid #e5e7eb;border-radius:6px;padding:7px 10px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center; }
.cai-btn-refresh:hover { background:#e5e7eb; }

/* Tabs */
.cai-tabs { display:flex;gap:4px;margin-bottom:14px;border-bottom:2px solid #e5e7eb;padding-bottom:0; }
.cai-tab { padding:9px 18px;border:none;background:none;font-family:'Poppins',sans-serif;font-size:13px;font-weight:600;color:#6b7280;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;display:flex;align-items:center;gap:6px; }
.cai-tab--active { color:#E30613;border-bottom-color:#E30613; }
.cai-tab-count { background:#f3f4f6;color:#374151;border-radius:12px;padding:1px 7px;font-size:11px;font-weight:600; }
.cai-tab--active .cai-tab-count { background:#fef2f2;color:#E30613; }

/* Day block */
.cai-day-block { margin-bottom:16px; }
.cai-day-header { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;background:#f9fafb;border:1.5px solid #e5e7eb;border-bottom:none;border-radius:8px 8px 0 0;padding:10px 14px; }
.cai-day-label { font-size:13px;font-weight:700;color:#111;text-transform:capitalize; }
.cai-day-totals { display:flex;align-items:center;gap:14px; }
.cai-day-total-green { font-size:13px;font-weight:700;color:#16a34a; }
.cai-day-total-red   { font-size:13px;font-weight:700;color:#E30613; }
.cai-day-count { font-size:11.5px;color:#9ca3af; }

/* Info DG */
.cai-info-dg { background:#fffbeb;border:1px solid #fde68a;border-left:none;border-right:none;padding:8px 14px;font-size:12px;color:#92400e; }

/* Table */
.cai-table-wrap { background:#fff;border:1.5px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;overflow:hidden; }
.cai-table { width:100%;border-collapse:collapse; }
.cai-table thead tr { background:#f9fafb;border-bottom:1px solid #e5e7eb; }
.cai-table th { padding:8px 12px;font-size:10.5px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;text-align:left;white-space:nowrap; }
.cai-table td { padding:10px 12px;border-bottom:1px solid #f3f4f6;vertical-align:middle;font-size:12.5px; }
.cai-table tbody tr:last-child td { border-bottom:none; }
.cai-table tbody tr:hover { background:#fafafa; }

/* Badges */
.cai-badge-ok   { background:#f0fdf4;color:#15803d;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600;display:inline-flex; }
.cai-badge-wait { background:#fefce8;color:#92400e;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600;display:inline-flex; }
.cai-badge-rej  { background:#fff0f0;color:#b91c1c;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:600;display:inline-flex; }

/* Tags */
.cai-tag { background:#eff6ff;color:#1d4ed8;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:500; }
.cai-tag-mode { background:#f3f4f6;color:#374151; }

/* Action buttons */
.cai-btn-ok  { background:#16a34a;color:#fff;border:none;border-radius:5px;padding:5px 12px;font-size:11.5px;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap; }
.cai-btn-ok:hover { background:#15803d; }
.cai-btn-ok:disabled { opacity:.5;cursor:not-allowed; }
.cai-btn-rej { background:#fff;color:#E30613;border:1.5px solid #E30613;border-radius:5px;padding:5px 12px;font-size:11.5px;font-weight:600;font-family:inherit;cursor:pointer;white-space:nowrap; }
.cai-btn-rej:hover { background:#fef2f2; }
.cai-btn-rej:disabled { opacity:.5;cursor:not-allowed; }

/* Total global */
.cai-global-total { display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fff;border:1.5px solid #e5e7eb;border-radius:8px;margin-top:6px;font-size:13px; }
.cai-global-total strong { font-size:15px;font-weight:700;color:#111; }

/* Empty */
.cai-empty { text-align:center;padding:50px 20px;color:#9ca3af;font-size:13px; }

/* Toast */
.cai-toast { position:fixed;bottom:20px;right:20px;z-index:9999;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:600;font-family:'Poppins',sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.12); }
.cai-toast-ok  { background:#f0fdf4;color:#15803d;border:1.5px solid #bbf7d0; }
.cai-toast-err { background:#fef2f2;color:#b91c1c;border:1.5px solid #fecaca; }

@media (max-width: 768px) {
  .cai-table-wrap { overflow-x:auto;-webkit-overflow-scrolling:touch; }
  .cai-table { min-width:620px; }
  .cai-kpi-row { gap:8px; }
  .cai-filter-bar { flex-direction:column;align-items:stretch; }
  .cai-day-header { flex-direction:column;align-items:flex-start; }
}
</style>
