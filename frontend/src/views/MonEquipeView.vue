<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

interface Membre {
  id: number
  nom: string
  prenom: string
  role: string
  email: string
  statut: string
  last_login_at: string | null
  taches_a_faire: number
  taches_en_cours: number
  taches_en_revue: number
  taches_termine: number
  taches_en_retard: number
  taches_termines_30j: number
  vac_heures_mois: number
  vac_montant_mois: number
  seances_emargees_mois: number
  seances_total_mois: number
  activite_7j: number
  activite_30j: number
  derniere_action_at: string | null
}

type TypeAbsence = 'conge_annuel'|'maladie'|'exceptionnel'|'formation'|'mission'|'sans_solde'|'autre'
type StatutAbsence = 'en_attente'|'approuvee'|'refusee'|'annulee'

interface DemandeAbsence {
  id: number
  demandeur_id: number
  type_absence: TypeAbsence
  date_debut: string
  date_fin: string
  nb_jours_ouvrables: number
  motif: string | null
  justificatif_url: string | null
  statut: StatutAbsence
  decideur_id: number | null
  decision_at: string | null
  decision_commentaire: string | null
  created_at: string
  updated_at: string
  demandeur_nom?: string
  demandeur_prenom?: string
  demandeur_role?: string
  demandeur_email?: string
  decideur_nom?: string | null
  decideur_prenom?: string | null
}

interface SoldeAbsence {
  annee: number
  solde_initial: number
  jours_pris: number
  solde_restant: number
}

const auth = useAuthStore()
const isDecideur = computed(() => auth.user?.role === 'dg')

const tab = ref<'equipe' | 'absences'>('equipe')
const absencesSousTab = ref<'miennes' | 'a_valider'>('miennes')

const membres = ref<Membre[]>([])
const mois = ref('')
const loading = ref(true)
const filterRole = ref('')
const filterStatut = ref('actif')
const searchQ = ref('')

// ─── Demandes d'absence ────────────────────────────────────────────────────
const demandes = ref<DemandeAbsence[]>([])
const solde = ref<SoldeAbsence | null>(null)
const absencesLoading = ref(false)
const absenceError = ref('')
const absenceFiltreStatut = ref<'' | StatutAbsence>('')

const showAbsenceForm = ref(false)
const absenceForm = ref({
  type_absence: 'conge_annuel' as TypeAbsence,
  date_debut: '',
  date_fin: '',
  motif: '',
})
const absenceSaving = ref(false)

const showDecisionModal = ref(false)
const decisionTarget = ref<DemandeAbsence | null>(null)
const decisionForm = ref({ statut: 'approuvee' as 'approuvee' | 'refusee', commentaire: '' })
const decisionSaving = ref(false)

const TYPE_ABSENCE_LABEL: Record<TypeAbsence, string> = {
  conge_annuel: 'Congé annuel',
  maladie: 'Arrêt maladie',
  exceptionnel: 'Congé exceptionnel',
  formation: 'Formation',
  mission: 'Mission',
  sans_solde: 'Sans solde',
  autre: 'Autre',
}
const TYPE_ABSENCE_COLOR: Record<TypeAbsence, string> = {
  conge_annuel: 'bg-blue-100 text-blue-700',
  maladie: 'bg-red-100 text-red-700',
  exceptionnel: 'bg-amber-100 text-amber-700',
  formation: 'bg-violet-100 text-violet-700',
  mission: 'bg-indigo-100 text-indigo-700',
  sans_solde: 'bg-gray-100 text-gray-600',
  autre: 'bg-gray-100 text-gray-600',
}
const STATUT_ABSENCE_CONF: Record<StatutAbsence, { label: string; color: string }> = {
  en_attente: { label: 'En attente', color: 'bg-yellow-100 text-yellow-800' },
  approuvee: { label: 'Approuvée', color: 'bg-green-100 text-green-700' },
  refusee: { label: 'Refusée', color: 'bg-red-100 text-red-700' },
  annulee: { label: 'Annulée', color: 'bg-gray-100 text-gray-500' },
}

const ROLE_LABEL: Record<string, string> = {
  dg: 'Directeur Général', dir_peda: 'Directeur des études', resp_fin: 'Resp. Financier',
  coordinateur: 'Directeur adjoint des études', secretariat: 'Secrétariat',
}

const ROLE_COLOR: Record<string, string> = {
  dg: 'bg-purple-100 text-purple-700',
  dir_peda: 'bg-indigo-100 text-indigo-700',
  resp_fin: 'bg-emerald-100 text-emerald-700',
  coordinateur: 'bg-blue-100 text-blue-700',
  secretariat: 'bg-cyan-100 text-cyan-700',
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/mon-equipe')
    membres.value = data.membres
    mois.value = data.mois
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => {
  return membres.value.filter(m => {
    if (filterRole.value && m.role !== filterRole.value) return false
    if (filterStatut.value && m.statut !== filterStatut.value) return false
    if (searchQ.value) {
      const q = searchQ.value.toLowerCase()
      if (!`${m.prenom} ${m.nom} ${m.email}`.toLowerCase().includes(q)) return false
    }
    return true
  })
})

const totaux = computed(() => {
  const items = filtered.value
  return {
    agents: items.length,
    taches_en_cours: items.reduce((s, m) => s + m.taches_en_cours + m.taches_a_faire, 0),
    taches_en_retard: items.reduce((s, m) => s + m.taches_en_retard, 0),
    taches_termines_30j: items.reduce((s, m) => s + m.taches_termines_30j, 0),
    heures_mois: items.reduce((s, m) => s + Number(m.vac_heures_mois || 0), 0),
    activite_7j: items.reduce((s, m) => s + m.activite_7j, 0),
  }
})

function initials(m: Membre) {
  return `${(m.prenom?.[0] ?? '')}${(m.nom?.[0] ?? '')}`.toUpperCase()
}

function formatNumber(n: number, decimals = 0) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function formatMontant(n: number) {
  return formatNumber(Math.round(n)) + ' FCFA'
}

function relativeTime(d: string | null): string {
  if (!d) return 'Jamais'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'À l\'instant'
  if (mins < 60) return `Il y a ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `Il y a ${h} h`
  const days = Math.floor(h / 24)
  if (days < 30) return `Il y a ${days} j`
  const months = Math.floor(days / 30)
  return `Il y a ${months} mois`
}

function emargementRate(m: Membre): number | null {
  if (m.seances_total_mois === 0) return null
  return Math.round((m.seances_emargees_mois / m.seances_total_mois) * 100)
}

function activityLevel(m: Membre): 'haute' | 'moyenne' | 'basse' | 'nulle' {
  if (m.activite_7j === 0) return 'nulle'
  if (m.activite_7j >= 20) return 'haute'
  if (m.activite_7j >= 5) return 'moyenne'
  return 'basse'
}

const ACTIVITY_LEVEL_CONF = {
  haute:   { label: 'Élevée',  color: 'bg-green-100 text-green-700' },
  moyenne: { label: 'Moyenne', color: 'bg-blue-100 text-blue-700' },
  basse:   { label: 'Faible',  color: 'bg-yellow-100 text-yellow-700' },
  nulle:   { label: 'Aucune',  color: 'bg-gray-100 text-gray-500' },
}

async function loadAbsences() {
  absencesLoading.value = true
  absenceError.value = ''
  try {
    const params: string[] = []
    if (absencesSousTab.value === 'miennes') params.push('mine=1')
    else if (isDecideur.value) params.push('statut=en_attente')
    if (absenceFiltreStatut.value) params.push(`statut=${absenceFiltreStatut.value}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    const [list, soldeRes] = await Promise.all([
      api.get(`/demandes-absence${qs}`),
      api.get('/demandes-absence/solde').catch(() => ({ data: null })),
    ])
    demandes.value = list.data
    solde.value = soldeRes.data
  } catch (e: any) {
    absenceError.value = e.response?.data?.message ?? 'Erreur chargement des demandes.'
  } finally {
    absencesLoading.value = false
  }
}

function openAbsenceForm() {
  absenceForm.value = { type_absence: 'conge_annuel', date_debut: '', date_fin: '', motif: '' }
  absenceError.value = ''
  showAbsenceForm.value = true
}

// Estimation locale instantanée du nombre de jours ouvrables pour afficher
// un aperçu à l'agent pendant la saisie (le back recalcule avant insertion).
const absenceJoursEstimes = computed(() => {
  const d = absenceForm.value.date_debut, f = absenceForm.value.date_fin || absenceForm.value.date_debut
  if (!d || !f || f < d) return 0
  const start = new Date(d + 'T00:00:00Z')
  const end = new Date(f + 'T00:00:00Z')
  let n = 0
  for (let cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const j = cur.getUTCDay()
    if (j !== 0 && j !== 6) n++
  }
  return n
})

async function saveAbsence() {
  absenceSaving.value = true
  absenceError.value = ''
  try {
    await api.post('/demandes-absence', {
      type_absence: absenceForm.value.type_absence,
      date_debut: absenceForm.value.date_debut,
      date_fin: absenceForm.value.date_fin || absenceForm.value.date_debut,
      motif: absenceForm.value.motif || null,
    })
    showAbsenceForm.value = false
    await loadAbsences()
  } catch (e: any) {
    absenceError.value = e.response?.data?.message ?? 'Erreur envoi de la demande.'
  } finally {
    absenceSaving.value = false
  }
}

async function cancelDemande(d: DemandeAbsence) {
  if (!confirm(`Annuler la demande du ${formatDateFr(d.date_debut)} au ${formatDateFr(d.date_fin)} ?`)) return
  try {
    await api.put(`/demandes-absence/${d.id}/annuler`, {})
    await loadAbsences()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  }
}

function openDecision(d: DemandeAbsence, statut: 'approuvee' | 'refusee') {
  decisionTarget.value = d
  decisionForm.value = { statut, commentaire: '' }
  showDecisionModal.value = true
}

async function saveDecision() {
  if (!decisionTarget.value) return
  decisionSaving.value = true
  try {
    await api.put(`/demandes-absence/${decisionTarget.value.id}/decision`, {
      statut: decisionForm.value.statut,
      commentaire: decisionForm.value.commentaire || null,
    })
    showDecisionModal.value = false
    await loadAbsences()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  } finally {
    decisionSaving.value = false
  }
}

function formatDateFr(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatDateLong(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

// Export PDF — autorisation d'absence signée. Document officiel destiné à
// l'archivage RH et à la remise à l'agent. Mise en page A4 sobre, lisible,
// avec bloc signatures et référence unique de dossier.
async function exportAbsencePDF(d: DemandeAbsence) {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const red: [number, number, number] = [227, 6, 19]
  const dark: [number, number, number] = [30, 30, 30]
  const grey: [number, number, number] = [100, 100, 100]
  const page = { w: 210, h: 297 }
  const marge = 20
  let y = marge

  // En-tête UPTECH
  doc.setFillColor(...red); doc.rect(0, 0, page.w, 4, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...dark)
  doc.text('UPTECH CAMPUS', marge, y + 10)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...grey)
  doc.text('Ressources humaines — Gestion des absences', marge, y + 15)
  doc.text(`Réf. : ABS-${String(d.id).padStart(6, '0')}`, page.w - marge, y + 10, { align: 'right' })
  doc.text(`Émis le ${new Date().toLocaleDateString('fr-FR')}`, page.w - marge, y + 15, { align: 'right' })
  y += 22

  // Titre
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(...red)
  const titre = d.statut === 'approuvee' ? "AUTORISATION D'ABSENCE"
             : d.statut === 'refusee' ? "REFUS DE DEMANDE D'ABSENCE"
             : d.statut === 'annulee' ? "DEMANDE D'ABSENCE (ANNULÉE)"
             : "DEMANDE D'ABSENCE (EN ATTENTE)"
  doc.text(titre, page.w / 2, y + 8, { align: 'center' })
  y += 16

  doc.setDrawColor(...red); doc.setLineWidth(0.5)
  doc.line(marge, y, page.w - marge, y)
  y += 8

  // Bloc agent
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...dark)
  doc.text('AGENT CONCERNÉ', marge, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const ligne = (label: string, valeur: string) => {
    doc.setTextColor(...grey); doc.text(label, marge, y)
    doc.setTextColor(...dark); doc.text(valeur, marge + 55, y)
    y += 6
  }
  ligne('Nom et prénom :', `${d.demandeur_prenom ?? ''} ${d.demandeur_nom ?? ''}`.trim() || '—')
  ligne('Fonction / rôle :', d.demandeur_role ?? '—')
  ligne('Email :', d.demandeur_email ?? '—')
  y += 4

  // Bloc absence
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...dark)
  doc.text('ABSENCE DEMANDÉE', marge, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  ligne("Type d'absence :", TYPE_ABSENCE_LABEL[d.type_absence])
  ligne('Date de début :', formatDateLong(d.date_debut))
  ligne('Date de fin :', formatDateLong(d.date_fin))
  ligne('Durée :', `${d.nb_jours_ouvrables} jour(s) ouvrable(s)`)
  if (d.motif) {
    doc.setTextColor(...grey); doc.text('Motif :', marge, y)
    doc.setTextColor(...dark)
    const lignes = doc.splitTextToSize(d.motif, page.w - marge * 2 - 55)
    doc.text(lignes, marge + 55, y); y += 6 * lignes.length
  }
  y += 4

  // Bloc décision
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...dark)
  doc.text('DÉCISION', marge, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const statutLabel = STATUT_ABSENCE_CONF[d.statut].label.toUpperCase()
  ligne('Statut :', statutLabel)
  if (d.decideur_id && d.decision_at) {
    ligne('Décidée par :', `${d.decideur_prenom ?? ''} ${d.decideur_nom ?? ''}`.trim() || '—')
    ligne('Date de décision :', formatDateLong(d.decision_at))
    if (d.decision_commentaire) {
      doc.setTextColor(...grey); doc.text('Commentaire :', marge, y)
      doc.setTextColor(...dark)
      const lignes = doc.splitTextToSize(d.decision_commentaire, page.w - marge * 2 - 55)
      doc.text(lignes, marge + 55, y); y += 6 * lignes.length
    }
  }
  y += 8

  // Bloc signatures (pour document à archiver)
  doc.setDrawColor(...grey); doc.setLineWidth(0.2)
  const sigY = Math.max(y, page.h - 65)
  const colW = (page.w - marge * 2 - 10) / 2
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...dark)
  doc.text("Signature de l'agent", marge, sigY)
  doc.text("Signature et cachet de la Direction", marge + colW + 10, sigY)
  doc.rect(marge, sigY + 3, colW, 30)
  doc.rect(marge + colW + 10, sigY + 3, colW, 30)

  // Pied de page
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...grey)
  doc.text(
    `Document généré automatiquement par UPTECH Campus — toute décision est tracée dans les journaux d'audit (réf. dossier ABS-${String(d.id).padStart(6, '0')}).`,
    page.w / 2, page.h - 10, { align: 'center', maxWidth: page.w - marge * 2 }
  )

  const nomFichier = `absence_${(d.demandeur_nom ?? 'agent').toLowerCase().replace(/\s+/g, '_')}_${d.date_debut}.pdf`
  doc.save(nomFichier)
}

watch([tab, absencesSousTab, absenceFiltreStatut], ([newTab]) => {
  if (newTab === 'absences') loadAbsences()
})

onMounted(() => {
  load()
})
</script>

<template>
  <div class="p-6 max-w-7xl mx-auto">
    <!-- Header -->
    <div class="mb-4">
      <h1 class="text-xl font-bold text-gray-900">Mon équipe</h1>
      <p class="text-sm text-gray-500 mt-0.5">
        <template v-if="tab === 'equipe'">Vue consolidée de la productivité par agent — mois en cours ({{ mois }})</template>
        <template v-else>Suivi des autorisations d'absence du personnel administratif</template>
      </p>
    </div>

    <!-- Onglets principaux -->
    <div class="flex gap-1 border-b border-gray-200 mb-5">
      <button @click="tab = 'equipe'" :class="['px-4 py-2 text-sm font-medium border-b-2 -mb-px transition',
        tab === 'equipe' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700']">
        Équipe
      </button>
      <button @click="tab = 'absences'" :class="['px-4 py-2 text-sm font-medium border-b-2 -mb-px transition',
        tab === 'absences' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700']">
        Demandes d'absence
      </button>
    </div>

    <!-- ========================================================= -->
    <!-- ONGLET ÉQUIPE (existant)                                   -->
    <!-- ========================================================= -->
    <div v-if="tab === 'equipe'">

    <!-- KPIs globaux -->
    <div class="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Agents actifs</div>
        <div class="text-2xl font-bold text-gray-900">{{ totaux.agents }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Tâches en cours</div>
        <div class="text-2xl font-bold text-blue-600">{{ totaux.taches_en_cours }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">En retard</div>
        <div class="text-2xl font-bold text-red-600">{{ totaux.taches_en_retard }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Terminées 30j</div>
        <div class="text-2xl font-bold text-green-600">{{ totaux.taches_termines_30j }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Heures vacations (mois)</div>
        <div class="text-2xl font-bold text-gray-900">{{ formatNumber(totaux.heures_mois, 1) }}h</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 p-4">
        <div class="text-xs text-gray-500 font-medium mb-1">Actions 7j</div>
        <div class="text-2xl font-bold text-gray-900">{{ totaux.activite_7j }}</div>
      </div>
    </div>

    <!-- Filtres -->
    <div class="flex flex-wrap gap-2 mb-4">
      <input v-model="searchQ" placeholder="Rechercher un agent..."
        class="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64" />
      <select v-model="filterRole" class="px-3 py-2 border border-gray-300 rounded-lg text-sm">
        <option value="">Tous les rôles</option>
        <option v-for="(label, key) in ROLE_LABEL" :key="key" :value="key">{{ label }}</option>
      </select>
      <select v-model="filterStatut" class="px-3 py-2 border border-gray-300 rounded-lg text-sm">
        <option value="">Tous les statuts</option>
        <option value="actif">Actif</option>
        <option value="inactif">Inactif</option>
        <option value="suspendu">Suspendu</option>
        <option value="bloque">Bloqué</option>
      </select>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
      Chargement…
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="bg-white rounded-xl border border-gray-200 p-12 text-center">
      <p class="text-gray-500 text-sm">Aucun agent ne correspond aux filtres.</p>
    </div>

    <!-- Grille agents -->
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div v-for="m in filtered" :key="m.id"
        class="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition">

        <!-- Header carte -->
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-11 h-11 rounded-full bg-red-100 text-red-700 text-sm font-semibold flex items-center justify-center flex-shrink-0">
              {{ initials(m) }}
            </div>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-gray-900 truncate">{{ m.prenom }} {{ m.nom }}</div>
              <span :class="['inline-block text-xs font-medium px-2 py-0.5 rounded mt-0.5', ROLE_COLOR[m.role] || 'bg-gray-100 text-gray-700']">
                {{ ROLE_LABEL[m.role] || m.role }}
              </span>
            </div>
          </div>
          <span v-if="m.statut !== 'actif'"
            class="text-xs font-medium px-2 py-0.5 rounded bg-red-50 text-red-700 flex-shrink-0">
            {{ m.statut }}
          </span>
        </div>

        <!-- Tâches -->
        <div class="mb-4">
          <div class="text-xs font-medium text-gray-500 uppercase mb-1.5">Tâches</div>
          <div class="grid grid-cols-4 gap-2 text-center">
            <div class="bg-gray-50 rounded-lg py-1.5">
              <div class="text-base font-bold text-gray-700">{{ m.taches_a_faire }}</div>
              <div class="text-[10px] text-gray-500">À faire</div>
            </div>
            <div class="bg-blue-50 rounded-lg py-1.5">
              <div class="text-base font-bold text-blue-700">{{ m.taches_en_cours }}</div>
              <div class="text-[10px] text-blue-600">En cours</div>
            </div>
            <div class="bg-red-50 rounded-lg py-1.5">
              <div class="text-base font-bold text-red-700">{{ m.taches_en_retard }}</div>
              <div class="text-[10px] text-red-600">En retard</div>
            </div>
            <div class="bg-green-50 rounded-lg py-1.5">
              <div class="text-base font-bold text-green-700">{{ m.taches_termines_30j }}</div>
              <div class="text-[10px] text-green-600">Fait 30j</div>
            </div>
          </div>
        </div>

        <!-- Enseignants : heures + émargement -->
        <div v-if="m.role === 'enseignant'" class="mb-4">
          <div class="text-xs font-medium text-gray-500 uppercase mb-1.5">Activité pédagogique</div>
          <div class="grid grid-cols-2 gap-2">
            <div class="bg-amber-50 rounded-lg p-2">
              <div class="text-xs text-amber-700 font-medium">Heures (mois)</div>
              <div class="text-sm font-bold text-amber-900">{{ formatNumber(m.vac_heures_mois, 1) }}h</div>
              <div class="text-[10px] text-amber-600">{{ formatMontant(m.vac_montant_mois) }}</div>
            </div>
            <div class="bg-indigo-50 rounded-lg p-2">
              <div class="text-xs text-indigo-700 font-medium">Émargement</div>
              <div v-if="emargementRate(m) !== null" class="text-sm font-bold text-indigo-900">
                {{ emargementRate(m) }}%
              </div>
              <div v-else class="text-sm font-bold text-gray-400">—</div>
              <div class="text-[10px] text-indigo-600">
                {{ m.seances_emargees_mois }}/{{ m.seances_total_mois }} séances
              </div>
            </div>
          </div>
        </div>

        <!-- Activité app -->
        <div class="flex items-center justify-between pt-3 border-t border-gray-100">
          <div class="flex items-center gap-2">
            <span :class="['text-xs font-medium px-2 py-0.5 rounded', ACTIVITY_LEVEL_CONF[activityLevel(m)].color]">
              Activité : {{ ACTIVITY_LEVEL_CONF[activityLevel(m)].label }}
            </span>
            <span class="text-xs text-gray-400">
              {{ m.activite_7j }} actions (7j)
            </span>
          </div>
          <div class="text-right">
            <div class="text-[10px] text-gray-400">Dernière connexion</div>
            <div class="text-xs text-gray-600">{{ relativeTime(m.last_login_at) }}</div>
          </div>
        </div>
      </div>
    </div>

    </div><!-- /onglet équipe -->

    <!-- ========================================================= -->
    <!-- ONGLET DEMANDES D'ABSENCE                                  -->
    <!-- ========================================================= -->
    <div v-else-if="tab === 'absences'">

      <!-- Solde congés -->
      <div v-if="solde" class="bg-gradient-to-r from-red-50 to-orange-50 border border-red-100 rounded-xl p-4 mb-5 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div class="text-xs font-medium text-red-700 uppercase">Mon solde de congé annuel — {{ solde.annee }}</div>
          <div class="text-2xl font-bold text-gray-900 mt-1">
            {{ solde.solde_restant }} <span class="text-base font-normal text-gray-500">/ {{ solde.solde_initial }} jours ouvrables</span>
          </div>
          <div class="text-xs text-gray-500 mt-0.5">{{ solde.jours_pris }} jour(s) déjà approuvé(s) cette année</div>
        </div>
        <button @click="openAbsenceForm"
          class="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          Nouvelle demande
        </button>
      </div>

      <!-- Sous-onglets -->
      <div class="flex gap-1 mb-4 flex-wrap">
        <button @click="absencesSousTab = 'miennes'"
          :class="['px-3 py-1.5 text-xs font-medium rounded-lg transition',
            absencesSousTab === 'miennes' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200']">
          Mes demandes
        </button>
        <button v-if="isDecideur" @click="absencesSousTab = 'a_valider'"
          :class="['px-3 py-1.5 text-xs font-medium rounded-lg transition',
            absencesSousTab === 'a_valider' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200']">
          À valider
          <span v-if="absencesSousTab !== 'a_valider' && demandes.filter(d => d.statut === 'en_attente').length"
            class="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-yellow-400 text-yellow-900">
            {{ demandes.filter(d => d.statut === 'en_attente').length }}
          </span>
        </button>
        <select v-if="absencesSousTab === 'a_valider'" v-model="absenceFiltreStatut"
          class="ml-auto px-3 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
          <option value="">Tous les statuts</option>
          <option value="en_attente">En attente</option>
          <option value="approuvee">Approuvée</option>
          <option value="refusee">Refusée</option>
          <option value="annulee">Annulée</option>
        </select>
      </div>

      <!-- Erreur -->
      <div v-if="absenceError" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        {{ absenceError }}
      </div>

      <!-- Loading -->
      <div v-if="absencesLoading" class="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
        Chargement…
      </div>

      <!-- Liste vide -->
      <div v-else-if="demandes.length === 0" class="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p class="text-gray-500 text-sm">
          <template v-if="absencesSousTab === 'miennes'">Vous n'avez aucune demande d'absence.</template>
          <template v-else>Aucune demande à valider pour l'instant.</template>
        </p>
      </div>

      <!-- Liste des demandes -->
      <div v-else class="space-y-3">
        <div v-for="d in demandes" :key="d.id"
          class="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-4 flex-wrap">
          <!-- Avatar demandeur -->
          <div class="w-10 h-10 rounded-full bg-red-100 text-red-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {{ (d.demandeur_prenom?.[0] ?? '') + (d.demandeur_nom?.[0] ?? '') }}
          </div>
          <!-- Infos principales -->
          <div class="flex-1 min-w-[250px]">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="text-sm font-semibold text-gray-900">
                {{ d.demandeur_prenom }} {{ d.demandeur_nom }}
              </span>
              <span :class="['text-xs font-medium px-2 py-0.5 rounded', TYPE_ABSENCE_COLOR[d.type_absence]]">
                {{ TYPE_ABSENCE_LABEL[d.type_absence] }}
              </span>
              <span :class="['text-xs font-medium px-2 py-0.5 rounded', STATUT_ABSENCE_CONF[d.statut].color]">
                {{ STATUT_ABSENCE_CONF[d.statut].label }}
              </span>
            </div>
            <div class="text-sm text-gray-700 font-medium">
              Du {{ formatDateFr(d.date_debut) }} au {{ formatDateFr(d.date_fin) }}
              <span class="text-xs text-gray-500 font-normal">({{ d.nb_jours_ouvrables }} j ouvrables)</span>
            </div>
            <div v-if="d.motif" class="text-xs text-gray-600 mt-1 italic">
              « {{ d.motif }} »
            </div>
            <div v-if="d.decideur_id" class="text-xs text-gray-500 mt-2 border-t border-gray-100 pt-2">
              <template v-if="d.statut === 'approuvee'">Approuvée</template>
              <template v-else-if="d.statut === 'refusee'">Refusée</template>
              <template v-else>Décidée</template>
              par {{ d.decideur_prenom }} {{ d.decideur_nom }} — {{ formatDateFr(d.decision_at || '') }}
              <div v-if="d.decision_commentaire" class="mt-0.5 text-gray-600">
                <strong>Commentaire :</strong> {{ d.decision_commentaire }}
              </div>
            </div>
          </div>
          <!-- Actions -->
          <div class="flex flex-col gap-1.5 items-end flex-shrink-0">
            <template v-if="isDecideur && d.statut === 'en_attente' && d.demandeur_id !== auth.user?.id">
              <button @click="openDecision(d, 'approuvee')"
                class="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition min-w-[90px]">
                Approuver
              </button>
              <button @click="openDecision(d, 'refusee')"
                class="px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 transition min-w-[90px]">
                Refuser
              </button>
            </template>
            <button v-if="d.statut === 'en_attente' && d.demandeur_id === auth.user?.id"
              @click="cancelDemande(d)"
              class="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200 transition">
              Annuler
            </button>
            <button v-if="d.statut !== 'en_attente'"
              @click="exportAbsencePDF(d)"
              :title="d.statut === 'approuvee' ? 'Télécharger l\'autorisation signée' : 'Télécharger le document'"
              class="inline-flex items-center gap-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 transition">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              PDF
            </button>
          </div>
        </div>
      </div>
    </div><!-- /onglet absences -->

    <!-- ═════════════ Modal Nouvelle demande d'absence ═════════════ -->
    <Teleport to="body">
      <div v-if="showAbsenceForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40" @click="showAbsenceForm = false"></div>
        <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
          <h2 class="text-base font-semibold text-gray-900 mb-4">Nouvelle demande d'absence</h2>
          <div v-if="absenceError" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {{ absenceError }}
          </div>
          <form @submit.prevent="saveAbsence" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Type d'absence <span class="text-red-500">*</span></label>
              <select v-model="absenceForm.type_absence" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                <option v-for="(label, key) in TYPE_ABSENCE_LABEL" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Du <span class="text-red-500">*</span></label>
                <input v-model="absenceForm.date_debut" type="date" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Au <span class="text-red-500">*</span></label>
                <input v-model="absenceForm.date_fin" type="date" :min="absenceForm.date_debut" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
            </div>
            <div v-if="absenceJoursEstimes > 0" class="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
              Durée estimée : <strong>{{ absenceJoursEstimes }} jour(s) ouvrable(s)</strong> (hors week-end).
              <span v-if="absenceForm.type_absence === 'conge_annuel' && solde && absenceJoursEstimes > solde.solde_restant"
                class="block mt-1 text-red-600 font-medium">
                Attention : dépasse votre solde restant ({{ solde.solde_restant }} j).
              </span>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Motif</label>
              <textarea v-model="absenceForm.motif" rows="3" placeholder="Précisez le contexte (optionnel)…"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"></textarea>
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <button type="button" @click="showAbsenceForm = false"
                class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                Annuler
              </button>
              <button type="submit" :disabled="absenceSaving || !absenceForm.date_debut || !absenceForm.date_fin"
                class="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition disabled:opacity-50">
                {{ absenceSaving ? 'Envoi…' : 'Envoyer la demande' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- ═════════════ Modal Décision ═════════════ -->
    <Teleport to="body">
      <div v-if="showDecisionModal && decisionTarget" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40" @click="showDecisionModal = false"></div>
        <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
          <h2 class="text-base font-semibold text-gray-900 mb-2">
            {{ decisionForm.statut === 'approuvee' ? 'Approuver la demande' : 'Refuser la demande' }}
          </h2>
          <p class="text-xs text-gray-600 mb-4">
            {{ decisionTarget.demandeur_prenom }} {{ decisionTarget.demandeur_nom }} —
            {{ TYPE_ABSENCE_LABEL[decisionTarget.type_absence] }} du
            {{ formatDateFr(decisionTarget.date_debut) }} au {{ formatDateFr(decisionTarget.date_fin) }}
            ({{ decisionTarget.nb_jours_ouvrables }} j ouvrables).
          </p>
          <form @submit.prevent="saveDecision" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">
                Commentaire {{ decisionForm.statut === 'refusee' ? '(recommandé pour un refus)' : '(optionnel)' }}
              </label>
              <textarea v-model="decisionForm.commentaire" rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"></textarea>
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <button type="button" @click="showDecisionModal = false"
                class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                Annuler
              </button>
              <button type="submit" :disabled="decisionSaving"
                :class="['px-4 py-2 text-white text-sm font-medium rounded-lg transition disabled:opacity-50',
                  decisionForm.statut === 'approuvee' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700']">
                {{ decisionSaving ? 'Envoi…' : (decisionForm.statut === 'approuvee' ? 'Confirmer l\'approbation' : 'Confirmer le refus') }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
