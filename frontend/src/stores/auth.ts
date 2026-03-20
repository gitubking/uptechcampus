import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api'

export interface User {
  id: number
  nom: string
  prenom: string
  email: string
  role: 'dg' | 'dir_peda' | 'resp_fin' | 'coordinateur' | 'secretariat' | 'enseignant' | 'etudiant'
  photo_path: string | null
  premier_connexion: boolean
  cgu_acceptees: boolean
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const token = ref<string | null>(localStorage.getItem('token'))

  const isAuthenticated = computed(() => !!token.value)
  const fullName = computed(() =>
    user.value ? `${user.value.prenom} ${user.value.nom}` : '',
  )
  const needsSetup = computed(
    () => !!user.value && (user.value.premier_connexion || !user.value.cgu_acceptees),
  )

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password })
    token.value = data.token
    user.value = data.user
    localStorage.setItem('token', data.token)
  }

  async function fetchMe() {
    const { data } = await api.get('/auth/me')
    user.value = data
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
    } finally {
      clear()
    }
  }

  async function acceptCgu() {
    await api.post('/auth/accept-cgu')
    if (user.value) user.value.cgu_acceptees = true
  }

  async function changePassword(
    ancienMotDePasse: string,
    nouveauMotDePasse: string,
    nouveauMotDePasseConfirmation: string,
  ) {
    await api.post('/auth/change-password', {
      ancien_mot_de_passe: ancienMotDePasse,
      nouveau_mot_de_passe: nouveauMotDePasse,
      nouveau_mot_de_passe_confirmation: nouveauMotDePasseConfirmation,
    })
    if (user.value) user.value.premier_connexion = false
  }

  function clear() {
    token.value = null
    user.value = null
    localStorage.removeItem('token')
  }

  return {
    user,
    token,
    isAuthenticated,
    fullName,
    needsSetup,
    login,
    fetchMe,
    logout,
    acceptCgu,
    changePassword,
    clear,
  }
})
