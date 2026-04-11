const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  HeadingLevel, PageNumber, PageBreak, TabStopType, TabStopPosition
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

// A4 dimensions
const PAGE_WIDTH = 11906;
const MARGIN_LEFT = 1134; // ~2cm
const MARGIN_RIGHT = 1134;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 9638

function p(text, opts = {}) {
  const runProps = { font: "Calibri", size: opts.size || 22 };
  if (opts.bold) runProps.bold = true;
  if (opts.italics) runProps.italics = true;
  if (opts.color) runProps.color = opts.color;
  if (opts.underline) runProps.underline = {};

  const paraProps = {};
  if (opts.align) paraProps.alignment = opts.align;
  if (opts.spacing) paraProps.spacing = opts.spacing;
  if (opts.indent) paraProps.indent = opts.indent;
  if (opts.border) paraProps.border = opts.border;

  if (typeof text === 'string') {
    return new Paragraph({ ...paraProps, children: [new TextRun({ text, ...runProps })] });
  }
  // Array of runs
  return new Paragraph({ ...paraProps, children: text.map(t => {
    if (typeof t === 'string') return new TextRun({ text: t, ...runProps });
    return new TextRun({ ...runProps, ...t });
  }) });
}

function emptyLine(size) {
  return new Paragraph({ spacing: { after: size || 100 }, children: [] });
}

function infoRow(label, value, colWidths) {
  return new TableRow({
    children: [
      new TableCell({
        borders: noBorders, width: { size: colWidths[0], type: WidthType.DXA },
        margins: { top: 30, bottom: 30, left: 0, right: 80 },
        children: [p(label, { bold: true, size: 20 })]
      }),
      new TableCell({
        borders: noBorders, width: { size: colWidths[1], type: WidthType.DXA },
        margins: { top: 30, bottom: 30, left: 0, right: 0 },
        children: [p(value, { size: 20 })]
      }),
    ]
  });
}

async function generate() {
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } }
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: MARGIN_RIGHT, bottom: 1134, left: MARGIN_LEFT }
        }
      },
      headers: {
        default: new Header({
          children: [
            // Table header: left = UPTECH info, right = doc title + ref
            new Table({
              width: { size: CONTENT_WIDTH, type: WidthType.DXA },
              columnWidths: [5800, 3838],
              rows: [
                new TableRow({
                  children: [
                    // LEFT: UPTECH branding
                    new TableCell({
                      borders: noBorders,
                      width: { size: 5800, type: WidthType.DXA },
                      margins: { top: 0, bottom: 0, left: 0, right: 0 },
                      children: [
                        new Paragraph({
                          spacing: { after: 20 },
                          children: [new TextRun({ text: "UPTECH", font: "Calibri", size: 32, bold: true, color: "E30613" })]
                        }),
                        new Paragraph({
                          spacing: { after: 30 },
                          children: [new TextRun({ text: "Institut Sup\u00e9rieur de Formation aux M\u00e9tiers du Num\u00e9rique", font: "Calibri", size: 14, italics: true, color: "555555" })]
                        }),
                        new Paragraph({
                          spacing: { after: 0 },
                          children: [new TextRun({ text: "Amiti\u00e9 1, Villa n\u00b03031 \u2014 Dakar, S\u00e9n\u00e9gal", font: "Calibri", size: 14, color: "888888" })]
                        }),
                        new Paragraph({
                          children: [new TextRun({ text: "+221 77 841 50 44 \u2014 uptechformation@gmail.com", font: "Calibri", size: 14, color: "888888" })]
                        }),
                      ]
                    }),
                    // RIGHT: Document title + reference
                    new TableCell({
                      borders: noBorders,
                      width: { size: 3838, type: WidthType.DXA },
                      margins: { top: 0, bottom: 0, left: 0, right: 0 },
                      children: [
                        new Paragraph({
                          alignment: AlignmentType.RIGHT,
                          spacing: { after: 40 },
                          children: [new TextRun({ text: "CONTRAT DE VACATION", font: "Calibri", size: 20, bold: true, color: "111111" })]
                        }),
                        new Paragraph({
                          alignment: AlignmentType.RIGHT,
                          spacing: { after: 20 },
                          children: [
                            new TextRun({ text: "N\u00b0 ", font: "Calibri", size: 16, color: "666666" }),
                            new TextRun({ text: "{numero_contrat}", font: "Calibri", size: 16, color: "666666" }),
                          ]
                        }),
                        new Paragraph({
                          alignment: AlignmentType.RIGHT,
                          spacing: { after: 20 },
                          children: [
                            new TextRun({ text: "Date : ", font: "Calibri", size: 16, color: "666666" }),
                            new TextRun({ text: "{date_contrat}", font: "Calibri", size: 16, color: "666666" }),
                          ]
                        }),
                        new Paragraph({
                          alignment: AlignmentType.RIGHT,
                          children: [new TextRun({ text: "{annee_academique}", font: "Calibri", size: 16, bold: true, color: "E30613" })]
                        }),
                      ]
                    }),
                  ]
                }),
              ]
            }),
            // Red separator line
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "E30613", space: 1 } },
              spacing: { after: 0 },
              children: []
            }),
          ]
        })
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } },
              alignment: AlignmentType.CENTER,
              spacing: { before: 100 },
              children: [
                new TextRun({ text: "UPTECH \u2013 Sicap Amiti\u00e9 1, Villa N\u00b0 3031 \u2013 T\u00e9l : 77 841 50 44 / 70 453 48 49 \u2013 uptechformation@gmail.com", font: "Calibri", size: 14, color: "888888" }),
              ]
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Page ", font: "Calibri", size: 14, color: "888888" }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 14, color: "888888" }),
                new TextRun({ text: " / ", font: "Calibri", size: 14, color: "888888" }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Calibri", size: 14, color: "888888" }),
              ]
            }),
          ]
        })
      },
      children: [
        // ===== ENTRE ... ET =====
        emptyLine(200),
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "E30613", space: 4 } },
          spacing: { after: 200 },
          children: [new TextRun({ text: "ENTRE LES SOUSSIGN\u00c9S", font: "Calibri", size: 24, bold: true, color: "E30613" })]
        }),

        // UPTECH info
        p([
          { text: "UPTECH", bold: true },
          { text: " (Institut Sup\u00e9rieur de Formation aux Nouveaux M\u00e9tiers de l\u2019Informatique et de la Communication)," }
        ], { spacing: { after: 60 } }),
        p("Adresse : Sicap Amiti\u00e9 1, Villa N\u00b0 3031, Derri\u00e8re le Supermarch\u00e9 AUCHAN", { size: 20, spacing: { after: 40 } }),
        p("T\u00e9l : 77 841 50 44 / 70 453 48 49 / 76 451 12 14", { size: 20, spacing: { after: 40 } }),
        p("Email : uptechformation@gmail.com", { size: 20, spacing: { after: 40 } }),
        p([
          { text: "Repr\u00e9sent\u00e9 par : " },
          { text: "M. PAPA AMADOU SALL KANE", bold: true },
          { text: ", en sa qualit\u00e9 de Directeur G\u00e9n\u00e9ral" }
        ], { size: 20, spacing: { after: 60 } }),

        p("D\u2019une part ;", { bold: true, italics: true, spacing: { after: 200 }, align: AlignmentType.RIGHT }),

        // Vacataire info
        p("Et :", { spacing: { after: 100 } }),

        // Table info vacataire
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [2800, CONTENT_WIDTH - 2800],
          rows: [
            infoRow("Nom complet :", "{prenom} {nom}", [2800, CONTENT_WIDTH - 2800]),
            infoRow("Sp\u00e9cialit\u00e9 :", "{specialite}", [2800, CONTENT_WIDTH - 2800]),
            infoRow("Grade / Titre :", "{grade}", [2800, CONTENT_WIDTH - 2800]),
            infoRow("T\u00e9l\u00e9phone :", "{telephone}", [2800, CONTENT_WIDTH - 2800]),
            infoRow("Email :", "{email}", [2800, CONTENT_WIDTH - 2800]),
          ]
        }),

        emptyLine(60),
        p("Ci-apr\u00e8s d\u00e9nomm\u00e9(e) le \u00ab Vacataire \u00bb", { italics: true, spacing: { after: 60 } }),
        p("D\u2019autre part.", { bold: true, italics: true, spacing: { after: 300 }, align: AlignmentType.RIGHT }),

        // ===== ARTICLES =====
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 300 },
          children: [new TextRun({ text: "IL A \u00c9T\u00c9 CONVENU ET ARR\u00caT\u00c9 CE QUI SUIT :", font: "Calibri", size: 24, bold: true, color: "E30613" })]
        }),

        // --- ARTICLE 1 ---
        p("Article 1 \u2013 OBJET DU CONTRAT", { bold: true, size: 24, color: "E30613", spacing: { before: 200, after: 120 } }),
        p("Le pr\u00e9sent contrat a pour objet la r\u00e9alisation de prestations d\u2019enseignement par le Vacataire au profit d\u2019UPTECH, selon le d\u00e9tail ci-dessous :", { spacing: { after: 150 } }),

        // Tableau des matières
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4200, 2800, 2638],
          rows: [
            // Header row
            new TableRow({
              children: [
                new TableCell({
                  borders, width: { size: 4200, type: WidthType.DXA }, margins: cellMargins,
                  shading: { fill: "1F4E79", type: ShadingType.CLEAR },
                  children: [p("Mati\u00e8re / Module", { bold: true, size: 20, color: "FFFFFF", align: AlignmentType.CENTER })]
                }),
                new TableCell({
                  borders, width: { size: 2800, type: WidthType.DXA }, margins: cellMargins,
                  shading: { fill: "1F4E79", type: ShadingType.CLEAR },
                  children: [p("Classe", { bold: true, size: 20, color: "FFFFFF", align: AlignmentType.CENTER })]
                }),
                new TableCell({
                  borders, width: { size: 2638, type: WidthType.DXA }, margins: cellMargins,
                  shading: { fill: "1F4E79", type: ShadingType.CLEAR },
                  children: [p("Volume horaire", { bold: true, size: 20, color: "FFFFFF", align: AlignmentType.CENTER })]
                }),
              ]
            }),
            // Placeholder row (will be duplicated by docx-templates loop)
            new TableRow({
              children: [
                new TableCell({
                  borders, width: { size: 4200, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("{intitule}", { size: 20 })]
                }),
                new TableCell({
                  borders, width: { size: 2800, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("{classe}", { size: 20, align: AlignmentType.CENTER })]
                }),
                new TableCell({
                  borders, width: { size: 2638, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("{volume_horaire}h", { size: 20, align: AlignmentType.CENTER })]
                }),
              ]
            }),
          ]
        }),

        emptyLine(100),

        // Récap financier
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [5500, 4138],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" } },
                  width: { size: 5500, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("Volume horaire total", { bold: true, size: 20 })]
                }),
                new TableCell({
                  borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" } },
                  width: { size: 4138, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("{total_heures} heures", { size: 20, bold: true, align: AlignmentType.RIGHT })]
                }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" } },
                  width: { size: 5500, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("Tarif horaire net", { size: 20 })]
                }),
                new TableCell({
                  borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" } },
                  width: { size: 4138, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("{tarif_horaire} FCFA", { size: 20, align: AlignmentType.RIGHT })]
                }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" } },
                  width: { size: 5500, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("Retenue \u00e0 la source (5%)", { size: 20, italics: true })]
                }),
                new TableCell({
                  borders: { ...noBorders, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" } },
                  width: { size: 4138, type: WidthType.DXA }, margins: cellMargins,
                  children: [p("{retenue} FCFA", { size: 20, italics: true, align: AlignmentType.RIGHT })]
                }),
              ]
            }),
            new TableRow({
              children: [
                new TableCell({
                  borders: noBorders,
                  width: { size: 5500, type: WidthType.DXA }, margins: cellMargins,
                  shading: { fill: "E8F0FE", type: ShadingType.CLEAR },
                  children: [p("Montant total brut", { bold: true, size: 22, color: "E30613" })]
                }),
                new TableCell({
                  borders: noBorders,
                  width: { size: 4138, type: WidthType.DXA }, margins: cellMargins,
                  shading: { fill: "E8F0FE", type: ShadingType.CLEAR },
                  children: [p("{montant_total_brut} FCFA", { bold: true, size: 22, color: "E30613", align: AlignmentType.RIGHT })]
                }),
              ]
            }),
          ]
        }),

        emptyLine(100),
        p("Le d\u00e9tail des principales responsabilit\u00e9s, missions et obligations du Vacataire est pr\u00e9cis\u00e9 dans le \u00ab Cahier de charges \u00bb joint au pr\u00e9sent contrat.", { size: 20, spacing: { after: 60 } }),
        p("Le Vacataire d\u00e9clare poss\u00e9der les aptitudes professionnelles requises pour la bonne ex\u00e9cution de ses missions.", { size: 20, spacing: { after: 200 } }),

        // --- ARTICLE 2 ---
        p("Article 2 \u2013 DUR\u00c9E DE LA PRESTATION", { bold: true, size: 24, color: "E30613", spacing: { before: 200, after: 120 } }),
        p("Le pr\u00e9sent contrat de vacation prend effet \u00e0 compter de la date de signature et couvre l\u2019ann\u00e9e acad\u00e9mique {annee_academique}.", { size: 20, spacing: { after: 60 } }),
        p("Il prend fin dans les 03 semaines suivant la remise des copies et notes d\u2019\u00e9valuation et/ou d\u2019examen par le Vacataire.", { size: 20, spacing: { after: 200 } }),

        // --- ARTICLE 3 ---
        p("Article 3 \u2013 LIEU D\u2019EX\u00c9CUTION", { bold: true, size: 24, color: "E30613", spacing: { before: 200, after: 120 } }),
        p("Le Vacataire interviendra principalement dans les locaux d\u2019UPTECH \u00e0 Dakar.", { size: 20, spacing: { after: 200 } }),

        // --- ARTICLE 4 ---
        p("Article 4 \u2013 CO\u00dbT DE LA PRESTATION ET MODALIT\u00c9S DE PAIEMENT", { bold: true, size: 24, color: "E30613", spacing: { before: 200, after: 120 } }),
        p([
          { text: "En contrepartie des engagements pris dans le cadre du pr\u00e9sent contrat, UPTECH s\u2019engage \u00e0 verser au Vacataire des honoraires calcul\u00e9s sur la base d\u2019un taux horaire net de ", size: 20 },
          { text: "{tarif_horaire} FCFA", bold: true, size: 20 },
          { text: ".", size: 20 },
        ], { spacing: { after: 100 } }),
        p("Une retenue \u00e0 la source de 5% sera appliqu\u00e9e sur le montant des honoraires et vers\u00e9e \u00e0 titre d\u2019imp\u00f4t.", { size: 20, spacing: { after: 100 } }),
        p("Le paiement se fera au plus tard le 15 du mois suivant la r\u00e9cup\u00e9ration des copies et notes d\u2019examen, par esp\u00e8ces, virement ou ch\u00e8que.", { size: 20, spacing: { after: 200 } }),

        // --- ARTICLE 5 ---
        p("Article 5 \u2013 OBLIGATIONS DES PARTIES", { bold: true, size: 24, color: "E30613", spacing: { before: 200, after: 120 } }),
        p("Le Vacataire s\u2019engage \u00e0 :", { bold: true, size: 20, spacing: { after: 80 } }),
        p("\u2022  S\u2019acquitter de toutes les t\u00e2ches li\u00e9es \u00e0 son cahier de charges remis par le Directeur des \u00c9tudes ;", { size: 20, spacing: { after: 40 }, indent: { left: 400 } }),
        p("\u2022  Ne pas se soustraire de ses obligations sans l\u2019autorisation expresse d\u2019UPTECH ;", { size: 20, spacing: { after: 40 }, indent: { left: 400 } }),
        p("\u2022  Prendre soin du mat\u00e9riel mis \u00e0 disposition et signaler tout probl\u00e8me ;", { size: 20, spacing: { after: 40 }, indent: { left: 400 } }),
        p("\u2022  Aviser UPTECH de tout emp\u00eachement pouvant affecter la r\u00e9alisation des activit\u00e9s ;", { size: 20, spacing: { after: 40 }, indent: { left: 400 } }),
        p("\u2022  Remettre tout mat\u00e9riel, document et information \u00e0 la fin de la collaboration.", { size: 20, spacing: { after: 120 }, indent: { left: 400 } }),
        p("En cas de remplacement par un autre prestataire sollicit\u00e9 par le Vacataire, les r\u00e9mun\u00e9rations de ce dernier seront d\u00e9duites de la sienne.", { size: 20, spacing: { after: 120 } }),

        p("UPTECH s\u2019engage \u00e0 :", { bold: true, size: 20, spacing: { after: 80 } }),
        p("\u2022  Mettre \u00e0 disposition le mat\u00e9riel et l\u2019\u00e9quipement n\u00e9cessaires ;", { size: 20, spacing: { after: 40 }, indent: { left: 400 } }),
        p("\u2022  Payer les honoraires conform\u00e9ment aux dispositions du pr\u00e9sent contrat.", { size: 20, spacing: { after: 200 }, indent: { left: 400 } }),

        // --- ARTICLE 6 ---
        p("Article 6 \u2013 PROPRI\u00c9T\u00c9 INTELLECTUELLE", { bold: true, size: 24, color: "E30613", spacing: { before: 200, after: 120 } }),
        p("Tous rapports, \u00e9tudes et autres documents issus de travaux command\u00e9s par UPTECH et produits par le Vacataire deviendront et demeureront la propri\u00e9t\u00e9 exclusive d\u2019UPTECH.", { size: 20, spacing: { after: 200 } }),

        // --- ARTICLE 7 ---
        p("Article 7 \u2013 R\u00c9SILIATION / MODIFICATION", { bold: true, size: 24, color: "E30613", spacing: { before: 200, after: 120 } }),
        p("Le pr\u00e9sent contrat peut \u00eatre r\u00e9sili\u00e9 de plein droit par l\u2019une des parties en cas d\u2019inex\u00e9cution d\u2019une ou plusieurs obligations.", { size: 20, spacing: { after: 80 } }),
        p("Cette r\u00e9siliation ne devient effective qu\u2019apr\u00e8s un pr\u00e9avis d\u2019un mois, par lettre avec accus\u00e9 de r\u00e9ception. Les parties restent tenues de remplir leurs obligations jusqu\u2019\u00e0 la prise d\u2019effet de la r\u00e9siliation.", { size: 20, spacing: { after: 80 } }),
        p("En cas de r\u00e9siliation, il sera proc\u00e9d\u00e9 \u00e0 l\u2019\u00e9valuation des travaux r\u00e9alis\u00e9s et des avances engag\u00e9es.", { size: 20, spacing: { after: 80 } }),
        p("Toute modification majeure devra faire l\u2019objet d\u2019un avenant \u00e9crit et sign\u00e9 par les deux parties.", { size: 20, spacing: { after: 200 } }),

        // --- ARTICLE 8 ---
        p("Article 8 \u2013 LOI APPLICABLE ET R\u00c8GLEMENT DES LITIGES", { bold: true, size: 24, color: "E30613", spacing: { before: 200, after: 120 } }),
        p("Le pr\u00e9sent contrat est r\u00e9gi par le droit s\u00e9n\u00e9galais. En cas de diff\u00e9rend, les parties s\u2019efforceront de r\u00e9soudre le litige \u00e0 l\u2019amiable. \u00c0 d\u00e9faut, le diff\u00e9rend sera soumis aux juridictions comp\u00e9tentes de Dakar.", { size: 20, spacing: { after: 400 } }),

        // ===== SIGNATURES =====
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: "E30613", space: 4 } },
          spacing: { after: 200 },
          children: [new TextRun({ text: "SIGNATURES", font: "Calibri", size: 24, bold: true, color: "E30613" })]
        }),

        p([
          { text: "Fait \u00e0 Dakar en deux exemplaires, le ", size: 20 },
          { text: "{date_contrat}", size: 20, bold: true },
        ], { spacing: { after: 300 } }),

        // Signature table
        new Table({
          width: { size: CONTENT_WIDTH, type: WidthType.DXA },
          columnWidths: [4819, 4819],
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  borders: noBorders, width: { size: 4819, type: WidthType.DXA }, margins: cellMargins,
                  children: [
                    p("Le Vacataire", { bold: true, size: 20, align: AlignmentType.CENTER, spacing: { after: 40 } }),
                    p("(Pr\u00e9c\u00e9d\u00e9 de la mention \u00ab lu et approuv\u00e9 \u00bb)", { italics: true, size: 16, align: AlignmentType.CENTER, spacing: { after: 200 } }),
                    emptyLine(400),
                    emptyLine(400),
                    p("{prenom} {nom}", { bold: true, size: 20, align: AlignmentType.CENTER }),
                  ]
                }),
                new TableCell({
                  borders: noBorders, width: { size: 4819, type: WidthType.DXA }, margins: cellMargins,
                  children: [
                    p("Le Directeur G\u00e9n\u00e9ral", { bold: true, size: 20, align: AlignmentType.CENTER, spacing: { after: 40 } }),
                    p("(Pr\u00e9c\u00e9d\u00e9 de la mention \u00ab lu et approuv\u00e9 \u00bb)", { italics: true, size: 16, align: AlignmentType.CENTER, spacing: { after: 200 } }),
                    emptyLine(400),
                    emptyLine(400),
                    p("M. PAPA AMADOU SALL KANE", { bold: true, size: 20, align: AlignmentType.CENTER }),
                  ]
                }),
              ]
            }),
          ]
        }),
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  const outputPath = path.join(__dirname, 'contrat-vacation.docx');
  fs.writeFileSync(outputPath, buffer);
  console.log('Template generated:', outputPath);
}

generate().catch(console.error);
