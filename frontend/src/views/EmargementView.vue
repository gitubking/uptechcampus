<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'

const auth = useAuthStore()

const canWrite = computed(() =>
  ['dg', 'dir_peda', 'coordinateur', 'secretariat', 'intervenant'].includes(auth.user?.role ?? '')
)

interface Seance {
  id: number
  matiere: string
  date_debut: string
  date_fin: string
  mode: string
  statut: string
  classe?: { id: number; nom: string }
  intervenant?: { id: number; nom: string; prenom: string }
}
interface Inscription {
  id: number
  etudiant: { nom: string; prenom: string }
  parcours?: { nom: string }
}
interface Presence {
  id?: number
  seance_id: number
  inscription_id: number
  statut: 'present' | 'retard' | 'absent' | 'excuse'
  heure_arrivee?: string
}

const seances = ref<Seance[]>([])
const classes = ref<{ id: number; nom: string }[]>([])
const inscriptions = ref<Inscription[]>([])
const presences = ref<Presence[]>([])
const loading = ref(true)
const loadingInscrits = ref(false)
const saving = ref(false)
const success = ref(false)

const filterClasse = ref('')
const filterDate = ref(new Date().toISOString().slice(0, 10))
const selectedSeance = ref<Seance | null>(null)

// États de présence locaux (avant envoi)
const localPresences = ref<Record<number, 'present' | 'retard' | 'absent' | 'excuse'>>({})

const seancesFiltrees = computed(() => {
  return seances.value.filter(s => {
    if (filterClasse.value && String(s.classe?.id) !== filterClasse.value) return false
    if (filterDate.value) {
      const d = new Date(s.date_debut)
      const fd = new Date(filterDate.value)
      return d.getFullYear() === fd.getFullYear() &&
        d.getMonth() === fd.getMonth() &&
        d.getDate() === fd.getDate()
    }
    return true
  })
})

// Compteurs
const compteurs = computed(() => {
  const vals = Object.values(localPresences.value)
  return {
    present: vals.filter(v => v === 'present').length,
    retard: vals.filter(v => v === 'retard').length,
    absent: vals.filter(v => v === 'absent').length,
    excuse: vals.filter(v => v === 'excuse').length,
    total: inscriptions.value.length,
  }
})

const tauxPresence = computed(() => {
  if (!compteurs.value.total) return 0
  return Math.round((compteurs.value.present + compteurs.value.retard) / compteurs.value.total * 100)
})

function fmtTime(dt: string) {
  return new Date(dt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function statutClass(s: string) {
  return {
    present: 'bg-green-100 text-green-700',
    retard:  'bg-orange-100 text-orange-700',
    absent:  'bg-red-100 text-red-700',
    excuse:  'bg-gray-100 text-gray-600',
  }[s] ?? 'bg-gray-100 text-gray-600'
}

function btnClass(statut: string, current: string) {
  const active = statut === current
  const map: Record<string, string> = {
    present: active ? 'bg-green-600 text-white' : 'bg-green-50 text-green-700 hover:bg-green-100',
    retard:  active ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100',
    absent:  active ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100',
    excuse:  active ? 'bg-gray-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
  }
  return map[statut] ?? ''
}

function setPresence(inscriptionId: number, statut: 'present' | 'retard' | 'absent' | 'excuse') {
  localPresences.value[inscriptionId] = statut
}

function marquerTousPresents() {
  inscriptions.value.forEach(i => { localPresences.value[i.id] = 'present' })
}

async function selectSeance(s: Seance) {
  selectedSeance.value = s
  loadingInscrits.value = true
  try {
    const [iRes, pRes] = await Promise.all([
      api.get('/inscriptions', { params: { classe_id: s.classe?.id, statut: 'inscrit_actif' } }),
      api.get(`/seances/${s.id}/presences`),
    ])
    inscriptions.value = iRes.data.data ?? iRes.data
    presences.value = pRes.data

    // Initialiser localPresences depuis les présences existantes ou absent par défaut
    const presenceMap: Record<number, Presence> = {}
    pRes.data.forEach((p: Presence) => { presenceMap[p.inscription_id] = p })
    localPresences.value = {}
    inscriptions.value.forEach(i => {
      localPresences.value[i.id] = presenceMap[i.id]?.statut ?? 'absent'
    })
  } finally {
    loadingInscrits.value = false
  }
}

async function enregistrer() {
  if (!selectedSeance.value) return
  saving.value = true
  success.value = false
  try {
    const payload = inscriptions.value.map(i => ({
      inscription_id: i.id,
      statut: localPresences.value[i.id] ?? 'absent',
    }))
    await api.post(`/seances/${selectedSeance.value.id}/presences`, { presences: payload })
    success.value = true
    setTimeout(() => { success.value = false }, 3000)
  } finally {
    saving.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const [sRes, cRes] = await Promise.all([
      api.get('/seances'),
      api.get('/classes'),
    ])
    seances.value = sRes.data
    classes.value = cRes.data
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="uc-content">

    <!-- En-tête -->
    <div style="margin-bottom:20px;">
      <h1 style="font-size:18px;font-weight:700;color:#111;margin:0;">Émargement</h1>
      <p style="font-size:12px;color:#888;margin:4px 0 0;">Saisie des présences par séance</p>
    </div>

    <div class="em-grid">

      <!-- Colonne gauche : liste des séances -->
      <div class="em-seances-col">
        <div class="em-seances-card">
          <div class="em-seances-header">Séances</div>
          <div class="em-seances-filters">
            <select v-model="filterClasse" class="em-select">
              <option value="">Toutes les classes</option>
              <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
            </select>
            <input v-model="filterDate" type="date" class="em-select" />
          </div>
          <div v-if="loading" class="em-empty">Chargement…</div>
          <div v-else-if="!seancesFiltrees.length" class="em-empty">Aucune séance trouvée</div>
          <div v-else class="em-seances-list">
            <button v-for="s in seancesFiltrees" :key="s.id"
              @click="selectSeance(s)"
              class="em-seance-item"
              :class="selectedSeance?.id === s.id ? 'em-seance-item--active' : ''">
              <p class="em-seance-matiere">{{ s.matiere }}</p>
              <p class="em-seance-meta">{{ s.classe?.nom }} · {{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}</p>
              <p v-if="s.intervenant" class="em-seance-interv">{{ s.intervenant.prenom }} {{ s.intervenant.nom }}</p>
            </button>
          </div>
        </div>
      </div>

      <!-- Colonne droite : émargement -->
      <div class="em-right-col">
        <div v-if="!selectedSeance" class="em-placeholder">
          <p style="font-size:13px;color:#aaa;">Sélectionnez une séance pour saisir les présences</p>
        </div>

        <div v-else class="em-emargement-card">
          <!-- En-tête séance -->
          <div class="em-seance-head">
            <div style="flex:1;">
              <h2 class="em-seance-nom">{{ selectedSeance.matiere }}</h2>
              <p class="em-seance-info">{{ selectedSeance.classe?.nom }} · {{ fmtTime(selectedSeance.date_debut) }} – {{ fmtTime(selectedSeance.date_fin) }}</p>
            </div>
            <div style="text-align:right;">
              <p class="em-taux" :style="{ color: tauxPresence >= 80 ? '#16a34a' : tauxPresence >= 50 ? '#ea580c' : '#E30613' }">
                {{ tauxPresence }}%
              </p>
              <p class="em-taux-sub">{{ compteurs.present + compteurs.retard }}/{{ compteurs.total }} présents</p>
            </div>
          </div>
          <!-- Progress bar -->
          <div class="em-progress-bar">
            <div class="em-progress-present" :style="{ width: `${Math.round(compteurs.present / (compteurs.total || 1) * 100)}%` }"></div>
            <div class="em-progress-retard" :style="{ width: `${Math.round(compteurs.retard / (compteurs.total || 1) * 100)}%` }"></div>
          </div>

          <!-- Compteurs -->
          <div class="em-compteurs">
            <div class="em-compteur"><span class="em-cpt-val" style="color:#16a34a;">{{ compteurs.present }}</span><span class="em-cpt-label">Présents</span></div>
            <div class="em-compteur"><span class="em-cpt-val" style="color:#ea580c;">{{ compteurs.retard }}</span><span class="em-cpt-label">Retards</span></div>
            <div class="em-compteur"><span class="em-cpt-val" style="color:#E30613;">{{ compteurs.absent }}</span><span class="em-cpt-label">Absents</span></div>
            <div class="em-compteur"><span class="em-cpt-val" style="color:#888;">{{ compteurs.excuse }}</span><span class="em-cpt-label">Excusés</span></div>
          </div>

          <!-- Action -->
          <div v-if="canWrite" class="em-actions">
            <button @click="marquerTousPresents" class="em-btn-tous-presents">✓ Tous présents</button>
            <span v-if="success" class="em-success-msg">✓ Enregistré avec succès</span>
          </div>

          <!-- Liste étudiants -->
          <div v-if="loadingInscrits" class="em-empty" style="padding:24px;">Chargement des inscrits…</div>
          <div v-else-if="!inscriptions.length" class="em-empty" style="padding:24px;">Aucun étudiant inscrit dans cette classe.</div>
          <div v-else class="em-students-list">
            <div v-for="insc in inscriptions" :key="insc.id" class="em-student-row">
              <div class="em-avatar">{{ insc.etudiant.prenom[0] }}{{ insc.etudiant.nom[0] }}</div>
              <div style="flex:1;min-width:0;">
                <p class="em-student-name">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</p>
                <p v-if="insc.parcours" class="em-student-sub">{{ insc.parcours.nom }}</p>
              </div>
              <span class="em-presence-badge" :class="`em-badge-${localPresences[insc.id] ?? 'absent'}`">
                {{ { present: 'Présent', retard: 'Retard', absent: 'Absent', excuse: 'Excusé' }[localPresences[insc.id] ?? 'absent'] }}
              </span>
              <div v-if="canWrite" class="em-btn-group">
                <button v-for="st in ['present', 'retard', 'absent', 'excuse']" :key="st"
                  @click="setPresence(insc.id, st as any)"
                  class="em-toggle-btn"
                  :class="`em-toggle-${st}${(localPresences[insc.id] ?? 'absent') === st ? '--active' : ''}`">
                  {{ { present: 'P', retard: 'R', absent: 'A', excuse: 'E' }[st] }}
                </button>
              </div>
            </div>
          </div>

          <!-- Bouton enregistrer -->
          <div v-if="canWrite" class="em-save-footer">
            <button @click="enregistrer" :disabled="saving || !inscriptions.length" class="em-btn-save">
              {{ saving ? 'Enregistrement…' : 'Enregistrer les présences' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.em-grid { display:grid; grid-template-columns:1fr 2fr; gap:16px; }
.em-seances-col {}
.em-seances-card { background:#fff; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.05); overflow:hidden; }
.em-seances-header { padding:12px 16px; background:#f9f9f9; border-bottom:1px solid #f0f0f0; font-size:12px; font-weight:700; color:#555; text-transform:uppercase; }
.em-seances-filters { padding:10px; border-bottom:1px solid #f0f0f0; display:flex; flex-direction:column; gap:8px; }
.em-select { width:100%; box-sizing:border-box; border:1.5px solid #e5e5e5; border-radius:4px; padding:8px 10px; font-family:'Poppins',sans-serif; font-size:12px; color:#333; background:#fff; }
.em-empty { padding:24px; text-align:center; color:#aaa; font-size:13px; }
.em-seances-list { max-height:500px; overflow-y:auto; }
.em-seance-item { width:100%; text-align:left; padding:12px 16px; border:none; background:none; cursor:pointer; border-bottom:1px solid #f9f9f9; border-left:3px solid transparent; font-family:'Poppins',sans-serif; }
.em-seance-item:hover { background:#fafafa; }
.em-seance-item--active { background:#fff5f5; border-left-color:#E30613; }
.em-seance-matiere { font-size:13px; font-weight:600; color:#333; margin:0; }
.em-seance-meta { font-size:11px; color:#888; margin:2px 0 0; }
.em-seance-interv { font-size:11px; color:#aaa; margin:1px 0 0; }

.em-right-col {}
.em-placeholder { background:#fff; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.05); display:flex; align-items:center; justify-content:center; min-height:240px; }
.em-emargement-card { background:#fff; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.05); overflow:hidden; }
.em-seance-head { display:flex; align-items:flex-start; gap:16px; padding:16px 20px; background:#f9f9f9; border-bottom:1px solid #f0f0f0; }
.em-seance-nom { font-size:15px; font-weight:700; color:#111; margin:0; }
.em-seance-info { font-size:12px; color:#888; margin:3px 0 0; }
.em-taux { font-size:24px; font-weight:800; margin:0; }
.em-taux-sub { font-size:11px; color:#aaa; margin:2px 0 0; }
.em-progress-bar { height:6px; background:#f0f0f0; display:flex; overflow:hidden; }
.em-progress-present { background:#22c55e; transition:width 0.3s; }
.em-progress-retard { background:#f97316; transition:width 0.3s; }

.em-compteurs { display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid #f0f0f0; }
.em-compteur { padding:12px; text-align:center; border-right:1px solid #f0f0f0; }
.em-compteur:last-child { border-right:none; }
.em-cpt-val { display:block; font-size:20px; font-weight:800; }
.em-cpt-label { display:block; font-size:10.5px; color:#aaa; margin-top:2px; }

.em-actions { display:flex; align-items:center; gap:12px; padding:10px 20px; background:#f9f9f9; border-bottom:1px solid #f0f0f0; }
.em-btn-tous-presents { background:#22c55e; color:#fff; border:none; border-radius:4px; padding:6px 12px; font-size:11px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.em-btn-tous-presents:hover { background:#16a34a; }
.em-success-msg { color:#16a34a; font-size:12px; font-weight:600; margin-left:auto; }

.em-students-list { max-height:360px; overflow-y:auto; }
.em-student-row { display:flex; align-items:center; gap:12px; padding:10px 20px; border-bottom:1px solid #f9f9f9; }
.em-avatar { width:32px; height:32px; border-radius:50%; background:#fde8e8; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:#E30613; flex-shrink:0; text-transform:uppercase; }
.em-student-name { font-size:13px; font-weight:600; color:#333; margin:0; }
.em-student-sub { font-size:11px; color:#aaa; margin:0; }

.em-presence-badge { padding:3px 8px; border-radius:20px; font-size:10.5px; font-weight:600; }
.em-badge-present { background:#f0fdf4; color:#15803d; }
.em-badge-retard { background:#fff7ed; color:#c2410c; }
.em-badge-absent { background:#fff0f0; color:#b91c1c; }
.em-badge-excuse { background:#f3f4f6; color:#555; }

.em-btn-group { display:flex; gap:3px; }
.em-toggle-btn { border:none; border-radius:3px; padding:4px 8px; font-size:11px; font-weight:700; cursor:pointer; font-family:'Poppins',sans-serif; }
.em-toggle-present { background:#f0fdf4; color:#15803d; }
.em-toggle-present--active { background:#22c55e; color:#fff; }
.em-toggle-retard { background:#fff7ed; color:#c2410c; }
.em-toggle-retard--active { background:#f97316; color:#fff; }
.em-toggle-absent { background:#fff0f0; color:#b91c1c; }
.em-toggle-absent--active { background:#E30613; color:#fff; }
.em-toggle-excuse { background:#f3f4f6; color:#555; }
.em-toggle-excuse--active { background:#888; color:#fff; }

.em-save-footer { padding:14px 20px; border-top:1px solid #f0f0f0; background:#f9f9f9; }
.em-btn-save { width:100%; padding:11px; background:#E30613; color:#fff; border:none; border-radius:4px; font-size:13px; font-weight:600; cursor:pointer; font-family:'Poppins',sans-serif; }
.em-btn-save:hover { background:#c00; }
.em-btn-save:disabled { opacity:0.5; cursor:not-allowed; }
</style>
