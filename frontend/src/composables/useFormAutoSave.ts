import { watch, ref, onBeforeUnmount, type Ref } from 'vue'

const STORAGE_PREFIX = 'uptech.draft.'
const DEBOUNCE_MS = 1500
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 jours

export interface UseFormAutoSaveOptions {
  /** Clé unique pour ce formulaire (ex. "etudiant-create", "etudiant-edit-42") */
  key: string
  /** Si true, ignore la sauvegarde même si le form change. Utile pour désactiver
   *  pendant un appel API en cours. */
  pause?: () => boolean
  /** Champs à omettre (ex. mots de passe). */
  exclude?: string[]
}

interface DraftMeta {
  savedAt: number
  data: any
}

/**
 * Sauvegarde automatique d'un formulaire dans localStorage.
 *
 * Pattern d'usage :
 * ```
 * const form = ref({ nom: '', prenom: '' })
 * const auto = useFormAutoSave(form, { key: 'etudiant-create' })
 *
 * // Si un brouillon existe, auto.hasDraft.value === true.
 * // Affichez une bannière qui appelle auto.restoreDraft() ou auto.clearDraft().
 *
 * // Après une sauvegarde réussie côté serveur :
 * auto.clearDraft()
 * ```
 */
export function useFormAutoSave<T extends object>(form: Ref<T>, opts: UseFormAutoSaveOptions) {
  const storageKey = STORAGE_PREFIX + opts.key
  const hasDraft = ref(false)
  const draftAge = ref<number | null>(null)
  const isPaused = ref(false)

  // Lecture du brouillon existant
  function loadDraftMeta(): DraftMeta | null {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as DraftMeta
      if (!parsed?.savedAt) return null
      // Expire après 7 jours
      if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
        localStorage.removeItem(storageKey)
        return null
      }
      return parsed
    } catch {
      return null
    }
  }

  function refreshDraftFlag() {
    const meta = loadDraftMeta()
    hasDraft.value = !!meta
    draftAge.value = meta ? meta.savedAt : null
  }

  refreshDraftFlag()

  // Restaurer le brouillon dans le form
  function restoreDraft() {
    const meta = loadDraftMeta()
    if (!meta) return false
    try {
      // Fusion : on conserve le typage du form et on n'écrase que les clés présentes
      Object.assign(form.value as any, meta.data)
      return true
    } catch {
      return false
    }
  }

  function clearDraft() {
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    hasDraft.value = false
    draftAge.value = null
  }

  // Sauvegarde déboucée
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleSave() {
    if (opts.pause?.()) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        const data = { ...(form.value as any) }
        for (const k of (opts.exclude || [])) delete data[k]
        // Vide ? on n'écrit pas
        const isEmpty = Object.values(data).every(v =>
          v === '' || v === null || v === undefined ||
          (Array.isArray(v) && v.length === 0) ||
          v === false || v === 0
        )
        if (isEmpty) return
        localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), data }))
        hasDraft.value = true
        draftAge.value = Date.now()
      } catch { /* quota plein, ignore */ }
    }, DEBOUNCE_MS)
  }

  const stop = watch(form, () => {
    if (isPaused.value) return
    scheduleSave()
  }, { deep: true })

  onBeforeUnmount(() => {
    if (saveTimer) clearTimeout(saveTimer)
    stop()
  })

  /** Met en pause la sauvegarde (ex. pendant le submit serveur). */
  function pause() { isPaused.value = true }
  function resume() { isPaused.value = false }

  /** Format lisible de l'ancienneté du brouillon ("il y a 2 min"). */
  function draftAgeLabel(): string {
    if (!draftAge.value) return ''
    const diff = Date.now() - draftAge.value
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'à l\'instant'
    if (mins < 60) return `il y a ${mins} min`
    const h = Math.floor(mins / 60)
    if (h < 24) return `il y a ${h}h`
    const d = Math.floor(h / 24)
    return `il y a ${d}j`
  }

  return {
    hasDraft,
    draftAge,
    draftAgeLabel,
    restoreDraft,
    clearDraft,
    pause,
    resume,
  }
}

/**
 * Petit composant ready-made (style banner) pour afficher la proposition de
 * restauration. Utilisé tel quel dans les formulaires.
 */
export const DRAFT_BANNER_HTML_HINT = '/* Use FormDraftBanner.vue */'
