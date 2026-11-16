import { ClsServiceManager } from 'nestjs-cls';
import {
  AnalysisSheetStatus,
  CourrierStatus,
  LivrableStatus,
} from '../generated/prisma/client';
import { Permission } from '../auth/permissions';
import { ActionsSheet, analysisSheetActions } from './analysis-sheet-actions';

let held: string[] = [];
beforeEach(() => {
  held = [];
  jest.spyOn(ClsServiceManager, 'getClsService').mockReturnValue({
    isActive: () => true,
    get: (key: string) => (key === 'permissions' ? held : undefined),
  } as never);
});
afterEach(() => jest.restoreAllMocks());

const sheet = (fields: Partial<ActionsSheet> = {}): ActionsSheet => ({
  status: AnalysisSheetStatus.BROUILLON,
  authorId: 'u-author',
  livrable: { status: LivrableStatus.EN_PREPARATION },
  nextVersion: null,
  items: [{ opinion: 'AF' }],
  ...fields,
});
const open = { effetStatus: CourrierStatus.TRANSMIS };

describe('analysisSheetActions', () => {
  it('is empty for a reader', () => {
    held = [Permission.ANALYSIS_READ];
    expect(analysisSheetActions(sheet(), { userId: 'u', ...open })).toEqual([]);
  });

  it('lets its author submit it, disabled for anyone else', () => {
    held = [Permission.ANALYSIS_UPDATE];
    const mine = analysisSheetActions(sheet(), {
      userId: 'u-author',
      ...open,
    });
    expect(mine.map((a) => a.action)).toEqual([
      'edit',
      'submit',
      'sign',
      'newVersion',
      'delete',
    ]);
    expect(mine.find((a) => a.action === 'submit')?.enabled).toBe(true);
    expect(
      analysisSheetActions(sheet(), { userId: 'u-other', ...open }).find(
        (a) => a.action === 'submit',
      ),
    ).toMatchObject({
      enabled: false,
      reason: 'NOT_DESIGNATED',
      params: { role: 'AUTHOR' },
    });
  });

  it('asks for every opinion first, and decides only a submitted fiche', () => {
    held = [Permission.ANALYSIS_UPDATE, Permission.ANALYSIS_APPROVE];
    const actions = analysisSheetActions(
      sheet({ items: [{ opinion: null }] }),
      { userId: 'u-author', ...open },
    );
    expect(actions.find((a) => a.action === 'submit')).toMatchObject({
      reason: 'PREREQUISITE_MISSING',
      params: { missing: 'OPINIONS' },
    });
    expect(actions.find((a) => a.action === 'decide')).toMatchObject({
      reason: 'NOTHING_TO_DECIDE',
    });
  });

  it('restores an archived fiche only', () => {
    held = [Permission.ANALYSIS_ARCHIVE];
    const actions = analysisSheetActions(
      sheet({ status: AnalysisSheetStatus.ARCHIVEE }),
      { userId: 'u', ...open },
    );
    expect(actions).toEqual([
      {
        action: 'archive',
        enabled: false,
        reason: 'WRONG_STATUS',
        params: { status: 'ARCHIVEE' },
      },
      { action: 'unarchive', enabled: true },
    ]);
  });
});
