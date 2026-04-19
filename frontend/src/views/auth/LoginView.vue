<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const isBlocked = ref(false)
const attemptsLeft = ref<number | null>(null)

// ── 2FA step ──
const requires2FA = ref(false)
const pendingToken = ref('')
const twoFACode = ref('')
const twoFAError = ref('')
const codeInputRef = ref<HTMLInputElement | null>(null)

async function submit() {
  error.value = ''
  isBlocked.value = false
  attemptsLeft.value = null
  loading.value = true

  try {
    const result = await auth.login(email.value, password.value)
    if (result.requires_2fa) {
      requires2FA.value = true
      pendingToken.value = result.pending_token ?? ''
      await nextTick()
      codeInputRef.value?.focus()
      return
    }
    router.push(auth.needsSetup ? '/setup' : '/dashboard')
  } catch (err: any) {
    const data = err.response?.data
    if (data?.bloque) {
      isBlocked.value = true
      error.value = data.message
    } else if (data?.tentatives_restantes !== undefined) {
      attemptsLeft.value = data.tentatives_restantes
      error.value = data.message
    } else {
      error.value = data?.message ?? 'Erreur de connexion. Veuillez réessayer.'
    }
  } finally {
    loading.value = false
  }
}

async function submit2FA() {
  twoFAError.value = ''
  loading.value = true
  try {
    await auth.verify2FA(pendingToken.value, twoFACode.value)
    router.push(auth.needsSetup ? '/setup' : '/dashboard')
  } catch (err: any) {
    twoFAError.value = err.response?.data?.message ?? 'Code invalide.'
    twoFACode.value = ''
    await nextTick()
    codeInputRef.value?.focus()
  } finally {
    loading.value = false
  }
}

function cancel2FA() {
  requires2FA.value = false
  pendingToken.value = ''
  twoFACode.value = ''
  twoFAError.value = ''
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-container">

      <!-- ── Panneau gauche NOIR ── -->
      <div class="auth-left">
        <div class="auth-logo-wrap">
          <div class="auth-logo-box">
            <img src="https://uptechformation.com/wp-content/uploads/2024/02/logo-blanc.png" alt="UPTECH Formation" />
          </div>
          <h1>UPTECH Campus</h1>
          <p>Institut Supérieur de Formation<br>aux Métiers de l'informatique et de la communication</p>
        </div>

        <div class="auth-sep"></div>

        <div class="auth-tagline">
          <p>Plateforme de gestion intégrée</p>
          <div>
            <span class="auth-pill">Pédagogie</span>
            <span class="auth-pill">Finances</span>
            <span class="auth-pill">Étudiants</span>
            <span class="auth-pill">Enseignants</span>
            <span class="auth-pill">Reporting</span>
          </div>
        </div>

        <div class="auth-contact">
          Amitié 1, Villa n°3031 — Dakar, Sénégal<br>
          +221 77 841 50 44 / 77 618 45 52
        </div>
      </div>

      <!-- ── Panneau droit BLANC ── -->
      <div class="auth-right">
        <!-- ─── Étape 1 : identifiants ─── -->
        <template v-if="!requires2FA">
          <h2>Connexion</h2>
          <p class="auth-subtitle">Entrez vos identifiants pour accéder à votre espace</p>

          <!-- Compte bloqué -->
          <div v-if="isBlocked" class="auth-alert auth-alert-block">
            🔒 {{ error }}
          </div>

          <!-- Erreur / tentatives -->
          <div v-else-if="error" class="auth-alert auth-alert-error">
            {{ error }}
            <span v-if="attemptsLeft !== null" style="display:block;margin-top:4px;font-size:11.5px;opacity:0.8;">
              {{ attemptsLeft }} tentative{{ attemptsLeft !== 1 ? 's' : '' }} restante{{ attemptsLeft !== 1 ? 's' : '' }}
            </span>
          </div>

          <form @submit.prevent="submit">
            <div class="auth-form-group">
              <label class="auth-label">Adresse email</label>
              <div class="auth-input-wrap">
                <span class="auth-ico">✉</span>
                <input
                  v-model="email"
                  type="email"
                  required
                  autocomplete="email"
                  placeholder="prenom.nom@uptechformation.com"
                  class="auth-input"
                />
              </div>
            </div>

            <div class="auth-form-group">
              <label class="auth-label">Mot de passe</label>
              <div class="auth-input-wrap">
                <span class="auth-ico">🔒</span>
                <input
                  v-model="password"
                  type="password"
                  required
                  autocomplete="current-password"
                  placeholder="••••••••••"
                  class="auth-input"
                />
              </div>
            </div>

            <div class="auth-row-extras">
              <a href="/reset-password" class="auth-forgot">Mot de passe oublié ?</a>
            </div>

            <button type="submit" :disabled="loading" class="auth-btn-login">
              <span v-if="loading">Connexion en cours…</span>
              <span v-else>Se connecter</span>
            </button>
          </form>
        </template>

        <!-- ─── Étape 2 : vérification 2FA ─── -->
        <template v-else>
          <h2>Vérification en 2 étapes</h2>
          <p class="auth-subtitle">
            Entrez le code à 6 chiffres affiché dans votre application d'authentification (Google Authenticator, Authy, 1Password…).
          </p>

          <div v-if="twoFAError" class="auth-alert auth-alert-error">
            {{ twoFAError }}
          </div>

          <form @submit.prevent="submit2FA">
            <div class="auth-form-group">
              <label class="auth-label">Code à 6 chiffres</label>
              <div class="auth-input-wrap">
                <span class="auth-ico">🔐</span>
                <input
                  ref="codeInputRef"
                  v-model="twoFACode"
                  type="text"
                  required
                  autocomplete="one-time-code"
                  inputmode="numeric"
                  placeholder="123456"
                  maxlength="10"
                  class="auth-input"
                  style="letter-spacing:3px; font-size:16px; font-family:monospace;"
                />
              </div>
              <p style="margin-top:8px; font-size:11px; color:#6b7280;">
                Vous pouvez aussi saisir un code de secours (format XXXX-XXXX).
              </p>
            </div>

            <button type="submit" :disabled="loading || !twoFACode" class="auth-btn-login">
              <span v-if="loading">Vérification…</span>
              <span v-else>Vérifier et se connecter</span>
            </button>

            <button type="button" class="auth-btn-cancel" @click="cancel2FA">
              ← Revenir à la connexion
            </button>
          </form>
        </template>

        <div class="auth-security">
          <span class="auth-dot-green"></span>
          Connexion sécurisée HTTPS — Session : 30 min — Toutes les actions sont tracées
        </div>

        <span class="auth-version">UPTECH Campus v1.0 — 2026</span>
      </div>

    </div>
  </div>
</template>

<style scoped>
.auth-page {
  font-family: 'Poppins', sans-serif;
  background: #f4f4f4;
  min-height: 100vh;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 20px;
}

.auth-container {
  display: flex;
  width: 920px;
  min-height: 560px;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.15);
  margin-top: auto;
  margin-bottom: auto;
}

/* ── Panneau gauche ── */
.auth-left {
  width: 40%;
  background: #111111;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 52px 36px;
  position: relative;
  overflow: hidden;
}

.auth-left::before {
  content: '';
  position: absolute;
  width: 260px; height: 260px;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 50%;
  top: -70px; right: -70px;
}

.auth-left::after {
  content: '';
  position: absolute;
  width: 180px; height: 180px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 50%;
  bottom: -50px; left: -50px;
}

.auth-logo-wrap {
  text-align: center;
  position: relative;
  z-index: 1;
  margin-bottom: 32px;
}

.auth-logo-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.auth-logo-box img { width: 160px; object-fit: contain; }

.auth-logo-wrap h1 {
  color: #ffffff;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.4px;
}

.auth-logo-wrap p {
  color: rgba(255,255,255,0.78);
  font-size: 11px;
  font-weight: 400;
  margin-top: 7px;
  line-height: 1.65;
}

.auth-sep {
  width: 32px; height: 2px;
  background: rgba(255,255,255,0.28);
  margin: 22px auto;
  position: relative; z-index: 1;
}

.auth-tagline {
  position: relative;
  z-index: 1;
  text-align: center;
}

.auth-tagline p {
  color: rgba(255,255,255,0.6);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  margin-bottom: 12px;
  font-weight: 600;
}

.auth-pill {
  display: inline-block;
  background: rgba(255,255,255,0.13);
  border: 1px solid rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.88);
  font-size: 10px;
  font-weight: 500;
  padding: 4px 11px;
  border-radius: 20px;
  margin: 3px;
}

.auth-contact {
  position: relative;
  z-index: 1;
  margin-top: 30px;
  text-align: center;
  color: rgba(255,255,255,0.4);
  font-size: 10px;
  line-height: 1.8;
}

/* ── Panneau droit ── */
.auth-right {
  flex: 1;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 52px;
  position: relative;
}

.auth-right h2 {
  color: #111111;
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 4px;
}

.auth-subtitle {
  color: #888888;
  font-size: 13px;
  margin-bottom: 28px;
}

/* Alertes */
.auth-alert {
  border-radius: 4px;
  padding: 11px 14px;
  font-size: 12.5px;
  font-weight: 500;
  margin-bottom: 18px;
}

.auth-alert-error {
  background: #fff0f0;
  border-left: 3px solid #E30613;
  color: #b91c1c;
}

.auth-alert-block {
  background: #fffbeb;
  border-left: 3px solid #f59e0b;
  color: #92400e;
}

/* Formulaire */
.auth-form-group { margin-bottom: 16px; }

.auth-label {
  display: block;
  color: #222222;
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 7px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.auth-input-wrap { position: relative; }

.auth-ico {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  color: #bbbbbb;
  font-size: 15px;
  pointer-events: none;
  line-height: 1;
}

.auth-input {
  width: 100%;
  border: 1.5px solid #e5e5e5;
  border-radius: 4px;
  padding: 12px 13px 12px 40px;
  color: #111111;
  font-family: 'Poppins', sans-serif;
  font-size: 13.5px;
  outline: none;
  transition: border-color 0.2s, background 0.2s;
  background: #fafafa;
}

.auth-input:focus {
  border-color: #E30613;
  background: #fff;
}

.auth-input::placeholder {
  color: #cccccc;
  font-size: 12.5px;
}

.auth-row-extras {
  display: flex;
  justify-content: flex-end;
  margin-top: -4px;
  margin-bottom: 22px;
}

.auth-forgot {
  color: #E30613;
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
}

.auth-forgot:hover { text-decoration: underline; }

.auth-btn-login {
  width: 100%;
  background: #E30613;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 13px;
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.auth-btn-login:hover:not(:disabled) { background: #c0000e; }
.auth-btn-login:disabled { background: #888; cursor: not-allowed; }

.auth-btn-cancel {
  width: 100%;
  margin-top: 12px;
  background: transparent;
  color: #6b7280;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 10px;
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.auth-btn-cancel:hover { background: #f9fafb; color: #374151; }

.auth-security {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid #f0f0f0;
  color: #bbbbbb;
  font-size: 10.5px;
}

.auth-dot-green {
  width: 7px; height: 7px;
  background: #22c55e;
  border-radius: 50%;
  flex-shrink: 0;
}

.auth-version {
  position: absolute;
  bottom: 12px;
  right: 16px;
  color: #dddddd;
  font-size: 10px;
}

/* ── Responsive mobile ── */
@media (max-width: 640px) {
  .auth-page { align-items: flex-start; background: #111111; padding: 0; }

  .auth-container {
    flex-direction: column;
    width: 100%;
    min-height: 100vh;
    border-radius: 0;
    box-shadow: none;
  }

  .auth-left {
    width: 100%;
    padding: 32px 24px 24px;
    flex-direction: row;
    justify-content: flex-start;
    gap: 14px;
  }

  .auth-logo-wrap { margin-bottom: 0; text-align: left; }
  .auth-logo-box img { width: 100px; }
  .auth-logo-wrap h1 { font-size: 16px; }
  .auth-logo-wrap p { font-size: 10px; margin-top: 3px; }
  .auth-sep, .auth-tagline, .auth-contact { display: none; }

  .auth-right {
    flex: 1;
    border-radius: 16px 16px 0 0;
    padding: 32px 24px 24px;
  }

  .auth-right h2 { font-size: 19px; }
  .auth-subtitle { font-size: 12.5px; }
}
</style>
