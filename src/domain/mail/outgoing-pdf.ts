import PDFDocument from 'pdfkit';

// What the PDF of an approved sortant shows.
export interface OutgoingPdfContent {
  reference: string;
  number: string;
  subject: string;
  body: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
  author: string | null;
  recipient: string | null;
  dossier: string | null;
  project: string | null;
  contract: string | null;
  respondsTo: string | null;
}

const date = (value: Date) =>
  value.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

// The PDF of an approved sortant: its reference, its recipient and
// attachments, its subject and text, and its approval.
export function renderOutgoingPdf(content: OutgoingPdfContent) {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 56,
      info: { Title: `${content.reference} — ${content.subject}` },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    pdf.font('Helvetica-Bold').fontSize(14).text(`Réf. : ${content.reference}`);
    pdf
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555555')
      .text(`N° d'enregistrement : ${content.number}`);
    if (content.approvedAt) {
      pdf.text(`Date : ${date(content.approvedAt)}`);
    }
    pdf.fillColor('#000000').moveDown(1.5);

    const line = (label: string, value: string | null) => {
      if (!value) return;
      pdf
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`${label} : `, { continued: true })
        .font('Helvetica')
        .text(value);
    };
    line('Destinataire', content.recipient);
    line('Projet', content.project);
    line('Contrat', content.contract);
    line('Dossier', content.dossier);
    line('En réponse à', content.respondsTo);
    pdf.moveDown();

    pdf.font('Helvetica-Bold').fontSize(11).text(`Objet : ${content.subject}`);
    pdf.moveDown();
    pdf
      .font('Helvetica')
      .fontSize(11)
      .text(content.body ?? '', { align: 'justify', lineGap: 2 });
    pdf.moveDown(2);

    pdf.fontSize(9).fillColor('#555555');
    if (content.author) pdf.text(`Rédigé par : ${content.author}`);
    if (content.approvedBy) {
      pdf.text(
        `Approuvé par : ${content.approvedBy}${
          content.approvedAt ? ` le ${date(content.approvedAt)}` : ''
        }`,
      );
    }
    pdf.end();
  });
}
