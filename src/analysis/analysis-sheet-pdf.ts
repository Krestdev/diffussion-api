import PDFDocument from 'pdfkit';

// What the PDF of a fiche d'analyse shows.
export interface AnalysisSheetPdfContent {
  reference: string;
  version: string;
  status: string;
  title: string | null;
  courrier: string;
  header: [label: string, value: string | null][];
  items: {
    order: number;
    label: string;
    document: string | null;
    norms: string | null;
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
}

const OPINION_LABEL: Record<string, string> = {
  AF: 'AF — Avis favorable',
  AFR: 'AFR — Favorable sous réserve',
  AS: 'AS — Avis suspendu',
  AD: 'AD — Avis défavorable',
  NA: 'NA — Non applicable',
};
const opinion = (value: string | null) =>
  value ? (OPINION_LABEL[value] ?? value) : '—';

const date = (value: Date) =>
  value.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

export function renderAnalysisSheetPdf(content: AnalysisSheetPdfContent) {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: {
        Title: `Fiche d'analyse ${content.reference} v${content.version}`,
      },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const left = pdf.page.margins.left;
    const width = pdf.page.width - left - pdf.page.margins.right;

    pdf
      .font('Helvetica-Bold')
      .fontSize(16)
      .text("FICHE D'ANALYSE", { width, align: 'center' });
    pdf
      .font('Helvetica')
      .fontSize(10)
      .text(
        `${content.reference} — version ${content.version} — ${content.status}`,
        { width, align: 'center' },
      );
    if (content.title) {
      pdf.moveDown(0.5);
      pdf
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(content.title, { width, align: 'center' });
    }
    pdf.moveDown();

    const field = (label: string, value: string | null) => {
      if (!value) return;
      pdf
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`${label} : `, { continued: true })
        .font('Helvetica')
        .text(value);
    };
    field('Effet analysé', content.courrier);
    for (const [label, value] of content.header) field(label, value);
    pdf.moveDown();

    for (const item of content.items) {
      if (pdf.y > pdf.page.height - 160) pdf.addPage();
      pdf
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`${item.order}. ${item.label}`);
      pdf.font('Helvetica').fontSize(9);
      if (item.document) pdf.text(`Document : ${item.document}`);
      if (item.norms) pdf.text(`Normes : ${item.norms}`);
      for (const criterion of item.criteria) {
        pdf.text(
          `• ${criterion.label} : ${criterion.opinion}${
            criterion.observation ? ` — ${criterion.observation}` : ''
          }`,
          { indent: 10 },
        );
      }
      if (item.observation) pdf.text(`Observation : ${item.observation}`);
      pdf
        .font('Helvetica-Bold')
        .text(
          `Avis : ${opinion(item.opinion)}${
            item.suggestedOpinion && item.suggestedOpinion !== item.opinion
              ? ` (suggéré : ${item.suggestedOpinion})`
              : ''
          }`,
        );
      pdf.moveDown(0.6);
    }

    if (pdf.y > pdf.page.height - 220) pdf.addPage();
    pdf.moveDown();
    pdf.font('Helvetica-Bold').fontSize(11).text('Synthèse');
    pdf.font('Helvetica').fontSize(10);
    pdf.text(`Avis suggéré : ${opinion(content.suggestedOpinion)}`);
    pdf.text(`Avis retenu : ${opinion(content.overallOpinion)}`);
    if (content.comments) {
      pdf.moveDown(0.5).text(`Commentaires : ${content.comments}`);
    }

    // Signature frames: the author, the validator.
    pdf.moveDown(1.5);
    const top = pdf.y;
    const half = (width - 16) / 2;
    const frame = (x: number, title: string, lines: string[]) => {
      pdf.rect(x, top, half, 100).stroke();
      pdf
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(title, x + 8, top + 8, { width: half - 16 });
      pdf.font('Helvetica').fontSize(9);
      for (const line of lines) {
        pdf.text(line, x + 8, pdf.y + 4, { width: half - 16 });
      }
    };
    frame(left, 'ÉTABLI PAR', [
      content.author.name,
      content.author.function ?? '',
    ]);
    frame(left + half + 16, 'VALIDÉ / SIGNÉ PAR', [
      content.signatoryName ?? content.validator.name ?? '',
      content.validator.function ?? '',
      content.signedAt ? `Le ${date(content.signedAt)}` : '',
    ]);
    pdf.end();
  });
}
