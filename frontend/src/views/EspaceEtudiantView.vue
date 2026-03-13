<script setup lang="ts">
import { inject, computed } from 'vue'

const dashboardData = inject<any>('dashboardData')

// ── Helpers ──────────────────────────────────────────────────────────

function noteColor(note: number | null) {
  if (note === null) return 'text-gray-400'
  if (note >= 14) return 'text-green-600'
  if (note >= 10) return 'text-amber-600'
  return 'text-red-600'
}

function noteBg(note: number | null) {
  if (note === null) return 'bg-gray-50'
  if (note >= 14) return 'bg-green-50'
  if (note >= 10) return 'bg-amber-50'
  return 'bg-red-50'
}

function modeLabel(mode: string) {
  const m: Record<string, string> = { presentiel: 'Présentiel', en_ligne: 'En ligne', hybride: 'Hybride', exam: 'Examen' }
  return m[mode] ?? mode
}

function modeBadgeClass(mode: string) {
  const m: Record<string, string> = {
    presentiel: 'bg-green-100 text-green-700',
    en_ligne:   'bg-blue-100 text-blue-700',
    hybride:    'bg-amber-100 text-amber-700',
    exam:       'bg-red-100 text-red-700',
  }
  return m[mode] ?? 'bg-gray-100 text-gray-700'
}

function typeBadgeClass(type: string) {
  const t: Record<string, string> = {
    info:      'bg-blue-100 text-blue-700',
    urgent:    'bg-amber-100 text-amber-700',
    alerte:    'bg-red-100 text-red-700',
    evenement: 'bg-green-100 text-green-700',
  }
  return t[type] ?? 'bg-gray-100 text-gray-700'
}

function typeLabel(type: string) {
  const t: Record<string, string> = { info: 'Info', urgent: 'Urgent', alerte: 'Alerte', evenement: 'Événement' }
  return t[type] ?? type
}

function paiementStatutClass(statut: string) {
  return statut === 'confirme' ? 'bg-green-100 text-green-700' : statut === 'en_attente' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
}

function paiementStatutLabel(statut: string) {
  return statut === 'confirme' ? 'Payé' : statut === 'en_attente' ? 'En attente' : 'Rejeté'
}

function typePaiementLabel(type: string) {
  const t: Record<string, string> = { frais_inscription: 'Inscription', mensualite: 'Mensualité', rattrapage: 'Rattrapage' }
  return t[type] ?? type
}

function formatDate(dt: string) {
  if (!dt) return ''
  return new Date(dt).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatTime(dt: string) {
  if (!dt) return ''
  return new Date(dt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function timeAgo(dt: string) {
  if (!dt) return ''
  const diff = Date.now() - new Date(dt).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'à l\'instant'
  if (mins < 60) return `Il y a ${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Il y a ${hrs}h`
  return `Il y a ${Math.floor(hrs / 24)}j`
}

function avatarInitials(nom: string) {
  const parts = nom?.split(' ') ?? []
  return parts.map((p: string) => p[0]).join('').substring(0, 2).toUpperCase()
}

const avatarColors = ['bg-blue-500','bg-green-500','bg-purple-500','bg-amber-500','bg-red-600','bg-red-500']
function avatarColor(id: number) {
  return avatarColors[id % avatarColors.length]
}

// Grouper les séances par jour
const seancesParJour = computed(() => {
  if (!dashboardData?.value?.seances_semaine) return []
  const grouped: Record<string, any[]> = {}
  for (const s of dashboardData.value.seances_semaine) {
    const key = formatDate(s.date_debut)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(s)
  }
  return Object.entries(grouped).map(([jour, seances]) => ({ jour, seances }))
})

// UEs à rattraper (note < 10)
const uesARattraper = computed(() => {
  if (!dashboardData?.value?.notes?.ues) return []
  return dashboardData.value.notes.ues.filter((u: any) => u.note !== null && u.note < 10)
})

// Progression financière
const progressionFinanciere = computed(() => {
  const i = dashboardData?.value?.inscription
  if (!i || !i.frais_totaux) return 0
  return Math.round((i.total_paye / i.frais_totaux) * 100)
})
</script>

<template>
  <div v-if="!dashboardData" class="ee-no-data">
    Aucune inscription active trouvée.
  </div>

  <div v-else class="uc-content">

    <!-- ── Hero ──────────────────────────────────────────────────── -->
    <div class="ee-hero">
      <div class="ee-hero-inner">
        <div class="ee-hero-left">
          <h1 class="ee-hero-title">
            Bonjour, {{ dashboardData.etudiant.prenom }} {{ dashboardData.etudiant.nom }} 👋
          </h1>
          <p class="ee-hero-date">
            Bienvenue sur votre espace étudiant —
            {{ new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }}
          </p>
          <div class="ee-hero-tags">
            <span class="ee-tag ee-tag--red">{{ dashboardData.inscription.filiere }}</span>
            <span class="ee-tag ee-tag--dim">{{ dashboardData.inscription.classe }}</span>
            <span class="ee-tag ee-tag--dim">{{ dashboardData.inscription.annee_academique }}</span>
          </div>
        </div>
        <div class="ee-hero-stats">
          <div class="ee-stat-box">
            <div class="ee-stat-val">{{ dashboardData.notes.moyenne_generale ?? '—' }}</div>
            <div class="ee-stat-lbl">Moyenne</div>
          </div>
          <div class="ee-stat-box">
            <div class="ee-stat-val">{{ dashboardData.presences.taux_presence }}%</div>
            <div class="ee-stat-lbl">Assiduité</div>
          </div>
          <div class="ee-stat-box">
            <div class="ee-stat-val" :style="dashboardData.inscription.restant_du > 0 ? 'color:#f87171' : 'color:#4ade80'">
              {{ dashboardData.inscription.restant_du.toLocaleString('fr-FR') }}
            </div>
            <div class="ee-stat-lbl">FCFA restant</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Alerte paiement ───────────────────────────────────────── -->
    <div v-if="dashboardData.inscription.restant_du > 0" class="ee-alert-paiement">
      <svg width="22" height="22" fill="none" stroke="#dc2626" viewBox="0 0 24 24" style="flex-shrink:0">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <div style="flex:1">
        <p class="ee-alert-title">Solde impayé : {{ dashboardData.inscription.restant_du.toLocaleString('fr-FR') }} FCFA</p>
        <p class="ee-alert-sub">Veuillez régulariser votre situation pour éviter tout blocage d'accès.</p>
      </div>
      <a href="#finances" class="ee-alert-btn">Voir détails</a>
    </div>

    <!-- ── Grid 2 colonnes ───────────────────────────────────────── -->
    <div class="ee-grid">

      <!-- COLONNE GAUCHE -->
      <div class="ee-col-left">

        <!-- CARD : Cours cette semaine -->
        <div id="planning" class="ee-card">
          <div class="ee-card-header">
            <h2 class="ee-card-title">Cours cette semaine</h2>
            <a href="/emplois-du-temps" class="ee-link">Voir tout l'emploi du temps</a>
          </div>
          <div class="ee-card-body">
            <div v-if="seancesParJour.length === 0" class="ee-empty">Aucun cours cette semaine.</div>
            <div v-for="groupe in seancesParJour" :key="groupe.jour" class="ee-jour-group">
              <p class="ee-jour-label">{{ groupe.jour }}</p>
              <div v-for="s in groupe.seances" :key="s.id" class="ee-seance-row">
                <div class="ee-seance-time">
                  <p class="ee-time-start">{{ formatTime(s.date_debut) }}</p>
                  <p class="ee-time-end">{{ formatTime(s.date_fin) }}</p>
                </div>
                <div class="ee-seance-sep"></div>
                <div class="ee-seance-info">
                  <p class="ee-seance-matiere">{{ s.matiere }}</p>
                  <p class="ee-seance-sub">{{ s.intervenant }} · {{ s.salle || 'Salle TBD' }}</p>
                </div>
                <span class="ee-mode-badge" :class="modeBadgeClass(s.mode)">{{ modeLabel(s.mode) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- CARD : Notes -->
        <div id="notes" class="ee-card">
          <div class="ee-card-header">
            <h2 class="ee-card-title">Mes notes — Session 1</h2>
          </div>
          <div class="ee-card-body">
            <div class="ee-notes-grid">
              <div v-for="ue in dashboardData.notes.ues" :key="ue.ue_id"
                class="ee-ue-card" :class="noteBg(ue.note)">
                <p class="ee-ue-intitule">{{ ue.intitule }}</p>
                <p class="ee-ue-note" :class="noteColor(ue.note)">{{ ue.note !== null ? ue.note : '—' }}</p>
                <p class="ee-ue-coeff">Coeff. {{ ue.coefficient }}</p>
              </div>
            </div>
            <div class="ee-notes-resume">
              <div class="ee-resume-stat">
                <p class="ee-resume-val">{{ dashboardData.notes.moyenne_generale ?? '—' }}</p>
                <p class="ee-resume-lbl">Moyenne /20</p>
              </div>
              <div class="ee-resume-stat">
                <p class="ee-resume-val">{{ dashboardData.notes.rang ? `${dashboardData.notes.rang}e` : '—' }}</p>
                <p class="ee-resume-lbl">Rang</p>
              </div>
              <div class="ee-resume-stat">
                <span v-if="dashboardData.notes.mention" class="ee-mention-badge">{{ dashboardData.notes.mention }}</span>
              </div>
            </div>
            <div v-if="uesARattraper.length > 0" class="ee-rattrapage">
              <p class="ee-rattrapage-title">UE(s) à rattraper</p>
              <div v-for="ue in uesARattraper" :key="ue.ue_id" class="ee-rattrapage-row">
                <div class="ee-rattrapage-labels">
                  <span class="ee-rat-name">{{ ue.intitule }}</span>
                  <span class="ee-rat-note">{{ ue.note }}/20</span>
                </div>
                <div class="ee-progress-track">
                  <div class="ee-progress-bar ee-progress-bar--red" :style="{ width: `${(ue.note / 20) * 100}%` }"></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- CARD : Suivi financier -->
        <div id="finances" class="ee-card">
          <div class="ee-card-header">
            <h2 class="ee-card-title">Suivi financier</h2>
          </div>
          <div class="ee-card-body">
            <div class="ee-fin-stats">
              <div class="ee-fin-stat">
                <p class="ee-fin-val">{{ dashboardData.inscription.frais_totaux.toLocaleString('fr-FR') }}</p>
                <p class="ee-fin-lbl">Frais totaux</p>
              </div>
              <div class="ee-fin-stat ee-fin-stat--green">
                <p class="ee-fin-val ee-fin-val--green">{{ dashboardData.inscription.total_paye.toLocaleString('fr-FR') }}</p>
                <p class="ee-fin-lbl ee-fin-lbl--green">Payé</p>
              </div>
              <div class="ee-fin-stat ee-fin-stat--red">
                <p class="ee-fin-val ee-fin-val--red">{{ dashboardData.inscription.restant_du.toLocaleString('fr-FR') }}</p>
                <p class="ee-fin-lbl ee-fin-lbl--red">Restant dû</p>
              </div>
            </div>
            <div class="ee-progression">
              <div class="ee-progression-header">
                <span class="ee-progression-lbl">Avancement paiement</span>
                <span class="ee-progression-pct">{{ progressionFinanciere }}%</span>
              </div>
              <div class="ee-progress-track">
                <div class="ee-progress-bar ee-progress-bar--amber" :style="{ width: `${progressionFinanciere}%` }"></div>
              </div>
            </div>
            <div class="ee-paiements-list">
              <div v-for="p in dashboardData.paiements" :key="p.id" class="ee-paiement-row">
                <div>
                  <p class="ee-paiement-type">{{ typePaiementLabel(p.type_paiement) }}</p>
                  <p class="ee-paiement-recu">{{ p.numero_recu }}</p>
                </div>
                <div style="text-align:right">
                  <p class="ee-paiement-montant">{{ p.montant.toLocaleString('fr-FR') }} FCFA</p>
                  <span class="ee-paiement-statut" :class="paiementStatutClass(p.statut)">{{ paiementStatutLabel(p.statut) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- COLONNE DROITE -->
      <div class="ee-col-right">

        <!-- CARD : Assiduité -->
        <div class="ee-card ee-card--side">
          <h3 class="ee-card-title-side">Assiduité</h3>
          <div class="ee-assiduite-taux">
            <p class="ee-taux-val">{{ dashboardData.presences.taux_presence }}%</p>
            <p class="ee-taux-lbl">Taux de présence global</p>
          </div>
          <div class="ee-assiduite-bars">
            <div class="ee-bar-row">
              <span class="ee-bar-label">Présent</span>
              <div class="ee-progress-track">
                <div class="ee-progress-bar ee-progress-bar--green"
                  :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.present / dashboardData.presences.total) * 100}%` : '0%' }"></div>
              </div>
              <span class="ee-bar-count">{{ dashboardData.presences.present }}</span>
            </div>
            <div class="ee-bar-row">
              <span class="ee-bar-label">Retard</span>
              <div class="ee-progress-track">
                <div class="ee-progress-bar ee-progress-bar--amber"
                  :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.retard / dashboardData.presences.total) * 100}%` : '0%' }"></div>
              </div>
              <span class="ee-bar-count">{{ dashboardData.presences.retard }}</span>
            </div>
            <div class="ee-bar-row">
              <span class="ee-bar-label">Absent</span>
              <div class="ee-progress-track">
                <div class="ee-progress-bar ee-progress-bar--red"
                  :style="{ width: dashboardData.presences.total ? `${(dashboardData.presences.absent / dashboardData.presences.total) * 100}%` : '0%' }"></div>
              </div>
              <span class="ee-bar-count">{{ dashboardData.presences.absent }}</span>
            </div>
          </div>
          <div v-if="dashboardData.presences.absent >= 2" class="ee-absence-warning">
            {{ dashboardData.presences.absent }} absence(s) enregistrée(s). Au-delà de 3, une convocation peut être générée.
          </div>
        </div>

        <!-- CARD : Annonces -->
        <div class="ee-card ee-card--side">
          <h3 class="ee-card-title-side">Annonces</h3>
          <div v-if="!dashboardData.annonces?.length" class="ee-empty">Aucune annonce.</div>
          <div v-for="a in dashboardData.annonces" :key="a.id" class="ee-annonce-row">
            <div class="ee-annonce-main">
              <div class="ee-annonce-left">
                <span class="ee-annonce-badge" :class="typeBadgeClass(a.type)">{{ typeLabel(a.type) }}</span>
                <p class="ee-annonce-titre">{{ a.titre }}</p>
              </div>
              <span class="ee-annonce-time">{{ timeAgo(a.publie_at) }}</span>
            </div>
          </div>
        </div>

        <!-- CARD : Messages récents -->
        <div id="messages" class="ee-card ee-card--side">
          <div class="ee-card-header">
            <h3 class="ee-card-title-side">Messages récents</h3>
            <a href="/communication" class="ee-link">Voir tout</a>
          </div>
          <div v-if="!dashboardData.messages?.length" class="ee-empty">Aucun message.</div>
          <div v-for="conv in dashboardData.messages" :key="conv.id" class="ee-msg-row">
            <div class="ee-msg-avatar" :class="avatarColor(conv.id)">
              {{ avatarInitials(conv.nom || 'U') }}
            </div>
            <div class="ee-msg-info">
              <p class="ee-msg-name">{{ conv.nom || 'Conversation' }}</p>
              <p class="ee-msg-preview">{{ conv.dernier_message }}</p>
            </div>
            <div v-if="conv.nb_non_lus > 0" class="ee-unread-dot">{{ conv.nb_non_lus }}</div>
          </div>
        </div>

        <!-- CARD : Documents -->
        <div id="documents" class="ee-card ee-card--side">
          <h3 class="ee-card-title-side">Mes documents</h3>
          <div v-if="!dashboardData.documents?.length" class="ee-empty">Aucun document disponible.</div>
          <div v-for="doc in dashboardData.documents" :key="doc.id" class="ee-doc-row">
            <div class="ee-doc-icon">
              <svg width="18" height="18" fill="none" stroke="#E30613" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div class="ee-doc-info">
              <p class="ee-doc-nom">{{ doc.nom_fichier }}</p>
              <p class="ee-doc-meta">{{ doc.type_document }} · {{ new Date(doc.created_at).toLocaleDateString('fr-FR') }}</p>
            </div>
            <button class="ee-doc-dl">Télécharger</button>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* Layout */
.ee-no-data { display:flex; align-items:center; justify-content:center; height:256px; color:#888; font-size:14px; }

/* Hero */
.ee-hero { background:#111; border-radius:14px; padding:22px 24px; margin-bottom:20px; color:#fff; }
.ee-hero-inner { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:16px; }
.ee-hero-title { font-size:22px; font-weight:700; margin-bottom:4px; }
.ee-hero-date { font-size:12.5px; color:#aaa; margin-bottom:10px; }
.ee-hero-tags { display:flex; flex-wrap:wrap; gap:8px; }
.ee-tag { font-size:12px; font-weight:500; padding:4px 12px; border-radius:20px; }
.ee-tag--red { background:#E30613; color:#fff; }
.ee-tag--dim { background:rgba(255,255,255,0.1); color:#ccc; }
.ee-hero-stats { display:flex; gap:12px; }
.ee-stat-box { background:rgba(255,255,255,0.08); border-radius:10px; padding:14px 16px; text-align:center; min-width:80px; }
.ee-stat-val { font-size:22px; font-weight:700; color:#fff; }
.ee-stat-lbl { font-size:11px; color:#aaa; margin-top:4px; }

/* Alert */
.ee-alert-paiement { display:flex; align-items:center; gap:14px; background:#fef2f2; border:1px solid #fecaca; border-radius:10px; padding:14px 16px; margin-bottom:20px; }
.ee-alert-title { font-size:14px; font-weight:700; color:#b91c1c; margin-bottom:3px; }
.ee-alert-sub { font-size:12.5px; color:#dc2626; }
.ee-alert-btn { background:#E30613; color:#fff; font-size:13px; font-weight:600; padding:8px 14px; border-radius:7px; text-decoration:none; flex-shrink:0; }
.ee-alert-btn:hover { opacity:0.88; }

/* Grid */
.ee-grid { display:grid; grid-template-columns:1fr 300px; gap:20px; }
.ee-col-left { display:flex; flex-direction:column; gap:20px; }
.ee-col-right { display:flex; flex-direction:column; gap:16px; }

/* Cards */
.ee-card { background:#fff; border-radius:10px; border:1px solid #eee; }
.ee-card--side { padding:16px 18px; }
.ee-card-header { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #f0f0f0; }
.ee-card-title { font-size:14px; font-weight:700; color:#111; }
.ee-card-title-side { font-size:14px; font-weight:700; color:#111; margin-bottom:14px; }
.ee-card-body { padding:16px 18px; }
.ee-link { font-size:12.5px; color:#E30613; text-decoration:none; font-weight:500; }
.ee-link:hover { text-decoration:underline; }
.ee-empty { font-size:13px; color:#aaa; text-align:center; padding:16px 0; }

/* Planning */
.ee-jour-group { margin-bottom:14px; }
.ee-jour-label { font-size:10.5px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; }
.ee-seance-row { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; background:#f9f9f9; border-radius:8px; margin-bottom:8px; }
.ee-seance-row:hover { background:#f0f0f0; }
.ee-seance-time { width:52px; flex-shrink:0; text-align:right; }
.ee-time-start { font-size:13px; font-weight:600; color:#111; }
.ee-time-end { font-size:11px; color:#aaa; }
.ee-seance-sep { width:2px; background:#ddd; align-self:stretch; border-radius:1px; flex-shrink:0; }
.ee-seance-info { flex:1; }
.ee-seance-matiere { font-size:13px; font-weight:600; color:#111; }
.ee-seance-sub { font-size:11.5px; color:#888; margin-top:2px; }
.ee-mode-badge { font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; flex-shrink:0; }

/* Notes grid */
.ee-notes-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; }
.ee-ue-card { border-radius:10px; padding:10px 12px; border:1px solid #eee; }
.ee-ue-intitule { font-size:11.5px; color:#888; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ee-ue-note { font-size:24px; font-weight:700; }
.ee-ue-coeff { font-size:11px; color:#aaa; margin-top:2px; }
.ee-notes-resume { background:#111; border-radius:10px; padding:14px 16px; display:flex; flex-wrap:wrap; gap:14px; align-items:center; justify-content:space-between; margin-bottom:14px; }
.ee-resume-stat { text-align:center; }
.ee-resume-val { font-size:22px; font-weight:700; color:#fff; }
.ee-resume-lbl { font-size:11px; color:#888; margin-top:2px; }
.ee-mention-badge { background:#E30613; color:#fff; font-size:13px; font-weight:600; padding:5px 14px; border-radius:20px; }
.ee-rattrapage { margin-top:4px; }
.ee-rattrapage-title { font-size:10.5px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:8px; }
.ee-rattrapage-row { margin-bottom:8px; }
.ee-rattrapage-labels { display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px; }
.ee-rat-name { color:#444; }
.ee-rat-note { color:#E30613; font-weight:600; }

/* Progress bars */
.ee-progress-track { flex:1; height:6px; background:#eee; border-radius:3px; overflow:hidden; }
.ee-progress-bar { height:100%; border-radius:3px; }
.ee-progress-bar--green { background:#22c55e; }
.ee-progress-bar--amber { background:#f59e0b; }
.ee-progress-bar--red { background:#ef4444; }

/* Finance */
.ee-fin-stats { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; }
.ee-fin-stat { background:#f9f9f9; border-radius:10px; padding:10px 12px; text-align:center; }
.ee-fin-stat--green { background:#f0fdf4; }
.ee-fin-stat--red { background:#fef2f2; }
.ee-fin-val { font-size:17px; font-weight:700; color:#111; }
.ee-fin-val--green { color:#16a34a; }
.ee-fin-val--red { color:#E30613; }
.ee-fin-lbl { font-size:11px; color:#888; margin-top:3px; }
.ee-fin-lbl--green { color:#16a34a; }
.ee-fin-lbl--red { color:#E30613; }
.ee-progression { margin-bottom:14px; }
.ee-progression-header { display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px; }
.ee-progression-lbl { color:#666; }
.ee-progression-pct { font-weight:600; color:#111; }
.ee-paiements-list { display:flex; flex-direction:column; gap:8px; }
.ee-paiement-row { display:flex; align-items:center; justify-content:space-between; padding-bottom:8px; border-bottom:1px solid #f5f5f5; }
.ee-paiement-type { font-size:13px; font-weight:600; color:#111; }
.ee-paiement-recu { font-size:11px; color:#aaa; }
.ee-paiement-montant { font-size:13px; font-weight:700; color:#111; }
.ee-paiement-statut { font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; }

/* Assiduité */
.ee-assiduite-taux { text-align:center; margin-bottom:14px; }
.ee-taux-val { font-size:40px; font-weight:700; color:#16a34a; }
.ee-taux-lbl { font-size:12.5px; color:#888; margin-top:4px; }
.ee-assiduite-bars { display:flex; flex-direction:column; gap:8px; margin-bottom:10px; }
.ee-bar-row { display:flex; align-items:center; gap:8px; }
.ee-bar-label { font-size:12.5px; color:#666; width:52px; }
.ee-bar-count { font-size:11.5px; color:#aaa; width:24px; text-align:right; }
.ee-absence-warning { margin-top:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 12px; font-size:12px; color:#92400e; }

/* Annonces */
.ee-annonce-row { margin-bottom:10px; }
.ee-annonce-main { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; }
.ee-annonce-left { display:flex; align-items:flex-start; gap:8px; flex:1; min-width:0; }
.ee-annonce-badge { font-size:11px; font-weight:600; padding:2px 8px; border-radius:20px; flex-shrink:0; }
.ee-annonce-titre { font-size:13px; font-weight:600; color:#111; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ee-annonce-time { font-size:11px; color:#aaa; flex-shrink:0; }

/* Messages */
.ee-msg-row { display:flex; align-items:center; gap:10px; margin-bottom:10px; cursor:pointer; padding:6px 8px; border-radius:8px; transition:background 0.15s; }
.ee-msg-row:hover { background:#f9f9f9; }
.ee-msg-avatar { width:36px; height:36px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center; color:#fff; font-size:12px; font-weight:700; }
.ee-msg-info { flex:1; min-width:0; }
.ee-msg-name { font-size:13px; font-weight:600; color:#111; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ee-msg-preview { font-size:12px; color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ee-unread-dot { width:20px; height:20px; background:#E30613; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; color:#fff; font-weight:700; flex-shrink:0; }

/* Documents */
.ee-doc-row { display:flex; align-items:center; gap:10px; margin-bottom:10px; padding:10px 12px; background:#f9f9f9; border-radius:8px; }
.ee-doc-icon { width:36px; height:36px; background:#fde8e8; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.ee-doc-info { flex:1; min-width:0; }
.ee-doc-nom { font-size:13px; font-weight:600; color:#111; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ee-doc-meta { font-size:11.5px; color:#888; margin-top:2px; }
.ee-doc-dl { font-size:12px; background:#e5e7eb; color:#444; border:none; border-radius:7px; padding:6px 12px; cursor:pointer; flex-shrink:0; }
.ee-doc-dl:hover { background:#d1d5db; }

/* Utility classes used by helper functions */
.text-gray-400 { color:#9ca3af; }
.text-green-600 { color:#16a34a; }
.text-amber-600 { color:#d97706; }
.text-red-600 { color:#E30613; }
.bg-gray-50 { background:#f9fafb; }
.bg-green-50 { background:#f0fdf4; }
.bg-amber-50 { background:#fffbeb; }
.bg-red-50 { background:#fef2f2; }
.bg-green-100 { background:#dcfce7; }
.text-green-700 { color:#15803d; }
.bg-blue-100 { background:#dbeafe; }
.text-blue-700 { color:#1d4ed8; }
.bg-amber-100 { background:#fef3c7; }
.text-amber-700 { color:#b45309; }
.bg-red-100 { background:#fee2e2; }
.text-red-700 { color:#b91c1c; }
.bg-gray-100 { background:#f3f4f6; }
.text-gray-700 { color:#374151; }
.bg-blue-500 { background:#3b82f6; }
.bg-green-500 { background:#22c55e; }
.bg-purple-500 { background:#a855f7; }
.bg-amber-500 { background:#f59e0b; }
.bg-red-600 { background:#E30613; }
.bg-red-500 { background:#6366f1; }
</style>
