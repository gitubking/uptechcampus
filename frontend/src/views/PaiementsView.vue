<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcFormGrid from '@/components/ui/UcFormGrid.vue'
import UcTable from '@/components/ui/UcTable.vue'

const activeTab = ref('tous')
const search = ref('')
const filterMode = ref('')
const showModal = ref(false)

const stats = ref({
  encaisse_mois: 4850000,
  total_impayes: 1240000,
  en_attente: 4,
  prevision: 5200000,
  relances: { j3: 8, j7: 6, j15: 4, j30: 4 },
})

interface Paiement {
  id: number
  numero_recu: string
  etudiant: { prenom: string; nom: string; numero_etudiant: string }
  filiere: string
  mode: string
  mois_concerne: string
  montant: number
  statut: string
  date: string
}

const paiements = ref<Paiement[]>([])
const loading = ref(false)

const form = ref({ etudiant_id: '', type: 'mensualite', mois_concerne: '', montant: 75000, mode: 'wave', reference: '' })

const modeLabel: Record<string, string> = { wave: 'Wave', cash: 'Espèces', orange_money: 'Orange Money', virement: 'Virement', cheque: 'Chèque' }
const modeClass: Record<string, string> = { wave: 'bg-sky-100 text-sky-700', cash: 'bg-slate-100 text-slate-600', orange_money: 'bg-orange-50 text-orange-700', virement: 'bg-green-50 text-green-700', cheque: 'bg-purple-50 text-purple-700' }
const statutClass: Record<string, string> = { confirme: 'bg-green-50 text-green-700', en_attente: 'bg-yellow-50 text-yellow-700', rejete: 'bg-red-50 text-red-600' }
const statutLabel: Record<string, string> = { confirme: 'Confirmé', en_attente: 'En attente', rejete: 'Rejeté' }
const avatarColors = ['#E30613','#3b82f6','#7c3aed','#0891b2','#be185d','#f97316','#15803d']

function initials(p: string, n: string) { return (p[0] ?? '') + (n[0] ?? '') }
function avatarColor(i: number) { return avatarColors[i % avatarColors.length] }
function fmt(n: number) { return n.toLocaleString('fr-FR') }

const DEMO: Paiement[] = [
  { id: 1, numero_recu: 'RECU-2026-00201', etudiant: { prenom: 'Aminata', nom: 'Fall', numero_etudiant: 'UPTECH-2025-001' }, filiere: 'DTS Informatique', mode: 'wave', mois_concerne: 'Mars 2026', montant: 75000, statut: 'confirme', date: '07/03/2026' },
  { id: 2, numero_recu: 'RECU-2026-00200', etudiant: { prenom: 'Moussa', nom: 'Sow', numero_etudiant: 'UPTECH-2025-002' }, filiere: 'BTS Webmaster', mode: 'cash', mois_concerne: 'Février 2026', montant: 60000, statut: 'confirme', date: '06/03/2026' },
  { id: 3, numero_recu: 'RECU-2026-00199', etudiant: { prenom: 'Fatou', nom: 'Diallo', numero_etudiant: 'UPTECH-2025-003' }, filiere: 'Licence Informatique', mode: 'orange_money', mois_concerne: 'Mars 2026', montant: 85000, statut: 'confirme', date: '05/03/2026' },
  { id: 4, numero_recu: 'RECU-2026-00198', etudiant: { prenom: 'Ibrahima', nom: 'Ba', numero_etudiant: 'UPTECH-2025-005' }, filiere: 'Master Audiovisuel', mode: 'virement', mois_concerne: 'Mars 2026', montant: 110000, statut: 'en_attente', date: '05/03/2026' },
  { id: 5, numero_recu: 'RECU-2026-00197', etudiant: { prenom: 'Marietou', nom: 'Cissé', numero_etudiant: 'UPTECH-2025-006' }, filiere: 'BTS Infographie', mode: 'cheque', mois_concerne: 'Janvier 2026', montant: 75000, statut: 'rejete', date: '04/03/2026' },
  { id: 6, numero_recu: 'RECU-2026-00196', etudiant: { prenom: 'Seydou', nom: 'Ndiaye', numero_etudiant: 'UPTECH-2025-004' }, filiere: 'DTS Réseaux', mode: 'wave', mois_concerne: 'Novembre 2025', montant: 75000, statut: 'confirme', date: '01/11/2025' },
]

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/paiements')
    paiements.value = data.data ?? data
  } catch {
    paiements.value = DEMO
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => paiements.value.filter(p => {
  const q = search.value.toLowerCase()
  const matchSearch = !q || p.etudiant.nom.toLowerCase().includes(q) || p.etudiant.prenom.toLowerCase().includes(q) || p.numero_recu.toLowerCase().includes(q)
  const matchMode = !filterMode.value || p.mode === filterMode.value
  const matchTab = activeTab.value === 'tous'
    || (activeTab.value === 'attente' && p.statut === 'en_attente')
    || (activeTab.value === 'impayes' && p.statut === 'rejete')
  return matchSearch && matchMode && matchTab
}))

async function savePaiement() {
  try { await api.post('/paiements', form.value) } catch { /* démo */ }
  showModal.value = false
  load()
}

const tableCols = [
  { key: 'recu', label: 'N° Reçu' },
  { key: 'etudiant', label: 'Étudiant' },
  { key: 'filiere', label: 'Filière' },
  { key: 'mode', label: 'Mode' },
  { key: 'mois', label: 'Mois' },
  { key: 'montant', label: 'Montant' },
  { key: 'statut', label: 'Statut' },
  { key: 'date', label: 'Date' },
  { key: 'actions', label: '' },
]

onMounted(load)
</script>

<template>
  <div class="p-6 max-w-7xl">

    <UcPageHeader title="Paiements" subtitle="Scolarité & Comptabilité">
      <template #actions>
        <button @click="showModal = true"
          class="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-700 transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          Enregistrer un paiement
        </button>
      </template>
    </UcPageHeader>

    <!-- KPI -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
      <div class="bg-white rounded-xl border border-gray-200 p-4 border-r-4 border-r-green-500">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Encaissé ce mois</p>
        <p class="text-xl font-bold text-gray-900">{{ fmt(stats.encaisse_mois) }} <span class="text-xs font-normal text-gray-400">FCFA</span></p>
        <p class="text-xs text-green-600 mt-1">↑ +12% vs mois précédent</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 border-r-4 border-r-red-500">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Total impayés</p>
        <p class="text-xl font-bold text-gray-900">{{ fmt(stats.total_impayes) }} <span class="text-xs font-normal text-gray-400">FCFA</span></p>
        <p class="text-xs text-red-500 mt-1">↓ 18 étudiants en retard</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 border-r-4 border-r-amber-500">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">En attente confirmation</p>
        <p class="text-xl font-bold text-gray-900">{{ stats.en_attente }} <span class="text-xs font-normal text-gray-400">dossiers</span></p>
        <p class="text-xs text-gray-400 mt-1">Wave / OM / Virement</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4 border-r-4 border-r-blue-500">
        <p class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Prévision mois prochain</p>
        <p class="text-xl font-bold text-gray-900">{{ fmt(stats.prevision) }} <span class="text-xs font-normal text-gray-400">FCFA</span></p>
        <p class="text-xs text-green-600 mt-1">↑ Base contractuelle</p>
      </div>
    </div>

    <!-- Relances -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
      <div v-for="(r, key, i) in stats.relances" :key="key"
        class="bg-white rounded-xl p-4 shadow-sm border-t-4"
        :class="['border-t-blue-500','border-t-orange-500','border-t-red-600','border-t-red-900'][i]">
        <p class="text-xs font-bold uppercase tracking-wide mb-2"
          :class="['text-blue-500','text-orange-500','text-red-600','text-red-900'][i]">J+{{ [3,7,15,30][i] }}</p>
        <p class="text-3xl font-bold text-gray-900">{{ r }}</p>
        <p class="text-xs text-gray-400 mt-1">étudiants en retard</p>
        <p class="text-xs text-gray-300 mt-2 pt-2 border-t border-gray-100">
          {{ ['SMS automatique','SMS + WhatsApp + Email','⚠ Alerte secrétariat','🔴 Alerte direction'][i] }}
        </p>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex gap-1 bg-white rounded-xl p-1 shadow-sm w-fit mb-4">
      <button v-for="tab in [{key:'tous',label:'Tous'},{key:'attente',label:'En attente'},{key:'impayes',label:'Impayés'},{key:'bourses',label:'Bourses'}]"
        :key="tab.key" @click="activeTab = tab.key"
        class="px-4 py-2 rounded-lg text-xs font-semibold transition"
        :class="activeTab === tab.key ? 'bg-red-600 text-white' : 'text-gray-500 hover:text-gray-700'">
        {{ tab.label }}
      </button>
    </div>

    <!-- Toolbar -->
    <div class="flex gap-3 mb-4 flex-wrap">
      <div class="relative flex-1 min-w-48">
        <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input v-model="search" type="text" placeholder="Rechercher…"
          class="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-red-400 bg-white"/>
      </div>
      <select v-model="filterMode" class="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400 bg-white">
        <option value="">Tous les modes</option>
        <option value="wave">Wave</option>
        <option value="cash">Espèces</option>
        <option value="orange_money">Orange Money</option>
        <option value="virement">Virement</option>
        <option value="cheque">Chèque</option>
      </select>
    </div>

    <!-- Table -->
    <div class="bg-white rounded-xl shadow-sm overflow-hidden">
      <div v-if="loading" class="p-8 text-center text-sm text-gray-400">Chargement…</div>
      <UcTable v-else :cols="tableCols" :data="filtered" empty-text="Aucun paiement trouvé">
        <template #row="{ item: p, index: i }">
          <td class="px-4 py-3 font-mono text-xs text-gray-400">{{ (p as any).numero_recu }}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" :style="{ background: avatarColor(i as number) }">
                {{ initials((p as any).etudiant.prenom, (p as any).etudiant.nom) }}
              </div>
              <div>
                <p class="text-sm font-semibold text-gray-900">{{ (p as any).etudiant.prenom }} {{ (p as any).etudiant.nom }}</p>
                <p class="text-xs text-gray-400">{{ (p as any).etudiant.numero_etudiant }}</p>
              </div>
            </div>
          </td>
          <td class="px-4 py-3 text-sm text-gray-500 hidden md:table-cell">{{ (p as any).filiere }}</td>
          <td class="px-4 py-3">
            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold" :class="modeClass[(p as any).mode] ?? 'bg-gray-100 text-gray-600'">
              {{ modeLabel[(p as any).mode] ?? (p as any).mode }}
            </span>
          </td>
          <td class="px-4 py-3 text-sm text-gray-500 hidden lg:table-cell">{{ (p as any).mois_concerne }}</td>
          <td class="px-4 py-3 font-bold text-sm text-green-600">+{{ fmt((p as any).montant) }} FCFA</td>
          <td class="px-4 py-3">
            <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold" :class="statutClass[(p as any).statut] ?? 'bg-gray-100 text-gray-500'">
              <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
              {{ statutLabel[(p as any).statut] ?? (p as any).statut }}
            </span>
          </td>
          <td class="px-4 py-3 text-xs text-gray-400 hidden lg:table-cell">{{ (p as any).date }}</td>
          <td class="px-4 py-3">
            <button v-if="(p as any).statut === 'en_attente'" class="text-xs border border-green-200 text-green-600 px-2 py-1 rounded hover:bg-green-50 transition">✓ Confirmer</button>
            <button v-else class="text-xs border border-gray-200 text-gray-500 px-2 py-1 rounded hover:border-red-300 hover:text-red-600 transition">Reçu</button>
          </td>
        </template>
      </UcTable>
      <div class="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-100">
        <span class="text-xs text-gray-400">{{ filtered.length }} paiement(s)</span>
        <div class="flex gap-1">
          <button class="w-8 h-8 border border-gray-200 rounded text-xs text-gray-400 opacity-40">←</button>
          <button class="w-8 h-8 border border-red-600 bg-red-600 rounded text-xs text-white font-bold">1</button>
          <button class="w-8 h-8 border border-gray-200 rounded text-xs text-gray-500 hover:border-red-300">→</button>
        </div>
      </div>
    </div>

    <!-- Modal -->
    <UcModal v-model="showModal" title="Enregistrer un paiement" width="512px" @close="showModal = false">
      <div class="space-y-4">
        <UcFormGroup label="Étudiant" :required="true">
          <select v-model="form.etudiant_id" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
            <option value="">-- Sélectionner --</option>
            <option value="1">Aminata Fall — UPTECH-2025-001</option>
            <option value="2">Moussa Sow — UPTECH-2025-002</option>
            <option value="3">Fatou Diallo — UPTECH-2025-003</option>
          </select>
        </UcFormGroup>

        <UcFormGrid :cols="2">
          <UcFormGroup label="Type" :required="true">
            <select v-model="form.type" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
              <option value="mensualite">Mensualité</option>
              <option value="inscription">Inscription</option>
              <option value="rattrapage">Rattrapage</option>
            </select>
          </UcFormGroup>
          <UcFormGroup label="Mois concerné">
            <input v-model="form.mois_concerne" type="month" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGrid :cols="2">
          <UcFormGroup label="Montant (FCFA)" :required="true">
            <input v-model="form.montant" type="number" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
          </UcFormGroup>
          <UcFormGroup label="Mode" :required="true">
            <select v-model="form.mode" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400">
              <option value="cash">Espèces</option>
              <option value="wave">Wave</option>
              <option value="orange_money">Orange Money</option>
              <option value="virement">Virement</option>
              <option value="cheque">Chèque</option>
            </select>
          </UcFormGroup>
        </UcFormGrid>

        <UcFormGroup label="Référence (optionnel)">
          <input v-model="form.reference" type="text" placeholder="Ex: Ref Wave #TX2026…" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-red-400"/>
        </UcFormGroup>

        <div v-if="form.etudiant_id" class="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p class="text-xs font-bold text-gray-400 text-center uppercase tracking-wide mb-3">Aperçu du reçu</p>
          <p class="text-center font-bold text-sm text-gray-900">UPTECH Campus</p>
          <p class="text-center text-xs text-red-600 font-bold font-mono mt-1 mb-3">RECU-2026-XXXX</p>
          <div class="space-y-1 text-xs">
            <div class="flex justify-between py-1 border-b border-gray-100"><span class="text-gray-400">Mode</span><span class="font-semibold">{{ modeLabel[form.mode] }}</span></div>
            <div class="flex justify-between py-1"><span class="text-gray-400">Montant</span><span class="font-bold text-green-600">{{ fmt(form.montant) }} FCFA</span></div>
          </div>
          <p class="text-center text-xs text-gray-300 mt-3">📱 SMS + WhatsApp envoyé automatiquement</p>
        </div>
      </div>

      <template #footer>
        <button @click="showModal = false" class="px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:border-gray-300">Annuler</button>
        <button @click="savePaiement" class="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 transition">Confirmer & Imprimer</button>
      </template>
    </UcModal>

  </div>
</template>
