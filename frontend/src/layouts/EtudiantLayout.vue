<script setup lang="ts">
import { ref, computed, provide, onMounted } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const dashboardData = ref<any>(null)
const loadingDashboard = ref(true)

provide('dashboardData', dashboardData)

onMounted(async () => {
  try {
    const { data } = await api.get('/espace-etudiant/dashboard')
    dashboardData.value = data
  } catch {
    // Si erreur (ex: pas d'inscription active), on laisse dashboardData null
  } finally {
    loadingDashboard.value = false
  }
})

const initials = computed(() => {
  const u = auth.user
  if (!u) return '?'
  return `${u.prenom?.[0] ?? ''}${u.nom?.[0] ?? ''}`.toUpperCase()
})

const nbNonLus = computed(() => {
  if (!dashboardData.value?.messages) return 0
  return dashboardData.value.messages.reduce((sum: number, m: any) => sum + (m.nb_non_lus ?? 0), 0)
})

const navLinks = [
  {
    label: 'Accueil', short: 'Accueil', href: '/espace-etudiant', exact: true,
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  },
  {
    label: 'Notes', short: 'Notes', href: '/espace-etudiant#notes',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  },
  {
    label: 'Emploi du temps', short: 'Planning', href: '/espace-etudiant#planning',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    label: 'Paiements', short: 'Paiements', href: '/espace-etudiant#finances',
    icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z',
  },
  {
    label: 'Documents', short: 'Docs', href: '/espace-etudiant#documents',
    icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  },
  {
    label: 'Messages', short: 'Messages', href: '/espace-etudiant#messages',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
]

function isActive(href: string, exact: boolean = false) {
  const base = href.split('#')[0] ?? ''
  if (exact) return route.path === base
  return route.path.startsWith(base)
}

async function logout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="el-shell">

    <!-- ── Topbar ── -->
    <header class="el-topbar">
      <div class="el-topbar-inner">

        <!-- Logo -->
        <div class="el-logo">
          <div class="el-logo-icon">
            <svg style="width:18px;height:18px;color:#fff;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0112 20.055a11.952 11.952 0 01-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
            </svg>
          </div>
          <span class="el-logo-name">Uptech Campus</span>
        </div>

        <!-- Navigation pills — desktop only -->
        <nav class="el-nav">
          <a v-for="link in navLinks" :key="link.href" :href="link.href" class="el-nav-link"
            :class="isActive(link.href, link.exact) ? 'el-nav-link--active' : ''">
            {{ link.label }}
          </a>
        </nav>

        <!-- Right -->
        <div class="el-topbar-right">
          <button class="el-notif-btn">
            <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span v-if="nbNonLus > 0" class="el-notif-badge">{{ nbNonLus > 9 ? '9+' : nbNonLus }}</span>
          </button>

          <div class="el-user">
            <div class="el-avatar">{{ initials }}</div>
            <span class="el-user-name">{{ auth.user?.prenom }} {{ auth.user?.nom }}</span>
          </div>

          <button @click="logout" class="el-logout-btn" title="Se déconnecter">
            <svg style="width:16px;height:16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Contenu -->
    <main class="el-main">
      <div v-if="loadingDashboard" class="el-loading">Chargement…</div>
      <RouterView v-else />
    </main>

    <!-- ── Bottom nav — mobile uniquement ── -->
    <nav class="el-bottom-nav">
      <a v-for="link in navLinks" :key="link.href" :href="link.href" class="el-bottom-link"
        :class="isActive(link.href, link.exact) ? 'el-bottom-link--active' : ''">
        <svg class="el-bottom-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="link.icon" />
        </svg>
        <span class="el-bottom-label">{{ link.short }}</span>
        <span v-if="link.short === 'Messages' && nbNonLus > 0" class="el-bottom-badge">{{ nbNonLus }}</span>
      </a>
    </nav>

  </div>
</template>

<style scoped>
.el-shell { display:flex; flex-direction:column; min-height:100vh; min-height:100dvh; background:#f1f5f9; }

/* Topbar */
.el-topbar { background:#111827; flex-shrink:0; position:sticky; top:0; z-index:50; }
.el-topbar-inner { max-width:1280px; margin:0 auto; padding:0 16px; height:60px; display:flex; align-items:center; gap:16px; }

/* Logo */
.el-logo { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.el-logo-icon { width:32px; height:32px; background:#dc2626; border-radius:8px; display:flex; align-items:center; justify-content:center; }
.el-logo-name { font-size:13px; font-weight:700; color:#fff; white-space:nowrap; }

/* Desktop nav */
.el-nav { flex:1; display:flex; align-items:center; gap:2px; background:rgba(255,255,255,0.08); border-radius:10px; padding:4px; overflow-x:auto; scrollbar-width:none; -webkit-overflow-scrolling:touch; }
.el-nav::-webkit-scrollbar { display:none; }
.el-nav-link { padding:6px 12px; border-radius:7px; font-size:12.5px; font-weight:500; color:rgba(255,255,255,0.6); text-decoration:none; white-space:nowrap; transition:background 0.15s,color 0.15s; flex-shrink:0; }
.el-nav-link:hover { background:rgba(255,255,255,0.1); color:#fff; }
.el-nav-link--active { background:#fff; color:#111827; font-weight:600; }

/* Right */
.el-topbar-right { display:flex; align-items:center; gap:8px; flex-shrink:0; }
.el-notif-btn { position:relative; padding:8px; background:rgba(255,255,255,0.08); border:none; border-radius:8px; color:rgba(255,255,255,0.6); cursor:pointer; display:flex; align-items:center; transition:background 0.15s; }
.el-notif-btn:hover { background:rgba(255,255,255,0.14); color:#fff; }
.el-notif-badge { position:absolute; top:4px; right:4px; width:16px; height:16px; background:#dc2626; border-radius:50%; border:2px solid #111827; font-size:9px; font-weight:700; color:#fff; display:flex; align-items:center; justify-content:center; }
.el-user { display:flex; align-items:center; gap:8px; padding:4px 10px 4px 4px; background:rgba(255,255,255,0.08); border-radius:24px; }
.el-avatar { width:28px; height:28px; background:linear-gradient(135deg,#dc2626,#ef4444); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px; font-weight:700; color:#fff; }
.el-user-name { font-size:12px; font-weight:600; color:rgba(255,255,255,0.8); white-space:nowrap; }
.el-logout-btn { padding:8px; background:none; border:none; color:rgba(255,255,255,0.4); cursor:pointer; border-radius:8px; display:flex; align-items:center; transition:color 0.15s,background 0.15s; }
.el-logout-btn:hover { color:#ef4444; background:rgba(239,68,68,0.1); }

/* Main */
.el-main { flex:1; overflow:auto; }
.el-loading { display:flex; align-items:center; justify-content:center; height:200px; color:#9ca3af; font-size:13px; }

/* Bottom nav */
.el-bottom-nav { display:none; position:fixed; bottom:0; left:0; right:0; background:#111827; border-top:1px solid rgba(255,255,255,0.08); z-index:50; padding-bottom:env(safe-area-inset-bottom); }
.el-bottom-link { position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; padding:8px 4px 6px; flex:1; text-decoration:none; color:rgba(255,255,255,0.45); font-size:10px; font-weight:500; transition:color 0.15s; min-height:52px; }
.el-bottom-link--active { color:#fff; }
.el-bottom-link--active .el-bottom-icon { color:#ef4444; }
.el-bottom-icon { width:20px; height:20px; flex-shrink:0; }
.el-bottom-label { font-size:9.5px; line-height:1; white-space:nowrap; }
.el-bottom-badge { position:absolute; top:6px; right:calc(50% - 16px); min-width:16px; height:16px; background:#dc2626; border-radius:8px; border:2px solid #111827; font-size:9px; font-weight:700; color:#fff; display:flex; align-items:center; justify-content:center; padding:0 3px; }

/* Responsive */
@media (max-width: 768px) {
  .el-topbar-inner { height:52px; gap:10px; }
  .el-nav { display:none; }
  .el-user-name { display:none; }
  .el-bottom-nav { display:flex; }
  .el-main { padding-bottom:calc(52px + env(safe-area-inset-bottom)); }
}
@media (max-width: 480px) {
  .el-logo-name { display:none; }
  .el-topbar-inner { padding:0 12px; }
}
</style>
