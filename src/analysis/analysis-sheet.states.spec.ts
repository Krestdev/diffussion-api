import { AnalysisSheetStatus as S } from '../../generated/prisma/client';
import { Permission } from '../auth/permissions';
import {
  AnalysisSheetEvent,
  ANALYSIS_SHEET_STATES,
} from './analysis-sheet.states';

// Today's transitions (status map §5), with the permission the route needs.
const DOCUMENTED: [S, AnalysisSheetEvent, S, string?][] = [
  [S.BROUILLON, 'SUBMIT', S.ENREGISTREE, Permission.ANALYSIS_UPDATE],
  [S.ENREGISTREE, 'SUBMIT', S.ENREGISTREE, Permission.ANALYSIS_UPDATE],
  [S.BROUILLON, 'SIGN', S.SIGNEE, Permission.ANALYSIS_UPDATE],
  [S.ENREGISTREE, 'SIGN', S.SIGNEE, Permission.ANALYSIS_UPDATE],
  [S.BROUILLON, 'ARCHIVE', S.ARCHIVEE, Permission.ANALYSIS_ARCHIVE],
  [S.SIGNEE, 'ARCHIVE', S.ARCHIVEE, Permission.ANALYSIS_ARCHIVE],
  [S.ARCHIVEE, 'UNARCHIVE', S.ENREGISTREE, Permission.ANALYSIS_ARCHIVE],
  [S.ARCHIVEE, 'UNARCHIVE', S.SIGNEE, Permission.ANALYSIS_ARCHIVE],
  [S.ENREGISTREE, 'ARCHIVE_BY_PROJECT', S.ARCHIVEE],
  [S.ARCHIVEE, 'RESTORE_BY_PROJECT', S.BROUILLON],
];

const REFUSED: [S, AnalysisSheetEvent][] = [
  [S.SIGNEE, 'SUBMIT'],
  [S.SIGNEE, 'SIGN'],
  [S.ARCHIVEE, 'ARCHIVE'],
  [S.BROUILLON, 'UNARCHIVE'],
  [S.ARCHIVEE, 'ARCHIVE_BY_PROJECT'],
];

describe('ANALYSIS_SHEET_STATES', () => {
  // Every row with its permission (null: none), so jest passes four arguments.
  const rows = DOCUMENTED.map(
    ([from, event, to, permission]) =>
      [from, event, to, permission ?? null] as const,
  );

  it.each(rows)('%s -> %s -> %s', (from, event, to, permission) => {
    const rule = ANALYSIS_SHEET_STATES.resolve(from, event);
    expect(rule).toBeDefined();
    expect(ANALYSIS_SHEET_STATES.target(rule!, to)).toBe(to);
    expect(rule!.permission ?? null).toBe(permission);
  });

  it.each(REFUSED)('refuses %s -> %s', (from, event) => {
    expect(ANALYSIS_SHEET_STATES.allows(from, event)).toBe(false);
  });
});
