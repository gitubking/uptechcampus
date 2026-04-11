<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'

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

async function exportPDF() {
  const { default: jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const ensNom = filterEnseignant.value
    ? (() => { const e = enseignants.value.find(e => String(e.id) === filterEnseignant.value); return e ? `${e.prenom} ${e.nom}` : '' })()
    : 'Tous les enseignants'

  doc.setFontSize(16)
  doc.setTextColor(100, 20, 20)
  doc.text('CAHIER DE TEXTES', 105, 18, { align: 'center' })
  doc.setFontSize(10)
  doc.setTextColor(80, 80, 80)
  doc.text(ensNom, 105, 25, { align: 'center' })
  if (filterMatiere.value) doc.text(`Matière : ${filterMatiere.value}`, 105, 31, { align: 'center' })
  doc.text(`Exporté le ${new Date().toLocaleDateString('fr-FR')}`, 105, 37, { align: 'center' })

  const rows = seances.value.map(s => [
    formatDate(s.date_debut),
    `${formatHeure(s.date_debut)}–${formatHeure(s.date_fin)}`,
    s.enseignant ? `${s.enseignant.prenom} ${s.enseignant.nom}` : '—',
    s.matiere,
    s.classe?.nom ?? '—',
    s.chapitre ?? '—',
    s.objectifs_atteints === 'oui' ? 'Oui' : s.objectifs_atteints === 'partiel' ? 'Partiel' : s.objectifs_atteints === 'non' ? 'Non' : '—',
    s.contenu_seance ? s.contenu_seance.replace(/<[^>]*>/g, '') : '—',
    s.remarques ?? '—',
  ])

  autoTable(doc, {
    startY: 42,
    head: [['Date', 'Horaire', 'Enseignant', 'Matière', 'Classe', 'Chapitre', 'Obj. atteints', 'Contenu', 'Remarques']],
    body: rows,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [100, 20, 20], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 7: { cellWidth: 40 }, 8: { cellWidth: 30 } },
    alternateRowStyles: { fillColor: [250, 245, 245] },
  })

  const ens = ensNom.replace(/\s+/g, '_')
  doc.save(`cahier-textes-${ens}-${new Date().toISOString().slice(0, 10)}.pdf`)
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
