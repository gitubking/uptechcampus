<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))

const activeTab = ref<'infos'|'classes'|'seances'|'vacations'|'avis'>('infos')

interface Filiere { id: number; nom: string; code: string }
interface EnseignantFiliere { filiere_id: number; matiere: string; filiere?: Filiere }
interface ClasseUE { id: number; code: string; intitule: string; coefficient: number; credits_ects: number; classe: { id: number; nom: string; est_tronc_commun: boolean } }
interface Enseignant {
  id: number; nom: string; prenom: string; email: string
  telephone: string | null; statut: string; numero_contrat: string
  specialite: string | null; grade: string | null
  type_contrat: string | null; tarif_horaire: number | null
  annee_academique?: { id: number; libelle: string }
  filieres?: EnseignantFiliere[]
  ues?: ClasseUE[]
}
interface Stats {
  seances_ce_mois: number; heures_ce_mois: number
  seances_total: number; heures_total: number
  tarif_horaire: number; montant_du: number
  montant_paye: number; montant_restant: number
  classes: { id: number; nom: string; est_tronc_commun: boolean; nb_ues: number }[]
}
interface Seance {
  id: number; matiere: string; date_debut: string; date_fin: string
  mode: string; salle: string | null; statut: string
  duree_heures: number; nb_presents: number; nb_inscrits: number
  classe?: { id: number; nom: string }
}

const enseignant = ref<Enseignant | null>(null)
const stats = ref<Stats | null>(null)
const seances = ref<Seance[]>([])
const loading = ref(true)
const loadingSeances = ref(false)

const statutConfig: Record<string, { label: string; cls: string }> = {
  actif:      { label: 'Actif',       cls: 'ed-badge-actif' },
  en_attente: { label: 'En attente',  cls: 'ed-badge-attente' },
  inactif:    { label: 'Inactif',     cls: 'ed-badge-inactif' },
  suspendu:   { label: 'Suspendu',    cls: 'ed-badge-suspendu' },
}
const seanceStatutConfig: Record<string, { label: string; cls: string }> = {
  planifie:  { label: 'Planifié',   cls: 'ed-s-planifie' },
  confirme:  { label: 'Confirmé',   cls: 'ed-s-confirme' },
  annule:    { label: 'Annulé',     cls: 'ed-s-annule' },
  reporte:   { label: 'Reporté',    cls: 'ed-s-reporte' },
}
const typeContratLabels: Record<string, string> = {
  vacataire: 'Vacataire', cdi: 'CDI', cdd: 'CDD', freelance: 'Freelance', stagiaire: 'Stagiaire'
}

function fmt(n: number) { return Math.round(n).toLocaleString('fr-FR') + ' FCFA' }
function fmtDate(d: string) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtHeure(d: string) {
  if (!d) return ''
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function waLink() {
  if (!enseignant.value?.telephone) return ''
  let p = enseignant.value.telephone.replace(/[\s\-\.\(\)]/g, '')
  if (p.startsWith('00221')) p = '+' + p.slice(2)
  else if (/^\d{9}$/.test(p)) p = '+221' + p
  else if (/^221\d{9}$/.test(p)) p = '+' + p
  else if (!p.startsWith('+')) p = '+221' + p
  const msg = encodeURIComponent(`Bonjour ${enseignant.value.prenom},\n\nNous vous contactons de la part d'Uptech Campus.`)
  return `https://wa.me/${p.replace('+', '')}?text=${msg}`
}

// Grouper les UEs par classe
const uesByClasse = computed(() => {
  const map: Record<string, { classe: ClasseUE['classe']; ues: ClasseUE[] }> = {}
  for (const ue of enseignant.value?.ues ?? []) {
    const key = String(ue.classe.id)
    if (!map[key]) map[key] = { classe: ue.classe, ues: [] }
    map[key].ues.push(ue)
  }
  return Object.values(map)
})

async function load() {
  loading.value = true
  try {
    const [ensRes, statsRes] = await Promise.all([
      api.get(`/enseignants/${route.params.id}`),
      api.get(`/enseignants/${route.params.id}/stats`),
    ])
    enseignant.value = ensRes.data
    stats.value = statsRes.data
  } finally { loading.value = false }
}

async function loadSeances() {
  loadingSeances.value = true
  try {
    const { data } = await api.get(`/enseignants/${route.params.id}/seances`)
    seances.value = data
  } finally { loadingSeances.value = false }
}

const now = new Date()
const seancesAvenir = computed(() =>
  seances.value.filter(s => new Date(s.date_debut) >= now).sort((a, b) => new Date(a.date_debut).getTime() - new Date(b.date_debut).getTime())
)
const seancesPassees = computed(() =>
  seances.value.filter(s => new Date(s.date_debut) < now).sort((a, b) => new Date(b.date_debut).getTime() - new Date(a.date_debut).getTime())
)
const openVenir = ref(false)

// ── Avis (évaluations étudiants) ─────────────────────────────────────
interface AvisSeance {
  seance_id: number; matiere: string; date_debut: string; classe: string
  nb_evaluations: number; moyenne: string | number; commentaires: string[] | null
}
interface AvisData { moyenne_globale: number | null; nb_total: number; seances: AvisSeance[] }
const avisData = ref<AvisData | null>(null)
const loadingAvis = ref(false)

async function loadAvis() {
  if (avisData.value) return
  loadingAvis.value = true
  try {
    const { data } = await api.get(`/enseignants/${route.params.id}/evaluations`)
    avisData.value = data
  } catch { /* ignore */ }
  finally { loadingAvis.value = false }
}

async function switchTab(tab: typeof activeTab.value) {
  activeTab.value = tab
  if (tab === 'seances' && seances.value.length === 0) loadSeances()
  if (tab === 'avis') loadAvis()
}

onMounted(load)
</script>

<template>
  <div class="ed-wrap">

    <!-- Retour -->
    <button @click="router.back()" class="ed-back">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
      </svg>
      Retour aux enseignants
    </button>

    <div v-if="loading" style="text-align:center;padding:60px;color:#9ca3af;font-size:13px;">Chargement…</div>

    <template v-else-if="enseignant">

      <!-- Header -->
      <div class="ed-header">
        <div class="ed-header-left">
          <div class="ed-big-avatar">{{ enseignant.prenom[0] }}{{ enseignant.nom[0] }}</div>
          <div>
            <h1 class="ed-name">{{ enseignant.prenom }} {{ enseignant.nom }}</h1>
            <div class="ed-sub">
              <span v-if="enseignant.specialite">{{ enseignant.specialite }}</span>
              <span v-if="enseignant.grade" style="color:#9ca3af;">· {{ enseignant.grade }}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;">
              <span :class="statutConfig[enseignant.statut]?.cls ?? 'ed-badge-inactif'">
                {{ statutConfig[enseignant.statut]?.label ?? enseignant.statut }}
              </span>
              <span class="ed-tag-type">{{ typeContratLabels[enseignant.type_contrat ?? ''] ?? enseignant.type_contrat }}</span>
              <span style="font-size:11.5px;color:#9ca3af;font-family:monospace;">{{ enseignant.numero_contrat }}</span>
            </div>
          </div>
        </div>
        <div class="ed-header-actions">
          <a v-if="enseignant.telephone" :href="waLink()" target="_blank" class="ed-btn-wa">
            <svg viewBox="0 0 24 24" fill="currentColor" style="width:15px;height:15px;">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            WhatsApp
          </a>
          <a :href="`mailto:${enseignant.email}`" class="ed-btn-email">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
            Email
          </a>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="ed-kpi-row" v-if="stats">
        <div class="ed-kpi">
          <span class="ed-kpi-icon" style="background:#eff6ff;color:#2563eb;">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          </span>
          <div>
            <div class="ed-kpi-val">{{ stats.seances_ce_mois }}</div>
            <div class="ed-kpi-lbl">Séances ce mois</div>
          </div>
        </div>
        <div class="ed-kpi">
          <span class="ed-kpi-icon" style="background:#f0fdf4;color:#16a34a;">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </span>
          <div>
            <div class="ed-kpi-val">{{ stats.heures_total }}h</div>
            <div class="ed-kpi-lbl">Heures totales</div>
          </div>
        </div>
        <div class="ed-kpi">
          <span class="ed-kpi-icon" style="background:#fef9c3;color:#854d0e;">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </span>
          <div>
            <div class="ed-kpi-val">{{ fmt(stats.montant_du) }}</div>
            <div class="ed-kpi-lbl">Montant dû total</div>
          </div>
        </div>
        <div class="ed-kpi">
          <span class="ed-kpi-icon" :style="stats.montant_restant > 0 ? 'background:#fef2f2;color:#b91c1c;' : 'background:#f0fdf4;color:#16a34a;'">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </span>
          <div>
            <div class="ed-kpi-val" :style="stats.montant_restant > 0 ? 'color:#b91c1c;' : 'color:#16a34a;'">
              {{ stats.montant_restant > 0 ? fmt(stats.montant_restant) : 'Soldé' }}
            </div>
            <div class="ed-kpi-lbl">Restant à payer</div>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="ed-tabs">
        <button @click="switchTab('infos')" :class="['ed-tab', activeTab==='infos' && 'ed-tab-active']">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          Informations
        </button>
        <button @click="switchTab('classes')" :class="['ed-tab', activeTab==='classes' && 'ed-tab-active']">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          Classes & UEs
          <span v-if="enseignant.ues?.length" class="ed-tab-badge">{{ enseignant.ues.length }}</span>
        </button>
        <button @click="switchTab('seances')" :class="['ed-tab', activeTab==='seances' && 'ed-tab-active']">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          Séances
          <span v-if="stats?.seances_total" class="ed-tab-badge">{{ stats.seances_total }}</span>
        </button>
        <button @click="switchTab('vacations')" :class="['ed-tab', activeTab==='vacations' && 'ed-tab-active']">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Vacations
        </button>
        <button @click="switchTab('avis')" :class="['ed-tab', activeTab==='avis' && 'ed-tab-active']">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
          Avis étudiants
          <span v-if="avisData?.nb_total" class="ed-tab-badge">{{ avisData.nb_total }}</span>
        </button>
      </div>

      <!-- ─── TAB INFOS ─────────────────────────────────────────────── -->
      <div v-if="activeTab==='infos'" class="ed-panel">
        <div class="ed-grid2">
          <!-- Coordonnées -->
          <div class="ed-card">
            <h3 class="ed-card-title">Coordonnées</h3>
            <div class="ed-info-list">
              <div class="ed-info-row">
                <span class="ed-info-lbl">Email</span>
                <a :href="`mailto:${enseignant.email}`" style="color:#E30613;font-size:13px;">{{ enseignant.email }}</a>
              </div>
              <div class="ed-info-row">
                <span class="ed-info-lbl">Téléphone</span>
                <span style="font-size:13px;color:#374151;">{{ enseignant.telephone ?? '—' }}</span>
              </div>
              <div class="ed-info-row">
                <span class="ed-info-lbl">Spécialité</span>
                <span style="font-size:13px;color:#374151;">{{ enseignant.specialite ?? '—' }}</span>
              </div>
              <div class="ed-info-row">
                <span class="ed-info-lbl">Grade</span>
                <span style="font-size:13px;color:#374151;">{{ enseignant.grade ?? '—' }}</span>
              </div>
            </div>
          </div>
          <!-- Contrat -->
          <div class="ed-card">
            <h3 class="ed-card-title">Contrat</h3>
            <div class="ed-info-list">
              <div class="ed-info-row">
                <span class="ed-info-lbl">N° Contrat</span>
                <span style="font-size:12.5px;font-family:monospace;color:#374151;">{{ enseignant.numero_contrat }}</span>
              </div>
              <div class="ed-info-row">
                <span class="ed-info-lbl">Type</span>
                <span class="ed-tag-type">{{ typeContratLabels[enseignant.type_contrat ?? ''] ?? enseignant.type_contrat ?? '—' }}</span>
              </div>
              <div class="ed-info-row">
                <span class="ed-info-lbl">Tarif / heure</span>
                <span style="font-size:13px;font-weight:600;color:#374151;">
                  {{ enseignant.tarif_horaire ? fmt(enseignant.tarif_horaire) : '—' }}
                </span>
              </div>
              <div class="ed-info-row">
                <span class="ed-info-lbl">Année acad.</span>
                <span style="font-size:13px;color:#374151;">{{ enseignant.annee_academique?.libelle ?? '—' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Filières -->
        <div class="ed-card" style="margin-top:14px;">
          <h3 class="ed-card-title">Filières enseignées</h3>
          <div v-if="!enseignant.filieres?.length" style="font-size:13px;color:#9ca3af;font-style:italic;padding:8px 0;">Aucune filière assignée</div>
          <div v-else style="display:flex;flex-wrap:wrap;gap:8px;padding-top:4px;">
            <div v-for="f in enseignant.filieres" :key="f.filiere_id" class="ed-filiere-chip">
              <span style="font-weight:600;color:#374151;">{{ f.filiere?.nom ?? f.filiere_id }}</span>
              <span style="color:#9ca3af;font-size:11px;">{{ f.matiere }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── TAB CLASSES & UEs ─────────────────────────────────────── -->
      <div v-else-if="activeTab==='classes'" class="ed-panel">
        <div v-if="!uesByClasse.length" class="ed-empty-state">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:36px;height:36px;color:#d1d5db;margin-bottom:8px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          <p style="color:#6b7280;font-size:13px;">Aucune UE assignée à cet enseignant</p>
          <p style="color:#9ca3af;font-size:12px;margin-top:4px;">Allez dans Notes &amp; Bulletins → sélectionnez une classe → onglet UEs pour assigner</p>
        </div>
        <div v-else style="display:flex;flex-direction:column;gap:14px;">
          <div v-for="group in uesByClasse" :key="group.classe.id" class="ed-card">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
              <span v-if="group.classe.est_tronc_commun" class="ed-tc-badge">TC</span>
              <h3 style="font-size:14px;font-weight:700;color:#111;margin:0;">{{ group.classe.nom }}</h3>
              <span style="font-size:11.5px;color:#9ca3af;margin-left:auto;">{{ group.ues.length }} UE{{ group.ues.length > 1 ? 's' : '' }}</span>
            </div>
            <table class="ed-ue-table">
              <thead>
                <tr>
                  <th>Code</th><th>Intitulé</th><th>Coeff</th><th>Crédits</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="ue in group.ues" :key="ue.id">
                  <td><span style="font-family:monospace;font-size:12px;color:#E30613;">{{ ue.code }}</span></td>
                  <td style="font-size:13px;color:#374151;">{{ ue.intitule }}</td>
                  <td style="font-size:13px;font-weight:600;text-align:center;">{{ ue.coefficient }}</td>
                  <td style="font-size:13px;text-align:center;color:#6b7280;">{{ ue.credits_ects }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- ─── TAB SÉANCES ───────────────────────────────────────────── -->
      <div v-else-if="activeTab==='seances'" class="ed-panel" style="display:flex;flex-direction:column;gap:10px;">
        <div v-if="loadingSeances" style="text-align:center;padding:40px;color:#9ca3af;font-size:13px;">Chargement…</div>
        <div v-else-if="!seances.length" class="ed-empty-state">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:36px;height:36px;color:#d1d5db;margin-bottom:8px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          <p style="color:#6b7280;font-size:13px;">Aucune séance enregistrée</p>
        </div>
        <template v-else>

          <!-- Accordéon : séances à venir (rétracté par défaut) -->
          <div class="ed-card" style="padding:0;overflow:hidden;">
            <button class="ed-accordion-head" @click="openVenir = !openVenir">
              <span style="display:flex;align-items:center;gap:8px;">
                <span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">{{ seancesAvenir.length }}</span>
                Séances à venir
              </span>
              <svg :style="openVenir ? 'transform:rotate(180deg)' : ''" style="width:16px;height:16px;color:#9ca3af;transition:transform 0.2s;flex-shrink:0;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
            <div v-if="openVenir">
              <div v-if="!seancesAvenir.length" style="padding:14px 16px;font-size:12.5px;color:#9ca3af;">Aucune séance planifiée à venir.</div>
              <div v-for="s in seancesAvenir" :key="s.id" class="ed-accordion-row">
                <span class="ed-acc-date">{{ fmtDate(s.date_debut) }}, {{ fmtHeure(s.date_debut) }}–{{ fmtHeure(s.date_fin) }}</span>
                <span class="ed-acc-mat">{{ s.matiere }}</span>
                <span class="ed-acc-cls">{{ s.classe?.nom ?? '—' }}</span>
                <span class="ed-acc-dur">{{ Number(s.duree_heures).toFixed(1) }}h</span>
                <span :class="seanceStatutConfig[s.statut]?.cls ?? 'ed-s-planifie'" style="flex-shrink:0;">{{ seanceStatutConfig[s.statut]?.label ?? s.statut }}</span>
              </div>
            </div>
          </div>

          <!-- Table : séances passées -->
          <div v-if="seancesPassees.length" class="ed-card" style="padding:0;overflow:hidden;">
            <div class="ed-accordion-head" style="cursor:default;pointer-events:none;">
              <span style="display:flex;align-items:center;gap:8px;">
                <span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">{{ seancesPassees.length }}</span>
                Séances passées
              </span>
            </div>
            <table class="ed-seance-table">
              <thead>
                <tr><th>Date</th><th>Matière</th><th>Classe</th><th>Durée</th><th>Présences</th><th>Mode</th><th>Statut</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in seancesPassees" :key="s.id">
                  <td>
                    <div style="font-size:12.5px;font-weight:600;color:#374151;">{{ fmtDate(s.date_debut) }}</div>
                    <div style="font-size:11px;color:#9ca3af;">{{ fmtHeure(s.date_debut) }} – {{ fmtHeure(s.date_fin) }}</div>
                  </td>
                  <td style="font-size:13px;color:#374151;max-width:160px;">
                    <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ s.matiere }}</div>
                    <div v-if="s.salle" style="font-size:11px;color:#9ca3af;">{{ s.salle }}</div>
                  </td>
                  <td style="font-size:12.5px;color:#374151;">{{ s.classe?.nom ?? '—' }}</td>
                  <td style="font-size:13px;font-weight:600;text-align:center;">{{ Number(s.duree_heures).toFixed(1) }}h</td>
                  <td style="text-align:center;">
                    <span v-if="s.nb_inscrits > 0" style="font-size:12.5px;">
                      <span :style="s.nb_presents/s.nb_inscrits >= 0.8 ? 'color:#16a34a;font-weight:600;' : s.nb_presents/s.nb_inscrits >= 0.5 ? 'color:#d97706;font-weight:600;' : 'color:#b91c1c;font-weight:600;'">{{ s.nb_presents }}</span>
                      <span style="color:#9ca3af;">/{{ s.nb_inscrits }}</span>
                    </span>
                    <span v-else style="color:#9ca3af;font-size:12px;">—</span>
                  </td>
                  <td><span class="ed-mode-badge">{{ s.mode }}</span></td>
                  <td><span :class="seanceStatutConfig[s.statut]?.cls ?? 'ed-s-planifie'">{{ seanceStatutConfig[s.statut]?.label ?? s.statut }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>

        </template>
      </div>

      <!-- ─── TAB VACATIONS ─────────────────────────────────────────── -->
      <div v-else-if="activeTab==='vacations'" class="ed-panel">
        <div v-if="stats" style="display:flex;flex-direction:column;gap:14px;">
          <!-- Récapitulatif -->
          <div class="ed-card">
            <h3 class="ed-card-title">Récapitulatif financier</h3>
            <div class="ed-vac-row">
              <div class="ed-vac-item">
                <span class="ed-vac-lbl">Tarif horaire</span>
                <span class="ed-vac-val">{{ fmt(stats.tarif_horaire) }}</span>
              </div>
              <div class="ed-vac-sep"></div>
              <div class="ed-vac-item">
                <span class="ed-vac-lbl">Heures effectuées</span>
                <span class="ed-vac-val">{{ stats.heures_total }}h</span>
              </div>
              <div class="ed-vac-sep"></div>
              <div class="ed-vac-item">
                <span class="ed-vac-lbl">Montant brut dû</span>
                <span class="ed-vac-val" style="color:#1d4ed8;">{{ fmt(stats.montant_du) }}</span>
              </div>
            </div>
          </div>
          <!-- Paiements -->
          <div class="ed-card">
            <h3 class="ed-card-title">État des paiements</h3>
            <div class="ed-vac-progress-wrap">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <span style="font-size:12.5px;color:#374151;">Payé : <strong>{{ fmt(stats.montant_paye) }}</strong></span>
                <span style="font-size:12.5px;color:#374151;">Restant : <strong :style="stats.montant_restant>0?'color:#b91c1c;':''">{{ fmt(stats.montant_restant) }}</strong></span>
              </div>
              <div style="height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden;">
                <div :style="`height:100%;width:${stats.montant_du>0?Math.min(100,Math.round(stats.montant_paye/stats.montant_du*100)):0}%;background:#16a34a;border-radius:4px;transition:width 0.5s;`"></div>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:4px;text-align:right;">
                {{ stats.montant_du > 0 ? Math.round(stats.montant_paye/stats.montant_du*100) : 0 }}% réglé
              </div>
            </div>
            <div v-if="stats.montant_restant > 0" class="ed-vac-alert">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              <span>{{ fmt(stats.montant_restant) }} restant à payer — Enregistrez le paiement dans <strong>Dépenses → Vacations</strong></span>
            </div>
            <div v-else class="ed-vac-ok">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:15px;height:15px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <span>Toutes les vacations ont été réglées</span>
            </div>
          </div>
          <!-- Ce mois -->
          <div class="ed-card">
            <h3 class="ed-card-title">Ce mois</h3>
            <div class="ed-vac-row">
              <div class="ed-vac-item">
                <span class="ed-vac-lbl">Séances planifiées</span>
                <span class="ed-vac-val">{{ stats.seances_ce_mois }}</span>
              </div>
              <div class="ed-vac-sep"></div>
              <div class="ed-vac-item">
                <span class="ed-vac-lbl">Heures ce mois</span>
                <span class="ed-vac-val">{{ stats.heures_ce_mois }}h</span>
              </div>
              <div class="ed-vac-sep"></div>
              <div class="ed-vac-item">
                <span class="ed-vac-lbl">Montant ce mois</span>
                <span class="ed-vac-val" style="color:#1d4ed8;">{{ fmt(Number(stats.heures_ce_mois) * stats.tarif_horaire) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ─── TAB AVIS ÉTUDIANTS ─────────────────────────────────────── -->
      <div v-else-if="activeTab==='avis'" class="ed-panel">
        <div v-if="loadingAvis" style="text-align:center;padding:40px;color:#9ca3af;font-size:13px;">Chargement…</div>
        <template v-else-if="avisData">
          <!-- Global score -->
          <div class="ed-card" style="margin-bottom:14px;">
            <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
              <div style="text-align:center;min-width:90px;">
                <div style="font-size:48px;font-weight:800;color:#111;line-height:1;">
                  {{ avisData.moyenne_globale ?? '—' }}
                </div>
                <div style="display:flex;justify-content:center;gap:2px;margin:4px 0;">
                  <span v-for="n in 5" :key="n"
                    :style="{ color: avisData.moyenne_globale && n <= Math.round(Number(avisData.moyenne_globale)) ? '#f59e0b' : '#e5e7eb', fontSize:'18px' }">★</span>
                </div>
                <div style="font-size:11px;color:#9ca3af;">Note globale / 5</div>
              </div>
              <div style="flex:1;display:flex;flex-direction:column;gap:6px;min-width:140px;">
                <div style="font-size:13px;color:#374151;"><strong>{{ avisData.nb_total }}</strong> évaluation{{ avisData.nb_total > 1 ? 's' : '' }} au total</div>
                <div style="font-size:13px;color:#374151;"><strong>{{ avisData.seances.length }}</strong> séance{{ avisData.seances.length > 1 ? 's' : '' }} évaluée{{ avisData.seances.length > 1 ? 's' : '' }}</div>
                <div style="font-size:11px;color:#9ca3af;">Tous les avis sont anonymes</div>
              </div>
            </div>
          </div>

          <!-- Avis par séance -->
          <div v-if="!avisData.seances.length" class="ed-empty-state">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:36px;height:36px;color:#d1d5db;margin-bottom:8px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
            <p style="color:#6b7280;font-size:13px;">Aucun cours évalué pour l'instant</p>
          </div>
          <div v-else style="display:flex;flex-direction:column;gap:10px;">
            <div v-for="s in avisData.seances" :key="s.seance_id" class="ed-card ed-avis-card">
              <div class="ed-avis-header">
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ s.matiere }}</div>
                  <div style="font-size:11.5px;color:#9ca3af;margin-top:2px;">{{ fmtDate(s.date_debut) }} · {{ s.classe }}</div>
                </div>
                <div style="text-align:center;flex-shrink:0;">
                  <div style="font-size:20px;font-weight:800;color:#111;">{{ s.moyenne }}</div>
                  <div style="display:flex;gap:1px;justify-content:center;">
                    <span v-for="n in 5" :key="n"
                      :style="{ color: n <= Math.round(Number(s.moyenne)) ? '#f59e0b' : '#e5e7eb', fontSize:'13px' }">★</span>
                  </div>
                  <div style="font-size:10.5px;color:#9ca3af;">{{ s.nb_evaluations }} avis</div>
                </div>
              </div>
              <!-- Commentaires anonymes -->
              <div v-if="s.commentaires && s.commentaires.length" style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">
                <div v-for="(c, i) in s.commentaires" :key="i" class="ed-avis-comment">
                  <svg fill="none" stroke="#9ca3af" viewBox="0 0 24 24" style="width:12px;height:12px;flex-shrink:0;margin-top:2px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                  <span style="font-size:12px;color:#374151;">{{ c }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="ed-empty-state">
          <p style="color:#6b7280;font-size:13px;">Aucun avis disponible</p>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.ed-wrap { max-width:960px;margin:0 auto;padding:20px 16px; }
.ed-back { display:inline-flex;align-items:center;gap:6px;color:#6b7280;font-size:13px;font-family:'Poppins',sans-serif;background:none;border:none;cursor:pointer;margin-bottom:16px;padding:0; }
.ed-back:hover { color:#111; }

/* Header */
.ed-header { background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:14px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap; }
.ed-header-left { display:flex;align-items:flex-start;gap:16px; }
.ed-big-avatar { width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#E30613,#ff6b6b);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:#fff;flex-shrink:0;text-transform:uppercase; }
.ed-name { font-size:18px;font-weight:700;color:#111;margin:0 0 4px; }
.ed-sub { font-size:13px;color:#6b7280; }
.ed-header-actions { display:flex;align-items:center;gap:8px;flex-wrap:wrap; }
.ed-btn-wa { display:inline-flex;align-items:center;gap:6px;background:#16a34a;color:#fff;border:none;border-radius:6px;padding:8px 14px;font-size:12.5px;font-weight:600;font-family:'Poppins',sans-serif;cursor:pointer;text-decoration:none; }
.ed-btn-wa:hover { background:#15803d; }
.ed-btn-email { display:inline-flex;align-items:center;gap:6px;background:#fff;color:#374151;border:1.5px solid #e5e7eb;border-radius:6px;padding:8px 14px;font-size:12.5px;font-weight:600;font-family:'Poppins',sans-serif;cursor:pointer;text-decoration:none; }
.ed-btn-email:hover { border-color:#374151; }

/* KPI */
.ed-kpi-row { display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap; }
.ed-kpi { background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;flex:1;min-width:160px; }
.ed-kpi-icon { width:38px;height:38px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0; }
.ed-kpi-val { font-size:18px;font-weight:700;color:#111;font-family:'Poppins',sans-serif; }
.ed-kpi-lbl { font-size:11px;color:#9ca3af;font-weight:500; }

/* Tabs */
.ed-tabs { display:flex;gap:2px;background:#f3f4f6;border-radius:8px;padding:3px;margin-bottom:14px;flex-wrap:wrap; }
.ed-tab { flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 12px;border:none;background:transparent;border-radius:6px;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:500;color:#6b7280;cursor:pointer;white-space:nowrap; }
.ed-tab:hover { background:#fff;color:#374151; }
.ed-tab-active { background:#fff !important;color:#E30613 !important;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.08); }
.ed-tab-badge { background:#E30613;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px; }

/* Panel */
.ed-panel { animation:fadeIn 0.15s ease; }
@keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }

/* Cards */
.ed-card { background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;padding:16px; }
.ed-card-title { font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 12px; }
.ed-grid2 { display:grid;grid-template-columns:1fr 1fr;gap:14px; }
@media(max-width:640px){ .ed-grid2{grid-template-columns:1fr;} }

/* Info list */
.ed-info-list { display:flex;flex-direction:column;gap:10px; }
.ed-info-row { display:flex;align-items:center;justify-content:space-between;gap:12px; }
.ed-info-lbl { font-size:12px;color:#9ca3af;font-weight:500;flex-shrink:0; }

/* Badges */
.ed-badge-actif    { background:#f0fdf4;color:#15803d;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600; }
.ed-badge-attente  { background:#fefce8;color:#92400e;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600; }
.ed-badge-inactif  { background:#f5f5f5;color:#6b7280;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600; }
.ed-badge-suspendu { background:#fff0f0;color:#b91c1c;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600; }
.ed-tag-type       { background:#eff6ff;color:#1d4ed8;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600; }
.ed-tc-badge       { background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700; }

/* Séance statuts */
.ed-s-planifie { background:#f3f4f6;color:#374151;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600; }
.ed-s-confirme { background:#f0fdf4;color:#15803d;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600; }
.ed-s-annule   { background:#fff0f0;color:#b91c1c;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600; }
.ed-s-reporte  { background:#fefce8;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600; }
.ed-mode-badge { background:#f3f4f6;color:#6b7280;padding:2px 7px;border-radius:4px;font-size:11px; }

/* UE table */
.ed-ue-table { width:100%;border-collapse:collapse; }
.ed-ue-table th { background:#f9fafb;padding:7px 10px;font-size:10.5px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.3px;text-align:left;border-bottom:1px solid #e5e7eb; }
.ed-ue-table td { padding:9px 10px;font-size:12.5px;border-bottom:1px solid #f3f4f6; }
.ed-ue-table tbody tr:last-child td { border-bottom:none; }
.ed-ue-table tbody tr:hover { background:#fafafa; }

/* Accordéon séances à venir */
.ed-accordion-head { width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#f9fafb;border:none;font-family:'Poppins',sans-serif;font-size:12.5px;font-weight:600;color:#374151;cursor:pointer;text-align:left;border-bottom:1px solid #e5e7eb; }
.ed-accordion-head:hover { background:#f3f4f6; }
.ed-accordion-row { display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid #f3f4f6;flex-wrap:wrap; }
.ed-accordion-row:last-child { border-bottom:none; }
.ed-acc-date { font-size:11.5px;color:#6b7280;flex-shrink:0;min-width:160px; }
.ed-acc-mat  { font-size:12.5px;color:#374151;font-weight:600;flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.ed-acc-cls  { font-size:11.5px;color:#9ca3af;flex-shrink:0; }
.ed-acc-dur  { font-size:12px;font-weight:700;color:#374151;flex-shrink:0;min-width:28px;text-align:right; }

/* Séance table */
.ed-seance-table { width:100%;border-collapse:collapse; }
.ed-seance-table th { background:#f9fafb;padding:10px 12px;font-size:10.5px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:0.3px;text-align:left;border-bottom:1.5px solid #e5e7eb;white-space:nowrap; }
.ed-seance-table td { padding:11px 12px;border-bottom:1px solid #f3f4f6;vertical-align:middle; }
.ed-seance-table tbody tr:last-child td { border-bottom:none; }
.ed-seance-table tbody tr:hover { background:#fafafa; }

/* Vacations */
.ed-vac-row { display:flex;gap:0;flex-wrap:wrap; }
.ed-vac-item { flex:1;min-width:120px;padding:10px 0;text-align:center; }
.ed-vac-lbl { display:block;font-size:11.5px;color:#9ca3af;margin-bottom:4px; }
.ed-vac-val { display:block;font-size:17px;font-weight:700;color:#111;font-family:'Poppins',sans-serif; }
.ed-vac-sep { width:1px;background:#e5e7eb;margin:8px 0; }
.ed-vac-progress-wrap { padding:4px 0 8px; }
.ed-vac-alert { display:flex;align-items:center;gap:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 14px;font-size:12.5px;color:#b91c1c;margin-top:12px; }
.ed-vac-ok    { display:flex;align-items:center;gap:8px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:10px 14px;font-size:12.5px;color:#15803d;margin-top:12px; }

/* Filière chips */
.ed-filiere-chip { background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 12px;display:flex;flex-direction:column;gap:2px;min-width:160px; }

/* Avis étudiants */
.ed-avis-card { padding:14px; }
.ed-avis-header { display:flex;align-items:flex-start;justify-content:space-between;gap:12px; }
.ed-avis-comment { display:flex;align-items:flex-start;gap:6px;background:#f9fafb;border-radius:6px;padding:8px 10px; }

/* Empty state */
.ed-empty-state { display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;text-align:center; }

@media(max-width:768px){
  .ed-seance-table { min-width:600px; }
  .ed-kpi { min-width:130px; }
}
</style>
