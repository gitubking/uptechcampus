<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import api from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const isDG = computed(() => auth.user?.role === 'dg')
const isDGorDP = computed(() => auth.user?.role === 'dg' || auth.user?.role === 'dir_peda')

// ── Onglets ──────────────────────────────────────────────────────────
type Tab = 'envoyer' | 'templates' | 'historique'
const activeTab = ref<Tab>('envoyer')

// ── Données de référence ─────────────────────────────────────────────
interface AnneeAcademique { id: number; libelle: string; actif: boolean }
interface Classe { id: number; nom: string; filiere_nom: string }
interface Filiere { id: number; nom: string }
interface Etudiant { id: number; nom: string; prenom: string; numero_etudiant: string }
interface Template { id: number; type: string; label: string; sujet: string; corps: string; variables: string }
interface Notif {
  id: number; type: string; sujet: string; canal: string
  nb_destinataires: number; nb_envoyes: number; nb_erreurs: number
  cible_type: string; envoye_par_nom: string; created_at: string
}

const annees = ref<AnneeAcademique[]>([])
const classes = ref<Classe[]>([])
const filieres = ref<Filiere[]>([])
const templates = ref<Template[]>([])

// ── Formulaire Envoi ─────────────────────────────────────────────────
const form = ref({
  type: 'resultats',
  canal: 'email',
  cible_type: 'tous',
  cible_id: null as number | null,
  annee_id: null as number | null,
  sujet: '',
  corps: '',
  vars_extra: {} as Record<string, string>,
})
const sending = ref(false)
const sendResult = ref<{ ok: boolean; message: string; nb_envoyes?: number; nb_destinataires?: number } | null>(null)
const previewing = ref(false)

// ── Templates ────────────────────────────────────────────────────────
const editingTemplate = ref<Template | null>(null)
const savingTemplate = ref(false)

// ── Historique ───────────────────────────────────────────────────────
const history = ref<Notif[]>([])
const histTotal = ref(0)
const histPage = ref(0)
const histLoading = ref(false)
const histFilter = ref('')

// ── Chargement ───────────────────────────────────────────────────────
onMounted(async () => {
  const [a, c, f, t] = await Promise.all([
    api.get('/annees-academiques'),
    api.get('/classes'),
    api.get('/filieres'),
    api.get('/notification-templates'),
  ])
  annees.value = a.data
  const activeAnnee = a.data.find((x: AnneeAcademique) => x.actif)
  if (activeAnnee) form.value.annee_id = activeAnnee.id
  classes.value = c.data
  filieres.value = f.data
  templates.value = t.data

  // Pré-remplir depuis le template initial
  updateFormFromTemplate()
  loadHistory()
})

function updateFormFromTemplate() {
  const tpl = templates.value.find(t => t.type === form.value.type)
  if (tpl) {
    form.value.sujet = tpl.sujet
    form.value.corps = tpl.corps
  }
}

// ── Destinataires calculés ────────────────────────────────────────────
const cibleLabel = computed(() => {
  if (form.value.cible_type === 'tous') return 'Tous les étudiants actifs'
  if (form.value.cible_type === 'classe') {
    const cl = classes.value.find(c => c.id === form.value.cible_id)
    return cl ? `Classe : ${cl.nom}` : 'Classe sélectionnée'
  }
  if (form.value.cible_type === 'filiere') {
    const f = filieres.value.find(f => f.id === form.value.cible_id)
    return f ? `Filière : ${f.nom}` : 'Filière sélectionnée'
  }
  return 'Cible sélectionnée'
})

const currentTpl = computed(() => templates.value.find(t => t.type === form.value.type))

const variablesAvailables = computed(() => {
  const tpl = currentTpl.value
  if (!tpl) return []
  return tpl.variables.split(',').map(v => v.trim()).filter(Boolean)
})

// ── Envoi ────────────────────────────────────────────────────────────
async function sendNotification() {
  if (!form.value.sujet || !form.value.corps) return
  sending.value = true
  sendResult.value = null
  try {
    const payload: any = {
      type: form.value.type,
      sujet: form.value.sujet,
      corps: form.value.corps,
      canal: form.value.canal,
      cible_type: form.value.cible_type,
      annee_id: form.value.annee_id,
    }
    if (form.value.cible_type !== 'tous') payload.cible_id = form.value.cible_id
    const { data } = await api.post('/notifications/send', payload)
    sendResult.value = { ok: true, message: data.message, nb_envoyes: data.nb_envoyes, nb_destinataires: data.nb_destinataires }
    loadHistory()
  } catch (e: any) {
    const msg = e?.response?.data?.error ?? e?.message ?? 'Erreur lors de l\'envoi'
    sendResult.value = { ok: false, message: msg }
  } finally {
    sending.value = false
  }
}

// ── Templates ────────────────────────────────────────────────────────
function startEditTemplate(tpl: Template) {
  editingTemplate.value = { ...tpl }
}
async function saveTemplate() {
  if (!editingTemplate.value) return
  savingTemplate.value = true
  try {
    const { data } = await api.put(`/notification-templates/${editingTemplate.value.id}`, {
      sujet: editingTemplate.value.sujet,
      corps: editingTemplate.value.corps,
    })
    const idx = templates.value.findIndex(t => t.id === data.id)
    if (idx !== -1) templates.value[idx] = data
    editingTemplate.value = null
    updateFormFromTemplate()
  } finally {
    savingTemplate.value = false
  }
}

// ── Historique ───────────────────────────────────────────────────────
async function loadHistory() {
  histLoading.value = true
  try {
    const { data } = await api.get('/notifications', {
      params: { limit: 20, offset: histPage.value * 20, type: histFilter.value || undefined },
    })
    history.value = data.notifications
    histTotal.value = data.total
  } finally {
    histLoading.value = false
  }
}

// ── Helpers affichage ────────────────────────────────────────────────
const typeIcons: Record<string, string> = {
  resultats: '📊',
  convocation: '📋',
  paiement: '💳',
  custom: '✉️',
}
const canalLabels: Record<string, string> = {
  email: 'Email',
  sms: 'SMS',
  les_deux: 'Email + SMS',
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="notif-page">

    <!-- ═══════ HEADER ════════════════════════════════════════════════ -->
    <div class="notif-header">
      <div>
        <h1 class="notif-title">Notifications automatiques</h1>
        <p class="notif-subtitle">Email aux étudiants : résultats, paiements, convocations</p>
      </div>
    </div>

    <!-- ═══════ TABS ══════════════════════════════════════════════════ -->
    <div class="notif-tabs">
      <button
        v-for="tab in ([['envoyer','📤 Envoyer'],['templates','📋 Templates'],['historique','📜 Historique']] as [Tab,string][])"
        :key="tab[0]"
        class="notif-tab"
        :class="{ active: activeTab === tab[0] }"
        @click="activeTab = tab[0]; if(tab[0]==='historique') loadHistory()"
      >{{ tab[1] }}</button>
    </div>

    <!-- ══════════════════════════════════════════════════════════════ -->
    <!-- TAB : ENVOYER                                                  -->
    <!-- ══════════════════════════════════════════════════════════════ -->
    <div v-if="activeTab === 'envoyer'" class="notif-card">
      <div class="notif-send-grid">

        <!-- Colonne gauche : paramètres -->
        <div class="notif-send-left">
          <h2 class="notif-section-title">Paramètres d'envoi</h2>

          <!-- Type -->
          <div class="notif-field">
            <label class="notif-label">Type de notification</label>
            <div class="notif-type-grid">
              <button
                v-for="tpl in templates"
                :key="tpl.type"
                class="notif-type-btn"
                :class="{ active: form.type === tpl.type }"
                @click="form.type = tpl.type; updateFormFromTemplate()"
              >
                <span class="notif-type-icon">{{ typeIcons[tpl.type] || '✉️' }}</span>
                <span>{{ tpl.label }}</span>
              </button>
            </div>
          </div>

          <!-- Canal -->
          <div class="notif-field">
            <label class="notif-label">Canal d'envoi</label>
            <div class="notif-canal-grid">
              <label v-for="opt in [['email','📧 Email'],['sms','📱 SMS'],['les_deux','📧+📱 Email+SMS']]" :key="opt[0]" class="notif-canal-opt" :class="{ active: form.canal === opt[0] }">
                <input type="radio" v-model="form.canal" :value="opt[0]" style="display:none" />
                {{ opt[1] }}
              </label>
            </div>
            <p v-if="form.canal !== 'email'" class="notif-warn">⚠️ Le SMS nécessite une intégration API (Orange SMS / Twilio). Configurez la variable SMS_API_KEY.</p>
          </div>

          <!-- Destinataires -->
          <div class="notif-field">
            <label class="notif-label">Destinataires</label>
            <select v-model="form.cible_type" class="notif-select" @change="form.cible_id = null">
              <option value="tous">Tous les étudiants actifs</option>
              <option value="classe">Par classe</option>
              <option value="filiere">Par filière</option>
            </select>
            <select v-if="form.cible_type === 'classe'" v-model="form.cible_id" class="notif-select" style="margin-top:6px">
              <option :value="null">— Choisir une classe —</option>
              <option v-for="cl in classes" :key="cl.id" :value="cl.id">{{ cl.nom }}</option>
            </select>
            <select v-if="form.cible_type === 'filiere'" v-model="form.cible_id" class="notif-select" style="margin-top:6px">
              <option :value="null">— Choisir une filière —</option>
              <option v-for="f in filieres" :key="f.id" :value="f.id">{{ f.nom }}</option>
            </select>
          </div>

          <!-- Année -->
          <div class="notif-field">
            <label class="notif-label">Année académique (filtre)</label>
            <select v-model="form.annee_id" class="notif-select">
              <option :value="null">Toutes les années</option>
              <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
            </select>
          </div>

          <!-- Variables disponibles -->
          <div v-if="variablesAvailables.length" class="notif-vars-box">
            <p class="notif-vars-title">Variables disponibles</p>
            <div class="notif-vars-list">
              <code v-for="v in variablesAvailables" :key="v" class="notif-var-chip">{{ '{' + v + '}' }}</code>
            </div>
          </div>
        </div>

        <!-- Colonne droite : message -->
        <div class="notif-send-right">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
            <h2 class="notif-section-title" style="margin:0">Message</h2>
            <button class="notif-preview-btn" @click="previewing = !previewing">
              {{ previewing ? '✏️ Éditer' : '👁 Aperçu' }}
            </button>
          </div>

          <!-- Éditeur -->
          <div v-if="!previewing">
            <div class="notif-field">
              <label class="notif-label">Objet *</label>
              <input v-model="form.sujet" class="notif-input" placeholder="Objet de l'email" />
            </div>
            <div class="notif-field">
              <label class="notif-label">Corps du message * <span style="color:#aaa;font-weight:400">(HTML supporté)</span></label>
              <textarea v-model="form.corps" class="notif-textarea" rows="12" placeholder="Contenu du message..."></textarea>
            </div>
          </div>

          <!-- Aperçu -->
          <div v-else class="notif-preview-wrap">
            <div class="notif-preview-header">
              <strong>Objet :</strong> {{ form.sujet || '(vide)' }}
            </div>
            <div class="notif-preview-body" v-html="form.corps"></div>
          </div>

          <!-- Cible résumée -->
          <div class="notif-cible-badge">
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="flex-shrink:0">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            {{ cibleLabel }}
          </div>

          <!-- Résultat envoi -->
          <div v-if="sendResult" class="notif-result" :class="sendResult.ok ? 'notif-result--ok' : 'notif-result--err'">
            <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                :d="sendResult.ok
                  ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  : 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'" />
            </svg>
            <span>{{ sendResult.message }}</span>
            <span v-if="sendResult.ok && sendResult.nb_envoyes !== undefined" class="notif-result-stat">
              {{ sendResult.nb_envoyes }}/{{ sendResult.nb_destinataires }} envoyés
            </span>
          </div>

          <!-- Bouton envoi -->
          <button
            class="uc-btn uc-btn-primary notif-send-btn"
            :disabled="sending || !form.sujet || !form.corps || (form.cible_type !== 'tous' && !form.cible_id)"
            @click="sendNotification"
          >
            <svg v-if="sending" class="notif-spin" width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            <svg v-else width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>
            </svg>
            {{ sending ? 'Envoi en cours...' : 'Envoyer la notification' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════ -->
    <!-- TAB : TEMPLATES                                                -->
    <!-- ══════════════════════════════════════════════════════════════ -->
    <div v-else-if="activeTab === 'templates'" class="notif-card">
      <p class="notif-help">Personnalisez les modèles de messages. Les variables entre <code>{accolades}</code> sont remplacées automatiquement lors de l'envoi.</p>

      <div v-for="tpl in templates" :key="tpl.id" class="notif-tpl-item">
        <div class="notif-tpl-head" @click="editingTemplate?.id === tpl.id ? editingTemplate = null : startEditTemplate(tpl)">
          <div class="notif-tpl-title">
            <span>{{ typeIcons[tpl.type] || '✉️' }}</span>
            <strong>{{ tpl.label }}</strong>
            <code class="notif-tpl-type">{{ tpl.type }}</code>
          </div>
          <div class="notif-tpl-vars">
            <span v-for="v in tpl.variables.split(',').filter(Boolean)" :key="v" class="notif-var-chip">{{ '{' + v.trim() + '}' }}</span>
          </div>
          <button class="notif-tpl-edit-btn" v-if="isDGorDP">
            {{ editingTemplate?.id === tpl.id ? '▲ Fermer' : '✏️ Modifier' }}
          </button>
        </div>

        <!-- Formulaire inline édition -->
        <div v-if="editingTemplate?.id === tpl.id && isDGorDP" class="notif-tpl-form">
          <div class="notif-field">
            <label class="notif-label">Objet</label>
            <input v-model="editingTemplate.sujet" class="notif-input" />
          </div>
          <div class="notif-field">
            <label class="notif-label">Corps du message (HTML)</label>
            <textarea v-model="editingTemplate.corps" class="notif-textarea" rows="8"></textarea>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
            <button class="uc-btn uc-btn-outline" @click="editingTemplate = null">Annuler</button>
            <button class="uc-btn uc-btn-primary" :disabled="savingTemplate" @click="saveTemplate">
              {{ savingTemplate ? 'Enregistrement...' : 'Sauvegarder' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ══════════════════════════════════════════════════════════════ -->
    <!-- TAB : HISTORIQUE                                               -->
    <!-- ══════════════════════════════════════════════════════════════ -->
    <div v-else-if="activeTab === 'historique'" class="notif-card">
      <div class="notif-hist-toolbar">
        <select v-model="histFilter" class="notif-select" style="width:200px" @change="histPage=0;loadHistory()">
          <option value="">Tous les types</option>
          <option value="resultats">📊 Résultats</option>
          <option value="convocation">📋 Convocations</option>
          <option value="paiement">💳 Paiements</option>
          <option value="custom">✉️ Personnalisés</option>
        </select>
        <span class="notif-hist-total">{{ histTotal }} notification(s)</span>
        <button class="uc-btn uc-btn-outline notif-refresh-btn" @click="loadHistory">
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
          Rafraîchir
        </button>
      </div>

      <div v-if="histLoading" class="notif-loading">Chargement...</div>
      <div v-else-if="history.length === 0" class="notif-empty">Aucune notification envoyée pour l'instant.</div>
      <div v-else>
        <div v-for="n in history" :key="n.id" class="notif-hist-item">
          <div class="notif-hist-icon">{{ typeIcons[n.type] || '✉️' }}</div>
          <div class="notif-hist-main">
            <div class="notif-hist-sujet">{{ n.sujet }}</div>
            <div class="notif-hist-meta">
              <span class="notif-hist-canal">{{ canalLabels[n.canal] || n.canal }}</span>
              <span class="notif-hist-sep">·</span>
              <span>{{ fmtDate(n.created_at) }}</span>
              <span v-if="n.envoye_par_nom" class="notif-hist-sep">·</span>
              <span v-if="n.envoye_par_nom" style="color:#888">par {{ n.envoye_par_nom }}</span>
            </div>
          </div>
          <div class="notif-hist-stats">
            <span class="notif-stat-ok">✓ {{ n.nb_envoyes }}</span>
            <span v-if="n.nb_erreurs > 0" class="notif-stat-err">✗ {{ n.nb_erreurs }}</span>
            <span class="notif-stat-total">/ {{ n.nb_destinataires }}</span>
          </div>
        </div>

        <!-- Pagination -->
        <div v-if="histTotal > 20" class="notif-pagination">
          <button class="uc-btn uc-btn-outline" :disabled="histPage === 0" @click="histPage--; loadHistory()">← Précédent</button>
          <span>Page {{ histPage + 1 }} / {{ Math.ceil(histTotal / 20) }}</span>
          <button class="uc-btn uc-btn-outline" :disabled="(histPage + 1) * 20 >= histTotal" @click="histPage++; loadHistory()">Suivant →</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.notif-page { padding: 24px; max-width: 1100px; margin: 0 auto; }
.notif-header { margin-bottom: 18px; }
.notif-title { font-size: 18px; font-weight: 700; color: #111; margin: 0; }
.notif-subtitle { font-size: 12px; color: #aaa; margin: 4px 0 0; }

/* Tabs */
.notif-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 2px solid #f0f0f0; }
.notif-tab {
  padding: 8px 18px; font-size: 13px; font-weight: 600; color: #888;
  background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer;
  margin-bottom: -2px; transition: color 0.15s, border-color 0.15s;
}
.notif-tab.active { color: #E30613; border-bottom-color: #E30613; }
.notif-tab:hover:not(.active) { color: #555; }

/* Card */
.notif-card {
  background: #fff; border: 1px solid #f0f0f0; border-radius: 8px; padding: 20px 24px;
}

/* Send grid */
.notif-send-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
@media (max-width: 800px) { .notif-send-grid { grid-template-columns: 1fr; } }

.notif-section-title { font-size: 14px; font-weight: 700; color: #111; margin: 0 0 14px; }

/* Fields */
.notif-field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
.notif-label { font-size: 11.5px; font-weight: 600; color: #555; }
.notif-select, .notif-input {
  height: 36px; border: 1px solid #e5e7eb; border-radius: 6px;
  padding: 0 10px; font-size: 13px; color: #111; background: #fff; outline: none;
}
.notif-select:focus, .notif-input:focus { border-color: #E30613; }
.notif-textarea {
  border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px;
  font-size: 12.5px; color: #111; background: #fff; outline: none;
  resize: vertical; font-family: 'Courier New', monospace; line-height: 1.5;
}
.notif-textarea:focus { border-color: #E30613; }

/* Type buttons */
.notif-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.notif-type-btn {
  display: flex; align-items: center; gap: 7px; padding: 8px 10px;
  border: 1.5px solid #e5e7eb; border-radius: 7px; background: #fff;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: border-color 0.15s, background 0.15s;
  color: #555;
}
.notif-type-btn.active { border-color: #E30613; background: #fff5f5; color: #E30613; }
.notif-type-btn:hover:not(.active) { background: #f9fafb; }
.notif-type-icon { font-size: 16px; }

/* Canal */
.notif-canal-grid { display: flex; gap: 6px; flex-wrap: wrap; }
.notif-canal-opt {
  padding: 6px 12px; border: 1.5px solid #e5e7eb; border-radius: 99px;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: border-color 0.15s, background 0.15s;
  color: #555;
}
.notif-canal-opt.active { border-color: #E30613; background: #fff5f5; color: #E30613; }
.notif-warn { font-size: 11.5px; color: #d97706; margin: 4px 0 0; background: #fef9c3; padding: 6px 10px; border-radius: 5px; }

/* Variables */
.notif-vars-box { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 7px; padding: 10px 12px; margin-bottom: 4px; }
.notif-vars-title { font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 6px; }
.notif-vars-list { display: flex; flex-wrap: wrap; gap: 5px; }
.notif-var-chip { font-size: 11px; background: #e0e7ff; color: #3730a3; border-radius: 4px; padding: 2px 7px; font-family: monospace; }

/* Preview */
.notif-preview-btn {
  font-size: 12px; font-weight: 600; padding: 5px 12px; border: 1px solid #e5e7eb;
  border-radius: 6px; cursor: pointer; background: #f9fafb; color: #555;
}
.notif-preview-wrap { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
.notif-preview-header { padding: 10px 14px; background: #f0f4f8; font-size: 12px; border-bottom: 1px solid #e5e7eb; color: #333; }
.notif-preview-body { padding: 14px; font-size: 13px; color: #333; min-height: 150px; }

/* Cible badge */
.notif-cible-badge {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: #555; background: #f0f9ff; border: 1px solid #bae6fd;
  border-radius: 6px; padding: 7px 12px; margin-bottom: 14px;
}

/* Result */
.notif-result {
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; padding: 9px 14px; border-radius: 7px; margin-bottom: 14px;
}
.notif-result--ok { background: #dcfce7; border: 1px solid #86efac; color: #15803d; }
.notif-result--err { background: #fee2e2; border: 1px solid #fca5a5; color: #b91c1c; }
.notif-result-stat { margin-left: auto; font-weight: 700; }

/* Send button */
.notif-send-btn { width: 100%; justify-content: center; gap: 8px; height: 40px; }
.notif-spin { animation: notif-spin 0.8s linear infinite; }
@keyframes notif-spin { to { transform: rotate(360deg); } }

/* Templates */
.notif-help { font-size: 12.5px; color: #666; margin-bottom: 16px; }
.notif-tpl-item { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 10px; overflow: hidden; }
.notif-tpl-head {
  display: flex; align-items: center; gap: 12px; padding: 12px 16px;
  cursor: pointer; background: #fafafa; transition: background 0.15s;
}
.notif-tpl-head:hover { background: #f3f4f6; }
.notif-tpl-title { display: flex; align-items: center; gap: 8px; flex: 1; font-size: 13px; }
.notif-tpl-type { font-size: 10.5px; background: #e5e7eb; padding: 1px 6px; border-radius: 4px; color: #555; font-family: monospace; }
.notif-tpl-vars { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.notif-tpl-edit-btn {
  font-size: 11.5px; font-weight: 600; padding: 4px 10px;
  border: 1px solid #e5e7eb; border-radius: 5px; cursor: pointer; background: #fff; color: #555;
  white-space: nowrap;
}
.notif-tpl-form { padding: 14px 16px; border-top: 1px solid #e5e7eb; background: #fff; }

/* Historique */
.notif-hist-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.notif-hist-total { font-size: 12px; color: #888; margin-left: 4px; }
.notif-refresh-btn { height: 32px; font-size: 12px; gap: 5px; padding: 0 10px; margin-left: auto; }
.notif-loading { text-align: center; padding: 24px; color: #aaa; font-size: 13px; }
.notif-empty { text-align: center; padding: 32px; color: #aaa; font-size: 13px; font-style: italic; }
.notif-hist-item {
  display: flex; align-items: flex-start; gap: 12px; padding: 12px 0;
  border-bottom: 1px solid #f3f4f6;
}
.notif-hist-item:last-child { border-bottom: none; }
.notif-hist-icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
.notif-hist-main { flex: 1; min-width: 0; }
.notif-hist-sujet { font-size: 13px; font-weight: 600; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.notif-hist-meta { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: #888; margin-top: 3px; flex-wrap: wrap; }
.notif-hist-canal { background: #e0e7ff; color: #3730a3; border-radius: 4px; padding: 1px 6px; font-size: 10.5px; font-weight: 600; }
.notif-hist-sep { color: #ccc; }
.notif-hist-stats { display: flex; align-items: center; gap: 5px; flex-shrink: 0; font-size: 12px; }
.notif-stat-ok { color: #16a34a; font-weight: 700; }
.notif-stat-err { color: #dc2626; font-weight: 700; }
.notif-stat-total { color: #888; }
.notif-pagination { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 16px; font-size: 13px; color: #555; }
</style>
