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

// `siteId`: the site of the effet it is used on — a correspondent belongs
// to one site and only serves that site's effets. Omitted (a project's
// maître d'ouvrage, a contract's client) or null (an effet whose site is
// unknown): not checked.
export async function assertCorrespondentActive(
  db: Db,
  correspondentId: string,
  siteId?: string | null,
) {
  const correspondent = await db.correspondent.findUnique({
    where: { id: correspondentId },
    select: { name: true, status: true, siteId: true },
  });
  if (!correspondent) {
    throw new NotFoundException(`Correspondent ${correspondentId} not found`);
  }
  if (siteId && correspondent.siteId !== siteId) {
    throw new BadRequestException(
      `Correspondent "${correspondent.name}" belongs to another site`,
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
// `siteId` first — else a new one on `siteId`. Returns its id.
export async function findOrCreateCorrespondent(
  db: Db,
  name: string,
  siteId: string | null,
) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new BadRequestException('A correspondent name cannot be empty');
  }
  const matches = await db.correspondent.findMany({
    where: { name: { equals: trimmed, mode: 'insensitive' } },
    select: { id: true, name: true, status: true, siteId: true },
  });
  const existing =
    matches.find((match) => match.siteId === siteId) ?? matches[0];
  if (existing) {
    if (existing.status !== CorrespondentStatus.ACTIVE) {
      throw new BadRequestException(
        `Correspondent "${existing.name}" is inactive`,
      );
    }
    return existing.id;
  }
  if (!siteId) {
    throw new BadRequestException(
      `No correspondent named "${trimmed}" yet, and no site to create it on — pick an existing one, or name the project's responsible first`,
    );
  }
  const created = await createWithUniqueReference('CP', (code) =>
    db.correspondent.create({
      data: { name: trimmed, code, siteId },
      select: { id: true },
    }),
  );
  return created.id;
}
