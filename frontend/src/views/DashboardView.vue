<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import api from '@/services/api'

const auth = useAuthStore()
const router = useRouter()

const roleLabel: Record<string, string> = {
  dg: 'Directeur Général',
  coordinateur: 'Coordinateur',
  secretariat: 'Secrétariat',
  dir_peda: 'Directeur Pédagogique',
  resp_fin: 'Resp. Financier',
}

interface DernierPaiement {
  id: number
  numero_recu: string
  montant: number
  mode_paiement: string
  created_at: string
  inscription: {
    etudiant: { nom: string; prenom: string }
    classe: { filiere: { nom: string } }
  }
}

interface Stats {
  etudiants_total: number
  inscriptions_actives: number
  inscriptions_attente: number
  intervenants_actifs: number
  filieres_actives: number
  classes_total: number
  // Finance
  encaisse_ce_mois: number
  impayes_total: number
  paiements_en_attente: number
  depenses_ce_mois: number
  solde_tresorerie: number
  derniers_paiements: DernierPaiement[]
}

const stats = ref<Stats | null>(null)
const loading = ref(true)

const canSeeFinance = computed(() =>
  auth.user?.role === 'dg' || auth.user?.role === 'resp_fin'
)

async function load() {
  try {
    const { data } = await api.get('/stats')
    stats.value = data
  } finally {
    loading.value = false
  }
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 }).format(n)
}

function modeBadge(mode: string) {
  const map: Record<string, string> = {
    wave: 'bg-violet-100 text-violet-700',
    orange_money: 'bg-orange-100 text-orange-700',
    especes: 'bg-emerald-100 text-emerald-700',
    virement: 'bg-blue-100 text-blue-700',
    cheque: 'bg-gray-100 text-gray-700',
  }
  return map[mode] ?? 'bg-gray-100 text-gray-600'
}

function modeLabel(mode: string) {
  const map: Record<string, string> = {
    wave: 'Wave', orange_money: 'Orange Money', especes: 'Espèces',
    virement: 'Virement', cheque: 'Chèque',
  }
  return map[mode] ?? mode
}

onMounted(load)
</script>

<template>
  <div class="uc-content">

    <!-- KPI Pédagogie : 4 cartes -->
    <div class="uc-kpi-grid" style="margin-bottom:16px;">
      <div class="uc-kpi-card blue" @click="router.push('/etudiants')" style="cursor:pointer;">
        <div class="uc-kpi-icon">🎓</div>
        <div class="uc-kpi-label">Étudiants actifs</div>
        <div class="uc-kpi-value">{{ loading ? '…' : stats?.etudiants_total ?? 0 }}</div>
        <div class="uc-kpi-trend uc-trend-neu">Total des dossiers</div>
      </div>
      <div class="uc-kpi-card green" @click="router.push('/etudiants')" style="cursor:pointer;">
        <div class="uc-kpi-icon">✅</div>
        <div class="uc-kpi-label">Inscriptions actives</div>
        <div class="uc-kpi-value">{{ loading ? '…' : stats?.inscriptions_actives ?? 0 }}</div>
        <div class="uc-kpi-trend uc-trend-up">Statut inscrit_actif</div>
      </div>
      <div class="uc-kpi-card orange" @click="router.push('/etudiants')" style="cursor:pointer;">
        <div class="uc-kpi-icon">⏳</div>
        <div class="uc-kpi-label">En attente validation</div>
        <div class="uc-kpi-value">{{ loading ? '…' : stats?.inscriptions_attente ?? 0 }}</div>
        <div class="uc-kpi-trend uc-trend-neu">Pré-inscriptions</div>
      </div>
      <div class="uc-kpi-card purple" @click="router.push('/intervenants')" style="cursor:pointer;">
        <div class="uc-kpi-icon">👨‍🏫</div>
        <div class="uc-kpi-label">Intervenants actifs</div>
        <div class="uc-kpi-value">{{ loading ? '…' : stats?.intervenants_actifs ?? 0 }}</div>
        <div class="uc-kpi-trend uc-trend-neu">Stable</div>
      </div>
    </div>

    <!-- Trésorerie (DG + resp_fin) -->
    <template v-if="canSeeFinance">
      <div class="uc-tres-card">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;font-weight:600;">
          Solde de trésorerie en temps réel — Visible uniquement DG + Responsable Financier
        </div>
        <div style="font-size:32px;font-weight:700;color:#fff;margin-bottom:4px;">
          {{ loading ? '…' : fmt(stats?.solde_tresorerie ?? 0) }}
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,0.35);">
          ● Calcul : total recettes encaissées − total dépenses enregistrées
        </div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:16px;">
          <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
            <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">Encaissé ce mois</div>
            <div style="font-size:18px;font-weight:700;color:#4ade80;">{{ loading ? '…' : fmt(stats?.encaisse_ce_mois ?? 0) }}</div>
          </div>
          <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
            <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">Impayés en cours</div>
            <div style="font-size:18px;font-weight:700;color:#f87171;">{{ loading ? '…' : fmt(stats?.impayes_total ?? 0) }}</div>
          </div>
          <div style="background:rgba(255,255,255,0.06);border-radius:4px;padding:12px;">
            <div style="font-size:10px;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">En attente confirmation</div>
            <div style="font-size:18px;font-weight:700;color:#fbbf24;">{{ loading ? '…' : stats?.paiements_en_attente ?? 0 }}</div>
          </div>
        </div>
      </div>
    </template>

    <!-- Grille inférieure -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px;">

      <!-- Derniers paiements -->
      <div class="uc-card" v-if="canSeeFinance">
        <div class="uc-card-header">
          <span class="uc-card-title">Paiements récents</span>
          <a class="uc-card-link" @click="router.push('/paiements')">Voir tout</a>
        </div>
        <div class="uc-card-body" style="padding:0;">
          <div v-if="loading" style="padding:16px 20px;font-size:12px;color:#aaa;">Chargement…</div>
          <div v-else-if="!stats?.derniers_paiements?.length" style="padding:16px 20px;font-size:12px;color:#aaa;">Aucun paiement.</div>
          <div v-else>
            <div v-for="p in stats?.derniers_paiements?.slice(0,5)" :key="p.id"
              style="display:flex;align-items:center;gap:10px;padding:9px 20px;border-bottom:1px solid #f5f5f5;cursor:pointer;"
              @click="router.push('/paiements')">
              <div style="width:30px;height:30px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#555;flex-shrink:0;">
                {{ (p.inscription?.etudiant?.prenom?.[0] ?? '') + (p.inscription?.etudiant?.nom?.[0] ?? '') }}
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:12px;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  {{ p.inscription?.etudiant?.prenom }} {{ p.inscription?.etudiant?.nom }}
                </div>
                <div style="font-size:10.5px;color:#aaa;">{{ modeLabel(p.mode_paiement) }}</div>
              </div>
              <div style="font-size:12.5px;font-weight:700;color:#22c55e;white-space:nowrap;">
                +{{ fmt(p.montant) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Filières & Classes -->
      <div class="uc-card">
        <div class="uc-card-header">
          <span class="uc-card-title">Pédagogie</span>
          <a class="uc-card-link" @click="router.push('/filieres')">Voir filières</a>
        </div>
        <div class="uc-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f5f5f5;">
            <span style="font-size:12.5px;font-weight:600;color:#111;">Filières actives</span>
            <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.filieres_actives ?? 0 }}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f5f5f5;">
            <span style="font-size:12.5px;font-weight:600;color:#111;">Classes configurées</span>
            <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.classes_total ?? 0 }}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;">
            <span style="font-size:12.5px;font-weight:600;color:#111;">Intervenants actifs</span>
            <span style="font-size:22px;font-weight:700;color:#111;">{{ loading ? '…' : stats?.intervenants_actifs ?? 0 }}</span>
          </div>
        </div>
      </div>

      <!-- Actions rapides -->
      <div class="uc-card">
        <div class="uc-card-header">
          <span class="uc-card-title">Actions rapides</span>
        </div>
        <div class="uc-card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <button @click="router.push('/etudiants')"
            style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
            onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
            onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
            <div style="font-size:20px;margin-bottom:4px;">🎓</div>
            <div style="font-size:11px;font-weight:600;color:#333;">Nouvel étudiant</div>
          </button>
          <button v-if="canSeeFinance" @click="router.push('/paiements')"
            style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
            onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
            onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
            <div style="font-size:20px;margin-bottom:4px;">💰</div>
            <div style="font-size:11px;font-weight:600;color:#333;">Saisir paiement</div>
          </button>
          <button @click="router.push('/intervenants')"
            style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
            onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
            onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
            <div style="font-size:20px;margin-bottom:4px;">👨‍🏫</div>
            <div style="font-size:11px;font-weight:600;color:#333;">Intervenants</div>
          </button>
          <button @click="router.push('/classes')"
            style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
            onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
            onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
            <div style="font-size:20px;margin-bottom:4px;">🏫</div>
            <div style="font-size:11px;font-weight:600;color:#333;">Classes</div>
          </button>
          <button v-if="canSeeFinance" @click="router.push('/depenses')"
            style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
            onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
            onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
            <div style="font-size:20px;margin-bottom:4px;">📊</div>
            <div style="font-size:11px;font-weight:600;color:#333;">Dépenses</div>
          </button>
          <button @click="router.push('/rapports')"
            style="background:#f9f9f9;border:1.5px solid #ebebeb;border-radius:4px;padding:12px 8px;text-align:center;cursor:pointer;transition:all 0.15s;font-family:'Poppins',sans-serif;"
            onmouseover="this.style.borderColor='#E30613';this.style.background='#fff5f5'"
            onmouseout="this.style.borderColor='#ebebeb';this.style.background='#f9f9f9'">
            <div style="font-size:20px;margin-bottom:4px;">📈</div>
            <div style="font-size:11px;font-weight:600;color:#333;">Rapports</div>
          </button>
        </div>
      </div>

    </div>

  </div>
</template>
