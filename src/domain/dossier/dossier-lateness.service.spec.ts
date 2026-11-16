import { DossierStatus } from '../../../generated/prisma/client';
import { WorkflowService } from '../../workflow/workflow.service';
import { DossierLatenessService } from './dossier-lateness.service';

describe('DossierLatenessService', () => {
  it('marks each overdue dossier LATE through the engine, as the system', async () => {
    const database = {
      dossier: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd-1', status: DossierStatus.OPEN, companyId: 's-1' },
          { id: 'd-2', status: DossierStatus.IN_PROGRESS, companyId: 's-2' },
        ]),
        // d-2 moved in the meantime: skipped, the sweep goes on.
        updateMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 0 }),
      },
      statusHistory: { create: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(database)),
    };
    const service = new DossierLatenessService(
      database as never,
      new WorkflowService(),
    );

    await service.sweep();

    expect(database.dossier.updateMany).toHaveBeenCalledWith({
      where: { id: 'd-1', status: DossierStatus.OPEN },
      data: { status: DossierStatus.LATE },
    });
    expect(database.statusHistory.create).toHaveBeenCalledTimes(1);
    expect(database.statusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity: 'Dossier',
        entityId: 'd-1',
        event: 'MARK_LATE',
        companyId: 's-1',
        actorId: null,
      }),
    });
  });
});
