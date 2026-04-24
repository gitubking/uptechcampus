<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'

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
  applique_tenue: boolean
  actif: boolean
}

interface TypeDocument {
  id: number
  code: string
  label: string
  actif: boolean
  ordre: number
  type_formation_id: number | null
  type_formation_nom: string | null
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
const activePedaTab = ref<'types' | 'tarifs' | 'matieres' | 'niveaux-entree' | 'niveaux-bourse' | 'types-docs' | 'conges'>('types')

// ── Types de formation ──────────────────────────────────────────────
const typesFormation = ref<TypeFormation[]>([])
const loadingTypes = ref(false)
const showModalType = ref(false)
const editingType = ref<TypeFormation | null>(null)
const savingType = ref(false)
const deletingTypeId = ref<number | null>(null)
const formType = ref({ nom: '', code: '', actif: true, has_niveau: false, est_individuel: false })

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
  formType.value = { nom: '', code: '', actif: true, has_niveau: false, est_individuel: false }
  showModalType.value = true
}

function openEditType(t: TypeFormation) {
  editingType.value = t
  formType.value = { nom: t.nom, code: t.code, actif: t.actif, has_niveau: t.has_niveau ?? false, est_individuel: (t as any).est_individuel ?? false }
  showModalType.value = true
}

async function saveType() {
  if (!formType.value.nom.trim() || !formType.value.code.trim()) return
  savingType.value = true
  try {
    const payload = { nom: formType.value.nom, code: formType.value.code, actif: formType.value.actif, has_niveau: formType.value.has_niveau, est_individuel: formType.value.est_individuel }
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

// ── Tarifs enseignants ───────────────────────────────────────────────
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
const nettoyageDoublonsMatieres = ref(false)
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

async function nettoyerDoublonsMatieres() {
  // Compter les doublons côté client
  const counts: Record<string, number> = {}
  for (const m of matieres.value) {
    const key = (m.nom || '').trim().toLowerCase()
    counts[key] = (counts[key] || 0) + 1
  }
  const nbDoublons = Object.values(counts).filter(n => n > 1).reduce((a, n) => a + (n - 1), 0)
  if (nbDoublons === 0) { alert('Aucun doublon détecté.'); return }
  if (!confirm(`${nbDoublons} doublon(s) de matière(s) détecté(s). Supprimer automatiquement ? (Les affiliations filières seront conservées sur la matière originale.)`)) return
  nettoyageDoublonsMatieres.value = true
  try {
    const { data } = await api.post('/matieres/nettoyer-doublons')
    alert(typeof data?.message === 'string' ? data.message : JSON.stringify(data))
    await loadMatieres()
  } catch (e: any) {
    const msg = e.response?.data?.error || e.response?.data?.message || e.message || 'Erreur lors du nettoyage'
    alert(typeof msg === 'string' ? msg : JSON.stringify(msg))
  } finally {
    nettoyageDoublonsMatieres.value = false
  }
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
const formNiveauBourse = ref({ nom: '', pourcentage: 0, applique_inscription: false, applique_tenue: false, actif: true })

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
  formNiveauBourse.value = { nom: '', pourcentage: 0, applique_inscription: false, applique_tenue: false, actif: true }
  showModalNiveauBourse.value = true
}

function openEditNiveauBourse(b: NiveauBourse) {
  editingNiveauBourse.value = b
  formNiveauBourse.value = {
    nom: b.nom, pourcentage: b.pourcentage,
    applique_inscription: b.applique_inscription, applique_tenue: b.applique_tenue ?? false, actif: b.actif,
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
  { key: 'comptabilite',  label: 'Comptabilité',         icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key: 'relances',      label: 'Relances',             icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  { key: 'notifications', label: 'Notifications',        icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { key: 'danger',        label: 'Zone de danger',       icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
]

// ── Labels et types de champs ────────────────────────────────────────
const fieldConfig: Record<string, { label: string; type?: string; textarea?: boolean; toggle?: boolean }> = {
  nom_etablissement:          { label: "Nom de l'établissement" },
  agrement:                   { label: "Numéro d'agrément" },
  directeur_general:          { label: 'Nom du Directeur Général' },
  ministere_tutelle:          { label: 'Intitulé du ministère de tutelle' },
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
  envoi_releve_cabinet_actif: { label: 'Activer l\'envoi automatique au cabinet', toggle: true },
  email_cabinet_comptable:    { label: 'Email du cabinet comptable', type: 'email' },
  email_cabinet_cc:           { label: 'Email(s) en copie (séparés par des virgules)', type: 'text' },
  nom_cabinet_comptable:      { label: 'Nom du cabinet (affiché dans l\'e-mail)' },
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

// Paramètres comptabilité (ordre explicite)
const comptaOrder = ['envoi_releve_cabinet_actif', 'nom_cabinet_comptable', 'email_cabinet_comptable', 'email_cabinet_cc']
const comptaParams = computed(() => {
  const list = parametres.value.filter(p => p.groupe === 'comptabilite')
  return list.slice().sort((a, b) => {
    const ia = comptaOrder.indexOf(a.cle); const ib = comptaOrder.indexOf(b.cle)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
})
const comptaActif = computed(() => editValues.value['envoi_releve_cabinet_actif'] === '1')
const comptaEmail = computed(() => (editValues.value['email_cabinet_comptable'] || '').trim())

const testCompta = ref<'idle' | 'sending' | 'ok' | 'error'>('idle')
const testComptaMsg = ref('')
async function envoyerTestCabinet() {
  if (!comptaEmail.value) {
    testCompta.value = 'error'
    testComptaMsg.value = 'Renseignez d\'abord l\'email du cabinet.'
    return
  }
  testCompta.value = 'sending'
  testComptaMsg.value = ''
  try {
    const { data } = await api.post('/comptabilite/envoi-cabinet-test', {
      email: comptaEmail.value,
      cc: (editValues.value['email_cabinet_cc'] || '').trim(),
    })
    testCompta.value = 'ok'
    const dests = Array.isArray(data?.destinataires) ? data.destinataires.join(', ') : comptaEmail.value
    testComptaMsg.value = `Relevé envoyé à ${dests}.`
    setTimeout(() => { if (testCompta.value === 'ok') { testCompta.value = 'idle'; testComptaMsg.value = '' } }, 6000)
  } catch (err: any) {
    testCompta.value = 'error'
    testComptaMsg.value = err?.response?.data?.message || err?.message || 'Échec de l\'envoi.'
  }
}

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

// ── Catégories de dépenses ────────────────────────────────────────────
interface CategorieDep { id: number; code: string; libelle: string; description: string | null; ordre: number; actif: boolean }
const categoriesDep       = ref<CategorieDep[]>([])
const loadingCatDep       = ref(false)
const showModalCatDep     = ref(false)
const editingCatDep       = ref<CategorieDep | null>(null)
const savingCatDep        = ref(false)
const deletingCatDepId    = ref<number | null>(null)
const formCatDep          = ref({ libelle: '', description: '', ordre: 0 })

async function loadCatDep() {
  loadingCatDep.value = true
  try {
    const { data } = await api.get('/categories-depenses')
    categoriesDep.value = data
  } finally { loadingCatDep.value = false }
}
function openAddCatDep() {
  editingCatDep.value = null
  formCatDep.value = { libelle: '', description: '', ordre: categoriesDep.value.length + 1 }
  showModalCatDep.value = true
}
function openEditCatDep(c: CategorieDep) {
  editingCatDep.value = c
  formCatDep.value = { libelle: c.libelle, description: c.description ?? '', ordre: c.ordre }
  showModalCatDep.value = true
}
async function saveCatDep() {
  savingCatDep.value = true
  try {
    if (editingCatDep.value) {
      const { data } = await api.put(`/categories-depenses/${editingCatDep.value.id}`, { ...formCatDep.value, actif: editingCatDep.value.actif })
      const idx = categoriesDep.value.findIndex(x => x.id === editingCatDep.value!.id)
      if (idx >= 0) categoriesDep.value[idx] = data
    } else {
      const { data } = await api.post('/categories-depenses', formCatDep.value)
      categoriesDep.value.push(data)
    }
    showModalCatDep.value = false
  } catch (e: unknown) {
    alert((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Erreur')
  } finally { savingCatDep.value = false }
}
async function toggleCatDep(c: CategorieDep) {
  const { data } = await api.put(`/categories-depenses/${c.id}`, { libelle: c.libelle, ordre: c.ordre, actif: !c.actif })
  const idx = categoriesDep.value.findIndex(x => x.id === c.id)
  if (idx >= 0) categoriesDep.value[idx] = data
}
async function deleteCatDep(c: CategorieDep) {
  if (!confirm(`Supprimer la catégorie "${c.libelle}" ?`)) return
  deletingCatDepId.value = c.id
  try {
    await api.delete(`/categories-depenses/${c.id}`)
    categoriesDep.value = categoriesDep.value.filter(x => x.id !== c.id)
  } catch (e: unknown) {
    alert((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Suppression impossible')
  } finally { deletingCatDepId.value = null }
}

// ── Types de documents ────────────────────────────────────────────────
const typesDocuments = ref<TypeDocument[]>([])
const loadingTypesDocs = ref(false)
const showModalTypeDoc = ref(false)
const editingTypeDoc = ref<TypeDocument | null>(null)
const savingTypeDoc = ref(false)
const deletingTypeDocId = ref<number | null>(null)
const formTypeDoc = ref<{ code: string; label: string; actif: boolean; ordre: number; type_formation_id: number | null }>({ code: '', label: '', actif: true, ordre: 0, type_formation_id: null })

async function loadTypesDocs() {
  loadingTypesDocs.value = true
  try {
    const { data } = await api.get('/types-documents')
    typesDocuments.value = data
  } finally {
    loadingTypesDocs.value = false
  }
}

function openNewTypeDoc() {
  editingTypeDoc.value = null
  formTypeDoc.value = { code: '', label: '', actif: true, ordre: 0, type_formation_id: null }
  showModalTypeDoc.value = true
}

function openEditTypeDoc(t: TypeDocument) {
  editingTypeDoc.value = t
  formTypeDoc.value = { code: t.code, label: t.label, actif: t.actif, ordre: t.ordre, type_formation_id: t.type_formation_id ?? null }
  showModalTypeDoc.value = true
}

async function saveTypeDoc() {
  if (!formTypeDoc.value.label.trim()) return
  savingTypeDoc.value = true
  try {
    if (editingTypeDoc.value) {
      const { data } = await api.put(`/types-documents/${editingTypeDoc.value.id}`, {
        label: formTypeDoc.value.label,
        actif: formTypeDoc.value.actif,
        ordre: formTypeDoc.value.ordre,
        type_formation_id: formTypeDoc.value.type_formation_id || null,
      })
      const idx = typesDocuments.value.findIndex(t => t.id === editingTypeDoc.value!.id)
      if (idx >= 0) typesDocuments.value[idx] = data
    } else {
      if (!formTypeDoc.value.code.trim()) return
      const { data } = await api.post('/types-documents', formTypeDoc.value)
      typesDocuments.value.push(data)
    }
    showModalTypeDoc.value = false
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Erreur lors de la sauvegarde')
  } finally {
    savingTypeDoc.value = false
  }
}

async function deleteTypeDoc(t: TypeDocument) {
  if (!confirm(`Supprimer le type de document "${t.label}" ?`)) return
  deletingTypeDocId.value = t.id
  try {
    await api.delete(`/types-documents/${t.id}`)
    typesDocuments.value = typesDocuments.value.filter(x => x.id !== t.id)
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Suppression impossible')
  } finally {
    deletingTypeDocId.value = null
  }
}

// ── Congés & Fêtes institut ───────────────────────────────────────────
interface CongeInstitut { id: number; nom: string; date_debut: string; date_fin: string; type: string; recurrent: boolean; annee_academique_id: number | null; annee_academique_libelle?: string }
const conges = ref<CongeInstitut[]>([])
const loadingConges = ref(false)
const showModalConge = ref(false)
const editingConge = ref<CongeInstitut | null>(null)
const savingConge = ref(false)
const deletingCongeId = ref<number | null>(null)
const formConge = ref({ nom: '', date_debut: '', date_fin: '', type: 'fete' as string, recurrent: false, annee_academique_id: null as number | null })

const congeTypes: Record<string, string> = { fete: 'Fête religieuse', vacances: 'Vacances', pont: 'Pont', autre: 'Autre' }

async function loadConges() {
  loadingConges.value = true
  try {
    const { data } = await api.get('/conges-institut')
    conges.value = data
  } finally {
    loadingConges.value = false
  }
}

function openNewConge() {
  editingConge.value = null
  formConge.value = { nom: '', date_debut: '', date_fin: '', type: 'fete', recurrent: false, annee_academique_id: null }
  showModalConge.value = true
}

function openEditConge(c: CongeInstitut) {
  editingConge.value = c
  formConge.value = {
    nom: c.nom,
    date_debut: c.date_debut?.slice(0, 10) ?? '',
    date_fin: c.date_fin?.slice(0, 10) ?? '',
    type: c.type,
    recurrent: c.recurrent,
    annee_academique_id: c.annee_academique_id,
  }
  showModalConge.value = true
}

async function saveConge() {
  if (!formConge.value.nom.trim() || !formConge.value.date_debut || !formConge.value.date_fin) return
  savingConge.value = true
  try {
    const payload = { ...formConge.value }
    if (editingConge.value) {
      const { data } = await api.put(`/conges-institut/${editingConge.value.id}`, payload)
      const idx = conges.value.findIndex(c => c.id === editingConge.value!.id)
      if (idx >= 0) conges.value[idx] = data
    } else {
      const { data } = await api.post('/conges-institut', payload)
      conges.value.unshift(data)
    }
    showModalConge.value = false
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Erreur lors de la sauvegarde')
  } finally {
    savingConge.value = false
  }
}

async function deleteConge(c: CongeInstitut) {
  if (!confirm(`Supprimer "${c.nom}" ?`)) return
  deletingCongeId.value = c.id
  try {
    await api.delete(`/conges-institut/${c.id}`)
    conges.value = conges.value.filter(x => x.id !== c.id)
  } catch (e: any) {
    alert(e?.response?.data?.message || 'Suppression impossible')
  } finally {
    deletingCongeId.value = null
  }
}

function formatDateFr(d: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function congeDuree(c: CongeInstitut) {
  const d1 = new Date(c.date_debut), d2 = new Date(c.date_fin)
  return Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1
}

onMounted(() => {
  load()
  loadTypesFormation()
  loadTarifs()
  loadMatieres()
  loadNiveauxEntree()
  loadNiveauxBourse()
  loadTypesDocs()
  loadCatDep()
  loadConges()
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

      <!-- Raccourcis administration -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;">
        <a href="/annees-academiques" style="display:inline-flex;align-items:center;gap:7px;padding:8px 16px;background:#E30613;color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          Années académiques
        </a>
        <a href="/tarifs" style="display:inline-flex;align-items:center;gap:7px;padding:8px 16px;background:#1e293b;color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>
          Tarifs
        </a>
        <a href="/users" style="display:inline-flex;align-items:center;gap:7px;padding:8px 16px;background:#1e293b;color:#fff;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;">
          <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
          Utilisateurs
        </a>
      </div>

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
              { key: 'types-docs',     label: 'Types de documents' },
              { key: 'conges',         label: 'Congés & Fêtes' },
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
                  <div class="pm-toggle-row" style="margin-top:8px;">
                    <button @click="formType.est_individuel = !formType.est_individuel" class="pm-toggle" :class="formType.est_individuel ? 'pm-toggle--on' : ''">
                      <span class="pm-toggle-knob" :class="formType.est_individuel ? 'pm-toggle-knob--on' : ''" />
                    </button>
                    <span class="pm-toggle-label">{{ formType.est_individuel ? 'Formation individuelle (à la carte, paiement 50/50)' : 'Formation collective (classique)' }}</span>
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

        <!-- ─── Tarifs enseignants ───────────────────────────────── -->
        <template v-else-if="activePedaTab === 'tarifs'">
          <div class="pm-tab-bar">
            <p class="pm-tab-desc">Taux horaires par type de formation et année académique.</p>
            <button v-if="isDG" @click="openNewTarif" class="uc-btn-primary">+ Définir un tarif</button>
          </div>

          <div class="pm-info-banner">
            <strong>Règle tronc commun :</strong> Lorsqu'une séance regroupe plusieurs types de formation, le taux le plus élevé est appliqué à l'enseignant.
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
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
              <button v-if="isDG && matieres.length > 0" @click="nettoyerDoublonsMatieres" :disabled="nettoyageDoublonsMatieres"
                style="padding:7px 13px;font-size:12px;font-weight:600;border-radius:6px;cursor:pointer;border:1.5px solid #ea580c;background:#fff7ed;color:#ea580c;">
                {{ nettoyageDoublonsMatieres ? 'Nettoyage…' : '🧹 Nettoyer les doublons' }}
              </button>
              <button v-if="isDG" @click="openNewMatiere" class="uc-btn-primary">+ Nouvelle matière</button>
            </div>
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
                  <th style="text-align:center">Frais inscription</th>
                  <th style="text-align:center">Tenue</th>
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
                    <span class="pm-badge-statut" :class="b.applique_tenue ? 'pm-statut-actif' : 'pm-statut-inactif'">
                      {{ b.applique_tenue ? 'Oui' : 'Non' }}
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
                    <p class="pm-hint">Réduction appliquée sur la mensualité. Paramétrez indépendamment si elle s'applique aussi aux frais d'inscription et à la tenue.</p>
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
                      <p class="pm-hint">La réduction s'applique aussi aux frais d'inscription.</p>
                    </div>
                  </div>
                  <div class="pm-check-row">
                    <button
                      @click="formNiveauBourse.applique_tenue = !formNiveauBourse.applique_tenue"
                      class="pm-toggle pm-toggle--sm"
                      :class="formNiveauBourse.applique_tenue ? 'pm-toggle--on' : ''"
                    >
                      <span class="pm-toggle-knob pm-toggle-knob--sm" :class="formNiveauBourse.applique_tenue ? 'pm-toggle-knob--sm-on' : ''" />
                    </button>
                    <div>
                      <p class="pm-check-label">Appliquer aux frais de tenue</p>
                      <p class="pm-hint">La réduction s'applique aussi aux frais de tenue.</p>
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

        <!-- ─── Types de documents ────────────────────────────────── -->
        <template v-if="activePedaTab === 'types-docs'">
          <div class="pm-tab-bar">
            <p class="pm-tab-desc">Définissez les types de pièces et documents acceptés pour les dossiers étudiants.</p>
            <button v-if="isDG" @click="openNewTypeDoc" class="uc-btn-primary">+ Nouveau type</button>
          </div>

          <div v-if="loadingTypesDocs" class="pm-empty">Chargement…</div>
          <div v-else-if="typesDocuments.length === 0" class="pm-empty">Aucun type de document configuré.</div>
          <div v-else class="pm-table-wrap">
            <table class="pm-table">
              <thead>
                <tr>
                  <th>Libellé</th>
                  <th>Code interne</th>
                  <th>Type de formation</th>
                  <th style="text-align:center">Ordre</th>
                  <th style="text-align:center">Statut</th>
                  <th v-if="isDG" style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in typesDocuments" :key="t.id">
                  <td class="pm-td-bold">{{ t.label }}</td>
                  <td><span class="pm-badge-code">{{ t.code }}</span></td>
                  <td style="font-size:12px;">
                    <span v-if="t.type_formation_nom" class="pm-badge-code" style="background:#ede9fe;color:#6d28d9;">{{ t.type_formation_nom }}</span>
                    <span v-else style="color:#aaa;font-size:11px;">Tous types de formation</span>
                  </td>
                  <td style="text-align:center;color:#999;font-size:12px;">{{ t.ordre }}</td>
                  <td style="text-align:center">
                    <span v-if="t.actif" class="pm-badge-active">Actif</span>
                    <span v-else class="pm-badge-inactive">Inactif</span>
                  </td>
                  <td v-if="isDG" style="text-align:right">
                    <div class="pm-row-actions">
                      <button @click="openEditTypeDoc(t)" class="pm-action-btn pm-action-btn--edit">Modifier</button>
                      <button
                        @click="deleteTypeDoc(t)"
                        :disabled="deletingTypeDocId === t.id"
                        class="pm-action-btn pm-action-btn--del"
                      >{{ deletingTypeDocId === t.id ? '…' : 'Supprimer' }}</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Modal créer / modifier un type de document -->
          <Teleport to="body">
            <div v-if="showModalTypeDoc" class="pm-overlay" @click.self="showModalTypeDoc = false">
              <div class="pm-modal">
                <div class="pm-modal-header">
                  <h2 class="pm-modal-title">{{ editingTypeDoc ? 'Modifier le type de document' : 'Nouveau type de document' }}</h2>
                  <button @click="showModalTypeDoc = false" class="pm-modal-close">✕</button>
                </div>
                <div class="pm-modal-body">
                  <!-- Code (création uniquement) -->
                  <div v-if="!editingTypeDoc" class="pm-field">
                    <label class="pm-label">Code interne <span class="pm-req">*</span></label>
                    <input v-model="formTypeDoc.code" type="text" class="pm-input"
                      placeholder="Ex: attestation, relevé_notes…"
                      @input="formTypeDoc.code = (formTypeDoc.code as string).toLowerCase().replace(/\s+/g, '_')" />
                    <p class="pm-hint">Identifiant technique unique, en minuscules, sans espaces.</p>
                  </div>
                  <div v-else class="pm-field">
                    <label class="pm-label">Code interne</label>
                    <input :value="editingTypeDoc.code" type="text" class="pm-input" disabled style="opacity:0.5;cursor:not-allowed" />
                    <p class="pm-hint">Le code ne peut pas être modifié après création.</p>
                  </div>
                  <!-- Libellé -->
                  <div class="pm-field">
                    <label class="pm-label">Libellé <span class="pm-req">*</span></label>
                    <input v-model="formTypeDoc.label" type="text" class="pm-input" placeholder="Ex: Attestation de scolarité" />
                  </div>
                  <!-- Ordre d'affichage -->
                  <div class="pm-field">
                    <label class="pm-label">Ordre d'affichage</label>
                    <input v-model.number="formTypeDoc.ordre" type="number" min="0" class="pm-input" placeholder="0" />
                    <p class="pm-hint">Nombre inférieur = affiché en premier dans la liste.</p>
                  </div>
                  <!-- Type de formation -->
                  <div class="pm-field">
                    <label class="pm-label">Type de formation concerné</label>
                    <select v-model="formTypeDoc.type_formation_id" class="pm-input">
                      <option :value="null">Tous les types (document commun à toutes les formations)</option>
                      <option v-for="tf in typesFormation" :key="tf.id" :value="tf.id">{{ tf.nom }}</option>
                    </select>
                    <p class="pm-hint">Ex : choisir "Accéléré" pour un document exigé uniquement en formation accélérée.</p>
                  </div>
                  <!-- Statut actif -->
                  <div class="pm-toggle-row">
                    <button @click="formTypeDoc.actif = !formTypeDoc.actif" class="pm-toggle" :class="formTypeDoc.actif ? 'pm-toggle--on' : ''">
                      <span class="pm-toggle-knob" :class="formTypeDoc.actif ? 'pm-toggle-knob--on' : ''" />
                    </button>
                    <span class="pm-toggle-label">{{ formTypeDoc.actif ? 'Actif — visible dans le formulaire étudiant' : 'Inactif — masqué dans le formulaire' }}</span>
                  </div>
                </div>
                <div class="pm-modal-footer">
                  <button @click="showModalTypeDoc = false" class="pm-btn-cancel">Annuler</button>
                  <button
                    @click="saveTypeDoc"
                    :disabled="!formTypeDoc.label.trim() || (!editingTypeDoc && !formTypeDoc.code.trim()) || savingTypeDoc"
                    class="uc-btn-primary"
                    :style="(!formTypeDoc.label.trim() || (!editingTypeDoc && !formTypeDoc.code.trim()) || savingTypeDoc) ? 'opacity:0.4' : ''"
                  >
                    {{ savingTypeDoc ? 'Enregistrement…' : editingTypeDoc ? 'Modifier' : 'Créer' }}
                  </button>
                </div>
              </div>
            </div>
          </Teleport>
        </template>

        <!-- ─── Congés & Fêtes ───────────────────────────────────────── -->
        <template v-if="activePedaTab === 'conges'">
          <div class="pm-tab-bar">
            <p class="pm-tab-desc">Définissez les jours fériés, fêtes et vacances de l'institut. Ces périodes seront exclues de la génération automatique des emplois du temps.</p>
            <button v-if="isDG || auth.user?.role === 'dir_peda'" @click="openNewConge" class="uc-btn-primary">+ Nouveau congé</button>
          </div>

          <div v-if="loadingConges" class="pm-empty">Chargement…</div>
          <div v-else-if="conges.length === 0" class="pm-empty">Aucun congé ou fête configuré. Commencez par en créer un.</div>
          <div v-else class="pm-table-wrap">
            <table class="pm-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Type</th>
                  <th>Date début</th>
                  <th>Date fin</th>
                  <th style="text-align:center">Durée</th>
                  <th style="text-align:center">Récurrent</th>
                  <th v-if="isDG || auth.user?.role === 'dir_peda'" style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in conges" :key="c.id">
                  <td class="pm-td-bold">{{ c.nom }}</td>
                  <td><span class="pm-badge-code" :style="c.type === 'vacances' ? 'background:#dbeafe;color:#1d4ed8' : c.type === 'fete' ? 'background:#fef3c7;color:#92400e' : ''">{{ congeTypes[c.type] ?? c.type }}</span></td>
                  <td style="font-size:12px;">{{ formatDateFr(c.date_debut) }}</td>
                  <td style="font-size:12px;">{{ formatDateFr(c.date_fin) }}</td>
                  <td style="text-align:center;font-size:12px;font-weight:600;">{{ congeDuree(c) }}j</td>
                  <td style="text-align:center">
                    <span class="pm-badge-statut" :class="c.recurrent ? 'pm-statut-actif' : 'pm-statut-inactif'">{{ c.recurrent ? 'Oui' : 'Non' }}</span>
                  </td>
                  <td v-if="isDG || auth.user?.role === 'dir_peda'" style="text-align:right">
                    <div class="pm-row-actions">
                      <button @click="openEditConge(c)" class="pm-action-btn pm-action-btn--edit">Modifier</button>
                      <button @click="deleteConge(c)" :disabled="deletingCongeId === c.id" class="pm-action-btn pm-action-btn--del">{{ deletingCongeId === c.id ? '…' : 'Supprimer' }}</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Modal créer / modifier un congé -->
          <Teleport to="body">
            <div v-if="showModalConge" class="pm-overlay" @click.self="showModalConge = false">
              <div class="pm-modal">
                <div class="pm-modal-header">
                  <h2 class="pm-modal-title">{{ editingConge ? 'Modifier le congé' : 'Nouveau congé / fête' }}</h2>
                  <button @click="showModalConge = false" class="pm-modal-close">✕</button>
                </div>
                <div class="pm-modal-body">
                  <div class="pm-field">
                    <label class="pm-label">Nom <span class="pm-req">*</span></label>
                    <input v-model="formConge.nom" type="text" class="pm-input" placeholder="Ex: Tabaski, Vacances de Noël, Magal…" />
                  </div>
                  <div class="pm-field">
                    <label class="pm-label">Type</label>
                    <select v-model="formConge.type" class="pm-input">
                      <option value="fete">Fête religieuse</option>
                      <option value="vacances">Vacances</option>
                      <option value="pont">Pont</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                  <div class="pm-grid-2">
                    <div class="pm-field">
                      <label class="pm-label">Date début <span class="pm-req">*</span></label>
                      <input v-model="formConge.date_debut" type="date" class="pm-input" />
                    </div>
                    <div class="pm-field">
                      <label class="pm-label">Date fin <span class="pm-req">*</span></label>
                      <input v-model="formConge.date_fin" type="date" class="pm-input" />
                    </div>
                  </div>
                  <div class="pm-check-row">
                    <button
                      @click="formConge.recurrent = !formConge.recurrent"
                      class="pm-toggle pm-toggle--sm"
                      :class="formConge.recurrent ? 'pm-toggle--on' : ''"
                    >
                      <span class="pm-toggle-knob pm-toggle-knob--sm" :class="formConge.recurrent ? 'pm-toggle-knob--sm-on' : ''" />
                    </button>
                    <div>
                      <p class="pm-check-label">Récurrent chaque année</p>
                      <p class="pm-hint">Si activé, ce congé sera automatiquement reconduit les années suivantes.</p>
                    </div>
                  </div>
                </div>
                <div class="pm-modal-footer">
                  <button @click="showModalConge = false" class="pm-btn-cancel">Annuler</button>
                  <button
                    @click="saveConge"
                    :disabled="!formConge.nom.trim() || !formConge.date_debut || !formConge.date_fin || savingConge"
                    class="uc-btn-primary"
                    :style="(!formConge.nom.trim() || !formConge.date_debut || !formConge.date_fin || savingConge) ? 'opacity:0.4' : ''"
                  >
                    {{ savingConge ? 'Enregistrement…' : editingConge ? 'Modifier' : 'Créer' }}
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

        <!-- ── Catégories de dépenses ─────────────────────────────── -->
        <div class="pm-section-header" style="margin-top:28px;">
          <div>
            <h2 class="pm-section-title" style="font-size:15px;">Catégories de dépenses</h2>
            <p class="pm-section-desc">Gérez les catégories utilisées dans la page Dépenses</p>
          </div>
          <button v-if="isDG" @click="openAddCatDep" class="pm-btn-add">
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Ajouter
          </button>
        </div>
        <div v-if="loadingCatDep" class="pm-empty">Chargement…</div>
        <div v-else-if="!categoriesDep.length" class="pm-empty">Aucune catégorie définie.</div>
        <div v-else class="pm-cat-dep-list">
          <div v-for="c in categoriesDep" :key="c.id" class="pm-cat-dep-row">
            <div style="display:flex;align-items:center;gap:10px;flex:1;">
              <span class="pm-cat-dep-code">{{ c.code }}</span>
              <div>
                <span style="font-weight:600;font-size:13px;color:#111;">{{ c.libelle }}</span>
                <span v-if="!c.actif" style="font-size:10px;background:#f5f5f5;color:#999;padding:2px 7px;border-radius:10px;margin-left:6px;">Inactif</span>
                <p v-if="c.description" style="font-size:11px;color:#888;margin:2px 0 0;white-space:pre-line;line-height:1.5;">{{ c.description }}</p>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <button v-if="isDG" @click="toggleCatDep(c)" :title="c.actif ? 'Désactiver' : 'Activer'"
                :style="{ background: c.actif ? '#f0fdf4' : '#f5f5f5', color: c.actif ? '#15803d' : '#999', border:'1px solid', borderColor: c.actif ? '#bbf7d0' : '#e5e5e5', borderRadius:'4px', padding:'4px 10px', fontSize:'11px', fontWeight:'600', cursor:'pointer' }">
                {{ c.actif ? 'Actif' : 'Inactif' }}
              </button>
              <button v-if="isDG" @click="openEditCatDep(c)" style="background:none;border:none;cursor:pointer;padding:4px;color:#555;" title="Modifier">✏️</button>
              <button v-if="isDG" @click="deleteCatDep(c)" :disabled="deletingCatDepId===c.id" style="background:none;border:none;cursor:pointer;padding:4px;color:#b91c1c;" title="Supprimer">🗑</button>
            </div>
          </div>
        </div>

        <!-- Modal catégorie -->
        <UcModal v-model="showModalCatDep" :title="editingCatDep ? 'Modifier la catégorie' : 'Nouvelle catégorie'" width="480px" @close="showModalCatDep=false">
          <div style="display:flex;flex-direction:column;gap:14px;">
            <UcFormGroup label="Libellé" :required="true">
              <input v-model="formCatDep.libelle" required placeholder="Ex : Charges de fonctionnement" />
            </UcFormGroup>
            <UcFormGroup label="Éléments inclus (un par ligne)">
              <textarea v-model="formCatDep.description" rows="5" style="resize:vertical;width:100%;padding:8px 10px;border:1px solid #e0e0e0;border-radius:6px;font-size:12.5px;font-family:inherit;"
                placeholder="Ex :&#10;• Loyer / location&#10;• Électricité&#10;• Eau&#10;• Internet / connexion&#10;• Téléphonie / communication" />
              <p style="font-size:11px;color:#aaa;margin-top:4px;">Ces précisions s'afficheront comme aide dans le formulaire de saisie.</p>
            </UcFormGroup>
            <UcFormGroup label="Ordre d'affichage">
              <input v-model.number="formCatDep.ordre" type="number" min="0" />
            </UcFormGroup>
          </div>
          <template #footer>
            <button @click="showModalCatDep=false" class="pm-btn-cancel">Annuler</button>
            <button @click="saveCatDep" :disabled="savingCatDep||!formCatDep.libelle" class="pm-btn-save">
              {{ savingCatDep ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </template>
        </UcModal>

      </template>

      <!-- ═══ COMPTABILITÉ ═════════════════════════════════════════════ -->
      <template v-else-if="activeGroup === 'comptabilite'">
        <div class="pm-section-header">
          <h1 class="pm-section-title">Comptabilité</h1>
          <p class="pm-section-desc">Envoi automatique du relevé comptable au cabinet le <strong>15</strong> et le <strong>dernier jour</strong> du mois.</p>
        </div>

        <div v-if="loading" class="pm-empty">Chargement…</div>
        <template v-else>
          <div v-if="comptaParams.length === 0" class="pm-empty">Aucun paramètre dans cette catégorie.</div>
          <div v-else class="pm-params-list">
            <div v-for="p in comptaParams" :key="p.cle" class="pm-param-card">
              <div v-if="fieldConfig[p.cle]?.toggle" class="pm-param-row">
                <div>
                  <p class="pm-param-label">{{ fieldConfig[p.cle]?.label ?? p.cle }}</p>
                  <p v-if="p.cle === 'envoi_releve_cabinet_actif'" class="pm-hint">Lorsque activé, le relevé est envoyé automatiquement au cabinet les 15 et dernier jour du mois.</p>
                  <p v-else-if="p.description" class="pm-hint">{{ p.description }}</p>
                </div>
                <button @click="toggleValue(p.cle)" :disabled="!isDG" class="pm-toggle" :class="editValues[p.cle] === '1' ? 'pm-toggle--on' : ''">
                  <span class="pm-toggle-knob" :class="editValues[p.cle] === '1' ? 'pm-toggle-knob--on' : ''" />
                </button>
              </div>
              <div v-else class="pm-param-row pm-param-row--field">
                <div style="flex:1;min-width:0">
                  <label :for="`param-${p.cle}`" class="pm-param-label">{{ fieldConfig[p.cle]?.label ?? p.cle }}</label>
                  <p v-if="p.cle === 'email_cabinet_cc'" class="pm-hint">Facultatif — séparez plusieurs adresses par une virgule.</p>
                  <p v-else-if="p.description" class="pm-hint">{{ p.description }}</p>
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

          <!-- Bouton test -->
          <div v-if="isDG" class="pm-param-card" style="margin-top:14px;background:#f8fafc;border-color:#e2e8f0">
            <div class="pm-param-row pm-param-row--field" style="align-items:center">
              <div style="flex:1;min-width:0">
                <p class="pm-param-label">Envoyer un e-mail de test</p>
                <p class="pm-hint">Envoie immédiatement le relevé du mois en cours à l'adresse configurée (et aux copies). Utile pour valider la configuration sans attendre l'envoi automatique.</p>
                <p v-if="testComptaMsg" class="pm-hint" :style="{ color: testCompta === 'ok' ? '#15803d' : testCompta === 'error' ? '#b91c1c' : '#64748b', fontWeight: 600, marginTop:'6px' }">
                  {{ testComptaMsg }}
                </p>
              </div>
              <div style="flex-shrink:0">
                <button
                  @click="envoyerTestCabinet"
                  :disabled="testCompta === 'sending' || !comptaEmail"
                  class="pm-btn-save"
                  :class="testCompta === 'ok' ? 'pm-btn-save--ok' : ''"
                  :title="!comptaEmail ? 'Renseignez d\'abord l\'email du cabinet' : 'Envoyer maintenant'"
                >
                  <svg v-if="testCompta === 'ok'" width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                  <svg v-else width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                  {{ testCompta === 'sending' ? 'Envoi…' : testCompta === 'ok' ? 'Envoyé' : 'Envoyer un test' }}
                </button>
              </div>
            </div>
          </div>

          <p v-if="comptaActif && !comptaEmail" class="pm-hint" style="margin-top:10px;color:#b45309;font-weight:600">
            ⚠️ L'envoi automatique est activé mais aucun email n'est configuré — renseignez l'adresse du cabinet.
          </p>
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
.pm-btn-add { display:inline-flex;align-items:center;gap:5px;padding:7px 14px;font-size:12px;font-weight:600;border:1px solid #E30613;color:#E30613;background:#fff;border-radius:6px;cursor:pointer; }
.pm-btn-add:hover { background:#fff0f0; }
.pm-cat-dep-list { display:flex;flex-direction:column;gap:6px;margin-top:8px; }
.pm-cat-dep-row { display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#fff;border:1px solid #f0f0f0;border-radius:7px; }
.pm-cat-dep-code { font-size:10px;font-weight:600;background:#f5f5f5;color:#888;padding:2px 7px;border-radius:4px;font-family:monospace; }

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

@media (max-width: 640px) {
  .pm-grid-2 { grid-template-columns: 1fr !important; }
  .pm-param-row { flex-direction: column; align-items: flex-start; }
  .pm-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .pm-tabs { overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; }
  .pm-tab { white-space: nowrap; }
  .pm-section-header { flex-direction: column; align-items: flex-start; gap: 8px; }
}
</style>
