<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { RouterView, RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

// ── Mobile sidebar toggle ──────────────────────────────────────────
const sidebarOpen = ref(false)
watch(() => route.path, () => { sidebarOpen.value = false })

// ── Dashboard étudiant (provide pour EspaceEtudiantView) ────────────
const dashboardData = ref<any>(null)
provide('dashboardData', dashboardData)
watch(() => auth.user?.role, async (role) => {
  if (role === 'etudiant') {
    try {
      const { data } = await api.get('/espace-etudiant/dashboard')
      dashboardData.value = data
    } catch {}
  }
}, { immediate: true })

const roleLabel: Record<string, string> = {
  dg: 'Directeur Général',
  dir_peda: 'Directeur des études',
  resp_fin: 'Resp. Financier',
  coordinateur: 'Directeur adjoint des études',
  secretariat: 'Secrétariat',
  enseignant: 'Enseignant',
  etudiant: 'Étudiant',
}

// ── Session timeout 30 min ──────────────────────────────────────────
const TIMEOUT_MS = 30 * 60 * 1000
const WARNING_MS = 25 * 60 * 1000
const showSessionWarning = ref(false)
let idleTimer: ReturnType<typeof setTimeout> | null = null
let warningTimer: ReturnType<typeof setTimeout> | null = null

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  if (warningTimer) clearTimeout(warningTimer)
  showSessionWarning.value = false
  warningTimer = setTimeout(() => { showSessionWarning.value = true }, WARNING_MS)
  idleTimer = setTimeout(async () => {
    await auth.logout()
    router.push('/login')
  }, TIMEOUT_MS)
}

const IDLE_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']

onMounted(() => {
  IDLE_EVENTS.forEach(e => window.addEventListener(e, resetIdleTimer, { passive: true }))
  resetIdleTimer()
})

onUnmounted(() => {
  IDLE_EVENTS.forEach(e => window.removeEventListener(e, resetIdleTimer))
  if (idleTimer) clearTimeout(idleTimer)
  if (warningTimer) clearTimeout(warningTimer)
})

// ── Navigation sections ─────────────────────────────────────────────
interface NavItem {
  path: string
  label: string
  icon: string
  roles: string[]
}

interface NavSection {
  label: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    label: 'Principal',
    items: [
      {
        path: '/dashboard',
        label: 'Tableau de bord',
        icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
        roles: ['dg', 'dir_peda', 'resp_fin', 'coordinateur', 'secretariat', 'enseignant'],
      },
      {
        path: '/rapports',
        label: 'Rapports',
        icon: 'M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
        roles: ['dg', 'resp_fin', 'dir_peda'],
      },
    ],
  },
  {
    label: 'Pédagogie',
    items: [
      {
        path: '/etudiants',
        label: 'Étudiants',
        icon: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z',
        roles: ['dg', 'dir_peda', 'resp_fin', 'coordinateur', 'secretariat'],
      },
      {
        path: '/classes',
        label: 'Classes',
        icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
        roles: ['dg', 'dir_peda', 'coordinateur'],
      },
      {
        path: '/emplois-du-temps',
        label: 'Emplois du temps',
        icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
        roles: ['dg', 'dir_peda', 'coordinateur', 'secretariat', 'enseignant'],
      },
      {
        path: '/emargement',
        label: 'Émargement',
        icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
        roles: ['enseignant'],
      },
      {
        path: '/absences',
        label: 'Absences',
        icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636',
        roles: ['dg', 'dir_peda', 'coordinateur', 'secretariat', 'resp_fin'],
      },
      {
        path: '/notes-bulletins',
        label: 'Notes & Bulletins',
        icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
        roles: ['dg', 'dir_peda', 'coordinateur', 'enseignant'],
      },
      {
        path: '/enseignants',
        label: 'Enseignants',
        icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
        roles: ['dg', 'dir_peda', 'coordinateur', 'secretariat'],
      },
    ],
  },
  {
    label: 'Finances',
    items: [
      {
        path: '/finance',
        label: 'Tableau financier',
        icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
        roles: ['dg', 'resp_fin'],
      },
      {
        path: '/paiements',
        label: 'Paiements',
        icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
        roles: ['dg', 'resp_fin', 'secretariat'],
      },
      {
        path: '/depenses',
        label: 'Dépenses',
        icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z',
        roles: ['dg', 'resp_fin'],
      },
      {
        path: '/autres-recettes',
        label: 'Autres recettes',
        icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
        roles: ['dg', 'resp_fin', 'secretariat'],
      },
      {
        path: '/exonerations',
        label: 'Exonérations',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
        roles: ['dg', 'resp_fin', 'secretariat'],
      },
    ],
  },
  {
    label: 'Communication',
    items: [
      {
        path: '/communication',
        label: 'Communication',
        icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
        roles: ['dg', 'dir_peda', 'coordinateur', 'secretariat'],
      },
    ],
  },
  {
    label: 'Équipe',
    items: [
      {
        path: '/mon-equipe',
        label: 'Mon équipe',
        icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
        roles: ['dg'],
      },
      {
        path: '/taches',
        label: 'Tâches & productivité',
        icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
        roles: ['dg', 'dir_peda', 'resp_fin', 'coordinateur', 'secretariat'],
      },
      {
        path: '/demandes-absence',
        label: "Demandes d'absence",
        icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
        roles: ['dg', 'dir_peda', 'resp_fin', 'coordinateur', 'secretariat'],
      },
    ],
  },
  {
    label: 'Mon espace',
    items: [
      {
        path: '/espace-etudiant',
        label: 'Mon tableau de bord',
        icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
        roles: ['etudiant'],
      },
      {
        path: '/emplois-du-temps',
        label: 'Mon emploi du temps',
        icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
        roles: ['etudiant'],
      },
      {
        path: '/espace-etudiant#notes',
        label: 'Mes notes',
        icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
        roles: ['etudiant'],
      },
      {
        path: '/espace-etudiant#assiduite',
        label: 'Assiduité',
        icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
        roles: ['etudiant'],
      },
      {
        path: '/espace-etudiant#finances',
        label: 'Mes paiements',
        icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
        roles: ['etudiant'],
      },
      {
        path: '/espace-etudiant#messages',
        label: 'Messages',
        icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
        roles: ['etudiant'],
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        path: '/journal-activite',
        label: 'Journal d\'activité',
        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
        roles: ['dg'],
      },
      {
        path: '/parametres',
        label: 'Paramètres',
        icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
        roles: ['dg'],
      },
      {
        path: '/audit-logs',
        label: 'Journal d\'audit',
        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
        roles: ['dg'],
      },
      {
        path: '/backups',
        label: 'Sauvegardes',
        icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
        roles: ['dg'],
      },
    ],
  },
]

// DB permissions (loaded on mount, used to filter nav)
const dbNavPerms = ref<Record<string, boolean>>({}) // { '/dashboard': true, ... }

onMounted(async () => {
  if (!auth.user) return
  try {
    const { data } = await api.get('/role-permissions')
    const map: Record<string, boolean> = {}
    if (auth.user.role === 'dg') {
      // full matrix returned: [{role, page_path, has_access}]
      for (const p of data) {
        if (p.role === 'dg') map[p.page_path] = p.has_access
      }
    } else {
      // only current role: [{page_path, has_access}]
      for (const p of data) map[p.page_path] = p.has_access
    }
    dbNavPerms.value = map
  } catch (_) {}
})

const visibleSections = computed(() =>
  navSections
    .map(s => ({
      ...s,
      items: s.items.filter(i => {
        const userRole = auth.user?.role
        if (!userRole) return false
        const basePath = i.path.split('#')[0] ?? i.path
        // La DB fait autorité quand elle a une entrée pour ce chemin : elle peut
        // à la fois AUTORISER un rôle absent du tableau codé en dur, ou en
        // INTERDIRE un qui y figurait. C'est ce que l'admin configure via
        // /users → onglet Permissions.
        if (basePath in dbNavPerms.value) {
          return dbNavPerms.value[basePath] === true
        }
        // Fallback : la DB n'a pas encore été chargée (ou pas d'entrée pour ce
        // path, typiquement avant le 1er seed) → on utilise les défauts codés.
        return i.roles.includes(userRole)
      }),
    }))
    .filter(s => s.items.length > 0),
)

function isActive(path: string) {
  const basePath = path.split('#')[0] ?? path
  return route.path === basePath || (basePath !== '/dashboard' && route.path.startsWith(basePath))
}

// Navigation avec gestion des ancres (#section) pour l'espace étudiant
function handleNavClick(e: Event, path: string) {
  const hashIdx = path.indexOf('#')
  if (hashIdx === -1) {
    e.preventDefault()
    sidebarOpen.value = false
    router.push(path)
    return
  }
  e.preventDefault()
  const basePath = path.substring(0, hashIdx)
  const anchor = path.substring(hashIdx + 1)
  sidebarOpen.value = false

  // Mobile : émettre un événement custom pour que EspaceEtudiantView change d'onglet
  const tabMap: Record<string, string> = {
    planning: 'planning', notes: 'notes', finances: 'finances',
    assiduite: 'plus', messages: 'plus', documents: 'plus'
  }
  if (tabMap[anchor]) {
    window.dispatchEvent(new CustomEvent('espace-etudiant-tab', { detail: { tab: tabMap[anchor], activeTab: anchor === 'assiduite' || anchor === 'messages' || anchor === 'documents' ? null : anchor } }))
  }

  const doScroll = () => {
    const el = document.getElementById(anchor)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (route.path !== basePath) {
    router.push(basePath).then(() => setTimeout(doScroll, 350))
  } else {
    doScroll()
  }
}

async function logout() {
  await auth.logout()
}

// ── Page title ──────────────────────────────────────────────────────
const pageTitleMap: Record<string, string> = {
  '/dashboard': 'Tableau de bord',
  '/etudiants': 'Étudiants',
  '/filieres': 'Filières',
  '/parcours': 'Parcours',
  '/classes': 'Classes',
  '/finance': 'Tableau financier',
  '/paiements': 'Recettes',
  '/depenses': 'Dépenses',
  '/autres-recettes': 'Autres recettes',
  '/exonerations': 'Exonérations',
  '/caisse': 'Journal de caisse',
  '/formations-individuelles': 'Formations individuelles',
  '/emplois-du-temps': 'Emplois du temps',
  '/emargement': 'Émargement',
  '/suivi-emargements': 'Suivi Émargements',
  '/cahier-de-textes': 'Cahier de textes',
  '/absences': 'Suivi des absences',
  '/notes-bulletins': 'Notes & Bulletins',
  '/rapports': 'Rapports',
  '/rapports-ministere': 'Rapports Ministère',
  '/notifications': 'Notifications',
  '/communication': 'Communication',
  '/enseignants': 'Enseignants',
  '/annees-academiques': 'Années académiques',
  '/tarifs': 'Tarifs',
  '/users': 'Utilisateurs',
  '/taches': 'Tâches & productivité',
  '/mon-equipe': 'Mon équipe',
  '/demandes-absence': "Demandes d'absence",
  '/journal-activite': 'Journal d\'activité',
  '/parametres': 'Paramètres',
  '/audit-logs': 'Journal d\'audit',
  '/backups': 'Sauvegardes',
  '/securite': 'Sécurité de mon compte',
}

const pageTitle = computed(() => {
  for (const [path, title] of Object.entries(pageTitleMap)) {
    if (route.path === path || (path !== '/dashboard' && route.path.startsWith(path))) {
      return title
    }
  }
  return 'UPTECH Campus'
})

const todayStr = computed(() => {
  return new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
})

const userInitials = computed(() => {
  const p = auth.user?.prenom?.[0] ?? ''
  const n = auth.user?.nom?.[0] ?? ''
  return (p + n).toUpperCase()
})

// ── Notifications in-app ────────────────────────────────────────────
const userNotifs = ref<any[]>([])
const unreadCount = ref(0)
const showNotifPanel = ref(false)
let notifPollTimer: ReturnType<typeof setInterval> | null = null

async function fetchNotifs() {
  if (!auth.isAuthenticated) return
  try {
    const { data } = await api.get('/user-notifications')
    userNotifs.value = data.notifications ?? []
    unreadCount.value = data.unread ?? 0
  } catch { /* silencieux */ }
}

async function markAllRead() {
  try {
    await api.post('/user-notifications/read-all')
    userNotifs.value = userNotifs.value.map(n => ({ ...n, lu: true }))
    unreadCount.value = 0
  } catch { /* silencieux */ }
}

async function markOneRead(id: number) {
  const notif = userNotifs.value.find(n => n.id === id)
  try {
    if (notif && !notif.lu) {
      await api.post(`/user-notifications/${id}/read`)
      notif.lu = true
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    }
  } catch { /* silencieux */ }
  // Redirection si la notif embarque un lien dans data.link (cas absence,
  // paiement, tâche, etc.) — ferme le panneau et navigue.
  const link = notif?.data?.link
  if (link) {
    showNotifPanel.value = false
    router.push(link)
  }
}

function toggleNotifPanel() {
  showNotifPanel.value = !showNotifPanel.value
}

function notifTimeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'à l\'instant'
  if (mins < 60) return `il y a ${mins} min`
  const h = Math.floor(mins / 60)
  if (h < 24) return `il y a ${h}h`
  const d = Math.floor(h / 24)
  return `il y a ${d}j`
}

const notifIconMap: Record<string, string> = {
  paiement: '✅', note: '📊', echeance: '⏰', info: 'ℹ️',
}

onMounted(() => {
  fetchNotifs()
  notifPollTimer = setInterval(fetchNotifs, 30000)
})
onUnmounted(() => {
  if (notifPollTimer) clearInterval(notifPollTimer)
})
</script>

<template>
  <div style="display:flex; min-height:100vh;">

    <!-- ══════════════ OVERLAY MOBILE ══════════════ -->
    <div v-if="sidebarOpen" class="uc-sidebar-overlay" @click="sidebarOpen = false"></div>

    <!-- ══════════════ SIDEBAR ══════════════ -->
    <aside class="uc-sidebar" :class="{ 'uc-sidebar-open': sidebarOpen }">

      <!-- Logo -->
      <div class="uc-sidebar-logo">
        <img src="https://uptechformation.com/wp-content/uploads/2024/02/logo-blanc.png" alt="UPTECH" />
        <span>Campus v1.0</span>
      </div>

      <!-- Navigation sections -->
      <div v-for="section in visibleSections" :key="section.label" class="uc-nav-section">
        <div class="uc-nav-section-label">{{ section.label }}</div>
        <a
          v-for="item in section.items"
          :key="item.path"
          :href="item.path"
          class="uc-nav-item"
          :class="{ active: isActive(item.path) }"
          @click="handleNavClick($event, item.path)"
        >
          <svg class="uc-nav-ico" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.icon" />
          </svg>
          {{ item.label }}
        </a>
      </div>

      <!-- Footer utilisateur -->
      <div class="uc-sidebar-footer">
        <div class="uc-user-card">
          <div class="uc-user-avatar">{{ userInitials }}</div>
          <div class="uc-user-info">
            <strong>{{ auth.fullName }}</strong>
            <span>{{ auth.user?.role ? roleLabel[auth.user.role] : '' }}</span>
          </div>
          <button class="uc-logout-btn" title="Sécurité (2FA)" @click="router.push('/securite')" style="margin-right:4px;">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
          <button class="uc-logout-btn" title="Se déconnecter" @click="logout">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- ══════════════ MAIN ══════════════ -->
    <div class="uc-main">

      <!-- Topbar -->
      <div class="uc-topbar">
        <!-- Hamburger (mobile seulement) -->
        <button class="uc-hamburger" @click="sidebarOpen = !sidebarOpen" aria-label="Menu">
          <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
              :d="sidebarOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'" />
          </svg>
        </button>
        <h1 class="uc-topbar-title">
          {{ pageTitle }}
          <span class="uc-topbar-breadcrumb">/ {{ auth.user?.role ? roleLabel[auth.user.role] : '' }}</span>
        </h1>
        <div class="uc-topbar-right">
          <span class="uc-topbar-date">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="display:inline;vertical-align:-1px;opacity:0.6;margin-right:4px;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>{{ todayStr }}
          </span>
          <!-- Cloche notifications -->
          <div style="position:relative;">
            <button class="uc-notif-btn" :class="{ 'uc-notif-btn--active': showNotifPanel }" title="Notifications" @click="toggleNotifPanel">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span v-if="unreadCount > 0" class="uc-notif-badge">{{ unreadCount > 9 ? '9+' : unreadCount }}</span>
              <span v-else class="uc-notif-dot"></span>
            </button>

            <!-- Overlay transparent pour fermer au clic extérieur -->
            <div v-if="showNotifPanel" class="uc-notif-overlay" @click="showNotifPanel = false"></div>

            <!-- Dropdown panel -->
            <Transition name="notif-drop">
              <div v-if="showNotifPanel" class="uc-notif-panel">
                <div class="uc-notif-panel-head">
                  <span>Notifications</span>
                  <button v-if="unreadCount > 0" class="uc-notif-read-all" @click="markAllRead">Tout marquer lu</button>
                </div>
                <div class="uc-notif-list">
                  <div v-if="userNotifs.length === 0" class="uc-notif-empty">
                    <svg width="32" height="32" fill="none" stroke="#d1d5db" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
                    <p>Aucune notification</p>
                  </div>
                  <div
                    v-for="notif in userNotifs"
                    :key="notif.id"
                    class="uc-notif-item"
                    :class="{ 'uc-notif-item--unread': !notif.lu }"
                    @click="markOneRead(notif.id)"
                  >
                    <span class="uc-notif-ico">{{ notifIconMap[notif.type] ?? 'ℹ️' }}</span>
                    <div class="uc-notif-content">
                      <p class="uc-notif-titre">{{ notif.titre }}</p>
                      <p class="uc-notif-msg">{{ notif.message }}</p>
                      <span class="uc-notif-time">{{ notifTimeAgo(notif.created_at) }}</span>
                    </div>
                    <span v-if="!notif.lu" class="uc-notif-unread-dot"></span>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
          <div class="uc-topbar-sep"></div>
          <div class="uc-topbar-user">
            <div class="uc-topbar-user-avatar">{{ userInitials }}</div>
            <span class="uc-topbar-user-name">{{ auth.fullName }}</span>
          </div>
        </div>
      </div>

      <!-- Contenu de la vue -->
      <main style="flex:1; overflow:auto;">
        <RouterView />
      </main>
    </div>

  </div>

  <!-- ── Avertissement session expirante ── -->
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="showSessionWarning" class="uc-modal-overlay" style="z-index:500;">
        <div class="uc-modal-box" style="max-width:400px;">
          <div class="uc-modal-header">
            <div style="display:flex;align-items:center;gap:11px;">
              <div style="width:38px;height:38px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <svg width="18" height="18" fill="none" stroke="#f97316" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 class="uc-modal-title">Session sur le point d'expirer</h3>
                <p class="uc-modal-subtitle">Inactivité détectée</p>
              </div>
            </div>
          </div>
          <div class="uc-modal-body">
            <p style="font-size:13px;color:var(--ink-600);line-height:1.65;">
              Votre session va expirer dans <strong style="color:var(--ink-900);">5 minutes</strong> en raison d'inactivité.
              Cliquez sur le bouton ci-dessous pour rester connecté.
            </p>
          </div>
          <div class="uc-modal-footer">
            <button class="uc-btn uc-btn-primary" style="width:100%;justify-content:center;" @click="resetIdleTimer">
              <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Rester connecté
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
