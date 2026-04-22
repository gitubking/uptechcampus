<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import api from '@/services/api'
import { UcPageHeader, UcFormGroup } from '@/components/ui'
import { openPrintWindow, uptechHeaderHTML, uptechFooterHTML, uptechPrintCSS } from '@/utils/uptechPrint'

// ── Onglet actif ──────────────────────────────────────────────────────────────
type Tab = 'jour' | 'semaine' | 'mois' | 'classe' | 'top'
const tab = ref<Tab>('jour')

// ── Filtres ───────────────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10)
const thisMonth = new Date().toISOString().slice(0, 7)
const filterDate    = ref(today)
const filterSemaine = ref(today)
const filterMois    = ref(thisMonth)
const filterMoisClasse = ref(thisMonth)
const filterMoisTop = ref(thisMonth)
const filterClasse  = ref<number | null>(null)

const loading = ref(false)

// ── Données ───────────────────────────────────────────────────────────────────
const jourData    = ref<any>(null)
const semaineData = ref<any>(null)
const moisData    = ref<any>(null)
const classeData  = ref<any>(null)
const topData     = ref<any>(null)
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

async function loadTop() {
  // Réutilise /absences/mois qui renvoie déjà un `classement` complet :
  // pas besoin d'un nouvel endpoint back pour afficher le Top absents.
  loading.value = true
  try {
    const { data } = await api.get('/absences/mois', { params: { mois: filterMoisTop.value } })
    topData.value = data
  } finally { loading.value = false }
}

function loadCurrent() {
  if (tab.value === 'jour')    loadJour()
  else if (tab.value === 'semaine') loadSemaine()
  else if (tab.value === 'mois')    loadMois()
  else if (tab.value === 'classe')  loadClasse()
  else if (tab.value === 'top')     loadTop()
}

watch(tab, loadCurrent)
watch(filterDate,      loadJour)
watch(filterClasse,    loadJour)
watch(filterSemaine,   loadSemaine)
watch(filterMois,      loadMois)
watch(filterMoisClasse, loadClasse)
watch(filterMoisTop, loadTop)

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

// ── Export PDF (HTML/print avec en-tête UPTECH) ─────────────────────────
function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch] as string))
}

function exportPDF() {
  const emitDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
  let titre = ''
  let periode = ''
  let kpisHTML = ''
  let bodyHTML = ''

  if (tab.value === 'jour') {
    if (!jourData.value) { alert('Aucune donnée à exporter.'); return }
    titre = 'Suivi des absences — Journée'
    periode = fmtDate(filterDate.value)
    kpisHTML = `
      <div class="abs-kpis">
        <div class="kpi"><span class="k-lbl">Total</span><span class="k-val">${jourData.value.total}</span></div>
        <div class="kpi ko"><span class="k-lbl">Absents</span><span class="k-val">${jourData.value.absents}</span></div>
        <div class="kpi warn"><span class="k-lbl">Retards</span><span class="k-val">${jourData.value.retards}</span></div>
      </div>`
    const rows: any[] = jourData.value.rows || []
    if (!rows.length) bodyHTML = `<div class="empty">Aucune absence enregistrée pour cette date.</div>`
    else bodyHTML = `
      <table class="abs-table">
        <thead><tr>
          <th>Étudiant</th><th>Classe</th><th>Séance / Matière</th><th>Horaire</th>
          <th>Enseignant</th><th style="text-align:center">Statut</th>
        </tr></thead>
        <tbody>${rows.map(r => `
          <tr>
            <td><strong>${esc(r.prenom ?? r.etudiant?.prenom)} ${esc(r.nom ?? r.etudiant?.nom)}</strong></td>
            <td>${esc(r.classe_nom ?? r.classe?.nom ?? '—')}</td>
            <td>${esc(r.matiere ?? r.seance?.matiere ?? '—')}</td>
            <td>${r.date_debut ? fmtHeure(r.date_debut) : '—'}</td>
            <td>${esc(r.enseignant_nom ?? r.enseignant?.nom ?? '—')}</td>
            <td style="text-align:center"><span class="chip ${r.statut === 'absent' ? 'chip-red' : 'chip-orange'}">${r.statut === 'absent' ? 'Absent' : 'Retard'}</span></td>
          </tr>`).join('')}
        </tbody>
      </table>`
  } else if (tab.value === 'semaine') {
    if (!semaineData.value) { alert('Aucune donnée à exporter.'); return }
    titre = 'Suivi des absences — Semaine'
    periode = semaineLabel(filterSemaine.value)
    kpisHTML = `
      <div class="abs-kpis">
        <div class="kpi ko"><span class="k-lbl">Absences</span><span class="k-val">${semaineData.value.total_absents}</span></div>
        <div class="kpi warn"><span class="k-lbl">Retards</span><span class="k-val">${semaineData.value.total_retards}</span></div>
        <div class="kpi"><span class="k-lbl">Jours avec absences</span><span class="k-val">${semaineData.value.par_jour.length} / 5</span></div>
      </div>`
    const parJour: any[] = semaineData.value.par_jour || []
    const top: any[] = semaineData.value.top_absents || []
    const details: any[] = semaineData.value.details || []
    bodyHTML = `
      <div class="grid2">
        <div class="panel">
          <h3>Absences par jour</h3>
          ${parJour.length === 0 ? '<div class="empty">Aucune absence cette semaine.</div>' : `
            <table class="abs-table compact">
              <thead><tr><th>Jour</th><th style="text-align:center">Absents</th><th style="text-align:center">Retards</th></tr></thead>
              <tbody>${parJour.map(r => `
                <tr><td>${esc(fmtDate(r.jour))}</td><td style="text-align:center;color:#dc2626">${r.absents}</td><td style="text-align:center;color:#f59e0b">${r.retards}</td></tr>`).join('')}</tbody>
            </table>`}
        </div>
        <div class="panel">
          <h3>Top absentéistes</h3>
          ${top.length === 0 ? '<div class="empty">Aucune absence cette semaine.</div>' : `
            <table class="abs-table compact">
              <thead><tr><th>#</th><th>Étudiant</th><th>Classe</th><th style="text-align:center">Abs.</th><th style="text-align:center">Ret.</th></tr></thead>
              <tbody>${top.slice(0, 15).map((e, i) => `
                <tr><td>${i + 1}</td><td><strong>${esc(e.prenom)} ${esc(e.nom)}</strong></td><td>${esc(e.classe?.nom ?? '—')}</td><td style="text-align:center;font-weight:700;color:#dc2626">${e.nb_absences}</td><td style="text-align:center;color:#f59e0b">${e.nb_retards ?? 0}</td></tr>`).join('')}</tbody>
            </table>`}
        </div>
      </div>
      ${details.length > 0 ? `
        <div style="padding:0 16px 4px;margin-top:4px;font-size:10px;font-weight:800;color:#E30613;text-transform:uppercase;letter-spacing:1px;">
          Liste détaillée (${details.length} ligne${details.length > 1 ? 's' : ''})
        </div>
        <table class="abs-table">
          <thead><tr>
            <th style="width:70px">Jour</th>
            <th>Étudiant</th>
            <th>Classe</th>
            <th>Séance / Matière</th>
            <th style="width:80px">Horaire</th>
            <th>Enseignant</th>
            <th style="text-align:center;width:60px">Statut</th>
          </tr></thead>
          <tbody>${details.map(r => `
            <tr>
              <td>${esc(fmtDate(r.jour))}</td>
              <td><strong>${esc(r.etudiant.prenom)} ${esc(r.etudiant.nom)}</strong>${r.etudiant.numero_etudiant ? `<br><span style="font-size:8px;color:#888">${esc(r.etudiant.numero_etudiant)}</span>` : ''}</td>
              <td>${esc(r.classe.nom)}</td>
              <td>${esc(r.seance.matiere || '—')}</td>
              <td style="white-space:nowrap">${fmtHeure(r.seance.date_debut)}–${fmtHeure(r.seance.date_fin)}</td>
              <td>${r.seance.enseignant?.id ? esc(`${r.seance.enseignant.prenom} ${r.seance.enseignant.nom}`) : '—'}</td>
              <td style="text-align:center"><span class="chip ${r.statut === 'absent' ? 'chip-red' : 'chip-orange'}">${r.statut === 'absent' ? 'Absent' : 'Retard'}</span></td>
            </tr>`).join('')}</tbody>
        </table>
      ` : ''}`
  } else if (tab.value === 'mois') {
    if (!moisData.value) { alert('Aucune donnée à exporter.'); return }
    titre = 'Suivi des absences — Mois'
    periode = fmtMois(filterMois.value)
    kpisHTML = `
      <div class="abs-kpis">
        <div class="kpi ko"><span class="k-lbl">Total absences</span><span class="k-val">${moisData.value.total_absents}</span></div>
        <div class="kpi warn"><span class="k-lbl">Total retards</span><span class="k-val">${moisData.value.total_retards}</span></div>
        <div class="kpi"><span class="k-lbl">Jours avec absences</span><span class="k-val">${moisData.value.nb_jours}</span></div>
        <div class="kpi"><span class="k-lbl">Étudiants concernés</span><span class="k-val">${moisData.value.classement.length}</span></div>
      </div>`
    const classement: any[] = moisData.value.classement || []
    bodyHTML = classement.length === 0
      ? `<div class="empty">Aucune absence ce mois.</div>`
      : `<table class="abs-table">
          <thead><tr>
            <th style="width:30px">#</th><th>Étudiant</th><th>N° Étud.</th><th>Classe</th>
            <th style="text-align:center">Absences</th><th style="text-align:center">Retards</th><th style="text-align:center">Taux abs.</th>
          </tr></thead>
          <tbody>${classement.map((e, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${esc(e.prenom)} ${esc(e.nom)}</strong></td>
              <td>${esc(e.numero_etudiant ?? '—')}</td>
              <td>${esc(e.classe?.nom ?? '—')}</td>
              <td style="text-align:center;font-weight:700;color:#dc2626">${e.nb_absences}</td>
              <td style="text-align:center;color:#f59e0b">${e.nb_retards}</td>
              <td style="text-align:center"><span class="chip ${Number(e.taux_absence) >= 30 ? 'chip-red' : Number(e.taux_absence) >= 15 ? 'chip-orange' : 'chip-green'}">${e.taux_absence}%</span></td>
            </tr>`).join('')}</tbody>
        </table>`
  } else if (tab.value === 'top') {
    if (!topData.value) { alert('Aucune donnée à exporter.'); return }
    titre = 'Suivi des absences — Top absents'
    periode = fmtMois(filterMoisTop.value)
    kpisHTML = `
      <div class="abs-kpis">
        <div class="kpi"><span class="k-lbl">Étudiants absents</span><span class="k-val">${topData.value.classement.length}</span></div>
        <div class="kpi ko"><span class="k-lbl">Total absences</span><span class="k-val">${topData.value.total_absents}</span></div>
        <div class="kpi warn"><span class="k-lbl">Total retards</span><span class="k-val">${topData.value.total_retards}</span></div>
      </div>`
    const classement: any[] = topData.value.classement || []
    bodyHTML = classement.length === 0
      ? `<div class="empty">Aucune absence ce mois.</div>`
      : `<table class="abs-table">
          <thead><tr>
            <th style="width:30px">#</th><th>Étudiant</th><th>N° Étud.</th><th>Classe</th>
            <th style="text-align:center">Absences</th><th style="text-align:center">Retards</th><th style="text-align:center">Taux abs.</th>
          </tr></thead>
          <tbody>${classement.map((e, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${esc(e.prenom)} ${esc(e.nom)}</strong></td>
              <td>${esc(e.numero_etudiant ?? '—')}</td>
              <td>${esc(e.classe?.nom ?? '—')}</td>
              <td style="text-align:center;font-weight:700;color:#dc2626">${e.nb_absences}</td>
              <td style="text-align:center;color:#f59e0b">${e.nb_retards}</td>
              <td style="text-align:center"><span class="chip ${Number(e.taux_absence) >= 30 ? 'chip-red' : Number(e.taux_absence) >= 15 ? 'chip-orange' : 'chip-green'}">${e.taux_absence}%</span></td>
            </tr>`).join('')}</tbody>
        </table>`
  } else {
    if (!classeData.value) { alert('Aucune donnée à exporter.'); return }
    titre = 'Suivi des absences — Par classe'
    periode = fmtMois(filterMoisClasse.value)
    const rows: any[] = classeData.value.rows || []
    bodyHTML = rows.length === 0
      ? `<div class="empty">Aucune donnée de présence pour ce mois.</div>`
      : `<table class="abs-table">
          <thead><tr>
            <th>Classe</th><th>Filière</th><th style="text-align:center">Séances</th>
            <th style="text-align:center">Étudiants</th><th style="text-align:center">Présents</th>
            <th style="text-align:center">Absents</th><th style="text-align:center">Retards</th>
            <th style="text-align:center">Taux présence</th><th style="text-align:center">Taux absence</th>
          </tr></thead>
          <tbody>${rows.map(r => `
            <tr>
              <td><strong>${esc(r.classe_nom)}</strong></td>
              <td>${esc(r.filiere_nom ?? '—')}</td>
              <td style="text-align:center">${r.nb_seances}</td>
              <td style="text-align:center">${r.nb_etudiants}</td>
              <td style="text-align:center;color:#16a34a;font-weight:700">${r.nb_presents}</td>
              <td style="text-align:center;color:#dc2626;font-weight:700">${r.nb_absents}</td>
              <td style="text-align:center;color:#f59e0b">${r.nb_retards}</td>
              <td style="text-align:center"><span class="chip ${Number(r.taux_presence) >= 80 ? 'chip-green' : Number(r.taux_presence) >= 60 ? 'chip-orange' : 'chip-red'}">${r.taux_presence ?? '—'}%</span></td>
              <td style="text-align:center"><span class="chip ${Number(r.taux_absence ?? 0) >= 30 ? 'chip-red' : Number(r.taux_absence ?? 0) >= 15 ? 'chip-orange' : 'chip-green'}">${r.taux_absence ?? '—'}%</span></td>
            </tr>`).join('')}</tbody>
        </table>`
  }

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
    <title>${esc(titre)} — ${esc(periode)}</title>
    <style>
      ${uptechPrintCSS()}
      @page{size:A4 landscape;margin:8mm}
      .abs-sub{display:flex;justify-content:space-between;align-items:center;padding:4px 16px;background:#fafafa;border-bottom:1px solid #eee;font-size:9px;color:#666}
      .abs-sub .left{font-weight:600;color:#E30613;text-transform:uppercase;letter-spacing:1px}
      .abs-title{text-align:center;padding:6px 16px 2px;font-size:13px;font-weight:900;letter-spacing:1px;color:#111;text-transform:uppercase}
      .abs-periode{text-align:center;padding:0 16px 6px;font-size:10px;color:#666}
      .abs-kpis{display:flex;gap:8px;padding:0 16px 8px;flex-wrap:wrap}
      .kpi{flex:1;min-width:120px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;display:flex;flex-direction:column}
      .kpi .k-lbl{font-size:7px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;margin-bottom:4px}
      .kpi .k-val{font-size:18px;font-weight:800;color:#111}
      .kpi.ko{background:#fef2f2;border-color:#fecaca}.kpi.ko .k-val{color:#dc2626}.kpi.ko .k-lbl{color:#991b1b}
      .kpi.warn{background:#fffbeb;border-color:#fde68a}.kpi.warn .k-val{color:#f59e0b}.kpi.warn .k-lbl{color:#92400e}
      .abs-table{width:calc(100% - 32px);margin:4px 16px 8px;border-collapse:collapse;font-size:9px}
      .abs-table thead th{background:#1e293b;color:#fff;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding:6px 5px;font-size:8px;border:1px solid #0f172a;text-align:left}
      .abs-table tbody td{padding:5px 6px;border:1px solid #e5e7eb;vertical-align:top;line-height:1.4}
      .abs-table tbody tr:nth-child(even) td{background:#fafafa}
      .abs-table tbody tr{page-break-inside:avoid}
      .abs-table.compact tbody td{padding:4px 6px}
      .chip{display:inline-block;padding:2px 8px;border-radius:999px;font-size:8px;font-weight:700}
      .chip-red{background:#fee2e2;color:#991b1b}
      .chip-orange{background:#ffedd5;color:#9a3412}
      .chip-green{background:#dcfce7;color:#166534}
      .empty{padding:30px;text-align:center;color:#888;font-style:italic;font-size:11px}
      .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:0 16px 10px}
      .panel{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;background:#fff}
      .panel h3{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:#E30613;margin-bottom:6px}
      .panel .abs-table{margin:0;width:100%}
    </style></head>
    <body>
      ${uptechHeaderHTML()}
      <div class="abs-sub">
        <span class="left">Pédagogie — Suivi des absences</span>
        <span>Émis le ${emitDate}</span>
      </div>
      <div class="abs-title">${esc(titre)}</div>
      <div class="abs-periode">${esc(periode)}</div>
      ${kpisHTML}
      ${bodyHTML}
      ${uptechFooterHTML(esc(periode))}
    </body></html>`

  openPrintWindow(html)
}
</script>

<template>
  <div class="uc-content">
    <UcPageHeader title="Suivi des absences" subtitle="Par jour, semaine, mois et classe">
      <template #actions>
        <button @click="loadCurrent" class="uc-btn-outline">↺ Actualiser</button>
        <button @click="exportPDF" class="uc-btn-primary" title="Exporter l'onglet courant au format PDF">
          📄 Exporter PDF
        </button>
      </template>
    </UcPageHeader>

    <!-- Onglets -->
    <div style="display:flex;gap:4px;border-bottom:2px solid #e2e8f0;margin-bottom:20px;">
      <button v-for="t in ([
        { key:'top',     label:'🏆 Top absents' },
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

      <!-- Liste détaillée de TOUTES les absences de la semaine -->
      <div v-if="semaineData && semaineData.details && semaineData.details.length > 0"
        style="margin-top:20px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
          <h3 style="font-size:13px;font-weight:700;color:#1e293b;margin:0;">
            📋 Liste détaillée des absences/retards
          </h3>
          <span style="font-size:11px;color:#64748b;background:#f1f5f9;padding:3px 10px;border-radius:999px;font-weight:600;">
            {{ semaineData.details.length }} ligne{{ semaineData.details.length > 1 ? 's' : '' }}
          </span>
        </div>
        <div class="uc-table-wrap" style="margin:0;">
          <table class="uc-table">
            <thead>
              <tr>
                <th style="width:90px;">Jour</th>
                <th>Étudiant</th>
                <th>Classe</th>
                <th>Séance / Matière</th>
                <th style="width:110px;">Horaire</th>
                <th>Enseignant</th>
                <th style="text-align:center;width:80px;">Statut</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in semaineData.details" :key="`${r.id}-${r.seance.id}-${r.etudiant.id}`">
                <td style="font-size:11px;color:#475569;font-weight:600;white-space:nowrap;">{{ fmtDate(r.jour) }}</td>
                <td>
                  <div style="font-weight:700;color:#1e293b;">{{ r.etudiant.prenom }} {{ r.etudiant.nom }}</div>
                  <div v-if="r.etudiant.numero_etudiant" style="font-size:10px;color:#94a3b8;font-family:monospace;">{{ r.etudiant.numero_etudiant }}</div>
                </td>
                <td style="font-size:12px;color:#475569;">{{ r.classe.nom }}</td>
                <td style="font-size:12px;color:#1e293b;">{{ r.seance.matiere || '—' }}</td>
                <td style="font-size:11px;color:#64748b;white-space:nowrap;">
                  {{ fmtHeure(r.seance.date_debut) }}–{{ fmtHeure(r.seance.date_fin) }}
                </td>
                <td style="font-size:12px;color:#475569;">
                  <span v-if="r.seance.enseignant?.id">{{ r.seance.enseignant.prenom }} {{ r.seance.enseignant.nom }}</span>
                  <span v-else style="color:#cbd5e1;">—</span>
                </td>
                <td style="text-align:center;">
                  <span :style="{
                    display:'inline-block',padding:'2px 10px',borderRadius:'20px',
                    fontSize:'10px',fontWeight:'700',
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

    <!-- ═══════════════ ONGLET TOP ABSENTS ═══════════════ -->
    <div v-if="tab === 'top'">
      <div class="uc-filters-bar">
        <UcFormGroup label="Période (mois)">
          <input type="month" v-model="filterMoisTop" class="uc-input" />
        </UcFormGroup>
      </div>

      <!-- KPIs -->
      <div class="uc-kpi-grid" style="margin-bottom:18px;" v-if="topData">
        <div class="uc-kpi-card">
          <div class="uc-kpi-label">Étudiants absents ce mois</div>
          <div class="uc-kpi-value">{{ topData.classement.length }}</div>
        </div>
        <div class="uc-kpi-card" style="background:#fef2f2;border-color:#fecaca;">
          <div class="uc-kpi-label" style="color:#991b1b;">Total absences</div>
          <div class="uc-kpi-value" style="color:#dc2626;">{{ topData.total_absents }}</div>
        </div>
        <div class="uc-kpi-card" style="background:#fffbeb;border-color:#fde68a;">
          <div class="uc-kpi-label" style="color:#92400e;">Total retards</div>
          <div class="uc-kpi-value" style="color:#f59e0b;">{{ topData.total_retards }}</div>
        </div>
      </div>

      <div v-if="loading" class="uc-empty">Chargement…</div>
      <div v-else-if="!topData || topData.classement.length === 0" class="uc-empty">
        Aucune absence enregistrée pour ce mois.
      </div>
      <div v-else class="uc-table-wrap">
        <table class="uc-table">
          <thead>
            <tr>
              <th style="width:50px;">#</th>
              <th>Étudiant</th>
              <th>Classe</th>
              <th style="text-align:center;">Absences</th>
              <th style="text-align:center;">Retards</th>
              <th style="text-align:center;">Taux d'absence</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in topData.classement" :key="e.id">
              <td>
                <span :style="{
                  display:'inline-flex',alignItems:'center',justifyContent:'center',
                  width:'28px',height:'28px',borderRadius:'50%',
                  background: (i as number) === 0 ? '#fef3c7' : (i as number) === 1 ? '#e5e7eb' : (i as number) === 2 ? '#fed7aa' : '#f8fafc',
                  color: (i as number) < 3 ? '#92400e' : '#64748b',
                  fontSize:'12px', fontWeight:'800',
                }">{{ (i as number) + 1 }}</span>
              </td>
              <td>
                <div style="display:flex;align-items:center;gap:10px;">
                  <div :style="{
                    width:'32px',height:'32px',borderRadius:'50%',
                    background:'linear-gradient(135deg,#ef4444 0%,#b91c1c 100%)',
                    color:'#fff',fontSize:'11px',fontWeight:'700',
                    display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                  }">{{ (e.prenom?.[0] ?? '') + (e.nom?.[0] ?? '') }}</div>
                  <div>
                    <div style="font-weight:700;color:#1e293b;">{{ e.prenom }} {{ e.nom }}</div>
                    <div style="font-size:10px;color:#94a3b8;font-family:monospace;">{{ e.numero_etudiant ?? '—' }}</div>
                  </div>
                </div>
              </td>
              <td style="font-size:12px;color:#475569;">{{ e.classe?.nom ?? '—' }}</td>
              <td style="text-align:center;">
                <span style="display:inline-block;min-width:36px;padding:3px 10px;border-radius:20px;background:#fef2f2;color:#b91c1c;font-weight:800;">
                  {{ e.nb_absences }}
                </span>
              </td>
              <td style="text-align:center;color:#f59e0b;font-weight:600;">{{ e.nb_retards }}</td>
              <td style="text-align:center;">
                <span :style="{
                  display:'inline-block',padding:'3px 12px',borderRadius:'20px',fontSize:'11px',fontWeight:'700',
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
</template>
