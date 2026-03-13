<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const step = computed(() => {
  if (!auth.user?.cgu_acceptees) return 'cgu'
  if (auth.user?.premier_connexion) return 'password'
  return 'done'
})

// --- CGU ---
const cguAccepted = ref(false)
const cguLoading = ref(false)

async function acceptCgu() {
  cguLoading.value = true
  try {
    await auth.acceptCgu()
    if (step.value === 'done') router.push('/dashboard')
  } finally {
    cguLoading.value = false
  }
}

// --- Changement de mot de passe ---
const ancienPassword = ref('')
const nouveauPassword = ref('')
const confirmPassword = ref('')
const passwordLoading = ref(false)
const passwordError = ref('')

async function changePassword() {
  passwordError.value = ''
  if (nouveauPassword.value !== confirmPassword.value) {
    passwordError.value = 'Les mots de passe ne correspondent pas.'
    return
  }
  passwordLoading.value = true
  try {
    await auth.changePassword(ancienPassword.value, nouveauPassword.value, confirmPassword.value)
    router.push('/dashboard')
  } catch (err: any) {
    passwordError.value = err.response?.data?.message ?? 'Une erreur est survenue.'
  } finally {
    passwordLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-gradient-to-br from-indigo-50 to-blue-100 flex items-center justify-center p-4">
    <div class="w-full max-w-md">

      <!-- Branding -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-16 h-16 bg-indigo-600 rounded-2xl mb-4 shadow-lg">
          <svg class="w-9 h-9 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
          </svg>
        </div>
        <h1 class="text-2xl font-bold text-gray-900">Uptech Campus</h1>
        <p class="text-gray-500 text-sm mt-1">Configuration initiale du compte</p>
      </div>

      <!-- Étape CGU -->
      <div v-if="step === 'cgu'" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex items-center gap-3 mb-5">
          <div class="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-semibold text-gray-800">Conditions d'utilisation</h2>
            <p class="text-xs text-gray-500">Étape 1 sur {{ auth.user?.premier_connexion ? 2 : 1 }}</p>
          </div>
        </div>

        <div class="h-48 overflow-y-auto bg-gray-50 rounded-lg border border-gray-200 p-4 text-sm text-gray-600 leading-relaxed mb-5">
          <p class="font-semibold text-gray-800 mb-3">Conditions Générales d'Utilisation — Uptech Campus</p>
          <p class="mb-3">En accédant à cette plateforme, vous vous engagez à :</p>
          <ul class="list-disc list-inside space-y-1.5 mb-3">
            <li>Utiliser vos accès uniquement dans le cadre de vos fonctions professionnelles</li>
            <li>Garantir la confidentialité des données personnelles des étudiants</li>
            <li>Ne pas divulguer vos identifiants de connexion à des tiers</li>
            <li>Signaler immédiatement tout incident de sécurité à l'administration</li>
            <li>Respecter la réglementation en vigueur sur la protection des données (RGPD)</li>
            <li>Ne pas exporter ou diffuser les données sans autorisation explicite</li>
          </ul>
          <p>Toute violation de ces conditions peut entraîner la suspension immédiate de votre compte et des poursuites disciplinaires.</p>
        </div>

        <label class="flex items-start gap-3 mb-6 cursor-pointer select-none">
          <input v-model="cguAccepted" type="checkbox" class="mt-0.5 w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500" />
          <span class="text-sm text-gray-700">J'ai lu et j'accepte les conditions générales d'utilisation</span>
        </label>

        <button
          :disabled="!cguAccepted || cguLoading"
          @click="acceptCgu"
          class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition"
        >
          {{ cguLoading ? 'Enregistrement…' : 'Accepter et continuer' }}
        </button>
      </div>

      <!-- Étape changement de mot de passe -->
      <div v-else-if="step === 'password'" class="bg-white rounded-2xl shadow-xl p-8">
        <div class="flex items-center gap-3 mb-5">
          <div class="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h2 class="text-lg font-semibold text-gray-800">Nouveau mot de passe</h2>
            <p class="text-xs text-gray-500">Définissez un mot de passe sécurisé pour votre compte</p>
          </div>
        </div>

        <div v-if="passwordError" class="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p class="text-sm text-red-700">{{ passwordError }}</p>
        </div>

        <form @submit.prevent="changePassword" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1.5">Mot de passe temporaire</label>
            <input
              v-model="ancienPassword"
              type="password"
              required
              autocomplete="current-password"
              class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1.5">Nouveau mot de passe</label>
            <input
              v-model="nouveauPassword"
              type="password"
              required
              minlength="8"
              autocomplete="new-password"
              class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
            <p class="text-xs text-gray-400 mt-1">Minimum 8 caractères</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1.5">Confirmer le mot de passe</label>
            <input
              v-model="confirmPassword"
              type="password"
              required
              minlength="8"
              autocomplete="new-password"
              class="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            :disabled="passwordLoading"
            class="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg text-sm transition mt-2"
          >
            {{ passwordLoading ? 'Enregistrement…' : 'Enregistrer et accéder à la plateforme' }}
          </button>
        </form>
      </div>

    </div>
  </div>
</template>
