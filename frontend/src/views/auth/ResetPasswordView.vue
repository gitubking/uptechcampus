<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/services/api'

const router = useRouter()

const step = ref<1 | 2 | 3 | 4 | 'success'>(1)
const loading = ref(false)
const error = ref('')

const email = ref('')
const selectedChannel = ref<'email' | 'sms'>('sms')
const otp = ref(['', '', '', '', '', ''])
const otpInputs = ref<HTMLInputElement[]>([])
const password = ref('')
const passwordConfirm = ref('')

const passwordStrength = computed(() => {
  const p = password.value
  if (!p) return 0
  let score = 0
  if (p.length >= 8) score++
  if (/[A-Z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++
  return score
})

const strengthLabel = computed(() => (['', 'Faible', 'Moyen', 'Fort', 'Très fort'])[passwordStrength.value] ?? '')
const strengthColor = computed(() => {
  if (passwordStrength.value <= 1) return '#E30613'
  if (passwordStrength.value === 2) return '#f59e0b'
  return '#22c55e'
})

async function submitEmail() {
  error.value = ''
  if (!email.value) { error.value = 'Veuillez saisir votre adresse email.'; return }
  loading.value = true
  try {
    await api.post('/auth/forgot-password', { email: email.value })
    step.value = 2
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Aucun compte trouvé avec cet email.'
  } finally {
    loading.value = false
  }
}

async function sendCode() {
  error.value = ''
  step.value = 3
  await nextTick()
  otpInputs.value[0]?.focus()
}

function onOtpInput(index: number, e: Event) {
  const input = e.target as HTMLInputElement
  const val = input.value.replace(/\D/g, '')
  otp.value[index] = val.slice(-1)
  if (val && index < 5) otpInputs.value[index + 1]?.focus()
}

function onOtpKeydown(index: number, e: KeyboardEvent) {
  if (e.key === 'Backspace' && !otp.value[index] && index > 0) {
    otpInputs.value[index - 1]?.focus()
  }
}

function onOtpPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text')?.replace(/\D/g, '') ?? ''
  if (text.length === 6) {
    for (let i = 0; i < 6; i++) otp.value[i] = text[i] ?? ''
    otpInputs.value[5]?.focus()
    e.preventDefault()
  }
}

const otpComplete = computed(() => otp.value.every(d => d !== ''))

async function verifyOtp() {
  error.value = ''
  if (!otpComplete.value) { error.value = 'Veuillez saisir le code à 6 chiffres.'; return }
  loading.value = true
  try {
    await api.post('/auth/verify-otp', { email: email.value, otp: otp.value.join('') })
    step.value = 4
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Code incorrect ou expiré.'
  } finally {
    loading.value = false
  }
}

async function resetPassword() {
  error.value = ''
  if (!password.value || password.value.length < 8) {
    error.value = 'Le mot de passe doit contenir au moins 8 caractères.'
    return
  }
  if (password.value !== passwordConfirm.value) {
    error.value = 'Les mots de passe ne correspondent pas.'
    return
  }
  loading.value = true
  try {
    await api.post('/auth/reset-password', {
      email: email.value,
      otp: otp.value.join(''),
      password: password.value,
      password_confirmation: passwordConfirm.value,
    })
    step.value = 'success'
  } catch (e: any) {
    error.value = e.response?.data?.message ?? 'Une erreur est survenue.'
  } finally {
    loading.value = false
  }
}

async function resendCode() {
  error.value = ''
  otp.value = ['', '', '', '', '', '']
  await api.post('/auth/forgot-password', { email: email.value })
  await nextTick()
  otpInputs.value[0]?.focus()
}

function stepStatus(n: number) {
  if (step.value === 'success' || (typeof step.value === 'number' && step.value > n)) return 'done'
  if (step.value === n) return 'active'
  return 'pending'
}

const steps = [
  { num: 1, label: 'Saisir votre email', desc: 'Identification du compte' },
  { num: 2, label: 'Choisir un canal', desc: 'SMS ou Email' },
  { num: 3, label: 'Saisir le code', desc: 'Code à 6 chiffres' },
  { num: 4, label: 'Nouveau mot de passe', desc: 'Sécuriser votre compte' },
]
</script>

<template>
  <div class="rp-page">
    <div class="rp-container">

      <!-- ── Panneau gauche ── -->
      <div class="rp-left">
        <div class="rp-logo-wrap">
          <div class="rp-logo-box">
            <img src="https://uptechformation.com/wp-content/uploads/2024/02/logo-blanc.png" alt="UPTECH" />
          </div>
          <h1>UPTECH Campus</h1>
          <p>Institut Supérieur de Formation<br>aux Métiers de l'informatique et de la communication</p>
        </div>

        <div class="rp-sep"></div>

        <div class="rp-steps-block">
          <p>Étapes de réinitialisation</p>
          <div v-for="s in steps" :key="s.num" class="rp-step-item">
            <div class="rp-step-num" :class="stepStatus(s.num)">
              <span v-if="stepStatus(s.num) === 'done'">✓</span>
              <span v-else>{{ s.num }}</span>
            </div>
            <div class="rp-step-text">
              <strong>{{ s.label }}</strong>
              <span>{{ s.desc }}</span>
            </div>
          </div>
        </div>

        <div class="rp-contact">
          Amitié 1, Villa n°3031 — Dakar, Sénégal<br>
          +221 77 841 50 44
        </div>
      </div>

      <!-- ── Panneau droit ── -->
      <div class="rp-right">

        <a href="/login" class="rp-back-link">← Retour à la connexion</a>

        <!-- SUCCÈS -->
        <div v-if="step === 'success'" style="text-align:center;">
          <div class="rp-success-icon">✓</div>
          <h2 style="text-align:center;">Mot de passe réinitialisé !</h2>
          <p class="rp-subtitle" style="text-align:center;margin-top:8px;">
            Votre mot de passe a été mis à jour avec succès.<br>
            Vous pouvez maintenant vous connecter.
          </p>
          <button class="rp-btn" @click="router.push('/login')">Se connecter</button>
        </div>

        <!-- ÉTAPE 1 : Email -->
        <div v-else-if="step === 1">
          <h2>Mot de passe oublié ?</h2>
          <p class="rp-subtitle">Entrez votre adresse email pour recevoir un code de réinitialisation.</p>

          <div v-if="error" class="rp-alert rp-alert-error">{{ error }}</div>

          <div class="rp-form-group">
            <label class="rp-label">Adresse email</label>
            <div class="rp-input-wrap">
              <span class="rp-ico">✉</span>
              <input v-model="email" type="email" required placeholder="prenom.nom@uptechformation.com" class="rp-input" />
            </div>
          </div>

          <button class="rp-btn" :disabled="loading" @click="submitEmail">
            {{ loading ? 'Envoi en cours…' : 'Continuer' }}
          </button>
        </div>

        <!-- ÉTAPE 2 : Canal -->
        <div v-else-if="step === 2">
          <h2>Choisir un canal</h2>
          <p class="rp-subtitle">Comment souhaitez-vous recevoir votre code de vérification ?</p>

          <div class="rp-canal-choice">
            <div class="rp-canal-card" :class="{ selected: selectedChannel === 'sms' }"
              @click="selectedChannel = 'sms'">
              <div class="rp-canal-icon">📱</div>
              <div class="rp-canal-name">SMS</div>
              <div class="rp-canal-desc">+221 77 *** ** 44</div>
            </div>
            <div class="rp-canal-card" :class="{ selected: selectedChannel === 'email' }"
              @click="selectedChannel = 'email'">
              <div class="rp-canal-icon">✉</div>
              <div class="rp-canal-name">Email</div>
              <div class="rp-canal-desc">pr***@uptech.com</div>
            </div>
          </div>

          <button class="rp-btn" @click="sendCode">Envoyer le code</button>
        </div>

        <!-- ÉTAPE 3 : OTP -->
        <div v-else-if="step === 3">
          <h2>Saisir le code</h2>
          <p class="rp-subtitle">
            Un code à 6 chiffres a été envoyé. Il expire dans
            <strong style="color:#E30613;">10 minutes</strong>.
          </p>

          <div v-if="error" class="rp-alert rp-alert-error">{{ error }}</div>

          <div class="rp-otp-inputs" @paste="onOtpPaste">
            <input
              v-for="(_, i) in otp"
              :key="i"
              :ref="el => { if (el) otpInputs[i] = el as HTMLInputElement }"
              v-model="otp[i]"
              type="text"
              inputmode="numeric"
              maxlength="1"
              class="rp-otp-box"
              @input="onOtpInput(i, $event)"
              @keydown="onOtpKeydown(i, $event)"
            />
          </div>

          <p class="rp-otp-hint">
            Vous n'avez pas reçu le code ?
            <a @click="resendCode" style="color:#E30613;font-weight:500;cursor:pointer;">Renvoyer</a>
          </p>

          <button class="rp-btn" :disabled="!otpComplete || loading" @click="verifyOtp">
            {{ loading ? 'Vérification…' : 'Vérifier le code' }}
          </button>
        </div>

        <!-- ÉTAPE 4 : Nouveau mot de passe -->
        <div v-else-if="step === 4">
          <h2>Nouveau mot de passe</h2>
          <p class="rp-subtitle">Choisissez un mot de passe solide pour sécuriser votre compte.</p>

          <div v-if="error" class="rp-alert rp-alert-error">{{ error }}</div>

          <div class="rp-form-group">
            <label class="rp-label">Nouveau mot de passe</label>
            <div class="rp-input-wrap">
              <span class="rp-ico">🔒</span>
              <input v-model="password" type="password" placeholder="Minimum 8 caractères" class="rp-input" />
            </div>
            <div v-if="password" class="rp-strength">
              <div class="rp-strength-bar">
                <span v-for="i in 4" :key="i"
                  :style="i <= passwordStrength ? `background:${strengthColor}` : ''"></span>
              </div>
              <span class="rp-strength-label" :style="`color:${strengthColor}`">{{ strengthLabel }}</span>
            </div>
          </div>

          <div class="rp-form-group">
            <label class="rp-label">Confirmer le mot de passe</label>
            <div class="rp-input-wrap">
              <span class="rp-ico">🔒</span>
              <input v-model="passwordConfirm" type="password" placeholder="Répétez votre mot de passe" class="rp-input" />
            </div>
          </div>

          <button class="rp-btn" :disabled="loading || !password || password !== passwordConfirm" @click="resetPassword">
            {{ loading ? 'Enregistrement…' : 'Enregistrer le mot de passe' }}
          </button>
        </div>

        <span class="rp-version">UPTECH Campus v1.0 — 2026</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rp-page {
  font-family: 'Poppins', sans-serif;
  background: #f4f4f4;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.rp-container {
  display: flex;
  width: 920px;
  min-height: 560px;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.15);
}

/* ── Panneau gauche ── */
.rp-left {
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

.rp-left::before {
  content: ''; position: absolute;
  width: 260px; height: 260px;
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 50%; top: -70px; right: -70px;
}
.rp-left::after {
  content: ''; position: absolute;
  width: 180px; height: 180px;
  border: 1px solid rgba(255,255,255,0.04);
  border-radius: 50%; bottom: -50px; left: -50px;
}

.rp-logo-wrap { text-align: center; position: relative; z-index: 1; margin-bottom: 32px; }
.rp-logo-box { display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; }
.rp-logo-box img { width: 160px; object-fit: contain; }
.rp-logo-wrap h1 { color: #fff; font-size: 24px; font-weight: 700; letter-spacing: 0.4px; }
.rp-logo-wrap p { color: rgba(255,255,255,0.5); font-size: 11px; margin-top: 7px; line-height: 1.65; }

.rp-sep { width: 32px; height: 2px; background: rgba(255,255,255,0.15); margin: 22px auto; position: relative; z-index: 1; }

.rp-steps-block { position: relative; z-index: 1; width: 100%; }
.rp-steps-block > p {
  color: rgba(255,255,255,0.4); font-size: 10px; text-transform: uppercase;
  letter-spacing: 1.2px; font-weight: 600; margin-bottom: 16px; text-align: center;
}

.rp-step-item { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; }

.rp-step-num {
  width: 26px; height: 26px; border-radius: 50%;
  background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.6); flex-shrink: 0;
}
.rp-step-num.active { background: #E30613; border-color: #E30613; color: #fff; }
.rp-step-num.done { background: rgba(34,197,94,0.15); border-color: rgba(34,197,94,0.4); color: #22c55e; }

.rp-step-text { padding-top: 3px; }
.rp-step-text strong { display: block; color: rgba(255,255,255,0.8); font-size: 12px; font-weight: 600; }
.rp-step-text span { color: rgba(255,255,255,0.35); font-size: 10.5px; }

.rp-contact { position: relative; z-index: 1; margin-top: 30px; text-align: center; color: rgba(255,255,255,0.25); font-size: 10px; line-height: 1.8; }

/* ── Panneau droit ── */
.rp-right {
  flex: 1; background: #ffffff; display: flex; flex-direction: column;
  justify-content: center; padding: 52px; position: relative;
}

.rp-back-link {
  display: inline-flex; align-items: center; gap: 6px;
  color: #888; font-size: 12px; font-weight: 500;
  text-decoration: none; margin-bottom: 28px; transition: color 0.2s;
}
.rp-back-link:hover { color: #E30613; }

.rp-right h2 { color: #111111; font-size: 21px; font-weight: 700; margin-bottom: 4px; }
.rp-subtitle { color: #888888; font-size: 13px; margin-bottom: 28px; line-height: 1.6; }

.rp-alert { border-radius: 4px; padding: 11px 14px; font-size: 12.5px; font-weight: 500; margin-bottom: 18px; }
.rp-alert-error { background: #fff0f0; border-left: 3px solid #E30613; color: #b91c1c; }
.rp-alert-success { background: #f0fdf4; border-left: 3px solid #22c55e; color: #15803d; }

.rp-form-group { margin-bottom: 18px; }
.rp-label { display: block; color: #222; font-size: 12px; font-weight: 600; margin-bottom: 7px; text-transform: uppercase; letter-spacing: 0.4px; }
.rp-input-wrap { position: relative; }
.rp-ico { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #bbb; font-size: 15px; pointer-events: none; line-height: 1; }
.rp-input {
  width: 100%; border: 1.5px solid #e5e5e5; border-radius: 4px;
  padding: 12px 13px 12px 40px; color: #111; font-family: 'Poppins', sans-serif;
  font-size: 13.5px; outline: none; transition: border-color 0.2s; background: #fafafa;
}
.rp-input:focus { border-color: #E30613; background: #fff; }
.rp-input::placeholder { color: #ccc; font-size: 12.5px; }

/* Canal */
.rp-canal-choice { display: flex; gap: 10px; margin-bottom: 22px; }
.rp-canal-card {
  flex: 1; border: 1.5px solid #e5e5e5; border-radius: 4px;
  padding: 14px 12px; text-align: center; cursor: pointer;
  transition: all 0.2s; background: #fafafa;
}
.rp-canal-card:hover { border-color: #E30613; }
.rp-canal-card.selected { border-color: #E30613; background: #fff5f5; }
.rp-canal-icon { font-size: 22px; margin-bottom: 6px; }
.rp-canal-name { font-size: 12px; font-weight: 600; color: #222; }
.rp-canal-desc { font-size: 10.5px; color: #aaa; margin-top: 2px; }

/* OTP */
.rp-otp-inputs { display: flex; gap: 10px; margin-bottom: 22px; }
.rp-otp-box {
  flex: 1; border: 1.5px solid #e5e5e5; border-radius: 4px;
  padding: 14px 0; text-align: center; font-family: 'Poppins', sans-serif;
  font-size: 20px; font-weight: 700; color: #111;
  background: #fafafa; outline: none; transition: border-color 0.2s;
}
.rp-otp-box:focus { border-color: #E30613; background: #fff; }
.rp-otp-hint { font-size: 12px; color: #aaa; margin-top: -14px; margin-bottom: 20px; }

/* Strength */
.rp-strength { margin-top: 6px; margin-bottom: 8px; }
.rp-strength-bar { display: flex; gap: 4px; margin-bottom: 4px; }
.rp-strength-bar span { flex: 1; height: 3px; border-radius: 2px; background: #e5e5e5; transition: background 0.3s; }
.rp-strength-label { font-size: 11px; color: #aaa; }

/* Bouton */
.rp-btn {
  width: 100%; background: #E30613; color: #fff; border: none;
  border-radius: 4px; padding: 13px; font-family: 'Poppins', sans-serif;
  font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s;
}
.rp-btn:hover:not(:disabled) { background: #c0000e; }
.rp-btn:disabled { background: #888; cursor: not-allowed; }

/* Succès */
.rp-success-icon {
  width: 64px; height: 64px; background: #f0fdf4; border: 2px solid #22c55e;
  border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font-size: 28px; margin: 0 auto 20px;
}

.rp-version { position: absolute; bottom: 12px; right: 16px; color: #ddd; font-size: 10px; }

/* Responsive */
@media (max-width: 640px) {
  .rp-page { align-items: flex-start; background: #111111; padding: 0; }
  .rp-container { flex-direction: column; width: 100%; min-height: 100vh; border-radius: 0; box-shadow: none; }
  .rp-left { width: 100%; padding: 28px 24px 20px; flex-direction: row; justify-content: flex-start; align-items: center; gap: 14px; }
  .rp-logo-wrap { margin-bottom: 0; text-align: left; }
  .rp-logo-box img { width: 100px; }
  .rp-logo-wrap h1 { font-size: 16px; }
  .rp-logo-wrap p { font-size: 10px; margin-top: 3px; }
  .rp-sep, .rp-steps-block, .rp-contact { display: none; }
  .rp-right { flex: 1; border-radius: 16px 16px 0 0; padding: 28px 22px 24px; }
  .rp-back-link { margin-bottom: 18px; }
  .rp-right h2 { font-size: 18px; }
  .rp-subtitle { font-size: 12px; margin-bottom: 20px; }
  .rp-otp-box { padding: 12px 0; font-size: 18px; }
  .rp-canal-choice { gap: 8px; }
  .rp-version { display: none; }
}
</style>
