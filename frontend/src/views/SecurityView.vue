<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import api from '@/services/api'
import { useToast } from '@/composables/useToast'
import QRCode from 'qrcode'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const toast = useToast()

// ── État 2FA ────────────────────────────────────────────────────────
interface Status {
  enabled: boolean
  enabled_at: string | null
  backup_codes_remaining: number
}
const status = ref<Status>({ enabled: false, enabled_at: null, backup_codes_remaining: 0 })
const loadingStatus = ref(true)

// ── Setup flow ──────────────────────────────────────────────────────
type Step = 'idle' | 'scan' | 'verify' | 'backup' | 'done'
const setupStep = ref<Step>('idle')
const secret = ref('')
const otpauthUrl = ref('')
const qrDataUrl = ref('')
const setupCode = ref('')
const backupCodes = ref<string[]>([])
const setupError = ref('')
const loading = ref(false)

// ── Disable flow ────────────────────────────────────────────────────
const showDisable = ref(false)
const disablePassword = ref('')
const disableError = ref('')

// ── Regenerate backup codes ─────────────────────────────────────────
const showRegenerate = ref(false)
const regenCode = ref('')
const regenError = ref('')

// ── Helpers ─────────────────────────────────────────────────────────
function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const backupCodesText = computed(() => backupCodes.value.join('\n'))

// ── API ─────────────────────────────────────────────────────────────
async function loadStatus() {
  loadingStatus.value = true
  try {
    const { data } = await api.get('/auth/2fa/status')
    status.value = data
  } catch (e) {
    console.error(e)
  } finally {
    loadingStatus.value = false
  }
}

async function startSetup() {
  setupError.value = ''
  loading.value = true
  try {
    const { data } = await api.post('/auth/2fa/setup')
    secret.value = data.secret
    otpauthUrl.value = data.otpauth_url
    qrDataUrl.value = await QRCode.toDataURL(data.otpauth_url, {
      width: 220,
      margin: 1,
      color: { dark: '#111111', light: '#ffffff' },
    })
    setupStep.value = 'scan'
  } catch (e: any) {
    setupError.value = e.response?.data?.message ?? 'Erreur lors de la génération.'
  } finally {
    loading.value = false
  }
}

async function verifySetup() {
  setupError.value = ''
  if (!setupCode.value || setupCode.value.replace(/\s/g, '').length < 6) {
    setupError.value = 'Entrez un code à 6 chiffres.'
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/auth/2fa/verify-setup', {
      secret: secret.value,
      code: setupCode.value,
    })
    backupCodes.value = data.backup_codes
    setupStep.value = 'backup'
    // Mettre à jour le store local
    if (auth.user) auth.user.totp_enabled = true
    await loadStatus()
  } catch (e: any) {
    setupError.value = e.response?.data?.message ?? 'Code invalide.'
  } finally {
    loading.value = false
  }
}

function copyBackupCodes() {
  navigator.clipboard.writeText(backupCodesText.value).then(
    () => toast.warning('Codes copiés dans le presse-papiers ✓'),
    () => toast.warning('Impossible de copier. Sélectionnez-les manuellement.'),
  )
}

function downloadBackupCodes() {
  const content = `UPTECH Campus - Codes de secours 2FA\n${auth.user?.email}\nGénérés le ${new Date().toLocaleString('fr-FR')}\n\n${backupCodes.value.join('\n')}\n\n⚠ Chaque code ne peut être utilisé qu'une seule fois.\nConservez cette liste en lieu sûr.\n`
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `uptech-codes-secours-${new Date().toISOString().split('T')[0]}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function finishSetup() {
  setupStep.value = 'idle'
  secret.value = ''
  otpauthUrl.value = ''
  qrDataUrl.value = ''
  setupCode.value = ''
  backupCodes.value = []
}

async function disable2FA() {
  disableError.value = ''
  if (!disablePassword.value) {
    disableError.value = 'Mot de passe requis.'
    return
  }
  loading.value = true
  try {
    await api.post('/auth/2fa/disable', { password: disablePassword.value })
    if (auth.user) auth.user.totp_enabled = false
    disablePassword.value = ''
    showDisable.value = false
    await loadStatus()
  } catch (e: any) {
    disableError.value = e.response?.data?.message ?? 'Erreur.'
  } finally {
    loading.value = false
  }
}

async function regenerateBackupCodes() {
  regenError.value = ''
  if (!regenCode.value) {
    regenError.value = 'Code requis.'
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/auth/2fa/regenerate-backup-codes', { code: regenCode.value })
    backupCodes.value = data.backup_codes
    setupStep.value = 'backup'
    showRegenerate.value = false
    regenCode.value = ''
    await loadStatus()
  } catch (e: any) {
    regenError.value = e.response?.data?.message ?? 'Erreur.'
  } finally {
    loading.value = false
  }
}

// ── Signature personnelle ──────────────────────────────────────────
const signatureUrl = ref<string | null>(null)
const signatureSaving = ref(false)
const signatureError = ref('')

async function loadSignature() {
  try {
    const { data } = await api.get('/auth/me')
    signatureUrl.value = data.signature_data_url ?? null
  } catch { /* silencieux */ }
}

function readFileAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })
}

async function onSignatureFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  signatureError.value = ''
  if (file.size > 2 * 1024 * 1024) {
    signatureError.value = 'Image trop lourde (max 2 Mo).'
    return
  }
  signatureSaving.value = true
  try {
    const dataUrl = await readFileAsDataUrl(file)
    await api.put('/auth/me/signature', { signature_data_url: dataUrl })
    signatureUrl.value = dataUrl
  } catch (err: any) {
    signatureError.value = err?.response?.data?.message ?? 'Erreur lors de l\'enregistrement.'
  } finally {
    signatureSaving.value = false
    input.value = ''
  }
}

async function removeSignature() {
  if (!confirm('Supprimer votre signature enregistrée ?')) return
  try {
    await api.delete('/auth/me/signature')
    signatureUrl.value = null
  } catch { /* silencieux */ }
}

onMounted(() => {
  loadStatus()
  loadSignature()
})
</script>

<template>
  <div class="sec-page">
    <div class="sec-header">
      <h2>🔐 Sécurité de mon compte</h2>
      <p>Protégez votre accès avec une authentification à deux facteurs (2FA).</p>
    </div>

    <!-- ══════════ CARTE STATUS 2FA ══════════ -->
    <div class="sec-card">
      <div class="sec-card-head">
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="sec-icon" :class="{ 'sec-icon-ok': status.enabled, 'sec-icon-ko': !status.enabled }">
            {{ status.enabled ? '✓' : '✕' }}
          </div>
          <div>
            <h3>Authentification à deux facteurs</h3>
            <p v-if="loadingStatus" class="sec-muted">Chargement...</p>
            <p v-else-if="status.enabled" class="sec-muted">
              Activée depuis {{ status.enabled_at ? formatDate(status.enabled_at) : '—' }}
              · {{ status.backup_codes_remaining }} code{{ status.backup_codes_remaining > 1 ? 's' : '' }} de secours restant{{ status.backup_codes_remaining > 1 ? 's' : '' }}
            </p>
            <p v-else class="sec-muted">
              Non activée. Recommandé pour tous les rôles sensibles (DG, Finance).
            </p>
          </div>
        </div>
        <div>
          <button
            v-if="!status.enabled && setupStep === 'idle'"
            class="sec-btn sec-btn-primary"
            :disabled="loading"
            @click="startSetup"
          >
            Activer la 2FA
          </button>
          <button
            v-if="status.enabled && !showDisable"
            class="sec-btn sec-btn-danger-outline"
            @click="showDisable = true"
          >
            Désactiver
          </button>
        </div>
      </div>

      <!-- ── Setup étape 1 : QR code ── -->
      <div v-if="setupStep === 'scan'" class="sec-panel">
        <h4>1. Scannez le QR code avec votre application</h4>
        <p class="sec-muted">
          Utilisez <strong>Google Authenticator</strong>, <strong>Microsoft Authenticator</strong>,
          <strong>Authy</strong> ou <strong>1Password</strong>.
        </p>
        <div class="sec-qr-wrap">
          <img :src="qrDataUrl" alt="QR code 2FA" class="sec-qr" />
          <div class="sec-qr-alt">
            <p style="font-size:12px; color:#6b7280; margin:0 0 6px;">Ou saisissez cette clé manuellement :</p>
            <code class="sec-secret">{{ secret }}</code>
          </div>
        </div>
        <button class="sec-btn sec-btn-primary" @click="setupStep = 'verify'">
          J'ai scanné le code →
        </button>
      </div>

      <!-- ── Setup étape 2 : vérification ── -->
      <div v-if="setupStep === 'verify'" class="sec-panel">
        <h4>2. Entrez le code affiché dans votre application</h4>
        <p class="sec-muted">
          Vérifiez que le QR code a bien été scanné en saisissant le code à 6 chiffres actuellement affiché.
        </p>
        <div v-if="setupError" class="sec-error">{{ setupError }}</div>
        <input
          v-model="setupCode"
          type="text"
          inputmode="numeric"
          maxlength="6"
          placeholder="123456"
          class="sec-input sec-input-code"
          @keyup.enter="verifySetup"
        />
        <div style="display:flex; gap:8px;">
          <button class="sec-btn sec-btn-secondary" @click="setupStep = 'scan'">← Précédent</button>
          <button class="sec-btn sec-btn-primary" :disabled="loading || !setupCode" @click="verifySetup">
            Vérifier et activer
          </button>
        </div>
      </div>

      <!-- ── Setup étape 3 : codes de secours ── -->
      <div v-if="setupStep === 'backup'" class="sec-panel sec-panel-success">
        <h4>✓ 2FA activée — Enregistrez vos codes de secours</h4>
        <p class="sec-muted">
          Ces <strong>10 codes</strong> vous permettront de vous connecter si vous perdez l'accès à votre application.
          <strong>Chaque code ne peut être utilisé qu'une seule fois.</strong> Conservez-les dans un lieu sûr (gestionnaire de mots de passe, coffre, imprimé).
        </p>
        <div class="sec-backup-grid">
          <code v-for="(c, i) in backupCodes" :key="i">{{ c }}</code>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="sec-btn sec-btn-secondary" @click="copyBackupCodes">
            📋 Copier
          </button>
          <button class="sec-btn sec-btn-secondary" @click="downloadBackupCodes">
            💾 Télécharger (.txt)
          </button>
          <button class="sec-btn sec-btn-primary" @click="finishSetup">
            J'ai sauvegardé mes codes ✓
          </button>
        </div>
      </div>

      <!-- ── Désactivation ── -->
      <div v-if="showDisable" class="sec-panel sec-panel-warning">
        <h4>⚠ Désactiver la 2FA</h4>
        <p class="sec-muted">
          Votre compte sera moins protégé. Saisissez votre mot de passe pour confirmer.
        </p>
        <div v-if="disableError" class="sec-error">{{ disableError }}</div>
        <input
          v-model="disablePassword"
          type="password"
          placeholder="Votre mot de passe"
          class="sec-input"
          @keyup.enter="disable2FA"
        />
        <div style="display:flex; gap:8px;">
          <button class="sec-btn sec-btn-secondary" @click="showDisable = false; disablePassword = ''; disableError = ''">
            Annuler
          </button>
          <button class="sec-btn sec-btn-danger" :disabled="loading" @click="disable2FA">
            Désactiver la 2FA
          </button>
        </div>
      </div>
    </div>

    <!-- ══════════ CODES DE SECOURS ══════════ -->
    <div v-if="status.enabled && setupStep !== 'backup'" class="sec-card">
      <div class="sec-card-head">
        <div>
          <h3>Codes de secours</h3>
          <p class="sec-muted">
            {{ status.backup_codes_remaining }} / 10 code{{ status.backup_codes_remaining > 1 ? 's' : '' }} restant{{ status.backup_codes_remaining > 1 ? 's' : '' }}.
            Si vous en avez moins de 3, il est recommandé d'en régénérer.
          </p>
        </div>
        <button v-if="!showRegenerate" class="sec-btn sec-btn-secondary" @click="showRegenerate = true">
          Régénérer
        </button>
      </div>
      <div v-if="showRegenerate" class="sec-panel">
        <h4>Régénérer les codes de secours</h4>
        <p class="sec-muted">
          Les anciens codes seront définitivement invalidés. Saisissez un code 2FA actuel pour confirmer.
        </p>
        <div v-if="regenError" class="sec-error">{{ regenError }}</div>
        <input
          v-model="regenCode"
          type="text"
          inputmode="numeric"
          maxlength="10"
          placeholder="Code à 6 chiffres"
          class="sec-input sec-input-code"
          @keyup.enter="regenerateBackupCodes"
        />
        <div style="display:flex; gap:8px;">
          <button class="sec-btn sec-btn-secondary" @click="showRegenerate = false; regenCode = ''; regenError = ''">
            Annuler
          </button>
          <button class="sec-btn sec-btn-primary" :disabled="loading" @click="regenerateBackupCodes">
            Régénérer les 10 codes
          </button>
        </div>
      </div>
    </div>

    <!-- ══════════ INFO BOX ══════════ -->
    <div class="sec-info">
      <h4>ℹ Bonnes pratiques</h4>
      <ul>
        <li>Installez une application d'authentification avant d'activer la 2FA (Google Authenticator, Authy…).</li>
        <li>Conservez vos codes de secours hors ligne (imprimés, gestionnaire de mots de passe).</li>
        <li>Ne partagez jamais votre clé secrète ou vos codes avec quiconque.</li>
        <li>En cas de perte de votre téléphone ET de vos codes de secours, contactez le DG pour réinitialisation.</li>
      </ul>
    </div>

    <!-- ══════════ SIGNATURE NUMÉRIQUE ══════════ -->
    <div class="sec-card" style="margin-top:24px;">
      <div class="sec-card-head">
        <h3>✍️ Ma signature &amp; mon cachet</h3>
        <span v-if="signatureUrl" class="sec-badge sec-badge--on">Enregistrée</span>
        <span v-else class="sec-badge sec-badge--off">Aucune</span>
      </div>
      <p class="sec-desc">
        Déposez l'image scannée de votre signature (incluant éventuellement votre cachet).
        Elle sera <strong>apposée automatiquement</strong> sur les PDFs d'autorisation
        d'absence que vous approuvez. Aucune déformation : le ratio est préservé.
      </p>

      <!-- Aperçu -->
      <div v-if="signatureUrl" class="sec-sig-preview">
        <img :src="signatureUrl" alt="Ma signature" />
      </div>

      <!-- Upload -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:10px;">
        <label class="sec-btn sec-btn-primary" style="cursor:pointer;">
          <input type="file" accept="image/png,image/jpeg,image/webp" @change="onSignatureFile" style="display:none;" />
          {{ signatureUrl ? "Remplacer l'image" : 'Choisir une image' }}
        </label>
        <button v-if="signatureUrl" @click="removeSignature" class="sec-btn sec-btn-danger-outline">
          Supprimer
        </button>
        <span v-if="signatureError" style="font-size:12px;color:#dc2626;">{{ signatureError }}</span>
        <span v-else-if="signatureSaving" style="font-size:12px;color:#64748b;">Enregistrement…</span>
      </div>
      <p style="font-size:11px;color:#94a3b8;margin-top:8px;">
        Formats acceptés : PNG, JPG, WEBP — 2 Mo max. Préférez un PNG à fond transparent pour un rendu optimal.
      </p>
    </div>
  </div>
</template>

<style scoped>
.sec-page {
  padding: 24px;
  max-width: 860px;
  margin: 0 auto;
  font-family: 'Poppins', sans-serif;
}
.sec-badge--on { background: #dcfce7; color: #166534; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.sec-badge--off { background: #f3f4f6; color: #6b7280; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.sec-sig-preview {
  margin-top: 12px;
  padding: 16px;
  background: repeating-conic-gradient(#f8fafc 0% 25%, #e5e7eb 0% 50%) 0 0 / 16px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sec-sig-preview img {
  max-width: 100%;
  max-height: 180px;
  object-fit: contain;
  display: block;
}

.sec-header h2 {
  font-size: 22px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4px;
}
.sec-header p {
  font-size: 13px;
  color: #6b7280;
  margin: 0 0 20px;
}

.sec-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.sec-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

.sec-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 4px;
}

.sec-muted {
  font-size: 12.5px;
  color: #6b7280;
  margin: 0;
  line-height: 1.5;
}

.sec-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  flex-shrink: 0;
}
.sec-icon-ok { background: #dcfce7; color: #15803d; }
.sec-icon-ko { background: #fef3c7; color: #92400e; }

.sec-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.sec-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.sec-btn-primary { background: #2563eb; color: #fff; }
.sec-btn-primary:hover:not(:disabled) { background: #1d4ed8; }

.sec-btn-secondary { background: #fff; color: #374151; border-color: #d1d5db; }
.sec-btn-secondary:hover:not(:disabled) { background: #f9fafb; }

.sec-btn-danger { background: #dc2626; color: #fff; }
.sec-btn-danger:hover:not(:disabled) { background: #b91c1c; }

.sec-btn-danger-outline { background: #fff; color: #dc2626; border-color: #fecaca; }
.sec-btn-danger-outline:hover:not(:disabled) { background: #fef2f2; }

.sec-panel {
  margin-top: 20px;
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
}
.sec-panel h4 {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 6px;
}
.sec-panel-success { background: #f0fdf4; border-color: #bbf7d0; }
.sec-panel-warning { background: #fffbeb; border-color: #fde68a; }

.sec-qr-wrap {
  display: flex;
  gap: 20px;
  align-items: center;
  margin: 16px 0;
  flex-wrap: wrap;
}
.sec-qr {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: #fff;
  padding: 8px;
}
.sec-qr-alt { flex: 1; min-width: 200px; }
.sec-secret {
  display: block;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 8px 10px;
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
  color: #111827;
}

.sec-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  margin: 10px 0;
  box-sizing: border-box;
}
.sec-input:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}
.sec-input-code {
  font-family: monospace;
  font-size: 18px;
  letter-spacing: 4px;
  text-align: center;
  max-width: 200px;
}

.sec-error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 12px;
  margin: 10px 0;
}

.sec-backup-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin: 14px 0;
}
.sec-backup-grid code {
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 8px;
  font-family: monospace;
  font-size: 13px;
  text-align: center;
  letter-spacing: 1px;
  color: #111827;
}

.sec-info {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  padding: 16px 20px;
}
.sec-info h4 {
  font-size: 13px;
  font-weight: 600;
  color: #1e40af;
  margin: 0 0 8px;
}
.sec-info ul {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: #1e3a8a;
  line-height: 1.7;
}
.sec-info li { margin-bottom: 3px; }
</style>
