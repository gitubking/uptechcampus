<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import api from '@/services/api'

const auth = useAuthStore()
const router = useRouter()

const isEnseignant = computed(() => auth.user?.role === 'enseignant')

// ─────────────────────────────────────────────────────────
//  DASHBOARD ENSEIGNANT
// ─────────────────────────────────────────────────────────
interface MonProfil {
  id: number
  nom: string
  prenom: string
  email: string
  telephone?: string
  photo_path?: string
  mes_ues: { id: number; classe_id: number; code: string; intitule: string }[]
  mes_classes: { id: number; nom: string }[]
}
interface Seance {
  id: number
  matiere: string
  date_debut: string
  date_fin: string
  mode: string
  statut: string
  contenu_seance?: string
  signe_enseignant_at?: string
  classe?: { id: number; nom: string }
  enseignant?: { id: number; nom: string; prenom: string }
}

const monProfil     = ref<MonProfil | null>(null)
const seancesProf   = ref<Seance[]>([])
const loadingProf   = ref(true)

const today = new Date()
const todayStr = today.toISOString().slice(0, 10)

// Séances du prof
const mesSeances = computed(() =>
  seancesProf.value.filter(s => s.enseignant?.id === monProfil.value?.id)
)

const seancesAujourdhui = computed(() =>
  mesSeances.value.filter(s => s.date_debut.slice(0, 10) === todayStr)
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))
)

const seancesAVenir = computed(() =>
  mesSeances.value
    .filter(s => s.date_debut.slice(0, 10) > todayStr && s.statut !== 'annule')
    .sort((a, b) => a.date_debut.localeCompare(b.date_debut))
    .slice(0, 5)
)

const seancesCeMois = computed(() => {
  const m = today.getMonth(), y = today.getFullYear()
  return mesSeances.value.filter(s => {
    const d = new Date(s.date_debut)
    return d.getMonth() === m && d.getFullYear() === y
  })
})

const seancesEffectueesCeMois = computed(() =>
  seancesCeMois.value.filter(s => s.statut === 'effectue')
)

async function loadEnseignant() {
  try {
    const [profilRes, seancesRes] = await Promise.all([
      api.get('/enseignants/me'),
      api.get('/seances'),
    ])
    monProfil.value   = profilRes.data
    seancesProf.value = seancesRes.data
  } finally {
    loadingProf.value = false
  }
}

function fmtHeure(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}
function statutBadgeProf(statut: string) {
  const m: Record<string, string> = {
    planifie: 'db-badge-gray',
    confirme: 'db-badge-blue',
    effectue: 'db-badge-green',
    annule:   'db-badge-red',
    reporte:  'db-badge-orange',
  }
  return m[statut] ?? 'db-badge-gray'
}
function statutLabelProf(statut: string) {
  const m: Record<string, string> = {
    planifie: 'Planifiée', confirme: 'Confirmée',
    effectue: 'Effectuée', annule: 'Annulée', reporte: 'Reportée',
  }
  return m[statut] ?? statut
}

// ─────────────────────────────────────────────────────────
//  DASHBOARD ADMIN
// ─────────────────────────────────────────────────────────
const roleLabel: Record<string, string> = {
  dg: 'Directeur Général',
  coordinateur: 'Coordinateur',
  secretariat: 'Secrétariat',
  dir_peda: 'Directeur Pédagogique',
  resp_fin: 'Resp. Financier',
}

interface DernierPaiement {
  id: number
  numero_recu: string
  montant: number
  mode_paiement: string
  created_at: string
  inscription: {
    etudiant: { nom: string; prenom: string }
    classe: { filiere: { nom: string } }
  }
}

interface Stats {
  etudiants_total: number
  inscriptions_actives: number
  inscriptions_attente: number
  enseignants_actifs: number
  filieres_actives: number
  classes_total: number
  encaisse_ce_mois: number
  impayes_total: number
  paiements_en_attente: number
  depenses_ce_mois: number
  solde_tresorerie: number
  derniers_paiements: DernierPaiement[]
}

const stats   = ref<Stats | null>(null)
const loading = ref(true)

const risqueCounts = ref({ red: 0, yellow: 0, green: 0 })
async function loadRisques() {
  try {
    const { data } = await api.get('/etudiants/risques')
    risqueCounts.value = {
      red:    data.filter((r: any) => r.risque_global === 'red').length,
      yellow: data.filter((r: any) => r.risque_global === 'yellow').length,
      green:  data.filter((r: any) => r.risque_global === 'green').length,
    }
  } catch { /* silencieux */ }
}

const canSeeFinance = computed(() =>
  auth.user?.role === 'dg' || auth.user?.role === 'resp_fin'
)

async function loadAdmin() {
  try {
    const { data } = await api.get('/stats')
    stats.value = data
  } finally {
    loading.value = false
  }
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n)
}
function modeBadge(mode: string) {
  const map: Record<string, string> = {
    wave: 'bg-violet-100 text-violet-700',
    orange_money: 'bg-orange-100 text-orange-700',
    especes: 'bg-emerald-100 text-emerald-700',
    virement: 'bg-blue-100 text-blue-700',
    cheque: 'bg-gray-100 text-gray-700',
  }
  return map[mode] ?? 'bg-gray-100 text-gray-600'
}
function modeLabel(mode: string) {
  const map: Record<string, string> = {
    wave: 'Wave', orange_money: 'Orange Money', especes: 'Espèces',
    virement: 'Virement', cheque: 'Chèque',
  }
  return map[mode] ?? mode
}

onMounted(() => {
  if (isEnseignant.value) {
    loadEnseignant()
  } else {
    loadAdmin()
    loadRisques()
  }
})
</script>

<template>
  <div class="uc-content">

    <!-- ═══════════════════════════════════════════════════════
         DASHBOARD ENSEIGNANT
    ════════════════════════════════════════════════════════ -->
    <template v-if="isEnseignant">

      <!-- Bandeau de bienvenue -->
      <div class="db-welcome">
        <div class="db-welcome-left">
          <div class="db-welcome-avatar">
            {{ (monProfil?.prenom?.[0] ?? '') + (monProfil?.nom?.[0] ?? '') || '?' }}
          </div>
          <div>
            <div class="db-welcome-greeting">Bonjour, {{ monProfil?.prenom ?? auth.user?.prenom }} 👋</div>
            <div class="db-welcome-sub">
              {{ new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }}
            </div>
          </div>
        </div>
        <div class="db-welcome-role">Enseignant</div>
      </div>

      <!-- KPI 4 cartes -->
      <div class="uc-kpi-grid" style="margin-bottom:16px;">
        <div class="uc-kpi-card blue">
          <div class="uc-kpi-icon">🏫</div>
          <div class="uc-kpi-label">Mes classes</div>
          <div class="uc-kpi-value">{{ loadingProf ? '…' : (monProfil?.mes_classes?.length ?? 0) }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Classes assignées</div>
        </div>
        <div class="uc-kpi-card purple">
          <div class="uc-kpi-icon">📚</div>
          <div class="uc-kpi-label">Mes matières</div>
          <div class="uc-kpi-value">{{ loadingProf ? '…' : (monProfil?.mes_ues?.length ?? 0) }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Unités d'enseignement</div>
        </div>
        <div class="uc-kpi-card orange">
          <div class="uc-kpi-icon">📅</div>
          <div class="uc-kpi-label">Séances ce mois</div>
          <div class="uc-kpi-value">{{ loadingProf ? '…' : seancesCeMois.length }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Planifiées + effectuées</div>
        </div>
        <div class="uc-kpi-card green">
          <div class="uc-kpi-icon">✅</div>
          <div class="uc-kpi-label">Séances effectuées</div>
          <div class="uc-kpi-value">{{ loadingProf ? '…' : seancesEffectueesCeMois.length }}</div>
          <div class="uc-kpi-trend uc-trend-up">Ce mois-ci</div>
        </div>
      </div>

      <!-- Grille principale -->
      <div class="db-main-grid">

        <!-- Colonne gauche : séances du jour + à venir -->
        <div style="display:flex;flex-direction:column;gap:16px;">

          <!-- Séances d'aujourd'hui -->
          <div class="uc-card">
            <div class="uc-card-header">
              <span class="uc-card-title">📆 Aujourd'hui</span>
              <a class="uc-card-link" @click="router.push('/emargement')">Émargement →</a>
            </div>
            <div class="uc-card-body" style="padding:0;">
              <div v-if="loadingProf" class="db-empty">Chargement…</div>
              <div v-else-if="!seancesAujourdhui.length" class="db-empty">
                Aucune séance prévue aujourd'hui 🎉
              </div>
              <div v-else>
                <div v-for="s in seancesAujourdhui" :key="s.id" class="db-seance-row"
                  @click="router.push('/emargement')">
                  <div class="db-seance-time">
                    <span>{{ fmtHeure(s.date_debut) }}</span>
                    <span class="db-seance-time-sep">→</span>
                    <span>{{ fmtHeure(s.date_fin) }}</span>
                  </div>
                  <div class="db-seance-info">
                    <div class="db-seance-matiere">{{ s.matiere }}</div>
                    <div class="db-seance-classe">{{ s.classe?.nom ?? '—' }}</div>
                  </div>
                  <div>
                    <span :class="['db-badge', statutBadgeProf(s.statut)]">
                      {{ statutLabelProf(s.statut) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Prochaines séances -->
          <div class="uc-card">
            <div class="uc-card-header">
              <span class="uc-card-title">🗓️ Prochaines séances</span>
              <a class="uc-card-link" @click="router.push('/emplois-du-temps')">Emploi du temps →</a>
            </div>
            <div class="uc-card-body" style="padding:0;">
              <div v-if="loadingProf" class="db-empty">Chargement…</div>
              <div v-else-if="!seancesAVenir.length" class="db-empty">
                Aucune séance à venir pour le moment.
              </div>
              <div v-else>
                <div v-for="s in seancesAVenir" :key="s.id" class="db-seance-row"
                  @click="router.push('/emplois-du-temps')">
                  <div class="db-seance-date-badge">
                    <div class="db-seance-date-day">{{ new Date(s.date_debut).getDate() }}</div>
                    <div class="db-seance-date-mon">
                      {{ new Date(s.date_debut).toLocaleDateString('fr-FR', { month: 'short' }) }}
                    </div>
                  </div>
                  <div class="db-seance-info">
                    <div class="db-seance-matiere">{{ s.matiere }}</div>
                    <div class="db-seance-classe">{{ s.classe?.nom ?? '—' }} · {{ fmtHeure(s.date_debut) }}–{{ fmtHeure(s.date_fin) }}</div>
                  </div>
                  <span :class="['db-badge', statutBadgeProf(s.statut)]">
                    {{ statutLabelProf(s.statut) }}
                  </span>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- Colonne droite : mes UEs + actions rapides -->
        <div style="display:flex;flex-direction:column;gap:16px;">

          <!-- Mes matières / UEs -->
          <div class="uc-card">
            <div class="uc-card-header">
              <span class="uc-card-title">📚 Mes matières</span>
              <a class="uc-card-link" @click="router.push('/notes-bulletins')">Notes →</a>
            </div>
            <div class="uc-card-body" style="padding:0;">
              <div v-if="loadingProf" class="db-empty">Chargement…</div>
              <div v-else-if="!monProfil?.mes_ues?.length" class="db-empty">
                Aucune matière assignée.
              </div>
              <div v-else>
                <div v-for="ue in monProfil.mes_ues" :key="ue.id" class="db-ue-row">
                  <div class="db-ue-code">{{ ue.code }}</div>
                  <div class="db-ue-info">
                    <div class="db-ue-intitule">{{ ue.intitule }}</div>
                    <div class="db-ue-classe">
                      {{ monProfil.mes_classes.find(c => c.id === ue.classe_id)?.nom ?? 'Classe inconnue' }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Actions rapides -->
          <div class="uc-card">
            <div class="uc-card-header">
              <span class="uc-card-title">⚡ Actions rapides</span>
            </div>
            <div class="uc-card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <button class="db-action-btn" @click="router.push('/emargement')">
                <div class="db-action-icon">✍️</div>
                <div class="db-action-label">Émargement</div>
              </button>
              <button class="db-action-btn" @click="router.push('/notes-bulletins')">
                <div class="db-action-icon">📝</div>
                <div class="db-action-label">Notes & Bulletins</div>
              </button>
              <button class="db-action-btn" @click="router.push('/emplois-du-temps')">
                <div class="db-action-icon">🗓️</div>
                <div class="db-action-label">Emploi du temps</div>
              </button>
              <button class="db-action-btn" @click="router.push('/communication')">
                <div class="db-action-icon">💬</div>
                <div class="db-action-label">Communication</div>
              </button>
            </div>
          </div>

          <!-- Mes classes -->
          <div class="uc-card" v-if="monProfil?.mes_classes?.length">
            <div class="uc-card-header">
              <span class="uc-card-title">🏫 Mes classes</span>
            </div>
            <div class="uc-card-body" style="padding:0;">
              <div v-for="cl in monProfil.mes_classes" :key="cl.id" class="db-classe-row">
                <div class="db-classe-icon">🏫</div>
                <div class="db-classe-nom">{{ cl.nom }}</div>
                <div class="db-classe-ues">
                  {{ monProfil.mes_ues.filter(u => u.classe_id === cl.id).length }} matière(s)
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </template>

    <!-- ═══════════════════════════════════════════════════════
         DASHBOARD ADMIN (DG, dir_peda, resp_fin, coord, secr)
    ════════════════════════════════════════════════════════ -->
    <template v-else>

      <!-- KPI Pédagogie : 4 cartes -->
      <div class="uc-kpi-grid" style="margin-bottom:16px;">
        <div class="uc-kpi-card blue" @click="router.push('/etudiants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">🎓</div>
          <div class="uc-kpi-label">Étudiants actifs</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.etudiants_total ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Total des dossiers</div>
        </div>
        <div class="uc-kpi-card green" @click="router.push('/etudiants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">✅</div>
          <div class="uc-kpi-label">Inscriptions actives</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.inscriptions_actives ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-up">Statut inscrit_actif</div>
        </div>
        <div class="uc-kpi-card orange" @click="router.push('/etudiants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">⏳</div>
          <div class="uc-kpi-label">En attente validation</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.inscriptions_attente ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Pré-inscriptions</div>
        </div>
        <div class="uc-kpi-card purple" @click="router.push('/enseignants')" style="cursor:pointer;">
          <div class="uc-kpi-icon">👨‍🏫</div>
          <div class="uc-kpi-label">Enseignants actifs</div>
          <div class="uc-kpi-value">{{ loading ? '…' : stats?.enseignants_actifs ?? 0 }}</div>
          <div class="uc-kpi-trend uc-trend-neu">Stable</div>
        </div>
      </div>

      <!-- Widget Suivi des risques -->
      <div class="uc-risk-widget" @click="router.push('/etudiants')" style="cursor:pointer;margin-bottom:16px;">
        <div class="uc-risk-title">🚦 Suivi des risques d'abandon</div>
        <div class="uc-risk-grid">
          <div class="uc-risk-card uc-risk-card--red">
            <div class="uc-risk-val">{{ risqueCounts.red }}</div>
            <div class="uc-risk-lbl">🔴 Risque élevé</div>
            <div class="uc-risk-sub">Présence &lt; 50%, retard &gt; 30j ou dossier vide</div>
          </div>
          <div class="uc-risk-card uc-risk-card--yellow">
            <div class="uc-risk-val">{{ risqueCounts.yellow }}</div>
            <div class="uc-risk-lbl">🟡 À surveiller</div>
            <div class="uc-risk-sub">Présence 50-75%, retard 15-30j ou dossier partiel</div>
          </div>
          <div class="uc-risk-card uc-risk-card--green">
            <div class="uc-risk-val">{{ risqueCounts.green }}</div>
            <div class="uc-risk-lbl">🟢 Situation OK</div>
            <div class="uc-risk-sub">Présence ≥ 75%, paiements à jour, dossier complet</div>
          </div>
        </div>
      </div>

      <!-- Trésorerie (DG + resp_fin) -->
      <template v-if="canSeeFinance">
        <div class="uc-tres-card">
          <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;font-weight:600;">
            Solde de trésorerie en temps réel — Visible uniquement DG + Responsable Financier
          </div>
          <div style="font-size:32px;font-weight:700;color:#fff;margin-bottom:4px;">
            {{ loading ? '…' : fmt(stats?.solde_tresorerie ?? 0) }}
          </div>
          <div style="font-size:11px;color:rgba(255,255,255,0.35);">
            ● Calcul : total recettes encaissées − total dépenses enregistrées
          </div>
          <div class="uc-tres-subgrid">
            <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">Encaissé ce mois</div>
              <div style="font-size:18px;font-weight:700;color:#4ade80;">{{ loading ? '…' : fmt(stats?.encaisse_ce_mois ?? 0) }}</div>
            </div>
            <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">Impayés en cours</div>
              <div style="font-size:18px;font-weight:700;color:#f87171;">{{ loading ? '…' : fmt(stats?.impayes_total ?? 0) }}</div>
            </div>
            <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
              <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">En attente confirmation</div>
              <div style="font-size:18px;font-weight:700;color:#fbbf24;">{{ loading ? '…' : stats?.paiements_en_attente ?? 0 }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- Grille inférieure -->
      <div class="uc-dash-bottom-grid">

        <!-- Derniers paiements -->
        <div class="uc-card" v-if="canSeeFinance">
          <div class="uc-card-header">
            <span class="uc-card-title">Paiements récents</span>
            <a class="uc-card-link" @click="router.push('/paiements')">Voir tout</a>
          </div>
          <div class="uc-card-body" style="padding:0;">
            <div v-if="loading" style="padding:16px 20px;font-size:12px;color:#aaa;">Chargement…</div>
            <div v-else-if="!stats?.derniers_paiements?.length" style="padding:16px 20px;font-size:12px;color:#aaa;">Aucun paiement.</div>
            <div v-else>
              <div v-for="p in stats?.derniers_paiements?.slice(0,5)" :key="p.id"
                style="display:flex;align-items:center;gap:10px;padding:9px 20px;border-bottom:1px solid #f5f5f5;cursor:pointer;"
                @click="router.push('/paiements')">
                <div style="width:30px;height:30px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#555;flex-shrink:0;">
                  {{ (p.inscription?.etudiant?.prenom?.[0] ?? '') + (p.inscription?.etudiant?.nom?.[0] ?? '') }}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:12px;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                    {{ p.inscription?.etudiant?.prenom }} {{ p.inscription?.etudiant?.nom }}
                  </div>
                  <div style="font-size:10.5px;color:#aaa;">{{ modeLabel(p.mode_paiement) }}</div>
                </div>
                <div style="font-size:12.5px;font-weight:700;color:#22c55e;white-space:nowrap;">
                  +{{ fmt(p.montant) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Filières & Classes -->
        <div class="uc-card">
          <div class="uc-card-header">
            <span class="uc-card-title">Pédagogie</span>
            <a class="uc-card-link" @click="router.push('/filieres')">Voir filières</a>
          </div>
          <div class="uc-card-body">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f5f5f5;">
              <span style="font-size:12.5px;font-weight:600;color:#111;">Filières actives</span>
              <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.filieres_actives ?? 0 }}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f5f5f5;">
              <span style="font-size:12.5px;font-weight:600;color:#111;">Classes configurées</span>
              <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.classes_total ?? 0 }}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
              <span style="font-size:12.5px;font-weight:600;color:#111;">Enseignants actifs</span>
              <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.enseignants_actifs ?? 0 }}</span>
            </div>
          </div>
        </div>

        <!-- Actions rapides -->
        <div class="uc-card">
          <div class="uc-card-header">
            <span class="uc-card-title">Actions rapides</span>
          </div>
          <div class="uc-card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <button @click="router.push('/etudiants')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">🎓</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Nouvel étudiant</div>
            </button>
            <button v-if="canSeeFinance" @click="router.push('/paiements')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">💰</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Saisir paiement</div>
            </button>
            <button @click="router.push('/enseignants')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">👨‍🏫</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Enseignants</div>
            </button>
            <button @click="router.push('/classes')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">🏫</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Classes</div>
            </button>
            <button v-if="canSeeFinance" @click="router.push('/depenses')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">📊</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Dépenses</div>
            </button>
            <button @click="router.push('/rapports')"
              style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
              onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
              onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
              <div style="font-size:20px;margin-bottom:4px;">📈</div>
              <div style="font-size:11px;font-weight:600;color:#333;">Rapports</div>
            </button>
          </div>
        </div>

      </div>
    </template>

  </div>
</template>

<style scoped>
/* ─── Dashboard Enseignant ─────────────────────────────── */
.db-welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  border-radius: 14px;
  padding: 20px 24px;
  margin-bottom: 16px;
  color: #fff;
}
.db-welcome-left { display: flex; align-items: center; gap: 14px; }
.db-welcome-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: linear-gradient(135deg, #E30613, #ff6b6b);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 800; color: #fff; flex-shrink: 0;
}
.db-welcome-greeting { font-size: 18px; font-weight: 700; }
.db-welcome-sub { font-size: 12px; color: rgba(255,255,255,0.55); margin-top: 2px; text-transform: capitalize; }
.db-welcome-role {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;
  background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 20px; padding: 5px 14px; color: rgba(255,255,255,0.8);
}

.db-main-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
@media (max-width: 900px) { .db-main-grid { grid-template-columns: 1fr; } }

/* Séance row */
.db-seance-row {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 18px; border-bottom: 1px solid #f5f5f5;
  cursor: pointer; transition: background 0.12s;
}
.db-seance-row:last-child { border-bottom: none; }
.db-seance-row:hover { background: #fafafa; }

.db-seance-time {
  display: flex; flex-direction: column; align-items: center;
  font-size: 11px; font-weight: 700; color: #E30613;
  min-width: 52px; gap: 1px;
}
.db-seance-time-sep { font-size: 9px; color: #ccc; }

.db-seance-date-badge {
  min-width: 36px; text-align: center;
  background: #f5f5f5; border-radius: 8px; padding: 4px 6px;
}
.db-seance-date-day { font-size: 16px; font-weight: 800; color: #111; line-height: 1; }
.db-seance-date-mon { font-size: 10px; color: #888; text-transform: uppercase; }

.db-seance-info { flex: 1; min-width: 0; }
.db-seance-matiere { font-size: 12.5px; font-weight: 600; color: #111; }
.db-seance-classe  { font-size: 11px; color: #888; margin-top: 1px; }

/* Badges */
.db-badge { font-size: 10px; font-weight: 700; border-radius: 20px; padding: 3px 9px; white-space: nowrap; }
.db-badge-gray   { background: #f3f4f6; color: #6b7280; }
.db-badge-blue   { background: #dbeafe; color: #1d4ed8; }
.db-badge-green  { background: #dcfce7; color: #15803d; }
.db-badge-red    { background: #fee2e2; color: #b91c1c; }
.db-badge-orange { background: #fff7ed; color: #c2410c; }

/* UE rows */
.db-ue-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px; border-bottom: 1px solid #f5f5f5;
}
.db-ue-row:last-child { border-bottom: none; }
.db-ue-code {
  font-size: 10px; font-weight: 800; background: #E30613; color: #fff;
  border-radius: 6px; padding: 3px 8px; min-width: 56px; text-align: center; flex-shrink: 0;
}
.db-ue-info { flex: 1; min-width: 0; }
.db-ue-intitule { font-size: 12.5px; font-weight: 600; color: #111; }
.db-ue-classe   { font-size: 11px; color: #888; margin-top: 1px; }

/* Classe rows */
.db-classe-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 18px; border-bottom: 1px solid #f5f5f5;
}
.db-classe-row:last-child { border-bottom: none; }
.db-classe-icon { font-size: 18px; flex-shrink: 0; }
.db-classe-nom  { flex: 1; font-size: 13px; font-weight: 600; color: #111; }
.db-classe-ues  { font-size: 11px; color: #888; background: #f5f5f5; border-radius: 20px; padding: 2px 10px; }

/* Action buttons */
.db-action-btn {
  background: #f9f9f9; border: 1.5px solid #ebebeb; border-radius: 10px;
  padding: 14px 8px; text-align: center; cursor: pointer;
  transition: all 0.15s; font-family: 'Poppins', sans-serif;
}
.db-action-btn:hover { border-color: #E30613; background: #fff5f5; }
.db-action-icon  { font-size: 22px; margin-bottom: 5px; }
.db-action-label { font-size: 11px; font-weight: 600; color: #333; }

/* Empty state */
.db-empty {
  padding: 20px; text-align: center; font-size: 12px; color: #aaa;
}

/* ─── Dashboard Admin (existant) ───────────────────────── */
.uc-risk-widget {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  padding: 16px 20px; transition: box-shadow 0.15s;
}
.uc-risk-widget:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.07); }
.uc-risk-title { font-size: 13px; font-weight: 700; color: #111; margin-bottom: 12px; }
.uc-risk-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.uc-risk-card { border-radius: 10px; padding: 12px 14px; }
.uc-risk-card--red    { background: #fef2f2; border: 1px solid #fecaca; }
.uc-risk-card--yellow { background: #fffbeb; border: 1px solid #fde68a; }
.uc-risk-card--green  { background: #f0fdf4; border: 1px solid #bbf7d0; }
.uc-risk-val { font-size: 28px; font-weight: 800; color: #111; line-height: 1; }
.uc-risk-card--red    .uc-risk-val { color: #b91c1c; }
.uc-risk-card--yellow .uc-risk-val { color: #92400e; }
.uc-risk-card--green  .uc-risk-val { color: #15803d; }
.uc-risk-lbl { font-size: 12px; font-weight: 700; margin: 4px 0 2px; }
.uc-risk-sub { font-size: 10.5px; color: #888; line-height: 1.4; }
@media (max-width: 768px) { .uc-risk-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px)  { .uc-risk-grid { grid-template-columns: 1fr; } }
</style>
