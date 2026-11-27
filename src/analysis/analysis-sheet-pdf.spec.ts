import { PDFDocument } from 'pdf-lib';
import {
  renderAnalysisSheetPdf,
  type AnalysisSheetPdfContent,
} from './analysis-sheet-pdf';

const content: AnalysisSheetPdfContent = {
  reference: 'FA-2026-000018',
  version: '1.0',
  status: 'BROUILLON',
  title: 'Dossier d’exécution',
  courrier: 'M-123456 — Remise du dossier',
  items: [
    {
      order: 1,
      label: 'Plan de masse',
      document: null,
      norms: null,
      description: 'Implantation générale',
      opinion: 'AF',
      suggestedOpinion: null,
      observation: null,
      criteria: [{ label: 'Lisibilité', opinion: 'AF', observation: null }],
    },
  ],
  suggestedOpinion: null,
  overallOpinion: 'AF',
  comments: null,
  author: { name: 'Agent', function: null },
  validator: { name: null, function: null },
  signedAt: null,
  signatoryName: null,
};

async function a4Pdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]);
  return Buffer.from(await pdf.save());
}

describe('renderAnalysisSheetPdf', () => {
  it('renders the fiche on A4 pages without a background', async () => {
    const pdf = await PDFDocument.load(await renderAnalysisSheetPdf(content));

    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    const { width, height } = pdf.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  });

  it('draws a PDF background behind every page, keeping their number', async () => {
    const plain = await PDFDocument.load(await renderAnalysisSheetPdf(content));
    const stamped = await PDFDocument.load(
      await renderAnalysisSheetPdf({
        ...content,
        identity: {
          color: '#7C3AED',
          logo: null,
          background: { data: await a4Pdf(), mimeType: 'application/pdf' },
        },
      }),
    );

    expect(stamped.getPageCount()).toBe(plain.getPageCount());
  });

  it('still gives the fiche when the background cannot be read', async () => {
    const rendered = await renderAnalysisSheetPdf({
      ...content,
      identity: {
        color: '#7C3AED',
        logo: null,
        background: {
          data: Buffer.from('not an image'),
          mimeType: 'image/png',
        },
      },
    });

    expect((await PDFDocument.load(rendered)).getPageCount()).toBeGreaterThan(
      0,
    );
  });
});
