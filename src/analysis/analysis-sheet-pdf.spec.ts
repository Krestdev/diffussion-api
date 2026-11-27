import { inflateSync } from 'zlib';
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

// The text drawn by pdfkit's standard fonts: each content stream inflated,
// each TJ array's hex strings decoded (WinAnsi) and joined.
function pdfText(buffer: Buffer) {
  const raw = buffer.toString('latin1');
  const lines: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (let match = streams.exec(raw); match; match = streams.exec(raw)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const tj of body.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      lines.push(
        [...tj[1].matchAll(/<([0-9a-fA-F]*)>/g)]
          .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
          .join(''),
      );
    }
  }
  return lines.join('\n');
}

describe('renderAnalysisSheetPdf', () => {
  it('shows Dossier, Contrat, Norme and Docs références when given', async () => {
    const text = pdfText(
      await renderAnalysisSheetPdf({
        ...content,
        dossier: 'D-0001 — Lot 2',
        contrat: 'CT-12 — Travaux',
        norme: 'NF EN 1992',
        docsReferences: 'Plans EXE, Notes de calcul',
      }),
    );

    for (const label of [
      'Dossier',
      'D-0001',
      'Contrat',
      'CT-12',
      'Norme',
      'NF EN 1992',
      'Docs références',
      'Plans EXE, Notes de calcul',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('leaves out the Dossier/Contrat and Norme/Docs rows when empty', async () => {
    const text = pdfText(await renderAnalysisSheetPdf(content));

    expect(text).not.toContain('Docs références');
    expect(text).not.toMatch(/^Norme$/m);
  });

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
