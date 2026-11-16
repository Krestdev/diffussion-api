import { ClsServiceManager } from 'nestjs-cls';
import {
  InstructionStatus,
  LivrableStatus,
  SubscriptionDecision,
  UserInstructionRole,
} from '../generated/prisma/client';
import { Permission } from '../auth/permissions';
import type { ActionState } from '../workflow/action-states';
import { ActionsInstruction, instructionActions } from './instruction-actions';

let held: string[] = [];
beforeEach(() => {
  held = [];
  jest.spyOn(ClsServiceManager, 'getClsService').mockReturnValue({
    isActive: () => true,
    get: (key: string) => (key === 'permissions' ? held : undefined),
  } as never);
});
afterEach(() => jest.restoreAllMocks());

const task = (
  fields: Partial<ActionsInstruction> = {},
): ActionsInstruction => ({
  status: InstructionStatus.EN_COURS,
  createdById: 'u-creator',
  lastRemindedAt: null,
  assignees: [
    { role: UserInstructionRole.EXECUTANT, user: { id: 'u-exec' } },
    { role: UserInstructionRole.SUPERVISEUR, user: { id: 'u-sup' } },
    { role: UserInstructionRole.VALIDATEUR, user: { id: 'u-val' } },
  ],
  subscriptions: [
    { userId: 'u-exec', decision: SubscriptionDecision.SOUSCRITE },
  ],
  livrables: [
    {
      id: 'l-1',
      status: LivrableStatus.EN_PREPARATION,
      isLatest: true,
      validationStep: 0,
    },
  ],
  ...fields,
});

const names = (states: { action: string }[]) => states.map((s) => s.action);
const state = (states: ActionState[], action: string) =>
  states.find((s) => s.action === action);

describe('instructionActions', () => {
  it('leaves out what a reader without permission or designation can never do', () => {
    const { actions, livrables } = instructionActions(task(), {
      userId: 'u-reader',
      workspaceOpen: true,
    });
    expect(actions).toEqual([]);
    expect(livrables.get('l-1')).toEqual([]);
  });

  it('gives the subscriber their work, with the reason of what is blocked now', () => {
    const { actions, livrables } = instructionActions(task(), {
      userId: 'u-exec',
      workspaceOpen: true,
    });
    expect(names(actions)).toEqual([
      'subscribe',
      'decline',
      'deposit',
      'addLivrable',
    ]);
    expect(state(actions, 'subscribe')).toEqual({
      action: 'subscribe',
      enabled: false,
      reason: 'WRONG_STATUS',
      params: { status: 'EN_COURS' },
    });
    expect(state(actions, 'deposit')?.enabled).toBe(true);
    expect(names(livrables.get('l-1')!)).toEqual([
      'edit',
      'delete',
      'deposit',
      'submit',
      'newVersion',
    ]);
    expect(state(livrables.get('l-1')!, 'deposit')?.enabled).toBe(true);
  });

  it('tells the decider when nothing waits for a decision, the validateur giving an opinion first', () => {
    const awaiting = task({
      status: InstructionStatus.EN_ATTENTE_VALIDATION,
      livrables: [
        {
          id: 'l-1',
          status: LivrableStatus.SOUMIS,
          isLatest: true,
          validationStep: 0,
        },
      ],
    });
    const sup = instructionActions(awaiting, {
      userId: 'u-sup',
      workspaceOpen: true,
    });
    expect(state(sup.actions, 'approveLivrables')).toMatchObject({
      enabled: false,
      reason: 'NOTHING_TO_DECIDE',
    });
    const val = instructionActions(awaiting, {
      userId: 'u-val',
      workspaceOpen: true,
    });
    expect(state(val.livrables.get('l-1')!, 'giveOpinion')?.enabled).toBe(true);
    expect(names(val.actions)).toEqual([]);
  });

  it('lists permission actions with their reasons', () => {
    held = [
      Permission.INSTRUCTION_CLOSE,
      Permission.INSTRUCTION_CANCEL,
      Permission.INSTRUCTION_ASSIGN,
    ];
    const { actions } = instructionActions(task(), {
      userId: 'u-chef',
      workspaceOpen: false,
    });
    expect(names(actions)).toEqual(['assign', 'close', 'cancel']);
    expect(state(actions, 'close')).toMatchObject({
      enabled: false,
      reason: 'PREREQUISITE_MISSING',
      params: { missing: 'VALIDATED_LIVRABLES' },
    });
    expect(state(actions, 'cancel')?.enabled).toBe(true);
  });

  it('disables the reminder within the hour, and opens the assignment to the effet supervisor', () => {
    const { actions } = instructionActions(
      task({ lastRemindedAt: new Date(Date.now() - 10 * 60 * 1000) }),
      { userId: 'u-sup', courrierSupervisorId: 'u-sup', workspaceOpen: true },
    );
    expect(state(actions, 'remind')).toMatchObject({
      enabled: false,
      reason: 'TOO_SOON',
    });
    expect(state(actions, 'assign')?.enabled).toBe(true);
  });
});
