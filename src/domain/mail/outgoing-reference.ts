import { BadRequestException } from '@nestjs/common';
import { CourrierDirection, Prisma } from '../../../generated/prisma/client';
import {
  formatReference,
  ReferenceCode,
  ReferenceModel,
  referencePeriod,
} from '../../referentials/effet-type/reference-model';

const CODE_LENGTH = 12;
const INITIALS_LENGTH = 4;

const project = { select: { name: true, reference: true } };
const contract = {
  select: { number: true, reference: true, project },
};
const sortantSelect = {
  direction: true,
  reference: true,
  type: { select: { id: true, referenceModel: true } },
  createdBy: { select: { name: true, siteId: true } },
  project,
  contract,
  dossier: {
    select: { siteId: true, number: true, project, contract },
  },
} satisfies Prisma.CourrierSelect;

type Sortant = Prisma.CourrierGetPayload<{ select: typeof sortantSelect }>;

function plain(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

function toCode(value: string) {
  return plain(value)
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

function initials(name: string) {
  return plain(name)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, INITIALS_LENGTH);
}

function required(code: string | undefined, what: string) {
  if (!code) {
    throw new BadRequestException(
      `La référence de cet effet a besoin ${what} : complétez-le avant de le soumettre`,
    );
  }
  return code;
}

function codeOf(code: ReferenceCode, sortant: Sortant) {
  const { dossier } = sortant;
  const contractOf = dossier?.contract ?? sortant.contract;
  switch (code) {
    case 'PROJECT': {
      const owner = dossier?.project ?? contractOf?.project ?? sortant.project;
      return required(
        owner ? toCode(owner.reference ?? owner.name) : undefined,
        "d'un projet",
      );
    }
    case 'RECORD': {
      const record =
        dossier?.number ?? contractOf?.reference ?? contractOf?.number;
      return required(
        record ? toCode(record) : undefined,
        "d'un dossier ou d'un contrat",
      );
    }
    case 'AUTHOR_INITIALS':
      return required(
        sortant.createdBy ? initials(sortant.createdBy.name) : undefined,
        "d'un auteur",
      );
  }
}

// SOR-AAAA-NNNNNN, for a type with no model: numbered per year by
// courrier_sequence.
async function legacyReference(tx: Prisma.TransactionClient, now: Date) {
  const year = now.getFullYear();
  const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "courrier_sequence" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "last" = "courrier_sequence"."last" + 1
    RETURNING "last"`;
  return `SOR-${year}-${String(last).padStart(6, '0')}`;
}

// One atomic increment, per type, site and period, in the caller's
// transaction. A changed model can bring an earlier reference back: those
// numbers are skipped.
async function modelReference(
  tx: Prisma.TransactionClient,
  typeId: string,
  model: ReferenceModel,
  sortant: Sortant,
  now: Date,
) {
  const siteId = sortant.dossier?.siteId ?? sortant.createdBy?.siteId ?? null;
  const codes = model.codes.map((code) => codeOf(code, sortant));
  const period = referencePeriod(model, now);
  const siteKey = siteId ?? 'NONE';
  for (;;) {
    const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO "effet_reference_sequence"
        ("effetTypeId", "siteKey", "period", "last")
      VALUES (${typeId}, ${siteKey}, ${period}, 1)
      ON CONFLICT ("effetTypeId", "siteKey", "period")
      DO UPDATE SET "last" = "effet_reference_sequence"."last" + 1
      RETURNING "last"`;
    const reference = formatReference(model, codes, now, last);
    const taken = await tx.courrier.findFirst({
      where: {
        reference,
        direction: CourrierDirection.SORTANT,
        OR: [
          ...(siteId ? [{ dossier: { siteId } }] : []),
          { dossierId: null, createdBy: { siteId } },
        ],
      },
      select: { id: true },
    });
    if (!taken) return reference;
  }
}

/**
 * The reference a sortant gets, or null if it has one already (it never
 * changes) or is an entrant (whose reference is the one printed on it).
 */
export async function newOutgoingReference(
  tx: Prisma.TransactionClient,
  courrierId: string,
  now: Date,
): Promise<string | null> {
  const sortant = await tx.courrier.findUnique({
    where: { id: courrierId },
    select: sortantSelect,
  });
  if (sortant?.direction !== CourrierDirection.SORTANT || sortant.reference) {
    return null;
  }
  const model = sortant.type?.referenceModel as ReferenceModel | null;
  return model && sortant.type
    ? modelReference(tx, sortant.type.id, model, sortant, now)
    : legacyReference(tx, now);
}
