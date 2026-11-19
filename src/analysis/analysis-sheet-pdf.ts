import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLib } from 'pdf-lib';

// What the PDF of a fiche d'analyse shows.
export interface AnalysisSheetPdfContent {
  reference: string;
  version: string;
  status: string;
  createdAt?: Date | null;
  title: string | null;
  courrier: string;
  expediteur?: string | null;
  refBL?: string | null;
  lieuUsage?: string | null;
  projet?: string | null;
  refProjet?: string | null;
  mode?: string | null;
  allotissement?: string | null;
  maitreOuvrage?: string | null;
  dateRemise?: Date | null;
  header?: [label: string, value: string | null][];
  items: {
    order: number;
    label: string;
    document: string | null;
    norms: string | null;
    description?: string | null;
    opinion: string | null;
    suggestedOpinion: string | null;
    observation: string | null;
    criteria: { label: string; opinion: string; observation: string | null }[];
  }[];
  suggestedOpinion: string | null;
  overallOpinion: string | null;
  comments: string | null;
  author: { name: string; function: string | null };
  validator: { name: string | null; function: string | null };
  signedAt: Date | null;
  signatoryName: string | null;
  /** The letterhead (PA·3): accent colour, a PNG logo, and an optional background. */
  identity?: {
    color: string;
    logo: Buffer | null;
    analysisBackground?: Buffer | null;
    analysisBackgroundMime?: string | null;
  };
}

// Badge labels and colours
const OPINION_BADGES: Record<string, { label: string; color: string }> = {
  AF: { label: 'FAVORABLE', color: '#10b981' },
  FAVORABLE: { label: 'FAVORABLE', color: '#10b981' },
  AFR: { label: 'FAV. SOUS RÉSERVE', color: '#f59e0b' },
  AS: { label: 'AVIS SUSPENDU', color: '#f97316' },
  AD: { label: 'DÉFAVORABLE', color: '#ef4444' },
  NA: { label: 'NON APPLICABLE', color: '#6b7280' },
};

const OPINION_LABEL_FR: Record<string, string> = {
  AF: 'Favorable',
  AFR: 'Favorable sous réserve',
  AS: 'Avis suspendu',
  AD: 'Défavorable',
  NA: 'Non applicable',
};

function dateFr(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dateObj = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dateObj.getTime())) return '—';
  return dateObj.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry-point
// ─────────────────────────────────────────────────────────────────────────────

export async function renderAnalysisSheetPdf(
  content: AnalysisSheetPdfContent,
): Promise<Buffer> {
  // Step 1: render the content layer with PDFKit.
  const contentBuffer = await renderContent(content);

  // Step 2: if a background is provided, stamp it behind every page.
  const backgroundBuffer = content.identity?.analysisBackground ?? null;
  if (!backgroundBuffer) return contentBuffer;

  const mime = content.identity?.analysisBackgroundMime ?? null;
  try {
    return await stampBackground(contentBuffer, backgroundBuffer, mime);
  } catch {
    // A broken background never blocks the PDF — return the content as-is.
    return contentBuffer;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Background stamping
// ─────────────────────────────────────────────────────────────────────────────

async function stampBackground(
  contentBuffer: Buffer,
  backgroundBuffer: Buffer,
  mime: string | null,
): Promise<Buffer> {
  const contentDoc = await PdfLib.load(contentBuffer);
  const pages = contentDoc.getPages();

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  if (mime === 'image/png' || mime === 'image/jpeg') {
    const outputDoc = await PdfLib.create();
    const image =
      mime === 'image/jpeg'
        ? await outputDoc.embedJpg(backgroundBuffer)
        : await outputDoc.embedPng(backgroundBuffer);
    const { width: imgW, height: imgH } = image.scale(1);
    const contentPages = await outputDoc.copyPages(
      contentDoc,
      pages.map((_, i) => i),
    );

    for (const contentPage of contentPages) {
      const { width, height } = contentPage.getSize();
      const newPage = outputDoc.addPage([width, height]);

      // Background layer
      const scale = Math.max(width / imgW, height / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      newPage.drawImage(image, {
        x: (width - drawW) / 2,
        y: (height - drawH) / 2,
        width: drawW,
        height: drawH,
      });

      // Content layer on top
      const idx = contentPages.indexOf(contentPage);
      const [embedded] = await outputDoc.embedPdf(contentDoc, [idx]);
      newPage.drawPage(embedded, { x: 0, y: 0, width, height });
    }

    return Buffer.from(await outputDoc.save());
  } else {
    // PDF background
    const bgDoc = await PdfLib.load(backgroundBuffer);
    const bgPage = bgDoc.getPages()[0];
    if (!bgPage) return contentBuffer;

    const outputDoc = await PdfLib.create();
    const [embeddedBg] = await outputDoc.embedPdf(bgDoc, [0]);
    const bgW = bgPage.getWidth() || A4_WIDTH;
    const bgH = bgPage.getHeight() || A4_HEIGHT;
    const contentPages = await outputDoc.copyPages(
      contentDoc,
      pages.map((_, i) => i),
    );

    for (const contentPage of contentPages) {
      const { width, height } = contentPage.getSize();
      const newPage = outputDoc.addPage([width, height]);

      newPage.drawPage(embeddedBg, {
        x: 0,
        y: 0,
        xScale: width / bgW,
        yScale: height / bgH,
        opacity: 1,
      });

      const idx = contentPages.indexOf(contentPage);
      const [embedded] = await outputDoc.embedPdf(contentDoc, [idx]);
      newPage.drawPage(embedded, { x: 0, y: 0, width, height });
    }

    return Buffer.from(await outputDoc.save());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Content renderer
// ─────────────────────────────────────────────────────────────────────────────

function renderContent(content: AnalysisSheetPdfContent): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: {
        Title: `Fiche d'analyse ${content.reference} v${content.version}`,
      },
    });

    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    // ── Layout constants ────────────────────────────────────────────
    const M = 36;                        // page margins
    const PW = pdf.page.width;           // 595.28 pt
    const PH = pdf.page.height;          // 841.89 pt
    const CW = PW - 2 * M;              // 523.28 pt
    const accent = content.identity?.color ?? '#0d9488';
    const BORDER = '#9ca3af';           // table grid border
    const GRAY_BG = '#f3f4f6';          // label background
    const LABEL_FG = '#374151';         // dark gray for labels
    const VALUE_FG = '#111827';         // almost black for values
    const HEADER_H = 46;
    const USABLE_BOTTOM = PH - 110;     // leave space for letterhead footer

    // ── Safe text helpers ───────────────────────────────────────────
    function fillRect(x: number, y: number, w: number, h: number, color: string) {
      pdf.rect(x, y, w, h).fill(color);
    }

    function borderRect(x: number, y: number, w: number, h: number, color = BORDER, lineWidth = 0.5) {
      pdf.lineWidth(lineWidth).rect(x, y, w, h).stroke(color);
    }

    /**
     * Safely fits and truncates text to fit within maxW so it NEVER wraps or overflows.
     */
    function fitText(font: string, initialSize: number, minSize: number, rawText: string, maxW: number): { text: string; size: number } {
      const text = rawText || '';
      let size = initialSize;
      while (size >= minSize) {
        pdf.font(font).fontSize(size);
        if (pdf.widthOfString(text) <= maxW) {
          return { text, size };
        }
        size = Math.round((size - 0.5) * 10) / 10;
      }
      // If text still exceeds maxW at minSize, truncate with ellipsis
      pdf.font(font).fontSize(minSize);
      let s = text;
      while (s.length > 0 && pdf.widthOfString(s + '…') > maxW) {
        s = s.slice(0, -1);
      }
      return { text: s ? s + '…' : '', size: minSize };
    }

    /**
     * Single-line strict cell text. Guarantees 0 line wrap and 0 row bleed.
     */
    function cellText(
      x: number,
      y: number,
      w: number,
      h: number,
      text: string | null | undefined,
      {
        bold = false,
        fs = 7.5,
        minFs = 6.0,
        fg = VALUE_FG,
        align = 'left' as 'left' | 'center' | 'right',
        pad = 3.5,
      } = {},
    ) {
      const fontName = bold ? 'Helvetica-Bold' : 'Helvetica';
      const maxW = Math.max(w - 2 * pad, 0);
      const { text: fittedText, size: actualFs } = fitText(fontName, fs, minFs, String(text ?? ''), maxW);
      const lineH = actualFs * 1.15;
      const ty = y + (h - lineH) / 2;

      pdf
        .font(fontName)
        .fontSize(actualFs)
        .fillColor(fg)
        .text(fittedText, x + pad, ty, {
          width: maxW,
          lineBreak: false,
          align,
        });
    }

    function labelCell(x: number, y: number, w: number, h: number, text: string) {
      fillRect(x, y, w, h, GRAY_BG);
      borderRect(x, y, w, h);
      cellText(x, y, w, h, text, { bold: true, fs: 7, minFs: 6.0, fg: LABEL_FG });
    }

    function valueCell(
      x: number,
      y: number,
      w: number,
      h: number,
      text: string | null | undefined,
      align: 'left' | 'center' | 'right' = 'left',
      bold = false,
    ) {
      borderRect(x, y, w, h);
      cellText(x, y, w, h, text || '—', { fs: 7.5, minFs: 6.0, fg: VALUE_FG, align, bold });
    }

    function drawHeader(atY: number) {
      if (content.identity?.logo) {
        try {
          pdf.image(content.identity.logo, M, atY, { fit: [140, HEADER_H] });
        } catch {
          /* skip unreadable logo */
        }
      }

      pdf
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor(accent)
        .text("FICHE D'ANALYSE/AVIS", M, atY + 2, {
          width: CW,
          align: 'right',
          lineBreak: false,
        });

      const subTitle = (content.title || 'DOSSIER D’EXPÉDITION').toUpperCase();
      pdf
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#4b5563')
        .text(subTitle, M, atY + 24, {
          width: CW,
          align: 'right',
          lineBreak: false,
        });

      return atY + HEADER_H + 12;
    }

    // ── 1. PAGE 1 HEADER ────────────────────────────────────────────
    let y = drawHeader(M);

    // ── 2. METADATA GRID ────────────────────────────────────────────
    const LEFT_W = Math.floor(CW * 0.48); // ~251 pt
    const RIGHT_W = CW - LEFT_W;         // ~272 pt

    const L1 = 52;
    const V1 = 73;
    const L2 = 52;
    const V2 = LEFT_W - (L1 + V1 + L2);

    const RL = 70;
    const RV = RIGHT_W - RL;

    const RH = 16.5;
    const TOTAL_GRID_H = RH * 8; // 132 pt

    // Left Column Rows
    let curY = y;
    labelCell(M, curY, L1, RH, 'Réf Fiche');
    valueCell(M + L1, curY, V1, RH, content.reference, 'center', true);
    labelCell(M + L1 + V1, curY, L2, RH, 'Créée le');
    valueCell(M + L1 + V1 + L2, curY, V2, RH, dateFr(content.createdAt), 'center');
    curY += RH;

    labelCell(M, curY, L1, RH, 'Publiée par');
    valueCell(M + L1, curY, V1, RH, content.author.name, 'left');
    labelCell(M + L1 + V1, curY, L2, RH, 'Fonction');
    valueCell(M + L1 + V1 + L2, curY, V2, RH, content.author.function, 'left');
    curY += RH;

    labelCell(M, curY, L1, RH, 'Validé par');
    valueCell(M + L1, curY, V1, RH, content.validator.name, 'left');
    labelCell(M + L1 + V1, curY, L2, RH, 'Fonction');
    valueCell(M + L1 + V1 + L2, curY, V2, RH, content.validator.function, 'left');
    curY += RH;

    const rubriqueVal = content.title ?? content.courrier;
    labelCell(M, curY, L1, RH, 'Rubrique');
    valueCell(M + L1, curY, LEFT_W - L1, RH, rubriqueVal, 'center', true);
    curY += RH;

    labelCell(M, curY, L1, RH, 'Réf BL');
    valueCell(M + L1, curY, LEFT_W - L1, RH, content.refBL, 'center');
    curY += RH;

    labelCell(M, curY, L1, RH, 'Version');
    valueCell(M + L1, curY, LEFT_W - L1, RH, content.version, 'center');
    curY += RH;

    labelCell(M, curY, L1, RH, 'Lieu d’usage');
    valueCell(M + L1, curY, LEFT_W - L1, RH, content.lieuUsage, 'center');
    curY += RH;

    const expediteurVal = content.expediteur ?? content.courrier?.split('—')?.[1]?.trim() ?? '—';
    labelCell(M, curY, L1, RH, 'Expéditeur');
    valueCell(M + L1, curY, LEFT_W - L1, RH, expediteurVal, 'center', true);

    // Right Column Rows
    const RX = M + LEFT_W;
    let rightY = y;

    // Projet (can be up to 2 lines in double height box)
    labelCell(RX, rightY, RL, RH * 2, 'Projet');
    borderRect(RX + RL, rightY, RV, RH * 2);
    const projText = content.projet || '—';
    pdf.font('Helvetica-Bold').fontSize(7.5);
    const projH = pdf.heightOfString(projText, { width: RV - 8 });
    const projTy = rightY + (RH * 2 - projH) / 2;
    pdf.fillColor(VALUE_FG).text(projText, RX + RL + 4, projTy, {
      width: RV - 8,
      align: 'center',
    });
    rightY += RH * 2;

    labelCell(RX, rightY, RL, RH, 'Mode');
    borderRect(RX + RL, rightY, RV, RH);
    const modeUpper = (content.mode ?? '').toUpperCase();
    const cContrat = modeUpper.includes('CONTRAT') ? '[X]' : '[  ]';
    const cID = modeUpper.includes('ID') ? '[X]' : '[  ]';
    const cIG = modeUpper.includes('I/G') || modeUpper.includes('IG') ? '[X]' : '[  ]';
    const cAutre = (!modeUpper.includes('CONTRAT') && !modeUpper.includes('ID') && !modeUpper.includes('IG') && modeUpper.length > 0) ? '[X]' : '[  ]';
    const modeText = `Contrat ${cContrat}    ID ${cID}    I/G ${cIG}    Autre ${cAutre}`;
    cellText(RX + RL, rightY, RV, RH, modeText, { fs: 7, minFs: 6.0, fg: VALUE_FG, align: 'center' });
    rightY += RH;

    labelCell(RX, rightY, RL, RH, 'Réf Projet');
    valueCell(RX + RL, rightY, RV, RH, content.refProjet, 'center');
    rightY += RH;

    labelCell(RX, rightY, RL, RH, 'Allotissement');
    valueCell(RX + RL, rightY, RV, RH, content.allotissement, 'center');
    rightY += RH;

    labelCell(RX, rightY, RL, RH, 'Maître d’ouvrage');
    valueCell(RX + RL, rightY, RV, RH, content.maitreOuvrage, 'center');
    rightY += RH;

    labelCell(RX, rightY, RL, RH * 2, 'Date de remise');
    valueCell(RX + RL, rightY, RV, RH * 2, dateFr(content.dateRemise), 'center');

    y += TOTAL_GRID_H + 10;

    // ── 3. DETAILED ELEMENT BLOCKS ──────────────────────────────────
    for (const item of content.items) {
      const CRIT_COL_W = Math.floor(CW * 0.38); // 38%
      const OBS_COL_W = CW - CRIT_COL_W;       // 62%
      const itemBadgeW = 100;

      // Pre-calculate heights for description & observations
      const descText = item.description || '';
      const obsText = item.observation || '';
      pdf.font('Helvetica').fontSize(6.5);
      const descH = descText ? pdf.heightOfString(descText, { width: CRIT_COL_W - 10 }) : 0;
      const obsH = obsText ? pdf.heightOfString(obsText, { width: OBS_COL_W - 10 }) : 0;
      const maxContentH = Math.max(descH, obsH);
      const descBoxH = Math.max(34, Math.ceil(maxContentH + 18));

      // Calculate criteria table rows
      const criteriaList = item.criteria.length > 0 ? item.criteria : [{ label: '—', opinion: '—', observation: '—' }];
      let criteriaTotalH = 15; // header height
      const critHeights: number[] = [];

      for (const crit of criteriaList) {
        const critObs = crit.observation || '—';
        pdf.font('Helvetica').fontSize(6.5);
        const cH = pdf.heightOfString(critObs, { width: OBS_COL_W - 12 });
        const rowH = Math.max(14, Math.ceil(cH + 5));
        critHeights.push(rowH);
        criteriaTotalH += rowH;
      }

      const elementTotalH = 18 + 14 + criteriaTotalH + descBoxH;

      // Check if element fits on current page
      if (y + elementTotalH > USABLE_BOTTOM) {
        pdf.addPage();
        y = drawHeader(M);
      }

      const itemBadge = item.opinion ? OPINION_BADGES[item.opinion] : null;

      // 1. Element Title Bar
      fillRect(M, y, CW - itemBadgeW, 18, GRAY_BG);
      borderRect(M, y, CW - itemBadgeW, 18);
      cellText(M, y, CW - itemBadgeW, 18, item.label, { bold: true, fs: 7.5, minFs: 6.5, fg: LABEL_FG, pad: 6 });

      if (itemBadge) {
        fillRect(M + CW - itemBadgeW, y, itemBadgeW, 18, itemBadge.color);
        borderRect(M + CW - itemBadgeW, y, itemBadgeW, 18);
        cellText(M + CW - itemBadgeW, y, itemBadgeW, 18, itemBadge.label, {
          bold: true,
          fs: 7,
          minFs: 6.0,
          fg: '#ffffff',
          align: 'center',
        });
      } else {
        borderRect(M + CW - itemBadgeW, y, itemBadgeW, 18);
        cellText(M + CW - itemBadgeW, y, itemBadgeW, 18, '—', { fs: 7, align: 'center' });
      }
      y += 18;

      // 2. Norms Sub-bar
      borderRect(M, y, CW, 14);
      const normsVal = item.norms || '—';
      cellText(M, y, CW, 14, `Normes & documents de référence : ${normsVal}`, { fs: 6.8, minFs: 6.0, fg: '#4b5563', pad: 6 });
      y += 14;

      // 3. Criteria Table Header
      fillRect(M, y, CRIT_COL_W, 15, GRAY_BG);
      borderRect(M, y, CRIT_COL_W, 15);
      cellText(M, y, CRIT_COL_W, 15, 'Critères (avis)', { bold: true, fs: 6.8, minFs: 6.0, fg: LABEL_FG, pad: 6 });

      fillRect(M + CRIT_COL_W, y, OBS_COL_W, 15, GRAY_BG);
      borderRect(M + CRIT_COL_W, y, OBS_COL_W, 15);
      cellText(M + CRIT_COL_W, y, OBS_COL_W, 15, 'Observations / Commentaires', { bold: true, fs: 6.8, minFs: 6.0, fg: LABEL_FG, pad: 6 });
      y += 15;

      // Criteria Rows
      for (let i = 0; i < criteriaList.length; i++) {
        const crit = criteriaList[i];
        const rowH = critHeights[i];
        borderRect(M, y, CRIT_COL_W, rowH);

        const opLabel = OPINION_LABEL_FR[crit.opinion] ?? crit.opinion;
        const critTitle = crit.label === '—' ? '—' : `${crit.label} (${opLabel})`;
        cellText(M, y, CRIT_COL_W, rowH, critTitle, { fs: 6.5, minFs: 5.5, fg: VALUE_FG, pad: 6 });

        borderRect(M + CRIT_COL_W, y, OBS_COL_W, rowH);
        const obsVal = crit.observation || '—';
        if (obsVal !== '—') {
          pdf.font('Helvetica').fontSize(6.5).fillColor('#4b5563').text(obsVal, M + CRIT_COL_W + 6, y + 3, {
            width: OBS_COL_W - 12,
            lineBreak: true,
          });
        } else {
          cellText(M + CRIT_COL_W, y, OBS_COL_W, rowH, '—', { fs: 6.5, fg: '#6b7280', pad: 6 });
        }
        y += rowH;
      }

      // 4. Description & Observations Side-by-side Boxes
      borderRect(M, y, CRIT_COL_W, descBoxH);
      pdf.font('Helvetica-Bold').fontSize(6).fillColor('#6b7280').text('Description', M + 5, y + 3, { lineBreak: false });
      if (item.description) {
        pdf.font('Helvetica').fontSize(6.5).fillColor(VALUE_FG).text(item.description, M + 5, y + 13, {
          width: CRIT_COL_W - 10,
          height: descBoxH - 16,
          ellipsis: true,
        });
      }

      borderRect(M + CRIT_COL_W, y, OBS_COL_W, descBoxH);
      pdf.font('Helvetica-Bold').fontSize(6).fillColor('#6b7280').text('Observations, Commentaires', M + CRIT_COL_W + 5, y + 3, { lineBreak: false });
      if (item.observation) {
        pdf.font('Helvetica').fontSize(6.5).fillColor(VALUE_FG).text(item.observation, M + CRIT_COL_W + 5, y + 13, {
          width: OBS_COL_W - 10,
          height: descBoxH - 16,
          ellipsis: true,
        });
      }
      y += descBoxH + 8; // spacing between elements
    }

    // ── 4. RECAPITULATIF DES AVIS PAR ÉLÉMENT ────────────────────────
    const itemsCount = content.items.length;
    const recapTableH = 18 + 16 + itemsCount * 18 + 20;
    const signatureSectionH = 64;

    // Calculate dynamic comments height
    const commentTextH = content.comments
      ? pdf.font('Helvetica').fontSize(7.5).heightOfString(content.comments, { width: CW - 12 })
      : 10;
    const commentBoxH = Math.max(36, Math.min(Math.ceil(commentTextH + 12), 70));

    const summaryTotalH = recapTableH + 8 + commentBoxH + 10 + signatureSectionH;

    // If it doesn't fit on current page, start new page
    if (y + summaryTotalH > USABLE_BOTTOM) {
      pdf.addPage();
      y = drawHeader(M);
    }

    const AVIS_W = 140;
    const ELEM_W = CW - AVIS_W;

    // Header bar
    fillRect(M, y, CW, 18, GRAY_BG);
    borderRect(M, y, CW, 18);
    cellText(M, y, CW, 18, 'RÉCAPITULATIF DES AVIS PAR ÉLÉMENT', {
      bold: true,
      fs: 8,
      minFs: 7.0,
      fg: LABEL_FG,
      align: 'center',
    });
    y += 18;

    // Sub-headers
    borderRect(M, y, ELEM_W, 16);
    cellText(M, y, ELEM_W, 16, 'Éléments soumis', { bold: true, fs: 7.5, minFs: 6.5, fg: LABEL_FG, pad: 8 });
    borderRect(M + ELEM_W, y, AVIS_W, 16);
    cellText(M + ELEM_W, y, AVIS_W, 16, 'Avis', { bold: true, fs: 7.5, minFs: 6.5, fg: LABEL_FG, align: 'center' });
    y += 16;

    // Summary Rows for each element
    for (const item of content.items) {
      const rowH = 18;
      borderRect(M, y, ELEM_W, rowH);
      cellText(M, y, ELEM_W, rowH, item.label, { fs: 7.5, minFs: 6.0, pad: 8 });

      const badge = item.opinion ? OPINION_BADGES[item.opinion] : null;
      if (badge) {
        fillRect(M + ELEM_W, y, AVIS_W, rowH, badge.color);
        borderRect(M + ELEM_W, y, AVIS_W, rowH);
        cellText(M + ELEM_W, y, AVIS_W, rowH, badge.label, {
          bold: true,
          fs: 7,
          minFs: 6.0,
          fg: '#ffffff',
          align: 'center',
        });
      } else {
        borderRect(M + ELEM_W, y, AVIS_W, rowH);
        cellText(M + ELEM_W, y, AVIS_W, rowH, '—', { fs: 7, align: 'center' });
      }
      y += rowH;
    }

    // AVIS GÉNÉRAL ROW
    const O_ROW_H = 20;
    borderRect(M, y, ELEM_W, O_ROW_H);
    cellText(M, y, ELEM_W, O_ROW_H, 'AVIS GÉNÉRAL DE LA REMISE', {
      bold: true,
      fs: 8,
      minFs: 7.0,
      fg: accent,
      align: 'center',
    });

    const oBadge = content.overallOpinion ? OPINION_BADGES[content.overallOpinion] : null;
    if (oBadge) {
      fillRect(M + ELEM_W, y, AVIS_W, O_ROW_H, oBadge.color);
      borderRect(M + ELEM_W, y, AVIS_W, O_ROW_H);
      cellText(M + ELEM_W, y, AVIS_W, O_ROW_H, oBadge.label, {
        bold: true,
        fs: 8,
        minFs: 7.0,
        fg: '#ffffff',
        align: 'center',
      });
    } else {
      borderRect(M + ELEM_W, y, AVIS_W, O_ROW_H);
      cellText(M + ELEM_W, y, AVIS_W, O_ROW_H, '—', { fs: 8, align: 'center' });
    }
    y += O_ROW_H + 8;

    // ── 5. COMMENTS BOX ─────────────────────────────────────────────
    borderRect(M, y, CW, commentBoxH);
    if (content.comments) {
      pdf
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(VALUE_FG)
        .text(content.comments, M + 6, y + 6, {
          width: CW - 12,
          height: commentBoxH - 10,
          ellipsis: true,
        });
    } else {
      cellText(M, y, CW, commentBoxH, 'No comments', {
        fs: 7.5,
        fg: '#6b7280',
        align: 'center',
      });
    }
    y += commentBoxH + 10;

    // ── 6. SIGNATURE BOX ────────────────────────────────────────────
    const SIG_W = 190;
    const SIG_X = M + CW - SIG_W;
    const SIG_H = signatureSectionH;

    borderRect(SIG_X, y, SIG_W, SIG_H);
    fillRect(SIG_X, y, SIG_W, 14, GRAY_BG);
    borderRect(SIG_X, y, SIG_W, 14);
    cellText(SIG_X, y, SIG_W, 14, 'Signature du Chef de Mission', {
      bold: true,
      fs: 6.5,
      fg: LABEL_FG,
      align: 'right',
      pad: 5,
    });

    if (content.signedAt || content.signatoryName) {
      const sigDate = dateFr(content.signedAt);
      const sigName = content.signatoryName ? `Signé par : ${content.signatoryName}` : '';
      pdf
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(VALUE_FG)
        .text(`${sigName}\nLe ${sigDate}`, SIG_X + 6, y + 24, {
          width: SIG_W - 12,
          align: 'center',
        });
    }

    pdf.end();
  });
}
