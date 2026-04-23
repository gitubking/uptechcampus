<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'
import { openPrintWindow, uptechHeaderHTML, uptechFooterHTML, uptechPrintCSS } from '@/utils/uptechPrint'

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
  decideur_signature?: string | null  // Data URL base64 pour apposer sur le PDF
}

interface SoldeAbsence {
  annee: number
  solde_initial: number
  jours_pris: number
  solde_restant: number
}

const auth = useAuthStore()
const isDecideur = computed(() => auth.user?.role === 'dg')

const sousTab = ref<'miennes' | 'a_valider'>('miennes')
const filtreStatut = ref<'' | StatutAbsence>('')

const demandes = ref<DemandeAbsence[]>([])
const solde = ref<SoldeAbsence | null>(null)
const loading = ref(false)
const error = ref('')

const showForm = ref(false)
const form = ref({
  type_absence: 'conge_annuel' as TypeAbsence,
  date_debut: '',
  date_fin: '',
  motif: '',
})
const saving = ref(false)

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

async function load() {
  loading.value = true
  error.value = ''
  try {
    const params: string[] = []
    if (sousTab.value === 'miennes') params.push('mine=1')
    if (filtreStatut.value) params.push(`statut=${filtreStatut.value}`)
    const qs = params.length ? `?${params.join('&')}` : ''
    const [list, soldeRes] = await Promise.all([
      api.get(`/demandes-absence${qs}`),
      api.get('/demandes-absence/solde').catch(() => ({ data: null })),
    ])
    demandes.value = list.data
    solde.value = soldeRes.data
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur chargement des demandes.'
  } finally {
    loading.value = false
  }
}

function openForm() {
  form.value = { type_absence: 'conge_annuel', date_debut: '', date_fin: '', motif: '' }
  error.value = ''
  showForm.value = true
}

// Aperçu local des jours ouvrables (hors week-end). Le back recalcule.
const joursEstimes = computed(() => {
  const d = form.value.date_debut, f = form.value.date_fin || form.value.date_debut
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

async function save() {
  saving.value = true
  error.value = ''
  try {
    await api.post('/demandes-absence', {
      type_absence: form.value.type_absence,
      date_debut: form.value.date_debut,
      date_fin: form.value.date_fin || form.value.date_debut,
      motif: form.value.motif || null,
    })
    showForm.value = false
    await load()
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Erreur envoi de la demande.'
  } finally {
    saving.value = false
  }
}

async function cancelDemande(d: DemandeAbsence) {
  if (!confirm(`Annuler la demande du ${formatDateFr(d.date_debut)} au ${formatDateFr(d.date_fin)} ?`)) return
  try {
    await api.put(`/demandes-absence/${d.id}/annuler`, {})
    await load()
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
    await load()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  } finally {
    decisionSaving.value = false
  }
}

// Purge complète — réservée au DG pour nettoyer les données de test après
// la mise en production. Double confirmation pour éviter toute erreur.
async function deleteDemande(d: DemandeAbsence) {
  const label = `${d.demandeur_prenom ?? ''} ${d.demandeur_nom ?? ''} — ${TYPE_ABSENCE_LABEL[d.type_absence]} du ${formatDateFr(d.date_debut)}`
  if (!confirm(`Supprimer définitivement cette demande ?\n\n${label}\n\nCette action est irréversible.`)) return
  try {
    await api.delete(`/demandes-absence/${d.id}`)
    await load()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
  }
}

async function resetToutesLesDemandes() {
  const premier = confirm(
    "⚠️  Supprimer TOUTES les demandes d'absence (tous agents, tous statuts) ?\n\n" +
    "Cette action est IRRÉVERSIBLE. Utilisez-la uniquement pour nettoyer les données de test."
  )
  if (!premier) return
  const deuxieme = prompt(
    "Pour confirmer, tapez exactement : EFFACER",
  )
  if (deuxieme !== 'EFFACER') {
    alert("Opération annulée (confirmation incorrecte).")
    return
  }
  try {
    const { data } = await api.delete('/demandes-absence/reset?confirm=OUI')
    alert(`${data.supprimees ?? 0} demande(s) supprimée(s).`)
    await load()
  } catch (e: any) {
    alert(e.response?.data?.message ?? 'Erreur')
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

// Export PDF — document officiel A4 imprimable. Utilise l'en-tête institutionnel
// partagé (uptechPrint.ts) pour une uniformisation avec les reçus de paiement
// et autres documents UPTECH.
function exportPDF(d: DemandeAbsence) {
  const ref = `ABS-${String(d.id).padStart(6, '0')}`
  const titre = d.statut === 'approuvee' ? "AUTORISATION D'ABSENCE"
             : d.statut === 'refusee' ? "REFUS DE DEMANDE D'ABSENCE"
             : d.statut === 'annulee' ? "DEMANDE D'ABSENCE (ANNULÉE)"
             : "DEMANDE D'ABSENCE"
  const statutClass = d.statut === 'approuvee' ? 'approved'
                    : d.statut === 'refusee' ? 'rejected'
                    : d.statut === 'annulee' ? 'cancelled' : 'pending'
  const statutLabel = STATUT_ABSENCE_CONF[d.statut].label
  const demandeurFull = `${d.demandeur_prenom ?? ''} ${d.demandeur_nom ?? ''}`.trim() || '—'
  const decideurFull = d.decideur_id ? `${d.decideur_prenom ?? ''} ${d.decideur_nom ?? ''}`.trim() : ''
  const emitDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <title>${titre} — ${ref}</title>
  <style>
    ${uptechPrintCSS()}
    .abs-sub{display:flex;justify-content:space-between;align-items:center;padding:4px 16px;background:#fafafa;border-bottom:1px solid #eee;font-size:9px;color:#666}
    .abs-sub .left{font-weight:600;color:#E30613;text-transform:uppercase;letter-spacing:1px}
  </style></head>
  <body>
    ${uptechHeaderHTML()}
    <div class="abs-sub">
      <span class="left">Ressources humaines — Gestion des absences</span>
      <span>Émis le ${emitDate} · Réf. ${ref}</span>
    </div>
    <div class="doc-content">
      <div class="doc-title">${titre}</div>
      <div class="doc-subtitle">Document officiel — archivage dossier RH</div>

      <!-- AGENT -->
      <div class="doc-section-title">Agent concerné</div>
      <div class="info-grid">
        <div class="info-box full"><label>Nom et prénom</label><span>${demandeurFull}</span></div>
        <div class="info-box"><label>Fonction / rôle</label><span>${d.demandeur_role ?? '—'}</span></div>
        <div class="info-box"><label>Email</label><span style="font-size:10px">${d.demandeur_email ?? '—'}</span></div>
      </div>

      <!-- ABSENCE -->
      <div class="doc-section-title">Absence demandée</div>
      <div class="info-grid">
        <div class="info-box full"><label>Type d'absence</label><span>${TYPE_ABSENCE_LABEL[d.type_absence]}</span></div>
        <div class="info-box"><label>Date de début</label><span>${formatDateLong(d.date_debut)}</span></div>
        <div class="info-box"><label>Date de fin</label><span>${formatDateLong(d.date_fin)}</span></div>
        <div class="info-box full"><label>Durée</label><span>${d.nb_jours_ouvrables} jour(s) ouvrable(s)</span></div>
      </div>
      ${d.motif ? `
        <div style="font-size:7px;text-transform:uppercase;color:#aaa;font-weight:700;letter-spacing:0.5px;margin-top:6px;margin-bottom:3px">Motif fourni par l'agent</div>
        <div class="motif-box">${escapeHtml(d.motif)}</div>
      ` : ''}

      <!-- DÉCISION -->
      <div class="doc-section-title">Décision</div>
      <div class="decision-box ${statutClass}">
        <div class="dec-lbl">Statut</div>
        <div class="dec-val">${statutLabel.toUpperCase()}</div>
        ${d.decideur_id && d.decision_at ? `
          <div class="dec-note">
            <strong>Décidée par :</strong> ${decideurFull || '—'}<br>
            <strong>Date de décision :</strong> ${formatDateLong(d.decision_at)}
            ${d.decision_commentaire ? `<br><strong>Commentaire :</strong> ${escapeHtml(d.decision_commentaire)}` : ''}
          </div>
        ` : `<div class="dec-note" style="font-style:italic">En attente de la décision de la Direction générale.</div>`}
      </div>

      <!-- SIGNATURES -->
      <div class="sign-area">
        <div class="sign-box">
          <div class="sign-title">Signature de l'agent</div>
          <div class="sign-line"></div>
          <div class="sign-hint">Date &amp; nom lisible</div>
        </div>
        <div class="sign-box">
          <div class="sign-title">Signature et cachet de la Direction</div>
          <div class="sign-line">${d.decideur_signature ? `<img src="${d.decideur_signature}" alt="Signature Direction" class="sign-img" />` : ''}</div>
          <div class="sign-hint">${decideurFull ? decideurFull : '—'}</div>
        </div>
      </div>
    </div>
    ${uptechFooterHTML(`Document ${ref} · toute décision est tracée dans les journaux d'audit`)}
  </body></html>`

  openPrintWindow(html)
}

// Sécurise les chaînes utilisateur injectées dans le HTML imprimable.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

watch([sousTab, filtreStatut], () => load())
onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <!-- Header ───────────────────────────────────────────────────── -->
    <header class="mb-6 flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-red-600">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          Ressources humaines
        </div>
        <h1 class="mt-1 text-2xl font-bold tracking-tight text-gray-900">Demandes d'absence</h1>
        <p class="mt-1 text-sm text-gray-500">
          Déposez vos demandes d'autorisation d'absence et suivez leur traitement.
        </p>
      </div>
      <button @click="openForm"
        class="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 hover:shadow">
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        Nouvelle demande
      </button>
    </header>

    <!-- Solde congés — hero card ────────────────────────────────── -->
    <div v-if="solde" class="mb-6 overflow-hidden rounded-2xl border border-red-100 bg-gradient-to-br from-red-50 via-orange-50 to-amber-50 shadow-sm">
      <div class="p-5 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-red-700">
            <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Solde de congé annuel · {{ solde.annee }}
          </div>
          <div class="mt-2 flex items-baseline gap-2">
            <span class="text-4xl font-bold text-gray-900">{{ solde.solde_restant }}</span>
            <span class="text-sm text-gray-600">sur {{ solde.solde_initial }} jours ouvrables restants</span>
          </div>
          <div class="mt-1 text-xs text-gray-600">
            {{ solde.jours_pris }} jour{{ solde.jours_pris > 1 ? 's' : '' }} déjà approuvé{{ solde.jours_pris > 1 ? 's' : '' }} cette année
          </div>
        </div>
        <!-- Jauge circulaire -->
        <div class="relative h-24 w-24 flex-shrink-0">
          <svg class="h-24 w-24 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" stroke="#fde68a" stroke-width="10" fill="none"/>
            <circle cx="50" cy="50" r="40"
              :stroke="solde.solde_restant / solde.solde_initial > 0.3 ? '#10b981' : '#ef4444'"
              stroke-width="10" fill="none"
              :stroke-dasharray="251.2"
              :stroke-dashoffset="251.2 - (251.2 * solde.solde_restant / solde.solde_initial)"
              stroke-linecap="round"/>
          </svg>
          <div class="absolute inset-0 flex flex-col items-center justify-center">
            <span class="text-xl font-bold text-gray-900">{{ Math.round(100 * solde.solde_restant / solde.solde_initial) }}%</span>
            <span class="text-[9px] uppercase tracking-wider text-gray-500">restant</span>
          </div>
        </div>
      </div>
      <!-- Barre de progression horizontale -->
      <div class="h-1.5 bg-white/60">
        <div class="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
          :style="{ width: (100 * solde.solde_restant / solde.solde_initial) + '%' }"></div>
      </div>
    </div>

    <!-- Sous-onglets ────────────────────────────────────────────── -->
    <div class="mb-5 flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        <button @click="sousTab = 'miennes'"
          :class="['inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
            sousTab === 'miennes' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50']">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          Mes demandes
        </button>
        <button v-if="isDecideur" @click="sousTab = 'a_valider'"
          :class="['inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition',
            sousTab === 'a_valider' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50']">
          <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
          À valider
          <span v-if="sousTab !== 'a_valider' && demandes.filter(d => d.statut === 'en_attente').length"
            class="inline-flex min-w-[18px] items-center justify-center rounded-full bg-yellow-400 px-1 text-[10px] font-bold text-yellow-900">
            {{ demandes.filter(d => d.statut === 'en_attente').length }}
          </span>
        </button>
      </div>
      <select v-if="sousTab === 'a_valider'" v-model="filtreStatut"
        class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
        <option value="">Tous les statuts</option>
        <option value="en_attente">En attente</option>
        <option value="approuvee">Approuvée</option>
        <option value="refusee">Refusée</option>
        <option value="annulee">Annulée</option>
      </select>
      <span class="ml-auto text-xs text-gray-500">
        {{ demandes.length }} demande{{ demandes.length > 1 ? 's' : '' }}
      </span>
      <button v-if="isDecideur && sousTab === 'a_valider' && demandes.length > 0"
        @click="resetToutesLesDemandes"
        class="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
        title="Effacer toutes les demandes (données de test)">
        <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/></svg>
        Effacer les données de test
      </button>
    </div>

    <!-- Erreur -->
    <div v-if="error" class="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      <svg class="h-4 w-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="rounded-2xl border border-gray-200 bg-white p-16 text-center">
      <div class="inline-block h-8 w-8 animate-spin rounded-full border-2 border-red-200 border-t-red-600"></div>
      <p class="mt-3 text-sm text-gray-500">Chargement des demandes…</p>
    </div>

    <!-- Liste vide -->
    <div v-else-if="demandes.length === 0"
      class="rounded-2xl border border-dashed border-gray-300 bg-white p-16 text-center">
      <svg class="mx-auto h-10 w-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      <p class="mt-3 text-sm font-medium text-gray-700">
        <template v-if="sousTab === 'miennes'">Vous n'avez aucune demande d'absence.</template>
        <template v-else>Aucune demande à valider pour l'instant.</template>
      </p>
      <p v-if="sousTab === 'miennes'" class="mt-1 text-xs text-gray-500">Cliquez sur « Nouvelle demande » pour en déposer une.</p>
    </div>

    <!-- Liste ──────────────────────────────────────────────────── -->
    <div v-else class="space-y-3">
      <article v-for="d in demandes" :key="d.id"
        class="group relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md">
        <!-- Liseret gauche selon statut -->
        <div :class="['absolute left-0 top-0 h-full w-1',
          d.statut === 'en_attente' ? 'bg-yellow-400' :
          d.statut === 'approuvee' ? 'bg-emerald-500' :
          d.statut === 'refusee' ? 'bg-red-500' : 'bg-gray-300']"></div>

        <div class="pl-5 pr-4 py-4 flex items-start gap-4 flex-wrap">
          <div class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-red-500 to-red-700 text-xs font-bold text-white shadow-sm">
            {{ (d.demandeur_prenom?.[0] ?? '') + (d.demandeur_nom?.[0] ?? '') }}
          </div>
          <div class="flex-1 min-w-[260px]">
            <div class="mb-1.5 flex items-center gap-2 flex-wrap">
              <span class="text-sm font-semibold text-gray-900">
                {{ d.demandeur_prenom }} {{ d.demandeur_nom }}
              </span>
              <span :class="['rounded-full px-2 py-0.5 text-[11px] font-semibold', TYPE_ABSENCE_COLOR[d.type_absence]]">
                {{ TYPE_ABSENCE_LABEL[d.type_absence] }}
              </span>
              <span :class="['inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUT_ABSENCE_CONF[d.statut].color]">
                <span :class="['h-1.5 w-1.5 rounded-full',
                  d.statut === 'en_attente' ? 'bg-yellow-500 animate-pulse' :
                  d.statut === 'approuvee' ? 'bg-emerald-600' :
                  d.statut === 'refusee' ? 'bg-red-600' : 'bg-gray-500']"></span>
                {{ STATUT_ABSENCE_CONF[d.statut].label }}
              </span>
              <span class="ml-auto text-[10px] font-mono text-gray-400">ABS-{{ String(d.id).padStart(6, '0') }}</span>
            </div>
            <div class="flex items-center gap-2 text-sm text-gray-800">
              <svg class="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              <span class="font-medium">{{ formatDateFr(d.date_debut) }}</span>
              <svg class="h-3 w-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
              <span class="font-medium">{{ formatDateFr(d.date_fin) }}</span>
              <span class="inline-flex rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-700">
                {{ d.nb_jours_ouvrables }} j ouvrables
              </span>
            </div>
            <div v-if="d.motif" class="mt-1.5 text-xs italic text-gray-600 border-l-2 border-gray-200 pl-2">
              {{ d.motif }}
            </div>
            <div v-if="d.decideur_id" class="mt-2.5 border-t border-gray-100 pt-2 text-[11px]">
              <div class="flex items-center gap-1.5 text-gray-600">
                <svg :class="['h-3 w-3', d.statut === 'approuvee' ? 'text-emerald-600' : d.statut === 'refusee' ? 'text-red-600' : 'text-gray-400']"
                  fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path v-if="d.statut === 'approuvee'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                  <path v-else-if="d.statut === 'refusee'" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
                  <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3"/>
                </svg>
                <span class="font-semibold">
                  <template v-if="d.statut === 'approuvee'">Approuvée</template>
                  <template v-else-if="d.statut === 'refusee'">Refusée</template>
                  <template v-else>Décidée</template>
                </span>
                par <span class="font-medium text-gray-800">{{ d.decideur_prenom }} {{ d.decideur_nom }}</span>
                · {{ formatDateFr(d.decision_at || '') }}
              </div>
              <div v-if="d.decision_commentaire" class="mt-1 rounded-md bg-gray-50 px-2 py-1 text-gray-600">
                <strong class="text-gray-700">Commentaire :</strong> {{ d.decision_commentaire }}
              </div>
            </div>
          </div>
          <div class="flex flex-shrink-0 flex-col items-end gap-1.5">
            <template v-if="isDecideur && d.statut === 'en_attente' && d.demandeur_id !== auth.user?.id">
              <button @click="openDecision(d, 'approuvee')"
                class="inline-flex min-w-[90px] items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700">
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                Approuver
              </button>
              <button @click="openDecision(d, 'refusee')"
                class="inline-flex min-w-[90px] items-center justify-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700">
                <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
                Refuser
              </button>
            </template>
            <button v-if="d.statut === 'en_attente' && d.demandeur_id === auth.user?.id"
              @click="cancelDemande(d)"
              class="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-200">
              Annuler
            </button>
            <button v-if="d.statut !== 'en_attente'"
              @click="exportPDF(d)"
              class="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
              PDF
            </button>
            <button v-if="isDecideur" @click="deleteDemande(d)"
              title="Supprimer cette demande (DG uniquement)"
              class="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600">
              <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3"/></svg>
            </button>
          </div>
        </div>
      </article>
    </div>

    <!-- Modal Nouvelle demande -->
    <Teleport to="body">
      <div v-if="showForm" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40" @click="showForm = false"></div>
        <div class="relative bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
          <h2 class="text-base font-semibold text-gray-900 mb-4">Nouvelle demande d'absence</h2>
          <div v-if="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {{ error }}
          </div>
          <form @submit.prevent="save" class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Type d'absence <span class="text-red-500">*</span></label>
              <select v-model="form.type_absence" required
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500">
                <option v-for="(label, key) in TYPE_ABSENCE_LABEL" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Du <span class="text-red-500">*</span></label>
                <input v-model="form.date_debut" type="date" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-700 mb-1">Au <span class="text-red-500">*</span></label>
                <input v-model="form.date_fin" type="date" :min="form.date_debut" required
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
            </div>
            <div v-if="joursEstimes > 0" class="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
              Durée estimée : <strong>{{ joursEstimes }} jour(s) ouvrable(s)</strong> (hors week-end).
              <span v-if="form.type_absence === 'conge_annuel' && solde && joursEstimes > solde.solde_restant"
                class="block mt-1 text-red-600 font-medium">
                Attention : dépasse votre solde restant ({{ solde.solde_restant }} j).
              </span>
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-700 mb-1">Motif</label>
              <textarea v-model="form.motif" rows="3" placeholder="Précisez le contexte (optionnel)…"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"></textarea>
            </div>
            <div class="flex justify-end gap-2 pt-2">
              <button type="button" @click="showForm = false"
                class="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition">
                Annuler
              </button>
              <button type="submit" :disabled="saving || !form.date_debut || !form.date_fin"
                class="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition disabled:opacity-50">
                {{ saving ? 'Envoi…' : 'Envoyer la demande' }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- Modal Décision -->
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
