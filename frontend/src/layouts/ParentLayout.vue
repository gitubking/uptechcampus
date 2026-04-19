<script setup lang="ts">
import { ref, computed, provide, onMounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'

const auth = useAuthStore()
const router = useRouter()
const dashboardData = ref<any>(null)
const loadingDashboard = ref(true)

provide('parentDashboard', dashboardData)

onMounted(async () => {
  try {
    const { data } = await api.get('/espace-parent/dashboard')
    dashboardData.value = data
  } catch { dashboardData.value = null }
  finally { loadingDashboard.value = false }
})

const initials = computed(() => {
  const u = auth.user
  return `${u?.prenom?.[0] ?? ''}${u?.nom?.[0] ?? ''}`.toUpperCase()
})

async function logout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-slate-50 flex flex-col">
    <!-- Topbar -->
    <header class="bg-indigo-900 flex-shrink-0 shadow-md">
      <div class="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
            <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <div class="font-bold text-white text-sm">Espace Parent</div>
            <div class="text-indigo-300 text-xs">Uptech Campus</div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center">
            <span class="text-xs font-bold text-white">{{ initials }}</span>
          </div>
          <span class="text-sm text-indigo-200 hidden sm:inline">{{ auth.user?.prenom }} {{ auth.user?.nom }}</span>
          <button @click="logout" title="Se déconnecter" class="p-2 text-indigo-300 hover:text-red-400 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </header>
    <main class="flex-1">
      <div v-if="loadingDashboard" class="flex items-center justify-center h-64">
        <div class="text-gray-400 text-sm">Chargement…</div>
      </div>
      <RouterView v-else />
    </main>
  </div>
</template>
