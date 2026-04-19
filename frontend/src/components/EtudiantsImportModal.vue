<template>
  <div v-if="open" class="imp-backdrop" @click.self="close">
    <div class="imp-modal">
      <header class="imp-header">
        <h2>Importer des étudiants</h2>
        <button class="imp-close" @click="close" aria-label="Fermer">×</button>
      </header>

      <div class="imp-body">
        <!-- Étape 1 : choix fichier + template -->
        <section v-if="step === 'choose'">
          <p class="imp-intro">
            Importez plusieurs étudiants d'un coup depuis un fichier CSV ou Excel (.xlsx).
            Les numéros étudiants sont générés automatiquement.
          </p>
          <div class="imp-template">
            <button class="imp-btn imp-btn--ghost" @click="downloadTemplate">
              📄 Télécharger le modèle CSV
            </button>
            <span class="imp-template-hint">
              Colonnes attendues : <code>nom</code>, <code>prenom</code>, <code>email</code>,
              <code>telephone</code>, <code>date_naissance</code> (YYYY-MM-DD),
              <code>sexe</code> (masculin/feminin), <code>lieu_naissance</code>,
              <code>adresse</code>, <code>cni_numero</code>, <code>nom_parent</code>,
              <code>telephone_parent</code>, <code>handicape</code> (oui/non),
              <code>type_handicap</code>, <code>statut_professionnel</code>
              (salarie/independant/sans_emploi/etudiant/autre), <code>employeur</code>.
              <br>Seuls <strong>nom</strong> et <strong>prenom</strong> sont obligatoires.
            </span>
          </div>
          <label class="imp-drop" :class="{ 'imp-drop--active': dragging }"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop">
            <input type="file" accept=".csv,.xlsx,.xls" @change="onFileInput" hidden />
            <div class="imp-drop-inner">
              <div class="imp-drop-icon">📥</div>
              <div class="imp-drop-text">
                <strong>Cliquez pour choisir un fichier</strong> ou déposez-le ici
              </div>
              <div class="imp-drop-sub">CSV ou XLSX — 500 lignes max par import</div>
            </div>
          </label>
          <p v-if="parseError" class="imp-error">{{ parseError }}</p>
        </section>

        <!-- Étape 2 : preview -->
        <section v-else-if="step === 'preview'">
          <div class="imp-summary">
            <div><strong>{{ fileName }}</strong></div>
            <div>{{ parsedRows.length }} ligne(s) détectée(s)</div>
            <div v-if="clientErrors.length > 0" class="imp-warn">
              ⚠️ {{ clientErrors.length }} ligne(s) avec erreurs détectées côté client
            </div>
          </div>
          <div class="imp-preview-wrap">
            <table class="imp-preview">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Nom</th>
                  <th>Prénom</th>
                  <th>Email</th>
                  <th>Téléphone</th>
                  <th>Sexe</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in previewRows" :key="i"
                  :class="{ 'imp-row-err': clientErrorsByRow.has(i + 1) }">
                  <td>{{ i + 1 }}</td>
                  <td>{{ r.nom }}</td>
                  <td>{{ r.prenom }}</td>
                  <td>{{ r.email }}</td>
                  <td>{{ r.telephone }}</td>
                  <td>{{ r.sexe }}</td>
                  <td>
                    <span v-if="clientErrorsByRow.has(i + 1)" class="imp-badge imp-badge--err"
                      :title="clientErrorsByRow.get(i + 1)">✗ erreur</span>
                    <span v-else class="imp-badge imp-badge--ok">✓</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-if="parsedRows.length > previewRows.length" class="imp-more">
              … et {{ parsedRows.length - previewRows.length }} autre(s) ligne(s)
            </p>
          </div>
          <div v-if="clientErrors.length > 0" class="imp-errbox">
            <h4>Erreurs détectées</h4>
            <ul>
              <li v-for="e in clientErrors" :key="e.row">Ligne {{ e.row }} : {{ e.error }}</li>
            </ul>
          </div>
        </section>

        <!-- Étape 3 : en cours -->
        <section v-else-if="step === 'importing'">
          <div class="imp-loading">
            <div class="imp-spinner"></div>
            <p>Import en cours… ({{ sentRows }} / {{ toSend.length }})</p>
          </div>
        </section>

        <!-- Étape 4 : rapport -->
        <section v-else-if="step === 'done'">
          <div class="imp-report">
            <div class="imp-report-kpis">
              <div class="imp-kpi imp-kpi--ok">
                <div class="imp-kpi-val">{{ result.inserted }}</div>
                <div class="imp-kpi-lbl">Insérés</div>
              </div>
              <div class="imp-kpi imp-kpi--err">
                <div class="imp-kpi-val">{{ result.errors.length }}</div>
                <div class="imp-kpi-lbl">Erreurs</div>
              </div>
              <div class="imp-kpi">
                <div class="imp-kpi-val">{{ result.total }}</div>
                <div class="imp-kpi-lbl">Total</div>
              </div>
            </div>
            <div v-if="result.errors.length > 0" class="imp-errbox">
              <h4>Lignes en erreur</h4>
              <ul>
                <li v-for="e in result.errors" :key="e.row">
                  Ligne {{ e.row }} : {{ e.error }}
                </li>
              </ul>
              <button class="imp-btn imp-btn--ghost" @click="downloadErrors">
                Télécharger le rapport d'erreurs (.csv)
              </button>
            </div>
          </div>
        </section>
      </div>

      <footer class="imp-footer">
        <button v-if="step === 'choose'" class="imp-btn imp-btn--ghost" @click="close">Annuler</button>
        <template v-else-if="step === 'preview'">
          <button class="imp-btn imp-btn--ghost" @click="resetChoose">← Changer de fichier</button>
          <button class="imp-btn imp-btn--primary" :disabled="validRows.length === 0" @click="doImport">
            Importer {{ validRows.length }} étudiant(s)
          </button>
        </template>
        <template v-else-if="step === 'done'">
          <button class="imp-btn imp-btn--ghost" @click="resetChoose">Nouvel import</button>
          <button class="imp-btn imp-btn--primary" @click="close">Terminer</button>
        </template>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import api from '@/services/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'imported', count: number): void }>()

type Step = 'choose' | 'preview' | 'importing' | 'done'
type ImportRow = {
  nom?: string
  prenom?: string
  email?: string
  telephone?: string
  date_naissance?: string
  lieu_naissance?: string
  adresse?: string
  cni_numero?: string
  nom_parent?: string
  telephone_parent?: string
  sexe?: string
  handicape?: string | boolean
  type_handicap?: string
  statut_professionnel?: string
  employeur?: string
}

const step = ref<Step>('choose')
const dragging = ref(false)
const parseError = ref('')
const fileName = ref('')
const parsedRows = ref<ImportRow[]>([])
const clientErrors = ref<Array<{ row: number; error: string }>>([])
const sentRows = ref(0)
const result = ref<{
  total: number
  inserted: number
  errors: Array<{ row: number; error: string }>
}>({ total: 0, inserted: 0, errors: [] })

const TEMPLATE_HEADERS = [
  'nom', 'prenom', 'email', 'telephone', 'date_naissance', 'lieu_naissance',
  'adresse', 'cni_numero', 'nom_parent', 'telephone_parent', 'sexe',
  'handicape', 'type_handicap', 'statut_professionnel', 'employeur',
]

const previewRows = computed(() => parsedRows.value.slice(0, 20))
const clientErrorsByRow = computed(() => {
  const m = new Map<number, string>()
  for (const e of clientErrors.value) m.set(e.row, e.error)
  return m
})
const validRows = computed(() =>
  parsedRows.value.filter((_, i) => !clientErrorsByRow.value.has(i + 1))
)
const toSend = computed(() => validRows.value)

function close() {
  emit('close')
  setTimeout(resetAll, 300)
}
function resetAll() {
  step.value = 'choose'
  parsedRows.value = []
  clientErrors.value = []
  fileName.value = ''
  parseError.value = ''
  sentRows.value = 0
  result.value = { total: 0, inserted: 0, errors: [] }
}
function resetChoose() {
  step.value = 'choose'
  parsedRows.value = []
  clientErrors.value = []
  fileName.value = ''
  parseError.value = ''
}

function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) handleFile(f)
}
function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) handleFile(f)
  input.value = ''
}

async function handleFile(f: File) {
  parseError.value = ''
  fileName.value = f.name
  const lower = f.name.toLowerCase()
  try {
    if (lower.endsWith('.csv')) {
      const text = await f.text()
      parsedRows.value = parseCsv(text)
    } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      // xlsx chargé dynamiquement → ne pèse pas dans le bundle initial
      const XLSX = await import('xlsx')
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const sheetName = wb.SheetNames[0]
      if (!sheetName) { parseError.value = 'Classeur Excel vide (aucune feuille).'; return }
      const sheet = wb.Sheets[sheetName]
      if (!sheet) { parseError.value = 'Impossible de lire la première feuille.'; return }
      parsedRows.value = XLSX.utils.sheet_to_json<ImportRow>(sheet, { defval: '', raw: false })
    } else {
      parseError.value = 'Format non supporté. Utilisez .csv ou .xlsx'
      return
    }
    if (parsedRows.value.length === 0) {
      parseError.value = 'Le fichier est vide.'
      return
    }
    if (parsedRows.value.length > 500) {
      parseError.value = `Le fichier contient ${parsedRows.value.length} lignes. Maximum 500 par import — découpez votre fichier.`
      return
    }
    validateClient()
    step.value = 'preview'
  } catch (e: any) {
    parseError.value = `Erreur de lecture : ${e?.message || 'format invalide'}`
  }
}

function parseCsv(text: string): ImportRow[] {
  // Parseur CSV simple compatible avec les fichiers Excel (virgule ou point-virgule, guillemets)
  const stripBom = text.replace(/^\uFEFF/, '')
  const lines = stripBom.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length < 2) return []
  const headerLine = lines[0] as string
  const sep = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ','
  const parseLine = (line: string): string[] => {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (ch === '"') { inQ = false }
        else cur += ch
      } else {
        if (ch === '"') inQ = true
        else if (ch === sep) { out.push(cur); cur = '' }
        else cur += ch
      }
    }
    out.push(cur)
    return out
  }
  const headers = parseLine(headerLine).map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const cells = parseLine(line)
    const obj: any = {}
    headers.forEach((h, i) => { obj[h] = (cells[i] || '').trim() })
    return obj as ImportRow
  })
}

function validateClient() {
  const errs: Array<{ row: number; error: string }> = []
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const seen = new Map<string, number>()
  parsedRows.value.forEach((r, idx) => {
    const row = idx + 1
    const nom = String(r.nom || '').trim()
    const prenom = String(r.prenom || '').trim()
    if (!nom || !prenom) {
      errs.push({ row, error: 'Nom et prénom obligatoires.' })
      return
    }
    const em = String(r.email || '').trim().toLowerCase()
    if (em) {
      if (!emailRegex.test(em)) { errs.push({ row, error: `Email invalide : ${em}` }); return }
      if (seen.has(em)) { errs.push({ row, error: `Doublon email avec ligne ${seen.get(em)}` }); return }
      seen.set(em, row)
    }
    const d = String(r.date_naissance || '').trim()
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      errs.push({ row, error: `Date de naissance format YYYY-MM-DD attendu : ${d}` })
      return
    }
    const s = String(r.sexe || '').trim().toLowerCase()
    if (s && !['masculin', 'feminin'].includes(s)) {
      errs.push({ row, error: `Sexe doit être "masculin" ou "feminin" : ${s}` })
    }
  })
  clientErrors.value = errs
}

async function doImport() {
  step.value = 'importing'
  sentRows.value = 0
  const aggErrors: Array<{ row: number; error: string }> = []
  let totalInserted = 0

  // Envoi par lots de 100 pour éviter les timeouts serverless (60s)
  const BATCH = 100
  const rows = validRows.value
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    try {
      const { data } = await api.post('/etudiants/import', { rows: chunk })
      totalInserted += data.inserted || 0
      // Les index retournés sont relatifs au chunk → on les décale
      for (const e of (data.errors || [])) {
        aggErrors.push({ row: i + e.row, error: e.error })
      }
      sentRows.value = Math.min(i + chunk.length, rows.length)
    } catch (e: any) {
      // Le chunk entier a échoué (401, 500…) — marquer toutes ses lignes en erreur
      const msg = e?.response?.data?.message || e?.message || 'Erreur réseau'
      for (let k = 0; k < chunk.length; k++) {
        aggErrors.push({ row: i + k + 1, error: msg })
      }
      sentRows.value = Math.min(i + chunk.length, rows.length)
    }
  }

  result.value = {
    total: parsedRows.value.length,
    inserted: totalInserted,
    errors: [...clientErrors.value, ...aggErrors].sort((a, b) => a.row - b.row),
  }
  step.value = 'done'
  if (totalInserted > 0) emit('imported', totalInserted)
}

function downloadTemplate() {
  const csv = TEMPLATE_HEADERS.join(',') + '\n' +
    'Doe,John,john@example.com,+221771234567,2000-01-15,Dakar,,,,,masculin,non,,etudiant,\n'
  triggerDownload(csv, 'modele_import_etudiants.csv', 'text/csv;charset=utf-8;')
}

function downloadErrors() {
  const header = 'ligne,erreur\n'
  const body = result.value.errors
    .map(e => `${e.row},"${(e.error || '').replace(/"/g, '""')}"`)
    .join('\n')
  triggerDownload('\uFEFF' + header + body, 'import_erreurs.csv', 'text/csv;charset=utf-8;')
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

void props
</script>

<style scoped>
.imp-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 2000; padding: 20px;
}
.imp-modal {
  background: #fff; border-radius: 12px; width: 100%; max-width: 900px;
  max-height: 90vh; display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
}
.imp-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18px 24px; border-bottom: 1px solid #eee;
}
.imp-header h2 { margin: 0; font-size: 1.25rem; }
.imp-close {
  background: transparent; border: none; font-size: 1.8rem; cursor: pointer;
  line-height: 1; color: #666;
}
.imp-body { padding: 24px; overflow: auto; flex: 1; }
.imp-footer {
  padding: 16px 24px; border-top: 1px solid #eee;
  display: flex; justify-content: flex-end; gap: 10px;
}
.imp-intro { color: #555; margin-bottom: 16px; }
.imp-template {
  background: #f8f9fb; border: 1px solid #e5e7eb; border-radius: 8px;
  padding: 14px; margin-bottom: 18px;
}
.imp-template-hint { display: block; margin-top: 10px; font-size: 0.85rem; color: #555; line-height: 1.5; }
.imp-template-hint code {
  background: #eef1f5; padding: 1px 5px; border-radius: 3px;
  font-size: 0.8rem;
}
.imp-drop {
  display: block; border: 2px dashed #cbd2db; border-radius: 10px;
  padding: 40px 20px; text-align: center; cursor: pointer;
  transition: all 0.2s;
}
.imp-drop:hover, .imp-drop--active {
  border-color: #E30613; background: #fff5f5;
}
.imp-drop-icon { font-size: 2.5rem; margin-bottom: 10px; }
.imp-drop-sub { font-size: 0.85rem; color: #777; margin-top: 6px; }
.imp-error {
  background: #fee; color: #c22; padding: 10px; border-radius: 6px; margin-top: 12px;
}
.imp-summary { margin-bottom: 14px; }
.imp-warn { color: #c60; margin-top: 6px; }
.imp-preview-wrap { max-height: 300px; overflow: auto; border: 1px solid #e5e7eb; border-radius: 6px; }
.imp-preview { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.imp-preview th, .imp-preview td {
  padding: 8px 10px; border-bottom: 1px solid #eef0f2; text-align: left;
}
.imp-preview thead th { background: #f8f9fb; position: sticky; top: 0; }
.imp-row-err { background: #fff5f5; }
.imp-badge {
  display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem;
}
.imp-badge--ok { background: #e6f7ea; color: #1a7e33; }
.imp-badge--err { background: #fee; color: #c22; }
.imp-more { color: #888; font-size: 0.85rem; padding: 8px 10px; margin: 0; }
.imp-errbox {
  margin-top: 16px; background: #fffaf5; border: 1px solid #f2d9b8;
  border-radius: 6px; padding: 12px;
}
.imp-errbox h4 { margin: 0 0 8px; }
.imp-errbox ul { margin: 0; padding-left: 20px; max-height: 200px; overflow: auto; font-size: 0.85rem; }
.imp-loading { text-align: center; padding: 40px 0; }
.imp-spinner {
  width: 40px; height: 40px; border: 4px solid #eee; border-top-color: #E30613;
  border-radius: 50%; margin: 0 auto 18px; animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.imp-report-kpis { display: flex; gap: 12px; margin-bottom: 16px; }
.imp-kpi {
  flex: 1; background: #f8f9fb; border-radius: 8px; padding: 14px; text-align: center;
}
.imp-kpi--ok { background: #e6f7ea; }
.imp-kpi--err { background: #fee; }
.imp-kpi-val { font-size: 1.8rem; font-weight: 700; }
.imp-kpi-lbl { font-size: 0.8rem; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
.imp-btn {
  padding: 9px 16px; border-radius: 6px; border: 1px solid transparent;
  cursor: pointer; font-weight: 600; font-size: 0.92rem;
}
.imp-btn--primary { background: #E30613; color: #fff; }
.imp-btn--primary:disabled { background: #ccc; cursor: not-allowed; }
.imp-btn--ghost { background: #fff; border-color: #d5dae0; color: #333; }
.imp-btn--ghost:hover { background: #f0f2f4; }
</style>
