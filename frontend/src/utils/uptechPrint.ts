// Utilitaires partagés pour les PDFs officiels UPTECH Campus (impression HTML).
// Factorisation de l'en-tête et des styles du reçu de paiement afin d'homogénéiser
// la mise en page de tous les documents institutionnels (absences, fiches,
// certificats, etc.).

export const UPTECH_LEGAL = {
  nomComplet: "Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication",
  tagline: 'Institut de Formation',
  meta: "NINEA : 006118310 _ BP 50281 RP DAKAR &nbsp;|&nbsp; Sicap Amitié 1, Villa N° 3031 — Dakar &nbsp;|&nbsp; Tél : 33 821 34 25 / 77 841 50 44",
  agrement: "Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT",
  footer: 'Amitié 1, Villa n°3031 — Dakar &nbsp;|&nbsp; +221 77 841 50 44 / 77 618 45 52 &nbsp;|&nbsp; uptechformation.com',
}

/** Retourne le chemin absolu du logo PNG (192×192) embarqué dans l'app. */
export function uptechLogoUrl(): string {
  if (typeof window === 'undefined') return '/icons/icon-192.png'
  return `${window.location.origin}/icons/icon-192.png`
}

/**
 * En-tête HTML officiel — à insérer en haut de chaque document imprimable.
 * Reprend exactement la mise en page du reçu de paiement : logo, tagline,
 * raison sociale, NINEA / adresse / téléphone, mention d'agrément, séparateur rouge.
 */
export function uptechHeaderHTML(): string {
  return `
    <div class="uph">
      <img src="${uptechLogoUrl()}" alt="Logo UPTECH Campus" class="uph-logo">
      <div class="uph-info">
        <div class="uph-tagline">${UPTECH_LEGAL.tagline}</div>
        <h1 class="uph-nom">${UPTECH_LEGAL.nomComplet}</h1>
        <div class="uph-meta">${UPTECH_LEGAL.meta}</div>
        <div class="uph-agree">${UPTECH_LEGAL.agrement}</div>
      </div>
    </div>`
}

/** Pied de page officiel — à insérer en bas de chaque document. */
export function uptechFooterHTML(extra?: string): string {
  return `<div class="upf">${UPTECH_LEGAL.footer}${extra ? ` &nbsp;|&nbsp; ${extra}` : ''}</div>`
}

/** Styles CSS communs : en-tête, pied de page, cartes info, signatures, etc. */
export function uptechPrintCSS(): string {
  return `
    *{box-sizing:border-box;margin:0;padding:0}
    @page{size:A4 portrait;margin:10mm}
    body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:11px;background:#fff}

    /* En-tête institutionnel ───────────────────────────────────── */
    .uph{display:flex;align-items:center;gap:14px;padding:10px 16px 8px;border-bottom:2px solid #E30613}
    .uph-logo{width:52px;height:52px;object-fit:contain;flex-shrink:0}
    .uph-tagline{font-size:7px;font-weight:700;color:#E30613;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
    .uph-nom{font-size:11px;font-weight:900;color:#111;line-height:1.2;margin-bottom:3px}
    .uph-meta{font-size:8px;color:#555;line-height:1.5}
    .uph-agree{font-size:7px;color:#888;margin-top:2px}

    /* Pied de page ────────────────────────────────────────────── */
    .upf{border-top:1px solid #ccc;color:#777;font-size:7px;text-align:center;padding:4px 16px;margin-top:10px}

    /* Cartouche de référence (coin haut droit) ────────────────── */
    .ref-chip{float:right;margin-top:-2px;padding:3px 8px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;font-family:monospace;font-size:9px;color:#991b1b;font-weight:700;letter-spacing:0.5px}

    /* Zone de contenu ─────────────────────────────────────────── */
    .doc-content{padding:12px 16px}
    .doc-title{font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;color:#111;text-align:center;margin:10px 0 4px}
    .doc-subtitle{font-size:9px;text-align:center;color:#888;margin-bottom:10px;letter-spacing:0.5px}

    /* Séparateur de section ───────────────────────────────────── */
    .doc-section-title{font-size:10px;font-weight:900;color:#E30613;text-transform:uppercase;letter-spacing:1px;margin:12px 0 6px;padding-bottom:3px;border-bottom:1px solid #f3f3f3}

    /* Grille d'infos ──────────────────────────────────────────── */
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
    .info-box{background:#f9f9f9;border:1px solid #eee;border-radius:4px;padding:6px 10px}
    .info-box label{font-size:7px;text-transform:uppercase;color:#aaa;font-weight:700;letter-spacing:0.5px;display:block;margin-bottom:2px}
    .info-box span{font-size:11px;font-weight:700;color:#111;word-wrap:break-word}
    .info-box.full{grid-column:1/-1}

    /* Encart décision / statut ────────────────────────────────── */
    .decision-box{border-radius:6px;padding:10px 14px;margin:10px 0;border:1.5px solid;background:#fff}
    .decision-box.approved{border-color:#10b981;background:#ecfdf5}
    .decision-box.rejected{border-color:#ef4444;background:#fef2f2}
    .decision-box.pending{border-color:#eab308;background:#fefce8}
    .decision-box.cancelled{border-color:#9ca3af;background:#f9fafb}
    .decision-box .dec-lbl{font-size:8px;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:3px}
    .decision-box .dec-val{font-size:18px;font-weight:900;letter-spacing:0.5px}
    .decision-box.approved .dec-lbl,.decision-box.approved .dec-val{color:#047857}
    .decision-box.rejected .dec-lbl,.decision-box.rejected .dec-val{color:#b91c1c}
    .decision-box.pending .dec-lbl,.decision-box.pending .dec-val{color:#a16207}
    .decision-box.cancelled .dec-lbl,.decision-box.cancelled .dec-val{color:#4b5563}
    .decision-box .dec-note{font-size:9px;color:#333;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(0,0,0,0.1);line-height:1.5}

    /* Motif utilisateur ───────────────────────────────────────── */
    .motif-box{background:#fffbeb;border:1px dashed #f59e0b;border-radius:4px;padding:8px 12px;margin:8px 0;font-size:10px;color:#78350f;font-style:italic;line-height:1.6}
    .motif-box::before{content:'« ';font-size:14px;color:#f59e0b}
    .motif-box::after{content:' »';font-size:14px;color:#f59e0b}

    /* Signatures ─────────────────────────────────────────────── */
    .sign-area{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:18px;padding-top:8px;border-top:1px dashed #ddd}
    .sign-box{text-align:center}
    .sign-box .sign-title{font-size:9px;font-weight:700;color:#333;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px}
    .sign-line{border-bottom:1px solid #ccc;height:40px;margin-bottom:4px}
    .sign-box .sign-hint{font-size:7px;color:#aaa;text-transform:uppercase;letter-spacing:0.5px}

    @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  `
}

/**
 * Ouvre une fenêtre de navigation cachée avec le HTML fourni et déclenche
 * l'impression automatiquement. Utilise un blob URL pour contourner les
 * interceptions du Service Worker PWA.
 */
export function openPrintWindow(html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, '_blank')
  if (w) {
    w.addEventListener('load', () => {
      w.addEventListener('afterprint', () => {
        try { w.close() } catch { /* ignore */ }
        URL.revokeObjectURL(url)
      })
      setTimeout(() => { w.print() }, 300)
    })
  } else {
    URL.revokeObjectURL(url)
  }
}
