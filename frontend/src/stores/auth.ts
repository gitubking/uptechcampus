import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api'

export interface User {
  id: number
  nom: string
  prenom: string
  email: string
  role: 'dg' | 'dir_peda' | 'resp_fin' | 'coordinateur' | 'secretariat' | 'enseignant' | 'etudiant' | 'parent'
  photo_path: string | null
  premier_connexion: boolean
  cgu_acceptees: boolean
  totp_enabled?: boolean
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

  // Retourne { requires_2fa: true, pending_token } si 2FA activée, sinon undefined
  async function login(email: string, password: string): Promise<{ requires_2fa: boolean; pending_token?: string }> {
    const { data } = await api.post('/auth/login', { email, password })
    if (data.requires_2fa) {
      return { requires_2fa: true, pending_token: data.pending_token }
    }
    token.value = data.token
    user.value = data.user
    localStorage.setItem('token', data.token)
    return { requires_2fa: false }
  }

  // Étape 2 du login : vérification du code TOTP
  async function verify2FA(pendingToken: string, code: string): Promise<{ used_backup: boolean }> {
    const { data } = await api.post('/auth/2fa/verify', { pending_token: pendingToken, code })
    token.value = data.token
    user.value = data.user
    localStorage.setItem('token', data.token)
    return { used_backup: !!data.used_backup }
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
    verify2FA,
    fetchMe,
    logout,
    acceptCgu,
    changePassword,
    clear,
  }
})
