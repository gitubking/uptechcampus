<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import api from '@/services/api'
import { UcModal, UcFormGroup, UcPageHeader } from '@/components/ui'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

interface Etudiant {
  inscription_id: number
  etudiant_id: number
  nom: string
  prenom: string
  numero_etudiant: string
  telephone: string
  email: string
  classe_id: number
  classe_nom: string
  filiere_nom: string
  mensualite: number
  mensualites_dues: number
  mensualites_payees: number
  retard: number
  montant_du: number
  total_paye: number
  statut: 'a_jour' | 'retard_leger' | 'en_retard' | 'pas_encore_du'
}

interface Resume {
  total: number
  a_jour: number
  retard_leger: number
  en_retard: number
  total_creances: number
  total_paye: number
}

const loading = ref(false)
const etudiants = ref<Etudiant[]>([])
const resume = ref<Resume | null>(null)
const classes = ref<{ id: number; nom: string }[]>([])
const annees = ref<{ id: number; libelle: string }[]>([])

const moisControle = ref(new Date().toISOString().slice(0, 7))
const filterAnnee = ref<number | null>(null)
const filterClasse = ref<number | null>(null)
const filterStatut = ref<string>('')
const search = ref('')

// Notification
const showNotifModal = ref(false)
const notifCible = ref<'en_retard' | 'retard_leger' | 'tous_retard'>('tous_retard')
const notifMessagePerso = ref('')
const notifEnvoi = ref(false)
const notifResult = ref<{ notifie: number; sans_compte: number; message: string } | null>(null)

const statutLabels: Record<string, string> = {
  a_jour: 'À jour',
  retard_leger: 'Retard léger',
  en_retard: 'En retard',
  pas_encore_du: 'Pas encore dû',
}

const statutColors: Record<string, { bg: string; text: string; dot: string }> = {
  a_jour: { bg: '#f0fdf4', text: '#166534', dot: '#16a34a' },
  retard_leger: { bg: '#fffbeb', text: '#92400e', dot: '#f59e0b' },
  en_retard: { bg: '#fef2f2', text: '#dc2626', dot: '#ef4444' },
  pas_encore_du: { bg: '#f8fafc', text: '#64748b', dot: '#94a3b8' },
}

function formatFCFA(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' FCFA'
}
// Version PDF : remplace les espaces insécables (U+202F, U+00A0) par des espaces normaux
// car jsPDF (police helvetica) ne supporte pas ces caractères Unicode
function fmtPDF(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' FCFA'
}

const etudiantsFiltres = computed(() => {
  let list = etudiants.value
  if (filterClasse.value) list = list.filter(e => e.classe_id === filterClasse.value)
  if (filterStatut.value) list = list.filter(e => e.statut === filterStatut.value)
  if (search.value) {
    const q = search.value.toLowerCase()
    list = list.filter(e =>
      e.nom.toLowerCase().includes(q) ||
      e.prenom.toLowerCase().includes(q) ||
      (e.numero_etudiant || '').toLowerCase().includes(q) ||
      (e.telephone || '').includes(q)
    )
  }
  return list
})

const resumeFiltré = computed(() => {
  const list = etudiantsFiltres.value
  return {
    total: list.length,
    a_jour: list.filter(e => e.statut === 'a_jour' || e.statut === 'pas_encore_du').length,
    retard_leger: list.filter(e => e.statut === 'retard_leger').length,
    en_retard: list.filter(e => e.statut === 'en_retard').length,
    total_creances: list.reduce((s, e) => s + Math.max(0, e.montant_du), 0),
    total_paye: list.reduce((s, e) => s + e.total_paye, 0),
  }
})

async function envoyerNotifications() {
  notifEnvoi.value = true
  notifResult.value = null
  try {
    let cibles: Etudiant[]
    if (notifCible.value === 'en_retard') cibles = etudiantsFiltres.value.filter(e => e.statut === 'en_retard')
    else if (notifCible.value === 'retard_leger') cibles = etudiantsFiltres.value.filter(e => e.statut === 'retard_leger')
    else cibles = etudiantsFiltres.value.filter(e => e.statut === 'en_retard' || e.statut === 'retard_leger')

    const { data } = await api.post('/suivi-paiements-global/notifier', {
      inscription_ids: cibles.map(e => e.inscription_id),
      message_perso: notifMessagePerso.value.trim() || undefined,
      mois_controle: moisControle.value,
    })
    notifResult.value = data
  } catch {
    notifResult.value = { notifie: 0, sans_compte: 0, message: 'Erreur lors de l\'envoi.' }
  } finally {
    notifEnvoi.value = false
  }
}

function exportExcel() {
  const list = etudiantsFiltres.value
  const rows = list.map(e => ({
    'Numéro': e.numero_etudiant || '',
    'Prénom': e.prenom,
    'Nom': e.nom,
    'Téléphone': e.telephone || '',
    'Email': e.email || '',
    'Classe': e.classe_nom,
    'Filière': e.filiere_nom || '',
    'Mensualité (FCFA)': e.mensualite,
    'Mensualités attendues': e.mensualites_dues,
    'Mensualités payées': e.mensualites_payees,
    'Retard (mois)': e.retard > 0 ? e.retard : 0,
    'Montant dû (FCFA)': e.montant_du > 0 ? e.montant_du : 0,
    'Total payé (FCFA)': e.total_paye,
    'Statut': statutLabels[e.statut] || e.statut,
  }))

  // Ligne résumé
  const r = resumeFiltré.value
  const ws = XLSX.utils.json_to_sheet(rows)
  // Largeurs colonnes
  ws['!cols'] = [
    { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 22 },
    { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 },
    { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 14 },
  ]
  // Feuille résumé
  const summaryData = [
    ['Rapport Suivi Paiements — ' + moisControle.value],
    [],
    ['Total étudiants', r.total],
    ['À jour', r.a_jour],
    ['Retard léger', r.retard_leger],
    ['En retard', r.en_retard],
    ['Total impayés (FCFA)', r.total_creances],
    ['Total encaissé (FCFA)', r.total_paye],
  ]
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData)

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Résumé')
  XLSX.utils.book_append_sheet(wb, ws, 'Détail étudiants')
  XLSX.writeFile(wb, `suivi_paiements_${moisControle.value}.xlsx`)
}

function exportPDF() {
  const list = etudiantsFiltres.value
  const r = resumeFiltré.value
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.width
  const pageH = doc.internal.pageSize.height

  // En-tête
  doc.setFillColor(30, 41, 59)
  doc.rect(0, 0, pageW, 22, 'F')
  doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(255)
  doc.text("UP'TECH — Suivi des paiements", 14, 10)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.text(`Mois de contrôle : ${moisControle.value}   |   Généré le ${new Date().toLocaleDateString('fr-FR')}`, 14, 17)

  // KPIs
  const kpis = [
    { label: 'Total', val: String(r.total), color: [30, 41, 59] as [number,number,number] },
    { label: 'À jour', val: String(r.a_jour), color: [22, 163, 74] as [number,number,number] },
    { label: 'Retard léger', val: String(r.retard_leger), color: [245, 158, 11] as [number,number,number] },
    { label: 'En retard', val: String(r.en_retard), color: [239, 68, 68] as [number,number,number] },
    { label: 'Impayés', val: fmtPDF(r.total_creances), color: [220, 38, 38] as [number,number,number] },
    { label: 'Encaissé', val: fmtPDF(r.total_paye), color: [29, 78, 216] as [number,number,number] },
  ]
  const kpiW = (pageW - 28) / kpis.length
  kpis.forEach((k, i) => {
    const x = 14 + i * kpiW
    doc.setFillColor(248, 250, 252)
    doc.roundedRect(x, 26, kpiW - 3, 16, 2, 2, 'F')
    doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(100)
    doc.text(k.label, x + (kpiW - 3) / 2, 31, { align: 'center' })
    doc.setFontSize(9); doc.setFont('helvetica', 'bold')
    doc.setTextColor(...k.color)
    doc.text(k.val, x + (kpiW - 3) / 2, 38, { align: 'center' })
  })

  // Tableau
  autoTable(doc, {
    startY: 46,
    head: [['N°', 'Prénom Nom', 'Classe', 'Mensualité', 'Attendues', 'Payées', 'Retard', 'Montant dû', 'Total payé', 'Statut']],
    body: list.map(e => [
      e.numero_etudiant || '',
      `${e.prenom} ${e.nom}`,
      e.classe_nom,
      fmtPDF(e.mensualite),
      String(e.mensualites_dues),
      String(e.mensualites_payees),
      e.retard > 0 ? `${e.retard} mois` : '-',
      e.montant_du > 0 ? fmtPDF(e.montant_du) : '-',
      fmtPDF(e.total_paye),
      statutLabels[e.statut] || e.statut,
    ]),
    theme: 'grid',
    styles: { fontSize: 6.5, cellPadding: 2, font: 'helvetica', textColor: [30, 41, 59] },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 36 },
      2: { cellWidth: 24 },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 16, halign: 'center' },
      6: { cellWidth: 16, halign: 'center' },
      7: { cellWidth: 24, halign: 'right' },
      8: { cellWidth: 24, halign: 'right' },
      9: { cellWidth: 22, halign: 'center' },
    },
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const statut = list[data.row.index]?.statut
        if (statut === 'en_retard') data.cell.styles.fillColor = [255, 245, 245]
        else if (statut === 'retard_leger') data.cell.styles.fillColor = [255, 253, 240]
        else if (statut === 'a_jour') data.cell.styles.fillColor = [240, 253, 244]
      }
    },
    margin: { left: 14, right: 14 },
  })

  // Pied de page
  doc.setFontSize(6); doc.setFont('helvetica', 'italic'); doc.setTextColor(160)
  doc.text('UPTECH Campus — Document généré automatiquement', 14, pageH - 5)

  doc.save(`suivi_paiements_${moisControle.value}.pdf`)
}

async function load() {
  loading.value = true
  try {
    const [res, aRes] = await Promise.all([
      api.get('/suivi-paiements-global', { params: { mois_controle: moisControle.value, annee_academique_id: filterAnnee.value || undefined } }),
      api.get('/annees-academiques'),
    ])
    etudiants.value = res.data.etudiants
    resume.value = res.data.resume
    classes.value = res.data.classes
    annees.value = aRes.data
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="uc-content">
    <!-- En-tête -->
    <UcPageHeader title="Suivi des paiements" subtitle="Vue globale de tous les étudiants">
      <template #actions>
        <button @click="exportExcel" class="uc-btn-primary" style="background:#16a34a;">Excel</button>
        <button @click="exportPDF" class="uc-btn-dark">PDF</button>
        <button @click="showNotifModal = true" class="uc-btn-primary">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
          Notifier
        </button>
      </template>
    </UcPageHeader>

    <!-- Filtres -->
    <div class="uc-filters-bar">
      <UcFormGroup label="Mois de contrôle">
        <input type="month" v-model="moisControle" @change="load" class="uc-input" />
      </UcFormGroup>
      <UcFormGroup label="Année académique">
        <select v-model="filterAnnee" @change="load" class="uc-input" style="min-width:160px;">
          <option :value="null">Toutes</option>
          <option v-for="a in annees" :key="a.id" :value="a.id">{{ a.libelle }}</option>
        </select>
      </UcFormGroup>
      <UcFormGroup label="Classe">
        <select v-model="filterClasse" class="uc-input" style="min-width:160px;">
          <option :value="null">Toutes</option>
          <option v-for="cl in classes" :key="cl.id" :value="cl.id">{{ cl.nom }}</option>
        </select>
      </UcFormGroup>
      <UcFormGroup label="Statut">
        <select v-model="filterStatut" class="uc-input" style="min-width:140px;">
          <option value="">Tous</option>
          <option value="a_jour">À jour</option>
          <option value="retard_leger">Retard léger</option>
          <option value="en_retard">En retard</option>
          <option value="pas_encore_du">Pas encore dû</option>
        </select>
      </UcFormGroup>
      <UcFormGroup label="Recherche" style="flex:1;min-width:180px;">
        <input v-model="search" placeholder="Nom, prénom, numéro, tél…" class="uc-input" />
      </UcFormGroup>
    </div>

    <!-- KPIs -->
    <div v-if="resumeFiltré" class="uc-kpi-grid" style="margin-bottom:20px;">
      <div class="uc-kpi-card">
        <div class="uc-kpi-label">Total</div>
        <div class="uc-kpi-value">{{ resumeFiltré.total }}</div>
      </div>
      <div class="uc-kpi-card" style="background:#f0fdf4;border-color:#bbf7d0;">
        <div class="uc-kpi-label" style="color:#166534;">À jour</div>
        <div class="uc-kpi-value" style="color:#16a34a;">{{ resumeFiltré.a_jour }}</div>
      </div>
      <div class="uc-kpi-card" style="background:#fffbeb;border-color:#fde68a;">
        <div class="uc-kpi-label" style="color:#92400e;">Retard léger</div>
        <div class="uc-kpi-value" style="color:#f59e0b;">{{ resumeFiltré.retard_leger }}</div>
      </div>
      <div class="uc-kpi-card" style="background:#fef2f2;border-color:#fecaca;">
        <div class="uc-kpi-label" style="color:#dc2626;">En retard</div>
        <div class="uc-kpi-value" style="color:#ef4444;">{{ resumeFiltré.en_retard }}</div>
      </div>
      <div class="uc-kpi-card" style="border-color:#fecaca;">
        <div class="uc-kpi-label" style="color:#dc2626;">Impayés</div>
        <div class="uc-kpi-value" style="font-size:15px;color:#dc2626;">{{ formatFCFA(resumeFiltré.total_creances) }}</div>
      </div>
      <div class="uc-kpi-card" style="background:#eff6ff;border-color:#bfdbfe;">
        <div class="uc-kpi-label" style="color:#1d4ed8;">Total encaissé</div>
        <div class="uc-kpi-value" style="font-size:15px;color:#1d4ed8;">{{ formatFCFA(resumeFiltré.total_paye) }}</div>
      </div>
    </div>

    <!-- Chargement -->
    <div v-if="loading" class="uc-empty">Chargement…</div>

    <!-- Tableau -->
    <div v-else-if="etudiantsFiltres.length === 0" class="uc-empty">Aucun étudiant trouvé.</div>
    <div v-else class="uc-table-wrap">
      <div style="overflow-y:auto;max-height:calc(100vh - 380px);">
        <table class="uc-table">
          <thead>
            <tr>
              <th style="white-space:nowrap;">Étudiant</th>
              <th style="white-space:nowrap;">Classe</th>
              <th style="text-align:right;white-space:nowrap;">Mensualité</th>
              <th style="text-align:center;white-space:nowrap;">Attendues</th>
              <th style="text-align:center;white-space:nowrap;">Payées</th>
              <th style="text-align:center;white-space:nowrap;">Retard</th>
              <th style="text-align:right;white-space:nowrap;">Montant dû</th>
              <th style="text-align:right;white-space:nowrap;">Total payé</th>
              <th style="text-align:center;white-space:nowrap;">Statut</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in etudiantsFiltres" :key="e.inscription_id"
              :style="{ background: e.statut === 'en_retard' ? '#fff5f5' : e.statut === 'retard_leger' ? '#fffdf0' : 'transparent' }">
              <td>
                <div style="font-weight:600;color:#1e293b;">{{ e.prenom }} {{ e.nom }}</div>
                <div style="font-size:10px;color:#94a3b8;">{{ e.numero_etudiant }}</div>
                <div v-if="e.telephone" style="font-size:10px;color:#64748b;">{{ e.telephone }}</div>
              </td>
              <td>
                <div style="font-weight:600;color:#334155;">{{ e.classe_nom }}</div>
                <div style="font-size:10px;color:#94a3b8;">{{ e.filiere_nom }}</div>
              </td>
              <td style="text-align:right;font-weight:600;">{{ formatFCFA(e.mensualite) }}</td>
              <td style="text-align:center;color:#475569;">{{ e.mensualites_dues }}</td>
              <td style="text-align:center;color:#16a34a;font-weight:600;">{{ e.mensualites_payees }}</td>
              <td style="text-align:center;">
                <span v-if="e.retard > 0" style="font-weight:700;color:#ef4444;">{{ e.retard }} mois</span>
                <span v-else style="color:#94a3b8;">—</span>
              </td>
              <td style="text-align:right;font-weight:700;" :style="{ color: e.montant_du > 0 ? '#dc2626' : '#16a34a' }">
                {{ e.montant_du > 0 ? formatFCFA(e.montant_du) : '—' }}
              </td>
              <td style="text-align:right;color:#1d4ed8;font-weight:600;">{{ formatFCFA(e.total_paye) }}</td>
              <td style="text-align:center;">
                <span :style="{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700',
                  background: statutColors[e.statut]?.bg,
                  color: statutColors[e.statut]?.text,
                }">
                  <span :style="{ width: '7px', height: '7px', borderRadius: '50%', background: statutColors[e.statut]?.dot, display: 'inline-block' }"></span>
                  {{ statutLabels[e.statut] }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Modale notification -->
    <UcModal v-model="showNotifModal" title="Envoyer une notification" width="500px"
      @close="notifResult = null; notifMessagePerso = ''">
      <div style="margin-bottom:14px;">
        <label class="uc-label" style="margin-bottom:8px;display:block;">Destinataires</label>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="radio" v-model="notifCible" value="tous_retard" style="accent-color:#E30613;" />
            Tous en retard (léger + grave) — <strong>{{ etudiantsFiltres.filter(e => e.statut === 'en_retard' || e.statut === 'retard_leger').length }}</strong> étudiant(s)
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="radio" v-model="notifCible" value="en_retard" style="accent-color:#E30613;" />
            Retard grave uniquement — <strong style="color:#ef4444;">{{ etudiantsFiltres.filter(e => e.statut === 'en_retard').length }}</strong> étudiant(s)
          </label>
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
            <input type="radio" v-model="notifCible" value="retard_leger" style="accent-color:#E30613;" />
            Retard léger uniquement — <strong style="color:#f59e0b;">{{ etudiantsFiltres.filter(e => e.statut === 'retard_leger').length }}</strong> étudiant(s)
          </label>
        </div>
      </div>
      <UcFormGroup label="Message personnalisé (optionnel)">
        <p style="font-size:10px;color:#94a3b8;margin:0 0 6px;">Variables disponibles : <code>{prenom}</code> <code>{nom}</code> <code>{classe}</code> <code>{mois}</code></p>
        <textarea v-model="notifMessagePerso" rows="5" placeholder="Laisser vide pour le message automatique…" class="uc-input" style="resize:vertical;font-family:inherit;"></textarea>
      </UcFormGroup>
      <div v-if="notifResult" class="uc-alert" :class="notifResult.notifie > 0 ? 'uc-alert-success' : 'uc-alert-error'" style="margin-top:12px;">
        {{ notifResult.message }}
        <span v-if="notifResult.sans_compte > 0" style="display:block;font-size:11px;font-weight:400;margin-top:4px;">{{ notifResult.sans_compte }} étudiant(s) sans compte — non notifiés.</span>
      </div>
      <template #footer>
        <button @click="showNotifModal = false; notifResult = null; notifMessagePerso = ''" class="uc-btn-outline">Fermer</button>
        <button @click="envoyerNotifications" :disabled="notifEnvoi" class="uc-btn-primary">
          {{ notifEnvoi ? 'Envoi…' : 'Envoyer la notification' }}
        </button>
      </template>
    </UcModal>
  </div>
</template>
