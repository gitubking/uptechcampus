<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'

const route  = useRoute()
const loading = ref(true)
const error   = ref<string | null>(null)
const att     = ref<any>(null)
const verifiedAt = ref(new Date())

const typeLabels: Record<string, string> = {
  scolarite:  'Attestation de scolarité',
  reussite:   'Attestation de réussite',
  frequentation: 'Attestation de fréquentation',
  stage:      'Attestation de stage',
  autre:      'Attestation',
}

const statusInfo = computed(() => {
  if (!att.value) return null
  if (att.value.statut === 'revoquee') return { label: 'Révoquée', color: '#dc2626', bg: '#fef2f2', icon: '✕' }
  if (att.value.expires_at && new Date(att.value.expires_at) < new Date())
    return { label: 'Expirée', color: '#d97706', bg: '#fef3c7', icon: '⏱' }
  return { label: 'Valide et authentique', color: '#15803d', bg: '#f0fdf4', icon: '✓' }
})

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

onMounted(async () => {
  const ref = route.params.ref as string
  try {
    const resp = await fetch(`/api/attestations/verify/${encodeURIComponent(ref)}`)
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}))
      error.value = j.message ?? 'Attestation introuvable.'
      return
    }
    att.value = await resp.json()
    verifiedAt.value = new Date()
  } catch {
    error.value = 'Erreur de connexion. Veuillez réessayer.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="vfa-root">

    <!-- ── En-tête ── -->
    <header class="vfa-header">
      <div class="vfa-header-inner">
        <img src="/favicon.svg" alt="UPTECH" class="vfa-logo" onerror="this.style.display='none'"/>
        <div>
          <div class="vfa-brand">UP'TECH Campus</div>
          <div class="vfa-brand-sub">Système de vérification des attestations</div>
        </div>
      </div>
    </header>

    <main class="vfa-main">

      <!-- ── Loading ── -->
      <div v-if="loading" class="vfa-card vfa-center">
        <div class="vfa-spinner"></div>
        <p class="vfa-loading-txt">Vérification en cours…</p>
      </div>

      <!-- ── Erreur ── -->
      <div v-else-if="error" class="vfa-card vfa-center">
        <div class="vfa-icon-err">✕</div>
        <h2 class="vfa-err-title">Attestation introuvable</h2>
        <p class="vfa-err-msg">{{ error }}</p>
        <p class="vfa-err-hint">
          Cette référence ne correspond à aucune attestation émise par UP'TECH.<br>
          Si vous pensez qu'il s'agit d'une erreur, contactez l'administration.
        </p>
        <div class="vfa-contact">
          <span>📞 (+221) 77 841 50 44</span>
          <span>✉️ uptechformation@gmail.com</span>
        </div>
      </div>

      <!-- ── Résultat ── -->
      <div v-else-if="att" class="vfa-card">

        <!-- Badge statut -->
        <div class="vfa-status-banner" :style="{ background: statusInfo?.bg, borderColor: statusInfo?.color + '33' }">
          <span class="vfa-status-icon" :style="{ background: statusInfo?.color }">{{ statusInfo?.icon }}</span>
          <div>
            <div class="vfa-status-label" :style="{ color: statusInfo?.color }">{{ statusInfo?.label }}</div>
            <div class="vfa-status-sub">Vérifiée le {{ fmtDateTime(verifiedAt.toISOString()) }}</div>
          </div>
        </div>

        <!-- Titre attestation -->
        <div class="vfa-att-title">
          {{ typeLabels[att.type_attestation] ?? att.type_attestation }}
        </div>

        <!-- Identité -->
        <div class="vfa-identity-block">
          <div class="vfa-avatar">
            {{ (att.etudiant_prenom[0] ?? '') + (att.etudiant_nom[0] ?? '') }}
          </div>
          <div>
            <div class="vfa-nom">{{ att.etudiant_prenom }} {{ att.etudiant_nom }}</div>
            <div v-if="att.numero_etudiant" class="vfa-numero">N° {{ att.numero_etudiant }}</div>
          </div>
        </div>

        <!-- Infos -->
        <div class="vfa-info-grid">
          <div v-if="att.filiere" class="vfa-info-item">
            <span class="vfa-info-label">Filière</span>
            <span class="vfa-info-val">{{ att.filiere }}</span>
          </div>
          <div v-if="att.classe" class="vfa-info-item">
            <span class="vfa-info-label">Classe</span>
            <span class="vfa-info-val">{{ att.classe }}</span>
          </div>
          <div v-if="att.annee_academique" class="vfa-info-item">
            <span class="vfa-info-label">Année académique</span>
            <span class="vfa-info-val">{{ att.annee_academique }}</span>
          </div>
          <div v-if="att.session" class="vfa-info-item">
            <span class="vfa-info-label">Session</span>
            <span class="vfa-info-val" style="text-transform:capitalize;">{{ att.session }}</span>
          </div>
          <div v-if="att.moyenne" class="vfa-info-item">
            <span class="vfa-info-label">Moyenne générale</span>
            <span class="vfa-info-val">{{ Number(att.moyenne).toFixed(2) }} / 20</span>
          </div>
          <div v-if="att.mention" class="vfa-info-item">
            <span class="vfa-info-label">Mention</span>
            <span class="vfa-info-val vfa-mention">{{ att.mention }}</span>
          </div>
          <div class="vfa-info-item">
            <span class="vfa-info-label">Référence</span>
            <span class="vfa-info-val vfa-ref">{{ att.reference }}</span>
          </div>
          <div class="vfa-info-item">
            <span class="vfa-info-label">Émise le</span>
            <span class="vfa-info-val">{{ fmtDate(att.generated_at) }}</span>
          </div>
          <div v-if="att.expires_at" class="vfa-info-item">
            <span class="vfa-info-label">Valide jusqu'au</span>
            <span class="vfa-info-val">{{ fmtDate(att.expires_at) }}</span>
          </div>
          <div v-if="att.generee_par" class="vfa-info-item">
            <span class="vfa-info-label">Émise par</span>
            <span class="vfa-info-val">{{ att.generee_par }}</span>
          </div>
        </div>

        <!-- Sceau -->
        <div class="vfa-seal">
          <div class="vfa-seal-circle">
            <div class="vfa-seal-inner">
              <div class="vfa-seal-txt1">UP'TECH</div>
              <div class="vfa-seal-txt2">OFFICIEL</div>
            </div>
          </div>
          <p class="vfa-seal-caption">Document authentifié par<br><strong>UP'TECH Campus</strong></p>
        </div>

      </div>

      <!-- Contact -->
      <div class="vfa-footer-contact">
        <p>Pour toute question : <strong>uptechformation@gmail.com</strong> · <strong>(+221) 77 841 50 44</strong></p>
        <p>Sicap Amitié 1, Villa N°3031, Dakar — <a href="https://uptechformation.com" target="_blank">www.uptechformation.com</a></p>
      </div>

    </main>
  </div>
</template>

<style scoped>
* { box-sizing: border-box; margin: 0; padding: 0; }

.vfa-root {
  min-height: 100vh;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
}

/* Header */
.vfa-header {
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  padding: 16px 24px;
}
.vfa-header-inner {
  max-width: 680px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 14px;
}
.vfa-logo { width: 40px; height: 40px; border-radius: 8px; }
.vfa-brand { font-size: 18px; font-weight: 800; color: #fff; letter-spacing: -0.3px; }
.vfa-brand-sub { font-size: 11px; color: rgba(255,255,255,0.5); margin-top: 2px; }

/* Main */
.vfa-main {
  max-width: 680px;
  margin: 0 auto;
  padding: 32px 16px 48px;
}

/* Card */
.vfa-card {
  background: #fff;
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 25px 60px rgba(0,0,0,0.4);
}
.vfa-center { display: flex; flex-direction: column; align-items: center; padding: 60px 24px; }

/* Loading */
.vfa-spinner {
  width: 44px; height: 44px;
  border: 3px solid #e5e7eb;
  border-top-color: #E30613;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}
@keyframes spin { to { transform: rotate(360deg); } }
.vfa-loading-txt { color: #6b7280; font-size: 14px; }

/* Erreur */
.vfa-icon-err {
  width: 64px; height: 64px;
  border-radius: 50%;
  background: #fef2f2;
  color: #dc2626;
  font-size: 28px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  margin-bottom: 20px;
}
.vfa-err-title { font-size: 20px; font-weight: 700; color: #111; margin-bottom: 8px; }
.vfa-err-msg { font-size: 14px; color: #dc2626; margin-bottom: 12px; text-align: center; }
.vfa-err-hint { font-size: 13px; color: #6b7280; text-align: center; line-height: 1.6; margin-bottom: 20px; }
.vfa-contact { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; font-size: 12.5px; color: #374151; }

/* Statut */
.vfa-status-banner {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 24px;
  border-bottom: 1.5px solid;
}
.vfa-status-icon {
  width: 40px; height: 40px; border-radius: 50%;
  color: #fff; font-size: 18px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.vfa-status-label { font-size: 16px; font-weight: 700; }
.vfa-status-sub { font-size: 11.5px; color: #6b7280; margin-top: 2px; }

/* Titre attestation */
.vfa-att-title {
  text-align: center;
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
  padding: 20px 24px 4px;
  letter-spacing: -0.3px;
}

/* Identité */
.vfa-identity-block {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 24px 20px;
  border-bottom: 1px solid #f1f5f9;
}
.vfa-avatar {
  width: 56px; height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0f172a, #1e3a5f);
  color: #fff;
  font-size: 20px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  text-transform: uppercase;
  flex-shrink: 0;
}
.vfa-nom { font-size: 20px; font-weight: 800; color: #0f172a; }
.vfa-numero { font-size: 12px; color: #64748b; font-family: monospace; margin-top: 3px; }

/* Info grid */
.vfa-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  padding: 0 24px;
}
.vfa-info-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 14px 0;
  border-bottom: 1px solid #f1f5f9;
}
.vfa-info-item:nth-last-child(-n+2) { border-bottom: none; }
.vfa-info-label { font-size: 10.5px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; }
.vfa-info-val { font-size: 13.5px; font-weight: 600; color: #0f172a; }
.vfa-mention {
  display: inline-block;
  background: #fef3c7; color: #92400e;
  padding: 2px 8px; border-radius: 4px;
  font-size: 12px;
}
.vfa-ref { font-family: monospace; color: #E30613; font-size: 12px; letter-spacing: 0.5px; }

/* Sceau */
.vfa-seal {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px 24px;
  background: #f8fafc;
  border-top: 1px solid #e2e8f0;
}
.vfa-seal-circle {
  width: 64px; height: 64px;
  border-radius: 50%;
  border: 2.5px solid #0f172a;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  position: relative;
}
.vfa-seal-inner {
  width: 46px; height: 46px;
  border-radius: 50%;
  border: 1px solid #b4913c;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 1px;
}
.vfa-seal-txt1 { font-size: 7px; font-weight: 800; color: #0f172a; letter-spacing: 0.5px; }
.vfa-seal-txt2 { font-size: 5px; font-weight: 600; color: #6b7280; letter-spacing: 0.8px; }
.vfa-seal-caption { font-size: 12px; color: #475569; line-height: 1.5; }

/* Footer contact */
.vfa-footer-contact {
  text-align: center;
  padding: 24px 16px 0;
  font-size: 12px;
  color: rgba(255,255,255,0.45);
  line-height: 1.8;
}
.vfa-footer-contact a { color: rgba(255,255,255,0.6); }

@media (max-width: 500px) {
  .vfa-info-grid { grid-template-columns: 1fr; }
  .vfa-info-item:last-child { border-bottom: none; }
}
</style>
