import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import type { AppClsStore } from '../cls.store';
import { TransitionTable } from './transition-table';
import { StatusDelegate, WorkflowService } from './workflow.service';
import {
  ActionBlockReason,
  ActionStates,
  needsPermission,
  needsStatus,
} from './action-states';

type Status = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
type Event = 'SUBMIT' | 'APPROVE' | 'REJECT';

const table = new TransitionTable<Status, Event>('Request', 'status', [
  { from: 'DRAFT', event: 'SUBMIT', to: 'SUBMITTED' },
  {
    from: 'SUBMITTED',
    event: 'APPROVE',
    to: 'APPROVED',
    permission: 'request.approve',
  },
  { from: ['DRAFT', 'SUBMITTED'], event: 'REJECT', to: 'REJECTED' },
]);

function fakeRow(initial: Status) {
  const row = { id: 'r1', status: initial as string };
  const delegate: StatusDelegate = {
    findFirst: jest.fn(() => Promise.resolve({ status: row.status })),
    updateMany: jest.fn(({ where, data }) => {
      if (where.status !== row.status) return Promise.resolve({ count: 0 });
      Object.assign(row, data);
      return Promise.resolve({ count: 1 });
    }),
  };
  const history = {
    create: jest.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve(args.data),
    ),
  };
  return { row, delegate, tx: { statusHistory: history }, history };
}

function asUser<T>(permissions: string[], fn: () => Promise<T>): Promise<T> {
  const cls = ClsServiceManager.getClsService<AppClsStore>();
  return cls.run(() => {
    cls.set('userId', 'u1');
    cls.set('companyId', 'c1');
    cls.set('ip', '10.0.0.1');
    cls.set('permissions', permissions);
    return fn();
  });
}

async function expectCode(
  promise: Promise<unknown>,
  type: typeof ConflictException | typeof ForbiddenException,
  code: string,
) {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as ConflictException).getResponse()).toMatchObject({ code });
}

describe('TransitionTable', () => {
  it('lists the events allowed from a status', () => {
    expect(table.allowedEvents('SUBMITTED')).toEqual(['APPROVE', 'REJECT']);
    expect(table.allows('DRAFT', 'APPROVE')).toBe(false);
    expect(table.sourcesOf('REJECT')).toEqual(['DRAFT', 'SUBMITTED']);
    expect(table.permissionOf('APPROVE')).toBe('request.approve');
  });

  it('refuses duplicate rules for the same status and event', () => {
    expect(
      () =>
        new TransitionTable<Status, Event>('X', 'status', [
          { from: 'DRAFT', event: 'SUBMIT', to: 'SUBMITTED' },
          { from: ['DRAFT'], event: 'SUBMIT', to: 'REJECTED' },
        ]),
    ).toThrow(/duplicate/);
  });
});

describe('WorkflowService.transition', () => {
  const workflow = new WorkflowService();

  it('applies an allowed transition and records it', async () => {
    const { row, delegate, tx, history } = fakeRow('DRAFT');
    const result = await asUser([], () =>
      workflow.transition(tx, {
        table,
        delegate,
        entityId: 'r1',
        event: 'SUBMIT',
        reason: 'ready',
        data: { submittedAt: 'now' },
      }),
    );
    expect(result).toEqual({ from: 'DRAFT', to: 'SUBMITTED' });
    expect(row).toMatchObject({ status: 'SUBMITTED', submittedAt: 'now' });
    expect(history.create).toHaveBeenCalledTimes(1);
    expect(history.create.mock.calls[0][0].data).toMatchObject({
      companyId: 'c1',
      entity: 'Request',
      entityId: 'r1',
      field: 'status',
      fromStatus: 'DRAFT',
      toStatus: 'SUBMITTED',
      event: 'SUBMIT',
      actorId: 'u1',
      reason: 'ready',
      ip: '10.0.0.1',
    });
  });

  it('uses the status the caller read, without reading it again', async () => {
    const { row, delegate, tx } = fakeRow('DRAFT');
    const findFirst = jest.spyOn(delegate, 'findFirst');
    await asUser([], () =>
      workflow.transition(tx, {
        table,
        delegate,
        entityId: 'r1',
        event: 'SUBMIT',
        from: 'DRAFT',
        companyId: 'c9',
      }),
    );
    expect(findFirst).not.toHaveBeenCalled();
    expect(row.status).toBe('SUBMITTED');
  });

  it('refuses a transition that is not in the table (409 INVALID_TRANSITION)', async () => {
    const { delegate, tx } = fakeRow('DRAFT');
    const promise = asUser(['request.approve'], () =>
      workflow.transition(tx, {
        table,
        delegate,
        entityId: 'r1',
        event: 'APPROVE',
      }),
    );
    await expectCode(promise, ConflictException, 'INVALID_TRANSITION');
    await promise.catch((e: ConflictException) =>
      expect(e.getResponse()).toMatchObject({
        params: { entity: 'Request', from: 'DRAFT', event: 'APPROVE' },
      }),
    );
  });

  it('refuses a transition when the user lacks its permission', async () => {
    const { row, delegate, tx } = fakeRow('SUBMITTED');
    await expectCode(
      asUser([], () =>
        workflow.transition(tx, {
          table,
          delegate,
          entityId: 'r1',
          event: 'APPROVE',
        }),
      ),
      ForbiddenException,
      'FORBIDDEN',
    );
    expect(row.status).toBe('SUBMITTED');
  });

  it('lets the system through without a permission, and records no actor', async () => {
    const { row, delegate, tx, history } = fakeRow('SUBMITTED');
    await workflow.transition(tx, {
      table,
      delegate,
      entityId: 'r1',
      event: 'APPROVE',
      system: true,
      companyId: 'c2',
    });
    expect(row.status).toBe('APPROVED');
    expect(history.create.mock.calls[0][0].data).toMatchObject({
      companyId: 'c2',
      actorId: null,
    });
  });

  it('applies a repeated event only once', async () => {
    const { delegate, tx, history } = fakeRow('DRAFT');
    await asUser([], () =>
      workflow.transition(tx, {
        table,
        delegate,
        entityId: 'r1',
        event: 'SUBMIT',
      }),
    );
    await expectCode(
      asUser([], () =>
        workflow.transition(tx, {
          table,
          delegate,
          entityId: 'r1',
          event: 'SUBMIT',
        }),
      ),
      ConflictException,
      'INVALID_TRANSITION',
    );
    expect(history.create).toHaveBeenCalledTimes(1);
  });

  it('reports a concurrent change instead of overwriting it', async () => {
    const { row, delegate, tx } = fakeRow('DRAFT');
    (delegate.findFirst as jest.Mock).mockImplementationOnce(() => {
      const seen = { status: row.status };
      row.status = 'REJECTED'; // another request wins between the read and the write
      return Promise.resolve(seen);
    });
    await expectCode(
      asUser([], () =>
        workflow.transition(tx, {
          table,
          delegate,
          entityId: 'r1',
          event: 'SUBMIT',
        }),
      ),
      ConflictException,
      'CONCURRENT_UPDATE',
    );
    expect(row.status).toBe('REJECTED');
  });

  it('moves to the target chosen by the caller when a rule has several', async () => {
    const branching = new TransitionTable<Status, Event>('Request', 'status', [
      { from: 'SUBMITTED', event: 'APPROVE', to: ['SUBMITTED', 'APPROVED'] },
    ]);
    const { row, delegate, tx } = fakeRow('SUBMITTED');
    const result = await asUser([], () =>
      workflow.transition(tx, {
        table: branching,
        delegate,
        entityId: 'r1',
        event: 'APPROVE',
        to: 'APPROVED',
      }),
    );
    expect(result).toEqual({ from: 'SUBMITTED', to: 'APPROVED' });
    expect(row.status).toBe('APPROVED');

    // A target outside the rule's list is a programming error, refused before any write.
    const other = fakeRow('SUBMITTED');
    await expect(
      asUser([], () =>
        workflow.transition(other.tx, {
          table: branching,
          delegate: other.delegate,
          entityId: 'r1',
          event: 'APPROVE',
          to: 'REJECTED',
        }),
      ),
    ).rejects.toThrow(/needs a target/);
    expect(other.row.status).toBe('SUBMITTED');
  });

  it('records the creation status', async () => {
    const { tx, history } = fakeRow('DRAFT');
    await asUser([], () =>
      workflow.record(tx, { table, entityId: 'r1', toStatus: 'DRAFT' }),
    );
    expect(history.create.mock.calls[0][0].data).toMatchObject({
      fromStatus: null,
      toStatus: 'DRAFT',
      event: 'CREATE',
      actorId: 'u1',
    });
  });

  it('assertAllowed refuses a forbidden event before any work', () => {
    expect(() =>
      workflow.assertAllowed(table, 'DRAFT', 'SUBMIT'),
    ).not.toThrow();
    expect(() => workflow.assertAllowed(table, 'APPROVED', 'SUBMIT')).toThrow(
      ConflictException,
    );
  });
});

describe('ActionStates', () => {
  it('disables a blocked action with its first reason, and leaves out the impossible', async () => {
    const states = await asUser(['request.read'], () => {
      const actions = new ActionStates<'submit' | 'approve' | 'delete'>()
        .add('submit', needsStatus(table, 'SUBMITTED', 'SUBMIT'))
        .add('approve', needsPermission('outgoing.approve'))
        .addIf(false, 'delete');
      return Promise.resolve(actions.all);
    });
    expect(states).toEqual([
      {
        action: 'submit',
        enabled: false,
        reason: ActionBlockReason.WRONG_STATUS,
        params: { status: 'SUBMITTED' },
      },
      {
        action: 'approve',
        enabled: false,
        reason: ActionBlockReason.NO_PERMISSION,
        params: { permission: 'outgoing.approve' },
      },
    ]);
  });
});
