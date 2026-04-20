<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const canWrite = computed(() => ['dg', 'secretariat'].includes(auth.user?.role ?? ''))

interface DocType { code: string; label: string; type_formation_id: number | null; type_formation_nom?: string | null }
interface EtudiantRow {
  id: number
  nom: string
  prenom: string
  numero_etudiant: string
  filiere_id: number | null
  filiere_nom: string | null
  type_formation_id: number | null
  type_formation_nom: string | null
  filiere_code: string | null
  classe_id: number | null
  classe_nom: string | null
  inscription_statut: string | null
  checklist: Record<string, boolean>
  recu_count: number
  total: number
}

const types = ref<DocType[]>([])
const etudiants = ref<EtudiantRow[]>([])
const loading = ref(true)
const toggling = ref<Record<string, boolean>>({})  // key = `${etudiantId}-${code}`
const search = ref('')
const filtreStatut = ref('')
const filtreClasse = ref('')
const filtreTypeFormation = ref('')
const filtreFiliere = ref('')
// Sélection des types de documents à afficher en colonne — défaut : tous visibles
const selectedTypeCodes = ref<Set<string>>(new Set())
const showTypesMenu = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/dossiers-etudiants')
    types.value = data.types
    etudiants.value = data.etudiants
    // Par défaut, tous les types sont visibles
    if (selectedTypeCodes.value.size === 0) {
      selectedTypeCodes.value = new Set(types.value.map(t => t.code))
    }
  } finally {
    loading.value = false
  }
}

// Options de filtres extraites des étudiants (dédoublonnées)
const classesOptions = computed(() => {
  const map = new Map<number, string>()
  for (const e of etudiants.value) {
    if (e.classe_id && e.classe_nom) map.set(e.classe_id, e.classe_nom)
  }
  return Array.from(map, ([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom))
})
const typesFormationOptions = computed(() => {
  const map = new Map<number, string>()
  for (const e of etudiants.value) {
    if (e.type_formation_id && e.type_formation_nom) map.set(e.type_formation_id, e.type_formation_nom)
  }
  // Ajouter aussi les types référencés par un type de document (utile si aucun étudiant n'en a encore)
  for (const t of types.value) {
    if (t.type_formation_id && t.type_formation_nom) map.set(t.type_formation_id, t.type_formation_nom)
  }
  return Array.from(map, ([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom))
})
const filieresOptions = computed(() => {
  const map = new Map<number, { nom: string; type_formation_id: number | null }>()
  for (const e of etudiants.value) {
    if (e.filiere_id && e.filiere_nom) {
      map.set(e.filiere_id, { nom: e.filiere_nom, type_formation_id: e.type_formation_id })
    }
  }
  let list = Array.from(map, ([id, v]) => ({ id, nom: v.nom, type_formation_id: v.type_formation_id }))
  // Si un type de formation est sélectionné, restreindre les filières à ce type
  if (filtreTypeFormation.value) {
    const tfId = Number(filtreTypeFormation.value)
    list = list.filter(f => f.type_formation_id === tfId)
  }
  return list.sort((a, b) => a.nom.localeCompare(b.nom))
})

// Colonnes visibles : intersection de la sélection utilisateur + filtre type de formation
const visibleTypes = computed(() => {
  return types.value.filter(t => {
    if (!selectedTypeCodes.value.has(t.code)) return false
    if (filtreTypeFormation.value) {
      const tfId = Number(filtreTypeFormation.value)
      // Afficher les types communs (null) + ceux du type sélectionné
      if (t.type_formation_id !== null && t.type_formation_id !== tfId) return false
    }
    return true
  })
})

const etudiantsFiltres = computed(() => {
  const q = search.value.toLowerCase().trim()
  const classeId = filtreClasse.value ? Number(filtreClasse.value) : null
  const tfId = filtreTypeFormation.value ? Number(filtreTypeFormation.value) : null
  const filiereId = filtreFiliere.value ? Number(filtreFiliere.value) : null
  return etudiants.value.filter(e => {
    const matchSearch = !q ||
      e.nom.toLowerCase().includes(q) ||
      e.prenom.toLowerCase().includes(q) ||
      (e.numero_etudiant ?? '').toLowerCase().includes(q) ||
      (e.filiere_nom ?? '').toLowerCase().includes(q) ||
      (e.classe_nom ?? '').toLowerCase().includes(q)
    const matchStatut = !filtreStatut.value || e.inscription_statut === filtreStatut.value
    const matchClasse = !classeId || e.classe_id === classeId
    const matchTF = !tfId || e.type_formation_id === tfId
    const matchFiliere = !filiereId || e.filiere_id === filiereId
    return matchSearch && matchStatut && matchClasse && matchTF && matchFiliere
  })
})

function toggleTypeVisible(code: string) {
  if (selectedTypeCodes.value.has(code)) selectedTypeCodes.value.delete(code)
  else selectedTypeCodes.value.add(code)
  // Cloner le Set pour déclencher la réactivité
  selectedTypeCodes.value = new Set(selectedTypeCodes.value)
}
function selectAllTypes() {
  selectedTypeCodes.value = new Set(types.value.map(t => t.code))
}
function deselectAllTypes() {
  selectedTypeCodes.value = new Set()
}
function resetFiltres() {
  search.value = ''
  filtreStatut.value = ''
  filtreClasse.value = ''
  filtreTypeFormation.value = ''
  filtreFiliere.value = ''
  selectAllTypes()
}

// Statistiques globales calculées sur les étudiants filtrés et les colonnes visibles
const statsGlobal = computed(() => {
  const listeEtudiants = etudiantsFiltres.value
  const listeTypes = visibleTypes.value
  if (!listeEtudiants.length || !listeTypes.length) return null
  let totalCases = 0
  let totalRecus = 0
  let complets = 0
  for (const e of listeEtudiants) {
    const applicables = listeTypes.filter(t => isApplicable(t, e))
    totalCases += applicables.length
    const recus = applicables.filter(t => !!e.checklist[t.code]).length
    totalRecus += recus
    if (applicables.length > 0 && recus === applicables.length) complets++
  }
  return { totalCases, totalRecus, complets, total: listeEtudiants.length }
})

// Un type est applicable si type_formation_id est null (commun) OU correspond au type de formation de l'étudiant
function isApplicable(t: DocType, etudiant: EtudiantRow) {
  return t.type_formation_id === null || t.type_formation_id === etudiant.type_formation_id
}

async function toggle(etudiant: EtudiantRow, code: string) {
  if (!canWrite.value) return
  const key = `${etudiant.id}-${code}`
  if (toggling.value[key]) return
  toggling.value[key] = true
  const newVal = !etudiant.checklist[code]
  try {
    await api.patch(`/etudiants/${etudiant.id}/checklist-documents/${code}`, { recu: newVal })
    etudiant.checklist[code] = newVal
    // Recalcul score sur les types applicables uniquement
    const applicables = types.value.filter(t => isApplicable(t, etudiant))
    etudiant.recu_count = applicables.filter(t => !!etudiant.checklist[t.code]).length
    etudiant.total = applicables.length
  } catch {
    // silencieux
  } finally {
    delete toggling.value[key]
  }
}

function scoreColor(row: EtudiantRow) {
  if (row.total === 0) return 'dos-score--grey'
  const pct = row.recu_count / row.total
  if (pct === 1) return 'dos-score--green'
  if (pct >= 0.5) return 'dos-score--orange'
  if (pct > 0) return 'dos-score--yellow'
  return 'dos-score--red'
}

const statutOptions = [
  { value: '', label: 'Tous les statuts' },
  { value: 'inscrit_actif', label: 'Actif' },
  { value: 'pre_inscrit', label: 'Pré-inscrit' },
  { value: 'en_examen', label: 'En examen' },
  { value: 'diplome', label: 'Diplômé' },
  { value: 'abandonne', label: 'Abandonné' },
]

onMounted(load)
</script>

<template>
  <div class="dos-layout">
    <!-- En-tête -->
    <div class="dos-topbar">
      <div class="dos-topbar-left">
        <h1 class="dos-title">Dossiers étudiants</h1>
        <p class="dos-subtitle">État des documents physiques déposés par chaque étudiant</p>
      </div>
      <!-- Stats globales -->
      <div v-if="statsGlobal" class="dos-stats-row">
        <div class="dos-stat">
          <span class="dos-stat-val">{{ statsGlobal.complets }}</span>
          <span class="dos-stat-lbl">Dossiers complets</span>
        </div>
        <div class="dos-stat-sep"></div>
        <div class="dos-stat">
          <span class="dos-stat-val">{{ statsGlobal.totalRecus }}</span>
          <span class="dos-stat-lbl">Documents reçus</span>
        </div>
        <div class="dos-stat-sep"></div>
        <div class="dos-stat">
          <span class="dos-stat-val">{{ statsGlobal.totalCases - statsGlobal.totalRecus }}</span>
          <span class="dos-stat-lbl">Manquants</span>
        </div>
      </div>
    </div>

    <!-- Filtres -->
    <div class="dos-filters">
      <div class="dos-search-wrap">
        <svg class="dos-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z"/>
        </svg>
        <input v-model="search" type="text" placeholder="Rechercher un étudiant…" class="dos-search" />
      </div>
      <select v-model="filtreTypeFormation" class="dos-select" title="Filtrer par type de formation">
        <option value="">Tous types de formation</option>
        <option v-for="tf in typesFormationOptions" :key="tf.id" :value="String(tf.id)">{{ tf.nom }}</option>
      </select>
      <select v-model="filtreFiliere" class="dos-select" title="Filtrer par filière">
        <option value="">Toutes filières</option>
        <option v-for="f in filieresOptions" :key="f.id" :value="String(f.id)">{{ f.nom }}</option>
      </select>
      <select v-model="filtreClasse" class="dos-select" title="Filtrer par classe">
        <option value="">Toutes classes</option>
        <option v-for="c in classesOptions" :key="c.id" :value="String(c.id)">{{ c.nom }}</option>
      </select>
      <select v-model="filtreStatut" class="dos-select" title="Filtrer par statut d'inscription">
        <option v-for="s in statutOptions" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <!-- Types de documents (colonnes) -->
      <div class="dos-types-menu-wrap">
        <button type="button" class="dos-select dos-types-btn" @click="showTypesMenu = !showTypesMenu">
          Types de documents ({{ selectedTypeCodes.size }}/{{ types.length }})
          <span class="dos-caret">▾</span>
        </button>
        <div v-if="showTypesMenu" class="dos-types-menu" @click.stop>
          <div class="dos-types-menu-header">
            <button type="button" class="dos-mini-btn" @click="selectAllTypes">Tout</button>
            <button type="button" class="dos-mini-btn" @click="deselectAllTypes">Aucun</button>
            <button type="button" class="dos-mini-btn dos-mini-btn--close" @click="showTypesMenu = false">Fermer</button>
          </div>
          <label v-for="t in types" :key="t.code" class="dos-types-menu-item">
            <input type="checkbox" :checked="selectedTypeCodes.has(t.code)" @change="toggleTypeVisible(t.code)" />
            <span class="dos-types-menu-label">{{ t.label }}</span>
            <span v-if="t.type_formation_nom" class="dos-types-menu-tag">{{ t.type_formation_nom }}</span>
            <span v-else class="dos-types-menu-tag dos-types-menu-tag--any">Tous</span>
          </label>
          <div v-if="!types.length" class="dos-types-menu-empty">Aucun type configuré.</div>
        </div>
      </div>
      <button type="button" class="dos-reset-btn" @click="resetFiltres" title="Réinitialiser tous les filtres">
        Réinitialiser
      </button>
      <span class="dos-count">{{ etudiantsFiltres.length }} étudiant{{ etudiantsFiltres.length > 1 ? 's' : '' }}</span>
    </div>

    <!-- Tableau matriciel -->
    <div v-if="loading" class="dos-loading">Chargement…</div>
    <div v-else-if="!types.length" class="dos-empty">
      Aucun type de document configuré.<br>
      <small>Allez dans <strong>Paramètres → Pédagogique → Types de documents</strong></small>
    </div>
    <div v-else-if="!visibleTypes.length" class="dos-empty">
      Aucune colonne à afficher — tous les types sont masqués ou filtrés.<br>
      <small>Réglez le sélecteur <strong>Types de documents</strong> ou réinitialisez les filtres.</small>
    </div>
    <div v-else class="dos-table-wrap">
      <table class="dos-table">
        <thead>
          <tr>
            <!-- Colonnes fixes -->
            <th class="dos-th dos-th--sticky dos-th--num">N° Étudiant</th>
            <th class="dos-th dos-th--sticky dos-th--name">Étudiant</th>
            <th class="dos-th dos-th--sticky dos-th--filiere">Filière</th>
            <!-- Colonnes documents (dynamiques) -->
            <th v-for="t in visibleTypes" :key="t.code" class="dos-th dos-th--doc" :title="t.label">
              <div class="dos-th-doc-label">{{ t.label }}</div>
              <div v-if="t.type_formation_nom" class="dos-th-doc-sub">{{ t.type_formation_nom }}</div>
            </th>
            <!-- Score -->
            <th class="dos-th dos-th--score">Score</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!etudiantsFiltres.length">
            <td :colspan="4 + visibleTypes.length" class="dos-td-empty">Aucun étudiant trouvé</td>
          </tr>
          <tr
            v-for="etudiant in etudiantsFiltres"
            :key="etudiant.id"
            class="dos-row"
            :class="etudiant.recu_count === etudiant.total && etudiant.total > 0 ? 'dos-row--complet' : ''"
          >
            <!-- N° étudiant cliquable -->
            <td class="dos-td dos-td--sticky dos-td--num">
              <button @click="router.push(`/etudiants/${etudiant.id}`)" class="dos-link-num">
                {{ etudiant.numero_etudiant ?? '—' }}
              </button>
            </td>
            <!-- Nom -->
            <td class="dos-td dos-td--sticky dos-td--name">
              <button @click="router.push(`/etudiants/${etudiant.id}`)" class="dos-link-name">
                <span class="dos-avatar">{{ etudiant.prenom[0] }}{{ etudiant.nom[0] }}</span>
                <span>
                  <span class="dos-nom">{{ etudiant.prenom }} {{ etudiant.nom }}</span>
                </span>
              </button>
            </td>
            <!-- Filière -->
            <td class="dos-td dos-td--sticky dos-td--filiere">
              <span v-if="etudiant.filiere_code" class="dos-filiere-badge">{{ etudiant.filiere_code }}</span>
              <span v-else class="dos-no-filiere">—</span>
            </td>
            <!-- Cases à cocher pour chaque type visible -->
            <td v-for="t in visibleTypes" :key="t.code" class="dos-td dos-td--doc"
                :class="!isApplicable(t, etudiant) ? 'dos-td--na' : ''">
              <!-- Non applicable à cette filière -->
              <span v-if="!isApplicable(t, etudiant)" class="dos-na" title="Non requis pour cette filière">—</span>
              <!-- Applicable : case à cocher -->
              <button
                v-else
                @click="toggle(etudiant, t.code)"
                :disabled="!canWrite || !!toggling[`${etudiant.id}-${t.code}`]"
                class="dos-checkbox-btn"
                :class="{
                  'dos-checkbox-btn--checked': etudiant.checklist[t.code],
                  'dos-checkbox-btn--readonly': !canWrite,
                }"
                :title="etudiant.checklist[t.code] ? `${t.label} — Reçu ✓` : `${t.label} — Non remis`"
              >
                <svg v-if="toggling[`${etudiant.id}-${t.code}`]" class="dos-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" class="opacity-25"/>
                  <path fill="currentColor" class="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <svg v-else-if="etudiant.checklist[t.code]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                </svg>
              </button>
            </td>
            <!-- Score X/Y -->
            <td class="dos-td dos-td--score">
              <span class="dos-score" :class="scoreColor(etudiant)">
                {{ etudiant.recu_count }}/{{ etudiant.total }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* ── Layout ──────────────────────────────────────────────────────── */
.dos-layout {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  background: #f8f9fa;
}

/* ── Topbar ──────────────────────────────────────────────────────── */
.dos-topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.dos-title { font-size: 20px; font-weight: 800; color: #111; margin: 0; }
.dos-subtitle { font-size: 12.5px; color: #888; margin: 3px 0 0; }

/* ── Stats globales ──────────────────────────────────────────────── */
.dos-stats-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px 18px;
}
.dos-stat { text-align: center; }
.dos-stat-val { display: block; font-size: 18px; font-weight: 800; color: #111; }
.dos-stat-lbl { display: block; font-size: 10.5px; color: #aaa; margin-top: 1px; }
.dos-stat-sep { width: 1px; height: 30px; background: #f0f0f0; }

/* ── Filtres ─────────────────────────────────────────────────────── */
.dos-filters {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.dos-search-wrap {
  position: relative;
  flex: 1;
  min-width: 200px;
  max-width: 360px;
}
.dos-search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 15px;
  height: 15px;
  color: #aaa;
}
.dos-search {
  width: 100%;
  padding: 8px 12px 8px 32px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 13px;
  background: #fff;
  outline: none;
  box-sizing: border-box;
}
.dos-search:focus { border-color: #E30613; }
.dos-select {
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 12.5px;
  background: #fff;
  color: #555;
  outline: none;
  cursor: pointer;
}
.dos-count {
  font-size: 12px;
  color: #aaa;
  margin-left: 4px;
  white-space: nowrap;
}
.dos-reset-btn {
  padding: 8px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 12px;
  background: #fff;
  color: #666;
  cursor: pointer;
  white-space: nowrap;
}
.dos-reset-btn:hover { background: #f9fafb; border-color: #d1d5db; color: #111; }

/* ── Menu types de documents (sélection colonnes) ─────────────────── */
.dos-types-menu-wrap { position: relative; }
.dos-types-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: #fff; cursor: pointer; font-weight: 500;
}
.dos-caret { font-size: 10px; color: #999; }
.dos-types-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 20;
  min-width: 280px; max-width: 340px; max-height: 360px; overflow: auto;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
  padding: 8px;
}
.dos-types-menu-header {
  display: flex; gap: 6px; padding: 4px 4px 8px;
  border-bottom: 1px solid #f0f0f0; margin-bottom: 4px;
}
.dos-mini-btn {
  padding: 3px 8px; border: 1px solid #e5e7eb; border-radius: 6px;
  background: #fff; font-size: 11px; color: #555; cursor: pointer;
}
.dos-mini-btn:hover { background: #f9fafb; border-color: #d1d5db; }
.dos-mini-btn--close { margin-left: auto; color: #888; }
.dos-types-menu-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 6px; font-size: 12.5px;
  cursor: pointer; user-select: none;
}
.dos-types-menu-item:hover { background: #f9fafb; }
.dos-types-menu-item input[type="checkbox"] {
  width: 14px; height: 14px; accent-color: #E30613; flex-shrink: 0;
}
.dos-types-menu-label { flex: 1; color: #111; }
.dos-types-menu-tag {
  font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 8px;
  background: #ede9fe; color: #6d28d9; white-space: nowrap;
}
.dos-types-menu-tag--any { background: #f3f4f6; color: #888; }
.dos-types-menu-empty { padding: 16px; text-align: center; color: #aaa; font-size: 12px; }

.dos-th-doc-sub {
  font-size: 9px; color: #888; font-weight: 500; margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70px;
}

/* ── Table ───────────────────────────────────────────────────────── */
.dos-loading { text-align: center; color: #aaa; padding: 40px; font-size: 13px; }
.dos-empty {
  text-align: center; color: #aaa; padding: 40px;
  background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  font-size: 13px; line-height: 1.8;
}
.dos-table-wrap {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  overflow: auto;
  max-height: calc(100vh - 260px);
}
.dos-table {
  border-collapse: collapse;
  min-width: 100%;
  font-size: 12.5px;
}

/* ── En-têtes ────────────────────────────────────────────────────── */
.dos-th {
  padding: 10px 12px;
  text-align: left;
  font-weight: 700;
  color: #666;
  background: #f8f9fa;
  border-bottom: 2px solid #e5e7eb;
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 2;
}
.dos-th--sticky { left: 0; z-index: 3; }
.dos-th--num { width: 130px; min-width: 130px; }
.dos-th--name { width: 180px; min-width: 180px; left: 130px; }
.dos-th--filiere { width: 90px; min-width: 90px; left: 310px; border-right: 2px solid #e5e7eb; }
.dos-th--doc { width: 70px; min-width: 70px; text-align: center; padding: 8px 4px; }
.dos-th--score { width: 70px; min-width: 70px; text-align: center; border-left: 2px solid #e5e7eb; background: #f8f9fa; }
.dos-th-doc-label {
  font-size: 11px;
  font-weight: 600;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 70px;
  cursor: default;
}

/* ── Lignes ──────────────────────────────────────────────────────── */
.dos-row { transition: background 0.1s; }
.dos-row:hover { background: #fafafa; }
.dos-row:hover .dos-td--sticky { background: #f5f5f5; }
.dos-row--complet { background: #f0fdf4; }
.dos-row--complet:hover { background: #dcfce7; }
.dos-row--complet .dos-td--sticky { background: #f0fdf4; }

.dos-td {
  padding: 10px 12px;
  border-bottom: 1px solid #f0f0f0;
  vertical-align: middle;
}
.dos-td--sticky {
  background: #fff;
  position: sticky;
  z-index: 1;
}
.dos-td--num { left: 0; }
.dos-td--name { left: 130px; }
.dos-td--filiere { left: 310px; border-right: 2px solid #f0f0f0; }
.dos-td--doc { text-align: center; padding: 8px 4px; }
.dos-td--score { text-align: center; border-left: 2px solid #f0f0f0; }
.dos-td-empty { text-align: center; color: #aaa; padding: 32px; font-size: 13px; }

/* ── Cellules étudiant ───────────────────────────────────────────── */
.dos-link-num {
  font-size: 11px;
  color: #888;
  font-family: monospace;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-decoration: underline dotted;
}
.dos-link-num:hover { color: #E30613; }
.dos-link-name {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  text-align: left;
}
.dos-link-name:hover .dos-nom { color: #E30613; }
.dos-avatar {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #fee2e2;
  color: #E30613;
  font-size: 10px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  text-transform: uppercase;
}
.dos-nom { font-size: 12.5px; font-weight: 600; color: #111; white-space: nowrap; }
.dos-filiere-badge {
  font-size: 10px;
  font-weight: 700;
  background: #e0f2fe;
  color: #0369a1;
  padding: 2px 7px;
  border-radius: 10px;
}
.dos-no-filiere { color: #ccc; font-size: 12px; }

/* ── Cellule N/A ─────────────────────────────────────────────────── */
.dos-td--na { background: #fafafa; }
.dos-na {
  display: inline-block;
  color: #d1d5db;
  font-size: 13px;
  font-weight: 600;
  cursor: default;
  user-select: none;
}

/* ── Cases à cocher ──────────────────────────────────────────────── */
.dos-checkbox-btn {
  width: 26px;
  height: 26px;
  border: 2px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  margin: auto;
}
.dos-checkbox-btn svg { width: 13px; height: 13px; color: #fff; }
.dos-checkbox-btn:hover:not(:disabled):not(.dos-checkbox-btn--checked) {
  border-color: #E30613;
  background: #fff5f5;
}
.dos-checkbox-btn--checked {
  background: #16a34a;
  border-color: #16a34a;
}
.dos-checkbox-btn--checked:hover:not(:disabled) {
  background: #15803d;
  border-color: #15803d;
}
.dos-checkbox-btn--readonly { cursor: default; }
.dos-checkbox-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.dos-spin { width: 14px; height: 14px; color: #aaa; animation: dos-spin 0.8s linear infinite; }
@keyframes dos-spin { to { transform: rotate(360deg); } }

/* ── Score ───────────────────────────────────────────────────────── */
.dos-score {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  padding: 3px 8px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 800;
}
.dos-score--green  { background: #dcfce7; color: #15803d; }
.dos-score--orange { background: #ffedd5; color: #c2410c; }
.dos-score--yellow { background: #fef9c3; color: #a16207; }
.dos-score--red    { background: #fee2e2; color: #b91c1c; }
.dos-score--grey   { background: #f3f4f6; color: #9ca3af; }
</style>
