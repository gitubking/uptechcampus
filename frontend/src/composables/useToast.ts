import { reactive } from 'vue'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  kind: ToastKind
  title?: string
  message: string
  duration: number
}

// État global partagé par toutes les instances de useToast()
const state = reactive<{ toasts: Toast[] }>({ toasts: [] })
let nextId = 1

function push(kind: ToastKind, message: string, opts?: { title?: string; duration?: number }) {
  const id = nextId++
  const toast: Toast = {
    id,
    kind,
    title: opts?.title,
    message,
    duration: opts?.duration ?? (kind === 'error' ? 7000 : 4500),
  }
  state.toasts.push(toast)
  if (toast.duration > 0) {
    setTimeout(() => dismiss(id), toast.duration)
  }
  return id
}

function dismiss(id: number) {
  const i = state.toasts.findIndex(t => t.id === id)
  if (i >= 0) state.toasts.splice(i, 1)
}

/**
 * Transforme les erreurs techniques en messages lisibles par un utilisateur
 * métier (DG, secrétariat, étudiant). On mappe les codes HTTP les plus fréquents
 * et on garde le message backend quand il est déjà clair.
 */
function humanizeError(err: any): { title: string; message: string } {
  const status = err?.response?.status
  const data = err?.response?.data
  const backendMsg = (typeof data === 'object' ? data?.message || data?.error : typeof data === 'string' ? data : null) || err?.message

  // Messages explicites du backend — on les privilégie s'ils sont clairs
  if (backendMsg && typeof backendMsg === 'string' && backendMsg.length > 0 && backendMsg.length < 300 && !backendMsg.includes('<html')) {
    // Cas backend déjà en français "humain" : on les garde
    if (/\b(Identifiants|Email|Mot de passe|Compte|Trop de tentatives|introuvable|autoris|requis|invalide|existe d[ée]j[àa]|Aucun|bloqu|suspendu)/i.test(backendMsg)) {
      return { title: status === 401 ? 'Accès refusé' : status === 404 ? 'Introuvable' : 'Erreur', message: backendMsg }
    }
  }

  // Défauts par code HTTP
  if (!status && err?.code === 'ERR_NETWORK') {
    return { title: 'Connexion perdue', message: 'Vérifiez votre connexion Internet puis réessayez.' }
  }
  if (status === 400) return { title: 'Requête invalide', message: backendMsg || 'Les informations saisies sont incorrectes. Vérifiez le formulaire.' }
  if (status === 401) return { title: 'Session expirée', message: 'Reconnectez-vous pour continuer.' }
  if (status === 403) return { title: 'Accès refusé', message: backendMsg || "Vous n'avez pas les droits nécessaires pour cette action." }
  if (status === 404) return { title: 'Introuvable', message: backendMsg || "L'élément demandé n'existe plus ou a été supprimé." }
  if (status === 409) return { title: 'Conflit', message: backendMsg || "Cette opération entre en conflit avec des données existantes." }
  if (status === 413) return { title: 'Fichier trop volumineux', message: 'Le fichier dépasse la taille maximale autorisée.' }
  if (status === 422) return { title: 'Données invalides', message: backendMsg || "Certains champs ne sont pas valides." }
  if (status === 429) return { title: 'Trop de tentatives', message: 'Patientez quelques secondes avant de réessayer.' }
  if (status && status >= 500) return { title: 'Serveur indisponible', message: 'Notre serveur rencontre un problème. Réessayez dans quelques minutes.' }

  return { title: 'Erreur', message: backendMsg || "Une erreur inattendue est survenue. Réessayez." }
}

export function useToast() {
  return {
    toasts: state.toasts,
    success: (message: string, opts?: { title?: string; duration?: number }) => push('success', message, opts),
    error:   (message: string, opts?: { title?: string; duration?: number }) => push('error',   message, opts),
    info:    (message: string, opts?: { title?: string; duration?: number }) => push('info',    message, opts),
    warning: (message: string, opts?: { title?: string; duration?: number }) => push('warning', message, opts),
    dismiss,
    /**
     * Raccourci pour afficher une erreur API avec un titre et un message
     * humanisés. Usage : `catch (e) { toast.apiError(e) }`.
     */
    apiError(err: any, fallback?: string) {
      const { title, message } = humanizeError(err)
      return push('error', fallback || message, { title })
    },
  }
}
