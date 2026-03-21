<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import RichTextEditor from '@/components/ui/RichTextEditor.vue'

const auth = useAuthStore()
const isEnseignant = computed(() => auth.user?.role === 'enseignant')
const canWrite = computed(() =>
  ['dg', 'dir_peda', 'coordinateur', 'secretariat', 'enseignant'].includes(auth.user?.role ?? '')
)
// Profil enseignant connecté (pour filtrer ses séances)
const monEnseignantId = ref<number | null>(null)

interface Seance {
  id: number
  matiere: string
  date_debut: string
  date_fin: string
  mode: string
  statut: string
  notes?: string
  contenu_seance?: string
  objectifs?: string
  signe_enseignant_at?: string
  signe_enseignant_id?: number
  classe?: { id: number; nom: string }
  enseignant?: { id: number; nom: string; prenom: string }
}
interface Inscription {
  id: number
  etudiant: { nom: string; prenom: string; numero_etudiant?: string }
  classe?: { id: number; nom: string }
}
interface Presence {
  seance_id: number
  inscription_id: number
  statut: 'present' | 'retard' | 'absent' | 'excuse'
  heure_arrivee?: string
}

const seances        = ref<Seance[]>([])
const classes        = ref<{ id: number; nom: string }[]>([])
const inscriptions   = ref<Inscription[]>([])
const loading        = ref(true)
const loadingInscrits = ref(false)
const saving         = ref(false)
const savingContenu  = ref(false)
const success        = ref(false)
const successContenu = ref(false)

const filterClasse = ref('')
const filterDate   = ref(new Date().toISOString().slice(0, 10))
const filterStatut = ref('')
const selectedSeance = ref<Seance | null>(null)

// Présences locales
const localPresences = ref<Record<number, 'present' | 'retard' | 'absent' | 'excuse'>>({})

// Contenu de séance
const contenuForm = ref({ contenu_seance: '', objectifs: '' })

const seancesFiltrees = computed(() => {
  return seances.value.filter(s => {
    // Prof : ne voir que ses séances — ne pas exclure si enseignant est null (déjà filtré côté backend)
    if (isEnseignant.value && monEnseignantId.value && s.enseignant && s.enseignant.id !== monEnseignantId.value) return false
    if (filterClasse.value && String(s.classe?.id) !== filterClasse.value) return false
    if (filterStatut.value && s.statut !== filterStatut.value) return false
    if (filterDate.value) {
      // Comparer uniquement la partie YYYY-MM-DD du timestamp (évite les décalages UTC/local)
      const seanceDate = s.date_debut.slice(0, 10)
      return seanceDate === filterDate.value
    }
    return true
  })
})

const compteurs = computed(() => {
  const vals = Object.values(localPresences.value)
  return {
    present: vals.filter(v => v === 'present').length,
    retard:  vals.filter(v => v === 'retard').length,
    absent:  vals.filter(v => v === 'absent').length,
    excuse:  vals.filter(v => v === 'excuse').length,
    total:   inscriptions.value.length,
  }
})

const tauxPresence = computed(() => {
  if (!compteurs.value.total) return 0
  return Math.round((compteurs.value.present + compteurs.value.retard) / compteurs.value.total * 100)
})

const estCloturee = computed(() => selectedSeance.value?.statut === 'effectue')

function fmtTime(dt: string) {
  return new Date(dt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
function fmtDate(dt: string) {
  return new Date(dt).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' })
}
function fmtDateTime(dt: string) {
  return new Date(dt).toLocaleString('fr-FR', { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })
}

function statutBadge(s: string) {
  const map: Record<string, string> = {
    planifie: 'em-badge-planifie',
    confirme: 'em-badge-confirme',
    effectue: 'em-badge-effectue',
    annule:   'em-badge-annule',
    reporte:  'em-badge-reporte',
  }
  return map[s] ?? 'em-badge-planifie'
}
function statutLabel(s: string) {
  return { planifie: 'Planifiée', confirme: 'Confirmée', effectue: '✓ Émargée', annule: 'Annulée', reporte: 'Reportée' }[s] ?? s
}

function setPresence(id: number, st: 'present' | 'retard' | 'absent' | 'excuse') {
  if (estCloturee.value) return
  localPresences.value[id] = st
}
function marquerTousPresents() {
  if (estCloturee.value) return
  inscriptions.value.forEach(i => { localPresences.value[i.id] = 'present' })
}

async function selectSeance(s: Seance) {
  selectedSeance.value = s
  contenuForm.value = {
    contenu_seance: s.contenu_seance ?? '',
    objectifs:      s.objectifs ?? '',
  }
  loadingInscrits.value = true
  try {
    const [iRes, pRes] = await Promise.all([
      api.get('/inscriptions', { params: { classe_id: s.classe?.id, statut: 'inscrit_actif' } }),
      api.get(`/seances/${s.id}/presences`),
    ])
    inscriptions.value = iRes.data.data ?? iRes.data
    const presenceMap: Record<number, Presence> = {}
    ;(pRes.data as Presence[]).forEach(p => { presenceMap[p.inscription_id] = p })
    localPresences.value = {}
    inscriptions.value.forEach(i => {
      localPresences.value[i.id] = presenceMap[i.id]?.statut ?? 'absent'
    })
  } finally {
    loadingInscrits.value = false
  }
}

async function sauvegarderPresences() {
  if (!selectedSeance.value) return
  saving.value = true; success.value = false
  try {
    const payload = inscriptions.value.map(i => ({
      inscription_id: i.id,
      statut: localPresences.value[i.id] ?? 'absent',
    }))
    await api.post(`/seances/${selectedSeance.value.id}/presences`, { presences: payload })
    success.value = true
    setTimeout(() => { success.value = false }, 3000)
  } finally { saving.value = false }
}

async function sauvegarderContenu() {
  if (!selectedSeance.value) return
  savingContenu.value = true; successContenu.value = false
  try {
    await api.post(`/seances/${selectedSeance.value.id}/contenu`, contenuForm.value)
    successContenu.value = true
    selectedSeance.value.contenu_seance = contenuForm.value.contenu_seance
    selectedSeance.value.objectifs = contenuForm.value.objectifs
    setTimeout(() => { successContenu.value = false }, 3000)
  } finally { savingContenu.value = false }
}

async function emargerEtCloturer() {
  if (!selectedSeance.value) return
  if (!confirm('Clôturer et émarger cette séance ? Elle ne pourra plus être modifiée.')) return
  saving.value = true
  try {
    const payload = inscriptions.value.map(i => ({
      inscription_id: i.id,
      statut: localPresences.value[i.id] ?? 'absent',
    }))
    const { data } = await api.post(`/seances/${selectedSeance.value.id}/emarger`, {
      ...contenuForm.value,
      presences: payload,
      enseignant_id: selectedSeance.value.enseignant?.id ?? null,
    })
    // Mettre à jour la séance localement
    selectedSeance.value = { ...selectedSeance.value, ...data }
    const idx = seances.value.findIndex(s => s.id === data.id)
    if (idx !== -1) seances.value[idx] = { ...seances.value[idx], ...data }
  } finally { saving.value = false }
}

async function load() {
  // Ne pas charger si auth pas encore prête
  if (!auth.user) return
  loading.value = true
  try {
    if (isEnseignant.value) {
      try {
        // 1. Récupérer le profil enseignant pour obtenir l'ID
        const { data: profil } = await api.get('/enseignants/me')
        monEnseignantId.value = profil.id ?? null

        // 2. Charger uniquement les séances de ce prof
        const sRes = await api.get('/seances', { params: { enseignant_id: profil.id } })
        seances.value = sRes.data

        // 3. Dériver la liste des classes depuis ses séances réelles
        //    (inclut tronc commun + classes sans UE formelle)
        const classesMap = new Map<number, { id: number; nom: string }>()
        seances.value.forEach(s => {
          if (s.classe) classesMap.set(s.classe.id, s.classe)
        })
        classes.value = [...classesMap.values()].sort((a, b) => a.nom.localeCompare(b.nom))
      } catch (e) {
        console.error('Erreur chargement profil enseignant:', e)
      }
    } else {
      // Admin/coord : toutes les séances + toutes les classes
      const [sRes, cRes] = await Promise.all([api.get('/seances'), api.get('/classes')])
      seances.value = sRes.data
      classes.value = cRes.data
    }
  } finally { loading.value = false }
}

// Lancer le chargement dès que l'utilisateur est connu (résout le race condition auth)
// immediate:true → si auth déjà dispo au mount, charge immédiatement
// sinon attend que auth.user soit set (première connexion, retour de navigation)
let loaded = false
watch(() => auth.user, (user) => {
  if (user && !loaded) { loaded = true; load() }
}, { immediate: true })

onMounted(() => {
  // Reload à chaque remontage de la vue (retour depuis une autre page)
  if (auth.user) { loaded = true; load() }
})
</script>

<template>
  <div class="uc-content">
    <UcPageHeader title="Émargement" subtitle="Saisie des présences et contenu des séances" />

    <div class="em-grid">

      <!-- ── Colonne gauche : liste séances ── -->
      <div class="em-left">
        <div class="em-card">
          <div class="em-card-header">Séances</div>
          <div class="em-filters">
            <select v-model="filterClasse" class="em-select">
              <option value="">Toutes les classes</option>
              <option v-for="c in classes" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
            </select>
            <input v-model="filterDate" type="date" class="em-select" />
            <select v-model="filterStatut" class="em-select">
              <option value="">Tous les statuts</option>
              <option value="planifie">Planifiées</option>
              <option value="confirme">Confirmées</option>
              <option value="effectue">Émargées</option>
              <option value="annule">Annulées</option>
            </select>
            <!-- Bouton actualiser : recharge les séances depuis le serveur -->
            <button @click="load" :disabled="loading"
              title="Actualiser les séances"
              style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;cursor:pointer;display:flex;align-items:center;gap:5px;font-size:12px;color:#374151;white-space:nowrap;flex-shrink:0;">
              <svg :style="loading ? 'animation:spin 1s linear infinite' : ''" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              Actualiser
            </button>
          </div>
          <div v-if="loading" class="em-empty">Chargement…</div>
          <div v-else-if="!seancesFiltrees.length" class="em-empty">Aucune séance trouvée</div>
          <div v-else class="em-list">
            <button v-for="s in seancesFiltrees" :key="s.id"
              @click="selectSeance(s)"
              class="em-item"
              :class="[selectedSeance?.id === s.id ? 'em-item--active' : '', s.statut === 'effectue' ? 'em-item--done' : '']">
              <div class="em-item-top">
                <span class="em-item-mat">{{ s.matiere }}</span>
                <span class="em-statut-dot" :class="statutBadge(s.statut)">{{ statutLabel(s.statut) }}</span>
              </div>
              <p class="em-item-meta">{{ s.classe?.nom }} · {{ fmtTime(s.date_debut) }}–{{ fmtTime(s.date_fin) }}</p>
              <p v-if="s.enseignant" class="em-item-prof">{{ s.enseignant.prenom }} {{ s.enseignant.nom }}</p>
            </button>
          </div>
        </div>
      </div>

      <!-- ── Colonne droite : détail ── -->
      <div class="em-right">
        <div v-if="!selectedSeance" class="em-placeholder">
          <svg width="40" height="40" fill="none" stroke="#ddd" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          <p>Sélectionnez une séance</p>
        </div>

        <div v-else class="em-detail">

          <!-- ── Bloc 1 : Info séance ── -->
          <div class="em-block em-block-info">
            <div class="em-info-left">
              <h2 class="em-seance-titre">{{ selectedSeance.matiere }}</h2>
              <p class="em-seance-sub">
                {{ selectedSeance.classe?.nom }} ·
                {{ fmtDate(selectedSeance.date_debut) }} ·
                {{ fmtTime(selectedSeance.date_debut) }}–{{ fmtTime(selectedSeance.date_fin) }}
              </p>
              <p v-if="selectedSeance.enseignant" class="em-seance-prof">
                👨‍🏫 {{ selectedSeance.enseignant.prenom }} {{ selectedSeance.enseignant.nom }}
              </p>
            </div>
            <div class="em-info-right">
              <span class="em-statut-badge" :class="statutBadge(selectedSeance.statut)">
                {{ statutLabel(selectedSeance.statut) }}
              </span>
              <div v-if="estCloturee && selectedSeance.signe_enseignant_at" class="em-signe-info">
                Émargé le {{ fmtDateTime(selectedSeance.signe_enseignant_at) }}
              </div>
            </div>
          </div>

          <!-- ── Bloc 2 : Contenu de la séance ── -->
          <div class="em-block">
            <div class="em-block-title">
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Contenu de la séance
            </div>
            <div class="em-form-group">
              <label class="em-label">Objectifs du cours</label>
              <RichTextEditor
                v-model="contenuForm.objectifs"
                :disabled="estCloturee"
                :rows="2"
                placeholder="Ex: Comprendre les bases du HTML, créer une structure de page web…"
              />
            </div>
            <div class="em-form-group">
              <label class="em-label">Contenu enseigné <span style="color:#E30613">*</span></label>
              <RichTextEditor
                v-model="contenuForm.contenu_seance"
                :disabled="estCloturee"
                :rows="4"
                placeholder="Décrivez ce qui a été traité durant cette séance : chapitres, exercices, notions abordées…"
              />
            </div>
            <div v-if="!estCloturee && canWrite" class="em-save-contenu">
              <button @click="sauvegarderContenu" :disabled="savingContenu" class="em-btn-secondary">
                {{ savingContenu ? 'Sauvegarde…' : '💾 Sauvegarder le contenu' }}
              </button>
              <span v-if="successContenu" class="em-success-msg">✓ Contenu sauvegardé</span>
            </div>
            <div v-if="estCloturee && (selectedSeance.contenu_seance || selectedSeance.objectifs)" class="em-contenu-readonly">
              <div v-if="selectedSeance.objectifs">
                <strong>Objectifs :</strong>
                <div class="em-rich-display" v-html="selectedSeance.objectifs"></div>
              </div>
              <div v-if="selectedSeance.contenu_seance" style="margin-top:6px;">
                <strong>Contenu :</strong>
                <div class="em-rich-display" v-html="selectedSeance.contenu_seance"></div>
              </div>
            </div>
          </div>

          <!-- ── Bloc 3 : Présences ── -->
          <div class="em-block">
            <div class="em-block-title">
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              Présences
            </div>

            <!-- KPIs présences -->
            <div class="em-kpis">
              <div class="em-kpi em-kpi-present">
                <span class="em-kpi-val">{{ compteurs.present }}</span>
                <span class="em-kpi-label">Présents</span>
              </div>
              <div class="em-kpi em-kpi-retard">
                <span class="em-kpi-val">{{ compteurs.retard }}</span>
                <span class="em-kpi-label">Retards</span>
              </div>
              <div class="em-kpi em-kpi-absent">
                <span class="em-kpi-val">{{ compteurs.absent }}</span>
                <span class="em-kpi-label">Absents</span>
              </div>
              <div class="em-kpi em-kpi-excuse">
                <span class="em-kpi-val">{{ compteurs.excuse }}</span>
                <span class="em-kpi-label">Excusés</span>
              </div>
              <div class="em-kpi em-kpi-taux">
                <span class="em-kpi-val" :style="{ color: tauxPresence >= 80 ? '#16a34a' : tauxPresence >= 50 ? '#ea580c' : '#E30613' }">
                  {{ tauxPresence }}%
                </span>
                <span class="em-kpi-label">Taux présence</span>
              </div>
            </div>

            <!-- Barre de progression -->
            <div class="em-progress">
              <div class="em-progress-present" :style="{ width: `${Math.round(compteurs.present/Math.max(compteurs.total,1)*100)}%` }"></div>
              <div class="em-progress-retard" :style="{ width: `${Math.round(compteurs.retard/Math.max(compteurs.total,1)*100)}%` }"></div>
              <div class="em-progress-absent" :style="{ width: `${Math.round(compteurs.absent/Math.max(compteurs.total,1)*100)}%` }"></div>
            </div>

            <!-- Action rapide -->
            <div v-if="canWrite && !estCloturee" class="em-quick-actions">
              <button @click="marquerTousPresents" class="em-btn-all-present">✓ Tous présents</button>
            </div>

            <!-- Liste étudiants -->
            <div v-if="loadingInscrits" class="em-empty">Chargement…</div>
            <div v-else-if="!inscriptions.length" class="em-empty">Aucun étudiant inscrit dans cette classe.</div>
            <div v-else class="em-students">
              <div v-for="insc in inscriptions" :key="insc.id" class="em-student">
                <div class="em-avatar">{{ (insc.etudiant.prenom[0] ?? '') + (insc.etudiant.nom[0] ?? '') }}</div>
                <div class="em-student-info">
                  <p class="em-student-name">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</p>
                  <p v-if="insc.classe" class="em-student-sub">{{ insc.classe.nom }}</p>
                </div>
                <span class="em-badge" :class="`em-badge-${localPresences[insc.id] ?? 'absent'}`">
                  {{ { present: 'Présent', retard: 'Retard', absent: 'Absent', excuse: 'Excusé' }[localPresences[insc.id] ?? 'absent'] }}
                </span>
                <div v-if="canWrite && !estCloturee" class="em-toggles">
                  <button v-for="st in ['present','retard','absent','excuse']" :key="st"
                    @click="setPresence(insc.id, st as any)"
                    class="em-toggle"
                    :class="`em-toggle-${st}${(localPresences[insc.id] ?? 'absent') === st ? '--active' : ''}`">
                    {{ { present:'P', retard:'R', absent:'A', excuse:'E' }[st] }}
                  </button>
                </div>
                <div v-else-if="estCloturee" class="em-locked-icon">🔒</div>
              </div>
            </div>
          </div>

          <!-- ── Bloc 4 : Émargement / Clôture ── -->
          <div v-if="canWrite" class="em-block em-block-footer">

            <!-- Séance déjà clôturée -->
            <div v-if="estCloturee" class="em-cloture-done">
              <div class="em-cloture-done-icon">✅</div>
              <div>
                <strong>Séance émargée et clôturée</strong>
                <p v-if="selectedSeance.signe_enseignant_at">
                  Le {{ fmtDateTime(selectedSeance.signe_enseignant_at) }}
                </p>
              </div>
            </div>

            <!-- Actions si pas encore clôturée -->
            <div v-else class="em-footer-actions">
              <button @click="sauvegarderPresences" :disabled="saving || !inscriptions.length"
                class="em-btn-secondary">
                {{ saving ? 'Sauvegarde…' : '💾 Sauvegarder les présences' }}
              </button>
              <button @click="emargerEtCloturer" :disabled="saving || !inscriptions.length"
                class="em-btn-emarger">
                ✍️ Émarger et clôturer la séance
              </button>
              <span v-if="success" class="em-success-msg">✓ Présences enregistrées</span>
            </div>
            <p v-if="!estCloturee && !contenuForm.contenu_seance.trim()" class="em-hint">
              ℹ️ Pensez à renseigner le contenu de la séance avant de clôturer.
            </p>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.em-grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }

/* ── Carte gauche ── */
.em-card { background: #fff; border-radius: 10px; border: 1px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); overflow: hidden; }
.em-card-header { padding: 12px 16px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #888; background: #fafafa; border-bottom: 1px solid #f0f0f0; letter-spacing: .5px; }
.em-filters { padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; border-bottom: 1px solid #f0f0f0; }
.em-select { width: 100%; box-sizing: border-box; border: 1.5px solid #e5e5e5; border-radius: 6px; padding: 7px 10px; font-size: 12px; color: #333; background: #fff; font-family: inherit; }
.em-empty { padding: 24px; text-align: center; color: #aaa; font-size: 13px; }
.em-list { max-height: 520px; overflow-y: auto; }
.em-item { width: 100%; text-align: left; padding: 11px 14px; border: none; background: none; cursor: pointer; border-bottom: 1px solid #f9f9f9; border-left: 3px solid transparent; font-family: inherit; transition: background .15s; }
.em-item:hover { background: #fafafa; }
.em-item--active { background: #fff5f5 !important; border-left-color: #E30613; }
.em-item--done { opacity: .8; }
.em-item-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.em-item-mat { font-size: 12.5px; font-weight: 600; color: #222; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.em-item-meta { font-size: 11px; color: #999; margin: 3px 0 0; }
.em-item-prof { font-size: 11px; color: #bbb; margin: 1px 0 0; }

/* Statut dots */
.em-statut-dot { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 20px; white-space: nowrap; flex-shrink: 0; }
.em-badge-planifie { background: #eff6ff; color: #2563eb; }
.em-badge-confirme { background: #f0fdf4; color: #16a34a; }
.em-badge-effectue { background: #f0fdf4; color: #15803d; }
.em-badge-annule   { background: #fff0f0; color: #b91c1c; }
.em-badge-reporte  { background: #fffbeb; color: #92400e; }

/* ── Droite ── */
.em-right {}
.em-placeholder { background: #fff; border-radius: 10px; border: 1px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 260px; color: #bbb; font-size: 13px; }
.em-detail { display: flex; flex-direction: column; gap: 12px; }

.em-block { background: #fff; border-radius: 10px; border: 1px solid #f0f0f0; box-shadow: 0 2px 8px rgba(0,0,0,0.04); overflow: hidden; }
.em-block-title { display: flex; align-items: center; gap: 7px; padding: 12px 16px; font-size: 12px; font-weight: 700; color: #555; text-transform: uppercase; letter-spacing: .5px; background: #fafafa; border-bottom: 1px solid #f0f0f0; }

/* Bloc info séance */
.em-block-info { padding: 16px 20px; display: flex; align-items: flex-start; gap: 16px; }
.em-info-left { flex: 1; }
.em-seance-titre { font-size: 16px; font-weight: 700; color: #111; margin: 0; }
.em-seance-sub { font-size: 12px; color: #888; margin: 4px 0 0; }
.em-seance-prof { font-size: 12px; color: #555; margin: 4px 0 0; }
.em-info-right { text-align: right; flex-shrink: 0; }
.em-statut-badge { display: inline-block; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 20px; }
.em-signe-info { font-size: 10.5px; color: #aaa; margin-top: 6px; }

/* Contenu séance */
.em-form-group { padding: 10px 16px 0; }
.em-label { display: block; font-size: 11.5px; font-weight: 600; color: #555; margin-bottom: 5px; }
.em-rich-display { margin-top: 4px; font-size: 13px; color: #333; line-height: 1.6; }
.em-rich-display ul, .em-rich-display ol { padding-left: 20px; margin: 4px 0; }
.em-rich-display li { margin: 2px 0; }
.em-save-contenu { display: flex; align-items: center; gap: 10px; padding: 10px 16px 14px; }
.em-contenu-readonly { padding: 12px 16px; font-size: 13px; color: #444; line-height: 1.6; border-top: 1px solid #f0f0f0; margin-top: 8px; }

/* KPIs présences */
.em-kpis { display: grid; grid-template-columns: repeat(5,1fr); border-bottom: 1px solid #f0f0f0; }
.em-kpi { padding: 12px 8px; text-align: center; border-right: 1px solid #f0f0f0; }
.em-kpi:last-child { border-right: none; }
.em-kpi-val { display: block; font-size: 20px; font-weight: 800; }
.em-kpi-label { display: block; font-size: 10px; color: #aaa; margin-top: 2px; }
.em-kpi-present .em-kpi-val { color: #16a34a; }
.em-kpi-retard  .em-kpi-val { color: #ea580c; }
.em-kpi-absent  .em-kpi-val { color: #E30613; }
.em-kpi-excuse  .em-kpi-val { color: #888; }

/* Barre progression */
.em-progress { height: 5px; background: #f0f0f0; display: flex; overflow: hidden; }
.em-progress-present { background: #22c55e; transition: width .3s; }
.em-progress-retard  { background: #f97316; transition: width .3s; }
.em-progress-absent  { background: #E30613; transition: width .3s; }

.em-quick-actions { padding: 10px 16px; border-bottom: 1px solid #f0f0f0; background: #fafafa; }
.em-btn-all-present { background: #22c55e; color: #fff; border: none; border-radius: 5px; padding: 6px 14px; font-size: 11.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
.em-btn-all-present:hover { background: #16a34a; }

/* Liste étudiants */
.em-students { max-height: 340px; overflow-y: auto; }
.em-student { display: flex; align-items: center; gap: 10px; padding: 9px 16px; border-bottom: 1px solid #f9f9f9; }
.em-avatar { width: 32px; height: 32px; border-radius: 50%; background: #fde8e8; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #E30613; flex-shrink: 0; text-transform: uppercase; }
.em-student-info { flex: 1; min-width: 0; }
.em-student-name { font-size: 13px; font-weight: 600; color: #222; margin: 0; }
.em-student-sub { font-size: 10.5px; color: #aaa; margin: 0; }
.em-badge { padding: 3px 8px; border-radius: 20px; font-size: 10.5px; font-weight: 600; white-space: nowrap; }
.em-badge-present { background: #f0fdf4; color: #15803d; }
.em-badge-retard  { background: #fff7ed; color: #c2410c; }
.em-badge-absent  { background: #fff0f0; color: #b91c1c; }
.em-badge-excuse  { background: #f3f4f6; color: #555; }
.em-toggles { display: flex; gap: 3px; }
.em-toggle { border: none; border-radius: 4px; padding: 4px 8px; font-size: 11px; font-weight: 700; cursor: pointer; font-family: inherit; }
.em-toggle-present { background: #f0fdf4; color: #15803d; }
.em-toggle-present--active { background: #22c55e; color: #fff; }
.em-toggle-retard  { background: #fff7ed; color: #c2410c; }
.em-toggle-retard--active  { background: #f97316; color: #fff; }
.em-toggle-absent  { background: #fff0f0; color: #b91c1c; }
.em-toggle-absent--active  { background: #E30613; color: #fff; }
.em-toggle-excuse  { background: #f3f4f6; color: #555; }
.em-toggle-excuse--active  { background: #888; color: #fff; }
.em-locked-icon { font-size: 14px; color: #ccc; }

/* Footer bloc */
.em-block-footer { padding: 16px 20px; }
.em-footer-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.em-btn-secondary { background: #f3f4f6; color: #374151; border: 1.5px solid #e5e7eb; border-radius: 6px; padding: 9px 16px; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
.em-btn-secondary:hover { background: #e5e7eb; }
.em-btn-secondary:disabled { opacity: .5; cursor: not-allowed; }
.em-btn-emarger { background: #E30613; color: #fff; border: none; border-radius: 6px; padding: 9px 20px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
.em-btn-emarger:hover { background: #c00; }
.em-btn-emarger:disabled { opacity: .45; cursor: not-allowed; }
.em-success-msg { color: #16a34a; font-size: 12px; font-weight: 600; }
.em-hint { margin: 8px 0 0; font-size: 11.5px; color: #f59e0b; }
.em-cloture-done { display: flex; align-items: center; gap: 14px; background: #f0fdf4; border-radius: 8px; padding: 14px 18px; }
.em-cloture-done-icon { font-size: 24px; }
.em-cloture-done strong { font-size: 13.5px; color: #15803d; }
.em-cloture-done p { font-size: 12px; color: #888; margin: 3px 0 0; }

@media (max-width: 900px) {
  .em-grid { grid-template-columns: 1fr; }
  .em-kpis { grid-template-columns: repeat(3,1fr); }
  .em-kpi:nth-child(3) { border-right: none; }
  .em-students { max-height: none; }
  .em-list { max-height: 280px; }
}
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
</style>
