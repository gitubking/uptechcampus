<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

type Result = {
  type: 'etudiant' | 'classe' | 'enseignant' | 'paiement' | 'page'
  id: number | string
  label: string
  sublabel?: string
  route: string
  icon: string
}

const router = useRouter()
const auth = useAuthStore()
const open = ref(false)
const query = ref('')
const results = ref<Result[]>([])
const selectedIdx = ref(0)
const loading = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)

// Pages accessibles selon le rôle (complément aux entités serveur)
const pagesByRole: Record<string, { label: string; route: string; keywords: string }[]> = {
  dg: [
    { label: 'Tableau de bord',          route: '/',                  keywords: 'dashboard accueil home' },
    { label: 'Étudiants',                route: '/etudiants',         keywords: 'etudiant students' },
    { label: 'Classes',                  route: '/classes',           keywords: 'classe' },
    { label: 'Enseignants',              route: '/enseignants',       keywords: 'enseignant prof teacher' },
    { label: 'Paiements',                route: '/paiements',         keywords: 'paiement paiements payment' },
    { label: 'Suivi paiements',          route: '/suivi-paiements',   keywords: 'suivi retard relance impaye' },
    { label: 'Dépenses',                 route: '/depenses',          keywords: 'depense charge sortie' },
    { label: 'Tableau financier',        route: '/tableau-financier', keywords: 'finance tresorerie' },
    { label: 'Notes & bulletins',        route: '/notes-bulletins',   keywords: 'note bulletin jury' },
    { label: 'Emplois du temps',         route: '/emplois-du-temps',  keywords: 'edt planning' },
    { label: 'Émargement',               route: '/emargement',        keywords: 'presence absence' },
    { label: 'Absences',                 route: '/absences',          keywords: 'absence' },
    { label: 'Paramètres',               route: '/parametres',        keywords: 'parametres settings config' },
    { label: 'Utilisateurs',             route: '/users',             keywords: 'user compte' },
    { label: 'Rapports',                 route: '/rapports',          keywords: 'rapport report' },
  ],
  secretariat: [
    { label: 'Étudiants',        route: '/etudiants',       keywords: 'etudiant' },
    { label: 'Classes',          route: '/classes',         keywords: 'classe' },
    { label: 'Paiements',        route: '/paiements',       keywords: 'paiement' },
    { label: 'Suivi paiements',  route: '/suivi-paiements', keywords: 'suivi retard' },
    { label: 'Émargement',       route: '/emargement',      keywords: 'presence' },
  ],
  enseignant: [
    { label: 'Mon planning',    route: '/emplois-du-temps', keywords: 'planning edt' },
    { label: 'Mes émargements', route: '/emargement',       keywords: 'presence' },
    { label: 'Mes notes',       route: '/notes-bulletins',  keywords: 'note saisie' },
  ],
  etudiant: [
    { label: 'Mon espace',      route: '/espace-etudiant',  keywords: 'accueil' },
    { label: 'Mes paiements',   route: '/espace-etudiant',  keywords: 'paiement' },
    { label: 'Mes absences',    route: '/espace-etudiant',  keywords: 'absence' },
  ],
}
const userPages = computed<{ label: string; route: string; keywords: string }[]>(() => pagesByRole[auth.user?.role || ''] || pagesByRole.dg || [])

// Recherche avec debounce léger
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  const trimmed = q.trim()
  if (trimmed.length < 2) {
    // Suggestions de pages filtrées sur le query
    results.value = userPages.value
      .filter(p => !trimmed || p.label.toLowerCase().includes(trimmed.toLowerCase()) || p.keywords.includes(trimmed.toLowerCase()))
      .slice(0, 10)
      .map(p => ({ type: 'page' as const, id: p.route, label: p.label, route: p.route, icon: 'page' }))
    selectedIdx.value = 0
    return
  }
  searchTimer = setTimeout(async () => {
    loading.value = true
    try {
      const { data } = await api.get('/search', { params: { q: trimmed } })
      const pageHits = userPages.value
        .filter(p => p.label.toLowerCase().includes(trimmed.toLowerCase()) || p.keywords.includes(trimmed.toLowerCase()))
        .slice(0, 3)
        .map(p => ({ type: 'page' as const, id: p.route, label: p.label, route: p.route, icon: 'page' }))
      results.value = [...pageHits, ...(data?.results || [])]
      selectedIdx.value = 0
    } catch {
      results.value = []
    } finally {
      loading.value = false
    }
  }, 180)
})

function openPalette() {
  open.value = true
  query.value = ''
  selectedIdx.value = 0
  results.value = userPages.value.slice(0, 10).map(p => ({ type: 'page', id: p.route, label: p.label, route: p.route, icon: 'page' }))
  nextTick(() => inputEl.value?.focus())
}
function closePalette() { open.value = false }

function selectResult(r: Result) {
  closePalette()
  router.push(r.route).catch(() => {})
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault()
    if (open.value) closePalette()
    else openPalette()
    return
  }
  if (!open.value) return
  if (e.key === 'Escape') { e.preventDefault(); closePalette() }
  else if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx.value = Math.min(results.value.length - 1, selectedIdx.value + 1) }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); selectedIdx.value = Math.max(0, selectedIdx.value - 1) }
  else if (e.key === 'Enter') {
    const item = results.value[selectedIdx.value]
    if (item) {
      e.preventDefault()
      selectResult(item)
    }
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

const typeLabel: Record<string, string> = {
  etudiant: 'Étudiant',
  enseignant: 'Enseignant',
  classe: 'Classe',
  paiement: 'Paiement',
  page: 'Page',
}
const typeColor: Record<string, string> = {
  etudiant: '#2563eb',
  enseignant: '#9333ea',
  classe: '#0ea5e9',
  paiement: '#16a34a',
  page: '#64748b',
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="uc-cmdk-overlay" @click.self="closePalette">
      <div class="uc-cmdk" role="dialog" aria-label="Recherche globale">
        <div class="uc-cmdk-input-row">
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#94a3b8"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            placeholder="Rechercher étudiant, classe, enseignant, reçu… ou aller à une page"
            class="uc-cmdk-input"
            autocomplete="off"
          />
          <span class="uc-cmdk-hint">Échap</span>
        </div>

        <div class="uc-cmdk-results">
          <div v-if="loading" class="uc-cmdk-empty">Recherche…</div>
          <div v-else-if="results.length === 0" class="uc-cmdk-empty">
            Aucun résultat pour « {{ query }} ».
          </div>
          <button
            v-else
            v-for="(r, i) in results"
            :key="r.type + '-' + r.id"
            class="uc-cmdk-item"
            :class="i === selectedIdx ? 'uc-cmdk-item--active' : ''"
            @click="selectResult(r)"
            @mouseenter="selectedIdx = i"
          >
            <span class="uc-cmdk-type" :style="{ background: typeColor[r.type] + '22', color: typeColor[r.type] }">
              {{ typeLabel[r.type] || r.type }}
            </span>
            <div class="uc-cmdk-item-body">
              <div class="uc-cmdk-label">{{ r.label }}</div>
              <div v-if="r.sublabel" class="uc-cmdk-sublabel">{{ r.sublabel }}</div>
            </div>
            <svg v-if="i === selectedIdx" width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#94a3b8"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>

        <div class="uc-cmdk-footer">
          <span><kbd>↑↓</kbd> naviguer</span>
          <span><kbd>↵</kbd> ouvrir</span>
          <span><kbd>Ctrl</kbd>+<kbd>K</kbd> pour rouvrir</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.uc-cmdk-overlay {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
  z-index: 9998; display: flex; justify-content: center; align-items: flex-start;
  padding-top: 10vh; backdrop-filter: blur(2px);
}
.uc-cmdk {
  width: 640px; max-width: calc(100vw - 32px);
  background: #fff; border-radius: 12px;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28), 0 4px 12px rgba(15, 23, 42, 0.12);
  overflow: hidden; display: flex; flex-direction: column;
  max-height: 70vh;
}
.uc-cmdk-input-row {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid #f1f5f9;
}
.uc-cmdk-input {
  flex: 1; border: none; outline: none; background: transparent;
  font-size: 15px; color: #0f172a; font-family: inherit;
}
.uc-cmdk-input::placeholder { color: #94a3b8; }
.uc-cmdk-hint {
  font-size: 10.5px; color: #64748b; background: #f1f5f9;
  padding: 3px 7px; border-radius: 4px; font-weight: 600;
}
.uc-cmdk-results {
  overflow-y: auto; padding: 6px 0; flex: 1;
}
.uc-cmdk-item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 9px 16px; background: none; border: none; text-align: left;
  cursor: pointer; font-family: inherit; font-size: 13.5px; color: #1e293b;
}
.uc-cmdk-item--active { background: #f1f5f9; }
.uc-cmdk-type {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.04em; padding: 2px 7px; border-radius: 4px;
  flex-shrink: 0; min-width: 70px; text-align: center;
}
.uc-cmdk-item-body { flex: 1; min-width: 0; }
.uc-cmdk-label { font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uc-cmdk-sublabel { font-size: 11.5px; color: #64748b; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.uc-cmdk-empty { padding: 20px; text-align: center; color: #94a3b8; font-size: 13px; }
.uc-cmdk-footer {
  display: flex; gap: 16px; padding: 10px 16px; border-top: 1px solid #f1f5f9;
  font-size: 11px; color: #64748b; background: #fafbfc;
}
kbd {
  background: #fff; border: 1px solid #e2e8f0; border-radius: 3px;
  padding: 1px 5px; font-family: inherit; font-size: 10px; font-weight: 600;
  color: #475569;
}
</style>
