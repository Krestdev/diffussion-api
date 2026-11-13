import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { ExportSection } from './dto/dashboard-overview.query.dto';
import type { DashboardOverviewService } from './dashboard-overview.service';

type Overview = Awaited<ReturnType<DashboardOverviewService['overview']>>;
type Workload = Awaited<ReturnType<DashboardOverviewService['workload']>>;
type Cell = string | number | null;

export type ExportTable = {
  title: string;
  columns: string[];
  rows: Cell[][];
};

const KPI_LABELS: [keyof Overview['kpis'], string][] = [
  ['received', 'Effets reçus'],
  ['sent', 'Effets envoyés'],
  ['onTimeRate', 'Traités dans les délais (%)'],
  ['averageDelayDays', 'Délai moyen (jours)'],
  ['late', 'En retard'],
  ['returnRate', 'Renvoyés en correction (%)'],
];

/** The chosen sections as plain tables, for either format. */
export function exportTables(
  overview: Overview,
  workload: Workload,
  sections: readonly ExportSection[],
): ExportTable[] {
  const repartition = (
    title: string,
    rows: Overview['repartition']['records'],
  ): ExportTable => ({
    title,
    columns: ['Nom', 'Projet', 'Effets', 'En retard', 'Délai moyen (j)'],
    rows: rows.map((row) => [
      row.name,
      row.project,
      row.count,
      row.late,
      row.delayDays,
    ]),
  });
  const build: Record<ExportSection, () => ExportTable[]> = {
    arbitration: () => [
      {
        title: 'À arbitrer',
        columns: ['Indicateur', 'Nombre'],
        rows: [
          [
            'À dispatcher depuis plus de 2 jours',
            overview.arbitration.dispatchOver2Days,
          ],
          [
            'En retard de plus de 5 jours',
            overview.arbitration.overdueOver5Days,
          ],
          [
            'Validateurs avec des effets en attente',
            overview.arbitration.validators,
          ],
        ],
      },
    ],
    kpis: () => [
      {
        title: 'Indicateurs',
        columns: ['Indicateur', 'Période', 'Comparaison'],
        rows: KPI_LABELS.map(([key, label]) => [
          label,
          overview.kpis[key].value,
          overview.kpis[key].previous,
        ]),
      },
    ],
    volumes: () => [
      {
        title: 'Volumes mensuels',
        columns: ['Mois', 'Entrants', 'Sortants'],
        rows: overview.monthly.map((m) => [m.month, m.incoming, m.outgoing]),
      },
      {
        title: "Types d'effets",
        columns: ['Type', 'Reçus', 'Envoyés', 'Dans les délais (%)'],
        rows: overview.types.map((t) => [
          t.name,
          t.received,
          t.sent,
          t.onTimeRate,
        ]),
      },
    ],
    delays: () => [
      {
        title: 'Délais par étape',
        columns: ['Étape', 'Jours'],
        rows: overview.delayBySteps.map((s) => [s.step, s.days]),
      },
    ],
    risks: () => [
      {
        title: 'Ancienneté des effets non clôturés',
        columns: ['Tranche', 'Effets'],
        rows: overview.aging.map((a) => [a.bucket, a.count]),
      },
    ],
    workload: () => [
      {
        title: 'Charge par agent',
        columns: ['Agent', 'Tâches ouvertes', 'En retard'],
        rows: workload.map((agent) => [agent.name, agent.open, agent.late]),
      },
    ],
    breakdown: () => [
      repartition(
        'Répartition par dossier ou contrat',
        overview.repartition.records,
      ),
      repartition('Répartition par projet', overview.repartition.projects),
    ],
  };
  return sections.flatMap((section) => build[section]());
}

// Excel forbids these in sheet names, and more than 31 characters.
function sheetName(title: string) {
  return title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 31);
}

export async function renderXlsx(tables: ExportTable[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const table of tables) {
    const sheet = workbook.addWorksheet(sheetName(table.title));
    sheet.addRow(table.columns).font = { bold: true };
    table.rows.forEach((row) => sheet.addRow(row));
    sheet.columns.forEach((column, index) => {
      column.width = index === 0 ? 40 : 18;
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function renderPdf(
  title: string,
  tables: ExportTable[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;

    doc.font('Helvetica-Bold').fontSize(16).text(title);
    for (const table of tables) {
      doc.moveDown();
      if (doc.y + 60 > bottom) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(12).text(table.title, left);
      doc.moveDown(0.3);
      // The first column holds the labels: it gets the room left over.
      const others = table.columns.length - 1;
      const otherWidth = Math.min(90, (width * 0.6) / Math.max(others, 1));
      const firstWidth = width - others * otherWidth;
      const drawRow = (cells: Cell[], font: string) => {
        doc.font(font).fontSize(9);
        const heights = cells.map((cell, index) =>
          doc.heightOfString(String(cell ?? '—'), {
            width: (index === 0 ? firstWidth : otherWidth) - 6,
          }),
        );
        const height = Math.max(...heights) + 4;
        if (doc.y + height > bottom) doc.addPage();
        const y = doc.y;
        let x = left;
        cells.forEach((cell, index) => {
          const cellWidth = index === 0 ? firstWidth : otherWidth;
          doc.text(String(cell ?? '—'), x, y, { width: cellWidth - 6 });
          x += cellWidth;
        });
        doc.x = left;
        doc.y = y + height;
      };
      drawRow(table.columns, 'Helvetica-Bold');
      table.rows.forEach((row) => drawRow(row, 'Helvetica'));
    }
    doc.end();
  });
}
