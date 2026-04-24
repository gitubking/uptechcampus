/**
 * Identité institutionnelle UPTECH Campus utilisée dans tous les documents
 * imprimés et exportés (reçus, relevés, bulletins, contrats…).
 *
 * Source de vérité : le reçu de paiement officiel utilisé en caisse.
 */

export const UPTECH_BRANDING = {
  shortName: 'UPTECH CAMPUS',
  fullName: "Institut Supérieur de Formation aux Nouveaux Métiers de l'Informatique et de la Communication",
  tagline: 'Institut de Formation',
  ninea: '006118310',
  bp: 'BP 50281 RP DAKAR',
  address: 'Sicap Amitié 1, Villa N° 3031 — Dakar',
  phones: '33 821 34 25 / 77 841 50 44',
  agrement: "Agréé par l'État : N°RepSEN/Ensup-priv/AP/387-2021_N°14191/MFPAA/SG/DFPT",
  website: 'uptechformation.com',
  primaryColor: '#E30613',         // rouge UPTECH
  primaryColorRgb: [227, 6, 19] as [number, number, number],
  logoUrl: '/icons/icon-192.png',
  footerLine: 'Amitié 1, Villa n°3031 — Dakar  |  +221 77 841 50 44 / 77 618 45 52  |  uptechformation.com',
}

/**
 * Bloc HTML de l'en-tête officiel — à utiliser tel quel dans les windows
 * d'impression / aperçus PDF générés via window.open(htmlBlob).
 *
 * Inclut le filet rouge sous l'en-tête. Les styles utilisés (.hdr, .hdr-info…)
 * doivent être présents dans le CSS du document.
 */
export function uptechHeaderHtml(opts?: { logoUrl?: string }): string {
  const logo = opts?.logoUrl ?? `${typeof window !== 'undefined' ? window.location.origin : ''}${UPTECH_BRANDING.logoUrl}`
  return `
    <div class="hdr">
      <img src="${logo}" alt="Logo UPTECH">
      <div class="hdr-info">
        <div class="tagline">${UPTECH_BRANDING.tagline}</div>
        <h1>${UPTECH_BRANDING.fullName}</h1>
        <div class="meta">NINEA : ${UPTECH_BRANDING.ninea} _ ${UPTECH_BRANDING.bp} &nbsp;|&nbsp; ${UPTECH_BRANDING.address} &nbsp;|&nbsp; Tél : ${UPTECH_BRANDING.phones}</div>
        <div class="agree">${UPTECH_BRANDING.agrement}</div>
      </div>
    </div>`
}

/**
 * CSS standard pour l'en-tête HTML.
 */
export const UPTECH_HEADER_CSS = `
.hdr{display:flex;align-items:center;gap:14px;padding:10px 16px 8px;border-bottom:2px solid ${UPTECH_BRANDING.primaryColor}}
.hdr img{width:52px;height:52px;object-fit:contain;flex-shrink:0}
.hdr-info .tagline{font-size:7px;font-weight:700;color:${UPTECH_BRANDING.primaryColor};text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
.hdr-info h1{font-size:11px;font-weight:900;color:#111;line-height:1.2;margin-bottom:3px}
.hdr-info .meta{font-size:8px;color:#555;line-height:1.5}
.hdr-info .agree{font-size:7px;color:#888;margin-top:2px}
.uptech-footer{border-top:1px solid #ccc;color:#777;font-size:7px;text-align:center;padding:4px 16px;margin-top:10px}
`

/**
 * Dessine l'en-tête institutionnel sur un document jsPDF (A4 portrait).
 * Retourne la position Y du curseur juste sous l'en-tête (pour enchaîner).
 *
 * Layout : filet rouge en haut, logo à gauche (chargé async via dataURL),
 * tagline rouge, nom complet en gras, NINEA + adresse + tel, agrément,
 * filet rouge en bas. Reproduit le rendu du reçu de paiement officiel.
 *
 * @param doc - instance jsPDF déjà créée
 * @param opts.title - titre du document (ex. "Relevé annuel 2026")
 * @param opts.startY - Y de départ (par défaut 0)
 */
export async function uptechPdfHeader(
  doc: any,
  opts: { title?: string; startY?: number } = {},
): Promise<number> {
  const W = doc.internal.pageSize.getWidth()
  const startY = opts.startY ?? 0

  // Filet rouge en haut
  doc.setFillColor(...UPTECH_BRANDING.primaryColorRgb)
  doc.rect(0, startY, W, 1.2, 'F')

  // Charge le logo en dataURL (silencieux si échoue)
  let logoDataUrl: string | null = null
  try {
    const res = await fetch(UPTECH_BRANDING.logoUrl)
    const blob = await res.blob()
    logoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch { /* ignore */ }

  const padX = 14
  const headerY = startY + 5
  if (logoDataUrl) {
    try { doc.addImage(logoDataUrl, 'PNG', padX, headerY, 16, 16) } catch { /* ignore */ }
  }

  const textX = logoDataUrl ? padX + 20 : padX
  // Tagline
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...UPTECH_BRANDING.primaryColorRgb)
  doc.text(UPTECH_BRANDING.tagline.toUpperCase(), textX, headerY + 3)

  // Nom complet (peut être tronqué sur 2 lignes)
  doc.setFontSize(9)
  doc.setTextColor(15, 23, 42)
  const nameLines = doc.splitTextToSize(UPTECH_BRANDING.fullName, W - textX - padX) as string[]
  doc.text(nameLines, textX, headerY + 7)
  const linesUsed = Math.min(2, nameLines.length)

  // Meta
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(85, 85, 85)
  const metaY = headerY + 7 + linesUsed * 3.2 + 1
  doc.text(
    `NINEA : ${UPTECH_BRANDING.ninea} _ ${UPTECH_BRANDING.bp}  |  ${UPTECH_BRANDING.address}  |  Tél : ${UPTECH_BRANDING.phones}`,
    textX, metaY
  )
  doc.setTextColor(136, 136, 136)
  doc.setFontSize(6.5)
  doc.text(UPTECH_BRANDING.agrement, textX, metaY + 3)

  // Filet rouge bas
  const bottomLineY = Math.max(metaY + 6, headerY + 18)
  doc.setDrawColor(...UPTECH_BRANDING.primaryColorRgb)
  doc.setLineWidth(0.6)
  doc.line(padX, bottomLineY, W - padX, bottomLineY)

  // Titre du document si fourni
  let cursorY = bottomLineY + 6
  if (opts.title) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(15, 23, 42)
    doc.text(opts.title, padX, cursorY)
    cursorY += 6
  }

  return cursorY
}

/**
 * Pied de page institutionnel pour jsPDF — à appeler en dernier sur chaque page.
 */
export function uptechPdfFooter(doc: any) {
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  doc.setDrawColor(204, 204, 204)
  doc.setLineWidth(0.2)
  doc.line(14, H - 12, W - 14, H - 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(119, 119, 119)
  doc.text(UPTECH_BRANDING.footerLine, W / 2, H - 8, { align: 'center' })
}
