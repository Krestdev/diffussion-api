import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  ProjectContentType,
  ProjectStatus,
} from '../../../generated/prisma/client';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';

/**
 * Canaux and correspondents belong to one company: only that company's effets use
 * them. Everyone sees their own company's only (permissions 2.0.0: a person acts
 * in their own company); `requestedCompanyId` naming another gives nothing.
 */
export async function companyReferentialsWhere(
  access: AccessService,
  _db: DatabaseService,
  userId: string,
  requestedCompanyId?: string,
): Promise<{ companyId?: string | { in: string[] } }> {
  const own = await access.companyOf(userId);
  if (!own || (requestedCompanyId && requestedCompanyId !== own)) {
    return { companyId: { in: [] } };
  }
  return { companyId: own };
}

// The company a new canal or correspondent goes to must exist.
export async function assertCompanyExists(
  db: DatabaseService,
  companyId: string,
) {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true },
  });
  if (!company) throw new NotFoundException(`Company ${companyId} not found`);
}

// An effet only uses its own company's canal. `companyId` null: an effet whose
// company is unknown (registered by a platform user, no dossier) — not checked.
export async function assertCanalOfCompany(
  db: DatabaseService,
  canalId: string,
  companyId: string | null,
) {
  const canal = await db.canal.findUnique({
    where: { id: canalId },
    select: { name: true, companyId: true, active: true },
  });
  if (!canal) throw new BadRequestException(`Canal ${canalId} not found`);
  if (!canal.active) {
    throw new BadRequestException(
      `The canal "${canal.name}" is inactive and can no longer be chosen`,
    );
  }
  if (companyId && canal.companyId !== companyId) {
    throw new BadRequestException(
      `The canal "${canal.name}" belongs to another company`,
    );
  }
  return canal;
}

// A project belongs to one company: its dossiers and effets are on that company.
// `companyId` null: an effet whose company is unknown — not checked.
export async function assertProjectOfCompany(
  db: DatabaseService,
  projectId: string,
  companyId: string | null,
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { name: true, companyId: true, status: true },
  });
  if (!project) throw new BadRequestException(`Project ${projectId} not found`);
  if (
    project.status === ProjectStatus.CLOSED ||
    project.status === ProjectStatus.ARCHIVED
  ) {
    throw new BadRequestException(
      `The project "${project.name}" is closed — nothing new can be added to it`,
    );
  }
  if (companyId && project.companyId !== companyId) {
    throw new BadRequestException(
      `The project "${project.name}" belongs to another company`,
    );
  }
  return project;
}

// A dossier outside any contract: refused in a project made of contracts.
export async function assertProjectTakesDossiers(
  db: DatabaseService,
  projectId: string,
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { name: true, contentType: true },
  });
  if (project?.contentType === ProjectContentType.CONTRATS) {
    throw new BadRequestException(
      `Le projet « ${project.name} » ne contient que des contrats : ce dossier doit être rattaché à l'un d'eux`,
    );
  }
}

// The caller's own company, for the visibility of per-company data (never null
// since permissions 2.0.0: nobody sees every company).
export async function ownCompanyFilter(
  access: AccessService,
  _db: DatabaseService,
  userId: string,
): Promise<{ companyId: string | { in: string[] } } | null> {
  return { companyId: (await access.companyOf(userId)) ?? { in: [] } };
}
