<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import api from '@/services/api'
import { UcPageHeader, UcFormGroup } from '@/components/ui'

// ── Onglet actif ──────────────────────────────────────────────────────────────
type Tab = 'jour' | 'semaine' | 'mois' | 'classe'
const tab = ref<Tab>('jour')

// ── Filtres ───────────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10)
const thisMonth = new Date().toISOString().slice(0, 7)
const filterDate    = ref(today)
const filterSemaine = ref(today)
const filterMois    = ref(thisMonth)
const filterMoisClasse = ref(thisMonth)
const filterClasse  = ref<number | null>(null)

const loading = ref(false)

// ── Données ───────────────────────────────────────────────────────────────────
const jourData    = ref<any>(null)
const semaineData = ref<any>(null)
const moisData    = ref<any>(null)
const classeData  = ref<any>(null)
const classes     = ref<{ id: number; nom: string }[]>([])

// ── Chargement ────────────────────────────────────────────────────────────────
async function loadClasses() {
  const { data } = await api.get('/classes')
  classes.value = (data.data ?? data).map((c: any) => ({ id: c.id, nom: c.nom }))
}

async function loadJour() {
  loading.value = true
  try {
    const { data } = await api.get('/absences/jour', {
      params: { date: filterDate.value, classe_id: filterClasse.value || undefined }
    })
    jourData.value = data
  } finally { loading.value = false }
}

async function loadSemaine() {
  loading.value = true
  try {
    const { data } = await api.get('/absences/semaine', { params: { date: filterSemaine.value } })
    semaineData.value = data
  } finally { loading.value = false }
}

async function loadMois() {
  loading.value = true
  try {
    const { data } = await api.get('/absences/mois', { params: { mois: filterMois.value } })
    moisData.value = data
  } finally { loading.value = false }
}

async function loadClasse() {
  loading.value = true
  try {
    const { data } = await api.get('/absences/classe', { params: { mois: filterMoisClasse.value } })
    classeData.value = data
  } finally { loading.value = false }
}

function loadCurrent() {
  if (tab.value === 'jour')    loadJour()
  else if (tab.value === 'semaine') loadSemaine()
  else if (tab.value === 'mois')    loadMois()
  else if (tab.value === 'classe')  loadClasse()
}

watch(tab, loadCurrent)
watch(filterDate,      loadJour)
watch(filterClasse,    loadJour)
watch(filterSemaine,   loadSemaine)
watch(filterMois,      loadMois)
watch(filterMoisClasse, loadClasse)

onMounted(async () => {
  await loadClasses()
  loadCurrent()
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}
function fmtHeure(d: string) {
  return new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
function fmtMois(m: string) {
  return new Date(m + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
}

function semaineLabel(date: string) {
  const d = new Date(date)
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1
  const lundi = new Date(d); lundi.setDate(d.getDate() - day)
  const dimanche = new Date(lundi); dimanche.setDate(lundi.getDate() + 6)
  return `Sem. du ${lundi.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} au ${dimanche.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
}

function tauxColor(taux: number) {
  if (taux >= 30) return '#dc2626'
  if (taux >= 15) return '#f59e0b'
  return '#16a34a'
}

function barWidth(val: number, max: number) {
  return max ? Math.round((val / max) * 100) : 0
}

const maxAbsJour = computed(() => {
  const data = tab.value === 'semaine' ? semaineData.value?.par_jour : moisData.value?.par_jour
  if (!data?.length) return 1
  return Math.max(...data.map((r: any) => r.absents + r.retards), 1)
})
</script>

<template>
  <div class="uc-content">
    <UcPageHeader title="Suivi des absences" subtitle="Par jour, semaine, mois et classe">
      <template #actions>
        <button @click="loadCurrent" class="uc-btn-outline">↺ Actualiser</button>
      </template>
    </UcPageHeader>

    <!-- Onglets -->
    <div style="display:flex;gap:4px;border-bottom:2px solid #e2e8f0;margin-bottom:20px;">
      <button v-for="t in ([
        { key:'jour',    label:'📅 Par jour' },
        { key:'semaine', label:'📆 Par semaine' },
        { key:'mois',    label:'🗓️ Par mois' },
        { key:'classe',  label:'🏫 Par classe' },
      ] as {key:Tab, label:string}[])" :key="t.key"
        @click="tab = t.key"
        :style="{
          padding:'8px 18px', border:'none', background:'transparent', cursor:'pointer',
          fontWeight: tab === t.key ? '700' : '500',
          color: tab === t.key ? '#1e293b' : '#64748b',
          borderBottom: tab === t.key ? '2px solid #1e293b' : '2px solid transparent',
          marginBottom:'-2px', fontSize:'13px', transition:'all .15s',
        }">
        {{ t.label }}
      </button>
    </div>

    <!-- ═══════════════ ONGLET JOUR ═══════════════ -->
    <div v-if="tab === 'jour'">
      <!-- Filtres -->
      <div class="uc-filters-bar">
        <UcFormGroup label="Date">
          <input type="date" v-model="filterDate" class="uc-input" />
        </UcFormGroup>
        <UcFormGroup label="Classe (optionnel)">
          <select v-model="filterClasse" class="uc-input" style="min-width:160px;">
            <option :value="null">Toutes les classes</option>
            <option v-for="c in classes" :key="c.id" :value="c.id">{{ c.nom }}</option>
          </select>
        </UcFormGroup>
      </div>

      <!-- KPIs jour -->
      <div class="uc-kpi-grid" style="margin-bottom:18px;" v-if="jourData">
        <div class="uc-kpi-card">
          <div class="uc-kpi-label">Total absences/retards</div>
          <div class="uc-kpi-value">{{ jourData.total }}</div>
        </div>
        <div class="uc-kpi-card" style="background:#fef2f2;border-color:#fecaca;">
          <div class="uc-kpi-label" style="color:#991b1b;">Absents</div>
          <div class="uc-kpi-value" style="color:#dc2626;">{{ jourData.absents }}</div>
        </div>
        <div class="uc-kpi-card" style="background:#fffbeb;border-color:#fde68a;">
          <div class="uc-kpi-label" style="color:#92400e;">En retard</div>
          <div class="uc-kpi-value" style="color:#f59e0b;">{{ jourData.retards }}</div>
        </div>
        <div class="uc-kpi-card">
          <div class="uc-kpi-label">Date</div>
          <div class="uc-kpi-value" style="font-size:13px;">{{ fmtDate(filterDate) }}</div>
        </div>
      </div>

      <div v-if="loading" class="uc-empty">Chargement…</div>
      <div v-else-if="!jourData || jourData.rows.length === 0" class="uc-empty">
        Aucune absence enregistrée pour cette date.
      </div>
      <div v-else class="uc-table-wrap">
        <table class="uc-table">
          <thead>
            <tr>
              <th>Étudiant</th>
              <th>Classe</th>
              <th>Séance / Matière</th>
              <th>Horaire</th>
              <th>Enseignant</th>
              <th style="text-align:center;">Statut</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in jourData.rows" :key="r.id">
              <td>
                <div style="font-weight:600;color:#1e293b;">{{ r.etudiant.prenom }} {{ r.etudiant.nom }}</div>
                <div style="font-size:10px;color:#94a3b8;">{{ r.etudiant.numero_etudiant }}</div>
              </td>
              <td style="font-weight:600;">{{ r.classe.nom }}</td>
              <td>{{ r.seance.matiere || '—' }}</td>
              <td style="font-size:12px;color:#475569;">
                {{ fmtHeure(r.seance.date_debut) }} – {{ fmtHeure(r.seance.date_fin) }}
              </td>
              <td style="font-size:12px;color:#475569;">
                {{ r.seance.enseignant ? r.seance.enseignant.prenom + ' ' + r.seance.enseignant.nom : '—' }}
              </td>
              <td style="text-align:center;">
                <span :style="{
                  display:'inline-block', padding:'2px 10px', borderRadius:'20px',
                  fontSize:'11px', fontWeight:'700',
                  background: r.statut === 'absent' ? '#fef2f2' : '#fffbeb',
                  color: r.statut === 'absent' ? '#dc2626' : '#f59e0b',
                }">
                  {{ r.statut === 'absent' ? 'Absent' : 'Retard' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ═══════════════ ONGLET SEMAINE ═══════════════ -->
    <div v-if="tab === 'semaine'">
      <div class="uc-filters-bar">
        <UcFormGroup label="Semaine (choisir une date dans la semaine)">
          <input type="date" v-model="filterSemaine" class="uc-input" />
        </UcFormGroup>
        <div v-if="semaineData" style="align-self:flex-end;font-size:12px;color:#64748b;padding-bottom:8px;">
          {{ semaineLabel(filterSemaine) }}
        </div>
      </div>

      <!-- KPIs semaine -->
      <div class="uc-kpi-grid" style="margin-bottom:18px;" v-if="semaineData">
        <div class="uc-kpi-card" style="background:#fef2f2;border-color:#fecaca;">
          <div class="uc-kpi-label" style="color:#991b1b;">Absences</div>
          <div class="uc-kpi-value" style="color:#dc2626;">{{ semaineData.total_absents }}</div>
        </div>
        <div class="uc-kpi-card" style="background:#fffbeb;border-color:#fde68a;">
          <div class="uc-kpi-label" style="color:#92400e;">Retards</div>
          <div class="uc-kpi-value" style="color:#f59e0b;">{{ semaineData.total_retards }}</div>
        </div>
        <div class="uc-kpi-card">
          <div class="uc-kpi-label">Jours avec absences</div>
          <div class="uc-kpi-value">{{ semaineData.par_jour.length }} / 5</div>
        </div>
      </div>

      <div v-if="loading" class="uc-empty">Chargement…</div>
      <div v-else-if="!semaineData" class="uc-empty">Aucune donnée.</div>
      <div v-else style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

        <!-- Graphique barres par jour -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
          <h3 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 16px;">Absences par jour</h3>
          <div v-if="semaineData.par_jour.length === 0" class="uc-empty" style="padding:20px 0;">Aucune absence cette semaine.</div>
          <div v-for="r in semaineData.par_jour" :key="r.jour" style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
              <span style="color:#334155;font-weight:600;">{{ fmtDate(r.jour) }}</span>
              <span style="color:#64748b;">{{ r.absents }} abs · {{ r.retards }} ret</span>
            </div>
            <div style="background:#f1f5f9;border-radius:4px;height:8px;overflow:hidden;">
              <div :style="{
                width: barWidth(r.absents + r.retards, maxAbsJour) + '%',
                height:'100%', borderRadius:'4px',
                background: r.absents > 3 ? '#dc2626' : r.absents > 1 ? '#f59e0b' : '#94a3b8'
              }"></div>
            </div>
          </div>
        </div>

        <!-- Top absentéistes -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
          <h3 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 16px;">Top absentéistes</h3>
          <div v-if="semaineData.top_absents.length === 0" class="uc-empty" style="padding:20px 0;">Aucune absence cette semaine.</div>
          <div v-for="(e, i) in semaineData.top_absents.slice(0, 10)" :key="e.id"
            style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9;">
            <div :style="{
              width:'26px',height:'26px',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
              background: (i as number) < 3 ? '#fef2f2' : '#f8fafc',
              color: (i as number) < 3 ? '#dc2626' : '#64748b',
              fontSize:'11px', fontWeight:'700', flexShrink: 0,
            }">{{ (i as number) + 1 }}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:12px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                {{ e.prenom }} {{ e.nom }}
              </div>
              <div style="font-size:10px;color:#94a3b8;">{{ e.classe.nom }}</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <span style="font-size:12px;font-weight:700;color:#dc2626;">{{ e.nb_absences }} abs</span>
              <span v-if="e.nb_retards" style="font-size:11px;color:#f59e0b;margin-left:4px;">+{{ e.nb_retards }} ret</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ ONGLET MOIS ═══════════════ -->
    <div v-if="tab === 'mois'">
      <div class="uc-filters-bar">
        <UcFormGroup label="Mois">
          <input type="month" v-model="filterMois" class="uc-input" />
        </UcFormGroup>
      </div>

      <!-- KPIs mois -->
      <div class="uc-kpi-grid" style="margin-bottom:18px;" v-if="moisData">
        <div class="uc-kpi-card" style="background:#fef2f2;border-color:#fecaca;">
          <div class="uc-kpi-label" style="color:#991b1b;">Total absences</div>
          <div class="uc-kpi-value" style="color:#dc2626;">{{ moisData.total_absents }}</div>
        </div>
        <div class="uc-kpi-card" style="background:#fffbeb;border-color:#fde68a;">
          <div class="uc-kpi-label" style="color:#92400e;">Total retards</div>
          <div class="uc-kpi-value" style="color:#f59e0b;">{{ moisData.total_retards }}</div>
        </div>
        <div class="uc-kpi-card">
          <div class="uc-kpi-label">Jours avec absences</div>
          <div class="uc-kpi-value">{{ moisData.nb_jours }}</div>
        </div>
        <div class="uc-kpi-card">
          <div class="uc-kpi-label">Étudiants concernés</div>
          <div class="uc-kpi-value">{{ moisData.classement.length }}</div>
        </div>
      </div>

      <div v-if="loading" class="uc-empty">Chargement…</div>
      <div v-else-if="!moisData" class="uc-empty">Aucune donnée.</div>
      <div v-else style="display:grid;grid-template-columns:300px 1fr;gap:20px;">

        <!-- Mini-calendrier barres -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
          <h3 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 16px;">
            Absences — {{ fmtMois(filterMois) }}
          </h3>
          <div v-if="moisData.par_jour.length === 0" class="uc-empty" style="padding:12px 0;">Aucune absence ce mois.</div>
          <div v-for="r in moisData.par_jour" :key="r.jour" style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
              <span style="color:#334155;">{{ fmtDate(r.jour) }}</span>
              <span :style="{ color: r.absents >= 5 ? '#dc2626' : '#64748b' }">{{ r.absents + r.retards }}</span>
            </div>
            <div style="background:#f1f5f9;border-radius:3px;height:6px;overflow:hidden;">
              <div :style="{
                width: barWidth(r.absents + r.retards, maxAbsJour) + '%',
                height:'100%', borderRadius:'3px',
                background: r.absents >= 5 ? '#dc2626' : r.absents >= 2 ? '#f59e0b' : '#94a3b8',
              }"></div>
            </div>
          </div>
        </div>

        <!-- Classement absentéistes du mois -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
          <h3 style="font-size:13px;font-weight:700;color:#1e293b;margin:0 0 16px;">Classement des absences du mois</h3>
          <div v-if="moisData.classement.length === 0" class="uc-empty" style="padding:20px 0;">Aucune absence ce mois.</div>
          <div v-else class="uc-table-wrap" style="margin:0;">
            <table class="uc-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Étudiant</th>
                  <th>Classe</th>
                  <th style="text-align:center;">Absences</th>
                  <th style="text-align:center;">Retards</th>
                  <th style="text-align:center;">Taux abs.</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(e, i) in moisData.classement" :key="e.id">
                  <td style="color:#94a3b8;font-size:12px;">{{ (i as number) + 1 }}</td>
                  <td>
                    <div style="font-weight:600;color:#1e293b;">{{ e.prenom }} {{ e.nom }}</div>
                    <div style="font-size:10px;color:#94a3b8;">{{ e.numero_etudiant }}</div>
                  </td>
                  <td style="font-size:12px;">{{ e.classe.nom }}</td>
                  <td style="text-align:center;font-weight:700;color:#dc2626;">{{ e.nb_absences }}</td>
                  <td style="text-align:center;color:#f59e0b;">{{ e.nb_retards }}</td>
                  <td style="text-align:center;">
                    <span :style="{
                      display:'inline-block', padding:'2px 8px', borderRadius:'20px',
                      fontSize:'11px', fontWeight:'700',
                      background: Number(e.taux_absence) >= 30 ? '#fef2f2' : Number(e.taux_absence) >= 15 ? '#fffbeb' : '#f0fdf4',
                      color: tauxColor(Number(e.taux_absence)),
                    }">{{ e.taux_absence }}%</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ ONGLET CLASSE ═══════════════ -->
    <div v-if="tab === 'classe'">
      <div class="uc-filters-bar">
        <UcFormGroup label="Mois">
          <input type="month" v-model="filterMoisClasse" class="uc-input" />
        </UcFormGroup>
      </div>

      <div v-if="loading" class="uc-empty">Chargement…</div>
      <div v-else-if="!classeData || classeData.rows.length === 0" class="uc-empty">
        Aucune donnée de présence pour ce mois.
      </div>
      <div v-else class="uc-table-wrap">
        <table class="uc-table">
          <thead>
            <tr>
              <th>Classe</th>
              <th>Filière</th>
              <th style="text-align:center;">Séances</th>
              <th style="text-align:center;">Étudiants</th>
              <th style="text-align:center;">Présents</th>
              <th style="text-align:center;">Absents</th>
              <th style="text-align:center;">Retards</th>
              <th style="text-align:center;">Taux présence</th>
              <th style="text-align:center;">Taux absence</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in classeData.rows" :key="r.classe_id">
              <td style="font-weight:700;color:#1e293b;">{{ r.classe_nom }}</td>
              <td style="font-size:12px;color:#64748b;">{{ r.filiere_nom || '—' }}</td>
              <td style="text-align:center;">{{ r.nb_seances }}</td>
              <td style="text-align:center;">{{ r.nb_etudiants }}</td>
              <td style="text-align:center;color:#16a34a;font-weight:600;">{{ r.nb_presents }}</td>
              <td style="text-align:center;color:#dc2626;font-weight:700;">{{ r.nb_absents }}</td>
              <td style="text-align:center;color:#f59e0b;">{{ r.nb_retards }}</td>
              <td style="text-align:center;">
                <span :style="{
                  display:'inline-block', padding:'2px 10px', borderRadius:'20px',
                  fontSize:'11px', fontWeight:'700',
                  background: Number(r.taux_presence) >= 80 ? '#f0fdf4' : Number(r.taux_presence) >= 60 ? '#fffbeb' : '#fef2f2',
                  color: Number(r.taux_presence) >= 80 ? '#16a34a' : Number(r.taux_presence) >= 60 ? '#f59e0b' : '#dc2626',
                }">{{ r.taux_presence ?? '—' }}%</span>
              </td>
              <td style="text-align:center;">
                <span :style="{
                  display:'inline-block', padding:'2px 10px', borderRadius:'20px',
                  fontSize:'11px', fontWeight:'700',
                  background: Number(r.taux_absence) >= 30 ? '#fef2f2' : Number(r.taux_absence) >= 15 ? '#fffbeb' : '#f0fdf4',
                  color: tauxColor(Number(r.taux_absence)),
                }">{{ r.taux_absence ?? '—' }}%</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>
</template>
