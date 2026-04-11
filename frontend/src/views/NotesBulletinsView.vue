<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/services/api'
import UcModal from '@/components/ui/UcModal.vue'
import UcFormGroup from '@/components/ui/UcFormGroup.vue'
import UcFormGrid from '@/components/ui/UcFormGrid.vue'
import UcPageHeader from '@/components/ui/UcPageHeader.vue'
import UcTable from '@/components/ui/UcTable.vue'

const auth = useAuthStore()
const isEnseignant = computed(() => auth.user?.role === 'enseignant')
const isDG = computed(() => auth.user?.role === 'dg')
const canWrite = computed(() =>
  ['dg', 'dir_peda', 'coordinateur', 'enseignant'].includes(auth.user?.role ?? '')
)
// Profil enseignant connecté (ses UEs et ses classes)
const monProfil = ref<{ id: number; mes_ues: {id:number;classe_id:number;code:string;intitule:string}[]; mes_classes: {id:number;nom:string}[] } | null>(null)
// IDs des UEs dont le prof connecté peut saisir les notes (Number() pour éviter string vs number)
const mesUeIds = computed(() => monProfil.value?.mes_ues.map(u => Number(u.id)) ?? [])

interface UE {
  id: number; classe_id: number; enseignant_id: number | null; matiere_id?: number | null
  code: string; intitule: string; coefficient: number; credits_ects: number; ordre: number
  is_tronc_commun?: boolean
  enseignant?: { id: number; nom: string; prenom: string }
}
interface Bulletin {
  inscription: any; ues: any[]
  ues_tronc_commun?: any[]; ues_specifiques?: any[]
  semestres?: any[]
  moyenne: number | null; mention: string | null
  decision: string; credits_valides: number; credits_total: number
  has_tronc_commun?: boolean
  est_lmd?: boolean
}
interface Inscription {
  id: number
  filiere_id?: number | null
  filiere?: { id: number; nom: string } | null
  etudiant: { nom: string; prenom: string }
  niveau_entree?: { id: number; nom: string; est_superieur_bac: boolean } | null
}
interface Note { id?: number; inscription_id: number; ue_id: number; note: number; session: string }

const activeTab = ref<'saisie' | 'jury' | 'bulletins'>('saisie')

const classes = ref<{ id: number; nom: string; annee_academique_id?: number; annee_academique?: string }[]>([])
const anneesAcademiques = ref<{ id: number; libelle: string; actif: boolean }[]>([])
const filterAnneeNotes = ref('')
const classesFiltreesParAnnee = computed(() => {
  if (!filterAnneeNotes.value) return classes.value
  return classes.value.filter(c => String(c.annee_academique_id) === filterAnneeNotes.value)
})
const ues = ref<UE[]>([])
const uesTronc = computed(() => ues.value.filter(u => u.is_tronc_commun))
const uesSpecifiques = computed(() => ues.value.filter(u => !u.is_tronc_commun))
const hasTroncCommun = computed(() => uesTronc.value.length > 0)
const inscriptions = ref<Inscription[]>([])
const notesData = ref<Note[]>([])
// filiere_id → { matiere_id → { coefficient, credits } } — reçu de l'API pour calculs cross-filière
const filierePivots = ref<Record<number, Record<number, { coefficient: number; credits: number }>>>({})
const loading = ref(true)
const saving = ref(false)
const saved = ref(false)

const filterClasse = ref('')
const filterSession = ref<'normale' | 'rattrapage'>('normale')
const filterSemestre = ref<number | null>(null)   // null = tous
const bulletinSemestre = ref<number | null>(null) // null = année complète

// Saisie séparée contrôle / examen pour FP
const localControles = ref<Record<number, Record<number, string>>>({})
const localExamens   = ref<Record<number, Record<number, string>>>({})

// La classe est FP si au moins un étudiant n'a pas le bac
const classeEstFP = computed(() =>
  inscriptions.value.some(i => (i as any).niveau_entree?.est_superieur_bac === false)
)

// UEs visibles dans la grille saisie (filtre semestre si actif) — triées par groupe UE puis par ordre
const uesVisible = computed(() => {
  const filtered = filterSemestre.value === null
    ? ues.value
    : ues.value.filter(u => ((u as any).semestre ?? 1) === filterSemestre.value)
  return [...filtered].sort((a, b) => {
    const ka = (a as any).categorie_ue ?? ''
    const kb = (b as any).categorie_ue ?? ''
    if (ka !== kb) {
      if (!ka) return 1   // sans groupe à la fin
      if (!kb) return -1
      return ka.localeCompare(kb)
    }
    return (a.ordre ?? 0) - (b.ordre ?? 0)
  })
})

// Groupes de colonnes pour l'en-tête (colspan par groupe UE)
const uesVisibleGroupes = computed(() => {
  const result: { code: string | null; intitule: string | null; count: number }[] = []
  for (const ue of uesVisible.value) {
    const key = (ue as any).categorie_ue ?? null
    const last = result[result.length - 1]
    if (last && last.code === key) { last.count++ }
    else result.push({ code: key, intitule: (ue as any).intitule_ue ?? null, count: 1 })
  }
  return result
})
const hasUeGroupes = computed(() => uesVisibleGroupes.value.some(g => g.code !== null))

// Semestres disponibles (pour le filtre)
const semestresDisponibles = computed(() => [...new Set(ues.value.map(u => (u as any).semestre ?? 1))].sort() as number[])

// Grille notes [inscription_id][ue_id] = valeur
const localNotes = ref<Record<number, Record<number, string>>>({})

// Vrai si l'étudiant est en système LMD (niveau BAC ou BAC+)
function isLMD(inscriptionId: number): boolean {
  const insc = inscriptions.value.find(i => i.id === inscriptionId)
  return insc?.niveau_entree?.est_superieur_bac === true || /bac/i.test(insc?.niveau_entree?.nom ?? '')
}

// Retourne le poids effectif d'une UE pour un étudiant :
//   - LMD (≥ BAC) → crédits (ECTS)
//   - Classique (< BAC) → coefficient
// Priorité : filiere_matiere > UE directe
function getWeight(ue: UE, inscriptionId: number): number {
  const lmd = isLMD(inscriptionId)
  if (lmd) return parseFloat(String(ue.credits_ects)) || 1
  // Pour FP : respecter coef=0 (ne pas forcer à 1)
  const coef = parseFloat(String(ue.coefficient))
  return isNaN(coef) ? 1 : coef
}

// Moyenne pondérée pour un étudiant (poids = crédit si LMD, coefficient sinon)
// Les matières avec coef=0 sont exclues du calcul
function moyennePonderee(inscriptionId: number): number | null {
  let totalPts = 0, totalWeight = 0
  let hasNote = false
  for (const ue of ues.value) {
    const w = getWeight(ue, inscriptionId)
    if (w === 0) continue  // ignorer matières coef=0
    const v = localNotes.value[inscriptionId]?.[ue.id]
    if (v !== '' && v !== undefined && v !== null) {
      const n = parseFloat(v)
      if (!isNaN(n)) { totalPts += n * w; totalWeight += w; hasNote = true }
    }
  }
  return hasNote && totalWeight > 0 ? Math.round(totalPts / totalWeight * 100) / 100 : null
}

// Décision selon système
function decisionLMD(inscriptionId: number): string {
  const insc = inscriptions.value.find(i => i.id === inscriptionId)
  const fId = insc?.filiere_id ?? (insc?.filiere as any)?.id
  let creditsValides = 0
  for (const ue of ues.value) {
    const v = localNotes.value[inscriptionId]?.[ue.id]
    if (v !== '' && v !== undefined) {
      const n = parseFloat(v)
      if (!isNaN(n) && n >= 10) {
        creditsValides += parseFloat(String(ue.credits_ects)) || 0
      }
    }
  }
  if (creditsValides >= 60) return 'Admis'
  if (creditsValides >= 42) return 'Passif'
  return 'Redoublant'
}

function mention(moy: number | null): string {
  if (moy === null) return '—'
  if (moy >= 16) return 'Très Bien'
  if (moy >= 14) return 'Bien'
  if (moy >= 12) return 'Assez Bien'
  if (moy >= 10) return 'Passable'
  return '—'
}

function decisionClass(moy: number | null, inscriptionId?: number) {
  if (moy === null) return 'bg-gray-100 text-gray-600'
  if (inscriptionId !== undefined && isLMD(inscriptionId)) {
    const d = decisionLMD(inscriptionId)
    if (d === 'Admis') return 'bg-green-100 text-green-700'
    if (d === 'Passif') return 'bg-blue-100 text-blue-700'
    return 'bg-red-100 text-red-700'
  }
  if (moy >= 10) return 'bg-green-100 text-green-700'
  if (moy >= 8) return 'bg-orange-100 text-orange-700'
  return 'bg-red-100 text-red-700'
}
function decisionLabel(moy: number | null, inscriptionId?: number) {
  if (moy === null) return 'En attente'
  if (inscriptionId !== undefined && isLMD(inscriptionId)) return decisionLMD(inscriptionId)
  if (moy >= 10) return 'Admis'
  if (moy >= 8) return 'Rattrapage'
  return 'Redoublant'
}

function inputColor(v: string) {
  const n = parseFloat(v)
  if (isNaN(n) || v === '') return ''
  if (n < 10) return 'text-red-600'
  if (n < 14) return 'text-orange-500'
  return 'text-green-700'
}

// ─── Rang de l'étudiant dans la classe ────────────────────────────────
function rangEtudiant(inscriptionId: number): number {
  const sorted = [...inscriptions.value].sort((a, b) =>
    (moyennePonderee(b.id) ?? -1) - (moyennePonderee(a.id) ?? -1)
  )
  return sorted.findIndex(i => i.id === inscriptionId) + 1
}

// ─── Stats globales classe ─────────────────────────────────────────────
const statsClasse = computed(() => {
  const list = inscriptions.value
  const avecNotes = list.filter(i => moyennePonderee(i.id) !== null)
  const admis = avecNotes.filter(i => {
    const m = moyennePonderee(i.id)!
    if (isLMD(i.id)) return decisionLMD(i.id) === 'Admis'
    return m >= 10
  })
  const mentions = {
    'Très Bien': avecNotes.filter(i => (moyennePonderee(i.id) ?? 0) >= 16).length,
    'Bien':       avecNotes.filter(i => { const m = moyennePonderee(i.id) ?? 0; return m >= 14 && m < 16 }).length,
    'Assez Bien': avecNotes.filter(i => { const m = moyennePonderee(i.id) ?? 0; return m >= 12 && m < 14 }).length,
    'Passable':   avecNotes.filter(i => { const m = moyennePonderee(i.id) ?? 0; return m >= 10 && m < 12 }).length,
    'Insuffisant': avecNotes.filter(i => (moyennePonderee(i.id) ?? 0) < 10).length,
  }
  const moyennes = avecNotes.map(i => moyennePonderee(i.id)!)
  const moyenneClasse = moyennes.length ? Math.round(moyennes.reduce((s, v) => s + v, 0) / moyennes.length * 100) / 100 : null
  const meilleure = moyennes.length ? Math.max(...moyennes) : null
  const plus_basse = moyennes.length ? Math.min(...moyennes) : null
  return {
    total: list.length,
    avec_notes: avecNotes.length,
    admis: admis.length,
    taux_reussite: avecNotes.length ? Math.round(admis.length / avecNotes.length * 100) : 0,
    moyenne_classe: moyenneClasse,
    meilleure,
    plus_basse,
    mentions,
  }
})

// ─── Export batch : tous les bulletins d'une classe ──────────────────
const exportingBatch = ref(false)

async function exportTousBulletins() {
  if (!inscriptions.value.length) return
  exportingBatch.value = true

  const bulletins: any[] = []
  try {
    for (const insc of inscriptions.value) {
      const { data } = await api.get(`/notes/bulletin/${insc.id}`)
      bulletins.push({ ...data, rang: rangEtudiant(insc.id) })
    }
  } catch { exportingBatch.value = false; return }

  function mentionFromNote(n: number | null): string {
    if (n === null || n < 10) return '—'
    if (n < 12) return 'Passable'
    if (n < 14) return 'Assez Bien'
    if (n < 16) return 'Bien'
    return 'Très Bien'
  }
  function appreciationFP(n: number | null): string {
    if (n === null) return '—'
    if (n < 10) return 'Insuffisant'
    if (n < 12) return 'Passable'
    if (n < 14) return 'Assez Bien'
    if (n < 16) return 'Bien'
    return 'Très Bien'
  }

  const pages = bulletins.map(b => {
    const etd = b.inscription?.etudiant
    const nom = `${etd?.prenom ?? ''} ${etd?.nom ?? ''}`.trim()
    const filiere = b.inscription?.classe?.filiere?.nom ?? b.inscription?.filiere?.nom ?? '—'
    const annee = b.inscription?.annee_academique?.libelle ?? '—'
    const niveau = b.inscription?.niveau_entree?.nom ?? '—'
    const classe = b.inscription?.classe?.nom ?? '—'
    const numEtd = b.inscription?.numero_etudiant ?? etd?.numero_etudiant ?? '—'
    const rangStr = b.rang <= 3
      ? ['1er','2ème','3ème'][b.rang - 1] + ` / ${inscriptions.value.length}`
      : `${b.rang}ème / ${inscriptions.value.length}`

    if (b.est_lmd) {
      // ─── LMD : Format Enseignement Supérieur ──────────────────────────
      const semestres: any[] = b.semestres ?? []
      const allUes: any[] = b.ues ?? []
      const semGroups: Record<number, any[]> = {}
      if (semestres.length === 0) {
        allUes.forEach((ue: any) => {
          const s = ue.semestre ?? 1
          if (!semGroups[s]) semGroups[s] = []
          semGroups[s].push(ue)
        })
      }
      const sems = semestres.length > 0 ? semestres : Object.keys(semGroups).sort().map(k => ({
        numero: Number(k), ues: semGroups[Number(k)], moyenne: null, credits_valides: null, credits_total: null,
      }))

      const semSections = sems.map((sem: any) => {
        const ueRows = (sem.ues ?? []).map((ue: any) => {
          const noteStr = ue.note !== null ? Number(ue.note).toFixed(2) : '—'
          const session = ue.session_label ?? '1ère'
          const credits = ue.credits_ects ?? ue.credits ?? '—'
          return `<tr>
            <td style="padding:3px 5px;border:1px solid #bbb;font-size:9px;">${ue.code} : ${ue.intitule}</td>
            <td style="padding:3px 5px;border:1px solid #bbb;text-align:center;font-size:9px;">${credits}</td>
            <td style="padding:3px 5px;border:1px solid #bbb;text-align:center;font-size:9px;font-weight:bold;color:${(ue.note ?? 0) >= 10 ? '#006400' : '#c00'};">${noteStr}</td>
            <td style="padding:3px 5px;border:1px solid #bbb;text-align:center;font-size:9px;">${session}</td>
            <td style="padding:3px 5px;border:1px solid #bbb;text-align:center;font-size:9px;">${mentionFromNote(ue.note)}</td>
          </tr>`
        }).join('')
        const moyS = sem.moyenne !== null ? Number(sem.moyenne).toFixed(2) : '—'
        const credV = sem.credits_valides ?? (sem.ues ?? []).filter((u: any) => u.valide).reduce((s: number, u: any) => s + (u.credits_ects ?? u.credits ?? 0), 0)
        const credT = sem.credits_total ?? (sem.ues ?? []).reduce((s: number, u: any) => s + (u.credits_ects ?? u.credits ?? 0), 0)
        return `
        <div style="margin-bottom:10px;">
          <div style="background:#1a3a6b;color:#fff;padding:4px 8px;font-size:10px;font-weight:bold;font-family:'Times New Roman',serif;">SEMESTRE ${sem.numero}</div>
          <table style="width:100%;border-collapse:collapse;font-family:'Times New Roman',serif;">
            <thead><tr style="background:#e8e8e8;">
              <th style="padding:4px 5px;border:1px solid #bbb;text-align:left;font-size:9px;">UE (Code : Intitulé)</th>
              <th style="padding:4px 5px;border:1px solid #bbb;text-align:center;font-size:9px;width:55px;">Crédits UE</th>
              <th style="padding:4px 5px;border:1px solid #bbb;text-align:center;font-size:9px;width:65px;">Moyenne UE</th>
              <th style="padding:4px 5px;border:1px solid #bbb;text-align:center;font-size:9px;width:55px;">Session</th>
              <th style="padding:4px 5px;border:1px solid #bbb;text-align:center;font-size:9px;width:75px;">Mention</th>
            </tr></thead>
            <tbody>${ueRows}</tbody>
          </table>
          <table style="width:100%;border-collapse:collapse;font-family:'Times New Roman',serif;">
            <tr style="background:#f5f5f5;">
              <td style="padding:3px 7px;border:1px solid #bbb;border-top:2px solid #333;font-size:9px;font-weight:bold;width:40%;">Crédits validés : ${credV} / ${credT}</td>
              <td style="padding:3px 7px;border:1px solid #bbb;border-top:2px solid #333;font-size:9px;font-weight:bold;width:35%;">Moyenne : ${moyS} / 20</td>
              <td style="padding:3px 7px;border:1px solid #bbb;border-top:2px solid #333;font-size:9px;width:25%;">Observations :</td>
            </tr>
          </table>
        </div>`
      }).join('')

      let recap = ''
      if (sems.length >= 2) {
        const moyAnn = b.moyenne !== null ? Number(b.moyenne).toFixed(2) : '—'
        const mentAnn = b.mention ?? '—'
        const decText = b.decision === 'admis' ? 'ADMIS(E)' : b.decision === 'passif' ? 'PASSIF(VE)' : b.decision === 'rattrapage' ? 'ADMIS(E) EN RATTRAPAGE' : b.decision === 'redoublant' ? 'REDOUBLANT(E)' : '—'
        const decColor = (b.moyenne ?? 0) >= 10 ? '#006400' : '#c00'
        recap = `
        <table style="width:100%;border-collapse:collapse;font-family:'Times New Roman',serif;margin-top:6px;">
          <tr style="background:#1a3a6b;color:#fff;">
            <th colspan="3" style="padding:4px 8px;font-size:10px;text-align:left;">RÉSULTAT ANNUEL</th>
          </tr>
          <tr>
            <td style="padding:5px 7px;border:1px solid #bbb;font-size:9px;font-weight:bold;">Moyenne : <span style="color:${decColor};">${moyAnn} / 20</span></td>
            <td style="padding:5px 7px;border:1px solid #bbb;font-size:9px;font-weight:bold;">Mention : ${mentAnn}</td>
            <td style="padding:5px 7px;border:1px solid #bbb;font-size:9px;font-weight:bold;">Crédits : ${b.credits_valides} / ${b.credits_total}</td>
          </tr>
          <tr>
            <td colspan="3" style="padding:5px 7px;border:1px solid #bbb;font-size:10px;font-weight:bold;color:${decColor};">Décision : ${decText}</td>
          </tr>
        </table>`
      }

      return `
      <div style="page-break-after:always;font-family:'Times New Roman',serif;font-size:11px;color:#111;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #1a3a6b;">
          <div>
            <div style="font-size:12px;font-weight:bold;color:#1a3a6b;">UPTECH CAMPUS</div>
            <div style="font-size:9px;color:#555;">Institut de Formation Supérieure · Dakar</div>
          </div>
          <div style="text-align:center;">
            <div style="font-size:13px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;">Relevé de Notes</div>
            <div style="font-size:9px;font-style:italic;color:#555;">Année Académique : ${annee}</div>
          </div>
          <div style="text-align:right;font-size:9px;color:#555;">
            <div>Filière : <strong>${filiere}</strong></div>
            <div>Niveau : <strong>${niveau}</strong></div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:10px;">
          <tr style="background:#f0f0f0;">
            <td style="padding:4px 7px;font-weight:bold;width:20%;">Nom &amp; Prénom :</td>
            <td style="padding:4px 7px;font-size:11px;font-weight:bold;width:30%;">${nom}</td>
            <td style="padding:4px 7px;font-weight:bold;width:20%;">N° Étudiant :</td>
            <td style="padding:4px 7px;font-family:monospace;color:#c00;font-weight:bold;">${numEtd}</td>
          </tr>
          <tr>
            <td style="padding:4px 7px;font-weight:bold;">Classe :</td>
            <td style="padding:4px 7px;">${classe}</td>
            <td style="padding:4px 7px;font-weight:bold;">Rang :</td>
            <td style="padding:4px 7px;">${rangStr}</td>
          </tr>
        </table>
        ${semSections}
        ${recap}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:16px;">
          <div style="text-align:center;"><div style="border-top:1px solid #333;padding-top:6px;font-size:9px;">Le Directeur Pédagogique</div></div>
          <div style="text-align:center;"><div style="border-top:1px solid #333;padding-top:6px;font-size:9px;">Le Directeur Général</div></div>
          <div style="text-align:center;"><div style="border-top:1px solid #333;padding-top:6px;font-size:9px;">Cachet de l'établissement</div></div>
        </div>
      </div>`
    } else {
      // ─── Formation Professionnelle ──────────────────────────────────
      const allUes: any[] = b.ues ?? []
      const moyColor = (b.moyenne ?? 0) >= 10 ? '#16a34a' : '#E30613'
      const moyStr = b.moyenne !== null ? Number(b.moyenne).toFixed(2) : '—'
      const mention = b.mention ?? '—'
      const decText = b.decision === 'admis' ? '✓ Acquis' : b.decision === 'redoublant' ? '✗ À renforcer' : b.decision === 'rattrapage' ? '↻ Rattrapage' : '⏳ En attente'
      const decColor = b.decision === 'admis' ? '#16a34a' : b.decision === 'redoublant' ? '#E30613' : '#c2410c'

      const ueRows = allUes.map((ue: any) => {
        const nc = (ue.note ?? 0) >= 10 ? '#16a34a' : '#E30613'
        const resColor = ue.valide ? '#16a34a' : ue.note !== null ? '#E30613' : '#999'
        return `<tr>
          <td style="padding:4px 7px;border-bottom:1px solid #f0f0f0;font-size:10px;">${ue.code} — ${ue.intitule}</td>
          <td style="padding:4px 7px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:10px;color:#555;">${ue.coefficient ?? ue.coef_effectif ?? '—'}</td>
          <td style="padding:4px 7px;border-bottom:1px solid #f0f0f0;text-align:center;font-weight:bold;font-size:11px;color:${nc};">${ue.note !== null ? ue.note : '—'}</td>
          <td style="padding:4px 7px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:9px;color:#555;">${appreciationFP(ue.note)}</td>
          <td style="padding:4px 7px;border-bottom:1px solid #f0f0f0;text-align:center;font-size:9px;font-weight:bold;color:${resColor};">${ue.note !== null ? (ue.valide ? 'Acquis' : 'À renforcer') : '—'}</td>
        </tr>`
      }).join('')

      return `
      <div style="page-break-after:always;font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;">
        <div style="background:linear-gradient(135deg,#E30613 0%,#b91c1c 100%);color:#fff;padding:14px 18px;border-radius:8px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:9px;font-weight:600;letter-spacing:2px;text-transform:uppercase;opacity:.7;margin-bottom:2px;">Uptech Campus</div>
            <div style="font-size:18px;font-weight:800;">Bulletin de Notes</div>
            <div style="font-size:10px;opacity:.8;margin-top:2px;">Formation Professionnelle · ${annee}</div>
          </div>
          <div style="text-align:right;font-size:9px;opacity:.8;line-height:1.7;">
            <div>Filière : <strong style="opacity:1;">${filiere}</strong></div>
            <div>Rang : <strong style="opacity:1;">${rangStr}</strong></div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;background:#f8fafc;margin-bottom:10px;font-size:10px;">
          <tr>
            <td style="padding:7px 12px;width:25%;color:#64748b;font-weight:600;">Étudiant</td>
            <td style="padding:7px 12px;font-weight:700;font-size:12px;">${nom}</td>
            <td style="padding:7px 12px;width:25%;color:#64748b;font-weight:600;">N° Étudiant</td>
            <td style="padding:7px 12px;font-family:monospace;color:#E30613;font-weight:700;">${numEtd}</td>
          </tr>
          <tr style="background:#f1f5f9;">
            <td style="padding:5px 12px;color:#64748b;font-weight:600;">Filière</td>
            <td style="padding:5px 12px;">${filiere}</td>
            <td style="padding:5px 12px;color:#64748b;font-weight:600;">Classe</td>
            <td style="padding:5px 12px;">${classe}</td>
          </tr>
        </table>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
          <div style="background:#fff;border:1.5px solid #e5e7eb;border-top:3px solid ${moyColor};border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:20px;font-weight:800;color:${moyColor};">${moyStr}</div>
            <div style="font-size:9px;color:#888;margin-top:2px;text-transform:uppercase;">Moyenne</div>
          </div>
          <div style="background:#fff;border:1.5px solid #e5e7eb;border-top:3px solid #8b5cf6;border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:16px;font-weight:800;color:#6d28d9;">${mention}</div>
            <div style="font-size:9px;color:#888;margin-top:2px;text-transform:uppercase;">Appréciation</div>
          </div>
          <div style="background:#fff;border:1.5px solid #e5e7eb;border-top:3px solid ${decColor};border-radius:6px;padding:8px;text-align:center;">
            <div style="font-size:14px;font-weight:800;color:${decColor};">${decText}</div>
            <div style="font-size:9px;color:#888;margin-top:2px;text-transform:uppercase;">Résultat</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:10px;">
          <thead><tr style="background:#1a1a2e;color:#fff;">
            <th style="padding:6px;text-align:left;font-size:9px;">Module / Matière</th>
            <th style="padding:6px;text-align:center;font-size:9px;width:50px;">Coef.</th>
            <th style="padding:6px;text-align:center;font-size:9px;width:60px;">Note /20</th>
            <th style="padding:6px;text-align:center;font-size:9px;width:80px;">Appréciation</th>
            <th style="padding:6px;text-align:center;font-size:9px;width:80px;">Résultat</th>
          </tr></thead>
          <tbody>${ueRows}</tbody>
        </table>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px;">
          <div style="text-align:center;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:9px;color:#888;">Le Directeur Pédagogique</div></div>
          <div style="text-align:center;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:9px;color:#888;">Le Directeur Général</div></div>
          <div style="text-align:center;"><div style="border-top:1px solid #ccc;padding-top:6px;font-size:9px;color:#888;">Cachet de l'établissement</div></div>
        </div>
      </div>`
    }
  }).join('\n')

  const nomClasse = classes.value.find(c => String(c.id) === filterClasse.value)?.nom ?? 'Classe'
  const html = `<!DOCTYPE html><html lang="fr"><head>
    <meta charset="UTF-8">
    <title>Bulletins — ${nomClasse}</title>
    <style>
      @page { size: A4; margin: 12mm 14mm 14mm 14mm; }
      body { margin:0; padding:0; color:#111; }
      * { box-sizing:border-box; }
      @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } }
    </style>
  </head><body>${pages}</body></html>`

  const pw = window.open('', '_blank', 'width=900,height=800')
  if (!pw) { exportingBatch.value = false; return }
  pw.document.write(html)
  pw.document.close()
  pw.focus()
  setTimeout(() => { pw.print(); exportingBatch.value = false }, 500)
}

async function loadNotes() {
  if (!filterClasse.value) return
  loading.value = true
  try {
    const { data } = await api.get('/notes', {
      params: { classe_id: filterClasse.value, session: filterSession.value }
    })
    ues.value = data.ues
    inscriptions.value = data.inscriptions
    notesData.value = data.notes
    filierePivots.value = data.filiere_pivots ?? {}

    // Initialiser localNotes + controles + examens
    localNotes.value = {}
    localControles.value = {}
    localExamens.value = {}
    inscriptions.value.forEach(i => {
      const noteMap: Record<number, string> = {}
      const controleMap: Record<number, string> = {}
      const examenMap: Record<number, string> = {}
      ues.value.forEach(ue => { noteMap[ue.id] = ''; controleMap[ue.id] = ''; examenMap[ue.id] = '' })
      localNotes.value[i.id] = noteMap
      localControles.value[i.id] = controleMap
      localExamens.value[i.id] = examenMap
    })
    notesData.value.forEach((n: any) => {
      const noteMap = localNotes.value[n.inscription_id]
      if (noteMap) noteMap[n.ue_id] = String(n.note)
      const cm = localControles.value[n.inscription_id]
      if (cm && n.note_controle != null) cm[n.ue_id] = String(n.note_controle)
      const em = localExamens.value[n.inscription_id]
      if (em && n.note_examen != null) em[n.ue_id] = String(n.note_examen)
    })
  } finally {
    loading.value = false
  }
}

watch([filterClasse, filterSession], loadNotes)

async function enregistrerNotes() {
  saving.value = true
  saved.value = false
  try {
    const payload: any[] = []
    inscriptions.value.forEach(i => {
      ues.value.forEach(ue => {
        if (classeEstFP.value) {
          // Mode FP : on envoie contrôle + examen (la note finale est calculée côté API)
          const vc = localControles.value[i.id]?.[ue.id]
          const ve = localExamens.value[i.id]?.[ue.id]
          const nc = vc !== '' && vc !== undefined ? parseFloat(vc) : null
          const ne = ve !== '' && ve !== undefined ? parseFloat(ve) : null
          if (nc !== null || ne !== null) {
            payload.push({ inscription_id: i.id, ue_id: ue.id, note_controle: isNaN(nc!) ? null : nc, note_examen: isNaN(ne!) ? null : ne, session: filterSession.value })
          }
        } else {
          // Mode LMD : note unique
          const v = localNotes.value[i.id]?.[ue.id]
          if (v !== '' && v !== undefined) {
            const n = parseFloat(v)
            if (!isNaN(n)) payload.push({ inscription_id: i.id, ue_id: ue.id, note: n, session: filterSession.value })
          }
        }
      })
    })
    if (payload.length) await api.post('/notes/batch', { notes: payload })
    saved.value = true
    setTimeout(() => { saved.value = false }, 3000)
  } finally {
    saving.value = false
  }
}

// ─── UE CRUD ──────────────────────────────────────────────────────────
const showUeModal = ref(false)
const editUeId = ref<number | null>(null)
const ueForm = ref({ code: '', intitule: '', coefficient: '1', credits_ects: '0', ordre: '0', enseignant_id: '', semestre: '1', categorie_ue: '', intitule_ue: '' })
const enseignants = ref<{ id: number; nom: string; prenom: string }[]>([])
const savingUe = ref(false)

// Détection de doublons (même intitulé)
const ecsDoublons = computed(() => {
  const map: Record<string, UE[]> = {}
  for (const ue of ues.value) {
    const key = ue.intitule.toLowerCase().trim()
    if (!map[key]) map[key] = []
    map[key].push(ue)
  }
  return Object.values(map).filter(g => g.length > 1)
})
const hasDoublons = computed(() => ecsDoublons.value.length > 0)

async function nettoyerDoublons() {
  if (!confirm('Supprimer les doublons automatiquement ?\n\nRègle : si un EC appartient à un groupe UE et son doublon est sans groupe, le sans-groupe est supprimé.')) return
  const toDelete: UE[] = []
  for (const groupe of ecsDoublons.value) {
    const avecGroupe = groupe.filter(u => (u as any).categorie_ue)
    const sansGroupe = groupe.filter(u => !(u as any).categorie_ue)
    if (avecGroupe.length > 0 && sansGroupe.length > 0) toDelete.push(...sansGroupe)
  }
  if (!toDelete.length) { alert('Aucun doublon automatiquement résolvable. Supprimez manuellement.'); return }
  for (const ue of toDelete) await api.delete(`/ues/${ue.id}`)
  await loadNotes()
}

// Groupes UE dérivés des ECs existants
const ueGroupes = computed(() => {
  const groups: Record<string, { code: string; intitule: string; ecs: UE[] }> = {}
  for (const ue of ues.value) {
    const key = (ue as any).categorie_ue
    if (key) {
      if (!groups[key]) groups[key] = { code: key, intitule: (ue as any).intitule_ue ?? key, ecs: [] }
      groups[key].ecs.push(ue)
    }
  }
  return Object.values(groups)
})

// Niveau de la classe sélectionnée → plage de semestres
const classeNiveauActuel = computed<number>(() => {
  const c = classes.value.find((cl: any) => String(cl.id) === filterClasse.value) as any
  return c?.niveau || 1
})
const classeSemestres = computed<number[]>(() => {
  const n = classeNiveauActuel.value
  return [n * 2 - 1, n * 2]   // niveau 2 → [3, 4]
})

// Gestion des groupes UE
const showGroupForm = ref(false)
const editingGroupCode = ref<string | null>(null) // null = nouveau groupe
const groupForm = ref({ code: '', intitule: '', semestre: '1', ec_ids: [] as number[] })
const savingGroup = ref(false)

function openGroupeCreate() {
  editingGroupCode.value = null
  groupForm.value = { code: '', intitule: '', semestre: String(classeSemestres.value[0] ?? 1), ec_ids: [] }
  showGroupForm.value = true
}
function openGroupeEdit(g: { code: string; intitule: string; ecs: UE[] }) {
  editingGroupCode.value = g.code
  const sem = g.ecs[0] ? String((g.ecs[0] as any).semestre ?? 1) : '1'
  groupForm.value = { code: g.code, intitule: g.intitule, semestre: sem, ec_ids: g.ecs.map(e => e.id) }
  showGroupForm.value = true
}
function toggleEcInGroup(ecId: number) {
  const idx = groupForm.value.ec_ids.indexOf(ecId)
  if (idx === -1) groupForm.value.ec_ids.push(ecId)
  else groupForm.value.ec_ids.splice(idx, 1)
}
async function saveGroupeUE() {
  if (!groupForm.value.code.trim() || !groupForm.value.intitule.trim()) return
  savingGroup.value = true
  try {
    const code = groupForm.value.code.trim()
    const intitule = groupForm.value.intitule.trim()
    // ECs sélectionnées → assigner à ce groupe
    for (const ue of ues.value) {
      const wasInGroup = (ue as any).categorie_ue === (editingGroupCode.value ?? code)
      const isSelected = groupForm.value.ec_ids.includes(ue.id)
      if (isSelected) {
        await api.put(`/ues/${ue.id}`, {
          classe_id: Number(filterClasse.value), code: ue.code, intitule: ue.intitule,
          coefficient: ue.coefficient, credits_ects: ue.credits_ects, ordre: ue.ordre,
          enseignant_id: ue.enseignant_id ?? null,
          semestre: parseInt(groupForm.value.semestre) || 1,
          categorie_ue: code, intitule_ue: intitule,
        })
      } else if (wasInGroup) {
        // EC retirée du groupe → effacer le groupement
        await api.put(`/ues/${ue.id}`, {
          classe_id: Number(filterClasse.value), code: ue.code, intitule: ue.intitule,
          coefficient: ue.coefficient, credits_ects: ue.credits_ects, ordre: ue.ordre,
          enseignant_id: ue.enseignant_id ?? null,
          semestre: (ue as any).semestre ?? 1,
          categorie_ue: null, intitule_ue: null,
        })
      }
    }
    showGroupForm.value = false
    await loadNotes()
  } finally { savingGroup.value = false }
}
async function deleteGroupeUE(code: string) {
  if (!confirm(`Dissoudre le groupe "${code}" ? Les ECs seront sans groupe.`)) return
  for (const ue of ues.value.filter(u => (u as any).categorie_ue === code)) {
    await api.put(`/ues/${ue.id}`, {
      classe_id: Number(filterClasse.value), code: ue.code, intitule: ue.intitule,
      coefficient: ue.coefficient, credits_ects: ue.credits_ects, ordre: ue.ordre,
      enseignant_id: ue.enseignant_id ?? null, semestre: (ue as any).semestre ?? 1,
      categorie_ue: null, intitule_ue: null,
    })
  }
  await loadNotes()
}

async function openUeCreate() {
  editUeId.value = null
  ueForm.value = { code: '', intitule: '', coefficient: '1', credits_ects: '0', ordre: String(ues.value.length), enseignant_id: '', semestre: String(classeSemestres.value[0] ?? 1), categorie_ue: '', intitule_ue: '' }
  showUeModal.value = true
}
async function openUeEdit(ue: UE) {
  editUeId.value = ue.id
  ueForm.value = { code: ue.code, intitule: ue.intitule, coefficient: String(ue.coefficient), credits_ects: String(ue.credits_ects), ordre: String(ue.ordre), enseignant_id: String(ue.enseignant_id ?? ''), semestre: String((ue as any).semestre ?? 1), categorie_ue: (ue as any).categorie_ue ?? '', intitule_ue: (ue as any).intitule_ue ?? '' }
  showUeModal.value = true
}
async function saveUe() {
  savingUe.value = true
  try {
    const g = ueGroupes.value.find(g => g.code === ueForm.value.categorie_ue)
    const payload = {
      classe_id: Number(filterClasse.value),
      code: ueForm.value.code, intitule: ueForm.value.intitule,
      coefficient: parseFloat(ueForm.value.coefficient),
      credits_ects: parseFloat(ueForm.value.credits_ects),
      ordre: parseInt(ueForm.value.ordre),
      enseignant_id: ueForm.value.enseignant_id ? Number(ueForm.value.enseignant_id) : null,
      semestre: parseInt(ueForm.value.semestre) || 1,
      categorie_ue: ueForm.value.categorie_ue || null,
      intitule_ue: (g?.intitule ?? ueForm.value.intitule_ue) || null,
    }
    if (editUeId.value) await api.put(`/ues/${editUeId.value}`, payload)
    else await api.post('/ues', payload)
    showUeModal.value = false
    await loadNotes()
  } finally { savingUe.value = false }
}
async function deleteUe(ue: UE) {
  if (!confirm(`Supprimer l'EC "${ue.intitule}" ?`)) return
  await api.delete(`/ues/${ue.id}`)
  await loadNotes()
}

// ─── BULLETIN ─────────────────────────────────────────────────────────
const showBulletin = ref(false)
const bulletin = ref<Bulletin | null>(null)
const loadingBulletin = ref(false)

async function voirBulletin(insc: Inscription) {
  loadingBulletin.value = true
  showBulletin.value = true
  try {
    const { data } = await api.get(`/notes/bulletin/${insc.id}`)
    bulletin.value = data
  } finally { loadingBulletin.value = false }
}

async function exportBulletinPdf() {
  const b = bulletin.value
  if (!b) return

  const etd = b.inscription?.etudiant
  const nom = `${etd?.prenom ?? ''} ${etd?.nom ?? ''}`.toUpperCase().trim()
  const filiere = b.inscription?.classe?.filiere?.nom ?? b.inscription?.filiere?.nom ?? '—'
  const annee = b.inscription?.annee_academique?.libelle ?? '—'
  const niveau = b.inscription?.niveau_entree?.nom ?? '—'
  const classe = b.inscription?.classe?.nom ?? '—'
  const numEtd = b.inscription?.numero_etudiant ?? etd?.numero_etudiant ?? '—'
  const rang = rangEtudiant(b.inscription?.id ?? 0)
  const rangStr = rang <= 3
    ? ['1er','2eme','3eme'][rang - 1] + ` / ${inscriptions.value.length}`
    : `${rang}eme / ${inscriptions.value.length}`
  // Date et lieu de naissance
  const dateNaiss = etd?.date_naissance
    ? new Date(etd.date_naissance).toLocaleDateString('fr-FR') : '—'
  const lieuNaiss = etd?.lieu_naissance ?? '—'

  function mentionFromNote(n: number | null): string {
    if (n === null || n < 10) return '—'
    if (n < 12) return 'Passable'
    if (n < 14) return 'Assez Bien'
    if (n < 16) return 'Bien'
    return 'Tres Bien'
  }
  function appreciationFP(n: number | null): string {
    if (n === null) return '—'
    if (n < 10) return 'Insuffisant'
    if (n < 12) return 'Passable'
    if (n < 14) return 'Assez Bien'
    if (n < 16) return 'Bien'
    return 'Tres Bien'
  }

  // ─── LMD : jsPDF natif style UGB ─────────────────────────────────────
  if (b.est_lmd) {
    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const PW = doc.internal.pageSize.getWidth()
    const mL = 14, mR = 14
    const cW = PW - mL - mR
    let y = 10

    // ── Chargement logo ─────────────────────────────────────────────────
    let logoDataUrl: string | null = null
    try {
      const resp = await fetch('/logo-normal.png')
      if (resp.ok) {
        const blob = await resp.blob()
        logoDataUrl = await new Promise<string>((res) => {
          const reader = new FileReader()
          reader.onload = () => res(reader.result as string)
          reader.readAsDataURL(blob)
        })
      }
    } catch { logoDataUrl = null }

    // ── En-tête style UGB ───────────────────────────────────────────────
    // Colonne gauche : République / Ministère
    doc.setFontSize(8); doc.setFont('times', 'bold')
    doc.text('REPUBLIQUE DU SENEGAL', mL, y)
    doc.setFont('times', 'italic'); doc.setFontSize(7.5)
    doc.text('Un Peuple - Un But - Une Foi', mL, y + 4)
    doc.setFont('times', 'normal'); doc.setFontSize(7)
    doc.text('Ministere de l\'Enseignement Superieur,', mL, y + 8.5)
    doc.text('de la Recherche et de l\'Innovation', mL, y + 12)

    // Colonne centre : Logo + Nom officiel de l'établissement
    const cx = PW / 2
    const institNom1 = 'Institut Superieur de Formation aux'
    const institNom2 = 'Nouveaux Metiers de l\'Informatique'
    const institNom3 = 'et de la Communication'
    let logoOk = false
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', cx - 20, y, 40, 13); logoOk = true } catch { logoOk = false }
    }
    if (logoOk) {
      doc.setFontSize(7.5); doc.setFont('times', 'normal')
      doc.text(institNom1, cx, y + 17, { align: 'center' })
      doc.text(institNom2, cx, y + 21, { align: 'center' })
      doc.text(institNom3, cx, y + 25, { align: 'center' })
    } else {
      doc.setFontSize(12); doc.setFont('times', 'bold')
      doc.text('UPTECH CAMPUS', cx, y + 5, { align: 'center' })
      doc.setFontSize(7.5); doc.setFont('times', 'normal')
      doc.text(institNom1, cx, y + 10, { align: 'center' })
      doc.text(institNom2, cx, y + 14, { align: 'center' })
      doc.text(institNom3, cx, y + 18, { align: 'center' })
    }

    // Colonne droite : Filière + Année académique
    doc.setFontSize(8); doc.setFont('times', 'normal')
    doc.text('Filiere :', PW - mR, y, { align: 'right' })
    doc.setFont('times', 'bold')
    doc.text(filiere, PW - mR, y + 4, { align: 'right' })
    doc.setFont('times', 'normal')
    doc.text('Annee Academique :', PW - mR, y + 9, { align: 'right' })
    doc.setFont('times', 'bold')
    doc.text(annee, PW - mR, y + 13, { align: 'right' })

    y += logoDataUrl ? 30 : 22

    // ── Titre RELEVÉ DE NOTES — avec marge suffisante ──────────────────
    y += 4
    doc.setFontSize(15); doc.setFont('times', 'bold')
    doc.text('RELEVE DE NOTES', PW / 2, y, { align: 'center' })
    y += 5
    doc.setFontSize(9); doc.setFont('times', 'normal')
    doc.text('Annee Academique : ' + annee, PW / 2, y, { align: 'center' })
    y += 2
    // Soulignement titre
    doc.setLineWidth(0.5); doc.setDrawColor(0)
    const titreW = doc.getTextWidth('RELEVE DE NOTES')
    doc.line(PW / 2 - titreW / 2, y, PW / 2 + titreW / 2, y)
    y += 6

    // ── Fiche identité étudiant (Nom, Matricule, Naissance, Filière, Année)
    autoTable(doc, {
      startY: y, margin: { left: mL, right: mR },
      body: [
        [
          { content: 'Nom & Prenom :', styles: { fontStyle: 'bold', cellWidth: 30, fontSize: 8 } },
          { content: nom, styles: { fontStyle: 'bold', fontSize: 9 } },
          { content: 'N° Matricule :', styles: { fontStyle: 'bold', cellWidth: 28, fontSize: 8 } },
          { content: numEtd, styles: { fontStyle: 'bold', fontSize: 8.5 } },
        ],
        [
          { content: 'Ne(e) le :', styles: { fontStyle: 'bold', fontSize: 8 } },
          { content: dateNaiss, styles: { fontSize: 8 } },
          { content: 'Lieu de naissance :', styles: { fontStyle: 'bold', fontSize: 8 } },
          { content: lieuNaiss, styles: { fontSize: 8 } },
        ],
        [
          { content: 'Filiere :', styles: { fontStyle: 'bold', fontSize: 8 } },
          { content: filiere, styles: { fontSize: 8 } },
          { content: 'Niveau d\'etudes :', styles: { fontStyle: 'bold', fontSize: 8 } },
          { content: '1ere Annee / L1', styles: { fontStyle: 'bold', fontSize: 8 } },
        ],
      ],
      theme: 'grid',
      styles: { font: 'times', cellPadding: 2.5, textColor: [0,0,0], fillColor: [255,255,255] },
    })
    y = (doc as any).lastAutoTable.finalY + 6

    // ── Semestres ───────────────────────────────────────────────────────
    const allUes: any[] = b.ues ?? []
    const semestres: any[] = b.semestres ?? []
    const semGroups: Record<number, any[]> = {}
    if (semestres.length === 0) {
      allUes.forEach((ue: any) => {
        const s = ue.semestre ?? 1
        if (!semGroups[s]) semGroups[s] = []
        semGroups[s].push(ue)
      })
    }
    let sems = semestres.length > 0 ? semestres : Object.keys(semGroups).sort().map(k => ({
      numero: Number(k), ues: semGroups[Number(k)], moyenne: null, credits_valides: null, credits_total: null,
    }))

    // Filtre par semestre sélectionné
    if (bulletinSemestre.value !== null) {
      sems = sems.filter(s => s.numero === bulletinSemestre.value)
    }

    for (const sem of sems) {
      // Header semestre — rouge Uptech, texte centré
      doc.setFillColor(227, 6, 19)
      doc.rect(mL, y, cW, 6, 'F')
      doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont('times', 'bold')
      doc.text('SEMESTRE ' + sem.numero, mL + cW / 2, y + 4.2, { align: 'center' })
      doc.setTextColor(0, 0, 0)
      y += 6

      // Tableau UE → EC (style UGB : noir/blanc, rowSpan, bordures complètes)
      const bodyRows: any[][] = []
      const W: [number,number,number] = [255,255,255]
      const BK: [number,number,number] = [0,0,0]

      const groupes: any[] = sem.groupes_ue ?? []
      const standalone: any[] = sem.ecs_standalone ?? (sem.has_groupes === false ? (sem.ues ?? []) : [])

      if (groupes.length > 0) {
        for (const ue of groupes) {
          const ueEcs: any[] = ue.ecs ?? []
          const nbEcs = ueEcs.length
          const moyUE = ue.moyenne_ue !== null ? Number(ue.moyenne_ue).toFixed(2) : '—'
          // Mention sans symbole unicode (non supporté Times PDF)
          const mentionPDF = ue.valide ? (ue.mention_ue ?? 'Passable') : (ue.mention_ue && ue.mention_ue !== '—' ? ue.mention_ue : 'Non valide')

          ueEcs.forEach((ec: any, ecIdx: number) => {
            if (ecIdx === 0) {
              bodyRows.push([
                // UE code + intitulé : gras, rowSpan
                { content: ue.code + '\n' + ue.intitule, rowSpan: nbEcs, styles: { valign: 'middle', halign: 'left', fillColor: W, fontStyle: 'bold', fontSize: 8.5, textColor: BK } },
                // EC intitulé : normal
                { content: ec.code + ' : ' + ec.intitule, styles: { fillColor: W, fontSize: 7.5, textColor: BK } },
                // Crédits UE : gras, rowSpan
                { content: String(ue.credits_ue ?? ''), rowSpan: nbEcs, styles: { valign: 'middle', halign: 'center', fillColor: W, fontStyle: 'bold', fontSize: 8.5, textColor: BK } },
                // Moy UE : gras, rowSpan
                { content: moyUE, rowSpan: nbEcs, styles: { valign: 'middle', halign: 'center', fillColor: W, fontStyle: 'bold', fontSize: 8.5, textColor: BK } },
                // Session UE : normal, rowSpan
                { content: ue.session_ue ?? '1ere', rowSpan: nbEcs, styles: { valign: 'middle', halign: 'center', fillColor: W, fontSize: 7.5, textColor: BK } },
                // Mention UE : gras, rowSpan, sans unicode
                { content: mentionPDF, rowSpan: nbEcs, styles: { valign: 'middle', halign: 'center', fillColor: W, fontStyle: 'bold', fontSize: 7.5, textColor: BK } },
              ])
            } else {
              // Lignes EC suivantes : seulement intitulé EC
              bodyRows.push([
                { content: ec.code + ' : ' + ec.intitule, styles: { fillColor: W, fontSize: 7.5, textColor: BK } },
              ])
            }
          })
        }
        // ECs sans UE
        for (const ec of standalone) {
          bodyRows.push([
            { content: '—', styles: { halign: 'center', fillColor: W, textColor: BK } },
            { content: ec.code + ' : ' + ec.intitule, styles: { fillColor: W, fontSize: 7.5, textColor: BK } },
            { content: String(ec.credits ?? ec.credits_ects ?? '—'), styles: { halign: 'center', fillColor: W, fontStyle: 'bold', textColor: BK } },
            { content: ec.note !== null ? Number(ec.note).toFixed(2) : '—', styles: { halign: 'center', fillColor: W, fontStyle: 'bold', textColor: BK } },
            { content: ec.session_label ?? '1ere', styles: { halign: 'center', fillColor: W, fontSize: 7.5, textColor: BK } },
            { content: mentionFromNote(ec.note), styles: { halign: 'center', fillColor: W, fontStyle: 'bold', fontSize: 7.5, textColor: BK } },
          ])
        }
      } else {
        // Pas de groupes → liste plate
        for (const ec of (sem.ues ?? [])) {
          bodyRows.push([
            '',
            { content: ec.code + ' : ' + ec.intitule, styles: { fillColor: W, fontSize: 7.5, textColor: BK } },
            { content: String(ec.credits ?? ec.credits_ects ?? '—'), styles: { halign: 'center', fillColor: W, fontStyle: 'bold', textColor: BK } },
            { content: ec.note !== null ? Number(ec.note).toFixed(2) : '—', styles: { halign: 'center', fillColor: W, fontStyle: 'bold', textColor: BK } },
            { content: ec.session_label ?? '1ere', styles: { halign: 'center', fillColor: W, fontSize: 7.5, textColor: BK } },
            { content: mentionFromNote(ec.note), styles: { halign: 'center', fillColor: W, fontSize: 7.5, textColor: BK } },
          ])
        }
      }

      autoTable(doc, {
        startY: y, margin: { left: mL, right: mR },
        head: [['Unite d\'Enseignement', 'Elements Constitutifs', 'Credits', 'Moyenne', 'Session', 'Mention']],
        body: bodyRows,
        theme: 'grid',
        headStyles: { fillColor: [0,0,0], textColor: [255,255,255], fontStyle: 'bold', fontSize: 8, font: 'times', halign: 'center' },
        bodyStyles: { fontSize: 8, font: 'times', fillColor: W, textColor: BK },
        columnStyles: {
          0: { cellWidth: 32 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 16, halign: 'center' },
          3: { cellWidth: 20, halign: 'center' },
          4: { cellWidth: 16, halign: 'center' },
          5: { cellWidth: 26, halign: 'center' },
        },
      })
      y = (doc as any).lastAutoTable.finalY

      // Footer semestre
      const credV = sem.credits_valides ?? (sem.ues ?? []).filter((u: any) => u.valide).reduce((s: number, u: any) => s + (u.credits_ects ?? u.credits ?? 0), 0)
      const credT = sem.credits_total ?? (sem.ues ?? []).reduce((s: number, u: any) => s + (u.credits_ects ?? u.credits ?? 0), 0)
      const moyS = sem.moyenne !== null ? Number(sem.moyenne).toFixed(2) : '—'
      autoTable(doc, {
        startY: y, margin: { left: mL, right: mR },
        body: [['Crédits validés : ' + credV + ' / ' + credT, 'Moyenne semestrielle : ' + moyS + ' / 20', 'Observations :']],
        theme: 'grid',
        bodyStyles: { fontSize: 8, font: 'times', fontStyle: 'bold', fillColor: [245, 245, 245] },
        columnStyles: { 0: { cellWidth: cW * 0.4 }, 1: { cellWidth: cW * 0.35 }, 2: { cellWidth: cW * 0.25 } },
      })
      y = (doc as any).lastAutoTable.finalY + 5
    }

    // ── Récap annuel (si toute l'année) ─────────────────────────────────
    if (bulletinSemestre.value === null && sems.length >= 2) {
      const moyAnn = b.moyenne !== null ? Number(b.moyenne).toFixed(2) : '—'
      const mentAnn = b.mention ?? '—'
      const decText = b.decision === 'admis' ? 'ADMIS(E)' : b.decision === 'passif' ? 'PASSIF(VE)' : b.decision === 'rattrapage' ? 'ADMIS(E) EN RATTRAPAGE' : b.decision === 'redoublant' ? 'REDOUBLANT(E)' : '—'

      doc.setFillColor(227, 6, 19)
      doc.rect(mL, y, cW, 6, 'F')
      doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont('times', 'bold')
      doc.text('RESULTAT ANNUEL', mL + cW / 2, y + 4.2, { align: 'center' })
      doc.setTextColor(0, 0, 0)
      y += 6

      autoTable(doc, {
        startY: y, margin: { left: mL, right: mR },
        body: [
          ['Moyenne Annuelle : ' + moyAnn + ' / 20', 'Mention : ' + mentAnn, 'Crédits : ' + b.credits_valides + ' / ' + b.credits_total],
          [{ content: 'Décision du jury : ' + decText, colSpan: 3 }],
        ],
        theme: 'grid',
        bodyStyles: { fontSize: 9, font: 'times', fontStyle: 'bold' },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.row.index === 1) {
            data.cell.styles.textColor = (b.moyenne ?? 0) >= 10 ? [0, 100, 0] : [192, 0, 0]
          }
        },
      })
      y = (doc as any).lastAutoTable.finalY + 10
    }

    // ── Signatures ───────────────────────────────────────────────────────
    const sigY = Math.max(y, doc.internal.pageSize.getHeight() - 40)
    const col = cW / 3
    ;[0, 1, 2].forEach(i => {
      const x = mL + i * col + col / 2
      doc.setLineWidth(0.3); doc.setDrawColor(100)
      doc.line(mL + i * col + 5, sigY, mL + (i + 1) * col - 5, sigY)
      doc.setFontSize(8); doc.setFont('times', 'normal')
      const labels = ['Le Directeur Pédagogique', 'Le Directeur Général', "Cachet de l'établissement"]
      doc.text(labels[i] ?? '', x, sigY + 4, { align: 'center' })
    })

    const semLabel = bulletinSemestre.value !== null ? `-S${bulletinSemestre.value}` : ''
    doc.save(`releve-notes-${nom.replace(/\s+/g, '-')}${semLabel}.pdf`)
    return
  }

  // ─── Formation Professionnelle : jsPDF style UGB ─────────────────────
  {
    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const PW = doc.internal.pageSize.getWidth()
    const mL = 14, mR = 14
    const cW = PW - mL - mR
    let y = 10

    // ── Logo ────────────────────────────────────────────────────────────
    let logoDataUrlFP: string | null = null
    try {
      const resp = await fetch('/logo-normal.png')
      if (resp.ok) {
        const blob = await resp.blob()
        logoDataUrlFP = await new Promise<string>((res) => {
          const reader = new FileReader()
          reader.onload = () => res(reader.result as string)
          reader.readAsDataURL(blob)
        })
      }
    } catch { logoDataUrlFP = null }

    // ── En-tête style UGB Formation Professionnelle ─────────────────────
    const cx = PW / 2
    // Gauche : République
    doc.setFontSize(8); doc.setFont('times', 'bold')
    doc.text('REPUBLIQUE DU SENEGAL', mL, y)
    doc.setFont('times', 'italic'); doc.setFontSize(7.5)
    doc.text('Un Peuple - Un But - Une Foi', mL, y + 4)
    doc.setFont('times', 'normal'); doc.setFontSize(7)
    doc.text('Ministere de la Formation Professionnelle,', mL, y + 8.5)
    doc.text('de l\'Apprentissage et de l\'Insertion', mL, y + 12)

    // Centre : Logo + Institut
    const instFP1 = 'Institut Superieur de Formation aux'
    const instFP2 = 'Nouveaux Metiers de l\'Informatique'
    const instFP3 = 'et de la Communication'
    let logoFPOk = false
    if (logoDataUrlFP) {
      try { doc.addImage(logoDataUrlFP, 'PNG', cx - 20, y, 40, 13); logoFPOk = true } catch { logoFPOk = false }
    }
    if (logoFPOk) {
      doc.setFontSize(7.5); doc.setFont('times', 'normal')
      doc.text(instFP1, cx, y + 17, { align: 'center' })
      doc.text(instFP2, cx, y + 21, { align: 'center' })
      doc.text(instFP3, cx, y + 25, { align: 'center' })
    } else {
      doc.setFontSize(12); doc.setFont('times', 'bold')
      doc.text('UPTECH CAMPUS', cx, y + 5, { align: 'center' })
      doc.setFontSize(7.5); doc.setFont('times', 'normal')
      doc.text(instFP1, cx, y + 10, { align: 'center' })
      doc.text(instFP2, cx, y + 14, { align: 'center' })
      doc.text(instFP3, cx, y + 18, { align: 'center' })
    }

    // Droite : Filière + Année
    doc.setFontSize(8); doc.setFont('times', 'normal')
    doc.text('Filiere :', PW - mR, y, { align: 'right' })
    doc.setFont('times', 'bold')
    doc.text(filiere, PW - mR, y + 4, { align: 'right' })
    doc.setFont('times', 'normal')
    doc.text('Annee Academique :', PW - mR, y + 9, { align: 'right' })
    doc.setFont('times', 'bold')
    doc.text(annee, PW - mR, y + 13, { align: 'right' })

    y += logoFPOk ? 30 : 22

    // ── Titre ───────────────────────────────────────────────────────────
    y += 4
    doc.setFontSize(14); doc.setFont('times', 'bold')
    doc.text('RELEVE DE NOTES', PW / 2, y, { align: 'center' })
    y += 5
    doc.setFontSize(9); doc.setFont('times', 'normal')
    // Semestre en cours ou année
    const semLabel = bulletinSemestre.value !== null ? `Semestre ${bulletinSemestre.value}` : 'Annee Complète'
    doc.text(semLabel + '  —  ' + annee, PW / 2, y, { align: 'center' })
    y += 2
    doc.setLineWidth(0.5); doc.setDrawColor(0)
    const tW = doc.getTextWidth('RELEVE DE NOTES')
    doc.line(PW / 2 - tW / 2, y, PW / 2 + tW / 2, y)
    y += 6

    // ── Fiche étudiant ──────────────────────────────────────────────────
    autoTable(doc, {
      startY: y, margin: { left: mL, right: mR },
      body: [
        [
          { content: 'Nom & Prenom :', styles: { fontStyle: 'bold', cellWidth: 30, fontSize: 8 } },
          { content: nom, styles: { fontStyle: 'bold', fontSize: 9 } },
          { content: 'N° Matricule :', styles: { fontStyle: 'bold', cellWidth: 28, fontSize: 8 } },
          { content: numEtd, styles: { fontStyle: 'bold', fontSize: 8.5 } },
        ],
        [
          { content: 'Ne(e) le :', styles: { fontStyle: 'bold', fontSize: 8 } },
          { content: dateNaiss, styles: { fontSize: 8 } },
          { content: 'Lieu de naissance :', styles: { fontStyle: 'bold', fontSize: 8 } },
          { content: lieuNaiss, styles: { fontSize: 8 } },
        ],
        [
          { content: 'Filiere :', styles: { fontStyle: 'bold', fontSize: 8 } },
          { content: filiere, styles: { fontSize: 8 } },
          { content: 'Niveau :', styles: { fontStyle: 'bold', fontSize: 8 } },
          { content: niveau, styles: { fontSize: 8 } },
        ],
      ],
      theme: 'grid',
      styles: { font: 'times', cellPadding: 2.5, textColor: [0,0,0], fillColor: [255,255,255] },
    })
    y = (doc as any).lastAutoTable.finalY + 6

    // ── Tableau des matières groupées par domaine ────────────────────────
    // Filtrer coef = 0 + filtre semestre si sélectionné
    const allUesFP: any[] = (b.ues ?? []).filter((u: any) => {
      const coef = u.coef_effectif != null ? parseFloat(u.coef_effectif) : parseFloat(u.coefficient) || 0
      if (coef === 0) return false
      if (bulletinSemestre.value !== null && (u.semestre ?? 1) !== bulletinSemestre.value) return false
      return true
    })

    // Grouper par domaine (categorie_ue)
    const domainesMap: Record<string, { intitule: string; matieres: any[] }> = {}
    const sansdomaine: any[] = []
    for (const ue of allUesFP) {
      const key = ue.categorie_ue ?? null
      if (key) {
        if (!domainesMap[key]) domainesMap[key] = { intitule: ue.intitule_ue ?? key, matieres: [] }
        domainesMap[key].matieres.push(ue)
      } else {
        sansdomaine.push(ue)
      }
    }

    const BK: [number,number,number] = [0,0,0]
    const WH: [number,number,number] = [255,255,255]
    const bodyRowsFP: any[][] = []

    // Bandeau semestre si filtré
    if (bulletinSemestre.value !== null) {
      doc.setFillColor(227, 6, 19)
      doc.rect(mL, y, cW, 6, 'F')
      doc.setTextColor(255,255,255); doc.setFontSize(9); doc.setFont('times', 'bold')
      doc.text('SEMESTRE ' + bulletinSemestre.value, mL + cW / 2, y + 4.2, { align: 'center' })
      doc.setTextColor(0,0,0)
      y += 6
    }

    const domaines = Object.values(domainesMap)
    for (const dom of domaines) {
      const mats = dom.matieres
      const nbMats = mats.length
      mats.forEach((mat: any, idx: number) => {
        const coef = parseFloat(mat.coefficient) || parseFloat(mat.coef_effectif) || 1
        const ccStr = mat.note_controle != null ? Number(mat.note_controle).toFixed(2) : '—'
        const exStr = mat.note_examen != null ? Number(mat.note_examen).toFixed(2) : '—'
        const noteStr = mat.note !== null ? Number(mat.note).toFixed(2) : '—'
        const apprStr = appreciationFP(mat.note)  // appréciation par matière

        if (idx === 0) {
          bodyRowsFP.push([
            { content: dom.intitule, rowSpan: nbMats, styles: { valign: 'middle', fontStyle: 'bold', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: mat.intitule, styles: { fontSize: 7.5, fillColor: WH, textColor: BK } },
            { content: String(coef), styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: ccStr, styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: exStr, styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: noteStr, styles: { halign: 'center', fontStyle: 'bold', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: apprStr, styles: { halign: 'center', fontSize: 7.5, fillColor: WH, textColor: BK } },
          ])
        } else {
          bodyRowsFP.push([
            { content: mat.intitule, styles: { fontSize: 7.5, fillColor: WH, textColor: BK } },
            { content: String(coef), styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: ccStr, styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: exStr, styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: noteStr, styles: { halign: 'center', fontStyle: 'bold', fontSize: 8, fillColor: WH, textColor: BK } },
            { content: apprStr, styles: { halign: 'center', fontSize: 7.5, fillColor: WH, textColor: BK } },
          ])
        }
      })
    }

    // Matières sans domaine (coef > 0 déjà filtré)
    for (const mat of sansdomaine) {
      const coef = parseFloat(mat.coefficient) || parseFloat(mat.coef_effectif) || 1
      const ccStr = mat.note_controle != null ? Number(mat.note_controle).toFixed(2) : '—'
      const exStr = mat.note_examen != null ? Number(mat.note_examen).toFixed(2) : '—'
      const noteStr = mat.note !== null ? Number(mat.note).toFixed(2) : '—'
      bodyRowsFP.push([
        { content: '—', styles: { halign: 'center', fillColor: WH, textColor: BK } },
        { content: mat.intitule, styles: { fontSize: 7.5, fillColor: WH, textColor: BK } },
        { content: String(coef), styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
        { content: ccStr, styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
        { content: exStr, styles: { halign: 'center', fontSize: 8, fillColor: WH, textColor: BK } },
        { content: noteStr, styles: { halign: 'center', fontStyle: 'bold', fontSize: 8, fillColor: WH, textColor: BK } },
        { content: appreciationFP(mat.note), styles: { halign: 'center', fontSize: 7.5, fillColor: WH, textColor: BK } },
      ])
    }

    autoTable(doc, {
      startY: y, margin: { left: mL, right: mR },
      head: [['Domaine', 'Matiere', 'Coef.', 'Controle', 'Examen', 'Moyenne', 'Appreciation']],
      body: bodyRowsFP,
      theme: 'grid',
      headStyles: { fillColor: BK, textColor: [255,255,255], fontStyle: 'bold', fontSize: 7.5, font: 'times', halign: 'center' },
      bodyStyles: { fontSize: 8, font: 'times', fillColor: WH, textColor: BK },
      columnStyles: {
        0: { cellWidth: 30 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 12, halign: 'center' },
        3: { cellWidth: 18, halign: 'center' },
        4: { cellWidth: 18, halign: 'center' },
        5: { cellWidth: 18, halign: 'center' },
        6: { cellWidth: 24, halign: 'center' },
      },
    })
    y = (doc as any).lastAutoTable.finalY

    // ── Pied : Moyenne + Appréciation (filtrée si semestre)
    const semUesFP = allUesFP
    let fpPts = 0, fpW = 0
    for (const u of semUesFP) { const w = u.coef_effectif != null ? parseFloat(u.coef_effectif) : parseFloat(u.coefficient) || 1; if (u.note !== null) { fpPts += u.note * w; fpW += w } }
    const moyFP = fpW > 0 ? (Math.round(fpPts / fpW * 100) / 100).toFixed(2) : (b.moyenne !== null ? Number(b.moyenne).toFixed(2) : '—')
    const mentFP = fpW > 0 ? appreciationFP(fpW > 0 ? fpPts / fpW : null) : (b.mention ?? '—')
    autoTable(doc, {
      startY: y, margin: { left: mL, right: mR },
      body: [[
        { content: 'Moyenne semestrielle : ' + moyFP + ' / 20', styles: { fontStyle: 'bold', fontSize: 9 } },
        { content: 'Appreciation generale : ' + mentFP, styles: { fontStyle: 'bold', fontSize: 9 } },
        { content: 'Observations :', styles: { fontSize: 8 } },
      ]],
      theme: 'grid',
      bodyStyles: { font: 'times', fillColor: [245,245,245], textColor: BK },
      columnStyles: { 0: { cellWidth: cW * 0.35 }, 1: { cellWidth: cW * 0.35 }, 2: { cellWidth: cW * 0.30 } },
    })
    y = (doc as any).lastAutoTable.finalY + 8

    // ── Mention légale ──────────────────────────────────────────────────
    doc.setFontSize(7.5); doc.setFont('times', 'italic')
    doc.text('NB : Il n\'est delivre que l\'original du present document. Merci d\'en prendre soin et d\'en faire des copies legalisees.', PW / 2, y, { align: 'center' })
    y += 5

    // ── Date + Lieu ─────────────────────────────────────────────────────
    const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    doc.setFont('times', 'normal'); doc.setFontSize(8)
    doc.text('Fait a Dakar, le ' + today, PW - mR, y, { align: 'right' })
    y += 10

    // ── Signatures ──────────────────────────────────────────────────────
    const sigY2 = Math.max(y, doc.internal.pageSize.getHeight() - 35)
    const col2 = cW / 3
    ;['Le Responsable Pedagogique', 'Le Directeur General', "Cachet de l'etablissement"].forEach((label, i) => {
      const x = mL + i * col2 + col2 / 2
      doc.setLineWidth(0.3); doc.setDrawColor(100)
      doc.line(mL + i * col2 + 5, sigY2, mL + (i + 1) * col2 - 5, sigY2)
      doc.setFontSize(8); doc.setFont('times', 'normal')
      doc.text(label, x, sigY2 + 4, { align: 'center' })
    })

    doc.save(`releve-notes-FP-${nom.replace(/\s+/g, '-')}.pdf`)
  }
}

function mentionColor(m: string | null) {
  const map: Record<string, string> = { 'Très Bien': 'text-green-600', 'Bien': 'text-green-500', 'Assez Bien': 'text-blue-500', 'Passable': 'text-orange-500' }
  return m ? (map[m] ?? 'text-gray-700') : 'text-gray-400'
}

async function load() {
  loading.value = true
  try {
    if (isEnseignant.value) {
      // Prof : charger uniquement son profil et ses classes
      const { data } = await api.get('/enseignants/me')
      monProfil.value = data
      classes.value = data.mes_classes ?? []
      // Pré-sélectionner la première classe si une seule
      if (classes.value.length === 1 && classes.value[0]) {
        filterClasse.value = String(classes.value[0].id)
        await loadNotes()
      }
    } else {
      // Admin : charger toutes les classes + enseignants + années
      const [cRes, iRes, aaRes] = await Promise.all([api.get('/classes'), api.get('/enseignants'), api.get('/annees-academiques')])
      classes.value = cRes.data
      enseignants.value = iRes.data
      anneesAcademiques.value = aaRes.data
      // Pré-sélectionner l'année active
      const anneeActive = anneesAcademiques.value.find(a => a.actif)
      if (anneeActive) filterAnneeNotes.value = String(anneeActive.id)
    }
  } finally { loading.value = false }
}

onMounted(load)

// ─── Jury ─────────────────────────────────────────────────────────────────────
const juryStep = ref<1|2|3>(1)
const juryData = ref<any>(null)
const juryMembres = ref<{nom:string; fonction:string}[]>([
  {nom:'', fonction:'Président du jury'},
  {nom:'', fonction:'Secrétaire'},
])
const juryDateDeliberation = ref('')
const juryDecisions = ref<Record<number, {decision:string; observation:string}>>({})
const loadingJury = ref(false)
const savingJury = ref(false)
const loadingSuggests = ref(false)
const enseignantsSuggests = ref<{ id: number; nom: string; prenom: string; specialite: string; nb_seances: number; source: string }[]>([])

// Charge les enseignants suggérés pour la classe
async function loadEnseignantsSuggests() {
  if (!filterClasse.value) return
  loadingSuggests.value = true
  try {
    const classeObj = classes.value.find(c => String(c.id) === filterClasse.value)
    const anneeId = classeObj?.annee_academique_id ?? null
    const { data } = await api.get(`/jurys/classe/${filterClasse.value}/enseignants-suggests`, {
      params: anneeId ? { annee_id: anneeId } : {},
    })
    enseignantsSuggests.value = data
  } catch { enseignantsSuggests.value = [] }
  finally { loadingSuggests.value = false }
}

// Injecte les enseignants suggérés comme membres du jury
function appliquerSuggests() {
  if (!enseignantsSuggests.value.length) return
  juryMembres.value = enseignantsSuggests.value.map((e, i) => ({
    nom: `${e.prenom} ${e.nom}`.trim(),
    fonction: i === 0 ? 'Président du jury' : 'Membre',
  }))
  // Garder une ligne Secrétaire en 2e position si plus d'un
  if (juryMembres.value.length >= 2) {
    juryMembres.value.splice(1, 0, { nom: '', fonction: 'Secrétaire' })
  }
}

async function loadJury() {
  if (!filterClasse.value) return
  loadingJury.value = true
  try {
    const [juryRes] = await Promise.all([
      api.get(`/jurys/classe/${filterClasse.value}`, { params: { session: filterSession.value } }),
      loadEnseignantsSuggests(),
    ])
    const data = juryRes.data
    juryData.value = data
    if (data) {
      juryDateDeliberation.value = data.date_deliberation ? data.date_deliberation.slice(0, 10) : ''
      // Si des membres existent → on les garde, sinon auto-remplissage depuis les enseignants
      if (data.membres && data.membres.length) {
        juryMembres.value = data.membres.map((m: any) => ({ nom: m.nom ?? '', fonction: m.fonction ?? '' }))
      } else if (enseignantsSuggests.value.length) {
        appliquerSuggests()
      } else {
        juryMembres.value = [{ nom: '', fonction: 'Président du jury' }, { nom: '', fonction: 'Secrétaire' }]
      }
      // Load decisions
      const dRes = await api.get(`/jurys/${data.id}/decisions`)
      const decisions: Record<number, {decision:string; observation:string}> = {}
      for (const d of dRes.data) {
        decisions[d.inscription_id] = { decision: d.decision, observation: d.observation ?? '' }
      }
      juryDecisions.value = decisions
    } else {
      juryDateDeliberation.value = ''
      // Nouveau jury → auto-remplissage si enseignants disponibles
      if (enseignantsSuggests.value.length) {
        appliquerSuggests()
      } else {
        juryMembres.value = [{ nom: '', fonction: 'Président du jury' }, { nom: '', fonction: 'Secrétaire' }]
      }
      juryDecisions.value = {}
    }
  } catch { /* ignore */ }
  finally { loadingJury.value = false }
}

function juryAutoDecision(inscriptionId: number): string {
  const moy = moyennePonderee(inscriptionId)
  if (moy === null) return 'rattrapage'
  if (isLMD(inscriptionId)) {
    const d = decisionLMD(inscriptionId)
    if (d === 'Admis') return 'admis'
    if (d === 'Passif') return 'passif'
    return 'redoublant'
  }
  if (moy >= 10) return 'admis'
  if (moy >= 8) return 'rattrapage'
  return 'redoublant'
}

function getJuryDecision(inscriptionId: number): string {
  return juryDecisions.value[inscriptionId]?.decision ?? juryAutoDecision(inscriptionId)
}

function setJuryDecision(inscriptionId: number, decision: string) {
  if (!juryDecisions.value[inscriptionId]) {
    juryDecisions.value[inscriptionId] = { decision, observation: '' }
  } else {
    juryDecisions.value[inscriptionId].decision = decision
  }
}

function getJuryObservation(inscriptionId: number): string {
  return juryDecisions.value[inscriptionId]?.observation ?? ''
}

function setJuryObservation(inscriptionId: number, obs: string) {
  if (!juryDecisions.value[inscriptionId]) {
    juryDecisions.value[inscriptionId] = { decision: juryAutoDecision(inscriptionId), observation: obs }
  } else {
    juryDecisions.value[inscriptionId].observation = obs
  }
}

async function saveJuryConstitution() {
  if (!filterClasse.value) return
  savingJury.value = true
  try {
    let jury = juryData.value
    if (!jury) {
      const { data } = await api.post('/jurys', {
        classe_id: Number(filterClasse.value),
        session: filterSession.value,
        date_deliberation: juryDateDeliberation.value || null,
      })
      jury = data
      juryData.value = jury
    } else {
      const { data } = await api.put(`/jurys/${jury.id}`, {
        date_deliberation: juryDateDeliberation.value || null,
        statut: jury.statut ?? 'ouvert',
      })
      juryData.value = data
    }
    await api.post(`/jurys/${jury.id}/membres`, { membres: juryMembres.value })
    juryStep.value = 2
  } finally { savingJury.value = false }
}

async function saveDecisions() {
  if (!juryData.value) return
  savingJury.value = true
  try {
    const decisions = inscriptions.value.map(i => ({
      inscription_id: i.id,
      decision: getJuryDecision(i.id),
      observation: getJuryObservation(i.id),
    }))
    await api.post(`/jurys/${juryData.value.id}/decisions`, { decisions })
    await loadJury()
  } finally { savingJury.value = false }
}

async function cloturerJury() {
  if (!juryData.value) return
  if (!confirm('Clôturer le jury ? Cette action est irréversible.')) return
  savingJury.value = true
  try {
    const { data } = await api.put(`/jurys/${juryData.value.id}/cloturer`, {})
    juryData.value = data
    juryStep.value = 3
  } finally { savingJury.value = false }
}

async function rouvrirJury() {
  if (!juryData.value) return
  if (!confirm('Rouvrir ce jury clôturé ? Les décisions redeviendront modifiables.')) return
  savingJury.value = true
  try {
    const { data } = await api.put(`/jurys/${juryData.value.id}/rouvrir`, {})
    juryData.value = data
    juryStep.value = 1
  } catch (e: any) {
    alert(e?.response?.data?.error ?? 'Erreur lors de la réouverture')
  } finally { savingJury.value = false }
}

async function supprimerJury() {
  if (!juryData.value) return
  if (!confirm(`Supprimer définitivement ce jury (${juryData.value.session}) ? Toutes les décisions seront perdues.`)) return
  savingJury.value = true
  try {
    await api.delete(`/jurys/${juryData.value.id}`)
    juryData.value = null
    juryStep.value = 1
    juryMembres.value = [{ nom: '', fonction: 'Président du jury' }, { nom: '', fonction: 'Secrétaire' }]
    juryDateDeliberation.value = ''
    juryDecisions.value = {}
  } catch (e: any) {
    alert(e?.response?.data?.error ?? 'Erreur lors de la suppression')
  } finally { savingJury.value = false }
}

const generatingFiche = ref<number | null>(null)

async function generateFicheNotes(ue: any) {
  generatingFiche.value = ue.id
  try {
    const classeObj = classes.value.find(c => String(c.id) === filterClasse.value)
    const { data } = await api.get('/fiches-notes', {
      params: {
        classe_id: filterClasse.value,
        ue_id: ue.id,
        session: filterSession.value,
        annee_id: classeObj?.annee_academique_id ?? undefined,
      },
    })

    const { jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const W = 297
    const H = 210
    const ML = 12
    const MR = 12
    const CW = W - ML - MR
    const RED = '#E30613'
    const BK  = '#111111'
    let y = 10

    const nomEtab    = data.params?.nom_etablissement || 'UPTECH Campus'
    const adresse    = data.params?.adresse           || ''
    const tel        = data.params?.telephone         || ''
    const classeNom  = data.classe?.classe_nom        || ''
    const filiereNom = data.classe?.filiere_nom       || ''
    const anneeLib   = data.annee_libelle             || ''
    const session    = data.session === 'rattrapage' ? 'Rattrapage' : 'Normale'
    const ueCode     = data.ue?.code                  || ''
    const ueIntitule = data.ue?.intitule_ue || data.ue?.intitule || ''
    const vht        = data.ue?.volume_horaire        || ''
    const cm         = data.ue?.cm                    || 0
    const td         = data.ue?.td                    || 0
    const tp         = data.ue?.tp                    || 0
    const coef       = data.ue?.coefficient           || 1
    const credits    = data.ue?.credits_ects          || 0
    const ensNom     = data.ue?.ens_nom ? `${data.ue.ens_prenom} ${data.ue.ens_nom}` : 'Non assigné'
    const totalSean  = data.total_seances             || 0
    const today      = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

    // ── EN-TÊTE ────────────────────────────────────────────────────
    // Bloc gauche : République
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(BK)
    doc.text('RÉPUBLIQUE DU SÉNÉGAL', ML, y)
    y += 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor('#555')
    doc.text('Un Peuple – Un But – Une Foi', ML, y)
    y += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(BK)
    doc.text(nomEtab.toUpperCase(), ML, y)
    y += 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor('#666')
    if (adresse) { doc.text(adresse, ML, y); y += 3.5 }
    if (tel) { doc.text(`Tél : ${tel}`, ML, y); y += 3.5 }

    // Titre centré
    const titleY = 14
    doc.setFillColor(RED)
    doc.rect(ML + 60, titleY - 5, CW - 120, 18, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor('#ffffff')
    doc.text('FICHE DE NOTES', W / 2, titleY + 2, { align: 'center' })
    doc.setFontSize(8)
    doc.text(`Session : ${session}  –  Année : ${anneeLib}`, W / 2, titleY + 8, { align: 'center' })
    doc.setTextColor(BK)

    // Date en haut à droite
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor('#888')
    doc.text(`Dakar, le ${today}`, W - MR, 12, { align: 'right' })
    doc.setTextColor(BK)

    y = 34

    // ── BANDEAU INFO ───────────────────────────────────────────────
    doc.setFillColor('#f5f5f5')
    doc.rect(ML, y, CW, 16, 'F')
    doc.setDrawColor('#e0e0e0')
    doc.setLineWidth(0.3)
    doc.rect(ML, y, CW, 16)

    const col1 = ML + 3
    const col2 = ML + CW * 0.28
    const col3 = ML + CW * 0.56

    const infoY1 = y + 5.5
    const infoY2 = y + 11.5

    // Col 1
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
    doc.text('Classe :', col1, infoY1)
    doc.setFont('helvetica', 'normal')
    doc.text(classeNom, col1 + 14, infoY1)
    doc.setFont('helvetica', 'bold')
    doc.text('Filière :', col1, infoY2)
    doc.setFont('helvetica', 'normal')
    doc.text(filiereNom, col1 + 14, infoY2)

    // Col 2
    doc.setFont('helvetica', 'bold')
    doc.text('Matière :', col2, infoY1)
    doc.setFont('helvetica', 'normal')
    doc.text(`[${ueCode}] ${ueIntitule}`, col2 + 16, infoY1)
    doc.setFont('helvetica', 'bold')
    doc.text('Enseignant :', col2, infoY2)
    doc.setFont('helvetica', 'normal')
    doc.text(ensNom, col2 + 22, infoY2)

    // Col 3
    doc.setFont('helvetica', 'bold')
    doc.text('VHT :', col3, infoY1)
    doc.setFont('helvetica', 'normal')
    doc.text(`${vht}h  (CM:${cm}h  TD:${td}h  TP:${tp}h)`, col3 + 10, infoY1)
    doc.setFont('helvetica', 'bold')
    doc.text('Coef / Crédits :', col3, infoY2)
    doc.setFont('helvetica', 'normal')
    doc.text(`${coef} / ${credits}  —  Séances effectuées : ${totalSean}`, col3 + 28, infoY2)

    y += 20

    // ── TABLEAU ÉTUDIANTS ──────────────────────────────────────────
    const etudiants: any[] = data.etudiants ?? []

    const bodyRows = etudiants.map((et: any, i: number) => [
      i + 1,
      et.numero_etudiant || '—',
      `${et.nom.toUpperCase()} ${et.prenom}`,
      `${et.nb_presences} / ${totalSean}`,
      '', // Note contrôle (vide → à remplir)
      '', // Note examen  (vide → à remplir)
      '', // Note finale  (vide → à remplir)
      '', // Signature
    ])

    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      head: [[
        { content: 'N°',            styles: { halign: 'center' } },
        { content: 'Matricule',     styles: { halign: 'center' } },
        { content: 'Nom & Prénoms', styles: { halign: 'left'   } },
        { content: `Présences\n(/ ${totalSean} séances)`, styles: { halign: 'center' } },
        { content: 'Note\nContrôle\n(/20)', styles: { halign: 'center' } },
        { content: 'Note\nExamen\n(/20)',   styles: { halign: 'center' } },
        { content: 'Note\nFinale\n(/20)',   styles: { halign: 'center' } },
        { content: 'Signature\nétudiant',   styles: { halign: 'center' } },
      ]],
      body: bodyRows,
      styles: { fontSize: 8.5, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 }, lineColor: '#cccccc', lineWidth: 0.2 },
      headStyles: { fillColor: [30, 30, 30], textColor: '#ffffff', fontStyle: 'bold', fontSize: 8, halign: 'center' },
      alternateRowStyles: { fillColor: '#fafafa' },
      columnStyles: {
        0: { cellWidth: 9,  halign: 'center' },
        1: { cellWidth: 26, halign: 'center', font: 'courier', fontSize: 8 },
        2: { cellWidth: 72, halign: 'left',   fontStyle: 'bold' },
        3: { cellWidth: 30, halign: 'center' },
        4: { cellWidth: 25, halign: 'center' },
        5: { cellWidth: 25, halign: 'center' },
        6: { cellWidth: 25, halign: 'center' },
        7: { cellWidth: 41, halign: 'center' },
      },
      didParseCell(data) {
        // Colonnes notes : fond légèrement bleu pour différencier
        if (data.section === 'body' && [4, 5, 6].includes(data.column.index)) {
          data.cell.styles.fillColor = '#f0f6ff'
        }
      },
    })

    const finalY = (doc as any).lastAutoTable.finalY + 10

    // ── PIED DE PAGE : signatures ──────────────────────────────────
    const sigY = Math.min(finalY, H - 28)
    doc.setDrawColor('#cccccc')
    doc.setLineWidth(0.3)

    // Bloc enseignant
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(BK)
    doc.text("Signature de l'enseignant :", ML, sigY)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor('#555')
    doc.text(ensNom, ML, sigY + 4)
    doc.line(ML, sigY + 14, ML + 65, sigY + 14)

    // Bloc responsable pédagogique
    const rpX = W / 2 - 30
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(BK)
    doc.text('Responsable pédagogique :', rpX, sigY)
    doc.line(rpX, sigY + 14, rpX + 65, sigY + 14)

    // Cachet
    const cachetX = W - MR - 55
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(BK)
    doc.text('Cachet établissement :', cachetX, sigY)
    doc.setDrawColor('#cccccc')
    doc.setFillColor('#fafafa')
    doc.rect(cachetX, sigY + 2, 55, 14)

    // Numérotation
    const totalPages = (doc as any).internal.getNumberOfPages()
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor('#aaa')
      doc.text(`${nomEtab} — Fiche de notes [${ueCode}] — ${classeNom} — ${session} ${anneeLib}`, ML, H - 5)
      doc.text(`Page ${i}/${totalPages}`, W - MR, H - 5, { align: 'right' })
      doc.setDrawColor('#dddddd')
      doc.setLineWidth(0.25)
      doc.line(ML, H - 7, W - MR, H - 7)
    }

    const filename = `fiche-notes_${ueCode}_${classeNom}_${session}_${anneeLib.replace(/\//g, '-')}.pdf`
      .replace(/\s+/g, '_').toLowerCase()
    doc.save(filename)
  } catch (e: any) {
    alert('Erreur génération fiche : ' + (e?.response?.data?.error ?? e.message))
  } finally {
    generatingFiche.value = null
  }
}

async function exportPVJury() {
  const { jsPDF } = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const PW = doc.internal.pageSize.getWidth()
  const mL = 14, mR = 14
  const cW = PW - mL - mR
  let y = 10

  // Logo
  let logoDataUrl: string | null = null
  try {
    const resp = await fetch('/logo-normal.png')
    if (resp.ok) {
      const blob = await resp.blob()
      logoDataUrl = await new Promise<string>((res) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result as string)
        reader.readAsDataURL(blob)
      })
    }
  } catch { logoDataUrl = null }

  // Header
  const cx = PW / 2
  doc.setFontSize(8); doc.setFont('times', 'bold')
  doc.text('REPUBLIQUE DU SENEGAL', mL, y)
  doc.setFont('times', 'italic'); doc.setFontSize(7.5)
  doc.text('Un Peuple - Un But - Une Foi', mL, y + 4)

  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', cx - 20, y, 40, 13) } catch { /* skip */ }
    doc.setFontSize(7.5); doc.setFont('times', 'normal')
    doc.text('Institut Superieur de Formation', cx, y + 18, { align: 'center' })
    doc.text('UPTECH CAMPUS', cx, y + 22, { align: 'center' })
  } else {
    doc.setFontSize(12); doc.setFont('times', 'bold')
    doc.text('UPTECH CAMPUS', cx, y + 5, { align: 'center' })
  }
  y += 30

  // Title
  doc.setFontSize(14); doc.setFont('times', 'bold')
  doc.text('PROCES-VERBAL DE JURY', cx, y, { align: 'center' })
  y += 7

  const nomClasse = classes.value.find(c => String(c.id) === filterClasse.value)?.nom ?? '—'
  const dateDelib = juryData.value?.date_deliberation
    ? new Date(juryData.value.date_deliberation).toLocaleDateString('fr-FR') : '—'
  doc.setFontSize(9); doc.setFont('times', 'normal')
  doc.text(`Classe : ${nomClasse}  |  Session : ${filterSession.value}  |  Date : ${dateDelib}`, cx, y, { align: 'center' })
  y += 8

  // Students table
  const sorted = [...inscriptions.value].sort((a, b) => (moyennePonderee(b.id) ?? -1) - (moyennePonderee(a.id) ?? -1))
  const tableBody = sorted.map((insc, idx) => {
    const moy = moyennePonderee(insc.id)
    const dec = getJuryDecision(insc.id)
    return [
      String(idx + 1),
      insc.etudiant.nom.toUpperCase(),
      insc.etudiant.prenom,
      moy !== null ? moy.toFixed(2) : '—',
      mention(moy),
      dec.charAt(0).toUpperCase() + dec.slice(1),
    ]
  })

  autoTable(doc, {
    startY: y,
    margin: { left: mL, right: mR },
    head: [['Rang', 'Nom', 'Prénom', 'Moyenne', 'Mention', 'Décision']],
    body: tableBody,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [26, 58, 107], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 245] },
  })

  y = (doc as any).lastAutoTable.finalY + 8

  // Recap
  const admis = sorted.filter(i => getJuryDecision(i.id) === 'admis').length
  const ratt = sorted.filter(i => getJuryDecision(i.id) === 'rattrapage').length
  const redoub = sorted.filter(i => getJuryDecision(i.id) === 'redoublant').length
  const taux = sorted.length ? Math.round(admis / sorted.length * 100) : 0

  doc.setFontSize(9); doc.setFont('times', 'bold')
  doc.text(`Récapitulatif : Admis : ${admis}  |  Rattrapage : ${ratt}  |  Redoublant : ${redoub}  |  Taux de réussite : ${taux}%`, mL, y)
  y += 10

  // Signatures
  const membres = juryMembres.value.filter(m => m.nom.trim())
  const president = membres.find(m => m.fonction.toLowerCase().includes('président')) ?? membres[0]
  const secretaire = membres.find(m => m.fonction.toLowerCase().includes('secrétaire')) ?? membres[1]
  const autresMembres = membres.filter(m => m !== president && m !== secretaire)

  const sigY = Math.max(y, doc.internal.pageSize.getHeight() - 45)
  const col3 = cW / 3
  const sigItems = [
    { label: 'Le Président du jury', nom: president?.nom ?? '' },
    { label: 'Le Secrétaire', nom: secretaire?.nom ?? '' },
    { label: 'Membres', nom: autresMembres.map(m => m.nom).join(', ') },
  ]
  sigItems.forEach((s, i) => {
    const x = mL + i * col3 + col3 / 2
    doc.setLineWidth(0.3); doc.setDrawColor(100)
    doc.line(mL + i * col3 + 5, sigY, mL + (i + 1) * col3 - 5, sigY)
    doc.setFontSize(8); doc.setFont('times', 'bold')
    doc.text(s.label, x, sigY + 5, { align: 'center' })
    if (s.nom) { doc.setFont('times', 'normal'); doc.text(s.nom, x, sigY + 9, { align: 'center' }) }
  })

  doc.save(`PV-jury-${nomClasse.replace(/\s+/g,'-')}-${filterSession.value}.pdf`)
}

// ── Helpers design attestation ────────────────────────────────────────────
function attCornerOrnament(doc: any, x: number, y: number, sz: number, fx: number, fy: number, gold: [number,number,number], navy: [number,number,number]) {
  // Bracket L extérieur (navy)
  doc.setDrawColor(...navy); doc.setLineWidth(1)
  doc.line(x, y, x + fx * sz, y)
  doc.line(x, y, x, y + fy * sz)
  // Bracket L intérieur (gold, décalé 3mm)
  doc.setDrawColor(...gold); doc.setLineWidth(0.5)
  doc.line(x + fx * 3, y + fy * 3, x + fx * sz * 0.6, y + fy * 3)
  doc.line(x + fx * 3, y + fy * 3, x + fx * 3, y + fy * sz * 0.6)
  // Petit losange au coin
  const d = 5
  doc.setDrawColor(...gold); doc.setLineWidth(0.4)
  doc.line(x + fx * d, y, x, y + fy * d)
  doc.line(x + fx * d, y, x + fx * d * 2, y + fy * d)
  doc.line(x, y + fy * d, x + fx * d, y + fy * d * 2)
  doc.line(x + fx * d * 2, y + fy * d, x + fx * d, y + fy * d * 2)
}

function attSeal(doc: any, cx: number, cy: number, navy: [number,number,number], gold: [number,number,number], annee: string) {
  // Cercle extérieur navy
  doc.setDrawColor(...navy); doc.setLineWidth(0.8)
  doc.circle(cx, cy, 16)
  // Cercle intérieur gold
  doc.setDrawColor(...gold); doc.setLineWidth(0.4)
  doc.circle(cx, cy, 12)
  // Rayons entre les 2 cercles
  doc.setDrawColor(...navy); doc.setLineWidth(0.3)
  for (let a = 0; a < 360; a += 20) {
    const r = a * Math.PI / 180
    doc.line(cx + Math.cos(r) * 12.5, cy + Math.sin(r) * 12.5, cx + Math.cos(r) * 15.5, cy + Math.sin(r) * 15.5)
  }
  // Texte intérieur
  doc.setTextColor(...navy); doc.setFontSize(5.5); doc.setFont('times', 'bold')
  doc.text("UP'TECH", cx, cy - 3, { align: 'center' })
  doc.setFontSize(4.5); doc.setFont('times', 'normal')
  doc.text('INSTITUT', cx, cy + 1, { align: 'center' })
  doc.text(annee, cx, cy + 5, { align: 'center' })
  doc.setTextColor(0,0,0)
}

function attSecurityHash(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0 }
  return Math.abs(h).toString(16).toUpperCase().padStart(8, '0')
}

async function exportAttestations() {
  const admisInscriptions = [...inscriptions.value]
    .sort((a, b) => (moyennePonderee(b.id) ?? -1) - (moyennePonderee(a.id) ?? -1))
    .filter(i => getJuryDecision(i.id) === 'admis')
  if (!admisInscriptions.length) { alert('Aucun étudiant admis.'); return }

  const { jsPDF } = await import('jspdf')
  const QRCode = (await import('qrcode')).default
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  // Palette officielle
  const NAVY: [number,number,number] = [0, 0, 0]
  const GOLD: [number,number,number] = [180, 145, 60]
  const LIGHT_GOLD: [number,number,number] = [245, 238, 210]
  const LIGHT_NAVY: [number,number,number] = [220, 220, 220]

  // Charger le logo
  let logoDataUrl: string | null = null
  try {
    const resp = await fetch('/logo-normal.png')
    if (resp.ok) {
      const blob = await resp.blob()
      logoDataUrl = await new Promise<string>((res) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result as string)
        reader.readAsDataURL(blob)
      })
    }
  } catch { logoDataUrl = null }

  const anneeEnCours = new Date().getFullYear()

  for (let pi = 0; pi < admisInscriptions.length; pi++) {
    const insc = admisInscriptions[pi]!
    if (!insc) continue
    if (pi > 0) doc.addPage()

    const PW = doc.internal.pageSize.getWidth()
    const PH = doc.internal.pageSize.getHeight()
    const mL = 18, mR = 18
    const cx = PW / 2

    // ── 1. Filigrane diagonal (anti-reproduction) ─────────────────────
    doc.setTextColor(235, 238, 248); doc.setFontSize(52); doc.setFont('times', 'bold')
    doc.text("UP'TECH", cx, PH / 2 + 20, { align: 'center', angle: 45 })
    doc.setTextColor(0,0,0)

    // ── 2. Fond léger hachures diagonales ────────────────────────────
    doc.setDrawColor(...LIGHT_NAVY); doc.setLineWidth(0.15)
    for (let d = 0; d < PW + PH; d += 10) {
      doc.line(Math.max(0, d - PH), Math.min(PH, d), Math.min(PW, d), Math.max(0, d - PW))
    }

    // ── 3. Double bordure Navy + Or ───────────────────────────────────
    doc.setFillColor(255, 255, 255)
    doc.rect(8, 8, PW - 16, PH - 16, 'F')          // fond blanc
    doc.setDrawColor(...NAVY); doc.setLineWidth(2.5)
    doc.rect(8, 8, PW - 16, PH - 16)               // bordure extérieure navy
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6)
    doc.rect(13, 13, PW - 26, PH - 26)             // bordure intérieure or

    // ── 4. Ornements aux 4 coins ──────────────────────────────────────
    attCornerOrnament(doc, 13, 13, 18, 1, 1, GOLD, NAVY)
    attCornerOrnament(doc, PW - 13, 13, 18, -1, 1, GOLD, NAVY)
    attCornerOrnament(doc, 13, PH - 13, 18, 1, -1, GOLD, NAVY)
    attCornerOrnament(doc, PW - 13, PH - 13, 18, -1, -1, GOLD, NAVY)

    // ── 5. REF unique + QR + hash sécurité ───────────────────────────
    const numEtd = (insc as any).etudiant?.numero_etudiant ?? String(insc.id)
    const ref = `ATT-${anneeEnCours}-${numEtd}-${String(pi + 1).padStart(3, '0')}`
    const verifyUrl = `https://uptechcampus.vercel.app/verify-attestation/${ref}`
    const nomEtd = `${insc.etudiant.prenom} ${insc.etudiant.nom.toUpperCase()}`
    const secHash = attSecurityHash(ref + nomEtd)

    // Calculs pour sauvegarde
    const moyInsc = moyennePonderee(insc.id)
    const mentionInsc = moyInsc != null ? mention(moyInsc) : null
    const nomClasse = classes.value.find(c => String(c.id) === filterClasse.value)?.nom ?? ''
    const nomFiliere = (insc.filiere as any)?.nom ?? ''
    const expiresAt = new Date(anneeEnCours + 2, 0, 1).toISOString().slice(0, 10) // +2 ans

    let qrDataUrl: string | null = null
    try {
      qrDataUrl = await QRCode.toDataURL(verifyUrl, {
        width: 220, margin: 1,
        color: { dark: '#0f285a', light: '#ffffff' }
      })
    } catch { qrDataUrl = null }

    // ── Sauvegarde automatique en DB ─────────────────────────────────
    try {
      await api.post('/attestations', {
        reference: ref,
        etudiant_nom: insc.etudiant.nom,
        etudiant_prenom: insc.etudiant.prenom,
        numero_etudiant: numEtd,
        filiere: nomFiliere,
        classe: nomClasse,
        annee_academique: String(anneeEnCours),
        type_attestation: 'reussite',
        mention: mentionInsc,
        moyenne: moyInsc,
        session: filterSession.value,
        expires_at: expiresAt,
      })
    } catch { /* non bloquant */ }

    let y = 18

    // ── 6. Logo centré en haut ────────────────────────────────────────
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', cx - 30, y, 60, 20) } catch { /* skip */ }
      y += 24
    } else {
      doc.setFontSize(18); doc.setFont('times', 'bold'); doc.setTextColor(...NAVY)
      doc.text("UP'TECH", cx, y + 10, { align: 'center' })
      doc.setTextColor(0,0,0); y += 18
    }

    // ── 7. Ligne or fine sous logo ────────────────────────────────────
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.5)
    doc.line(mL + 10, y, PW - mR - 10, y); y += 5

    // ── 8. En-tête institution ────────────────────────────────────────
    doc.setTextColor(...NAVY); doc.setFont('times', 'bold'); doc.setFontSize(9)
    doc.text("Institut Superieur de Formation aux Nouveaux Metiers de l'Informatique et de la Communication", cx, y, { align: 'center' })
    y += 5
    doc.setFont('times', 'normal'); doc.setFontSize(7.5); doc.setTextColor(60,60,60)
    doc.text('NINEA 006118310  |  BP 50281 RP DAKAR  |  Agree par l\'Etat : N\u00B000014191/MFPAA/SG/DFPT  |  RepSEN/Ensup-priv/AP/387-2021', cx, y, { align: 'center' })
    y += 9; doc.setTextColor(0,0,0)

    // ── 9. Bandeau titre navy ─────────────────────────────────────────
    doc.setFillColor(...NAVY)
    doc.rect(mL + 2, y, PW - mL - mR - 4, 13, 'F')
    // Liseré or au dessus et dessous du bandeau
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6)
    doc.line(mL + 2, y, PW - mR - 2, y)
    doc.line(mL + 2, y + 13, PW - mR - 2, y + 13)
    // Texte blanc
    doc.setTextColor(255,255,255); doc.setFontSize(17); doc.setFont('times', 'bold')
    doc.text('ATTESTATION  DE  REUSSITE', cx, y + 9, { align: 'center' })
    doc.setTextColor(0,0,0); y += 19

    // ── 10. REF + sécurité ────────────────────────────────────────────
    doc.setFontSize(8.5); doc.setFont('times', 'normal'); doc.setTextColor(...NAVY)
    doc.text(`REF : ${ref}`, mL + 4, y)
    doc.setTextColor(150,150,150); doc.setFontSize(7)
    doc.text(`CODE : ${secHash}`, PW - mR - 4, y, { align: 'right' })
    doc.setTextColor(0,0,0); y += 10

    // ── 11. Corps du texte ────────────────────────────────────────────
    const filiereLabel = (insc as any).filiere?.nom ?? (insc as any).classe?.filiere?.nom ?? '—'
    const niveauLabel  = (insc as any).niveau_entree?.nom ?? '—'
    const anneeLabel   = (insc as any).annee_academique?.libelle ?? `${anneeEnCours-1}-${anneeEnCours}`

    doc.setFontSize(11); doc.setFont('times', 'normal')
    const introLines = doc.splitTextToSize(
      "Nous, soussignes, Institut Superieur de Formation aux Nouveaux Metiers de l'Informatique et de la communication (UP'TECH) attestons que :",
      PW - mL - mR - 8
    )
    doc.text(introLines, mL + 4, y); y += introLines.length * 6 + 5

    // Nom — navy gras grand
    doc.setFontSize(16); doc.setFont('times', 'bold'); doc.setTextColor(...NAVY)
    doc.text(nomEtd, cx, y, { align: 'center' })
    // Ligne décorative sous le nom
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    const nw = doc.getTextWidth(nomEtd)
    doc.line(cx - nw/2, y + 1.5, cx + nw/2, y + 1.5)
    doc.setTextColor(0,0,0); y += 9

    // né(e) le
    const dateNaiss = (insc as any).etudiant?.date_naissance
      ? new Date((insc as any).etudiant.date_naissance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : null
    const lieuNaiss = (insc as any).etudiant?.lieu_naissance ?? null
    if (dateNaiss || lieuNaiss) {
      doc.setFontSize(11); doc.setFont('times', 'normal')
      let xc = mL + 4
      doc.text('ne(e) le', xc, y); xc += doc.getTextWidth('ne(e) le') + 3
      if (dateNaiss) { doc.setFont('times', 'bold'); doc.text(dateNaiss, xc, y); xc += doc.getTextWidth(dateNaiss) + 3; doc.setFont('times', 'normal') }
      if (lieuNaiss) { doc.text('a', xc, y); xc += doc.getTextWidth('a') + 3; doc.setFont('times', 'bold'); doc.text(`${lieuNaiss.toUpperCase()} (SENEGAL)`, xc, y); doc.setFont('times', 'normal') }
      y += 10
    } else { y += 4 }

    // a régulièrement suivi
    const suiviLines = doc.splitTextToSize(
      `a regulierement suivi notre programme de formation en ${filiereLabel} et satisfait aux conditions d'obtention de la ${niveauLabel}`,
      PW - mL - mR - 8
    )
    doc.setFontSize(11); doc.setFont('times', 'normal')
    doc.text(suiviLines, mL + 4, y); y += suiviLines.length * 6 + 8

    // ── 12. Tableau détails (fond léger) ──────────────────────────────
    const moy  = moyennePonderee(insc.id)
    const ment = mention(moy)
    const sessionLabel = filterSession.value === 'rattrapage' ? 'Deuxieme' : 'Premiere'
    const details: [string, string][] = [
      ['Specialite :', filiereLabel],
      ['Session    :', sessionLabel],
      ['Mention    :', ment],
    ]
    const padI = 5  // padding intérieur du cadre

    // Trait séparateur au-dessus du bloc
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.5)
    doc.line(mL + 4, y - 3, mL + 4 + 105, y - 3)
    y += 3
    const tabH = details.length * 8 + padI * 2
    doc.setFillColor(...LIGHT_GOLD)
    doc.rect(mL + 4, y - padI, 105, tabH, 'F')
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    doc.rect(mL + 4, y - padI, 105, tabH)
    for (const [label, valeur] of details) {
      doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(80,80,80)
      doc.text(label, mL + 4 + padI, y)
      doc.setFont('times', 'bold'); doc.setTextColor(...NAVY)
      doc.text(valeur, mL + 4 + padI + 42, y)
      doc.setTextColor(0,0,0); y += 8
    }
    y += padI + 8

    // ── 13. En foi de quoi ────────────────────────────────────────────
    const enFoiLines = doc.splitTextToSize(
      'En foi de quoi, la presente attestation lui est delivree pour servir et valoir ce que de droit.',
      PW - mL - mR - 8
    )
    doc.setFontSize(11); doc.setFont('times', 'normal'); doc.setTextColor(0,0,0)
    doc.text(enFoiLines, mL + 4, y); y += enFoiLines.length * 6 + 12

    // ── 14. Sceau + Signature ─────────────────────────────────────────
    const sealCX = PW - mR - 28
    const sealCY = y + 8
    attSeal(doc, sealCX, sealCY, NAVY, GOLD, anneeLabel)

    const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    doc.setFontSize(10); doc.setFont('times', 'normal'); doc.setTextColor(0,0,0)
    doc.text(`Fait a Dakar, le ${today}`, mL + 4, y)
    y += 6; doc.setFont('times', 'bold')
    doc.text('Le Directeur General', mL + 4, y)
    y += 22
    doc.setLineWidth(0.4); doc.setDrawColor(...NAVY)
    doc.line(mL + 4, y, mL + 60, y)

    // ── 15. QR code + validité ────────────────────────────────────────
    const qrSize = 26
    const qrY = PH - 50
    if (qrDataUrl) {
      try { doc.addImage(qrDataUrl, 'PNG', mL + 4, qrY, qrSize, qrSize) } catch { /* skip */ }
    } else {
      doc.setDrawColor(...NAVY); doc.setLineWidth(0.4); doc.rect(mL + 4, qrY, qrSize, qrSize)
    }
    doc.setFontSize(7); doc.setFont('times', 'bold'); doc.setTextColor(...NAVY)
    doc.text('Verifier l\'authenticite sur :', mL + qrSize + 7, qrY + 5)
    doc.setFont('times', 'normal'); doc.setTextColor(60,60,60)
    doc.text(verifyUrl, mL + qrSize + 7, qrY + 10)
    doc.setFont('times', 'italic')
    doc.text('Duree de validite : 2 ans', mL + qrSize + 7, qrY + 16)
    doc.text('www.uptechformation.com', mL + qrSize + 7, qrY + 21)
    doc.setTextColor(0,0,0)

    // ── 16. Ligne pointillée + footer ─────────────────────────────────
    const footerY = PH - 14
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    for (let x = mL + 4; x < PW - mR - 4; x += 5) {
      doc.line(x, footerY - 4, Math.min(x + 2.5, PW - mR - 4), footerY - 4)
    }
    doc.setFontSize(6.5); doc.setFont('times', 'normal'); doc.setTextColor(80,80,80)
    doc.text(
      'Sicap Amitie 1, Villa N\u00B03031 _ Tel : 33 821 34 25  |  (+221) 77 841 50 44  |  uptechformation@gmail.com  |  www.uptechformation.com',
      cx, footerY, { align: 'center' }
    )
    // Microtext anti-copie (hash visible seulement à la loupe)
    doc.setFontSize(3.5); doc.setTextColor(180,180,180)
    const microtext = `${secHash} UPTECH-CAMPUS-OFFICIEL `.repeat(18)
    doc.text(microtext.substring(0, 200), cx, footerY + 5, { align: 'center' })
    doc.setTextColor(0,0,0)
  }

  const nomClasse = classes.value.find(c => String(c.id) === filterClasse.value)?.nom ?? 'Classe'
  doc.save(`attestations-${nomClasse.replace(/\s+/g,'-')}.pdf`)
}

// ── Certificat de réussite — Formation Certifiée (avec jury) ─────────────────
async function exportCertificatsFC() {
  const admisInscriptions = [...inscriptions.value]
    .sort((a, b) => (moyennePonderee(b.id) ?? -1) - (moyennePonderee(a.id) ?? -1))
    .filter(i => getJuryDecision(i.id) === 'admis')
  if (!admisInscriptions.length) { alert('Aucun étudiant admis.'); return }

  const { jsPDF } = await import('jspdf')
  const QRCode = (await import('qrcode')).default
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })

  const NAVY: [number,number,number]       = [15, 40, 90]
  const GOLD: [number,number,number]       = [180, 145, 60]
  const LIGHT_GOLD: [number,number,number] = [245, 238, 210]
  const LIGHT_NAVY: [number,number,number] = [220, 220, 220]
  const BURGUNDY: [number,number,number]   = [100, 20, 20]  // couleur distincte FC

  let logoDataUrl: string | null = null
  try {
    const resp = await fetch('/logo-normal.png')
    if (resp.ok) {
      const blob = await resp.blob()
      logoDataUrl = await new Promise<string>((res) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result as string)
        reader.readAsDataURL(blob)
      })
    }
  } catch { logoDataUrl = null }

  const anneeEnCours = new Date().getFullYear()
  const nomClasse  = classes.value.find((c: any) => String(c.id) === filterClasse.value)?.nom ?? 'Classe'

  for (let pi = 0; pi < admisInscriptions.length; pi++) {
    const insc = admisInscriptions[pi]!
    if (!insc) continue
    if (pi > 0) doc.addPage()

    const PW = doc.internal.pageSize.getWidth()   // ~297mm en paysage
    const PH = doc.internal.pageSize.getHeight()  // ~210mm en paysage
    const mL = 20, mR = 20
    const cx = PW / 2

    // Filigrane
    doc.setTextColor(235, 238, 248); doc.setFontSize(60); doc.setFont('times', 'bold')
    doc.text("UP'TECH", cx, PH / 2, { align: 'center', angle: 35 })
    doc.setTextColor(0,0,0)

    // Hachures fond
    doc.setDrawColor(...LIGHT_NAVY); doc.setLineWidth(0.15)
    for (let d = 0; d < PW + PH; d += 10) {
      doc.line(Math.max(0, d - PH), Math.min(PH, d), Math.min(PW, d), Math.max(0, d - PW))
    }

    // Double bordure Bordeaux + Or
    doc.setFillColor(255, 255, 255)
    doc.rect(8, 8, PW - 16, PH - 16, 'F')
    doc.setDrawColor(...BURGUNDY); doc.setLineWidth(2.5)
    doc.rect(8, 8, PW - 16, PH - 16)
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6)
    doc.rect(13, 13, PW - 26, PH - 26)

    // Ornements coins
    attCornerOrnament(doc, 13, 13, 18, 1, 1, GOLD, BURGUNDY)
    attCornerOrnament(doc, PW - 13, 13, 18, -1, 1, GOLD, BURGUNDY)
    attCornerOrnament(doc, 13, PH - 13, 18, 1, -1, GOLD, BURGUNDY)
    attCornerOrnament(doc, PW - 13, PH - 13, 18, -1, -1, GOLD, BURGUNDY)

    // Référence unique
    const numEtd = (insc as any).etudiant?.numero_etudiant ?? String(insc.id)
    const ref = `CERT-FC-${anneeEnCours}-${numEtd}-${String(pi + 1).padStart(3, '0')}`
    const verifyUrl = `https://uptechcampus.vercel.app/verify-attestation/${ref}`
    const nomEtd = `${(insc as any).etudiant.prenom} ${(insc as any).etudiant.nom.toUpperCase()}`
    const secHash = attSecurityHash(ref + nomEtd)

    let qrDataUrl: string | null = null
    try {
      qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 220, margin: 1, color: { dark: '#640a0a', light: '#ffffff' } })
    } catch { qrDataUrl = null }

    // Sauvegarde DB
    const moyInsc = moyennePonderee(insc.id)
    const mentionInsc = moyInsc != null ? mention(moyInsc) : null
    try {
      await api.post('/attestations', {
        reference: ref,
        etudiant_nom: (insc as any).etudiant.nom,
        etudiant_prenom: (insc as any).etudiant.prenom,
        numero_etudiant: numEtd,
        filiere: (insc as any).filiere?.nom ?? '',
        classe: nomClasse,
        annee_academique: String(anneeEnCours),
        type_attestation: 'certificat',
        mention: mentionInsc,
        moyenne: moyInsc,
        session: filterSession.value,
        expires_at: new Date(anneeEnCours + 2, 0, 1).toISOString().slice(0, 10),
      })
    } catch { /* non bloquant */ }

    let y = 18

    // Logo
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', cx - 30, y, 60, 18) } catch { /* skip */ }
      y += 22
    } else {
      doc.setFontSize(18); doc.setFont('times', 'bold'); doc.setTextColor(...BURGUNDY)
      doc.text("UP'TECH", cx, y + 10, { align: 'center' })
      doc.setTextColor(0,0,0); y += 16
    }

    // Ligne or
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.5)
    doc.line(mL + 10, y, PW - mR - 10, y); y += 4

    // En-tête institution (plus compact en paysage)
    doc.setTextColor(...NAVY); doc.setFont('times', 'bold'); doc.setFontSize(8.5)
    doc.text("Institut Superieur de Formation aux Nouveaux Metiers de l'Informatique et de la Communication", cx, y, { align: 'center' })
    y += 4.5
    doc.setFont('times', 'normal'); doc.setFontSize(7); doc.setTextColor(60,60,60)
    doc.text("NINEA 006118310  |  BP 50281 RP DAKAR  |  Agree par l'Etat : N\u00B000014191/MFPAA/SG/DFPT  |  RepSEN/Ensup-priv/AP/387-2021", cx, y, { align: 'center' })
    y += 7; doc.setTextColor(0,0,0)

    // Bandeau titre bordeaux
    doc.setFillColor(...BURGUNDY)
    doc.rect(mL + 2, y, PW - mL - mR - 4, 14, 'F')
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6)
    doc.line(mL + 2, y, PW - mR - 2, y)
    doc.line(mL + 2, y + 14, PW - mR - 2, y + 14)
    doc.setTextColor(255,255,255); doc.setFontSize(19); doc.setFont('times', 'bold')
    doc.text('CERTIFICAT  DE  REUSSITE', cx, y + 10, { align: 'center' })
    doc.setTextColor(0,0,0); y += 20

    // REF + sécurité
    doc.setFontSize(8); doc.setFont('times', 'normal'); doc.setTextColor(...BURGUNDY)
    doc.text(`REF : ${ref}`, mL + 4, y)
    doc.setTextColor(150,150,150); doc.setFontSize(7)
    doc.text(`CODE : ${secHash}`, PW - mR - 4, y, { align: 'right' })
    doc.setTextColor(0,0,0); y += 9

    // Corps texte
    const filiereLabel = (insc as any).filiere?.nom ?? (insc as any).classe?.filiere?.nom ?? '—'
    const niveauLabel  = (insc as any).niveau_entree?.nom ?? '—'
    const anneeLabel   = (insc as any).annee_academique?.libelle ?? `${anneeEnCours-1}-${anneeEnCours}`

    doc.setFontSize(11); doc.setFont('times', 'normal')
    const introLines = doc.splitTextToSize(
      "Nous, soussignes, Institut Superieur de Formation aux Nouveaux Metiers de l'Informatique et de la communication (UP'TECH) certifions que :",
      PW - mL - mR - 8
    )
    doc.text(introLines, mL + 4, y); y += introLines.length * 5.5 + 4

    // Nom étudiant
    doc.setFontSize(18); doc.setFont('times', 'bold'); doc.setTextColor(...BURGUNDY)
    doc.text(nomEtd, cx, y, { align: 'center' })
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    const nw = doc.getTextWidth(nomEtd)
    doc.line(cx - nw/2, y + 1.5, cx + nw/2, y + 1.5)
    doc.setTextColor(0,0,0); y += 8

    // né(e) le
    const dateNaiss = (insc as any).etudiant?.date_naissance
      ? new Date((insc as any).etudiant.date_naissance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : null
    const lieuNaiss = (insc as any).etudiant?.lieu_naissance ?? null
    if (dateNaiss || lieuNaiss) {
      doc.setFontSize(11); doc.setFont('times', 'normal')
      let xc = mL + 4
      doc.text('ne(e) le', xc, y); xc += doc.getTextWidth('ne(e) le') + 3
      if (dateNaiss) { doc.setFont('times', 'bold'); doc.text(dateNaiss, xc, y); xc += doc.getTextWidth(dateNaiss) + 3; doc.setFont('times', 'normal') }
      if (lieuNaiss) { doc.text('a', xc, y); xc += doc.getTextWidth('a') + 3; doc.setFont('times', 'bold'); doc.text(`${lieuNaiss.toUpperCase()} (SENEGAL)`, xc, y); doc.setFont('times', 'normal') }
      y += 8
    } else { y += 3 }

    // Texte certification
    const suiviLines = doc.splitTextToSize(
      `a suivi avec succes notre programme de formation certifiee en ${filiereLabel} (classe : ${nomClasse}), annee academique ${anneeLabel}, et a satisfait a toutes les conditions requises pour l'obtention du ${niveauLabel}.`,
      PW - mL - mR - 8
    )
    doc.setFontSize(11); doc.setFont('times', 'normal')
    doc.text(suiviLines, mL + 4, y); y += suiviLines.length * 5.5 + 6

    // Tableau détails (2 colonnes pour exploiter la largeur paysage)
    const moy  = moyennePonderee(insc.id)
    const ment = mention(moy)
    const sessionLabel = filterSession.value === 'rattrapage' ? 'Deuxieme' : 'Premiere'
    const details: [string, string][] = [
      ['Specialite :', filiereLabel],
      ['Session    :', sessionLabel],
      ['Mention    :', ment],
      ['Type       :', 'Formation Certifiee'],
    ]
    const colW = (PW - mL - mR - 8) / 2 - 5
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.5)
    doc.line(mL + 4, y - 3, mL + 4 + colW * 2 + 10, y - 3)
    y += 3
    const tabH = Math.ceil(details.length / 2) * 8 + 10
    doc.setFillColor(...LIGHT_GOLD)
    doc.rect(mL + 4, y - 5, colW * 2 + 10, tabH, 'F')
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    doc.rect(mL + 4, y - 5, colW * 2 + 10, tabH)
    // 2 colonnes : gauche col 0,2 / droite col 1,3
    const leftPairs  = details.filter((_, i) => i % 2 === 0)
    const rightPairs = details.filter((_, i) => i % 2 === 1)
    const maxRows = Math.max(leftPairs.length, rightPairs.length)
    for (let ri = 0; ri < maxRows; ri++) {
      const yRow = y + ri * 8
      if (leftPairs[ri]) {
        const [lbl, val] = leftPairs[ri]!
        doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(80,80,80)
        doc.text(lbl, mL + 4 + 5, yRow)
        doc.setFont('times', 'bold'); doc.setTextColor(...BURGUNDY)
        doc.text(val, mL + 4 + 5 + 38, yRow)
      }
      if (rightPairs[ri]) {
        const [lbl, val] = rightPairs[ri]!
        doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(80,80,80)
        doc.text(lbl, mL + 4 + colW + 10, yRow)
        doc.setFont('times', 'bold'); doc.setTextColor(...BURGUNDY)
        doc.text(val, mL + 4 + colW + 10 + 38, yRow)
      }
    }
    doc.setTextColor(0,0,0)
    y += tabH + 5

    // En foi de quoi + signature + sceau sur même ligne
    const enFoiLines = doc.splitTextToSize(
      'En foi de quoi, le present certificat lui est delivre pour servir et valoir ce que de droit.',
      (PW - mL - mR) * 0.55
    )
    doc.setFontSize(11); doc.setFont('times', 'normal')
    doc.text(enFoiLines, mL + 4, y); y += enFoiLines.length * 5.5 + 5

    const todayStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    doc.setFontSize(10); doc.setFont('times', 'normal')
    doc.text(`Fait a Dakar, le ${todayStr}`, mL + 4, y)
    y += 5; doc.setFont('times', 'bold')
    doc.text('Le Directeur General', mL + 4, y)
    y += 14
    doc.setLineWidth(0.4); doc.setDrawColor(...BURGUNDY)
    doc.line(mL + 4, y, mL + 55, y)

    // Sceau à droite du bloc signature
    const sealCX = PW - mR - 35
    const sealCY = y - 14
    attSeal(doc, sealCX, sealCY, BURGUNDY, GOLD, anneeLabel)

    // QR code en bas à droite
    const qrSize = 24
    const qrY = PH - 42
    if (qrDataUrl) {
      try { doc.addImage(qrDataUrl, 'PNG', mL + 4, qrY, qrSize, qrSize) } catch { /* skip */ }
    } else {
      doc.setDrawColor(...BURGUNDY); doc.setLineWidth(0.4); doc.rect(mL + 4, qrY, qrSize, qrSize)
    }
    doc.setFontSize(7); doc.setFont('times', 'bold'); doc.setTextColor(...BURGUNDY)
    doc.text("Verifier l'authenticite sur :", mL + qrSize + 5, qrY + 5)
    doc.setFont('times', 'normal'); doc.setTextColor(60,60,60)
    doc.text(verifyUrl, mL + qrSize + 5, qrY + 10)
    doc.setFont('times', 'italic')
    doc.text('Duree de validite : 2 ans  |  www.uptechformation.com', mL + qrSize + 5, qrY + 16)
    doc.setTextColor(0,0,0)

    // Footer
    const footerY = PH - 13
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    for (let x = mL + 4; x < PW - mR - 4; x += 5) {
      doc.line(x, footerY - 4, Math.min(x + 2.5, PW - mR - 4), footerY - 4)
    }
    doc.setFontSize(6.5); doc.setFont('times', 'normal'); doc.setTextColor(80,80,80)
    doc.text(
      'Sicap Amitie 1, Villa N\u00B03031 _ Tel : 33 821 34 25  |  (+221) 77 841 50 44  |  uptechformation@gmail.com  |  www.uptechformation.com',
      cx, footerY, { align: 'center' }
    )
    doc.setFontSize(3.5); doc.setTextColor(180,180,180)
    const microtext = `${secHash} UPTECH-CAMPUS-OFFICIEL `.repeat(22)
    doc.text(microtext.substring(0, 250), cx, footerY + 5, { align: 'center' })
    doc.setTextColor(0,0,0)
  }

  doc.save(`certificats-FC-${nomClasse.replace(/\s+/g,'-')}.pdf`)
}

// ── Attestation de formation — Formation Accélérée (sans notes, sans jury) ───
async function exportAttestationsFA() {
  const inscritsActifs = inscriptions.value.filter((i: any) =>
    ['inscrit_actif', 'pre_inscrit'].includes(i.statut)
  )
  if (!inscritsActifs.length) { alert('Aucun étudiant inscrit dans cette classe.'); return }

  const { jsPDF } = await import('jspdf')
  const QRCode = (await import('qrcode')).default
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

  const NAVY: [number,number,number] = [0, 0, 0]
  const GOLD: [number,number,number] = [180, 145, 60]
  const LIGHT_GOLD: [number,number,number] = [245, 238, 210]
  const LIGHT_NAVY: [number,number,number] = [220, 220, 220]

  // Charger logo
  let logoDataUrl: string | null = null
  try {
    const resp = await fetch('/logo-normal.png')
    if (resp.ok) {
      const blob = await resp.blob()
      logoDataUrl = await new Promise<string>((res) => {
        const reader = new FileReader()
        reader.onload = () => res(reader.result as string)
        reader.readAsDataURL(blob)
      })
    }
  } catch { logoDataUrl = null }

  const anneeEnCours = new Date().getFullYear()
  const nomClasse = classes.value.find((c: any) => String(c.id) === filterClasse.value)?.nom ?? 'Classe'

  for (let pi = 0; pi < inscritsActifs.length; pi++) {
    const insc = inscritsActifs[pi]!
    if (pi > 0) doc.addPage()

    const PW = doc.internal.pageSize.getWidth()
    const PH = doc.internal.pageSize.getHeight()
    const mL = 18, mR = 18
    const cx = PW / 2

    // Filigrane
    doc.setTextColor(235, 238, 248); doc.setFontSize(52); doc.setFont('times', 'bold')
    doc.text("UP'TECH", cx, PH / 2 + 20, { align: 'center', angle: 45 })
    doc.setTextColor(0,0,0)

    // Hachures fond
    doc.setDrawColor(...LIGHT_NAVY); doc.setLineWidth(0.15)
    for (let d = 0; d < PW + PH; d += 10) {
      doc.line(Math.max(0, d - PH), Math.min(PH, d), Math.min(PW, d), Math.max(0, d - PW))
    }

    // Double bordure
    doc.setFillColor(255, 255, 255)
    doc.rect(8, 8, PW - 16, PH - 16, 'F')
    doc.setDrawColor(...NAVY); doc.setLineWidth(2.5)
    doc.rect(8, 8, PW - 16, PH - 16)
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6)
    doc.rect(13, 13, PW - 26, PH - 26)

    // Ornements coins
    attCornerOrnament(doc, 13, 13, 18, 1, 1, GOLD, NAVY)
    attCornerOrnament(doc, PW - 13, 13, 18, -1, 1, GOLD, NAVY)
    attCornerOrnament(doc, 13, PH - 13, 18, 1, -1, GOLD, NAVY)
    attCornerOrnament(doc, PW - 13, PH - 13, 18, -1, -1, GOLD, NAVY)

    // Référence unique
    const numEtd = (insc as any).etudiant?.numero_etudiant ?? String(insc.id)
    const ref = `ATT-FA-${anneeEnCours}-${numEtd}-${String(pi + 1).padStart(3, '0')}`
    const verifyUrl = `https://uptechcampus.vercel.app/verify-attestation/${ref}`
    const nomEtd = `${(insc as any).etudiant.prenom} ${(insc as any).etudiant.nom.toUpperCase()}`
    const secHash = attSecurityHash(ref + nomEtd)

    let qrDataUrl: string | null = null
    try {
      qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 220, margin: 1, color: { dark: '#0f285a', light: '#ffffff' } })
    } catch { qrDataUrl = null }

    // Sauvegarde DB
    try {
      await api.post('/attestations', {
        reference: ref,
        etudiant_nom: (insc as any).etudiant.nom,
        etudiant_prenom: (insc as any).etudiant.prenom,
        numero_etudiant: numEtd,
        filiere: (insc as any).filiere?.nom ?? '',
        classe: nomClasse,
        annee_academique: String(anneeEnCours),
        type_attestation: 'formation',
        expires_at: new Date(anneeEnCours + 2, 0, 1).toISOString().slice(0, 10),
      })
    } catch { /* non bloquant */ }

    let y = 18

    // Logo
    if (logoDataUrl) {
      try { doc.addImage(logoDataUrl, 'PNG', cx - 30, y, 60, 20) } catch { /* skip */ }
      y += 24
    } else {
      doc.setFontSize(18); doc.setFont('times', 'bold'); doc.setTextColor(...NAVY)
      doc.text("UP'TECH", cx, y + 10, { align: 'center' })
      doc.setTextColor(0,0,0); y += 18
    }

    // Ligne or
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.5)
    doc.line(mL + 10, y, PW - mR - 10, y); y += 5

    // En-tête institution
    doc.setTextColor(...NAVY); doc.setFont('times', 'bold'); doc.setFontSize(9)
    doc.text("Institut Superieur de Formation aux Nouveaux Metiers de l'Informatique et de la Communication", cx, y, { align: 'center' })
    y += 5
    doc.setFont('times', 'normal'); doc.setFontSize(7.5); doc.setTextColor(60,60,60)
    doc.text("NINEA 006118310  |  BP 50281 RP DAKAR  |  Agree par l'Etat : N\u00B000014191/MFPAA/SG/DFPT  |  RepSEN/Ensup-priv/AP/387-2021", cx, y, { align: 'center' })
    y += 9; doc.setTextColor(0,0,0)

    // Bandeau titre — vert foncé pour distinguer des réussites
    const TEAL: [number,number,number] = [5, 90, 70]
    doc.setFillColor(...TEAL)
    doc.rect(mL + 2, y, PW - mL - mR - 4, 13, 'F')
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.6)
    doc.line(mL + 2, y, PW - mR - 2, y)
    doc.line(mL + 2, y + 13, PW - mR - 2, y + 13)
    doc.setTextColor(255,255,255); doc.setFontSize(17); doc.setFont('times', 'bold')
    doc.text('ATTESTATION  DE  FORMATION', cx, y + 9, { align: 'center' })
    doc.setTextColor(0,0,0); y += 19

    // REF + sécurité
    doc.setFontSize(8.5); doc.setFont('times', 'normal'); doc.setTextColor(...NAVY)
    doc.text(`REF : ${ref}`, mL + 4, y)
    doc.setTextColor(150,150,150); doc.setFontSize(7)
    doc.text(`CODE : ${secHash}`, PW - mR - 4, y, { align: 'right' })
    doc.setTextColor(0,0,0); y += 10

    // Corps texte
    const filiereLabel = (insc as any).filiere?.nom ?? (insc as any).classe?.filiere?.nom ?? '—'
    const anneeLabel   = (insc as any).annee_academique?.libelle ?? `${anneeEnCours-1}-${anneeEnCours}`

    doc.setFontSize(11); doc.setFont('times', 'normal')
    const introLines = doc.splitTextToSize(
      "Nous, soussignes, Institut Superieur de Formation aux Nouveaux Metiers de l'Informatique et de la communication (UP'TECH) attestons que :",
      PW - mL - mR - 8
    )
    doc.text(introLines, mL + 4, y); y += introLines.length * 6 + 5

    // Nom étudiant
    doc.setFontSize(16); doc.setFont('times', 'bold'); doc.setTextColor(...NAVY)
    doc.text(nomEtd, cx, y, { align: 'center' })
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    const nw = doc.getTextWidth(nomEtd)
    doc.line(cx - nw/2, y + 1.5, cx + nw/2, y + 1.5)
    doc.setTextColor(0,0,0); y += 9

    // Date/lieu naissance
    const dateNaiss = (insc as any).etudiant?.date_naissance
      ? new Date((insc as any).etudiant.date_naissance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : null
    const lieuNaiss = (insc as any).etudiant?.lieu_naissance ?? null
    if (dateNaiss || lieuNaiss) {
      doc.setFontSize(11); doc.setFont('times', 'normal')
      let xc = mL + 4
      doc.text('ne(e) le', xc, y); xc += doc.getTextWidth('ne(e) le') + 3
      if (dateNaiss) { doc.setFont('times', 'bold'); doc.text(dateNaiss, xc, y); xc += doc.getTextWidth(dateNaiss) + 3; doc.setFont('times', 'normal') }
      if (lieuNaiss) { doc.text('a', xc, y); xc += doc.getTextWidth('a') + 3; doc.setFont('times', 'bold'); doc.text(`${lieuNaiss.toUpperCase()} (SENEGAL)`, xc, y); doc.setFont('times', 'normal') }
      y += 10
    } else { y += 4 }

    // Texte formation
    const suiviLines = doc.splitTextToSize(
      `a regulierement suivi et valide notre programme de formation acceleree en ${filiereLabel} (classe : ${nomClasse}), annee academique ${anneeLabel}.`,
      PW - mL - mR - 8
    )
    doc.setFontSize(11); doc.setFont('times', 'normal')
    doc.text(suiviLines, mL + 4, y); y += suiviLines.length * 6 + 8

    // Tableau détails
    const details: [string, string][] = [
      ['Specialite :', filiereLabel],
      ['Classe     :', nomClasse],
      ['Annee acad.:', anneeLabel],
      ['Type       :', 'Formation Acceleree'],
    ]
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.5)
    doc.line(mL + 4, y - 3, mL + 4 + 105, y - 3)
    y += 3
    const tabH = details.length * 8 + 10
    doc.setFillColor(...LIGHT_GOLD)
    doc.rect(mL + 4, y - 5, 105, tabH, 'F')
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    doc.rect(mL + 4, y - 5, 105, tabH)
    for (const [label, valeur] of details) {
      doc.setFont('times', 'normal'); doc.setFontSize(11); doc.setTextColor(80,80,80)
      doc.text(label, mL + 4 + 5, y)
      doc.setFont('times', 'bold'); doc.setTextColor(...NAVY)
      doc.text(valeur, mL + 4 + 5 + 42, y)
      doc.setTextColor(0,0,0); y += 8
    }
    y += 13

    // En foi de quoi
    const enFoiLines = doc.splitTextToSize(
      'En foi de quoi, la presente attestation lui est delivree pour servir et valoir ce que de droit.',
      PW - mL - mR - 8
    )
    doc.setFontSize(11); doc.setFont('times', 'normal'); doc.setTextColor(0,0,0)
    doc.text(enFoiLines, mL + 4, y); y += enFoiLines.length * 6 + 12

    // Sceau + signature
    const sealCX = PW - mR - 28
    const sealCY = y + 8
    attSeal(doc, sealCX, sealCY, NAVY, GOLD, anneeLabel)
    const todayStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    doc.setFontSize(10); doc.setFont('times', 'normal'); doc.setTextColor(0,0,0)
    doc.text(`Fait a Dakar, le ${todayStr}`, mL + 4, y)
    y += 6; doc.setFont('times', 'bold')
    doc.text('Le Directeur General', mL + 4, y)
    y += 22
    doc.setLineWidth(0.4); doc.setDrawColor(...NAVY)
    doc.line(mL + 4, y, mL + 60, y)

    // QR code
    const qrSize = 26
    const qrY = PH - 50
    if (qrDataUrl) {
      try { doc.addImage(qrDataUrl, 'PNG', mL + 4, qrY, qrSize, qrSize) } catch { /* skip */ }
    } else {
      doc.setDrawColor(...NAVY); doc.setLineWidth(0.4); doc.rect(mL + 4, qrY, qrSize, qrSize)
    }
    doc.setFontSize(7); doc.setFont('times', 'bold'); doc.setTextColor(...NAVY)
    doc.text("Verifier l'authenticite sur :", mL + qrSize + 7, qrY + 5)
    doc.setFont('times', 'normal'); doc.setTextColor(60,60,60)
    doc.text(verifyUrl, mL + qrSize + 7, qrY + 10)
    doc.setFont('times', 'italic')
    doc.text('Duree de validite : 2 ans', mL + qrSize + 7, qrY + 16)
    doc.text('www.uptechformation.com', mL + qrSize + 7, qrY + 21)
    doc.setTextColor(0,0,0)

    // Footer
    const footerY = PH - 14
    doc.setDrawColor(...GOLD); doc.setLineWidth(0.4)
    for (let x = mL + 4; x < PW - mR - 4; x += 5) {
      doc.line(x, footerY - 4, Math.min(x + 2.5, PW - mR - 4), footerY - 4)
    }
    doc.setFontSize(6.5); doc.setFont('times', 'normal'); doc.setTextColor(80,80,80)
    doc.text(
      'Sicap Amitie 1, Villa N\u00B03031 _ Tel : 33 821 34 25  |  (+221) 77 841 50 44  |  uptechformation@gmail.com  |  www.uptechformation.com',
      cx, footerY, { align: 'center' }
    )
    doc.setFontSize(3.5); doc.setTextColor(180,180,180)
    const microtext = `${secHash} UPTECH-CAMPUS-OFFICIEL `.repeat(18)
    doc.text(microtext.substring(0, 200), cx, footerY + 5, { align: 'center' })
    doc.setTextColor(0,0,0)
  }

  doc.save(`attestations-FA-${nomClasse.replace(/\s+/g,'-')}.pdf`)
}

watch(activeTab, (tab) => {
  if (tab === 'jury') loadJury()
})

watch(filterClasse, () => {
  if (activeTab.value === 'jury') loadJury()
})

watch(filterSession, () => {
  if (activeTab.value === 'jury') loadJury()
})
</script>

<template>
  <div class="uc-content">

    <UcPageHeader
      title="Notes & Bulletins"
      :subtitle="isEnseignant ? `Saisie des notes — ${monProfil?.mes_ues.length ?? 0} matière(s) assignée(s)` : 'Saisie des notes, jury et édition des bulletins'"
    />

    <!-- Bandeau info pour le prof (redesign) -->
    <div v-if="isEnseignant && monProfil" class="nb-prof-banner">
      <div class="nb-prof-banner-icon">👨‍🏫</div>
      <div>
        <div class="nb-prof-banner-title">Mode enseignant</div>
        <div class="nb-prof-banner-sub">
          Vos matières dans cette classe :
          <strong>{{ ues.filter(u => u.enseignant && Number((u.enseignant as any).id) === Number(monProfil?.id)).map(u => u.intitule).join(' · ') || 'Toutes (non restreintes)' }}</strong>
        </div>
        <div class="nb-prof-banner-hint">🔒 Les colonnes grisées appartiennent à d'autres enseignants</div>
      </div>
    </div>

    <!-- Toolbar modernisée -->
    <div class="nb-toolbar">
      <div class="nb-toolbar-left">
        <select v-if="!isEnseignant && anneesAcademiques.length" v-model="filterAnneeNotes" class="nb-select" style="font-weight:600;color:#E30613;" @change="filterClasse=''">
          <option value="">📅 Toutes les années</option>
          <option v-for="a in anneesAcademiques" :key="a.id" :value="String(a.id)">{{ a.libelle }}{{ a.actif ? ' ✓' : '' }}</option>
        </select>
        <select v-model="filterClasse" class="nb-select">
          <option value="">🏫 Sélectionner une classe…</option>
          <option v-for="c in classesFiltreesParAnnee" :key="c.id" :value="String(c.id)">
            {{ c.nom }}{{ c.annee_academique && !filterAnneeNotes ? ` (${c.annee_academique})` : '' }}
          </option>
        </select>
        <!-- Session toggle pill -->
        <div class="nb-session-toggle">
          <button @click="filterSession='normale'" :class="['nb-session-btn', filterSession==='normale' ? 'nb-session-btn--active' : '']">Session normale</button>
          <button @click="filterSession='rattrapage'" :class="['nb-session-btn', filterSession==='rattrapage' ? 'nb-session-btn--rattrapage' : '']">Rattrapage</button>
        </div>
      </div>
      <button v-if="canWrite && filterClasse" @click="openUeCreate" class="nb-btn-ues">⚙ Matières & Groupes</button>
    </div>

    <!-- Tabs pill modernes -->
    <div class="nb-tabs">
      <button @click="activeTab='saisie'" :class="['nb-tab', activeTab==='saisie' ? 'nb-tab--active' : '']">
        <span class="nb-tab-icon">✏️</span> Saisie des notes
      </button>
      <button v-if="!isEnseignant" @click="activeTab='jury'" :class="['nb-tab', activeTab==='jury' ? 'nb-tab--active' : '']">
        <span class="nb-tab-icon">🏆</span> Jury
      </button>
      <button v-if="!isEnseignant" @click="activeTab='bulletins'" :class="['nb-tab', activeTab==='bulletins' ? 'nb-tab--active' : '']">
        <span class="nb-tab-icon">📄</span> Bulletins
      </button>
    </div>

    <div v-if="!filterClasse" class="nb-empty-state">
      <div style="font-size:40px;margin-bottom:12px;">🏫</div>
      <div style="font-size:15px;font-weight:600;color:#444;margin-bottom:6px;">Sélectionnez une classe</div>
      <div style="font-size:13px;color:#aaa;">Choisissez une classe dans la liste pour accéder aux notes.</div>
    </div>

    <!-- TAB SAISIE -->
    <div v-else-if="activeTab === 'saisie'">
      <div v-if="loading" class="nb-loading">Chargement…</div>
      <div v-else class="nb-saisie-wrap">
        <div class="nb-table-toolbar">
          <span class="nb-table-info">{{ inscriptions.length }} étudiant(s) · {{ uesVisible.length }} UE(s)</span>
          <!-- Filtre semestre (si plusieurs semestres configurés) -->
          <div v-if="semestresDisponibles.length > 1" class="nb-session-toggle" style="margin-left:8px;">
            <button @click="filterSemestre = null"
              :class="['nb-session-btn', filterSemestre === null ? 'nb-session-btn--active' : '']">Tous</button>
            <button v-for="s in semestresDisponibles" :key="s"
              @click="filterSemestre = s"
              :class="['nb-session-btn', filterSemestre === s ? 'nb-session-btn--active' : '']">S{{ s }}</button>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-left:auto;">
            <span v-if="saved" class="nb-saved-badge">✓ Enregistré</span>
            <button v-if="canWrite" @click="enregistrerNotes" :disabled="saving" class="nb-btn-save-notes">
              {{ saving ? '⏳ Enregistrement…' : '💾 Enregistrer tout' }}
            </button>
          </div>
        </div>
        <div v-if="!ues.length" class="nb-empty-ues">
          Aucune UE configurée.
          <button v-if="canWrite" @click="openUeCreate" class="nb-link-btn">Créer des UEs →</button>
        </div>
        <div v-else-if="!inscriptions.length" class="nb-loading">Aucun étudiant inscrit dans cette classe.</div>
        <div v-else class="nb-scroll-x">
          <table class="nb-table">
            <thead>
              <!-- Ligne groupes UE (si des groupes sont définis) -->
              <tr v-if="hasUeGroupes">
                <th class="nb-th-sticky"></th>
                <template v-for="g in uesVisibleGroupes" :key="g.code ?? '__none__'">
                  <th :colspan="g.count"
                    class="nb-th-group"
                    :style="g.code
                      ? 'background:#eef2ff;color:#4338ca;border-bottom:2px solid #c7d2fe;font-weight:700;'
                      : 'background:#f9fafb;color:#9ca3af;border-bottom:2px solid #e5e7eb;font-weight:400;font-style:italic;'">
                    {{ g.code ? `${g.code} — ${g.intitule}` : 'Sans groupe' }}
                  </th>
                </template>
                <th></th>
              </tr>
              <!-- Groupement par semestre si tous les semestres affichés et pas de groupes UE -->
              <tr v-else-if="filterSemestre === null && semestresDisponibles.length > 1">
                <th class="nb-th-sticky"></th>
                <template v-for="sem in semestresDisponibles" :key="sem">
                  <th :colspan="uesVisible.filter(u => ((u as any).semestre||1) === sem).length"
                    class="nb-th-group"
                    :style="{ background: sem===1 ? '#eff6ff' : '#f0fdf4', color: sem===1 ? '#1d4ed8' : '#15803d', borderBottom: sem===1 ? '2px solid #bfdbfe' : '2px solid #86efac' }">
                    📅 Semestre {{ sem }}
                  </th>
                </template>
                <th></th>
              </tr>
              <tr>
                <th class="nb-th-sticky nb-th-etudiant">Étudiant</th>
                <th v-for="(ue, idx) in uesVisible" :key="ue.id" class="nb-th-ue"
                  :style="{ '--ue-color': ['#6366f1','#10b981','#f97316','#3b82f6','#ec4899','#14b8a6','#f59e0b','#8b5cf6'][idx % 8] }">
                  <div class="nb-ue-header">
                    <span class="nb-ue-code">{{ ue.code }}</span>
                    <span class="nb-ue-name">{{ ue.intitule }}</span>
                    <span v-if="!isEnseignant" class="nb-ue-coef">
                      <span v-if="(parseFloat(String(ue.coefficient))||0) === 0 && (parseFloat(String(ue.credits_ects))||0) === 0"
                        style="color:#E30613;font-weight:700;" title="Coefficient et crédits à 0 — cette EC n'apparaîtra pas dans les bulletins">
                        ⚠️ Coef.0
                      </span>
                      <span v-else>
                        <template v-if="(parseFloat(String(ue.credits_ects))||0) > 0">Créd.{{ ue.credits_ects }}</template>
                        <template v-else>Coef.{{ ue.coefficient }}</template>
                      </span>
                    </span>
                    <span v-if="isEnseignant && !!monProfil && (!ue.enseignant || Number((ue.enseignant as any).id) !== Number(monProfil.id))" class="nb-ue-lock">🔒</span>
                    <button
                      v-if="!isEnseignant"
                      class="nb-ue-print-btn"
                      :disabled="generatingFiche === ue.id"
                      :title="`Imprimer fiche de notes — ${ue.intitule}`"
                      @click.stop="generateFicheNotes(ue)"
                    >
                      <span v-if="generatingFiche === ue.id">⏳</span>
                      <span v-else>🖨</span>
                    </button>
                  </div>
                </th>
                <th class="nb-th-moy">Moyenne</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(insc, rowIdx) in inscriptions" :key="insc.id" class="nb-row" :class="rowIdx % 2 === 0 ? 'nb-row--even' : 'nb-row--odd'">
                <td class="nb-td-sticky nb-td-etudiant">
                  <div class="nb-etudiant-avatar">{{ insc.etudiant.prenom[0] }}{{ insc.etudiant.nom[0] }}</div>
                  <div>
                    <div class="nb-etudiant-nom">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</div>
                    <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:2px;">
                      <div v-if="insc.filiere?.nom" class="nb-etudiant-filiere">{{ insc.filiere.nom }}</div>
                      <span v-if="isLMD(insc.id)" class="nb-badge-lmd">LMD</span>
                      <span v-else-if="insc.niveau_entree" class="nb-badge-coef">Coef.</span>
                    </div>
                  </div>
                </td>
                <td v-for="(ue, idx) in uesVisible" :key="ue.id" class="nb-td-note"
                  :style="{ background: ['#6366f1','#10b981','#f97316','#3b82f6','#ec4899','#14b8a6','#f59e0b','#8b5cf6'][idx % 8] + '11' }">
                  <div class="nb-note-cell">
                    <!-- Mode FP : 2 inputs Contrôle + Examen -->
                    <template v-if="classeEstFP && !(insc as any).niveau_entree?.est_superieur_bac">
                      <input v-model="localControles[insc.id]![ue.id]" type="number" min="0" max="20" step="0.25"
                        :disabled="!canWrite || (isEnseignant && !!monProfil && (!ue.enseignant || Number((ue.enseignant as any).id) !== Number(monProfil.id)))"
                        placeholder="CC" class="nb-note-input nb-note-input--half"
                        style="width:46%;font-size:10px;" title="Contrôle continu"
                      />
                      <input v-model="localExamens[insc.id]![ue.id]" type="number" min="0" max="20" step="0.25"
                        :disabled="!canWrite || (isEnseignant && !!monProfil && (!ue.enseignant || Number((ue.enseignant as any).id) !== Number(monProfil.id)))"
                        placeholder="Ex" class="nb-note-input nb-note-input--half"
                        style="width:46%;font-size:10px;" title="Examen final"
                      />
                      <!-- Aperçu moyenne calculée -->
                      <div style="font-size:9px;color:#6366f1;font-weight:700;text-align:center;margin-top:1px;">
                        <template v-if="localControles[insc.id]?.[ue.id] || localExamens[insc.id]?.[ue.id]">
                          {{ (() => {
                            const cc = parseFloat(localControles[insc.id]?.[ue.id] ?? '')
                            const ex = parseFloat(localExamens[insc.id]?.[ue.id] ?? '')
                            if (!isNaN(cc) && !isNaN(ex)) return ((cc + ex) / 2).toFixed(2)
                            if (!isNaN(cc)) return cc.toFixed(2)
                            if (!isNaN(ex)) return ex.toFixed(2)
                            return ''
                          })() }}
                        </template>
                      </div>
                    </template>
                    <!-- Mode LMD ou étudiant BAC dans classe mixte : 1 input -->
                    <template v-else>
                      <input
                        v-model="localNotes[insc.id]![ue.id]"
                        type="number" min="0" max="20" step="0.25"
                        :disabled="!canWrite || (isEnseignant && !!monProfil && (!ue.enseignant || Number((ue.enseignant as any).id) !== Number(monProfil.id)))"
                        :placeholder="(isEnseignant && !!monProfil && (!ue.enseignant || Number((ue.enseignant as any).id) !== Number(monProfil.id))) ? '🔒' : '—'"
                        class="nb-note-input"
                        :class="{
                          'nb-note-locked': isEnseignant && !!monProfil && (!ue.enseignant || Number((ue.enseignant as any).id) !== Number(monProfil.id)),
                          'nb-note--fail': localNotes[insc.id]?.[ue.id] !== '' && localNotes[insc.id]?.[ue.id] !== undefined && parseFloat(localNotes[insc.id]![ue.id]!) < 10,
                          'nb-note--warn': localNotes[insc.id]?.[ue.id] !== '' && localNotes[insc.id]?.[ue.id] !== undefined && parseFloat(localNotes[insc.id]![ue.id]!) >= 10 && parseFloat(localNotes[insc.id]![ue.id]!) < 14,
                          'nb-note--pass': localNotes[insc.id]?.[ue.id] !== '' && localNotes[insc.id]?.[ue.id] !== undefined && parseFloat(localNotes[insc.id]![ue.id]!) >= 14,
                        }"
                      />
                      <div class="nb-note-bar">
                        <div class="nb-note-bar-fill"
                          :style="{
                            width: localNotes[insc.id]?.[ue.id] ? Math.min(100, parseFloat(localNotes[insc.id]![ue.id]!) / 20 * 100) + '%' : '0%',
                            background: localNotes[insc.id]?.[ue.id] && parseFloat(localNotes[insc.id]![ue.id]!) >= 14 ? '#10b981' : localNotes[insc.id]?.[ue.id] && parseFloat(localNotes[insc.id]![ue.id]!) >= 10 ? '#f59e0b' : '#ef4444'
                          }">
                        </div>
                      </div>
                    </template>
                  </div>
                </td>
                <td class="nb-td-moy">
                  <div class="nb-moy-badge" :class="{
                    'nb-moy--fail': (moyennePonderee(insc.id) ?? 0) < 10 && moyennePonderee(insc.id) !== null,
                    'nb-moy--warn': (moyennePonderee(insc.id) ?? 11) >= 10 && (moyennePonderee(insc.id) ?? 11) < 14,
                    'nb-moy--pass': (moyennePonderee(insc.id) ?? 0) >= 14,
                    'nb-moy--empty': moyennePonderee(insc.id) === null,
                  }">
                    {{ moyennePonderee(insc.id)?.toFixed(2) ?? '—' }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- TAB JURY -->
    <div v-else-if="activeTab === 'jury' && !isEnseignant">
      <div v-if="loading || loadingJury" class="nb-loading">Chargement…</div>
      <div v-else-if="!inscriptions.length" class="nb-empty-state">
        <div style="font-size:36px;margin-bottom:10px;">🏆</div>
        <div style="font-size:14px;color:#888;">Aucun étudiant inscrit dans cette classe.</div>
      </div>
      <div v-else class="nb-saisie-wrap">
        <!-- Step indicator -->
        <div class="nb-jury-steps">
          <div :class="['nb-jury-step', juryStep >= 1 ? 'nb-jury-step--active' : '']" @click="juryStep=1" style="cursor:pointer">
            <span class="nb-jury-step-num">1</span>
            <span class="nb-jury-step-label">Constitution</span>
          </div>
          <div class="nb-jury-step-arrow">→</div>
          <div :class="['nb-jury-step', juryStep >= 2 ? 'nb-jury-step--active' : '']" @click="juryData && (juryStep=2)" :style="juryData ? 'cursor:pointer' : 'opacity:0.5'">
            <span class="nb-jury-step-num">2</span>
            <span class="nb-jury-step-label">Délibération</span>
          </div>
          <div class="nb-jury-step-arrow">→</div>
          <div :class="['nb-jury-step', juryStep >= 3 ? 'nb-jury-step--active' : '']" @click="juryData && (juryStep=3)" :style="juryData ? 'cursor:pointer' : 'opacity:0.5'">
            <span class="nb-jury-step-num">3</span>
            <span class="nb-jury-step-label">Clôture &amp; Documents</span>
          </div>
        </div>

        <!-- STEP 1 : Constitution du jury -->
        <div v-if="juryStep === 1" class="nb-jury-panel">
          <!-- Bannière enseignant lecture seule -->
          <div v-if="isEnseignant" class="nb-jury-warning" style="background:#f0f9ff;border-color:#bae6fd;color:#0369a1;">
            👁 Vous consultez la composition du jury en lecture seule.
          </div>
          <!-- Bannière jury clôturé (non-enseignant) -->
          <div v-else-if="juryData?.statut === 'cloture'" class="nb-jury-warning" :style="isDG ? 'background:#fef9c3;border-color:#f59e0b;color:#92400e' : ''">
            <span v-if="isDG">🔓 Jury clôturé — vous pouvez le modifier ou le rouvrir en tant que DG.</span>
            <span v-else>⚠ Ce jury est clôturé. Les informations sont en lecture seule.</span>
            <div v-if="isDG" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
              <button @click="rouvrirJury" :disabled="savingJury" class="nb-btn nb-btn--secondary" style="font-size:12px;height:30px;padding:0 12px;">
                🔓 Rouvrir le jury
              </button>
              <button @click="supprimerJury" :disabled="savingJury" class="nb-btn nb-btn--danger" style="font-size:12px;height:30px;padding:0 12px;">
                🗑 Supprimer le jury
              </button>
            </div>
          </div>
          <h3 class="nb-jury-panel-title">Constitution du jury</h3>
          <div class="nb-jury-field-row">
            <label class="nb-jury-label">Date de délibération</label>
            <input
              type="date"
              v-model="juryDateDeliberation"
              :disabled="juryData?.statut === 'cloture' && !isDG"
              class="nb-jury-date-input"
            />
          </div>
          <h4 class="nb-jury-sub-title" style="display:flex;align-items:center;justify-content:space-between;">
            <span>Membres du jury</span>
            <button
              v-if="!isEnseignant && enseignantsSuggests.length > 0"
              class="nb-jury-btn-suggests"
              :disabled="loadingSuggests"
              @click="appliquerSuggests"
              title="Recharger automatiquement depuis les enseignants de cette classe"
            >
              {{ loadingSuggests ? '…' : '↺' }} {{ enseignantsSuggests.length }} enseignant(s) identifié(s)
            </button>
            <span v-else-if="loadingSuggests" style="font-size:11px;color:#aaa">Chargement…</span>
            <span v-else style="font-size:11px;color:#aaa;font-weight:400">Aucun enseignant trouvé</span>
          </h4>

          <!-- Badges des enseignants de la classe -->
          <div v-if="enseignantsSuggests.length" class="nb-jury-suggests-list">
            <span
              v-for="e in enseignantsSuggests" :key="e.id"
              class="nb-jury-suggest-chip"
              :class="e.source === 'seance' ? 'nb-jury-suggest-chip--actif' : 'nb-jury-suggest-chip--ue'"
              :title="e.source === 'seance' ? `${e.nb_seances} séance(s) dans cette classe` : 'Assigné aux UE de la classe'"
            >
              {{ e.prenom }} {{ e.nom }}
              <span style="opacity:0.65;font-size:10px">{{ e.source === 'seance' ? `×${e.nb_seances}` : 'UE' }}</span>
            </span>
          </div>

          <div class="nb-jury-membres">
            <div v-for="(m, i) in juryMembres" :key="i" class="nb-jury-membre-row">
              <input
                type="text"
                v-model="m.nom"
                placeholder="Nom complet"
                :disabled="isEnseignant || (juryData?.statut === 'cloture' && !isDG)"
                class="nb-jury-input"
              />
              <select v-model="m.fonction" :disabled="isEnseignant || (juryData?.statut === 'cloture' && !isDG)" class="nb-jury-select">
                <option>Président du jury</option>
                <option>Secrétaire</option>
                <option>Membre</option>
              </select>
              <button
                v-if="!isEnseignant && (juryData?.statut !== 'cloture' || isDG)"
                @click="juryMembres.splice(i, 1)"
                class="nb-jury-btn-remove"
                title="Supprimer"
              >✕</button>
            </div>
            <button
              v-if="!isEnseignant && (juryData?.statut !== 'cloture' || isDG)"
              @click="juryMembres.push({nom:'', fonction:'Membre'})"
              class="nb-jury-btn-add"
            >+ Ajouter un membre</button>
          </div>
          <div class="nb-jury-actions" v-if="!isEnseignant && (juryData?.statut !== 'cloture' || isDG)">
            <button @click="saveJuryConstitution" :disabled="savingJury" class="nb-btn nb-btn--primary">
              {{ savingJury ? 'Enregistrement…' : 'Enregistrer et continuer →' }}
            </button>
          </div>
          <div class="nb-jury-actions" v-else>
            <button @click="juryStep=2" class="nb-btn nb-btn--secondary">Voir la délibération →</button>
          </div>
        </div>

        <!-- STEP 2 : Délibération -->
        <div v-else-if="juryStep === 2" class="nb-jury-panel">
          <div v-if="isEnseignant" class="nb-jury-warning" style="background:#f0f9ff;border-color:#bae6fd;color:#0369a1;">
            👁 Vous consultez les délibérations en lecture seule.
          </div>
          <div v-else-if="juryData?.statut === 'cloture'" class="nb-jury-warning" :style="isDG ? 'background:#fef9c3;border-color:#f59e0b;color:#92400e' : ''">
            <span v-if="isDG">🔓 Jury clôturé — vous pouvez modifier les décisions en tant que DG.</span>
            <span v-else>⚠ Ce jury est clôturé. Les décisions sont en lecture seule.</span>
          </div>
          <h3 class="nb-jury-panel-title">Délibération — Session <strong>{{ filterSession }}</strong></h3>

          <!-- Podium top 3 -->
          <div class="nb-podium">
            <div
              v-for="(insc, idx) in [...inscriptions].sort((a,b) => (moyennePonderee(b.id) ?? -1) - (moyennePonderee(a.id) ?? -1)).slice(0,3)"
              :key="insc.id"
              class="nb-podium-card"
              :class="idx===0?'nb-podium-card--or':idx===1?'nb-podium-card--argent':'nb-podium-card--bronze'"
            >
              <div class="nb-podium-medal">{{ idx===0?'🥇':idx===1?'🥈':'🥉' }}</div>
              <div class="nb-podium-avatar">{{ insc.etudiant.prenom[0] }}{{ insc.etudiant.nom[0] }}</div>
              <div class="nb-podium-nom">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</div>
              <div class="nb-podium-moy">{{ moyennePonderee(insc.id)?.toFixed(2) ?? '—' }}<span style="font-size:10px;opacity:0.6">/20</span></div>
              <div class="nb-podium-mention">{{ mention(moyennePonderee(insc.id)) }}</div>
            </div>
          </div>

          <!-- Deliberation table -->
          <div class="nb-jury-table-wrap">
            <table class="nb-table">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Étudiant</th>
                  <th style="text-align:center">Moyenne</th>
                  <th style="text-align:center">Mention</th>
                  <th style="text-align:center">Décision auto</th>
                  <th style="text-align:center">Décision jury</th>
                  <th>Observation</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(insc, idx) in [...inscriptions].sort((a,b) => (moyennePonderee(b.id) ?? -1) - (moyennePonderee(a.id) ?? -1))" :key="insc.id">
                  <td>
                    <span class="nb-rang" :class="idx===0?'nb-rang--or':idx===1?'nb-rang--argent':idx===2?'nb-rang--bronze':''">
                      {{ idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx+1}` }}
                    </span>
                  </td>
                  <td><strong>{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</strong></td>
                  <td style="text-align:center">
                    <span class="nb-moy-jury" :class="(moyennePonderee(insc.id)??0)>=10?'nb-moy-jury--ok':'nb-moy-jury--fail'">
                      {{ moyennePonderee(insc.id)?.toFixed(2) ?? '—' }}<span style="font-size:10px;opacity:0.6">/20</span>
                    </span>
                  </td>
                  <td style="text-align:center;font-weight:600" :class="mentionColor(mention(moyennePonderee(insc.id)))">
                    {{ mention(moyennePonderee(insc.id)) }}
                  </td>
                  <td style="text-align:center">
                    <span class="nb-decision-badge" :class="decisionClass(moyennePonderee(insc.id), insc.id)">
                      {{ decisionLabel(moyennePonderee(insc.id), insc.id) }}
                    </span>
                  </td>
                  <td style="text-align:center">
                    <select
                      v-if="!isEnseignant && (juryData?.statut !== 'cloture' || isDG)"
                      :value="getJuryDecision(insc.id)"
                      @change="setJuryDecision(insc.id, ($event.target as HTMLSelectElement).value)"
                      class="nb-jury-decision-select"
                    >
                      <option value="admis">Admis</option>
                      <option value="rattrapage">Rattrapage</option>
                      <option value="redoublant">Redoublant</option>
                      <option value="passif">Passif</option>
                    </select>
                    <span v-else class="nb-decision-badge" :class="getJuryDecision(insc.id)==='admis'?'bg-green-100 text-green-700':getJuryDecision(insc.id)==='rattrapage'?'bg-orange-100 text-orange-700':'bg-red-100 text-red-700'">
                      {{ getJuryDecision(insc.id) }}
                    </span>
                  </td>
                  <td>
                    <input
                      v-if="!isEnseignant && (juryData?.statut !== 'cloture' || isDG)"
                      type="text"
                      :value="getJuryObservation(insc.id)"
                      @input="setJuryObservation(insc.id, ($event.target as HTMLInputElement).value)"
                      placeholder="Observation…"
                      class="nb-jury-obs-input"
                    />
                    <span v-else class="text-gray-500 text-sm">{{ getJuryObservation(insc.id) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="nb-jury-actions" style="justify-content:space-between">
            <button @click="juryStep=1" class="nb-btn nb-btn--secondary">← Retour</button>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <template v-if="!isEnseignant">
                <button v-if="juryData?.statut !== 'cloture' || isDG" @click="saveDecisions" :disabled="savingJury" class="nb-btn nb-btn--primary">
                  {{ savingJury ? 'Enregistrement…' : 'Enregistrer les décisions' }}
                </button>
                <button v-if="juryData?.statut !== 'cloture'" @click="cloturerJury" :disabled="savingJury" class="nb-btn nb-btn--danger">
                  Clôturer le jury →
                </button>
                <button v-if="juryData?.statut === 'cloture' && isDG" @click="rouvrirJury" :disabled="savingJury" class="nb-btn nb-btn--secondary">
                  🔓 Rouvrir
                </button>
                <button v-if="juryData?.statut === 'cloture' && isDG" @click="supprimerJury" :disabled="savingJury" class="nb-btn nb-btn--danger">
                  🗑 Supprimer
                </button>
              </template>
              <button @click="juryStep=3" class="nb-btn nb-btn--secondary">
                Clôture &amp; Documents →
              </button>
            </div>
          </div>
        </div>

        <!-- STEP 3 : Clôture & Documents -->
        <div v-else-if="juryStep === 3" class="nb-jury-panel">
          <h3 class="nb-jury-panel-title">Clôture &amp; Documents</h3>
          <div v-if="juryData?.statut !== 'cloture'" class="nb-jury-warning" style="background:#fef3c7;border-color:#f59e0b;color:#92400e">
            ⚠ Le jury n'est pas encore clôturé.
          </div>
          <div v-else class="nb-jury-success">
            ✓ Jury clôturé le {{ juryData?.date_deliberation ? new Date(juryData.date_deliberation).toLocaleDateString('fr-FR') : '—' }}
          </div>

          <!-- Summary -->
          <div class="nb-jury-recap">
            <div class="nb-jury-recap-card nb-jury-recap-card--admis">
              <div class="nb-jury-recap-val">{{ inscriptions.filter(i => getJuryDecision(i.id) === 'admis').length }}</div>
              <div class="nb-jury-recap-label">Admis</div>
            </div>
            <div class="nb-jury-recap-card nb-jury-recap-card--ratt">
              <div class="nb-jury-recap-val">{{ inscriptions.filter(i => getJuryDecision(i.id) === 'rattrapage').length }}</div>
              <div class="nb-jury-recap-label">Rattrapage</div>
            </div>
            <div class="nb-jury-recap-card nb-jury-recap-card--redoub">
              <div class="nb-jury-recap-val">{{ inscriptions.filter(i => getJuryDecision(i.id) === 'redoublant').length }}</div>
              <div class="nb-jury-recap-label">Redoublant</div>
            </div>
            <div class="nb-jury-recap-card">
              <div class="nb-jury-recap-val">{{ inscriptions.length ? Math.round(inscriptions.filter(i => getJuryDecision(i.id) === 'admis').length / inscriptions.length * 100) : 0 }}%</div>
              <div class="nb-jury-recap-label">Taux réussite</div>
            </div>
          </div>

          <!-- Members list with signature lines -->
          <div v-if="juryMembres.filter(m => m.nom.trim()).length" class="nb-jury-signatures">
            <h4 class="nb-jury-sub-title">Membres du jury</h4>
            <div class="nb-jury-sig-grid">
              <div v-for="(m, i) in juryMembres.filter(m => m.nom.trim())" :key="i" class="nb-jury-sig-item">
                <div class="nb-jury-sig-line"></div>
                <div class="nb-jury-sig-nom">{{ m.nom }}</div>
                <div class="nb-jury-sig-fonction">{{ m.fonction }}</div>
              </div>
            </div>
          </div>

          <!-- Export buttons -->
          <div class="nb-jury-actions">
            <button @click="exportPVJury" class="nb-btn nb-btn--primary">📄 Générer PV de jury</button>
            <button @click="exportAttestations" class="nb-btn nb-btn--secondary">🏆 Attestations de réussite</button>
            <button @click="exportCertificatsFC" class="nb-btn nb-btn--ghost" style="border-color:#640a0a;color:#640a0a;">
              🎖️ Certificats de réussite (FC)
            </button>
            <button @click="exportAttestationsFA" class="nb-btn nb-btn--ghost" style="border-color:#0f766e;color:#0f766e;">
              🎓 Attestations de formation (FA)
            </button>
          </div>
          <div style="font-size:11px;color:#64748b;margin-top:6px;padding:0 4px;">
            💡 <em>Attestations de réussite</em> : uniquement les étudiants <strong>admis</strong> (jury requis).
            <em>Attestations de formation</em> : tous les inscrits actifs — idéal pour les <strong>formations accélérées</strong>.
          </div>
          <div class="nb-jury-actions" style="margin-top:0">
            <button @click="juryStep=2" class="nb-btn nb-btn--ghost">← Retour délibération</button>
          </div>
        </div>
      </div>
    </div>

    <!-- TAB BULLETINS -->
    <div v-else-if="activeTab === 'bulletins' && !isEnseignant">
      <div v-if="loading" class="nb-loading">Chargement…</div>
      <div v-else-if="!inscriptions.length" class="nb-empty-state">
        <div style="font-size:36px;margin-bottom:10px;">📄</div>
        <div style="font-size:14px;color:#888;">Aucun étudiant inscrit dans cette classe.</div>
      </div>
      <div v-else>

        <!-- Stats classe -->
        <div class="nb-stats-bar">
          <div class="nb-stats-kpi">
            <div class="nb-stats-kpi-val" :style="{ color: statsClasse.taux_reussite >= 70 ? '#16a34a' : statsClasse.taux_reussite >= 50 ? '#d97706' : '#E30613' }">
              {{ statsClasse.taux_reussite }}%
            </div>
            <div class="nb-stats-kpi-label">Taux de réussite</div>
          </div>
          <div class="nb-stats-kpi">
            <div class="nb-stats-kpi-val" :style="{ color: (statsClasse.moyenne_classe??0) >= 12 ? '#16a34a' : (statsClasse.moyenne_classe??0) >= 10 ? '#d97706' : '#E30613' }">
              {{ statsClasse.moyenne_classe !== null ? statsClasse.moyenne_classe.toFixed(2) : '—' }}
            </div>
            <div class="nb-stats-kpi-label">Moyenne classe</div>
          </div>
          <div class="nb-stats-kpi">
            <div class="nb-stats-kpi-val" style="color:#16a34a">
              {{ statsClasse.meilleure !== null ? statsClasse.meilleure.toFixed(2) : '—' }}
            </div>
            <div class="nb-stats-kpi-label">Meilleure note</div>
          </div>
          <div class="nb-stats-kpi">
            <div class="nb-stats-kpi-val" style="color:#E30613">
              {{ statsClasse.plus_basse !== null ? statsClasse.plus_basse.toFixed(2) : '—' }}
            </div>
            <div class="nb-stats-kpi-label">Note la plus basse</div>
          </div>
          <div class="nb-stats-kpi nb-stats-kpi--mentions">
            <div class="nb-stats-mentions">
              <span v-for="(count, label) in statsClasse.mentions" :key="label" class="nb-mention-chip"
                :class="{
                  'nb-mention-chip--tb': label === 'Très Bien',
                  'nb-mention-chip--b': label === 'Bien',
                  'nb-mention-chip--ab': label === 'Assez Bien',
                  'nb-mention-chip--p': label === 'Passable',
                  'nb-mention-chip--i': label === 'Insuffisant',
                }">
                {{ label.split(' ')[0] === 'Très' ? 'TB' : label.split(' ')[0] === 'Assez' ? 'AB' : label[0] }} {{ count }}
              </span>
            </div>
            <div class="nb-stats-kpi-label">Mentions · {{ statsClasse.avec_notes }}/{{ statsClasse.total }} notés</div>
          </div>
          <button
            v-if="!isEnseignant"
            @click="exportTousBulletins"
            :disabled="exportingBatch"
            class="nb-btn-export-all"
          >
            {{ exportingBatch ? '⏳ Génération…' : '📥 Exporter tous' }}
          </button>
        </div>

        <!-- Grille bulletins -->
        <div class="nb-bulletins-grid">
          <div v-for="insc in [...inscriptions].sort((a,b) => (moyennePonderee(b.id)??-1) - (moyennePonderee(a.id)??-1))" :key="insc.id" class="nb-bulletin-card">
            <div class="nb-bulletin-card-top">
              <div class="nb-bulletin-rang" :class="rangEtudiant(insc.id)===1?'nb-rang--or':rangEtudiant(insc.id)===2?'nb-rang--argent':rangEtudiant(insc.id)===3?'nb-rang--bronze':''">
                {{ rangEtudiant(insc.id) <= 3 ? ['🥇','🥈','🥉'][rangEtudiant(insc.id)-1] : `#${rangEtudiant(insc.id)}` }}
              </div>
              <div class="nb-bulletin-card-avatar">{{ insc.etudiant.prenom[0] }}{{ insc.etudiant.nom[0] }}</div>
            </div>
            <div class="nb-bulletin-card-info">
              <div class="nb-bulletin-card-nom">{{ insc.etudiant.prenom }} {{ insc.etudiant.nom }}</div>
              <div v-if="(insc as any).filiere?.nom" class="nb-bulletin-card-filiere">{{ (insc as any).filiere.nom }}</div>
            </div>
            <div class="nb-bulletin-card-moy" :class="(moyennePonderee(insc.id)??0)>=10?'nb-bulletin-moy--ok':'nb-bulletin-moy--fail'">
              {{ moyennePonderee(insc.id)?.toFixed(2) ?? '—' }}
              <span style="font-size:10px;opacity:0.6">/20</span>
            </div>
            <div style="font-size:11px;font-weight:600;margin:2px 0 6px;" :class="mentionColor(mention(moyennePonderee(insc.id)))">
              {{ mention(moyennePonderee(insc.id)) }}
            </div>
            <span class="nb-decision-badge" :class="decisionClass(moyennePonderee(insc.id), insc.id)">
              {{ decisionLabel(moyennePonderee(insc.id), insc.id) }}
            </span>
            <button @click="voirBulletin(insc)" class="nb-btn-bulletin">📄 Voir bulletin</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal UE CRUD -->
    <UcModal
      v-model="showUeModal"
      :title="editUeId ? 'Modifier la matière' : 'Matières & Groupes UE'"
      width="560px"
      @close="showUeModal = false; showGroupForm = false"
    >
      <!-- ══ SECTION GROUPES UE ══ -->
      <div v-if="!editUeId">

        <!-- ⚠️ Doublons détectés -->
        <div v-if="hasDoublons" style="background:#fffbeb;border:1px solid #f59e0b;border-radius:6px;padding:12px;margin-bottom:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span style="font-size:12px;font-weight:700;color:#d97706;">⚠️ {{ ecsDoublons.length }} doublon(s) détecté(s)</span>
            <button @click="nettoyerDoublons" style="font-size:11px;background:#f59e0b;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">Nettoyer automatiquement</button>
          </div>
          <div v-for="grp in ecsDoublons" :key="grp[0]?.intitule ?? ''" style="margin-bottom:8px;">
            <p style="font-size:11px;font-weight:600;color:#78350f;margin:0 0 4px;">{{ grp[0]?.intitule }}</p>
            <div v-for="ec in grp" :key="ec.id" style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:#fff;border-radius:4px;margin-bottom:2px;">
              <span style="font-size:11px;color:#555;">
                <strong>{{ ec.code }}</strong>
                <span v-if="(ec as any).categorie_ue" style="margin-left:6px;background:#e0e7ff;color:#4338ca;border-radius:3px;padding:1px 5px;font-size:10px;">{{ (ec as any).categorie_ue }}</span>
                <span v-else style="margin-left:6px;background:#fee2e2;color:#b91c1c;border-radius:3px;padding:1px 5px;font-size:10px;">sans groupe</span>
                <span v-if="ec.matiere_id" style="margin-left:4px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;font-size:10px;">filière</span>
              </span>
              <button @click="deleteUe(ec)" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:13px;padding:2px 6px;">🗑</button>
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <p style="font-size:11px;font-weight:700;color:#6366f1;text-transform:uppercase;margin:0;letter-spacing:0.05em;">Groupes UE (domaines)</p>
          <button @click="openGroupeCreate" style="font-size:11px;background:#6366f1;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">+ Nouveau groupe</button>
        </div>

        <!-- Panneau créer/modifier un groupe -->
        <div v-if="showGroupForm" style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:6px;padding:14px;margin-bottom:12px;">
          <p style="font-size:12px;font-weight:700;color:#6366f1;margin:0 0 10px;">
            {{ editingGroupCode ? `Modifier le groupe ${editingGroupCode}` : 'Nouveau groupe UE' }}
          </p>
          <UcFormGrid :cols="2">
            <UcFormGroup label="Code UE (ex: UE1)" :required="true">
              <input v-model="groupForm.code" :disabled="!!editingGroupCode" type="text" placeholder="UE1" class="nb-input" style="width:100%;box-sizing:border-box;" />
            </UcFormGroup>
            <UcFormGroup label="Semestre">
              <select v-model="groupForm.semestre" class="nb-input" style="width:100%;box-sizing:border-box;">
                <option v-for="s in classeSemestres" :key="s" :value="String(s)">Semestre {{ s }}</option>
              </select>
            </UcFormGroup>
          </UcFormGrid>
          <UcFormGroup label="Intitulé du groupe (ex: Mathématiques et Informatique)" :required="true" style="margin-top:10px;">
            <input v-model="groupForm.intitule" type="text" placeholder="Ex: Sciences Fondamentales" class="nb-input" style="width:100%;box-sizing:border-box;" />
          </UcFormGroup>
          <!-- Checkboxes ECs -->
          <div style="margin-top:10px;">
            <p style="font-size:11px;font-weight:600;color:#555;margin:0 0 6px;">ECs à inclure dans ce groupe :</p>
            <div style="display:flex;flex-direction:column;gap:4px;max-height:140px;overflow-y:auto;background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:8px;">
              <label v-for="ue in ues" :key="ue.id" style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#333;">
                <input type="checkbox" :checked="groupForm.ec_ids.includes(ue.id)" @change="toggleEcInGroup(ue.id)" style="accent-color:#6366f1;" />
                <span><strong>{{ ue.code }}</strong> — {{ ue.intitule }} <span style="color:#aaa;font-size:11px;">(S{{ (ue as any).semestre ?? 1 }})</span></span>
              </label>
              <p v-if="!ues.length" style="font-size:11px;color:#aaa;margin:4px 0;">Aucune matière créée.</p>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button @click="showGroupForm = false" style="font-size:12px;padding:6px 12px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:4px;cursor:pointer;">Annuler</button>
            <button @click="saveGroupeUE" :disabled="savingGroup || !groupForm.code || !groupForm.intitule" style="font-size:12px;padding:6px 14px;background:#6366f1;color:#fff;border:none;border-radius:4px;cursor:pointer;opacity:savingGroup?0.6:1;">
              {{ savingGroup ? 'Enregistrement…' : 'Enregistrer le groupe' }}
            </button>
          </div>
        </div>

        <!-- Liste des groupes existants -->
        <div v-if="ueGroupes.length" style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">
          <div v-for="g in ueGroupes" :key="g.code" style="border:1px solid #e0e7ff;border-radius:6px;overflow:hidden;">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#eef2ff;">
              <div>
                <span style="font-size:12px;font-weight:700;color:#4338ca;">{{ g.code }}</span>
                <span style="font-size:12px;color:#555;margin-left:6px;">— {{ g.intitule }}</span>
                <span style="font-size:11px;color:#6366f1;margin-left:8px;">{{ g.ecs.length }} EC{{ g.ecs.length > 1 ? 's' : '' }}</span>
              </div>
              <div style="display:flex;gap:4px;">
                <button @click="openGroupeEdit(g)" style="background:none;border:none;cursor:pointer;color:#6366f1;font-size:13px;padding:2px 6px;">✏️</button>
                <button @click="deleteGroupeUE(g.code)" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:13px;padding:2px 6px;">🗑</button>
              </div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px;background:#fff;">
              <span v-for="ec in g.ecs" :key="ec.id" style="font-size:11px;background:#e0e7ff;color:#4338ca;border-radius:3px;padding:2px 7px;">{{ ec.code }} — {{ ec.intitule }}</span>
            </div>
          </div>
        </div>
        <p v-else-if="!showGroupForm" style="font-size:11px;color:#aaa;margin:0 0 14px;">Aucun groupe défini. Créez un groupe pour regrouper les ECs dans le bulletin.</p>

        <hr style="margin:14px 0;border:none;border-top:1px solid #f0f0f0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <p style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;margin:0;letter-spacing:0.05em;">Matières (ECs)</p>
          <span style="font-size:11px;color:#aaa;">{{ ues.length }} matière{{ ues.length>1?'s':'' }}</span>
        </div>
        <div v-if="ues.length" style="max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;margin-bottom:14px;">
          <div v-for="ue in ues" :key="ue.id"
            :style="ecsDoublons.some(g => g.some(e => e.id === ue.id)) ? 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:#fff7ed;border:1px solid #fed7aa;border-radius:4px;' : 'display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:#f9f9f9;border-radius:4px;'">
            <div>
              <span style="font-size:12px;color:#333;"><strong>{{ ue.code }}</strong> — {{ ue.intitule }}</span>
              <span style="font-size:10px;color:#aaa;margin-left:6px;">S{{ (ue as any).semestre ?? 1 }}</span>
              <span v-if="(parseFloat(String(ue.coefficient))||0) === 0 && (parseFloat(String(ue.credits_ects))||0) === 0"
                style="font-size:10px;background:#fee2e2;color:#b91c1c;border-radius:3px;padding:1px 5px;margin-left:4px;font-weight:700;"
                title="Coefficient et crédits à 0 : cette EC sera invisible dans les bulletins. Cliquez sur ✏️ pour corriger.">
                ⚠️ coef. 0
              </span>
              <span v-else style="font-size:10px;background:#f0fdf4;color:#15803d;border-radius:3px;padding:1px 5px;margin-left:4px;">
                <template v-if="(parseFloat(String(ue.credits_ects))||0) > 0">{{ ue.credits_ects }} cr.</template>
                <template v-else>coef. {{ ue.coefficient }}</template>
              </span>
              <span v-if="(ue as any).categorie_ue" style="font-size:10px;background:#e0e7ff;color:#4338ca;border-radius:3px;padding:1px 5px;margin-left:4px;">{{ (ue as any).categorie_ue }}</span>
              <span v-else style="font-size:10px;background:#f3f4f6;color:#9ca3af;border-radius:3px;padding:1px 5px;margin-left:4px;">sans groupe</span>
              <span v-if="ue.matiere_id" style="font-size:10px;background:#fef3c7;color:#92400e;border-radius:3px;padding:1px 5px;margin-left:2px;">filière</span>
              <span v-if="ecsDoublons.some(g => g.some(e => e.id === ue.id))" style="font-size:10px;background:#fee2e2;color:#b91c1c;border-radius:3px;padding:1px 5px;margin-left:2px;">⚠️ doublon</span>
            </div>
            <div style="display:flex;gap:4px;">
              <button @click="openUeEdit(ue)" style="background:none;border:none;cursor:pointer;color:#aaa;font-size:13px;padding:2px 5px;">✏️</button>
              <button @click="deleteUe(ue)" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:13px;padding:2px 5px;">🗑</button>
            </div>
          </div>
        </div>
        <hr style="margin:0 0 14px;border:none;border-top:1px dashed #f0f0f0;">
        <p style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;margin:0 0 10px;letter-spacing:0.05em;">Ajouter une matière</p>
      </div>

      <!-- Formulaire EC (ajout ou modification) -->
      <UcFormGrid :cols="2">
        <UcFormGroup label="Code" :required="true">
          <input v-model="ueForm.code" type="text" placeholder="INF-101" class="nb-input" style="width:100%;box-sizing:border-box;" />
        </UcFormGroup>
        <UcFormGroup label="Coefficient" :required="true">
          <input v-model="ueForm.coefficient" type="number" min="0" step="0.5" class="nb-input" style="width:100%;box-sizing:border-box;" />
        </UcFormGroup>
      </UcFormGrid>
      <UcFormGroup label="Intitulé" :required="true" style="margin-top:12px;">
        <input v-model="ueForm.intitule" type="text" placeholder="Ex : Algorithmique…" class="nb-input" style="width:100%;box-sizing:border-box;" />
      </UcFormGroup>
      <UcFormGrid :cols="2" style="margin-top:12px;">
        <UcFormGroup label="Crédits ECTS">
          <input v-model="ueForm.credits_ects" type="number" min="0" step="0.5" class="nb-input" style="width:100%;box-sizing:border-box;" />
        </UcFormGroup>
        <UcFormGroup label="Semestre">
          <select v-model="ueForm.semestre" class="nb-input" style="width:100%;box-sizing:border-box;">
            <option v-for="s in classeSemestres" :key="s" :value="String(s)">Semestre {{ s }}</option>
          </select>
        </UcFormGroup>
      </UcFormGrid>
      <UcFormGrid :cols="2" style="margin-top:12px;">
        <UcFormGroup label="Enseignant">
          <select v-model="ueForm.enseignant_id" class="nb-input" style="width:100%;box-sizing:border-box;">
            <option value="">— Sans enseignant —</option>
            <option v-for="i in enseignants" :key="i.id" :value="String(i.id)">{{ i.prenom }} {{ i.nom }}</option>
          </select>
        </UcFormGroup>
        <UcFormGroup label="Groupe UE">
          <select v-model="ueForm.categorie_ue" class="nb-input" style="width:100%;box-sizing:border-box;">
            <option value="">— Sans groupe —</option>
            <option v-for="g in ueGroupes" :key="g.code" :value="g.code">{{ g.code }} — {{ g.intitule }}</option>
          </select>
        </UcFormGroup>
      </UcFormGrid>
      <UcFormGroup label="Ordre affichage" style="margin-top:12px;">
        <input v-model="ueForm.ordre" type="number" min="0" class="nb-input" style="width:100%;box-sizing:border-box;" />
      </UcFormGroup>

      <template #footer>
        <button @click="showUeModal = false; showGroupForm = false" class="nb-btn-cancel">Fermer</button>
        <button @click="saveUe" :disabled="savingUe || !ueForm.code || !ueForm.intitule" class="nb-btn-save">
          {{ savingUe ? 'Enregistrement…' : (editUeId ? 'Modifier' : 'Ajouter la matière') }}
        </button>
      </template>
    </UcModal>

    <!-- Modal Bulletin — redesign complet -->
    <UcModal
      v-model="showBulletin"
      title="Bulletin de notes"
      width="680px"
      @close="showBulletin = false"
    >
      <div v-if="loadingBulletin" class="nb-loading">Chargement…</div>
      <div v-else-if="bulletin" style="overflow-y:auto;">
  <!-- ══ EN-TÊTE ══ -->
  <div class="nb-bulletin-header">
    <div class="nb-bulletin-header-school">Uptech Campus</div>
    <div class="nb-bulletin-header-avatar">
      {{ bulletin.inscription.etudiant?.prenom?.[0] }}{{ bulletin.inscription.etudiant?.nom?.[0] }}
    </div>
    <div class="nb-bulletin-header-nom">
      {{ bulletin.inscription.etudiant?.prenom }} {{ bulletin.inscription.etudiant?.nom }}
    </div>
    <div class="nb-bulletin-header-meta">
      {{ bulletin.inscription.classe?.filiere?.nom ?? '—' }} · {{ bulletin.inscription.annee_academique?.libelle ?? '—' }}
    </div>
    <!-- Badge type -->
    <div style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.15);border-radius:99px;padding:3px 12px;font-size:11px;font-weight:700;">
      {{ bulletin.est_lmd ? '🎓 Enseignement Supérieur' : '🔧 Formation Professionnelle' }}
    </div>
  </div>

  <!-- ══ BULLETIN SUPÉRIEUR (LMD) ══ -->
  <template v-if="bulletin.est_lmd">
    <!-- KPIs globaux -->
    <div class="nb-bulletin-kpi">
      <div class="nb-kpi-card" :class="(bulletin.moyenne??0)>=10?'nb-kpi--ok':'nb-kpi--fail'">
        <div class="nb-kpi-value">{{ bulletin.moyenne?.toFixed(2) ?? '—' }}</div>
        <div class="nb-kpi-label">Moyenne générale</div>
      </div>
      <div class="nb-kpi-card nb-kpi--mention">
        <div class="nb-kpi-value" :class="mentionColor(bulletin.mention)">{{ bulletin.mention ?? '—' }}</div>
        <div class="nb-kpi-label">Mention</div>
      </div>
      <div class="nb-kpi-card nb-kpi--credits">
        <div class="nb-kpi-value" style="color:#E30613;">{{ bulletin.credits_valides }}/{{ bulletin.credits_total }}</div>
        <div class="nb-kpi-label">Crédits ECTS</div>
      </div>
      <div class="nb-kpi-card" style="border-top:3px solid #1d4ed8;">
        <div class="nb-kpi-value" style="color:#1d4ed8;font-size:16px;">
          {{ (() => { const r = rangEtudiant(bulletin.inscription?.id ?? 0); return r <= 3 ? ['🥇','🥈','🥉'][r-1] + ' ' + r : '#' + r })() }}
        </div>
        <div class="nb-kpi-label">Rang / {{ inscriptions.length }}</div>
      </div>
    </div>

    <!-- Semestres avec hiérarchie UE → EC -->
    <template v-if="bulletin.semestres?.length">
      <div v-for="sem in bulletin.semestres" :key="sem.numero">
        <div class="nb-sem-header" :class="sem.numero===1?'nb-sem-header--s1':'nb-sem-header--s2'">
          <span>📅 Semestre {{ sem.numero }}</span>
          <div class="nb-sem-stats">
            <span>Moy. <strong>{{ sem.moyenne !== null ? sem.moyenne.toFixed(2) : '—' }}/20</strong></span>
            <span style="margin-left:12px;">Crédits <strong>{{ sem.credits_valides }}/{{ sem.credits_total }}</strong></span>
          </div>
        </div>
        <table class="nb-table nb-bulletin-table" style="margin-bottom:4px;border-collapse:collapse;">
          <thead><tr style="background:#1a3a6b;color:#fff;">
            <th v-if="sem.has_groupes && sem.groupes_ue?.length" style="width:110px;text-align:left;padding:5px 8px;">UE</th>
            <th style="width:52px;">Code</th>
            <th>Intitulé</th>
            <th style="text-align:center;width:52px;">Crédits</th>
            <th style="text-align:center;width:65px;">Note /20</th>
            <th style="text-align:center;width:58px;">Session</th>
            <th style="text-align:center;width:82px;">Mention</th>
          </tr></thead>
          <tbody>
            <!-- Mode UE → EC avec rowspan (style UGB) -->
            <template v-if="sem.has_groupes && sem.groupes_ue?.length">
              <template v-for="ue in sem.groupes_ue.filter((u:any) => (parseFloat(u.credits_ue)||parseFloat(u.coefficient)||0) > 0)" :key="ue.code">
                <!-- Une ligne par EC — UE cell + colonnes résumé fusionnées sur toutes les lignes ECs -->
                <tr v-for="(ec, ecIdx) in (ue.ecs as any[])" :key="ec.id"
                  :style="{ background: (ecIdx as number) % 2 === 0 ? '#fafbff' : '#fff' }">
                  <!-- Cellule UE : rowspan = nb ECs (pas de ligne résumé séparée) -->
                  <td v-if="(ecIdx as number) === 0" :rowspan="(ue.ecs as any[]).length"
                    style="background:#dde3f4;border:1px solid #b8c2e0;border-right:3px solid #1a3a6b;padding:6px 8px;vertical-align:middle;text-align:left;">
                    <div style="font-family:monospace;font-size:10px;font-weight:700;color:#1a3a6b;">{{ ue.code }}</div>
                    <div style="font-size:11px;font-weight:700;color:#1a3a6b;line-height:1.3;margin-top:2px;">{{ ue.intitule }}</div>
                  </td>
                  <!-- Code EC -->
                  <td style="font-family:monospace;font-size:10px;color:#555;padding:3px 6px;">{{ ec.code }}</td>
                  <!-- Intitulé EC + enseignant -->
                  <td style="font-size:11px;color:#333;padding:3px 6px;border-left:2px solid #c7d2f0;">
                    {{ ec.intitule }}
                    <span v-if="ec.enseignant" style="font-size:10px;color:#aaa;display:block;">{{ ec.enseignant.prenom }} {{ ec.enseignant.nom }}</span>
                  </td>
                  <!-- Crédits UE fusionnés (rowspan) — colonne Crédits -->
                  <td v-if="(ecIdx as number) === 0" :rowspan="(ue.ecs as any[]).length"
                    style="text-align:center;font-size:11px;font-weight:700;color:#1a3a6b;vertical-align:middle;background:#e8edf8;border:1px solid #c8d3ea;">
                    {{ ue.credits_ue }}
                  </td>
                  <!-- Moy UE fusionnée (rowspan) — colonne Note /20 -->
                  <td v-if="(ecIdx as number) === 0" :rowspan="(ue.ecs as any[]).length"
                    :style="{ textAlign:'center', fontWeight:'700', verticalAlign:'middle', background:'#e8edf8', border:'1px solid #c8d3ea', color: ue.moyenne_ue !== null ? (ue.moyenne_ue >= 10 ? '#16a34a' : '#E30613') : '#aaa' }">
                    {{ ue.moyenne_ue !== null ? ue.moyenne_ue.toFixed(2) : '—' }}
                  </td>
                  <!-- Session UE fusionnée (rowspan) — colonne Session -->
                  <td v-if="(ecIdx as number) === 0" :rowspan="(ue.ecs as any[]).length"
                    style="text-align:center;font-size:11px;color:#555;vertical-align:middle;background:#e8edf8;border:1px solid #c8d3ea;">
                    {{ ue.session_ue }}
                  </td>
                  <!-- Mention UE fusionnée (rowspan) — colonne Mention -->
                  <td v-if="(ecIdx as number) === 0" :rowspan="(ue.ecs as any[]).length"
                    style="text-align:center;vertical-align:middle;background:#e8edf8;border:1px solid #c8d3ea;">
                    <span class="nb-credit-badge"
                      :style="{ background: ue.valide ? '#f0fdf4' : '#fff0f0', color: ue.valide ? '#16a34a' : '#E30613', fontSize:'10px' }">
                      {{ ue.valide ? '✓' : '✗' }} {{ ue.mention_ue ?? '—' }}
                    </span>
                  </td>
                </tr>
              </template>
              <!-- ECs standalone (sans UE) -->
              <tr v-for="ec in (sem.ecs_standalone ?? []).filter((e:any) => (parseFloat(e.coefficient)||parseFloat(e.credits_ects)||0) > 0)" :key="ec.id" style="background:#fffbf0;">
                <td style="background:#fef9e7;border:1px solid #e5e7eb;font-size:10px;color:#aaa;text-align:center;">—</td>
                <td style="font-family:monospace;font-size:10px;color:#888;">{{ ec.code }}</td>
                <td style="font-size:11px;color:#333;">{{ ec.intitule }}</td>
                <td style="text-align:center;font-size:11px;">{{ ec.credits ?? ec.credits_ects }}</td>
                <td style="text-align:center;"><span :style="{ color: ec.note !== null ? (ec.note >= 10 ? '#16a34a' : '#E30613') : '#ccc', fontWeight:'700' }">{{ ec.note !== null ? ec.note : '—' }}</span></td>
                <td style="text-align:center;font-size:11px;color:#555;">{{ ec.session_label ?? '—' }}</td>
                <td style="text-align:center;font-size:11px;color:#888;">{{ ec.note !== null ? (ec.note < 12 ? 'Passable' : ec.note < 14 ? 'Assez Bien' : ec.note < 16 ? 'Bien' : 'Très Bien') : '—' }}</td>
              </tr>
            </template>
            <!-- Mode liste plate (pas de groupes) -->
            <template v-else>
              <tr v-for="ec in (sem.ues ?? []).filter((e:any) => (parseFloat(e.coefficient)||parseFloat(e.credits_ects)||0) > 0)" :key="ec.id">
                <td style="font-family:monospace;font-size:11px;color:#888;">{{ ec.code }}</td>
                <td style="color:#333;">{{ ec.intitule }}</td>
                <td style="text-align:center;font-size:11px;">{{ ec.credits ?? ec.credits_ects }}</td>
                <td style="text-align:center;"><span :style="{ color: ec.note !== null ? (ec.note >= 10 ? '#16a34a' : '#E30613') : '#ccc', fontWeight:'700' }">{{ ec.note !== null ? ec.note : '—' }}</span></td>
                <td style="text-align:center;font-size:11px;color:#555;">{{ ec.session_label ?? '—' }}</td>
                <td style="text-align:center;font-size:11px;color:#888;">{{ ec.note !== null ? (ec.note < 12 ? 'Passable' : ec.note < 14 ? 'Assez Bien' : ec.note < 16 ? 'Bien' : 'Très Bien') : '—' }}</td>
              </tr>
            </template>
          </tbody>
        </table>
        <!-- Pied semestre -->
        <div style="display:flex;gap:0;margin-bottom:14px;font-family:'Times New Roman',serif;font-size:11px;">
          <div style="flex:2;border:1px solid #ccc;padding:5px 8px;background:#f5f5f5;font-weight:600;">Crédits validés : {{ sem.credits_valides }} / {{ sem.credits_total }}</div>
          <div style="flex:2;border:1px solid #ccc;border-left:none;padding:5px 8px;background:#f5f5f5;font-weight:600;">Moyenne semestrielle : {{ sem.moyenne !== null ? sem.moyenne.toFixed(2) : '—' }} / 20</div>
          <div style="flex:3;border:1px solid #ccc;border-left:none;padding:5px 8px;background:#f5f5f5;">Observations :</div>
        </div>
      </div>
    </template>
    <!-- Fallback sans semestres -->
    <template v-else>
      <table class="nb-table nb-bulletin-table" style="margin-bottom:16px;">
        <thead><tr style="background:#1a3a6b;color:#fff;">
          <th>Code</th><th>Intitulé</th><th style="text-align:center;">Crédits</th><th style="text-align:center;">Note /20</th><th style="text-align:center;">Session</th><th style="text-align:center;">Mention</th>
        </tr></thead>
        <tbody>
          <tr v-for="ec in bulletin.ues.filter((e:any) => (parseFloat(e.coefficient)||parseFloat(e.credits_ects)||0) > 0)" :key="ec.id">
            <td style="font-family:monospace;font-size:11px;color:#888;">{{ ec.code }}</td>
            <td>{{ ec.intitule }}</td>
            <td style="text-align:center;">{{ ec.credits ?? ec.credits_ects }}</td>
            <td style="text-align:center;font-weight:700;" :style="{ color: ec.note !== null ? (ec.note >= 10 ? '#16a34a' : '#E30613') : '#ccc' }">{{ ec.note !== null ? ec.note : '—' }}</td>
            <td style="text-align:center;font-size:11px;color:#555;">{{ ec.session_label ?? '—' }}</td>
            <td style="text-align:center;font-size:11px;">{{ ec.note !== null ? (ec.note < 10 ? 'Non validé' : ec.note < 12 ? 'Passable' : ec.note < 14 ? 'Assez Bien' : ec.note < 16 ? 'Bien' : 'Très Bien') : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Décision jury LMD -->
    <div class="nb-decision-banner"
      :class="bulletin.decision==='admis'?'nb-decision-banner--admis':bulletin.decision==='passif'?'nb-decision-banner--passif':bulletin.decision==='rattrapage'?'nb-decision-banner--rattrapage':'nb-decision-banner--redoublant'">
      <div class="nb-decision-banner-label">Décision du jury</div>
      <div class="nb-decision-banner-text">
        <template v-if="bulletin.decision==='admis'">✓ Admis(e) — {{ bulletin.credits_valides }} crédits validés</template>
        <template v-else-if="bulletin.decision==='passif'">↗ Passage conditionnel ({{ bulletin.credits_valides }} crédits / 60) — passif en attente</template>
        <template v-else-if="bulletin.decision==='rattrapage'">↻ Admis(e) en rattrapage</template>
        <template v-else-if="bulletin.decision==='redoublant'">✗ Redoublant(e)</template>
        <template v-else>⏳ En attente</template>
      </div>
    </div>
  </template>

  <!-- ══ BULLETIN FORMATION PROFESSIONNELLE (non-LMD) ══ -->
  <template v-else>
    <!-- KPIs -->
    <div class="nb-bulletin-kpi">
      <div class="nb-kpi-card" :class="(bulletin.moyenne??0)>=10?'nb-kpi--ok':'nb-kpi--fail'">
        <div class="nb-kpi-value">{{ bulletin.moyenne?.toFixed(2) ?? '—' }}</div>
        <div class="nb-kpi-label">Moyenne générale</div>
      </div>
      <div class="nb-kpi-card">
        <div class="nb-kpi-value" style="color:#6d28d9;font-size:16px;">{{ bulletin.ues.filter((u:any) => (u.coef_effectif != null ? parseFloat(u.coef_effectif) : parseFloat(u.coefficient) || 0) > 0 && u.note !== null && u.note >= 10).length }}/{{ bulletin.ues.filter((u:any) => (u.coef_effectif != null ? parseFloat(u.coef_effectif) : parseFloat(u.coefficient) || 0) > 0).length }}</div>
        <div class="nb-kpi-label">Modules validés</div>
      </div>
      <div class="nb-kpi-card" :class="bulletin.decision==='admis'?'nb-kpi--ok':'nb-kpi--fail'">
        <div class="nb-kpi-value" style="font-size:15px;">{{ bulletin.decision==='admis'?'✓ Validé':'✗ Non validé' }}</div>
        <div class="nb-kpi-label">Décision</div>
      </div>
    </div>

    <!-- Tableau compétences / modules par semestre -->
    <template v-if="(bulletin.semestres?.length ?? 0) > 1">
      <div v-for="sem in bulletin.semestres" :key="sem.numero">
        <div class="nb-sem-header" :class="sem.numero===1?'nb-sem-header--s1':'nb-sem-header--s2'">
          <span>📅 Semestre {{ sem.numero }}</span>
          <span class="nb-sem-stats">Moy. <strong>{{ sem.moyenne !== null ? sem.moyenne.toFixed(2) : '—' }}/20</strong></span>
        </div>
        <table class="nb-table nb-bulletin-table nb-fp-table" style="margin-bottom:16px;">
          <thead><tr class="nb-fp-thead">
            <th>Module / Compétence</th><th>Enseignant</th>
            <th style="text-align:center;">Coef.</th>
            <th style="text-align:center;">Note /20</th>
            <th style="text-align:center;">Appréciation</th>
            <th style="text-align:center;">Résultat</th>
          </tr></thead>
          <tbody>
            <tr v-for="ue in (sem.ues ?? []).filter((u:any) => (u.coef_effectif != null ? parseFloat(u.coef_effectif) : parseFloat(u.coefficient) || 0) > 0)" :key="ue.id" class="nb-fp-row" :class="ue.note !== null && ue.note < 10 ? 'nb-fp-row--fail' : ''">
              <td>
                <div style="font-weight:600;color:#222;">{{ ue.intitule }}</div>
                <div style="font-family:monospace;font-size:10px;color:#aaa;">{{ ue.code }}</div>
              </td>
              <td style="font-size:12px;color:#64748b;">{{ ue.enseignant ? `${ue.enseignant.prenom} ${ue.enseignant.nom}` : '—' }}</td>
              <td style="text-align:center;color:#555;">{{ ue.coef_effectif ?? ue.coefficient }}</td>
              <td style="text-align:center;">
                <span v-if="ue.note !== null" style="font-size:15px;font-weight:800;" :style="{ color: ue.note >= 14 ? '#16a34a' : ue.note >= 10 ? '#d97706' : '#E30613' }">{{ ue.note }}</span>
                <span v-else style="color:#ccc;">—</span>
              </td>
              <td style="text-align:center;">
                <span v-if="ue.note !== null" class="nb-fp-appr"
                  :style="{
                    background: ue.note >= 14 ? '#f0fdf4' : ue.note >= 12 ? '#f0fdf4' : ue.note >= 10 ? '#fef9c3' : '#fff0f0',
                    color: ue.note >= 14 ? '#15803d' : ue.note >= 12 ? '#15803d' : ue.note >= 10 ? '#92400e' : '#b91c1c'
                  }">
                  {{ ue.note >= 16 ? 'Excellent' : ue.note >= 14 ? 'Très bien' : ue.note >= 12 ? 'Bien' : ue.note >= 10 ? 'Satisfaisant' : 'Insuffisant' }}
                </span>
                <span v-else style="color:#ccc;font-size:12px;">Non évalué</span>
              </td>
              <td style="text-align:center;">
                <span v-if="ue.note !== null" class="nb-fp-result" :style="{ background: ue.valide ? '#dcfce7' : '#fee2e2', color: ue.valide ? '#15803d' : '#b91c1c' }">
                  {{ ue.valide ? '✓ Acquis' : '✗ À renforcer' }}
                </span>
                <span v-else style="color:#ccc;font-size:12px;">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <template v-else>
      <!-- Toutes les UEs en une seule table si pas de semestre distinct -->
      <table class="nb-table nb-bulletin-table nb-fp-table" style="margin-bottom:16px;">
        <thead><tr class="nb-fp-thead">
          <th>Module / Compétence</th><th>Enseignant</th>
          <th style="text-align:center;">Coef.</th>
          <th style="text-align:center;">Note /20</th>
          <th style="text-align:center;">Appréciation</th>
          <th style="text-align:center;">Résultat</th>
        </tr></thead>
        <tbody>
          <tr v-for="ue in bulletin.ues.filter((u:any) => (u.coef_effectif != null ? parseFloat(u.coef_effectif) : parseFloat(u.coefficient) || 0) > 0)" :key="ue.id" class="nb-fp-row" :class="ue.note !== null && ue.note < 10 ? 'nb-fp-row--fail' : ''">
            <td>
              <div style="font-weight:600;color:#222;">{{ ue.intitule }}</div>
              <div style="font-family:monospace;font-size:10px;color:#aaa;">{{ ue.code }}</div>
            </td>
            <td style="font-size:12px;color:#64748b;">{{ ue.enseignant ? `${ue.enseignant.prenom} ${ue.enseignant.nom}` : '—' }}</td>
            <td style="text-align:center;color:#555;">{{ ue.coef_effectif ?? ue.coefficient }}</td>
            <td style="text-align:center;">
              <span v-if="ue.note !== null" style="font-size:15px;font-weight:800;" :style="{ color: ue.note >= 14 ? '#16a34a' : ue.note >= 10 ? '#d97706' : '#E30613' }">{{ ue.note }}</span>
              <span v-else style="color:#ccc;">—</span>
            </td>
            <td style="text-align:center;">
              <span v-if="ue.note !== null" class="nb-fp-appr"
                :style="{
                  background: ue.note >= 14 ? '#f0fdf4' : ue.note >= 12 ? '#f0fdf4' : ue.note >= 10 ? '#fef9c3' : '#fff0f0',
                  color: ue.note >= 14 ? '#15803d' : ue.note >= 12 ? '#15803d' : ue.note >= 10 ? '#92400e' : '#b91c1c'
                }">
                {{ ue.note >= 16 ? 'Excellent' : ue.note >= 14 ? 'Très bien' : ue.note >= 12 ? 'Bien' : ue.note >= 10 ? 'Satisfaisant' : 'Insuffisant' }}
              </span>
              <span v-else style="color:#ccc;font-size:12px;">Non évalué</span>
            </td>
            <td style="text-align:center;">
              <span v-if="ue.note !== null" class="nb-fp-result" :style="{ background: ue.valide ? '#dcfce7' : '#fee2e2', color: ue.valide ? '#15803d' : '#b91c1c' }">
                {{ ue.valide ? '✓ Acquis' : '✗ À renforcer' }}
              </span>
              <span v-else style="color:#ccc;font-size:12px;">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Décision Formation Pro -->
    <div class="nb-decision-banner" :class="bulletin.decision==='admis'?'nb-decision-banner--admis':'nb-decision-banner--redoublant'">
      <div class="nb-decision-banner-label">Décision de la commission</div>
      <div class="nb-decision-banner-text">
        <template v-if="bulletin.decision==='admis'">✓ Formation validée — {{ bulletin.ues.filter((u:any) => (u.coef_effectif != null ? parseFloat(u.coef_effectif) : parseFloat(u.coefficient) || 0) > 0 && u.valide).length }} module(s) acquis sur {{ bulletin.ues.filter((u:any) => (u.coef_effectif != null ? parseFloat(u.coef_effectif) : parseFloat(u.coefficient) || 0) > 0).length }}</template>
        <template v-else-if="bulletin.decision==='rattrapage'">↻ Rattrapage requis</template>
        <template v-else-if="bulletin.decision==='redoublant'">✗ Formation non validée</template>
        <template v-else>⏳ En attente de décision</template>
      </div>
    </div>
  </template>

  <!-- Signatures (commun aux deux types) -->
  <div class="nb-signatures">
    <div class="nb-signature-line"><p>Le Responsable Pédagogique</p></div>
    <div class="nb-signature-line"><p>Le Directeur Général</p></div>
    <div class="nb-signature-line"><p>Cachet de l'établissement</p></div>
  </div>
</div>

      <template #footer>
        <!-- Sélecteur semestre si LMD et 2 semestres -->
        <div v-if="bulletin?.est_lmd && (bulletin?.semestres?.length ?? 0) >= 2" style="display:flex;align-items:center;gap:6px;margin-right:auto;">
          <span style="font-size:11px;color:#888;">Exporter :</span>
          <div class="nb-session-toggle">
            <button @click="bulletinSemestre = null"
              :class="['nb-session-btn', bulletinSemestre === null ? 'nb-session-btn--active' : '']" style="font-size:11px;padding:5px 10px;">Année</button>
            <button v-for="sem in bulletin.semestres" :key="sem.numero"
              @click="bulletinSemestre = sem.numero"
              :class="['nb-session-btn', bulletinSemestre === sem.numero ? 'nb-session-btn--active' : '']" style="font-size:11px;padding:5px 10px;">S{{ sem.numero }}</button>
          </div>
        </div>
        <!-- Sélecteur semestre si FP et plusieurs semestres dans les UEs -->
        <div v-else-if="!bulletin?.est_lmd && [...new Set((bulletin?.ues ?? []).map((u:any) => u.semestre ?? 1))].length >= 2"
          style="display:flex;align-items:center;gap:6px;margin-right:auto;">
          <span style="font-size:11px;color:#888;">Exporter :</span>
          <div class="nb-session-toggle">
            <button @click="bulletinSemestre = null"
              :class="['nb-session-btn', bulletinSemestre === null ? 'nb-session-btn--active' : '']" style="font-size:11px;padding:5px 10px;">Année</button>
            <button v-for="s in ([...new Set((bulletin?.ues ?? []).map((u:any) => u.semestre ?? 1))].sort() as number[])" :key="s"
              @click="bulletinSemestre = s"
              :class="['nb-session-btn', bulletinSemestre === s ? 'nb-session-btn--active' : '']" style="font-size:11px;padding:5px 10px;">S{{ s }}</button>
          </div>
        </div>
        <button @click="exportBulletinPdf" class="nb-btn-pdf">📥 Télécharger PDF</button>
        <button @click="showBulletin = false" class="nb-btn-cancel">Fermer</button>
      </template>
    </UcModal>
  </div>
</template>

<style scoped>
/* ── TOOLBAR ────────────────────────────────────────────── */
.nb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.07);
  padding: 14px 20px;
  margin-bottom: 18px;
}
.nb-toolbar-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.nb-select {
  border: 1.5px solid #e5e5e5;
  border-radius: 8px;
  padding: 9px 14px;
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  color: #333;
  background: #fafafa;
  min-width: 220px;
  transition: border-color 0.2s;
}
.nb-select:focus { outline: none; border-color: #6366f1; }

/* Session toggle pill */
.nb-session-toggle {
  display: flex;
  background: #f3f4f6;
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
}
.nb-session-btn {
  border: none;
  border-radius: 999px;
  padding: 7px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  color: #888;
  background: transparent;
  transition: all 0.18s;
}
.nb-session-btn--active {
  background: #E30613;
  color: #fff;
  box-shadow: 0 2px 8px rgba(227,6,19,0.25);
}
.nb-session-btn--rattrapage {
  background: #f97316;
  color: #fff;
  box-shadow: 0 2px 8px rgba(249,115,22,0.25);
}
.nb-btn-ues {
  border: 1.5px solid #6366f1;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  border-radius: 8px;
  padding: 9px 16px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  box-shadow: 0 2px 8px rgba(99,102,241,0.2);
  transition: opacity 0.15s;
}
.nb-btn-ues:hover { opacity: 0.88; }

/* ── TEACHER BANNER ─────────────────────────────────────── */
.nb-prof-banner {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  background: linear-gradient(135deg, #eff6ff 0%, #eef2ff 100%);
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  padding: 14px 20px;
  margin-bottom: 16px;
}
.nb-prof-banner-icon { font-size: 28px; line-height: 1; flex-shrink: 0; }
.nb-prof-banner-title { font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 3px; }
.nb-prof-banner-sub { font-size: 12.5px; color: #1d4ed8; }
.nb-prof-banner-sub strong { color: #1e40af; }
.nb-prof-banner-hint { font-size: 11.5px; color: #6b7280; margin-top: 4px; }

/* ── TABS ────────────────────────────────────────────────── */
.nb-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 20px;
  background: #f3f4f6;
  border-radius: 12px;
  padding: 5px;
}
.nb-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 22px;
  font-size: 13px;
  font-weight: 600;
  border: none;
  border-radius: 9px;
  background: transparent;
  cursor: pointer;
  color: #888;
  font-family: 'Poppins', sans-serif;
  transition: all 0.18s;
}
.nb-tab:hover { background: rgba(255,255,255,0.6); color: #555; }
.nb-tab--active {
  background: #fff;
  color: #E30613;
  box-shadow: 0 2px 10px rgba(0,0,0,0.09);
}
.nb-tab-icon { font-size: 15px; }

/* ── EMPTY / LOADING ────────────────────────────────────── */
.nb-empty-state {
  background: #fff;
  border-radius: 14px;
  padding: 56px 40px;
  text-align: center;
  color: #aaa;
  font-size: 13px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}
.nb-loading { text-align: center; padding: 48px; color: #aaa; font-size: 13px; }

/* ── SAISIE WRAP ────────────────────────────────────────── */
.nb-saisie-wrap {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.07);
  overflow: hidden;
}
.nb-table-toolbar {
  display: flex;
  align-items: center;
  padding: 14px 20px;
  background: linear-gradient(90deg, #fafafa, #f3f4f6);
  border-bottom: 1px solid #eeeeee;
}
.nb-table-info { font-size: 12.5px; color: #666; font-weight: 500; }
.nb-saved-badge {
  background: #dcfce7;
  color: #16a34a;
  border-radius: 20px;
  padding: 4px 12px;
  font-size: 11.5px;
  font-weight: 600;
}
.nb-empty-ues {
  padding: 32px;
  text-align: center;
  color: #aaa;
  font-size: 13px;
}
.nb-link-btn {
  background: none;
  border: none;
  color: #E30613;
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
  font-family: 'Poppins', sans-serif;
  text-decoration: underline;
  margin-left: 6px;
}
.nb-scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }

/* ── TABLE ───────────────────────────────────────────────── */
.nb-table { width: 100%; border-collapse: collapse; }
.nb-table thead tr { background: #f9f9f9; }
.nb-table th {
  padding: 10px 14px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
}
.nb-table td {
  padding: 10px 12px;
  border-top: 1px solid #f4f4f4;
  font-size: 13px;
  vertical-align: middle;
}
.nb-table tr:hover td { background: rgba(99,102,241,0.03) !important; }

/* Sticky column */
.nb-th-sticky, .nb-td-sticky {
  position: sticky;
  left: 0;
  z-index: 2;
  background: #fff;
}
.nb-th-sticky { background: #f9f9f9; z-index: 3; }
.nb-td-sticky { box-shadow: 2px 0 8px rgba(0,0,0,0.06); }
.nb-th-etudiant { min-width: 200px; }

/* Group headers */
.nb-th-group {
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  padding: 6px 10px;
  border-bottom: 2px solid;
}
.nb-th-group--tronc { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.nb-th-group--spec { background: #f0fdf4; color: #15803d; border-color: #86efac; }

/* UE header */
.nb-th-ue {
  text-align: center;
  min-width: 120px;
  border-top: 3px solid var(--ue-color, #6366f1);
  padding: 8px 10px;
}
.nb-ue-header { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.nb-ue-print-btn {
  margin-top: 4px; padding: 3px 8px; font-size: 12px; line-height: 1;
  border: 1.5px solid var(--ue-color, #6366f1); border-radius: 5px;
  background: #fff; color: var(--ue-color, #6366f1); cursor: pointer;
  font-weight: 700; transition: background 0.15s, color 0.15s;
}
.nb-ue-print-btn:hover { background: var(--ue-color, #6366f1); color: #fff; }
.nb-ue-print-btn:disabled { opacity: 0.5; cursor: default; }
.nb-ue-code {
  font-family: monospace;
  font-size: 10.5px;
  font-weight: 700;
  background: var(--ue-color, #6366f1);
  color: #fff;
  border-radius: 4px;
  padding: 2px 6px;
}
.nb-ue-name { font-size: 10px; color: #666; text-transform: none; font-weight: 400; max-width: 110px; text-align: center; }
.nb-ue-coef { font-size: 10px; color: #E30613; font-weight: 600; }
.nb-ue-lock { font-size: 12px; opacity: 0.6; }
.nb-th-moy { text-align: center; min-width: 90px; background: #fafafa; }

/* Row alternating */
.nb-row--even { background: #fff; }
.nb-row--odd { background: #fafafa; }

/* Étudiant cell */
.nb-td-etudiant { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.nb-etudiant-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}
.nb-etudiant-nom { font-size: 13px; font-weight: 600; color: #222; }
.nb-etudiant-filiere { font-size: 10.5px; color: #aaa; }
.nb-badge-lmd {
  font-size: 9px; font-weight: 800; letter-spacing: .4px;
  background: #dbeafe; color: #1d4ed8;
  border-radius: 4px; padding: 1px 5px; white-space: nowrap;
}
.nb-badge-coef {
  font-size: 9px; font-weight: 700;
  background: #fef3c7; color: #92400e;
  border-radius: 4px; padding: 1px 5px; white-space: nowrap;
}

/* Note cell */
.nb-td-note { padding: 8px 6px !important; }
.nb-note-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.nb-note-input {
  width: 72px;
  text-align: center;
  border: 2px solid #e5e5e5;
  border-radius: 8px;
  padding: 6px 4px;
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  font-weight: 700;
  transition: border-color 0.15s, transform 0.12s, box-shadow 0.15s;
  background: #fff;
}
.nb-note-input:focus {
  outline: none;
  transform: scale(1.06);
  box-shadow: 0 2px 10px rgba(99,102,241,0.18);
  border-color: #6366f1;
}
.nb-note-input:disabled { background: #f3f4f6; }
.nb-note-locked {
  background: #f3f4f6 !important;
  border-color: #e5e5e5 !important;
  cursor: not-allowed;
  color: #ccc;
}
.nb-note--fail { border-color: #ef4444 !important; color: #dc2626; }
.nb-note--warn { border-color: #f59e0b !important; color: #d97706; }
.nb-note--pass { border-color: #10b981 !important; color: #059669; }

/* Mini progress bar */
.nb-note-bar {
  width: 72px;
  height: 4px;
  background: #f0f0f0;
  border-radius: 99px;
  overflow: hidden;
}
.nb-note-bar-fill {
  height: 100%;
  border-radius: 99px;
  transition: width 0.3s ease;
}

/* Moyenne badge */
.nb-td-moy { text-align: center; }
.nb-moy-badge {
  display: inline-block;
  padding: 5px 12px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.01em;
}
.nb-moy--fail { background: #fee2e2; color: #dc2626; }
.nb-moy--warn { background: #fef3c7; color: #d97706; }
.nb-moy--pass { background: #d1fae5; color: #059669; }
.nb-moy--empty { background: #f3f4f6; color: #aaa; }

/* ── JURY ────────────────────────────────────────────────── */
.nb-podium {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 24px 20px 16px;
  flex-wrap: wrap;
}
.nb-podium-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: #fff;
  border-radius: 14px;
  padding: 18px 20px;
  min-width: 140px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.09);
  border-top: 4px solid #e5e5e5;
}
.nb-podium-card--or { border-top-color: #f59e0b; background: linear-gradient(180deg, #fffbeb, #fff); }
.nb-podium-card--argent { border-top-color: #94a3b8; background: linear-gradient(180deg, #f8fafc, #fff); }
.nb-podium-card--bronze { border-top-color: #c2410c; background: linear-gradient(180deg, #fff7ed, #fff); }
.nb-podium-medal { font-size: 26px; }
.nb-podium-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
}
.nb-podium-nom { font-size: 12px; font-weight: 700; color: #333; text-align: center; }
.nb-podium-moy { font-size: 20px; font-weight: 800; color: #222; }
.nb-podium-mention { font-size: 11px; color: #10b981; font-weight: 600; }

.nb-jury-table-wrap { overflow-x: auto; }
.nb-rang { font-size: 14px; font-weight: 700; color: #888; }
.nb-rang--or { color: #f59e0b; }
.nb-rang--argent { color: #94a3b8; }
.nb-rang--bronze { color: #c2410c; }
.nb-moy-jury { font-size: 16px; font-weight: 800; }
.nb-moy-jury--ok { color: #16a34a; }
.nb-moy-jury--fail { color: #E30613; }

/* ── JURY STEPS ─────────────────────────────────────────── */
.nb-jury-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  padding: 12px 16px;
  background: #f8fafc;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
}
.nb-jury-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  background: #fff;
  border: 1.5px solid #e2e8f0;
  transition: all .2s;
}
.nb-jury-step--active {
  background: #1a3a6b;
  color: #fff;
  border-color: #1a3a6b;
}
.nb-jury-step-num {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255,255,255,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 800;
}
.nb-jury-step--active .nb-jury-step-num {
  background: rgba(255,255,255,0.3);
}
.nb-jury-step-label { font-size: 12px; }
.nb-jury-step-arrow { color: #cbd5e1; font-size: 18px; font-weight: 300; }

/* ── JURY PANEL ─────────────────────────────────────────── */
.nb-jury-panel {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px 24px;
}
.nb-jury-panel-title {
  font-size: 16px;
  font-weight: 700;
  color: #1a3a6b;
  margin: 0 0 16px;
  padding-bottom: 10px;
  border-bottom: 2px solid #e2e8f0;
}
.nb-jury-sub-title {
  font-size: 13px;
  font-weight: 700;
  color: #475569;
  margin: 16px 0 10px;
  text-transform: uppercase;
  letter-spacing: .5px;
}
.nb-jury-field-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.nb-jury-label {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  min-width: 160px;
}
.nb-jury-date-input {
  padding: 6px 10px;
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  font-size: 13px;
  color: #334155;
  outline: none;
}
.nb-jury-date-input:focus { border-color: #1a3a6b; }
.nb-jury-membres { display: flex; flex-direction: column; gap: 8px; }
.nb-jury-membre-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.nb-jury-input {
  flex: 1;
  padding: 7px 10px;
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  font-size: 13px;
  outline: none;
  color: #334155;
}
.nb-jury-input:focus { border-color: #1a3a6b; }
.nb-jury-select {
  padding: 7px 10px;
  border: 1.5px solid #e2e8f0;
  border-radius: 7px;
  font-size: 13px;
  color: #334155;
  outline: none;
  background: #fff;
  min-width: 170px;
}
.nb-jury-select:focus { border-color: #1a3a6b; }
.nb-jury-btn-remove {
  padding: 6px 10px;
  background: #fee2e2;
  color: #dc2626;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
}
.nb-jury-btn-add {
  align-self: flex-start;
  margin-top: 4px;
  padding: 7px 14px;
  background: #f1f5f9;
  color: #475569;
  border: 1.5px dashed #94a3b8;
  border-radius: 7px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 600;
}
.nb-jury-btn-add:hover { background: #e2e8f0; }

/* Bouton "↺ N enseignants identifiés" */
.nb-jury-btn-suggests {
  font-size: 11.5px; font-weight: 600; cursor: pointer;
  padding: 4px 10px; border-radius: 99px;
  border: 1.5px solid #3b82f6; background: #eff6ff; color: #1d4ed8;
  transition: background 0.15s;
}
.nb-jury-btn-suggests:hover { background: #dbeafe; }
.nb-jury-btn-suggests:disabled { opacity: 0.5; cursor: default; }

/* Badges enseignants identifiés */
.nb-jury-suggests-list {
  display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px;
  padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
}
.nb-jury-suggest-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px; font-weight: 600; padding: 3px 10px; border-radius: 99px;
}
.nb-jury-suggest-chip--actif { background: #dcfce7; color: #15803d; }
.nb-jury-suggest-chip--ue    { background: #e0e7ff; color: #3730a3; }

.nb-jury-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
}
.nb-jury-warning {
  background: #fef2f2;
  border: 1px solid #fca5a5;
  color: #b91c1c;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  margin-bottom: 14px;
}
.nb-jury-success {
  background: #f0fdf4;
  border: 1px solid #86efac;
  color: #166534;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
}
.nb-jury-decision-select {
  padding: 5px 8px;
  border: 1.5px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  color: #334155;
  outline: none;
  background: #fff;
  min-width: 120px;
}
.nb-jury-decision-select:focus { border-color: #1a3a6b; }
.nb-jury-obs-input {
  padding: 5px 8px;
  border: 1.5px solid #e2e8f0;
  border-radius: 6px;
  font-size: 12px;
  width: 100%;
  outline: none;
  min-width: 120px;
}
.nb-jury-obs-input:focus { border-color: #1a3a6b; }
.nb-jury-recap {
  display: flex;
  gap: 14px;
  margin: 14px 0 20px;
  flex-wrap: wrap;
}
.nb-jury-recap-card {
  flex: 1;
  min-width: 100px;
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px;
  text-align: center;
}
.nb-jury-recap-card--admis { border-top: 3px solid #16a34a; }
.nb-jury-recap-card--ratt { border-top: 3px solid #d97706; }
.nb-jury-recap-card--redoub { border-top: 3px solid #E30613; }
.nb-jury-recap-val { font-size: 28px; font-weight: 800; color: #1e293b; }
.nb-jury-recap-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; margin-top: 4px; }
.nb-jury-signatures { margin-top: 14px; }
.nb-jury-sig-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
  margin-top: 10px;
}
.nb-jury-sig-item { text-align: center; }
.nb-jury-sig-line {
  height: 1px;
  background: #94a3b8;
  margin-bottom: 6px;
  width: 80%;
  margin-left: auto;
  margin-right: auto;
}
.nb-jury-sig-nom { font-size: 12px; font-weight: 700; color: #334155; }
.nb-jury-sig-fonction { font-size: 11px; color: #94a3b8; }
.nb-btn { padding: 9px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all .15s; }
.nb-btn--primary { background: #1a3a6b; color: #fff; }
.nb-btn--primary:hover { background: #152f58; }
.nb-btn--primary:disabled { opacity: .6; cursor: not-allowed; }
.nb-btn--secondary { background: #f1f5f9; color: #334155; border: 1.5px solid #e2e8f0; }
.nb-btn--secondary:hover { background: #e2e8f0; }
.nb-btn--danger { background: #E30613; color: #fff; }
.nb-btn--danger:hover { background: #b91c1c; }
.nb-btn--danger:disabled { opacity: .6; cursor: not-allowed; }
.nb-btn--ghost { background: transparent; color: #64748b; border: 1.5px solid #e2e8f0; }
.nb-btn--ghost:hover { background: #f8fafc; }

/* ── STATS BAR ──────────────────────────────────────────── */
.nb-stats-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.07);
  padding: 16px 22px;
  margin-bottom: 20px;
}
.nb-stats-kpi {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 80px;
}
.nb-stats-kpi--mentions { align-items: flex-start; }
.nb-stats-kpi-val {
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 4px;
}
.nb-stats-kpi-label {
  font-size: 10px;
  color: #aaa;
  text-transform: uppercase;
  letter-spacing: .05em;
  text-align: center;
}
.nb-stats-mentions {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.nb-mention-chip {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 99px;
}
.nb-mention-chip--tb  { background: #f0fdf4; color: #15803d; }
.nb-mention-chip--b   { background: #d1fae5; color: #065f46; }
.nb-mention-chip--ab  { background: #dbeafe; color: #1d4ed8; }
.nb-mention-chip--p   { background: #fff7ed; color: #c2410c; }
.nb-mention-chip--i   { background: #fff0f0; color: #E30613; }
.nb-btn-export-all {
  margin-left: auto;
  background: linear-gradient(135deg, #1d4ed8, #4338ca);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  box-shadow: 0 3px 10px rgba(29,78,216,0.25);
  transition: opacity 0.15s;
  white-space: nowrap;
}
.nb-btn-export-all:disabled { opacity: 0.55; cursor: not-allowed; }
.nb-btn-export-all:not(:disabled):hover { opacity: 0.88; }

/* ── BULLETIN CARD RANG ────────────────────────────────── */
.nb-bulletin-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: -4px;
}
.nb-bulletin-rang {
  font-size: 12px;
  font-weight: 800;
  color: #aaa;
  background: #f3f4f6;
  border-radius: 99px;
  padding: 2px 8px;
}

/* ── BULLETINS GRID ─────────────────────────────────────── */
.nb-bulletins-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  padding: 4px 2px;
}
.nb-bulletin-card {
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
  padding: 22px 18px 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transition: transform 0.15s, box-shadow 0.15s;
}
.nb-bulletin-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
.nb-bulletin-card-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #6366f1, #ec4899);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
  box-shadow: 0 4px 12px rgba(99,102,241,0.3);
}
.nb-bulletin-card-info { text-align: center; }
.nb-bulletin-card-nom { font-size: 13px; font-weight: 700; color: #222; }
.nb-bulletin-card-filiere { font-size: 11px; color: #aaa; }
.nb-bulletin-card-moy { font-size: 22px; font-weight: 800; }
.nb-bulletin-moy--ok { color: #16a34a; }
.nb-bulletin-moy--fail { color: #E30613; }
.nb-btn-bulletin {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  width: 100%;
  box-shadow: 0 2px 8px rgba(99,102,241,0.2);
  transition: opacity 0.15s;
}
.nb-btn-bulletin:hover { opacity: 0.88; }

/* ── BULLETIN POPUP ─────────────────────────────────────── */
.nb-bulletin-header {
  background: linear-gradient(135deg, #E30613 0%, #6366f1 100%);
  border-radius: 12px 12px 0 0;
  margin: -24px -24px 20px;
  padding: 30px 24px 24px;
  text-align: center;
  color: #fff;
}
.nb-bulletin-header-school {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  opacity: 0.8;
  margin-bottom: 10px;
}
.nb-bulletin-header-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(255,255,255,0.25);
  border: 3px solid rgba(255,255,255,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  font-weight: 800;
  margin: 0 auto 10px;
}
.nb-bulletin-header-nom { font-size: 20px; font-weight: 800; margin-bottom: 4px; }
.nb-bulletin-header-meta { font-size: 12px; opacity: 0.75; }

.nb-bulletin-kpi {
  display: flex;
  gap: 14px;
  margin-bottom: 20px;
}
.nb-kpi-card {
  flex: 1;
  border-radius: 10px;
  padding: 14px 10px;
  text-align: center;
  border: 1px solid #f0f0f0;
  background: #fafafa;
}
.nb-kpi--ok { background: #f0fdf4; border-color: #bbf7d0; }
.nb-kpi--fail { background: #fff0f0; border-color: #fca5a5; }
.nb-kpi--mention { background: #eff6ff; border-color: #bfdbfe; }
.nb-kpi--credits { background: #fff7ed; border-color: #fed7aa; }
.nb-kpi-value { font-size: 22px; font-weight: 800; margin-bottom: 4px; color: #222; }
.nb-kpi-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.08em; }

.nb-bulletin-section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 6px;
}
.nb-bulletin-section-label--tronc { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.nb-bulletin-section-label--spec { background: #f0fdf4; color: #15803d; border: 1px solid #86efac; }

.nb-bulletin-table td { padding: 8px 10px; }
.nb-bulletin-note-cell { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.nb-bulletin-note-val { font-size: 14px; font-weight: 800; }
.nb-credit-badge { padding: 2px 7px; border-radius: 4px; font-size: 10.5px; font-weight: 600; }

.nb-decision-banner {
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 20px;
  border: 1px solid;
}
.nb-decision-banner--admis { background: #f0fdf4; border-color: #bbf7d0; }
.nb-decision-banner--passif { background: #eff6ff; border-color: #bfdbfe; }
.nb-decision-banner--rattrapage { background: #fff7ed; border-color: #fed7aa; }
.nb-decision-banner--redoublant { background: #fff0f0; border-color: #fca5a5; }
.nb-decision-banner-label { font-size: 10px; color: #aaa; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 5px; }
.nb-decision-banner-text { font-size: 17px; font-weight: 800; }
.nb-decision-banner--admis .nb-decision-banner-text { color: #16a34a; }
.nb-decision-banner--passif .nb-decision-banner-text { color: #1d4ed8; }
.nb-decision-banner--rattrapage .nb-decision-banner-text { color: #c2410c; }
.nb-decision-banner--redoublant .nb-decision-banner-text { color: #E30613; }

.nb-signatures {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-top: 24px;
  text-align: center;
}
.nb-signature-line {
  border-top: 1px solid #999;
  padding-top: 8px;
}
.nb-signature-line p { font-size: 10px; color: #888; margin: 0; }

/* ── SHARED ──────────────────────────────────────────────── */
.nb-decision-badge { padding: 4px 11px; border-radius: 99px; font-size: 11px; font-weight: 600; }
.bg-green-100 { background: #f0fdf4; } .text-green-700 { color: #15803d; }
.bg-orange-100 { background: #fff7ed; } .text-orange-600 { color: #ea580c; }
.bg-red-100 { background: #fff0f0; } .text-red-700 { color: #b91c1c; }
.bg-gray-100 { background: #f3f4f6; } .text-gray-600 { color: #555; }

.text-green-600 { color: #16a34a; }
.text-green-500 { color: #22c55e; }
.text-blue-500 { color: #3b82f6; }
.text-orange-500 { color: #f97316; }
.text-gray-700 { color: #374151; }
.text-gray-400 { color: #9ca3af; }

.nb-btn-save-notes {
  background: linear-gradient(135deg, #E30613, #c2001a);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 9px 18px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  box-shadow: 0 2px 8px rgba(227,6,19,0.25);
  transition: opacity 0.15s;
}
.nb-btn-save-notes:disabled { opacity: 0.5; }

.nb-input {
  border: 1.5px solid #e5e5e5;
  border-radius: 6px;
  padding: 9px 10px;
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  color: #333;
  background: #fafafa;
  transition: border-color 0.15s;
}
.nb-input:focus { outline: none; border-color: #6366f1; background: #fff; }
.nb-btn-pdf {
  flex: 1;
  border: none;
  background: linear-gradient(135deg, #E30613, #b91c1c);
  color: #fff;
  border-radius: 8px;
  padding: 10px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  transition: opacity 0.15s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.nb-btn-pdf:hover { opacity: .88; }
.nb-btn-cancel {
  flex: 1;
  border: 1.5px solid #e5e5e5;
  background: #fff;
  color: #555;
  border-radius: 8px;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  transition: background 0.15s;
}
.nb-btn-cancel:hover { background: #f5f5f5; }
.nb-btn-save {
  flex: 1;
  background: linear-gradient(135deg, #E30613, #c2001a);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  box-shadow: 0 2px 8px rgba(227,6,19,0.2);
}
.nb-btn-save:disabled { opacity: 0.5; }

@media (max-width: 768px) {
  .nb-toolbar { flex-direction: column; align-items: flex-start; }
  .nb-toolbar-left { flex-direction: column; align-items: flex-start; }
  .nb-saisie-wrap { overflow-x: auto; }
  .nb-table { min-width: 600px; }
  .nb-table-toolbar { flex-wrap: wrap; gap: 8px; }
  .nb-tabs { overflow-x: auto; }
  .nb-bulletins-grid { grid-template-columns: 1fr 1fr; }
  .nb-podium { gap: 10px; }
  .nb-bulletin-kpi { flex-direction: column; }
  .nb-signatures { grid-template-columns: 1fr; }
}

/* ── SEMESTRE HEADERS ──────────────────────────────────── */
.nb-sem-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 700;
  margin: 12px 0 6px;
}
.nb-sem-header--s1 { background: #eff6ff; color: #1d4ed8; border-left: 4px solid #3b82f6; }
.nb-sem-header--s2 { background: #f0fdf4; color: #15803d; border-left: 4px solid #10b981; }
.nb-sem-stats { font-size: 12px; font-weight: 600; opacity: .8; }

/* ── FORMATION PRO TABLE ───────────────────────────────── */
.nb-fp-table { font-size: 12px; }
.nb-fp-thead { background: #f8fafc; }
.nb-fp-row { border-bottom: 1px solid #f0f0f0; }
.nb-fp-row--fail { background: #fff9f9 !important; }
.nb-fp-appr { padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
.nb-fp-result { padding: 2px 8px; border-radius: 99px; font-size: 10.5px; font-weight: 700; }
</style>
