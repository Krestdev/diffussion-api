import PDFDocument from 'pdfkit';

// What the bordereau de transmission (model S·12) of a sent sortant shows.
export interface BordereauPdfContent {
  bordereauNumber: string;
  transmittedAt: Date;
  transmissionMode: string | null;
  issuer: { name: string | null; site: string | null };
  recipient: { correspondent: string | null; person: string | null };
  rows: { reference: string; subject: string; pieces: number }[];
  issuedBy: string | null;
  // Filled in once the discharged bordereau came back.
  receivedBy: string | null;
  dischargedAt: Date | null;
}

const date = (value: Date) =>
  value.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

export function renderBordereauPdf(content: BordereauPdfContent) {
  return new Promise<Buffer>((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 48,
      info: { Title: `Bordereau de transmission ${content.bordereauNumber}` },
    });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const left = pdf.page.margins.left;
    const width = pdf.page.width - left - pdf.page.margins.right;

    // Header.
    pdf
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#555555')
      .text('Modèle S·12', left, 48, { width, align: 'right' });
    pdf
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('BORDEREAU DE TRANSMISSION', left, 64, { width, align: 'center' });
    pdf
      .font('Helvetica')
      .fontSize(11)
      .text(`N° ${content.bordereauNumber}`, { width, align: 'center' });
    pdf.moveDown(1.5);

    // Issuer and recipient, side by side.
    const half = (width - 16) / 2;
    const boxTop = pdf.y;
    const party = (
      x: number,
      title: string,
      lines: (string | null)[],
    ): number => {
      pdf
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(title, x + 8, boxTop + 8, { width: half - 16 });
      pdf.font('Helvetica').fontSize(10);
      for (const text of lines.filter((l): l is string => Boolean(l))) {
        pdf.text(text, x + 8, pdf.y + 2, { width: half - 16 });
      }
      return pdf.y;
    };
    const issuerBottom = party(left, 'ÉMETTEUR', [
      content.issuer.site,
      content.issuer.name,
    ]);
    const recipientBottom = party(left + half + 16, 'DESTINATAIRE', [
      content.recipient.correspondent,
      content.recipient.person
        ? `À l'attention de : ${content.recipient.person}`
        : null,
    ]);
    const boxHeight = Math.max(issuerBottom, recipientBottom) - boxTop + 10;
    pdf.rect(left, boxTop, half, boxHeight).stroke();
    pdf.rect(left + half + 16, boxTop, half, boxHeight).stroke();

    // Date and mode.
    pdf.y = boxTop + boxHeight + 14;
    pdf
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('Date : ', left, pdf.y, { continued: true })
      .font('Helvetica')
      .text(date(content.transmittedAt), { continued: true })
      .font('Helvetica-Bold')
      .text('      Mode de transmission : ', { continued: true })
      .font('Helvetica')
      .text(content.transmissionMode ?? '—');
    pdf.moveDown();

    // The table: reference, subject, pieces.
    const columns = [
      { title: 'Référence', width: width * 0.28 },
      { title: 'Objet', width: width * 0.57 },
      { title: 'Pièces', width: width * 0.15 },
    ];
    const cell = (texts: string[], bold: boolean) => {
      const top = pdf.y;
      pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const height =
        Math.max(
          ...texts.map((text, i) =>
            pdf.heightOfString(text, { width: columns[i].width - 12 }),
          ),
        ) + 10;
      let x = left;
      texts.forEach((text, i) => {
        pdf.rect(x, top, columns[i].width, height).stroke();
        pdf.text(text, x + 6, top + 5, {
          width: columns[i].width - 12,
          align: i === 2 ? 'center' : 'left',
        });
        x += columns[i].width;
      });
      pdf.y = top + height;
    };
    cell(
      columns.map((c) => c.title),
      true,
    );
    for (const row of content.rows) {
      cell([row.reference, row.subject, String(row.pieces)], false);
    }

    // "Émis par" and "Reçu par (décharge)" frames.
    pdf.y += 24;
    const frameTop = pdf.y;
    const frameHeight = 120;
    const frame = (x: number, title: string, lines: string[]) => {
      pdf.rect(x, frameTop, half, frameHeight).stroke();
      pdf
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(title, x + 8, frameTop + 8, { width: half - 16 });
      pdf.font('Helvetica').fontSize(9);
      for (const text of lines) {
        pdf.text(text, x + 8, pdf.y + 6, { width: half - 16 });
      }
    };
    frame(left, 'ÉMIS PAR', [
      `Nom : ${content.issuedBy ?? ''}`,
      `Date : ${date(content.transmittedAt)}`,
      'Signature :',
    ]);
    frame(left + half + 16, 'REÇU PAR (DÉCHARGE)', [
      `Nom : ${content.receivedBy ?? ''}`,
      `Date : ${content.dischargedAt ? date(content.dischargedAt) : ''}`,
      'Signature et cachet :',
    ]);
    pdf.end();
  });
}
