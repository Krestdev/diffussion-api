import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectStatus } from '../../../generated/prisma/client';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';

/**
 * Canaux and correspondents belong to one site: only that site's effets use
 * them. A platform administrator (ADMIN_MANAGE_REFERENTIALS, held globally)
 * sees and manages every site's; anyone else sees their own site's only.
 */
export async function siteReferentialsWhere(
  rbac: RbacService,
  db: DatabaseService,
  userId: string,
  requestedSiteId?: string,
): Promise<{ siteId?: string | { in: string[] } }> {
  if (
    await rbac.hasGlobalPermission(
      userId,
      PermissionCode.AdminManageReferentials,
    )
  ) {
    return requestedSiteId ? { siteId: requestedSiteId } : {};
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { siteId: true },
  });
  const own = user?.siteId;
  if (!own || (requestedSiteId && requestedSiteId !== own)) {
    return { siteId: { in: [] } };
  }
  return { siteId: own };
}

// The site a new canal or correspondent goes to must exist.
export async function assertSiteExists(db: DatabaseService, siteId: string) {
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { id: true },
  });
  if (!site) throw new NotFoundException(`Site ${siteId} not found`);
}

// An effet only uses its own site's canal. `siteId` null: an effet whose
// site is unknown (registered by a platform user, no dossier) — not checked.
export async function assertCanalOfSite(
  db: DatabaseService,
  canalId: string,
  siteId: string | null,
) {
  const canal = await db.canal.findUnique({
    where: { id: canalId },
    select: { name: true, siteId: true, active: true },
  });
  if (!canal) throw new BadRequestException(`Canal ${canalId} not found`);
  if (!canal.active) {
    throw new BadRequestException(
      `The canal "${canal.name}" is inactive and can no longer be chosen`,
    );
  }
  if (siteId && canal.siteId !== siteId) {
    throw new BadRequestException(
      `The canal "${canal.name}" belongs to another site`,
    );
  }
  return canal;
}

// A project belongs to one site: its dossiers and effets are on that site.
// `siteId` null: an effet whose site is unknown — not checked.
export async function assertProjectOfSite(
  db: DatabaseService,
  projectId: string,
  siteId: string | null,
) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { name: true, siteId: true, status: true },
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
  if (siteId && project.siteId !== siteId) {
    throw new BadRequestException(
      `The project "${project.name}" belongs to another site`,
    );
  }
  return project;
}

// The caller's own site, for the visibility of per-site data: null for a
// platform administrator (sees every site) — see siteReferentialsWhere.
export async function ownSiteFilter(
  rbac: RbacService,
  db: DatabaseService,
  userId: string,
): Promise<{ siteId: string | { in: string[] } } | null> {
  if (
    await rbac.hasGlobalPermission(
      userId,
      PermissionCode.AdminManageReferentials,
    )
  ) {
    return null;
  }
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { siteId: true },
  });
  return { siteId: user?.siteId ?? { in: [] } };
}
