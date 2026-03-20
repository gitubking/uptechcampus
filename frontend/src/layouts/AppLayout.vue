<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { RouterView, RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

// ── Mobile sidebar toggle ──────────────────────────────────────────
const sidebarOpen = ref(false)
watch(() => route.path, () => { sidebarOpen.value = false })

const roleLabel: Record<string, string> = {
  dg: 'Directeur Général',
  dir_peda: 'Directeur Pédagogique',
  resp_fin: 'Resp. Financier',
  coordinateur: 'Coordinateur',
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
        path: '/filieres',
        label: 'Filières',
        icon: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
        roles: ['dg', 'dir_peda'],
      },
      {
        path: '/parcours',
        label: 'Parcours',
        icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
        roles: ['dg', 'dir_peda'],
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
        roles: ['dg', 'dir_peda', 'coordinateur', 'secretariat', 'enseignant'],
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
        label: 'Recettes',
        icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
        roles: ['dg', 'resp_fin', 'secretariat'],
      },
      {
        path: '/depenses',
        label: 'Dépenses',
        icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z',
        roles: ['dg', 'resp_fin'],
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
    label: 'Administration',
    items: [
      {
        path: '/annees-academiques',
        label: 'Années acad.',
        icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
        roles: ['dg'],
      },
      {
        path: '/tarifs',
        label: 'Tarifs',
        icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z',
        roles: ['dg'],
      },
      {
        path: '/users',
        label: 'Utilisateurs',
        icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
        roles: ['dg'],
      },
      {
        path: '/parametres',
        label: 'Paramètres',
        icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
        roles: ['dg'],
      },
    ],
  },
]

const visibleSections = computed(() =>
  navSections
    .map(s => ({
      ...s,
      items: s.items.filter(i => auth.user?.role && i.roles.includes(auth.user.role)),
    }))
    .filter(s => s.items.length > 0),
)

function isActive(path: string) {
  return route.path === path || (path !== '/dashboard' && route.path.startsWith(path))
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
  '/emplois-du-temps': 'Emplois du temps',
  '/emargement': 'Émargement',
  '/notes-bulletins': 'Notes & Bulletins',
  '/rapports': 'Rapports',
  '/communication': 'Communication',
  '/enseignants': 'Enseignants',
  '/annees-academiques': 'Années académiques',
  '/tarifs': 'Tarifs',
  '/users': 'Utilisateurs',
  '/parametres': 'Paramètres',
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
        <RouterLink
          v-for="item in section.items"
          :key="item.path"
          :to="item.path"
          class="uc-nav-item"
          :class="{ active: isActive(item.path) }"
        >
          <svg class="uc-nav-ico" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="item.icon" />
          </svg>
          {{ item.label }}
        </RouterLink>
      </div>

      <!-- Footer utilisateur -->
      <div class="uc-sidebar-footer">
        <div class="uc-user-card">
          <div class="uc-user-avatar">{{ userInitials }}</div>
          <div class="uc-user-info">
            <strong>{{ auth.fullName }}</strong>
            <span>{{ auth.user?.role ? roleLabel[auth.user.role] : '' }}</span>
          </div>
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
          <button class="uc-notif-btn" title="Notifications">
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span class="uc-notif-dot"></span>
          </button>
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
