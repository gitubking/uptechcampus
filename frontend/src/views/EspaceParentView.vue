<script setup lang="ts">
import { inject, ref, computed } from 'vue'

const dashboardData = inject<any>('parentDashboard')

const enfants = computed(() => dashboardData?.value?.enfants ?? [])
const selectedIndex = ref(0)
const enfant = computed(() => enfants.value[selectedIndex.value] ?? null)

type Section = 'accueil' | 'notes' | 'absences' | 'paiements'
const activeSection = ref<Section>('accueil')

function selectEnfant(i: number) {
  selectedIndex.value = i
  activeSection.value = 'accueil'
}

function formatDate(dt: string) {
  if (!dt) return '—'
  return new Date(dt).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTime(dt: string) {
  if (!dt) return ''
  return new Date(dt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatAmount(n: number) {
  return Number(n ?? 0).toLocaleString('fr-FR') + ' FCFA'
}

const tauxColor = computed(() => {
  const t = enfant.value?.presences?.taux_presence ?? 100
  if (t >= 80) return '#16a34a'
  if (t >= 60) return '#d97706'
  return '#dc2626'
})

const tauxBg = computed(() => {
  const t = enfant.value?.presences?.taux_presence ?? 100
  if (t >= 80) return '#dcfce7'
  if (t >= 60) return '#fef9c3'
  return '#fee2e2'
})

const payProgress = computed(() => {
  const p = enfant.value?.paiements
  if (!p || !p.frais_totaux) return 0
  return Math.round((p.total_paye / p.frais_totaux) * 100)
})

const mentionColor = computed(() => {
  const m = enfant.value?.notes?.mention
  if (!m) return '#64748b'
  if (m === 'Très Bien' || m === 'Bien') return '#16a34a'
  if (m === 'Assez Bien' || m === 'Passable') return '#d97706'
  return '#dc2626'
})
</script>

<template>
  <div class="ep-root">

    <!-- ══ ÉTAT VIDE ══ -->
    <div v-if="!enfants.length" class="ep-empty">
      <div class="ep-empty-icon">👨‍👩‍👧</div>
      <h2 class="ep-empty-title">Aucun enfant lié</h2>
      <p class="ep-empty-msg">Contactez l'administration pour lier votre compte à un étudiant.</p>
    </div>

    <template v-else>

      <!-- ══ SÉLECTEUR D'ENFANT (si plusieurs) ══ -->
      <div v-if="enfants.length > 1" class="ep-child-selector">
        <button
          v-for="(e, i) in enfants"
          :key="e.etudiant.id"
          :class="['ep-child-btn', selectedIndex === Number(i) && 'ep-child-btn--active']"
          @click="selectEnfant(Number(i))"
        >
          <span class="ep-child-avatar">{{ (e.etudiant.prenom?.[0] ?? '') + (e.etudiant.nom?.[0] ?? '') }}</span>
          <span class="ep-child-name">{{ e.etudiant.prenom }} {{ e.etudiant.nom }}</span>
        </button>
      </div>

      <!-- ══ HEADER ÉTUDIANT ══ -->
      <div v-if="enfant" class="ep-student-header">
        <div class="ep-student-avatar">
          <img v-if="enfant.etudiant.photo_url" :src="enfant.etudiant.photo_url" alt="Photo" class="ep-avatar-img" />
          <span v-else class="ep-avatar-initials">
            {{ (enfant.etudiant.prenom?.[0] ?? '') + (enfant.etudiant.nom?.[0] ?? '') }}
          </span>
        </div>
        <div class="ep-student-info">
          <h1 class="ep-student-name">{{ enfant.etudiant.prenom }} {{ enfant.etudiant.nom }}</h1>
          <div class="ep-student-meta">
            <span v-if="enfant.etudiant.numero_etudiant" class="ep-meta-chip">
              N° {{ enfant.etudiant.numero_etudiant }}
            </span>
            <span v-if="enfant.inscription?.classe" class="ep-meta-chip ep-meta-chip--blue">
              {{ enfant.inscription.classe }}
            </span>
            <span v-if="enfant.inscription?.filiere" class="ep-meta-chip ep-meta-chip--purple">
              {{ enfant.inscription.filiere }}
            </span>
          </div>
          <div v-if="enfant.inscription?.annee_academique" class="ep-student-year">
            Année : {{ enfant.inscription.annee_academique }}
          </div>
        </div>
        <!-- Alerte assiduité dans le header -->
        <div v-if="enfant.presences?.alerte" class="ep-header-alert">
          <span>⚠️</span>
          <span>Alerte assiduité</span>
        </div>
      </div>

      <!-- ══ NAV SECTIONS ══ -->
      <nav v-if="enfant" class="ep-nav">
        <button :class="['ep-nav-btn', activeSection === 'accueil' && 'ep-nav-btn--active']" @click="activeSection = 'accueil'">
          <span>🏠</span> Accueil
        </button>
        <button :class="['ep-nav-btn', activeSection === 'notes' && 'ep-nav-btn--active']" @click="activeSection = 'notes'">
          <span>📋</span> Notes
        </button>
        <button :class="['ep-nav-btn', activeSection === 'absences' && 'ep-nav-btn--active']" @click="activeSection = 'absences'">
          <span>🚨</span> Absences
          <span v-if="enfant.presences?.absent_injustifie > 0" class="ep-nav-badge">
            {{ enfant.presences.absent_injustifie }}
          </span>
        </button>
        <button :class="['ep-nav-btn', activeSection === 'paiements' && 'ep-nav-btn--active']" @click="activeSection = 'paiements'">
          <span>💰</span> Paiements
        </button>
      </nav>

      <!-- ══ SECTION ACCUEIL ══ -->
      <div v-if="enfant && activeSection === 'accueil'" class="ep-section">

        <!-- KPI Cards -->
        <div class="ep-kpi-grid">

          <!-- Assiduité -->
          <div class="ep-kpi-card" :style="{ borderColor: tauxBg, background: 'white' }">
            <div class="ep-kpi-icon" :style="{ background: tauxBg, color: tauxColor }">📊</div>
            <div class="ep-kpi-body">
              <div class="ep-kpi-label">Assiduité</div>
              <div class="ep-kpi-value" :style="{ color: tauxColor }">
                {{ enfant.presences?.taux_presence ?? 100 }}%
              </div>
              <div class="ep-kpi-sub">{{ enfant.presences?.absent ?? 0 }} abs. · {{ enfant.presences?.retard ?? 0 }} retards</div>
            </div>
          </div>

          <!-- Moyenne -->
          <div class="ep-kpi-card">
            <div class="ep-kpi-icon" style="background:#ede9fe;color:#7c3aed;">📋</div>
            <div class="ep-kpi-body">
              <div class="ep-kpi-label">Moyenne générale</div>
              <div class="ep-kpi-value" :style="{ color: mentionColor }">
                {{ enfant.notes?.moyenne != null ? enfant.notes.moyenne + '/20' : '—' }}
              </div>
              <div class="ep-kpi-sub" :style="{ color: mentionColor }">
                {{ enfant.notes?.mention ?? 'Aucune note' }}
              </div>
            </div>
          </div>

          <!-- Paiements -->
          <div class="ep-kpi-card">
            <div class="ep-kpi-icon" :style="{ background: payProgress === 100 ? '#dcfce7' : '#fef9c3', color: payProgress === 100 ? '#16a34a' : '#d97706' }">💰</div>
            <div class="ep-kpi-body">
              <div class="ep-kpi-label">Paiements</div>
              <div class="ep-kpi-value" :style="{ color: payProgress === 100 ? '#16a34a' : '#d97706' }">
                {{ payProgress }}%
              </div>
              <div class="ep-kpi-sub">
                Reste : {{ formatAmount(enfant.paiements?.restant_du ?? 0) }}
              </div>
            </div>
          </div>

          <!-- Classe -->
          <div class="ep-kpi-card">
            <div class="ep-kpi-icon" style="background:#e0f2fe;color:#0369a1;">🎓</div>
            <div class="ep-kpi-body">
              <div class="ep-kpi-label">Classe</div>
              <div class="ep-kpi-value" style="font-size:16px;color:#0f172a;">
                {{ enfant.inscription?.classe ?? '—' }}
              </div>
              <div class="ep-kpi-sub">{{ enfant.inscription?.filiere ?? '—' }}</div>
            </div>
          </div>

        </div>

        <!-- Absences récentes -->
        <div class="ep-card" style="margin-top:20px;">
          <div class="ep-card-header">
            <div class="ep-card-header-left">
              <span class="ep-card-icon">🚨</span>
              <h3 class="ep-card-title">Absences récentes</h3>
            </div>
            <button class="ep-link" @click="activeSection = 'absences'">Tout voir →</button>
          </div>
          <div class="ep-card-body">
            <div v-if="!enfant.absences_recentes?.length" class="ep-empty-list">
              <span>✅</span> Aucune absence récente
            </div>
            <div v-for="abs in enfant.absences_recentes" :key="abs.id" class="ep-abs-row">
              <div class="ep-abs-badge-wrap">
                <span v-if="abs.statut === 'absent' && abs.justifie" class="ep-badge ep-badge--warning">✓ Justifiée</span>
                <span v-else-if="abs.statut === 'absent'" class="ep-badge ep-badge--danger">✗ Absence</span>
                <span v-else class="ep-badge ep-badge--caution">⚠ Retard</span>
              </div>
              <div class="ep-abs-info">
                <div class="ep-abs-matiere">{{ abs.matiere ?? '—' }}</div>
                <div class="ep-abs-date">{{ formatDate(abs.date_debut) }} · {{ formatTime(abs.date_debut) }}</div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ══ SECTION NOTES ══ -->
      <div v-if="enfant && activeSection === 'notes'" class="ep-section">
        <div class="ep-card">
          <div class="ep-card-header">
            <div class="ep-card-header-left">
              <span class="ep-card-icon">📋</span>
              <h3 class="ep-card-title">Relevé de notes</h3>
            </div>
            <div v-if="enfant.notes?.moyenne != null" class="ep-moyenne-badge" :style="{ background: tauxBg, color: mentionColor }">
              Moy. {{ enfant.notes.moyenne }}/20 — {{ enfant.notes.mention }}
            </div>
          </div>
          <div class="ep-card-body">
            <div v-if="!enfant.notes" class="ep-empty-list">
              <span>📚</span> Aucune note disponible pour cette inscription.
            </div>
            <div v-else-if="!enfant.notes.ues?.length" class="ep-empty-list">
              <span>📚</span> Aucune unité d'enseignement trouvée.
            </div>
            <template v-else>
              <div class="ep-notes-table-wrap">
                <table class="ep-notes-table">
                  <thead>
                    <tr>
                      <th>Unité d'enseignement</th>
                      <th>Coef.</th>
                      <th>Note / 20</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="ue in enfant.notes.ues" :key="ue.intitule">
                      <td class="ep-ue-name">{{ ue.intitule }}</td>
                      <td class="ep-ue-coef">{{ ue.coef }}</td>
                      <td>
                        <span v-if="ue.note != null" class="ep-note-chip"
                          :style="{ background: ue.note >= 10 ? '#dcfce7' : '#fee2e2', color: ue.note >= 10 ? '#16a34a' : '#dc2626' }">
                          {{ ue.note }}
                        </span>
                        <span v-else class="ep-note-chip" style="background:#f1f5f9;color:#94a3b8;">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- ══ SECTION ABSENCES ══ -->
      <div v-if="enfant && activeSection === 'absences'" class="ep-section">

        <!-- Alerte -->
        <div v-if="enfant.presences?.alerte" class="ep-alert-banner">
          <span style="font-size:20px;">⚠️</span>
          <div>
            <div style="font-weight:700;font-size:14px;">Alerte assiduité</div>
            <div style="font-size:13px;margin-top:2px;">
              <strong>{{ enfant.presences.absent_injustifie }}</strong> absence(s) injustifiée(s) enregistrée(s).
              Contactez l'établissement pour régulariser.
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="ep-pres-stats">
          <div class="ep-pres-stat ep-pres-stat--green">
            <div class="ep-pres-val">{{ enfant.presences?.present ?? 0 }}</div>
            <div class="ep-pres-lbl">Présences</div>
          </div>
          <div class="ep-pres-stat ep-pres-stat--yellow">
            <div class="ep-pres-val">{{ enfant.presences?.retard ?? 0 }}</div>
            <div class="ep-pres-lbl">Retards</div>
          </div>
          <div class="ep-pres-stat ep-pres-stat--orange">
            <div class="ep-pres-val">{{ enfant.presences?.absent_justifie ?? 0 }}</div>
            <div class="ep-pres-lbl">Abs. justif.</div>
          </div>
          <div class="ep-pres-stat ep-pres-stat--red">
            <div class="ep-pres-val">{{ enfant.presences?.absent_injustifie ?? 0 }}</div>
            <div class="ep-pres-lbl">Abs. injustif.</div>
          </div>
        </div>

        <!-- Taux présence bar -->
        <div class="ep-card" style="margin-bottom:16px;">
          <div class="ep-card-body">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:13px;font-weight:600;color:#334155;">Taux de présence global</span>
              <span style="font-size:15px;font-weight:800;" :style="{ color: tauxColor }">
                {{ enfant.presences?.taux_presence ?? 100 }}%
              </span>
            </div>
            <div style="height:8px;background:#f1f5f9;border-radius:99px;overflow:hidden;">
              <div style="height:100%;border-radius:99px;transition:width 0.5s ease;"
                :style="{ width: (enfant.presences?.taux_presence ?? 100) + '%', background: tauxColor }"></div>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:6px;">{{ enfant.presences?.total ?? 0 }} séance(s) au total</div>
          </div>
        </div>

        <!-- Liste absences récentes (10 dernières) -->
        <div class="ep-card">
          <div class="ep-card-header">
            <div class="ep-card-header-left">
              <span class="ep-card-icon">📅</span>
              <h3 class="ep-card-title">10 dernières absences / retards</h3>
            </div>
          </div>
          <div class="ep-card-body">
            <div v-if="!enfant.absences_recentes?.length" class="ep-empty-list">
              <span>✅</span> Aucune absence ou retard enregistré.
            </div>
            <div v-for="abs in enfant.absences_recentes" :key="abs.id" class="ep-abs-row">
              <div class="ep-abs-badge-wrap">
                <span v-if="abs.statut === 'absent' && abs.justifie" class="ep-badge ep-badge--warning">✓ Justifiée</span>
                <span v-else-if="abs.statut === 'absent'" class="ep-badge ep-badge--danger">✗ Absence</span>
                <span v-else class="ep-badge ep-badge--caution">⚠ Retard</span>
              </div>
              <div class="ep-abs-info">
                <div class="ep-abs-matiere">{{ abs.matiere ?? '—' }}</div>
                <div class="ep-abs-date">{{ formatDate(abs.date_debut) }} · {{ formatTime(abs.date_debut) }}</div>
              </div>
            </div>
            <p v-if="enfant.presences?.absent > 10" class="ep-abs-note">
              Affichage limité aux 10 dernières. Total : {{ enfant.presences.absent }} absence(s).
            </p>
          </div>
        </div>

      </div>

      <!-- ══ SECTION PAIEMENTS ══ -->
      <div v-if="enfant && activeSection === 'paiements'" class="ep-section">
        <div class="ep-card">
          <div class="ep-card-header">
            <div class="ep-card-header-left">
              <span class="ep-card-icon">💰</span>
              <h3 class="ep-card-title">Suivi financier</h3>
            </div>
            <span class="ep-pay-progress-badge"
              :style="{ background: payProgress === 100 ? '#dcfce7' : '#fef9c3', color: payProgress === 100 ? '#16a34a' : '#d97706' }">
              {{ payProgress }}% réglé
            </span>
          </div>
          <div class="ep-card-body">

            <!-- Barre de progression -->
            <div style="margin-bottom:20px;">
              <div style="height:10px;background:#f1f5f9;border-radius:99px;overflow:hidden;margin-bottom:6px;">
                <div style="height:100%;border-radius:99px;transition:width 0.5s ease;"
                  :style="{ width: payProgress + '%', background: payProgress === 100 ? '#22c55e' : '#f59e0b' }"></div>
              </div>
            </div>

            <!-- 3 blocs financiers -->
            <div class="ep-fin-grid">
              <div class="ep-fin-bloc ep-fin-bloc--total">
                <div class="ep-fin-lbl">Frais totaux</div>
                <div class="ep-fin-val">{{ formatAmount(enfant.paiements?.frais_totaux ?? 0) }}</div>
              </div>
              <div class="ep-fin-bloc ep-fin-bloc--paid">
                <div class="ep-fin-lbl">Total payé</div>
                <div class="ep-fin-val" style="color:#16a34a;">{{ formatAmount(enfant.paiements?.total_paye ?? 0) }}</div>
              </div>
              <div class="ep-fin-bloc ep-fin-bloc--due" :class="{ 'ep-fin-bloc--due-alert': (enfant.paiements?.restant_du ?? 0) > 0 }">
                <div class="ep-fin-lbl">Restant dû</div>
                <div class="ep-fin-val" :style="{ color: (enfant.paiements?.restant_du ?? 0) > 0 ? '#dc2626' : '#16a34a' }">
                  {{ formatAmount(enfant.paiements?.restant_du ?? 0) }}
                </div>
              </div>
            </div>

            <div v-if="(enfant.paiements?.restant_du ?? 0) > 0" class="ep-pay-warning">
              ⚠️ Un solde est dû. Veuillez contacter l'administration ou régler via le service comptabilité.
            </div>
            <div v-else class="ep-pay-ok">
              ✅ Situation financière à jour. Aucun solde impayé.
            </div>

          </div>
        </div>
      </div>

    </template>
  </div>
</template>

<style scoped>
.ep-root {
  max-width: 860px;
  margin: 0 auto;
  padding: 20px 16px 60px;
}

/* Empty state */
.ep-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 20px;
  text-align: center;
}
.ep-empty-icon { font-size: 56px; margin-bottom: 16px; }
.ep-empty-title { font-size: 20px; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
.ep-empty-msg { font-size: 14px; color: #64748b; max-width: 320px; }

/* Child selector */
.ep-child-selector {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.ep-child-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: 99px;
  border: 2px solid #e2e8f0;
  background: white;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  transition: all 0.15s;
  white-space: nowrap;
}
.ep-child-btn--active {
  border-color: #6366f1;
  background: #eef2ff;
  color: #4f46e5;
}
.ep-child-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #6366f1;
  color: white;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Student header */
.ep-student-header {
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
  border-radius: 16px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  position: relative;
  flex-wrap: wrap;
}
.ep-student-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.ep-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.ep-avatar-initials {
  font-size: 20px;
  font-weight: 800;
  color: white;
}
.ep-student-info { flex: 1; min-width: 0; }
.ep-student-name {
  font-size: 20px;
  font-weight: 800;
  color: white;
  margin-bottom: 6px;
}
.ep-student-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
.ep-meta-chip {
  background: rgba(255,255,255,0.2);
  color: white;
  padding: 2px 10px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
}
.ep-meta-chip--blue { background: rgba(96,165,250,0.3); }
.ep-meta-chip--purple { background: rgba(192,132,252,0.3); }
.ep-student-year { font-size: 12px; color: rgba(255,255,255,0.7); }
.ep-header-alert {
  background: rgba(239,68,68,0.2);
  border: 1px solid rgba(239,68,68,0.4);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 700;
  color: #fecaca;
}

/* Nav */
.ep-nav {
  display: flex;
  gap: 4px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 6px;
  margin-bottom: 20px;
  overflow-x: auto;
}
.ep-nav-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  transition: all 0.15s;
  white-space: nowrap;
  position: relative;
}
.ep-nav-btn:hover { background: #f8fafc; color: #334155; }
.ep-nav-btn--active { background: #eef2ff; color: #4f46e5; }
.ep-nav-badge {
  background: #ef4444;
  color: white;
  border-radius: 99px;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  min-width: 16px;
  text-align: center;
}

/* Section */
.ep-section { animation: ep-fade-in 0.2s ease; }
@keyframes ep-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* KPI grid */
.ep-kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.ep-kpi-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.ep-kpi-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
  background: #f8fafc;
}
.ep-kpi-body { flex: 1; min-width: 0; }
.ep-kpi-label { font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.ep-kpi-value { font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1; }
.ep-kpi-sub { font-size: 11px; color: #64748b; margin-top: 4px; }

/* Card */
.ep-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}
.ep-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #f1f5f9;
}
.ep-card-header-left { display: flex; align-items: center; gap: 8px; }
.ep-card-icon { font-size: 18px; }
.ep-card-title { font-size: 14px; font-weight: 700; color: #1e293b; }
.ep-card-body { padding: 12px 16px; }
.ep-link { font-size: 13px; color: #6366f1; font-weight: 600; cursor: pointer; background: none; border: none; }
.ep-link:hover { text-decoration: underline; }
.ep-moyenne-badge { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }
.ep-pay-progress-badge { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }

/* Empty list */
.ep-empty-list { display: flex; align-items: center; gap: 8px; padding: 16px 0; color: #94a3b8; font-size: 13px; }

/* Absence rows */
.ep-abs-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f8fafc;
}
.ep-abs-row:last-child { border-bottom: none; }
.ep-abs-badge-wrap { flex-shrink: 0; }
.ep-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border-radius: 99px;
  font-size: 11px;
  font-weight: 600;
}
.ep-badge--danger { background: #fef2f2; color: #dc2626; }
.ep-badge--warning { background: #fff7ed; color: #d97706; }
.ep-badge--caution { background: #fef9c3; color: #b45309; }
.ep-abs-info { flex: 1; min-width: 0; }
.ep-abs-matiere { font-weight: 600; font-size: 13px; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ep-abs-date { font-size: 12px; color: #64748b; margin-top: 1px; }
.ep-abs-note { font-size: 12px; color: #94a3b8; margin-top: 8px; font-style: italic; }

/* Alert banner */
.ep-alert-banner {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 16px;
  color: #991b1b;
}

/* Presence stats */
.ep-pres-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.ep-pres-stat {
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}
.ep-pres-stat--green { background: #f0fdf4; border: 1px solid #bbf7d0; }
.ep-pres-stat--yellow { background: #fffbeb; border: 1px solid #fde68a; }
.ep-pres-stat--orange { background: #fff7ed; border: 1px solid #fed7aa; }
.ep-pres-stat--red { background: #fef2f2; border: 1px solid #fecaca; }
.ep-pres-val { font-size: 22px; font-weight: 800; color: #0f172a; }
.ep-pres-lbl { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-top: 2px; }

/* Notes table */
.ep-notes-table-wrap { overflow-x: auto; }
.ep-notes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ep-notes-table thead th {
  text-align: left;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #64748b;
  border-bottom: 2px solid #f1f5f9;
}
.ep-notes-table tbody tr:hover { background: #f8fafc; }
.ep-notes-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid #f1f5f9;
  color: #334155;
}
.ep-ue-name { font-weight: 600; color: #1e293b; }
.ep-ue-coef { text-align: center; color: #64748b; }
.ep-note-chip {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 99px;
  font-weight: 700;
  font-size: 12px;
}

/* Finance grid */
.ep-fin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.ep-fin-bloc {
  border-radius: 10px;
  padding: 14px 16px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
}
.ep-fin-lbl { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
.ep-fin-val { font-size: 16px; font-weight: 800; color: #0f172a; }
.ep-fin-bloc--due-alert { background: #fef2f2; border-color: #fecaca; }
.ep-pay-warning {
  background: #fef9c3;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: #92400e;
}
.ep-pay-ok {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: #15803d;
}

/* Responsive */
@media (max-width: 640px) {
  .ep-pres-stats { grid-template-columns: repeat(2, 1fr); }
  .ep-kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .ep-student-name { font-size: 17px; }
}
</style>
