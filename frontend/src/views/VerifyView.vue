<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const loading = ref(true)
const error = ref<string | null>(null)
const etudiant = ref<any>(null)
const verifiedAt = ref(new Date())

const statutLabel: Record<string, string> = {
  inscrit_actif: 'Actif', pre_inscrit: 'Pré-inscrit', en_examen: 'En examen',
  diplome: 'Diplômé', abandonne: 'Abandonné',
}
const statutColor: Record<string, string> = {
  inscrit_actif: '#15803d', pre_inscrit: '#d97706',
  en_examen: '#2563eb', diplome: '#7c3aed', abandonne: '#dc2626',
}
const statutBg: Record<string, string> = {
  inscrit_actif: '#dcfce7', pre_inscrit: '#fef3c7',
  en_examen: '#dbeafe', diplome: '#ede9fe', abandonne: '#fee2e2',
}

const statutColorVal = computed(() => etudiant.value ? (statutColor[etudiant.value.statut] ?? '#6b7280') : '#6b7280')
const statutBgVal = computed(() => etudiant.value ? (statutBg[etudiant.value.statut] ?? '#f3f4f6') : '#f3f4f6')

const initials = computed(() => {
  if (!etudiant.value) return '?'
  return (etudiant.value.prenom[0] ?? '') + (etudiant.value.nom[0] ?? '')
})

const fmtTime = (d: Date) =>
  d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) +
  ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

onMounted(async () => {
  const numero = route.params.numero as string
  try {
    const resp = await fetch(`/api/verify/${encodeURIComponent(numero)}`)
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}))
      error.value = j.message ?? 'Étudiant introuvable.'
      return
    }
    etudiant.value = await resp.json()
    verifiedAt.value = new Date()
  } catch {
    error.value = 'Erreur de connexion. Veuillez réessayer.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="vfy-root">

    <!-- Header -->
    <div class="vfy-header">
      <div class="vfy-logo-wrap">
        <img src="/icons/icon-192.png" alt="UPTECH" class="vfy-logo" />
        <div>
          <div class="vfy-inst-tag">Institut de Formation</div>
          <div class="vfy-inst-name">UPTECH Campus</div>
        </div>
      </div>
      <div class="vfy-scan-badge">🔍 Vérification</div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="vfy-center">
      <svg class="vfy-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="#E30613" stroke-width="4"/>
        <path fill="#E30613" class="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
      </svg>
      <p class="vfy-loading-txt">Vérification en cours…</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="vfy-center">
      <div class="vfy-error-icon">❌</div>
      <h2 class="vfy-error-title">Identité non reconnue</h2>
      <p class="vfy-error-msg">{{ error }}</p>
      <p class="vfy-error-sub">Ce QR code ne correspond à aucun étudiant enregistré dans le système UPTECH Campus.</p>
    </div>

    <!-- Student card -->
    <div v-else-if="etudiant" class="vfy-card">

      <!-- Verified stamp -->
      <div class="vfy-stamp">
        <span class="vfy-stamp-icon">✅</span>
        <span class="vfy-stamp-txt">Identité vérifiée</span>
      </div>

      <!-- Photo -->
      <div class="vfy-photo-wrap">
        <img v-if="etudiant.photo_path?.startsWith('data:')"
          :src="etudiant.photo_path" alt="Photo" class="vfy-photo" />
        <div v-else class="vfy-initials">{{ initials }}</div>
      </div>

      <!-- Name -->
      <h1 class="vfy-name">{{ etudiant.prenom }} <span>{{ etudiant.nom.toUpperCase() }}</span></h1>
      <p class="vfy-numero">{{ etudiant.numero_etudiant }}</p>

      <!-- Status badge -->
      <div class="vfy-statut" :style="{ background: statutBgVal, color: statutColorVal }">
        {{ statutLabel[etudiant.statut] ?? etudiant.statut }}
      </div>

      <!-- Info pills -->
      <div class="vfy-info-grid">
        <div v-if="etudiant.filiere_nom" class="vfy-info-item">
          <span class="vfy-info-label">Filière</span>
          <span class="vfy-info-value">{{ etudiant.filiere_nom }}</span>
        </div>
        <div v-if="etudiant.classe?.nom" class="vfy-info-item">
          <span class="vfy-info-label">Classe</span>
          <span class="vfy-info-value">{{ etudiant.classe.nom }}</span>
        </div>
        <div v-if="etudiant.annee_libelle" class="vfy-info-item">
          <span class="vfy-info-label">Année académique</span>
          <span class="vfy-info-value">{{ etudiant.annee_libelle }}</span>
        </div>
      </div>

      <!-- Verified timestamp -->
      <div class="vfy-timestamp">
        <svg class="vfy-ts-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        Vérifié le {{ fmtTime(verifiedAt) }}
      </div>

    </div>

    <!-- Footer -->
    <div class="vfy-footer">
      <p>Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique</p>
      <p>Sicap Amitié 1, Villa N°3031 — Dakar | uptechformation.com</p>
    </div>

  </div>
</template>

<style scoped>
* { box-sizing: border-box; }
.vfy-root {
  min-height: 100vh; background: #f8f9fa;
  display: flex; flex-direction: column; align-items: center;
  padding: 0; font-family: 'Arial', sans-serif;
}

/* Header */
.vfy-header {
  width: 100%; background: #fff; border-bottom: 3px solid #E30613;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; gap: 12px;
}
.vfy-logo-wrap { display: flex; align-items: center; gap: 10px; }
.vfy-logo { width: 40px; height: 40px; object-fit: contain; }
.vfy-inst-tag { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #E30613; }
.vfy-inst-name { font-size: 15px; font-weight: 900; color: #111; }
.vfy-scan-badge {
  font-size: 11px; font-weight: 700; background: #f3f4f6;
  border: 1px solid #e5e7eb; padding: 4px 10px; border-radius: 20px; color: #374151;
}

/* Loading/Error center */
.vfy-center {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 40px 20px; text-align: center;
}
.vfy-spin { width: 48px; height: 48px; animation: spin 0.9s linear infinite; margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }
.vfy-loading-txt { font-size: 14px; color: #6b7280; }
.vfy-error-icon { font-size: 56px; margin-bottom: 12px; }
.vfy-error-title { font-size: 20px; font-weight: 800; color: #111; margin: 0 0 8px; }
.vfy-error-msg { font-size: 13px; color: #dc2626; font-weight: 600; margin: 0 0 8px; }
.vfy-error-sub { font-size: 12px; color: #9ca3af; max-width: 300px; line-height: 1.6; }

/* Card */
.vfy-card {
  flex: 1; width: 100%; max-width: 420px;
  display: flex; flex-direction: column; align-items: center;
  padding: 28px 24px 24px; gap: 0;
}

/* Verified stamp */
.vfy-stamp {
  display: inline-flex; align-items: center; gap: 6px;
  background: #dcfce7; border: 1.5px solid #86efac;
  padding: 6px 16px; border-radius: 30px; margin-bottom: 22px;
}
.vfy-stamp-icon { font-size: 16px; }
.vfy-stamp-txt { font-size: 13px; font-weight: 800; color: #15803d; text-transform: uppercase; letter-spacing: 0.5px; }

/* Photo */
.vfy-photo-wrap {
  width: 110px; height: 110px; border-radius: 50%;
  overflow: hidden; border: 4px solid #fff;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15); margin-bottom: 16px;
  background: #fee2e2; display: flex; align-items: center; justify-content: center;
}
.vfy-photo { width: 100%; height: 100%; object-fit: cover; }
.vfy-initials { font-size: 36px; font-weight: 900; color: #E30613; text-transform: uppercase; }

/* Name */
.vfy-name {
  font-size: 22px; font-weight: 700; color: #111;
  text-align: center; margin: 0 0 4px; line-height: 1.2;
}
.vfy-name span { font-weight: 900; }
.vfy-numero {
  font-family: monospace; font-size: 12px; color: #9ca3af;
  letter-spacing: 0.5px; margin: 0 0 14px;
}

/* Status */
.vfy-statut {
  font-size: 13px; font-weight: 700; padding: 5px 18px;
  border-radius: 30px; margin-bottom: 20px;
}

/* Info pills */
.vfy-info-grid {
  width: 100%; display: flex; flex-direction: column; gap: 8px; margin-bottom: 24px;
}
.vfy-info-item {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
  padding: 10px 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px;
}
.vfy-info-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; }
.vfy-info-value { font-size: 13px; font-weight: 700; color: #111; text-align: right; }

/* Timestamp */
.vfy-timestamp {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: #9ca3af;
}
.vfy-ts-icon { width: 14px; height: 14px; flex-shrink: 0; }

/* Footer */
.vfy-footer {
  width: 100%; background: #111; color: #9ca3af;
  text-align: center; padding: 14px 20px;
  font-size: 10px; line-height: 1.7;
  margin-top: auto;
}
</style>
