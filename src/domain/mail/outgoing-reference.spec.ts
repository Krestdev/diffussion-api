import { BadRequestException } from '@nestjs/common';
import { CourrierDirection, Prisma } from '../../../generated/prisma/client';
import { ReferenceModel } from '../../referentials/effet-type/reference-model';
import { newOutgoingReference } from './outgoing-reference';

const NOW = new Date(2026, 10, 9);

const model = (over: Partial<ReferenceModel> = {}): ReferenceModel => ({
  prefix: 'LET',
  separator: '-',
  counterDigits: 6,
  counterReset: 'YEARLY',
  yearDigits: 4,
  monthIncluded: false,
  codes: [],
  ...over,
});

describe('newOutgoingReference', () => {
  let tx: {
    courrier: { findUnique: jest.Mock; findFirst: jest.Mock };
    $queryRaw: jest.Mock;
  };

  const sortant = (over: Record<string, unknown> = {}) => ({
    direction: CourrierDirection.SORTANT,
    reference: null,
    type: { id: 't-1', referenceModel: model() },
    createdBy: { name: 'Éric Mbarga Nkoa', siteId: 's-1' },
    project: null,
    contract: null,
    dossier: null,
    ...over,
  });

  const generate = (value: ReturnType<typeof sortant>, last = 125) => {
    tx.courrier.findUnique.mockResolvedValue(value);
    tx.$queryRaw.mockResolvedValue([{ last }]);
    return newOutgoingReference(
      tx as unknown as Prisma.TransactionClient,
      'c-1',
      NOW,
    );
  };

  beforeEach(() => {
    tx = {
      courrier: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $queryRaw: jest.fn(),
    };
  });

  it.each<[string, Partial<ReferenceModel>, number, string]>([
    ['prefix, year, counter', {}, 125, 'LET-2026-000125'],
    [
      'two-digit year and month',
      {
        prefix: 'FAC',
        counterDigits: 4,
        yearDigits: 2,
        monthIncluded: true,
        counterReset: 'MONTHLY',
      },
      125,
      'FAC-26-11-0125',
    ],
    [
      'no year',
      { prefix: 'SIT', counterDigits: 4, yearDigits: 0, counterReset: 'NEVER' },
      125,
      'SIT-0125',
    ],
    ['another separator', { separator: '/' }, 125, 'LET/2026/000125'],
    ['a counter past its digits', { counterDigits: 3 }, 1000, 'LET-2026-1000'],
  ])('builds %s', async (_label, over, last, expected) => {
    await expect(
      generate(
        sortant({ type: { id: 't-1', referenceModel: model(over) } }),
        last,
      ),
    ).resolves.toBe(expected);
  });

  it('prints the codes in order, cleaned', async () => {
    await expect(
      generate(
        sortant({
          type: {
            id: 't-1',
            referenceModel: model({
              codes: ['PROJECT', 'RECORD', 'AUTHOR_INITIALS'],
            }),
          },
          dossier: {
            siteId: 's-1',
            number: 'D-453014',
            project: { name: 'Route de Kribi', reference: null },
            contract: null,
          },
        }),
      ),
    ).resolves.toBe('LET-ROUTEDEKRIBI-D453014-EMN-2026-000125');
  });

  it('refuses a code it has nothing to fill with', async () => {
    await expect(
      generate(
        sortant({
          type: {
            id: 't-1',
            referenceModel: model({ codes: ['PROJECT'] }),
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips a number that would repeat a reference of the site', async () => {
    tx.courrier.findUnique.mockResolvedValue(sortant());
    tx.$queryRaw
      .mockResolvedValueOnce([{ last: 1 }])
      .mockResolvedValueOnce([{ last: 2 }]);
    tx.courrier.findFirst.mockResolvedValueOnce({ id: 'other' });

    await expect(
      newOutgoingReference(
        tx as unknown as Prisma.TransactionClient,
        'c-1',
        NOW,
      ),
    ).resolves.toBe('LET-2026-000002');
  });

  it('falls back on SOR-AAAA-NNNNNN for a type with no model', async () => {
    await expect(
      generate(sortant({ type: { id: 't-1', referenceModel: null } }), 9),
    ).resolves.toBe('SOR-2026-000009');
  });

  it('never gives a second reference', async () => {
    await expect(
      generate(sortant({ reference: 'LET-2026-000001' })),
    ).resolves.toBeNull();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('leaves entrants alone', async () => {
    await expect(
      generate(sortant({ direction: CourrierDirection.ENTRANT })),
    ).resolves.toBeNull();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
