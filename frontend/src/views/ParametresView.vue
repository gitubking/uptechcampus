<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'

// ── Interfaces ──────────────────────────────────────────────────────
interface Parametre {
  cle: string
  groupe: string
  valeur: string
  description: string | null
}

interface TypeFormation {
  id: number
  nom: string
  code: string
  actif: boolean
  has_niveau: boolean
  filieres: { id: number }[]
}

interface AnneeAcademique {
  id: number
  libelle: string
  actif: boolean
}

interface Tarif {
  id: number
  montant_horaire: number
  date_effet: string
  type_formation?: TypeFormation
  annee_academique?: AnneeAcademique
}

interface Matiere {
  id: number
  nom: string
  code: string
  description: string | null
  actif: boolean
}

interface NiveauEntree {
  id: number
  nom: string
  code: string
  est_superieur_bac: boolean
  ordre: number
  actif: boolean
}

interface NiveauBourse {
  id: number
  nom: string
  pourcentage: number
  applique_inscription: boolean
  actif: boolean
}

// ── Général ──────────────────────────────────────────────────────────
const auth = useAuthStore()
const parametres = ref<Parametre[]>([])
const loading = ref(true)
const saving = ref<string | null>(null)
const saved = ref<string | null>(null)
const editValues = ref<Record<string, string>>({})
const activeGroup = ref('etablissement')

// ── Onglet pédagogique actif ─────────────────────────────────────────
const activePedaTab = ref<'types' | 'tarifs' | 'matieres' | 'niveaux-entree' | 'niveaux-bourse'>('types')

// ── Types de formation ──────────────────────────────────────────────
const typesFormation = ref<TypeFormation[]>([])
const loadingTypes = ref(false)
const showModalType = ref(false)
const editingType = ref<TypeFormation | null>(null)
const savingType = ref(false)
const deletingTypeId = ref<number | null>(null)
const formType = ref({ nom: '', code: '', actif: true, has_niveau: false })

async function loadTypesFormation() {
  loadingTypes.value = true
  try {
    const { data } = await api.get('/types-formation')
    typesFormation.value = data
  } finally {
    loadingTypes.value = false
  }
}

function openNewType() {
  editingType.value = null
  formType.value = { nom: '', code: '', actif: true, has_niveau: false }
  showModalType.value = true
}

function openEditType(t: TypeFormation) {
  editingType.value = t
  formType.value = { nom: t.nom, code: t.code, actif: t.actif, has_niveau: t.has_niveau ?? false }
  showModalType.value = true
}

async function saveType() {
  if (!formType.value.nom.trim() || !formType.value.code.trim()) return
  savingType.value = true
  try {
    const payload = { nom: formType.value.nom, code: formType.value.code, actif: formType.value.actif }
    if (editingType.value) {
      const { data } = await api.put(`/types-formation/${editingType.value.id}`, payload)
      const idx = typesFormation.value.findIndex(t => t.id === editingType.value!.id)
      if (idx >= 0) typesFormation.value[idx] = data
    } else {
      const { data } = await api.post('/types-formation', payload)
      typesFormation.value.push(data)
    }
    showModalType.value = false
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Erreur lors de la sauvegarde')
  } finally {
    savingType.value = false
  }
}

async function deleteType(t: TypeFormation) {
  if (!confirm(`Supprimer le type "${t.nom}" ?`)) return
  deletingTypeId.value = t.id
  try {
    await api.delete(`/types-formation/${t.id}`)
    typesFormation.value = typesFormation.value.filter(x => x.id !== t.id)
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Suppression impossible')
  } finally {
    deletingTypeId.value = null
  }
}

// ── Tarifs intervenants ───────────────────────────────────────────────
const tarifs = ref<Tarif[]>([])
const anneesAcademiques = ref<AnneeAcademique[]>([])
const loadingTarifs = ref(false)
const showModalTarif = ref(false)
const savingTarif = ref(false)
const errorTarif = ref('')
const formTarif = ref({
  type_formation_id: null as number | null,
  annee_academique_id: null as number | null,
  montant_horaire: 0,
  date_effet: new Date().toISOString().split('T')[0],
})

async function loadTarifs() {
  loadingTarifs.value = true
  try {
    const [t, a] = await Promise.all([api.get('/tarifs'), api.get('/annees-academiques')])
    tarifs.value = t.data
    anneesAcademiques.value = a.data
  } finally {
    loadingTarifs.value = false
  }
}

function openNewTarif() {
  const anneeActive = anneesAcademiques.value.find(a => a.actif)
  formTarif.value = {
    type_formation_id: typesFormation.value[0]?.id ?? null,
    annee_academique_id: anneeActive?.id ?? anneesAcademiques.value[0]?.id ?? null,
    montant_horaire: 0,
    date_effet: new Date().toISOString().split('T')[0],
  }
  errorTarif.value = ''
  showModalTarif.value = true
}

async function saveTarif() {
  savingTarif.value = true
  errorTarif.value = ''
  try {
    const { data } = await api.post('/tarifs', formTarif.value)
    const idx = tarifs.value.findIndex(t =>
      t.type_formation?.id === data.type_formation?.id &&
      t.annee_academique?.id === data.annee_academique?.id
    )
    if (idx !== -1) tarifs.value[idx] = data
    else tarifs.value.push(data)
    showModalTarif.value = false
  } catch (e: any) {
    const errs = e.response?.data?.errors as Record<string, string[]> | undefined
    errorTarif.value = (errs ? Object.values(errs)[0]?.[0] : undefined) ?? e.response?.data?.message ?? 'Erreur'
  } finally {
    savingTarif.value = false
  }
}

function formatTarifAmount(n: number) {
  return new Intl.NumberFormat('fr-FR').format(n) + ' FCFA/h'
}

function formatTarifDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Matières ─────────────────────────────────────────────────────────
const matieres = ref<Matiere[]>([])
const loadingMatieres = ref(false)
const showModalMatiere = ref(false)
const editingMatiere = ref<Matiere | null>(null)
const savingMatiere = ref(false)
const deletingMatiereId = ref<number | null>(null)
const formMatiere = ref({ nom: '', code: '', description: '', actif: true })

async function loadMatieres() {
  loadingMatieres.value = true
  try {
    const { data } = await api.get('/matieres')
    matieres.value = data
  } finally {
    loadingMatieres.value = false
  }
}

function openNewMatiere() {
  editingMatiere.value = null
  formMatiere.value = { nom: '', code: '', description: '', actif: true }
  showModalMatiere.value = true
}

function openEditMatiere(m: Matiere) {
  editingMatiere.value = m
  formMatiere.value = { nom: m.nom, code: m.code, description: m.description ?? '', actif: m.actif }
  showModalMatiere.value = true
}

async function saveMatiere() {
  if (!formMatiere.value.nom.trim() || !formMatiere.value.code.trim()) return
  savingMatiere.value = true
  try {
    const payload = {
      nom: formMatiere.value.nom, code: formMatiere.value.code,
      description: formMatiere.value.description || null, actif: formMatiere.value.actif,
    }
    if (editingMatiere.value) {
      const { data } = await api.put(`/matieres/${editingMatiere.value.id}`, payload)
      const idx = matieres.value.findIndex(m => m.id === editingMatiere.value!.id)
      if (idx >= 0) matieres.value[idx] = data
    } else {
      const { data } = await api.post('/matieres', payload)
      matieres.value.push(data)
    }
    showModalMatiere.value = false
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Erreur lors de la sauvegarde')
  } finally {
    savingMatiere.value = false
  }
}

async function deleteMatiere(m: Matiere) {
  if (!confirm(`Supprimer la matière "${m.nom}" ?`)) return
  deletingMatiereId.value = m.id
  try {
    await api.delete(`/matieres/${m.id}`)
    matieres.value = matieres.value.filter(x => x.id !== m.id)
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Suppression impossible')
  } finally {
    deletingMatiereId.value = null
  }
}

// ── Niveaux d'entrée ─────────────────────────────────────────────────
const niveauxEntree = ref<NiveauEntree[]>([])
const loadingNiveauxEntree = ref(false)
const showModalNiveauEntree = ref(false)
const editingNiveauEntree = ref<NiveauEntree | null>(null)
const savingNiveauEntree = ref(false)
const deletingNiveauEntreeId = ref<number | null>(null)
const formNiveauEntree = ref({ nom: '', code: '', est_superieur_bac: false, ordre: 0, actif: true })

async function loadNiveauxEntree() {
  loadingNiveauxEntree.value = true
  try {
    const { data } = await api.get('/niveaux-entree')
    niveauxEntree.value = data
  } finally {
    loadingNiveauxEntree.value = false
  }
}

function openNewNiveauEntree() {
  editingNiveauEntree.value = null
  formNiveauEntree.value = { nom: '', code: '', est_superieur_bac: false, ordre: 0, actif: true }
  showModalNiveauEntree.value = true
}

function openEditNiveauEntree(n: NiveauEntree) {
  editingNiveauEntree.value = n
  formNiveauEntree.value = {
    nom: n.nom, code: n.code, est_superieur_bac: n.est_superieur_bac,
    ordre: n.ordre, actif: n.actif,
  }
  showModalNiveauEntree.value = true
}

async function saveNiveauEntree() {
  if (!formNiveauEntree.value.nom.trim() || !formNiveauEntree.value.code.trim()) return
  savingNiveauEntree.value = true
  try {
    const payload = { ...formNiveauEntree.value }
    if (editingNiveauEntree.value) {
      const { data } = await api.put(`/niveaux-entree/${editingNiveauEntree.value.id}`, payload)
      const idx = niveauxEntree.value.findIndex(n => n.id === editingNiveauEntree.value!.id)
      if (idx >= 0) niveauxEntree.value[idx] = data
    } else {
      const { data } = await api.post('/niveaux-entree', payload)
      niveauxEntree.value.push(data)
    }
    showModalNiveauEntree.value = false
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Erreur lors de la sauvegarde')
  } finally {
    savingNiveauEntree.value = false
  }
}

async function deleteNiveauEntree(n: NiveauEntree) {
  if (!confirm(`Supprimer le niveau "${n.nom}" ?`)) return
  deletingNiveauEntreeId.value = n.id
  try {
    await api.delete(`/niveaux-entree/${n.id}`)
    niveauxEntree.value = niveauxEntree.value.filter(x => x.id !== n.id)
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Suppression impossible')
  } finally {
    deletingNiveauEntreeId.value = null
  }
}

// ── Niveaux de bourse ─────────────────────────────────────────────────
const niveauxBourse = ref<NiveauBourse[]>([])
const loadingNiveauxBourse = ref(false)
const showModalNiveauBourse = ref(false)
const editingNiveauBourse = ref<NiveauBourse | null>(null)
const savingNiveauBourse = ref(false)
const deletingNiveauBourseId = ref<number | null>(null)
const formNiveauBourse = ref({ nom: '', pourcentage: 0, applique_inscription: false, actif: true })

async function loadNiveauxBourse() {
  loadingNiveauxBourse.value = true
  try {
    const { data } = await api.get('/niveaux-bourse')
    niveauxBourse.value = data
  } finally {
    loadingNiveauxBourse.value = false
  }
}

function openNewNiveauBourse() {
  editingNiveauBourse.value = null
  formNiveauBourse.value = { nom: '', pourcentage: 0, applique_inscription: false, actif: true }
  showModalNiveauBourse.value = true
}

function openEditNiveauBourse(b: NiveauBourse) {
  editingNiveauBourse.value = b
  formNiveauBourse.value = {
    nom: b.nom, pourcentage: b.pourcentage,
    applique_inscription: b.applique_inscription, actif: b.actif,
  }
  showModalNiveauBourse.value = true
}

async function saveNiveauBourse() {
  if (!formNiveauBourse.value.nom.trim()) return
  savingNiveauBourse.value = true
  try {
    const payload = { ...formNiveauBourse.value }
    if (editingNiveauBourse.value) {
      const { data } = await api.put(`/niveaux-bourse/${editingNiveauBourse.value.id}`, payload)
      const idx = niveauxBourse.value.findIndex(b => b.id === editingNiveauBourse.value!.id)
      if (idx >= 0) niveauxBourse.value[idx] = data
    } else {
      const { data } = await api.post('/niveaux-bourse', payload)
      niveauxBourse.value.push(data)
    }
    showModalNiveauBourse.value = false
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Erreur lors de la sauvegarde')
  } finally {
    savingNiveauBourse.value = false
  }
}

async function deleteNiveauBourse(b: NiveauBourse) {
  if (!confirm(`Supprimer le niveau de bourse "${b.nom}" ?`)) return
  deletingNiveauBourseId.value = b.id
  try {
    await api.delete(`/niveaux-bourse/${b.id}`)
    niveauxBourse.value = niveauxBourse.value.filter(x => x.id !== b.id)
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Suppression impossible')
  } finally {
    deletingNiveauBourseId.value = null
  }
}

// ── Groupes et leurs métadonnées ────────────────────────────────────
const groups = [
  { key: 'etablissement', label: 'Établissement',       icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { key: 'academique',    label: 'Académique',           icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { key: 'pedagogique',   label: 'Pédagogique',          icon: 'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222' },
  { key: 'finance',       label: 'Finance & Paiements',  icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { key: 'relances',      label: 'Relances',             icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { key: 'notifications', label: 'Notifications',        icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { key: 'danger',        label: 'Zone de danger',       icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
]

// ── Labels et types de champs ────────────────────────────────────────
const fieldConfig: Record<string, { label: string; type?: string; textarea?: boolean; toggle?: boolean }> = {
  nom_etablissement:          { label: "Nom de l'établissement" },
  abreviation:                { label: 'Abréviation' },
  adresse:                    { label: 'Adresse' },
  telephone:                  { label: 'Téléphone', type: 'tel' },
  email_contact:              { label: 'Email de contact', type: 'email' },
  site_web:                   { label: 'Site web', type: 'url' },
  devise:                     { label: 'Devise (ex: XOF)' },
  fuseau_horaire:             { label: 'Fuseau horaire' },
  cgu_texte:                  { label: 'Texte des CGU', textarea: true },
  seuil_validation_ue:        { label: 'Seuil validation UE (/20)', type: 'number' },
  seuil_mention_passable:     { label: 'Seuil mention Passable (/20)', type: 'number' },
  seuil_mention_ab:           { label: 'Seuil mention Assez Bien (/20)', type: 'number' },
  seuil_mention_bien:         { label: 'Seuil mention Bien (/20)', type: 'number' },
  seuil_mention_tb:           { label: 'Seuil mention Très Bien (/20)', type: 'number' },
  tenue_obligatoire:          { label: 'Tenue vestimentaire obligatoire', toggle: true },
  montant_tenue:              { label: 'Montant tenue (FCFA)', type: 'number' },
  paiement_wave:              { label: 'Accepter Wave', toggle: true },
  paiement_orange_money:      { label: 'Accepter Orange Money', toggle: true },
  paiement_virement:          { label: 'Accepter virement bancaire', toggle: true },
  paiement_especes:           { label: 'Accepter espèces', toggle: true },
  paiement_cheque:            { label: 'Accepter chèques', toggle: true },
  seuil_blocage_acces_jours:  { label: 'Jours avant blocage accès', type: 'number' },
  seuil_depense_justificatif: { label: 'Seuil justificatif dépense (FCFA)', type: 'number' },
  seuil_tresorerie_alerte:    { label: 'Seuil alerte trésorerie (FCFA)', type: 'number' },
  relance_j3:                 { label: 'Relance J+3 (SMS)', toggle: true },
  relance_j7:                 { label: 'Relance J+7 (SMS + WhatsApp + Email)', toggle: true },
  relance_j15:                { label: 'Relance J+15 (notification secrétariat)', toggle: true },
  relance_j30:                { label: 'Relance J+30 (notification direction)', toggle: true },
  message_relance_j3:         { label: 'Modèle SMS J+3', textarea: true },
  message_relance_j7:         { label: 'Modèle SMS J+7', textarea: true },
  heure_debut_notifications:  { label: 'Heure début envoi notifications (0-23)', type: 'number' },
  heure_fin_notifications:    { label: 'Heure fin envoi notifications (0-23)', type: 'number' },
  notif_nouveau_paiement:     { label: 'Notifier à chaque nouveau paiement', toggle: true },
  notif_impaye_j30:           { label: "Notifier à J+30 d'impayé", toggle: true },
  notif_bordereau_attente:    { label: 'Notifier bordereau en attente', toggle: true },
  notif_absence:              { label: 'Notifier les absences', toggle: true },
  notif_conflit_edt:          { label: 'Notifier conflit emploi du temps', toggle: true },
  seuil_absence_alerte:       { label: 'Seuil absences alerte direction (%)', type: 'number' },
  seuil_programme_retard:     { label: 'Seuil progression programme alerte (%)', type: 'number' },
}

// ── Paramètres filtrés par groupe actif ────────────────────────────
const filteredParams = computed(() =>
  parametres.value.filter(p => p.groupe === activeGroup.value)
)

// Paramètres finance hors tenue (affichés séparément)
const financeParamsHorsTenue = computed(() =>
  parametres.value.filter(p =>
    p.groupe === 'finance' && !['tenue_obligatoire', 'montant_tenue'].includes(p.cle)
  )
)

// Paramètres tenue (si configurés dans la DB)
const tenueObligatoire = computed(() =>
  parametres.value.find(p => p.cle === 'tenue_obligatoire')
)
const montantTenue = computed(() =>
  parametres.value.find(p => p.cle === 'montant_tenue')
)

const isDG = computed(() => auth.user?.role === 'dg')

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/parametres')
    parametres.value = data
    for (const p of data) {
      editValues.value[p.cle] = p.valeur
    }
  } finally {
    loading.value = false
  }
}

async function save(cle: string) {
  saving.value = cle
  try {
    await api.put(`/parametres/${cle}`, { valeur: editValues.value[cle] })
    const p = parametres.value.find(x => x.cle === cle)
    if (p) p.valeur = editValues.value[cle] ?? ''
    saved.value = cle
    setTimeout(() => { if (saved.value === cle) saved.value = null }, 2000)
  } finally {
    saving.value = null
  }
}

function toggleValue(cle: string) {
  editValues.value[cle] = editValues.value[cle] === '1' ? '0' : '1'
  save(cle)
}

onMounted(() => {
  load()
  loadTypesFormation()
  loadTarifs()
  loadMatieres()
  loadNiveauxEntree()
  loadNiveauxBourse()
})
</script>

<template>
  <div class="uc-content pm-layout" style="padding:0">

    <!-- Sidebar groupes -->
    <aside class="pm-sidebar">
      <h2 class="pm-sidebar-title">Catégories</h2>
      <nav>
        <button
          v-for="g in groups"
          :key="g.key"
          @click="activeGroup = g.key"
          class="pm-nav-btn"
          :class="activeGroup === g.key ? 'pm-nav-btn--active' : ''"
        >
          <svg class="pm-nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="g.icon" />
          </svg>
          {{ g.label }}
        </button>
      </nav>
    </aside>

    <!-- Contenu principal -->
    <main class="pm-main">

      <!-- ═══ PÉDAGOGIQUE ═══════════════════════════════════════════════ -->
      <template v-if="activeGroup === 'pedagogique'">

        <div class="pm-section-header">
          <h1 class="pm-section-title">Pédagogique</h1>
          <p class="pm-section-desc">Types de formation, matières, niveaux d'entrée et bourses</p>
        </div>

        <!-- Sous-onglets -->
        <div class="pm-subtabs">
          <button
            v-for="tab in [
              { key: 'types',          label: 'Types de formation' },
              { key: 'tarifs',         label: 'Tarifs' },
              { key: 'matieres',       label: 'Matières' },
              { key: 'niveaux-entree', label: 'Niveaux d\'entrée' },
              { key: 'niveaux-bourse', label: 'Niveaux de bourse' },
            ]"
            :key="tab.key"
            @click="activePedaTab = tab.key as any"
            class="pm-subtab"
            :class="activePedaTab === tab.key ? 'pm-subtab--active' : ''"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- ─── Types de formation ─────────────────────────────────── -->
        <template v-if="activePedaTab === 'types'">
          <div class="pm-tab-bar">
            <p class="pm-tab-desc">Définissez les filières de formation et leurs taux horaires.</p>
            <button v-if="isDG" @click="openNewType" class="uc-btn-primary">+ Nouveau type</button>
          </div>

          <div v-if="loadingTypes" class="pm-empty">Chargement…</div>
          <div v-else-if="typesFormation.length === 0" class="pm-empty">Aucun type de formation configuré.</div>
          <div v-else class="pm-table-wrap">
            <table class="pm-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Code</th>
                  <th style="text-align:center">Années d'étude</th>
                  <th style="text-align:center">Filières</th>
                  <th style="text-align:center">Statut</th>
                  <th v-if="isDG" style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in typesFormation" :key="t.id">
                  <td class="pm-td-bold">{{ t.nom }}</td>
                  <td><span class="pm-badge-code">{{ t.code }}</span></td>
                  <td style="text-align:center">
                    <span v-if="t.has_niveau" style="font-size:11px;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:10px;font-weight:600;">✓ Oui</span>
                    <span v-else style="font-size:11px;color:#aaa;">—</span>
                  </td>
                  <td style="text-align:center"><span class="pm-count-badge">{{ t.filieres?.length ?? 0 }}</span></td>
                  <td style="text-align:center">
                    <span class="pm-badge-statut" :class="t.actif ? 'pm-statut-actif' : 'pm-statut-inactif'">
                      {{ t.actif ? 'Actif' : 'Inactif' }}
                    </span>
                  </td>
                  <td v-if="isDG" style="text-align:right">
                    <div class="pm-actions">
                      <button @click="openEditType(t)" class="pm-action-btn" title="Modifier">
                        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button @click="deleteType(t)" :disabled="deletingTypeId === t.id" class="pm-action-btn pm-action-btn--danger" title="Supprimer">
                        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Modal Type de formation -->
          <Teleport to="body">
            <div v-if="showModalType" class="pm-overlay" @click.self="showModalType = false">
              <div class="pm-modal">
                <div class="pm-modal-header">
                  <h2 class="pm-modal-title">{{ editingType ? 'Modifier le type de formation' : 'Nouveau type de formation' }}</h2>
                  <button @click="showModalType = false" class="pm-modal-close">✕</button>
                </div>
                <div class="pm-modal-body">
                  <div class="pm-grid-2">
                    <div>
                      <label class="pm-label">Nom <span class="pm-req">*</span></label>
                      <input v-model="formType.nom" type="text" class="pm-input" placeholder="Ex: Licence" />
                    </div>
                    <div>
                      <label class="pm-label">Code <span class="pm-req">*</span></label>
                      <input v-model="formType.code" type="text" class="pm-input" placeholder="Ex: LIC" />
                    </div>
                  </div>
                  <div class="pm-toggle-row">
                    <button @click="formType.actif = !formType.actif" class="pm-toggle" :class="formType.actif ? 'pm-toggle--on' : ''">
                      <span class="pm-toggle-knob" :class="formType.actif ? 'pm-toggle-knob--on' : ''" />
                    </button>
                    <span class="pm-toggle-label">{{ formType.actif ? 'Actif' : 'Inactif' }}</span>
                  </div>
                  <div class="pm-toggle-row" style="margin-top:8px;">
                    <button @click="formType.has_niveau = !formType.has_niveau" class="pm-toggle" :class="formType.has_niveau ? 'pm-toggle--on' : ''">
                      <span class="pm-toggle-knob" :class="formType.has_niveau ? 'pm-toggle-knob--on' : ''" />
                    </button>
                    <span class="pm-toggle-label">{{ formType.has_niveau ? 'A des années d\'étude (1ère, 2ème…)' : 'Pas d\'année d\'étude' }}</span>
                  </div>
                </div>
                <div class="pm-modal-footer">
                  <button @click="showModalType = false" class="pm-btn-cancel">Annuler</button>
                  <button @click="saveType" :disabled="!formType.nom.trim() || !formType.code.trim() || savingType" class="uc-btn-primary" :style="(!formType.nom.trim() || !formType.code.trim() || savingType) ? 'opacity:0.4' : ''">
                    {{ savingType ? 'Enregistrement…' : editingType ? 'Modifier' : 'Créer' }}
                  </button>
                </div>
              </div>
            </div>
          </Teleport>
        </template>

        <!-- ─── Tarifs intervenants ───────────────────────────────── -->
        <template v-else-if="activePedaTab === 'tarifs'">
          <div class="pm-tab-bar">
            <p class="pm-tab-desc">Taux horaires par type de formation et année académique.</p>
            <button v-if="isDG" @click="openNewTarif" class="uc-btn-primary">+ Définir un tarif</button>
          </div>

          <div class="pm-info-banner">
            <strong>Règle tronc commun :</strong> Lorsqu'une séance regroupe plusieurs types de formation, le taux le plus élevé est appliqué à l'intervenant.
          </div>

          <div v-if="loadingTarifs" class="pm-empty">Chargement…</div>
          <div v-else-if="tarifs.length === 0" class="pm-empty">Aucun tarif défini.</div>
          <div v-else class="pm-table-wrap">
            <table class="pm-table">
              <thead>
                <tr>
                  <th>Type de formation</th>
                  <th>Année académique</th>
                  <th>Taux horaire</th>
                  <th>Date d'effet</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in tarifs" :key="t.id">
                  <td>
                    <span class="pm-td-bold">{{ t.type_formation?.nom ?? '—' }}</span>
                    <span class="pm-td-sub">{{ t.type_formation?.code }}</span>
                  </td>
                  <td class="pm-td-muted">{{ t.annee_academique?.libelle ?? '—' }}</td>
                  <td class="pm-td-bold">{{ formatTarifAmount(t.montant_horaire) }}</td>
                  <td class="pm-td-muted">{{ formatTarifDate(t.date_effet) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Modal Tarif -->
          <Teleport to="body">
            <div v-if="showModalTarif" class="pm-overlay" @click.self="showModalTarif = false">
              <div class="pm-modal">
                <div class="pm-modal-header">
                  <h2 class="pm-modal-title">Définir un tarif</h2>
                  <button @click="showModalTarif = false" class="pm-modal-close">✕</button>
                </div>
                <div class="pm-modal-body">
                  <div v-if="errorTarif" class="pm-error-banner">{{ errorTarif }}</div>
                  <div class="pm-field">
                    <label class="pm-label">Type de formation <span class="pm-req">*</span></label>
                    <select v-model="formTarif.type_formation_id" class="pm-input">
                      <option v-for="tf in typesFormation" :key="tf.id" :value="tf.id">{{ tf.nom }}</option>
                    </select>
                  </div>
                  <div class="pm-field">
                    <label class="pm-label">Année académique <span class="pm-req">*</span></label>
                    <select v-model="formTarif.annee_academique_id" class="pm-input">
                      <option v-for="a in anneesAcademiques" :key="a.id" :value="a.id">{{ a.libelle }}</option>
                    </select>
                  </div>
                  <div class="pm-field">
                    <label class="pm-label">Taux horaire (FCFA/h) <span class="pm-req">*</span></label>
                    <input v-model.number="formTarif.montant_horaire" type="number" min="0" class="pm-input" />
                  </div>
                  <div class="pm-field">
                    <label class="pm-label">Date d'effet <span class="pm-req">*</span></label>
                    <input v-model="formTarif.date_effet" type="date" class="pm-input" />
                  </div>
                </div>
                <div class="pm-modal-footer">
                  <button @click="showModalTarif = false" class="pm-btn-cancel">Annuler</button>
                  <button @click="saveTarif" :disabled="savingTarif" class="uc-btn-primary" :style="savingTarif ? 'opacity:0.4' : ''">
                    {{ savingTarif ? 'Enregistrement…' : 'Enregistrer' }}
                  </button>
                </div>
              </div>
            </div>
          </Teleport>
        </template>

        <!-- ─── Matières ──────────────────────────────────────────── -->
        <template v-else-if="activePedaTab === 'matieres'">
          <div class="pm-tab-bar">
            <p class="pm-tab-desc">Référentiel global des matières enseignées, partagées entre les filières.</p>
            <button v-if="isDG" @click="openNewMatiere" class="uc-btn-primary">+ Nouvelle matière</button>
          </div>

          <div v-if="loadingMatieres" class="pm-empty">Chargement…</div>
          <div v-else-if="matieres.length === 0" class="pm-empty">Aucune matière configurée. Commencez par en créer une.</div>
          <div v-else class="pm-table-wrap">
            <table class="pm-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Code</th>
                  <th>Description</th>
                  <th style="text-align:center">Statut</th>
                  <th v-if="isDG" style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in matieres" :key="m.id">
                  <td class="pm-td-bold">{{ m.nom }}</td>
                  <td><span class="pm-badge-code pm-badge-violet">{{ m.code }}</span></td>
                  <td class="pm-td-muted pm-td-truncate">{{ m.description ?? '—' }}</td>
                  <td style="text-align:center">
                    <span class="pm-badge-statut" :class="m.actif ? 'pm-statut-actif' : 'pm-statut-inactif'">
                      {{ m.actif ? 'Actif' : 'Inactif' }}
                    </span>
                  </td>
                  <td v-if="isDG" style="text-align:right">
                    <div class="pm-actions">
                      <button @click="openEditMatiere(m)" class="pm-action-btn" title="Modifier">
                        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button @click="deleteMatiere(m)" :disabled="deletingMatiereId === m.id" class="pm-action-btn pm-action-btn--danger" title="Supprimer">
                        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Modal Matière -->
          <Teleport to="body">
            <div v-if="showModalMatiere" class="pm-overlay" @click.self="showModalMatiere = false">
              <div class="pm-modal">
                <div class="pm-modal-header">
                  <h2 class="pm-modal-title">{{ editingMatiere ? 'Modifier la matière' : 'Nouvelle matière' }}</h2>
                  <button @click="showModalMatiere = false" class="pm-modal-close">✕</button>
                </div>
                <div class="pm-modal-body">
                  <div class="pm-grid-2">
                    <div>
                      <label class="pm-label">Nom <span class="pm-req">*</span></label>
                      <input v-model="formMatiere.nom" type="text" class="pm-input" placeholder="Ex: Mathématiques" />
                    </div>
                    <div>
                      <label class="pm-label">Code <span class="pm-req">*</span></label>
                      <input v-model="formMatiere.code" type="text" class="pm-input" placeholder="Ex: MATH101" />
                    </div>
                  </div>
                  <div class="pm-field">
                    <label class="pm-label">Description</label>
                    <textarea v-model="formMatiere.description" rows="2" class="pm-input" style="resize:none" placeholder="Description de la matière (optionnel)" />
                  </div>
                  <div class="pm-toggle-row">
                    <button @click="formMatiere.actif = !formMatiere.actif" class="pm-toggle" :class="formMatiere.actif ? 'pm-toggle--on' : ''">
                      <span class="pm-toggle-knob" :class="formMatiere.actif ? 'pm-toggle-knob--on' : ''" />
                    </button>
                    <span class="pm-toggle-label">{{ formMatiere.actif ? 'Actif' : 'Inactif' }}</span>
                  </div>
                </div>
                <div class="pm-modal-footer">
                  <button @click="showModalMatiere = false" class="pm-btn-cancel">Annuler</button>
                  <button @click="saveMatiere" :disabled="!formMatiere.nom.trim() || !formMatiere.code.trim() || savingMatiere" class="uc-btn-primary" :style="(!formMatiere.nom.trim() || !formMatiere.code.trim() || savingMatiere) ? 'opacity:0.4' : ''">
                    {{ savingMatiere ? 'Enregistrement…' : editingMatiere ? 'Modifier' : 'Créer' }}
                  </button>
                </div>
              </div>
            </div>
          </Teleport>
        </template>

        <!-- ─── Niveaux d'entrée ───────────────────────────────────── -->
        <template v-else-if="activePedaTab === 'niveaux-entree'">
          <div class="pm-tab-bar">
            <p class="pm-tab-desc">Niveaux académiques des étudiants à l'entrée (CFEE, BFEM, BAC, BAC+2…).</p>
            <button v-if="isDG" @click="openNewNiveauEntree" class="uc-btn-primary">+ Nouveau niveau</button>
          </div>

          <div v-if="loadingNiveauxEntree" class="pm-empty">Chargement…</div>
          <div v-else-if="niveauxEntree.length === 0" class="pm-empty">Aucun niveau d'entrée configuré. Commencez par en créer un.</div>
          <div v-else class="pm-table-wrap">
            <table class="pm-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Code</th>
                  <th>Système d'évaluation</th>
                  <th style="text-align:center">Ordre</th>
                  <th style="text-align:center">Statut</th>
                  <th v-if="isDG" style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="n in niveauxEntree" :key="n.id">
                  <td class="pm-td-bold">{{ n.nom }}</td>
                  <td><span class="pm-badge-code">{{ n.code }}</span></td>
                  <td>
                    <span class="pm-badge-systeme" :class="n.est_superieur_bac ? 'pm-badge-systeme--bac' : 'pm-badge-systeme--pre'">
                      {{ n.est_superieur_bac ? '≥ BAC — Crédits ECTS' : '< BAC — Coefficients' }}
                    </span>
                  </td>
                  <td style="text-align:center" class="pm-td-muted">{{ n.ordre }}</td>
                  <td style="text-align:center">
                    <span class="pm-badge-statut" :class="n.actif ? 'pm-statut-actif' : 'pm-statut-inactif'">
                      {{ n.actif ? 'Actif' : 'Inactif' }}
                    </span>
                  </td>
                  <td v-if="isDG" style="text-align:right">
                    <div class="pm-actions">
                      <button @click="openEditNiveauEntree(n)" class="pm-action-btn" title="Modifier">
                        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button @click="deleteNiveauEntree(n)" :disabled="deletingNiveauEntreeId === n.id" class="pm-action-btn pm-action-btn--danger" title="Supprimer">
                        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Modal Niveau d'entrée -->
          <Teleport to="body">
            <div v-if="showModalNiveauEntree" class="pm-overlay" @click.self="showModalNiveauEntree = false">
              <div class="pm-modal">
                <div class="pm-modal-header">
                  <h2 class="pm-modal-title">{{ editingNiveauEntree ? "Modifier le niveau d'entrée" : "Nouveau niveau d'entrée" }}</h2>
                  <button @click="showModalNiveauEntree = false" class="pm-modal-close">✕</button>
                </div>
                <div class="pm-modal-body">
                  <div class="pm-grid-2">
                    <div>
                      <label class="pm-label">Nom <span class="pm-req">*</span></label>
                      <input v-model="formNiveauEntree.nom" type="text" class="pm-input" placeholder="Ex: BAC" />
                    </div>
                    <div>
                      <label class="pm-label">Code <span class="pm-req">*</span></label>
                      <input v-model="formNiveauEntree.code" type="text" class="pm-input" placeholder="Ex: BAC" />
                    </div>
                  </div>
                  <div class="pm-field">
                    <label class="pm-label">Ordre d'affichage</label>
                    <input v-model.number="formNiveauEntree.ordre" type="number" min="0" class="pm-input" placeholder="0" />
                  </div>
                  <div class="pm-eval-box">
                    <p class="pm-eval-title">Système d'évaluation</p>
                    <div class="pm-eval-row">
                      <button
                        @click="formNiveauEntree.est_superieur_bac = !formNiveauEntree.est_superieur_bac"
                        class="pm-toggle"
                        :class="formNiveauEntree.est_superieur_bac ? 'pm-toggle--bac-on' : 'pm-toggle--bac-off'"
                      >
                        <span class="pm-toggle-knob" :class="formNiveauEntree.est_superieur_bac ? 'pm-toggle-knob--on' : ''" />
                      </button>
                      <div>
                        <p class="pm-eval-mode" :class="formNiveauEntree.est_superieur_bac ? 'pm-eval-mode--bac' : 'pm-eval-mode--pre'">
                          {{ formNiveauEntree.est_superieur_bac ? '≥ BAC — Crédits ECTS (LMD)' : '< BAC — Coefficients (Bulletins)' }}
                        </p>
                        <p class="pm-eval-hint">
                          {{ formNiveauEntree.est_superieur_bac
                            ? 'Relevé de notes • Attestation de réussite • Diplôme délivré par le ministère'
                            : "Bulletin • Attestation de réussite • Diplôme généré par l'application" }}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div class="pm-toggle-row">
                    <button @click="formNiveauEntree.actif = !formNiveauEntree.actif" class="pm-toggle" :class="formNiveauEntree.actif ? 'pm-toggle--on' : ''">
                      <span class="pm-toggle-knob" :class="formNiveauEntree.actif ? 'pm-toggle-knob--on' : ''" />
                    </button>
                    <span class="pm-toggle-label">{{ formNiveauEntree.actif ? 'Actif' : 'Inactif' }}</span>
                  </div>
                </div>
                <div class="pm-modal-footer">
                  <button @click="showModalNiveauEntree = false" class="pm-btn-cancel">Annuler</button>
                  <button @click="saveNiveauEntree" :disabled="!formNiveauEntree.nom.trim() || !formNiveauEntree.code.trim() || savingNiveauEntree" class="uc-btn-primary" :style="(!formNiveauEntree.nom.trim() || !formNiveauEntree.code.trim() || savingNiveauEntree) ? 'opacity:0.4' : ''">
                    {{ savingNiveauEntree ? 'Enregistrement…' : editingNiveauEntree ? 'Modifier' : 'Créer' }}
                  </button>
                </div>
              </div>
            </div>
          </Teleport>
        </template>

        <!-- ─── Niveaux de bourse ─────────────────────────────────── -->
        <template v-else-if="activePedaTab === 'niveaux-bourse'">
          <div class="pm-tab-bar">
            <p class="pm-tab-desc">Définissez les niveaux de réduction accordés aux boursiers.</p>
            <button v-if="isDG" @click="openNewNiveauBourse" class="uc-btn-primary">+ Nouveau niveau</button>
          </div>

          <div v-if="loadingNiveauxBourse" class="pm-empty">Chargement…</div>
          <div v-else-if="niveauxBourse.length === 0" class="pm-empty">Aucun niveau de bourse configuré. Commencez par en créer un.</div>
          <div v-else class="pm-table-wrap">
            <table class="pm-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th style="text-align:center">Réduction mensualité</th>
                  <th style="text-align:center">S'applique aux frais d'inscription</th>
                  <th style="text-align:center">Statut</th>
                  <th v-if="isDG" style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="b in niveauxBourse" :key="b.id">
                  <td class="pm-td-bold">{{ b.nom }}</td>
                  <td style="text-align:center"><span class="pm-badge-pct">{{ b.pourcentage }}%</span></td>
                  <td style="text-align:center">
                    <span class="pm-badge-statut" :class="b.applique_inscription ? 'pm-statut-actif' : 'pm-statut-inactif'">
                      {{ b.applique_inscription ? 'Oui' : 'Non' }}
                    </span>
                  </td>
                  <td style="text-align:center">
                    <span class="pm-badge-statut" :class="b.actif ? 'pm-statut-actif' : 'pm-statut-inactif'">
                      {{ b.actif ? 'Actif' : 'Inactif' }}
                    </span>
                  </td>
                  <td v-if="isDG" style="text-align:right">
                    <div class="pm-actions">
                      <button @click="openEditNiveauBourse(b)" class="pm-action-btn" title="Modifier">
                        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                      </button>
                      <button @click="deleteNiveauBourse(b)" :disabled="deletingNiveauBourseId === b.id" class="pm-action-btn pm-action-btn--danger" title="Supprimer">
                        <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Modal Niveau de bourse -->
          <Teleport to="body">
            <div v-if="showModalNiveauBourse" class="pm-overlay" @click.self="showModalNiveauBourse = false">
              <div class="pm-modal">
                <div class="pm-modal-header">
                  <h2 class="pm-modal-title">{{ editingNiveauBourse ? 'Modifier le niveau de bourse' : 'Nouveau niveau de bourse' }}</h2>
                  <button @click="showModalNiveauBourse = false" class="pm-modal-close">✕</button>
                </div>
                <div class="pm-modal-body">
                  <div class="pm-field">
                    <label class="pm-label">Nom <span class="pm-req">*</span></label>
                    <input v-model="formNiveauBourse.nom" type="text" class="pm-input" placeholder="Ex: Bourse 50%, Bourse totale…" />
                  </div>
                  <div class="pm-field">
                    <label class="pm-label">Pourcentage de réduction <span class="pm-req">*</span></label>
                    <div style="position:relative">
                      <input v-model.number="formNiveauBourse.pourcentage" type="number" min="0" max="100" step="0.01" class="pm-input" style="padding-right:28px" placeholder="Ex: 50" />
                      <span style="position:absolute;right:10px;top:8px;color:#999;font-size:13px;font-weight:600">%</span>
                    </div>
                    <p class="pm-hint">Réduction appliquée sur la mensualité de l'étudiant.</p>
                  </div>
                  <div class="pm-check-row">
                    <button
                      @click="formNiveauBourse.applique_inscription = !formNiveauBourse.applique_inscription"
                      class="pm-toggle pm-toggle--sm"
                      :class="formNiveauBourse.applique_inscription ? 'pm-toggle--on' : ''"
                    >
                      <span class="pm-toggle-knob pm-toggle-knob--sm" :class="formNiveauBourse.applique_inscription ? 'pm-toggle-knob--sm-on' : ''" />
                    </button>
                    <div>
                      <p class="pm-check-label">Appliquer aux frais d'inscription</p>
                      <p class="pm-hint">La même réduction s'applique aussi aux frais d'inscription.</p>
                    </div>
                  </div>
                  <div class="pm-toggle-row">
                    <button @click="formNiveauBourse.actif = !formNiveauBourse.actif" class="pm-toggle" :class="formNiveauBourse.actif ? 'pm-toggle--on' : ''">
                      <span class="pm-toggle-knob" :class="formNiveauBourse.actif ? 'pm-toggle-knob--on' : ''" />
                    </button>
                    <span class="pm-toggle-label">{{ formNiveauBourse.actif ? 'Actif' : 'Inactif' }}</span>
                  </div>
                </div>
                <div class="pm-modal-footer">
                  <button @click="showModalNiveauBourse = false" class="pm-btn-cancel">Annuler</button>
                  <button @click="saveNiveauBourse" :disabled="!formNiveauBourse.nom.trim() || savingNiveauBourse" class="uc-btn-primary" :style="(!formNiveauBourse.nom.trim() || savingNiveauBourse) ? 'opacity:0.4' : ''">
                    {{ savingNiveauBourse ? 'Enregistrement…' : editingNiveauBourse ? 'Modifier' : 'Créer' }}
                  </button>
                </div>
              </div>
            </div>
          </Teleport>
        </template>

      </template>

      <!-- ═══ FINANCE ══════════════════════════════════════════════════ -->
      <template v-else-if="activeGroup === 'finance'">
        <div class="pm-section-header">
          <h1 class="pm-section-title">Finance & Paiements</h1>
          <p class="pm-section-desc">Moyens de paiement, seuils et paramètres financiers</p>
        </div>

        <div v-if="loading" class="pm-empty">Chargement…</div>
        <template v-else>
          <!-- Tenue vestimentaire -->
          <template v-if="tenueObligatoire || montantTenue">
            <div class="pm-param-card pm-param-card--group" style="margin-bottom:12px">
              <div class="pm-param-card-header">
                <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
                <span>Tenue vestimentaire</span>
              </div>
              <div class="pm-param-card-body">
                <div v-if="tenueObligatoire" class="pm-param-row">
                  <div>
                    <p class="pm-param-label">Tenue vestimentaire obligatoire</p>
                    <p class="pm-hint">Activer pour inclure les frais de tenue lors de l'inscription.</p>
                  </div>
                  <button @click="toggleValue('tenue_obligatoire')" :disabled="!isDG" class="pm-toggle" :class="editValues['tenue_obligatoire'] === '1' ? 'pm-toggle--on' : ''">
                    <span class="pm-toggle-knob" :class="editValues['tenue_obligatoire'] === '1' ? 'pm-toggle-knob--on' : ''" />
                  </button>
                </div>
                <div v-if="montantTenue" class="pm-param-row pm-param-row--field">
                  <div style="flex:1;min-width:0">
                    <label for="param-montant_tenue" class="pm-param-label">Montant de la tenue (FCFA)</label>
                    <p class="pm-hint">Montant fixe pré-rempli à la création d'une inscription.</p>
                    <input id="param-montant_tenue" v-model="editValues['montant_tenue']" type="number" :disabled="!isDG" class="pm-input pm-input--sm" />
                  </div>
                  <button v-if="isDG" @click="save('montant_tenue')" :disabled="saving === 'montant_tenue' || editValues['montant_tenue'] === montantTenue.valeur" class="pm-btn-save" :class="saved === 'montant_tenue' ? 'pm-btn-save--ok' : ''">
                    <svg v-if="saved === 'montant_tenue'" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                    {{ saving === 'montant_tenue' ? '…' : saved === 'montant_tenue' ? 'Sauvegardé' : 'Sauvegarder' }}
                  </button>
                </div>
              </div>
            </div>
          </template>

          <div v-if="financeParamsHorsTenue.length === 0 && !tenueObligatoire && !montantTenue" class="pm-empty">Aucun paramètre dans cette catégorie.</div>
          <div v-else-if="financeParamsHorsTenue.length > 0" class="pm-params-list">
            <div v-for="p in financeParamsHorsTenue" :key="p.cle" class="pm-param-card">
              <div v-if="fieldConfig[p.cle]?.toggle" class="pm-param-row">
                <div>
                  <p class="pm-param-label">{{ fieldConfig[p.cle]?.label ?? p.cle }}</p>
                  <p v-if="p.description" class="pm-hint">{{ p.description }}</p>
                </div>
                <button @click="toggleValue(p.cle)" :disabled="!isDG" class="pm-toggle" :class="editValues[p.cle] === '1' ? 'pm-toggle--on' : ''">
                  <span class="pm-toggle-knob" :class="editValues[p.cle] === '1' ? 'pm-toggle-knob--on' : ''" />
                </button>
              </div>
              <div v-else class="pm-param-row pm-param-row--field">
                <div style="flex:1;min-width:0">
                  <label :for="`param-${p.cle}`" class="pm-param-label">{{ fieldConfig[p.cle]?.label ?? p.cle }}</label>
                  <p v-if="p.description" class="pm-hint">{{ p.description }}</p>
                  <input :id="`param-${p.cle}`" v-model="editValues[p.cle]" :type="fieldConfig[p.cle]?.type ?? 'text'" :disabled="!isDG" class="pm-input pm-input--sm" />
                </div>
                <div style="flex-shrink:0">
                  <button v-if="isDG" @click="save(p.cle)" :disabled="saving === p.cle || editValues[p.cle] === p.valeur" class="pm-btn-save" :class="saved === p.cle ? 'pm-btn-save--ok' : ''">
                    <svg v-if="saved === p.cle" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                    {{ saving === p.cle ? '…' : saved === p.cle ? 'Sauvegardé' : 'Sauvegarder' }}
                  </button>
                  <span v-else class="pm-readonly">Lecture seule</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>

      <!-- ═══ ZONE DE DANGER ══════════════════════════════════════════ -->
      <template v-else-if="activeGroup === 'danger'">
        <div class="pm-section-header">
          <h1 class="pm-section-title">Zone de danger</h1>
          <p class="pm-section-desc">Actions irréversibles — réservées au Directeur Général</p>
        </div>

        <div v-if="!isDG" class="pm-empty">Accès réservé au Directeur Général.</div>
        <div v-else class="pm-params-list">
          <div class="pm-danger-card">
            <h3 class="pm-danger-title">Clôturer l'année en cours</h3>
            <p class="pm-hint">Archive toutes les données de l'année académique active et prépare la suivante.</p>
            <button disabled class="pm-btn-danger" style="opacity:0.5;cursor:not-allowed">Clôturer l'année (bientôt disponible)</button>
          </div>
          <div class="pm-danger-card">
            <h3 class="pm-danger-title">Réinitialiser tous les mots de passe</h3>
            <p class="pm-hint">Remet le mot de passe de tous les comptes à <code class="pm-code">Uptech@2026</code> et active le changement obligatoire à la prochaine connexion.</p>
            <button disabled class="pm-btn-danger" style="opacity:0.5;cursor:not-allowed">Réinitialiser (bientôt disponible)</button>
          </div>
        </div>
      </template>

      <!-- ═══ AUTRES GROUPES (paramètres génériques) ═════════════════ -->
      <template v-else>
        <div class="pm-section-header">
          <h1 class="pm-section-title">{{ groups.find(g => g.key === activeGroup)?.label }}</h1>
          <p class="pm-section-desc">Configuration de la plateforme</p>
        </div>

        <div v-if="loading" class="pm-empty">Chargement…</div>
        <div v-else-if="filteredParams.length === 0" class="pm-empty">Aucun paramètre dans cette catégorie.</div>
        <div v-else class="pm-params-list">
          <div v-for="p in filteredParams" :key="p.cle" class="pm-param-card">
            <div v-if="fieldConfig[p.cle]?.toggle" class="pm-param-row">
              <div>
                <p class="pm-param-label">{{ fieldConfig[p.cle]?.label ?? p.cle }}</p>
                <p v-if="p.description" class="pm-hint">{{ p.description }}</p>
              </div>
              <button @click="toggleValue(p.cle)" :disabled="!isDG" class="pm-toggle" :class="editValues[p.cle] === '1' ? 'pm-toggle--on' : ''">
                <span class="pm-toggle-knob" :class="editValues[p.cle] === '1' ? 'pm-toggle-knob--on' : ''" />
              </button>
            </div>
            <div v-else class="pm-param-row pm-param-row--field">
              <div style="flex:1;min-width:0">
                <label :for="`param-${p.cle}`" class="pm-param-label">{{ fieldConfig[p.cle]?.label ?? p.cle }}</label>
                <p v-if="p.description" class="pm-hint">{{ p.description }}</p>
                <textarea v-if="fieldConfig[p.cle]?.textarea" :id="`param-${p.cle}`" v-model="editValues[p.cle]" :disabled="!isDG" rows="4" class="pm-input" style="resize:none" />
                <input v-else :id="`param-${p.cle}`" v-model="editValues[p.cle]" :type="fieldConfig[p.cle]?.type ?? 'text'" :disabled="!isDG" class="pm-input" />
              </div>
              <div style="flex-shrink:0;margin-top:20px">
                <button v-if="isDG" @click="save(p.cle)" :disabled="saving === p.cle || editValues[p.cle] === p.valeur" class="pm-btn-save" :class="saved === p.cle ? 'pm-btn-save--ok' : ''">
                  <svg v-if="saved === p.cle" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                  {{ saving === p.cle ? '…' : saved === p.cle ? 'Sauvegardé' : 'Sauvegarder' }}
                </button>
                <span v-else class="pm-readonly">Lecture seule</span>
              </div>
            </div>
          </div>
        </div>
      </template>

    </main>
  </div>
</template>

<style scoped>
/* Layout */
.pm-layout { display:flex; min-height:100%; padding:0; }
.pm-sidebar { width:220px; flex-shrink:0; background:#fff; border-right:1px solid #eee; padding:20px 10px; }
.pm-sidebar-title { font-size:10px; font-weight:700; color:#aaa; text-transform:uppercase; letter-spacing:0.06em; padding:0 8px; margin-bottom:10px; }
.pm-nav-btn { display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border-radius:7px; font-size:13.5px; font-weight:500; color:#555; background:none; border:none; cursor:pointer; text-align:left; transition:background 0.15s; margin-bottom:2px; }
.pm-nav-btn:hover { background:#f5f5f5; color:#111; }
.pm-nav-btn--active { background:#fde8e8; color:#E30613; }
.pm-nav-icon { width:16px; height:16px; flex-shrink:0; }

/* Main */
.pm-main { flex:1; overflow:auto; padding:24px; }
.pm-section-header { margin-bottom:20px; }
.pm-section-title { font-size:17px; font-weight:700; color:#111; margin:0; }
.pm-section-desc { font-size:12.5px; color:#888; margin-top:3px; }

/* Sub-tabs */
.pm-subtabs { display:flex; gap:4px; background:#f0f0f0; padding:4px; border-radius:10px; width:fit-content; margin-bottom:20px; flex-wrap:wrap; }
.pm-subtab { padding:7px 14px; font-size:13px; font-weight:500; border-radius:7px; border:none; cursor:pointer; background:none; color:#777; transition:all 0.15s; }
.pm-subtab:hover { color:#333; }
.pm-subtab--active { background:#fff; color:#111; box-shadow:0 1px 4px rgba(0,0,0,0.1); }

/* Tab bar */
.pm-tab-bar { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.pm-tab-desc { font-size:12.5px; color:#888; }

/* Banners */
.pm-info-banner { background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px 16px; font-size:13px; color:#1d4ed8; margin-bottom:16px; }
.pm-error-banner { background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:10px 14px; font-size:13px; color:#dc2626; margin-bottom:12px; }

/* Table */
.pm-table-wrap { background:#fff; border-radius:8px; border:1px solid #eee; overflow:hidden; }
.pm-table { width:100%; border-collapse:collapse; font-size:13.5px; }
.pm-table thead { background:#fafafa; }
.pm-table th { padding:10px 14px; text-align:left; font-size:10.5px; font-weight:700; color:#aaa; text-transform:uppercase; letter-spacing:0.04em; border-bottom:1px solid #eee; }
.pm-table td { padding:11px 14px; border-bottom:1px solid #f5f5f5; }
.pm-table tbody tr:last-child td { border-bottom:none; }
.pm-table tbody tr:hover { background:#fafafa; }
.pm-td-bold { font-weight:600; color:#111; }
.pm-td-muted { color:#777; }
.pm-td-sub { font-size:11px; color:#aaa; margin-left:6px; font-family:monospace; }
.pm-td-truncate { max-width:220px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

/* Badges */
.pm-badge-code { display:inline-flex; align-items:center; padding:1px 6px; border-radius:4px; font-size:11px; font-family:monospace; font-weight:600; background:#f3f4f6; color:#555; }
.pm-badge-violet { background:#f5f3ff; color:#7c3aed; }
.pm-badge-statut { display:inline-flex; align-items:center; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:600; }
.pm-statut-actif { background:#f0fdf4; color:#15803d; }
.pm-statut-inactif { background:#f5f5f5; color:#888; }
.pm-count-badge { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border-radius:50%; background:#eff6ff; color:#1d4ed8; font-size:12px; font-weight:700; }
.pm-badge-pct { display:inline-flex; align-items:center; padding:4px 10px; border-radius:20px; font-size:13px; font-weight:700; background:#ecfdf5; color:#059669; }
.pm-badge-systeme { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:20px; font-size:11.5px; font-weight:500; }
.pm-badge-systeme--bac { background:#eff6ff; color:#1d4ed8; }
.pm-badge-systeme--pre { background:#fffbeb; color:#b45309; }

/* Actions */
.pm-actions { display:flex; align-items:center; justify-content:flex-end; gap:4px; }
.pm-action-btn { width:30px; height:30px; display:flex; align-items:center; justify-content:center; border-radius:6px; border:none; cursor:pointer; background:none; color:#aaa; transition:background 0.15s,color 0.15s; }
.pm-action-btn:hover { background:#f5f5f5; color:#555; }
.pm-action-btn--danger:hover { background:#fef2f2; color:#E30613; }
.pm-action-btn:disabled { opacity:0.4; cursor:not-allowed; }

/* Modal */
.pm-overlay { position:fixed; inset:0; z-index:50; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.4); padding:16px; }
.pm-modal { background:#fff; border-radius:12px; width:100%; max-width:440px; box-shadow:0 20px 60px rgba(0,0,0,0.2); display:flex; flex-direction:column; max-height:90vh; }
.pm-modal-header { display:flex; align-items:center; justify-content:space-between; padding:18px 22px 14px; border-bottom:1px solid #f0f0f0; }
.pm-modal-title { font-size:15px; font-weight:700; color:#111; }
.pm-modal-close { width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:none; background:none; cursor:pointer; color:#aaa; font-size:14px; border-radius:6px; }
.pm-modal-close:hover { background:#f5f5f5; color:#555; }
.pm-modal-body { padding:18px 22px; display:flex; flex-direction:column; gap:14px; overflow-y:auto; }
.pm-modal-footer { padding:14px 22px 18px; display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #f0f0f0; }
.pm-btn-cancel { padding:8px 16px; font-size:13px; color:#555; border:1px solid #ddd; background:#fff; border-radius:7px; cursor:pointer; font-weight:500; }
.pm-btn-cancel:hover { background:#f9f9f9; }

/* Form */
.pm-label { display:block; font-size:11.5px; font-weight:600; color:#555; margin-bottom:5px; }
.pm-req { color:#E30613; }
.pm-input { width:100%; padding:8px 12px; border:1px solid #e0e0e0; border-radius:7px; font-size:13px; color:#111; background:#fff; outline:none; box-sizing:border-box; }
.pm-input:focus { border-color:#E30613; box-shadow:0 0 0 2px rgba(227,6,19,0.08); }
.pm-input:disabled { background:#f9f9f9; color:#aaa; }
.pm-input--sm { max-width:260px; }
.pm-hint { font-size:11.5px; color:#aaa; margin-top:3px; }
.pm-field { display:flex; flex-direction:column; }
.pm-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }

/* Toggle */
.pm-toggle { position:relative; display:inline-flex; width:44px; height:24px; border-radius:12px; border:none; cursor:pointer; background:#ddd; flex-shrink:0; transition:background 0.2s; padding:0; }
.pm-toggle--on { background:#E30613; }
.pm-toggle--bac-on { background:#1d4ed8; }
.pm-toggle--bac-off { background:#f59e0b; }
.pm-toggle--sm { width:36px; height:20px; border-radius:10px; }
.pm-toggle:disabled { opacity:0.5; cursor:not-allowed; }
.pm-toggle-knob { position:absolute; top:2px; left:2px; width:20px; height:20px; background:#fff; border-radius:50%; box-shadow:0 1px 4px rgba(0,0,0,0.2); transition:transform 0.2s; }
.pm-toggle-knob--on { transform:translateX(20px); }
.pm-toggle-knob--sm { width:16px; height:16px; }
.pm-toggle-knob--sm-on { transform:translateX(16px); }
.pm-toggle-row { display:flex; align-items:center; gap:10px; }
.pm-toggle-label { font-size:13px; color:#555; }

/* Eval box */
.pm-eval-box { border:1px solid #eee; border-radius:8px; padding:14px; }
.pm-eval-title { font-size:10.5px; font-weight:700; color:#888; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:10px; }
.pm-eval-row { display:flex; align-items:flex-start; gap:10px; }
.pm-eval-mode { font-size:13px; font-weight:600; margin-bottom:3px; }
.pm-eval-mode--bac { color:#1d4ed8; }
.pm-eval-mode--pre { color:#b45309; }
.pm-eval-hint { font-size:11.5px; color:#aaa; }

/* Check row */
.pm-check-row { display:flex; align-items:flex-start; gap:10px; padding:10px 12px; background:#f9f9f9; border-radius:8px; }
.pm-check-label { font-size:13px; font-weight:600; color:#333; margin-bottom:2px; }

/* Param cards */
.pm-params-list { display:flex; flex-direction:column; gap:10px; }
.pm-param-card { background:#fff; border:1px solid #eee; border-radius:8px; padding:14px 16px; }
.pm-param-card--group { padding:0; overflow:hidden; }
.pm-param-card-header { display:flex; align-items:center; gap:6px; padding:10px 14px; background:#fafafa; border-bottom:1px solid #f0f0f0; font-size:13px; font-weight:600; color:#555; }
.pm-param-card-body { padding:14px 16px; display:flex; flex-direction:column; gap:14px; }
.pm-param-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
.pm-param-row--field { align-items:flex-start; }
.pm-param-label { font-size:13px; font-weight:600; color:#333; margin-bottom:2px; }
.pm-readonly { font-size:11.5px; color:#aaa; }

/* Save button */
.pm-btn-save { display:flex; align-items:center; gap:4px; padding:7px 12px; font-size:12px; font-weight:600; border-radius:6px; border:none; cursor:pointer; background:#E30613; color:#fff; transition:opacity 0.15s; flex-shrink:0; }
.pm-btn-save:hover:not(:disabled) { opacity:0.88; }
.pm-btn-save:disabled { opacity:0.4; cursor:not-allowed; }
.pm-btn-save--ok { background:#f0fdf4; color:#15803d; }

/* Danger zone */
.pm-danger-card { background:#fff; border:1px solid #fecaca; border-radius:8px; padding:16px 18px; }
.pm-danger-title { font-size:14px; font-weight:700; color:#111; margin-bottom:6px; }
.pm-btn-danger { margin-top:10px; padding:8px 16px; background:#E30613; color:#fff; border:none; border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
.pm-code { background:#f5f5f5; padding:1px 5px; border-radius:4px; font-family:monospace; font-size:12px; }

/* Empty */
.pm-empty { padding:40px; text-align:center; color:#aaa; font-size:13px; }
</style>
