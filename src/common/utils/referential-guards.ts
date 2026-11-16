import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CorrespondentStatus,
  Prisma,
  CompanyStatus,
} from '../../generated/prisma/client';
import { createWithUniqueReference } from './generate-reference';

type Db = Prisma.TransactionClient;

// RG-SEC: an INACTIVE company is frozen for new activity — no new dossier on
// it (or moved onto it), no new courrier on its dossiers, no new user
// assignment to it. Existing data stays readable.
export async function assertCompanyActive(db: Db, companyId: string) {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { name: true, status: true },
  });
  if (!company) {
    throw new NotFoundException(`Company ${companyId} not found`);
  }
  if (company.status !== CompanyStatus.ACTIVE) {
    throw new BadRequestException(
      `Company "${company.name}" is inactive — no new activity can be recorded on it`,
    );
  }
}

// `companyId`: the company of the effet it is used on — a correspondent belongs
// to one company and only serves that company's effets. Omitted (a project's
// maître d'ouvrage, a contract's client) or null (an effet whose company is
// unknown): not checked.
export async function assertCorrespondentActive(
  db: Db,
  correspondentId: string,
  companyId?: string | null,
) {
  const correspondent = await db.correspondent.findUnique({
    where: { id: correspondentId },
    select: { name: true, status: true, companyId: true },
  });
  if (!correspondent) {
    throw new NotFoundException(`Correspondent ${correspondentId} not found`);
  }
  if (companyId && correspondent.companyId !== companyId) {
    throw new BadRequestException(
      `Correspondent "${correspondent.name}" belongs to another company`,
    );
  }
  if (correspondent.status !== CorrespondentStatus.ACTIVE) {
    throw new BadRequestException(
      `Correspondent "${correspondent.name}" is inactive and cannot be used on a new courrier`,
    );
  }
}

// A correspondent given by name (e.g. a project's maître d'ouvrage typed in
// a form): the existing one with that name, whatever its case — that of
// `companyId` first — else a new one on `companyId`. Returns its id.
export async function findOrCreateCorrespondent(
  db: Db,
  name: string,
  companyId: string | null,
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new BadRequestException('A correspondent name cannot be empty');
  }
  const matches = await db.correspondent.findMany({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
    select: { id: true, name: true, status: true, companyId: true },
  });
  const existing =
    matches.find((match) => match.companyId === companyId) ?? matches[0];
  if (existing) {
    if (existing.status !== CorrespondentStatus.ACTIVE) {
      throw new BadRequestException(
        `Correspondent "${existing.name}" is inactive`,
      );
    }
    return existing.id;
  }
  if (!companyId) {
    throw new BadRequestException(
      `No correspondent named "${trimmed}" yet, and no company to create it on — pick an existing one, or name the project's responsible first`,
    );
  }
  const created = await createWithUniqueReference('CP', (code) =>
    db.correspondent.create({
      data: { name: trimmed, code, companyId },
      select: { id: true },
    }),
  );
  return created.id;
}
