import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CorrespondentStatus,
  Prisma,
  SiteStatus,
} from '../../../generated/prisma/client';

type Db = Prisma.TransactionClient;

// RG-SEC: an INACTIVE site is frozen for new activity — no new dossier on
// it (or moved onto it), no new courrier or circuit on its dossiers, no new
// user assignment to it. Existing data stays readable, and circuits already
// in progress can still be completed.
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
