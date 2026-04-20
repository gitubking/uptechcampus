<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import { openPrintWindow, uptechHeaderHTML, uptechFooterHTML, uptechPrintCSS } from '@/utils/uptechPrint'

const auth = useAuthStore()

interface Enseignant { id: number; nom: string; prenom: string }
interface Seance {
  id: number
  matiere: string
  date_debut: string
  date_fin: string
  salle: string | null
  mode: string
  heures: number
  chapitre: string | null
  objectifs: string | null
  objectifs_atteints: 'oui' | 'partiel' | 'non' | null
  contenu_seance: string | null
  remarques: string | null
  signe_enseignant_at: string | null
  enseignant: Enseignant | null
  classe: { id: number; nom: string } | null
  nb_presents: number
  nb_total: number
}

const loading = ref(false)
const seances = ref<Seance[]>([])
const enseignants = ref<Enseignant[]>([])

// Filtres
const filterEnseignant = ref('')
const filterMatiere = ref('')
const filterDebut = ref('')
const filterFin = ref('')

// Vue détail
const expanded = ref<number | null>(null)

const isAdmin = computed(() => ['dg', 'dir_peda', 'coordinateur', 'secretariat'].includes(auth.user?.role ?? ''))
const isEnseignant = computed(() => auth.user?.role === 'enseignant')

async function load() {
  loading.value = true
  try {
    const params: any = {}
    if (filterEnseignant.value) params.enseignant_id = filterEnseignant.value
    if (filterMatiere.value) params.matiere = filterMatiere.value
    if (filterDebut.value) params.debut = filterDebut.value
    if (filterFin.value) params.fin = filterFin.value

    const { data } = await api.get('/cahier-de-textes', { params })
    seances.value = data.seances
    enseignants.value = data.enseignants
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // Si enseignant : filtre auto sur son ID
  if (isEnseignant.value && auth.user) {
    // on laisse le back filtrer via le rôle si nécessaire
  }
  load()
})

// Matières distinctes dans les résultats
const matieresSuggestions = computed(() => {
  const s = new Set(seances.value.map(s => s.matiere).filter(Boolean))
  return [...s].sort()
})

const badgeOA = (v: string | null) => {
  if (v === 'oui') return { label: '✅ Oui', bg: '#dcfce7', color: '#16a34a' }
  if (v === 'partiel') return { label: '⚠️ Partiel', bg: '#ffedd5', color: '#ea580c' }
  if (v === 'non') return { label: '❌ Non', bg: '#fee2e2', color: '#E30613' }
  return null
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}
function formatHeure(d: string) {
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
function formatHeures(h: number) {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`
}

// Sécurise les chaînes utilisateur injectées dans le HTML imprimable.
function escapeHtml(s: string): string {
  return (s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}

// Export impression — document officiel A4 paysage reprenant l'en-tête
// UPTECH partagé (uptechPrint.ts), pour uniformisation avec les autres
// documents institutionnels (reçus, autorisations d'absence, etc.).
function exportPDF() {
  const ensNom = filterEnseignant.value
    ? (() => { const e = enseignants.value.find(e => String(e.id) === filterEnseignant.value); return e ? `${e.prenom} ${e.nom}` : '' })()
    : 'Tous les enseignants'
  const emitDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  const rows = seances.value.map(s => {
    const objLabel = s.objectifs_atteints === 'oui' ? 'Oui'
                   : s.objectifs_atteints === 'partiel' ? 'Partiel'
                   : s.objectifs_atteints === 'non' ? 'Non' : '—'
    const objColor = s.objectifs_atteints === 'oui' ? '#047857'
                   : s.objectifs_atteints === 'partiel' ? '#a16207'
                   : s.objectifs_atteints === 'non' ? '#b91c1c' : '#999'
    return `
      <tr>
        <td>${formatDate(s.date_debut)}</td>
        <td style="white-space:nowrap">${formatHeure(s.date_debut)}–${formatHeure(s.date_fin)}</td>
        <td>${escapeHtml(s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : '—')}</td>
        <td>${escapeHtml(s.matiere)}</td>
        <td>${escapeHtml(s.classe?.nom ?? '—')}</td>
        <td>${escapeHtml(s.chapitre ?? '—')}</td>
        <td style="color:${objColor};font-weight:700;text-align:center">${objLabel}</td>
        <td class="txt-content">${escapeHtml((s.contenu_seance ?? '').replace(/<[^>]*>/g, '') || '—')}</td>
        <td class="txt-content">${escapeHtml(s.remarques ?? '—')}</td>
      </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
  <title>Cahier de textes — ${escapeHtml(ensNom)}</title>
  <style>
    ${uptechPrintCSS()}
    @page{size:A4 landscape;margin:8mm}
    .abs-sub{display:flex;justify-content:space-between;align-items:center;padding:4px 16px;background:#fafafa;border-bottom:1px solid #eee;font-size:9px;color:#666}
    .abs-sub .left{font-weight:600;color:#E30613;text-transform:uppercase;letter-spacing:1px}
    .cdt-filter{padding:6px 16px 0;display:flex;gap:10px;font-size:10px;color:#333}
    .cdt-filter strong{color:#111}
    .cdt-table{width:calc(100% - 32px);margin:8px 16px 12px;border-collapse:collapse;font-size:9px}
    .cdt-table thead th{background:#E30613;color:#fff;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:6px 4px;font-size:8px;border:1px solid #b40510}
    .cdt-table tbody td{padding:5px 6px;border:1px solid #eee;vertical-align:top;line-height:1.4}
    .cdt-table tbody tr:nth-child(even) td{background:#fafafa}
    .cdt-table tbody tr{page-break-inside:avoid}
    .cdt-table .txt-content{font-size:9px;color:#333;white-space:pre-wrap;word-wrap:break-word;max-width:240px}
  </style></head>
  <body>
    ${uptechHeaderHTML()}
    <div class="abs-sub">
      <span class="left">Pédagogie — Cahier de textes</span>
      <span>Émis le ${emitDate}</span>
    </div>
    <div class="cdt-filter">
      <span><strong>Enseignant :</strong> ${escapeHtml(ensNom)}</span>
      ${filterMatiere.value ? `<span><strong>Matière :</strong> ${escapeHtml(filterMatiere.value)}</span>` : ''}
      <span style="margin-left:auto;color:#666">${seances.value.length} séance${seances.value.length > 1 ? 's' : ''}</span>
    </div>
    <table class="cdt-table">
      <thead><tr>
        <th style="width:62px">Date</th>
        <th style="width:62px">Horaire</th>
        <th style="width:100px">Enseignant</th>
        <th style="width:90px">Matière</th>
        <th style="width:60px">Classe</th>
        <th>Chapitre</th>
        <th style="width:52px">Obj. atteints</th>
        <th>Contenu</th>
        <th>Remarques</th>
      </tr></thead>
      <tbody>
        ${rows || '<tr><td colspan="9" style="text-align:center;padding:20px;color:#888;font-style:italic">Aucune séance à imprimer</td></tr>'}
      </tbody>
    </table>
    ${uptechFooterHTML('Document pédagogique — archivage officiel')}
  </body></html>`

  openPrintWindow(html)
}
</script>

<template>
  <div class="uc-content" style="padding:24px 28px;max-width:1200px;margin:0 auto;">

    <!-- En-tête -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:12px;">
      <div>
        <h1 style="font-size:20px;font-weight:700;color:#111;margin:0;">📓 Cahier de textes</h1>
        <p style="font-size:12px;color:#888;margin:4px 0 0;">Journal pédagogique des séances effectuées — contenu, chapitres, objectifs</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <a href="/emargement" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#1e293b;color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          ✍️ Émargement
        </a>
        <button @click="exportPDF" :disabled="!seances.length" class="uc-btn-primary" style="display:inline-flex;align-items:center;gap:6px;">
          📄 Exporter PDF
        </button>
      </div>
    </div>

    <!-- Filtres -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;margin-bottom:20px;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;align-items:end;">
      <div v-if="isAdmin">
        <label class="uc-label">Enseignant</label>
        <select v-model="filterEnseignant" class="uc-input">
          <option value="">Tous</option>
          <option v-for="e in enseignants" :key="e.id" :value="String(e.id)">{{ e.prenom }} {{ e.nom }}</option>
        </select>
      </div>
      <div>
        <label class="uc-label">Matière</label>
        <input v-model="filterMatiere" class="uc-input" list="matieres-list" placeholder="Filtrer par matière…" />
        <datalist id="matieres-list">
          <option v-for="m in matieresSuggestions" :key="m" :value="m" />
        </datalist>
      </div>
      <div>
        <label class="uc-label">Du</label>
        <input v-model="filterDebut" type="date" class="uc-input" />
      </div>
      <div>
        <label class="uc-label">Au</label>
        <input v-model="filterFin" type="date" class="uc-input" />
      </div>
      <div style="display:flex;align-items:flex-end;">
        <button @click="load" class="uc-btn-primary" style="width:100%;">🔍 Rechercher</button>
      </div>
    </div>

    <!-- KPIs résumé -->
    <div v-if="seances.length" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:20px;">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#111;">{{ seances.length }}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">Séances</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#111;">{{ formatHeures(seances.reduce((a,s) => a + Number(s.heures||0), 0)) }}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">Heures</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#16a34a;">{{ seances.filter(s => s.objectifs_atteints === 'oui').length }}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">Obj. atteints</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#ea580c;">{{ seances.filter(s => s.objectifs_atteints === 'partiel').length }}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">Partiels</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;text-align:center;">
        <div style="font-size:22px;font-weight:700;color:#E30613;">{{ seances.filter(s => s.objectifs_atteints === 'non').length }}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">Non atteints</div>
      </div>
    </div>

    <!-- Chargement -->
    <div v-if="loading" style="text-align:center;padding:60px 20px;color:#888;">
      <div style="font-size:28px;margin-bottom:10px;">⏳</div>
      Chargement du cahier de textes…
    </div>

    <!-- Vide -->
    <div v-else-if="!seances.length" style="text-align:center;padding:60px 20px;color:#888;background:#fff;border:1px solid #e2e8f0;border-radius:8px;">
      <div style="font-size:36px;margin-bottom:12px;">📓</div>
      <div style="font-weight:600;color:#555;margin-bottom:6px;">Aucune séance trouvée</div>
      <div style="font-size:12px;">Ajustez les filtres ou vérifiez que les émargements ont été complétés avec le contenu de séance.</div>
    </div>

    <!-- Liste des séances -->
    <div v-else style="display:flex;flex-direction:column;gap:10px;">
      <div
        v-for="s in seances"
        :key="s.id"
        style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;transition:box-shadow 0.15s;"
        @mouseenter="($event.currentTarget as HTMLElement).style.boxShadow='0 2px 12px rgba(0,0,0,0.08)'"
        @mouseleave="($event.currentTarget as HTMLElement).style.boxShadow='none'"
      >
        <!-- En-tête de séance -->
        <div
          style="display:flex;align-items:center;gap:14px;padding:14px 18px;cursor:pointer;user-select:none;"
          @click="expanded = expanded === s.id ? null : s.id"
        >
          <!-- Indicateur objectifs_atteints -->
          <div :style="{
            width:'6px', flexShrink:0, alignSelf:'stretch', borderRadius:'3px',
            background: s.objectifs_atteints==='oui' ? '#16a34a' : s.objectifs_atteints==='partiel' ? '#ea580c' : s.objectifs_atteints==='non' ? '#E30613' : '#e2e8f0'
          }"></div>

          <!-- Date + heure -->
          <div style="min-width:130px;flex-shrink:0;">
            <div style="font-size:12px;font-weight:700;color:#111;">{{ new Date(s.date_debut).toLocaleDateString('fr-FR', {day:'2-digit',month:'short',year:'numeric'}) }}</div>
            <div style="font-size:11px;color:#888;margin-top:1px;">{{ formatHeure(s.date_debut) }} – {{ formatHeure(s.date_fin) }} · {{ formatHeures(Number(s.heures)) }}</div>
          </div>

          <!-- Enseignant + matière + classe -->
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              {{ s.matiere }}
            </div>
            <div style="font-size:11px;color:#888;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              <span v-if="s.enseignant">{{ s.enseignant.prenom }} {{ s.enseignant.nom }}</span>
              <span v-if="s.classe"> · {{ s.classe.nom }}</span>
            </div>
          </div>

          <!-- Chapitre -->
          <div v-if="s.chapitre" style="flex:1;min-width:0;display:none;" class="cdt-chapitre-col">
            <div style="font-size:12px;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" :title="s.chapitre">
              📖 {{ s.chapitre }}
            </div>
          </div>

          <!-- Badge objectifs_atteints -->
          <div v-if="badgeOA(s.objectifs_atteints)" :style="{
            padding:'3px 10px',borderRadius:'20px',fontSize:'11px',fontWeight:'700',flexShrink:0,
            background: badgeOA(s.objectifs_atteints)!.bg,
            color: badgeOA(s.objectifs_atteints)!.color
          }">{{ badgeOA(s.objectifs_atteints)!.label }}</div>

          <!-- Présences -->
          <div style="text-align:right;flex-shrink:0;min-width:50px;">
            <div style="font-size:12px;font-weight:700;color:#111;">{{ s.nb_presents }}/{{ s.nb_total }}</div>
            <div style="font-size:10px;color:#888;">présents</div>
          </div>

          <!-- Chevron -->
          <svg :style="{transition:'transform 0.2s',transform: expanded===s.id ? 'rotate(180deg)':'rotate(0)',flexShrink:0}" width="16" height="16" fill="none" stroke="#aaa" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>

        <!-- Détail expansible -->
        <div v-if="expanded === s.id" style="border-top:1px solid #f0f0f0;padding:16px 18px 18px 38px;background:#fafafa;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">

            <!-- Chapitre -->
            <div v-if="s.chapitre">
              <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Chapitre(s) abordé(s)</div>
              <div style="font-size:13px;color:#111;">{{ s.chapitre }}</div>
            </div>

            <!-- Objectifs planifiés -->
            <div v-if="s.objectifs">
              <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Objectifs planifiés</div>
              <div class="cdt-rich" style="font-size:13px;color:#333;" v-html="s.objectifs"></div>
            </div>

            <!-- Contenu enseigné -->
            <div v-if="s.contenu_seance" style="grid-column:1/-1;">
              <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Contenu enseigné</div>
              <div class="cdt-rich" style="font-size:13px;color:#333;" v-html="s.contenu_seance"></div>
            </div>

            <!-- Remarques -->
            <div v-if="s.remarques" style="grid-column:1/-1;">
              <div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Remarques pédagogiques</div>
              <div style="font-size:13px;color:#555;font-style:italic;background:#fff8e1;border-left:3px solid #f59e0b;padding:8px 12px;border-radius:0 4px 4px 0;">{{ s.remarques }}</div>
            </div>

            <!-- Rien renseigné -->
            <div v-if="!s.chapitre && !s.objectifs && !s.contenu_seance && !s.remarques" style="grid-column:1/-1;color:#aaa;font-size:12px;font-style:italic;">
              Aucun contenu renseigné pour cette séance.
            </div>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.cdt-rich :deep(p) { margin: 0 0 4px; }
.cdt-rich :deep(ul), .cdt-rich :deep(ol) { margin: 4px 0; padding-left: 18px; }
@media (min-width: 700px) {
  .cdt-chapitre-col { display: block !important; }
}
</style>
