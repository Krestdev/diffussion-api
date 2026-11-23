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
  NA: { label: 'NON APPLICABLE', color: '#d1d5db' },
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
    const M = 36; // page margins
    const PW = pdf.page.width; // 595.28 pt
    const PH = pdf.page.height; // 841.89 pt
    const CW = PW - 2 * M; // 523.28 pt
    const accent = content.identity?.color ?? '#0d9488';
    const BORDER = '#9ca3af'; // table grid border
    const GRAY_BG = '#f3f4f6'; // label background
    const LABEL_FG = '#374151'; // dark gray for labels
    const VALUE_FG = '#111827'; // almost black for values
    const HEADER_H = 46;
    const USABLE_BOTTOM = PH - 110; // leave space for letterhead footer

    // ── Safe text helpers ───────────────────────────────────────────
    function fillRect(
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
    ) {
      pdf.rect(x, y, w, h).fill(color);
    }

    function borderRect(
      x: number,
      y: number,
      w: number,
      h: number,
      color = BORDER,
      lineWidth = 0.5,
    ) {
      pdf.lineWidth(lineWidth).rect(x, y, w, h).stroke(color);
    }

    /**
     * Safely fits and truncates text to fit within maxW so it NEVER wraps or overflows.
     */
    function fitText(
      font: string,
      initialSize: number,
      minSize: number,
      rawText: string,
      maxW: number,
    ): { text: string; size: number } {
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
        align = 'left',
        pad = 3.5,
      }: {
        bold?: boolean;
        fs?: number;
        minFs?: number;
        fg?: string;
        align?: 'left' | 'center' | 'right';
        pad?: number;
      } = {},
    ) {
      const fontName = bold ? 'Helvetica-Bold' : 'Helvetica';
      const maxW = Math.max(w - 2 * pad, 0);
      const { text: fittedText, size: actualFs } = fitText(
        fontName,
        fs,
        minFs,
        String(text ?? ''),
        maxW,
      );
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

    // ── 2. METADATA GRID — as the fiche shows on screen ─────────────
    // Left: 3 rows, Remise (double), then 4 rows. Right: Projet (4 rows),
    // Mode, then 4 rows. Both sides are 9 rows high.
    const RH = 16;
    const LEFT_W = Math.round(CW * 0.55);
    const RIGHT_W = CW - LEFT_W;
    const LBL = 50;
    const RX = M + LEFT_W;
    const RL = 66;
    const RV = RIGHT_W - RL;

    function fieldLabel(
      x: number,
      atY: number,
      w: number,
      h: number,
      text: string,
    ) {
      borderRect(x, atY, w, h);
      cellText(x, atY, w, h, text, { fs: 6.5, minFs: 5.5, fg: LABEL_FG });
    }

    function fieldValue(
      x: number,
      atY: number,
      w: number,
      h: number,
      text: string | null | undefined,
    ) {
      borderRect(x, atY, w, h);
      cellText(x, atY, w, h, text || '—', {
        bold: true,
        fs: 7.5,
        minFs: 6,
        align: 'center',
      });
    }

    // label | value | label | value, the first value `firstW` wide.
    function pairRow(
      atY: number,
      l1: string,
      v1: string | null | undefined,
      l2: string,
      v2: string | null | undefined,
      firstW: number,
    ) {
      fieldLabel(M, atY, LBL, RH, l1);
      fieldValue(M + LBL, atY, firstW, RH, v1);
      fieldLabel(M + LBL + firstW, atY, LBL, RH, l2);
      fieldValue(M + 2 * LBL + firstW, atY, LEFT_W - 2 * LBL - firstW, RH, v2);
    }

    function fullRow(
      x: number,
      atY: number,
      labelW: number,
      totalW: number,
      label: string,
      value: string | null | undefined,
      h = RH,
    ) {
      fieldLabel(x, atY, labelW, h, label);
      fieldValue(x + labelW, atY, totalW - labelW, h, value);
    }

    function checkbox(x: number, atY: number, checked: boolean) {
      pdf.lineWidth(0.6).rect(x, atY, 7, 7).stroke(LABEL_FG);
      if (checked) {
        pdf
          .lineWidth(1)
          .moveTo(x + 1.3, atY + 3.6)
          .lineTo(x + 3, atY + 5.6)
          .lineTo(x + 5.9, atY + 1.4)
          .stroke(VALUE_FG);
      }
    }

    const expediteurVal =
      content.expediteur ?? content.courrier?.split('—')?.[1]?.trim() ?? '—';
    const freeW = LEFT_W - 2 * LBL;
    let ly = y;
    pairRow(
      ly,
      'Réf Fiche',
      content.reference,
      'Créée le',
      dateFr(content.createdAt),
      Math.round(freeW * 0.72),
    );
    ly += RH;
    pairRow(
      ly,
      'Auteur',
      content.author.name,
      'Fonction',
      content.author.function,
      Math.round(freeW * 0.5),
    );
    ly += RH;
    pairRow(
      ly,
      'Validé par',
      content.validator.name,
      'Fonction',
      content.validator.function,
      Math.round(freeW * 0.5),
    );
    ly += RH;
    fullRow(
      M,
      ly,
      LBL,
      LEFT_W,
      'Remise',
      content.title ?? content.courrier,
      RH * 2,
    );
    ly += RH * 2;
    for (const [label, value] of [
      ['Réf B/L', content.refBL],
      ['Version', content.version],
      ['Lieu d’usage', content.lieuUsage],
      ['Expéditeur', expediteurVal],
    ] as [string, string | null | undefined][]) {
      fullRow(M, ly, LBL, LEFT_W, label, value);
      ly += RH;
    }

    let ry = y;
    fieldLabel(RX, ry, RL, RH * 4, 'Projet');
    borderRect(RX + RL, ry, RV, RH * 4);
    const projText = content.projet || '—';
    pdf.font('Helvetica-Bold').fontSize(8);
    const projH = Math.min(
      pdf.heightOfString(projText, { width: RV - 10 }),
      RH * 4 - 6,
    );
    pdf
      .fillColor(VALUE_FG)
      .text(projText, RX + RL + 5, ry + (RH * 4 - projH) / 2, {
        width: RV - 10,
        height: RH * 4 - 6,
        align: 'center',
        ellipsis: true,
      });
    ry += RH * 4;

    // Mode: Contrat, B/C, L/C or Autre, each followed by its box.
    fieldLabel(RX, ry, RL, RH, 'Mode');
    const modeKey = (content.mode ?? '').toUpperCase().replace(/[^A-Z]/g, '');
    const modes: [string, boolean][] = [
      ['Contrat', modeKey === 'CONTRAT'],
      ['B/C', modeKey === 'BC'],
      ['L/C', modeKey === 'LC'],
    ];
    modes.push(['Autre', !!modeKey && !modes.some(([, on]) => on)]);
    const SLOT_W = RV / modes.length;
    const BOX_W = 14;
    modes.forEach(([label, on], i) => {
      const sx = RX + RL + i * SLOT_W;
      borderRect(sx, ry, SLOT_W - BOX_W, RH);
      cellText(sx, ry, SLOT_W - BOX_W, RH, label, {
        fs: 6.5,
        minFs: 5.5,
        fg: LABEL_FG,
      });
      borderRect(sx + SLOT_W - BOX_W, ry, BOX_W, RH);
      checkbox(sx + SLOT_W - BOX_W + 3.5, ry + (RH - 7) / 2, on);
    });
    ry += RH;

    for (const [label, value] of [
      ['Réf Projet', content.refProjet],
      ['Allotissement', content.allotissement],
      ['Maître d’ouvrage', content.maitreOuvrage],
      ['Date de remise', dateFr(content.dateRemise)],
    ] as [string, string | null | undefined][]) {
      fullRow(RX, ry, RL, RIGHT_W, label, value);
      ry += RH;
    }

    y += RH * 9 + 16;

    // An opinion as on screen: its coloured badge, dark text.
    function opinionBadge(
      x: number,
      atY: number,
      w: number,
      h: number,
      code: string | null | undefined,
      fs = 6.5,
    ) {
      const badge = code ? OPINION_BADGES[code] : null;
      if (badge) fillRect(x, atY, w, h, badge.color);
      borderRect(x, atY, w, h);
      cellText(x, atY, w, h, badge?.label ?? '—', {
        bold: true,
        fs,
        minFs: 5.5,
        fg: VALUE_FG,
        align: 'center',
      });
    }

    // Multi-line text inside a box, centred or from its top-left.
    function boxText(
      x: number,
      atY: number,
      w: number,
      h: number,
      text: string,
      align: 'left' | 'center',
    ) {
      pdf.font('Helvetica').fontSize(7);
      const textH = Math.min(
        pdf.heightOfString(text, { width: w - 12 }),
        h - 8,
      );
      pdf
        .fillColor(VALUE_FG)
        .text(
          text,
          x + 6,
          align === 'center' ? atY + (h - textH) / 2 : atY + 5,
          { width: w - 12, height: h - 8, align, ellipsis: true },
        );
    }

    // ── 3. ONE BLOCK PER ELEMENT ────────────────────────────────────
    const EL_LBL_W = 72;
    const AVIS_LBL_W = 30;
    const AVIS_BLOCK_W = 90;
    const SUB_H = 13;
    const PER_ROW = 4;
    const PAIR_W = CW / PER_ROW;
    const CODE_W = 26;
    const CRIT_H = 20;
    const DESC_W = Math.round(CW / 3);
    const OBS_W = CW - DESC_W;

    for (const item of content.items) {
      // The criteria's own observations join the element's.
      const observations = [
        item.observation,
        ...item.criteria
          .filter((criterion) => criterion.observation)
          .map((criterion) => `${criterion.label} : ${criterion.observation}`),
      ]
        .filter(Boolean)
        .join('\n');
      pdf.font('Helvetica').fontSize(7);
      const textH = Math.max(
        item.description
          ? pdf.heightOfString(item.description, { width: DESC_W - 12 })
          : 0,
        observations
          ? pdf.heightOfString(observations, { width: OBS_W - 12 })
          : 0,
      );
      const boxH = Math.min(Math.max(52, Math.ceil(textH + 12)), 220);
      const critRows = Math.max(1, Math.ceil(item.criteria.length / PER_ROW));
      const blockH = SUB_H * 2 + SUB_H + SUB_H + critRows * CRIT_H + 14 + boxH;

      if (y + blockH > USABLE_BOTTOM) {
        pdf.addPage();
        y = drawHeader(M);
      }

      // Élément à analyser | its label | Avis + code, its badge below.
      const labelW = CW - EL_LBL_W - AVIS_BLOCK_W;
      fieldLabel(M, y, EL_LBL_W, SUB_H * 2, 'Élément à analyser');
      borderRect(M + EL_LBL_W, y, labelW, SUB_H * 2);
      cellText(M + EL_LBL_W, y, labelW, SUB_H * 2, item.label, {
        bold: true,
        fs: 8,
        minFs: 6,
        align: 'center',
      });
      const ax = M + EL_LBL_W + labelW;
      fieldLabel(ax, y, AVIS_LBL_W, SUB_H, 'Avis');
      borderRect(ax + AVIS_LBL_W, y, AVIS_BLOCK_W - AVIS_LBL_W, SUB_H);
      cellText(
        ax + AVIS_LBL_W,
        y,
        AVIS_BLOCK_W - AVIS_LBL_W,
        SUB_H,
        item.opinion ?? '—',
        {
          bold: true,
          fs: 6.5,
        },
      );
      opinionBadge(ax, y + SUB_H, AVIS_BLOCK_W, SUB_H, item.opinion, 6);
      y += SUB_H * 2;

      borderRect(M, y, CW, SUB_H);
      cellText(
        M,
        y,
        CW,
        SUB_H,
        `Normes & docs références : ${item.norms || '—'}`,
        {
          fs: 6.5,
          minFs: 5.5,
          fg: LABEL_FG,
          align: 'center',
        },
      );
      y += SUB_H;

      fillRect(M, y, CW, SUB_H, GRAY_BG);
      borderRect(M, y, CW, SUB_H);
      cellText(M, y, CW, SUB_H, 'Critères', {
        fs: 6.5,
        fg: LABEL_FG,
        align: 'center',
      });
      y += SUB_H;

      // The criteria, four per row: its label, then its opinion code.
      if (!item.criteria.length) {
        borderRect(M, y, CW, CRIT_H);
        cellText(M, y, CW, CRIT_H, '—', { fs: 7, align: 'center' });
      }
      item.criteria.forEach((criterion, i) => {
        const cx = M + (i % PER_ROW) * PAIR_W;
        const cy = y + Math.floor(i / PER_ROW) * CRIT_H;
        borderRect(cx, cy, PAIR_W - CODE_W, CRIT_H);
        cellText(cx, cy, PAIR_W - CODE_W, CRIT_H, criterion.label, {
          fs: 6.5,
          minFs: 5,
          fg: LABEL_FG,
        });
        borderRect(cx + PAIR_W - CODE_W, cy, CODE_W, CRIT_H);
        cellText(cx + PAIR_W - CODE_W, cy, CODE_W, CRIT_H, criterion.opinion, {
          bold: true,
          fs: 6.5,
        });
      });
      y += critRows * CRIT_H;

      borderRect(M, y, DESC_W, 14);
      cellText(M, y, DESC_W, 14, 'Description', {
        bold: true,
        fs: 7,
        align: 'center',
      });
      borderRect(M + DESC_W, y, OBS_W, 14);
      cellText(M + DESC_W, y, OBS_W, 14, 'Observations / Commentaires', {
        bold: true,
        fs: 7,
        align: 'center',
      });
      y += 14;

      borderRect(M, y, DESC_W, boxH);
      if (item.description) {
        boxText(M, y, DESC_W, boxH, item.description, 'center');
      }
      borderRect(M + DESC_W, y, OBS_W, boxH);
      if (observations) {
        boxText(M + DESC_W, y, OBS_W, boxH, observations, 'left');
      }
      y += boxH + 14;
    }

    // ── 4. RÉCAPITULATIF, COMMENTS AND SIGNATURE ───────────────────
    const ELEM_W = Math.round((CW * 2) / 3);
    const AVIS_W = CW - ELEM_W;
    const ROW_H = 14;
    const SIG_H = 64;
    pdf.font('Helvetica').fontSize(7.5);
    const commentBoxH = content.comments
      ? Math.min(
          Math.max(
            40,
            Math.ceil(
              pdf.heightOfString(content.comments, { width: CW - 12 }) + 14,
            ),
          ),
          120,
        )
      : 40;
    const summaryH =
      16 + ROW_H + content.items.length * ROW_H + 18 + commentBoxH;

    if (y + summaryH > USABLE_BOTTOM) {
      pdf.addPage();
      y = drawHeader(M);
    }

    fillRect(M, y, CW, 16, GRAY_BG);
    borderRect(M, y, CW, 16);
    cellText(M, y, CW, 16, 'RÉCAPITULATIF DES AVIS PAR ÉLÉMENT', {
      bold: true,
      fs: 7.5,
      fg: LABEL_FG,
      align: 'center',
    });
    y += 16;

    borderRect(M, y, ELEM_W, ROW_H);
    cellText(M, y, ELEM_W, ROW_H, 'Éléments analysés', {
      bold: true,
      fs: 6.5,
      align: 'center',
    });
    borderRect(M + ELEM_W, y, AVIS_W, ROW_H);
    cellText(M + ELEM_W, y, AVIS_W, ROW_H, 'Avis', {
      bold: true,
      fs: 6.5,
      align: 'center',
    });
    y += ROW_H;

    for (const item of content.items) {
      borderRect(M, y, ELEM_W, ROW_H);
      cellText(M, y, ELEM_W, ROW_H, item.label, {
        bold: true,
        fs: 6.5,
        minFs: 5.5,
        align: 'center',
      });
      opinionBadge(M + ELEM_W, y, AVIS_W, ROW_H, item.opinion, 6);
      y += ROW_H;
    }

    // Avis général: its label on half the width, its badge on the other.
    const HALF_W = CW / 2;
    borderRect(M, y, HALF_W, 18);
    cellText(M, y, HALF_W, 18, 'AVIS GÉNÉRAL DE LA REMISE', {
      bold: true,
      fs: 7.5,
      fg: accent,
      align: 'center',
    });
    opinionBadge(M + HALF_W, y, CW - HALF_W, 18, content.overallOpinion, 7.5);
    y += 18;

    borderRect(M, y, CW, commentBoxH);
    if (content.comments) {
      boxText(M, y, CW, commentBoxH, content.comments, 'center');
    }
    y += commentBoxH + 16;

    // The signature may go on the next page on its own.
    if (y + SIG_H > USABLE_BOTTOM) {
      pdf.addPage();
      y = drawHeader(M);
    }
    const SIG_W = Math.round(CW * 0.4);
    const SIG_X = M + CW - SIG_W;
    borderRect(SIG_X, y, SIG_W, SIG_H);
    borderRect(SIG_X, y, SIG_W, 12);
    cellText(SIG_X, y, SIG_W, 12, 'Signature du Chef de Mission', {
      bold: true,
      fs: 6,
      align: 'right',
      pad: 5,
    });
    if (content.signedAt || content.signatoryName) {
      const sigName = content.signatoryName
        ? `Signé par : ${content.signatoryName}\n`
        : '';
      pdf
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .fillColor(VALUE_FG)
        .text(`${sigName}Le ${dateFr(content.signedAt)}`, SIG_X + 6, y + 24, {
          width: SIG_W - 12,
          align: 'center',
        });
    }

    pdf.end();
  });
}
