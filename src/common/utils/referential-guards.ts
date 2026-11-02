import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CorrespondentStatus,
  Prisma,
  SiteStatus,
} from '../../../generated/prisma/client';
import { createWithUniqueReference } from './generate-reference';

type Db = Prisma.TransactionClient;

// RG-SEC: an INACTIVE site is frozen for new activity — no new dossier on
// it (or moved onto it), no new courrier on its dossiers, no new user
// assignment to it. Existing data stays readable.
export async function assertSiteActive(db: Db, siteId: string) {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { name: true, status: true },
  });
  if (!site) {
    throw new NotFoundException(`Site ${siteId} not found`);
  }
  if (site.status !== SiteStatus.ACTIVE) {
    throw new BadRequestException(
      `Site "${site.name}" is inactive — no new activity can be recorded on it`,
    );
  }
}

export async function assertCorrespondentActive(
  db: Db,
  correspondentId: string,
) {
  const correspondent = await db.correspondent.findUnique({
    where: { id: correspondentId },
    select: { name: true, status: true },
  });
  if (!correspondent) {
    throw new NotFoundException(`Correspondent ${correspondentId} not found`);
  }
  if (correspondent.status !== CorrespondentStatus.ACTIVE) {
    throw new BadRequestException(
      `Correspondent "${correspondent.name}" is inactive and cannot be used on a new courrier`,
    );
  }
}

// A correspondent given by name (e.g. a project's maître d'ouvrage typed in
// a form): the existing one with that name, whatever its case, else a new
// one. Returns its id.
export async function findOrCreateCorrespondent(db: Db, name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new BadRequestException('A correspondent name cannot be empty');
  }
  const existing = await db.correspondent.findFirst({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
    select: { id: true, name: true, status: true },
  });
  if (existing) {
    if (existing.status !== CorrespondentStatus.ACTIVE) {
      throw new BadRequestException(
        `Correspondent "${existing.name}" is inactive`,
      );
    }
    return existing.id;
  }
  const created = await createWithUniqueReference('CP', (code) =>
    db.correspondent.create({
      data: { name: trimmed, code },
      select: { id: true },
    }),
  );
  return created.id;
}
