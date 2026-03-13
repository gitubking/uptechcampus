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
  { label: 'Accueil', href: '/espace-etudiant', exact: true },
  { label: 'Notes', href: '/espace-etudiant#notes' },
  { label: 'Emploi du temps', href: '/espace-etudiant#planning' },
  { label: 'Paiements', href: '/espace-etudiant#finances' },
  { label: 'Documents', href: '/espace-etudiant#documents' },
  { label: 'Messages', href: '/espace-etudiant#messages' },
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
  <div class="min-h-screen bg-gray-50 flex flex-col">

    <!-- Topbar dark -->
    <header class="bg-gray-900 flex-shrink-0">
      <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">

        <!-- Logo -->
        <div class="flex items-center gap-2 flex-shrink-0">
          <div class="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
            </svg>
          </div>
          <span class="font-bold text-white text-sm">Uptech Campus</span>
        </div>

        <!-- Navigation pills -->
        <nav class="flex items-center bg-white/10 rounded-xl p-1 gap-0.5">
          <a
            v-for="link in navLinks"
            :key="link.href"
            :href="link.href"
            class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            :class="isActive(link.href, link.exact)
              ? 'bg-white text-gray-900'
              : 'text-gray-300 hover:text-white hover:bg-white/10'"
          >
            {{ link.label }}
          </a>
        </nav>

        <!-- Right: notifications + avatar -->
        <div class="flex items-center gap-3">
          <!-- Cloche -->
          <button class="relative p-2 text-gray-400 hover:text-white transition">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <span v-if="nbNonLus > 0"
              class="absolute top-1 right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[9px] font-bold flex items-center justify-center">
              {{ nbNonLus > 9 ? '9+' : nbNonLus }}
            </span>
          </button>

          <!-- Avatar étudiant -->
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center">
              <span class="text-xs font-bold text-white">{{ initials }}</span>
            </div>
            <span class="text-sm text-gray-300">
              {{ auth.user?.prenom }} {{ auth.user?.nom }}
            </span>
          </div>

          <!-- Déconnexion -->
          <button
            @click="logout"
            title="Se déconnecter"
            class="p-2 text-gray-400 hover:text-red-400 transition"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- Contenu -->
    <main class="flex-1">
      <div v-if="loadingDashboard" class="flex items-center justify-center h-64">
        <div class="text-gray-500">Chargement…</div>
      </div>
      <RouterView v-else />
    </main>

  </div>
</template>
