import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppAdmin } from '../../auth/access/decorators';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AppAdminGuard } from '../../auth/guards/app-admin.guard';
import { AuthUser } from '../../auth/types/auth-user.type';
import { DatabaseService } from '../../database/database.service';
import { COURRIER_DONE } from './project-cascade';

/** Contract C8, app-admin side: how Diffusion uses the company's projects. */
export interface ProjectUsage {
  /** Projects are optional on Diffusion's effets, dossiers and contracts. */
  uses: 'REQUIRED' | 'OPTIONAL' | 'UNUSED';
  /** What is counted: effets (the core's console says « courriers rattachés »). */
  unit: 'mails';
  /** Per project: the effets citing it (directly, or through a dossier or a contract of it) and
   * those still open. */
  items: { projectId: string; count: number; open: number }[];
}

/**
 * Contract C8 (projects), app-admin side, as EXPENZO's: the core's console shows, for each of the
 * company's projects, how many of Diffusion's effets cite it and how many are still open, and
 * refuses to delete a project still cited (PROJECT_IN_USE). Only core-signed app-admin tokens
 * (AppAdminGuard), for the token's company.
 */
@ApiTags('app-admin')
@ApiBearerAuth()
@AppAdmin()
@UseGuards(AppAdminGuard)
@Controller('app-admin/projects')
export class ProjectUsageController {
  constructor(private readonly database: DatabaseService) {}

  @Get('usage')
  async usage(@CurrentUser() user: AuthUser): Promise<ProjectUsage> {
    const done = COURRIER_DONE.map(String);
    const rows = await this.database.$queryRaw<
      { projectId: string; count: number; open: number }[]
    >`
      SELECT x."projectId",
             COUNT(*)::int AS "count",
             (COUNT(*) FILTER (WHERE NOT (x."status" = ANY(${done}))))::int AS "open"
        FROM (
          SELECT COALESCE(c."projectId", d."projectId", dk."projectId", k."projectId") AS "projectId",
                 c."status"::text AS "status"
            FROM "courrier" c
            LEFT JOIN "dossier" d ON d."id" = c."dossierId"
            LEFT JOIN "contract" dk ON dk."id" = d."contractId"
            LEFT JOIN "contract" k ON k."id" = c."contractId"
        ) x
        JOIN "project" p ON p."id" = x."projectId"
       WHERE p."companyId" = ${user.companyId}
       GROUP BY x."projectId"
       ORDER BY x."projectId"`;
    return {
      uses: 'OPTIONAL',
      unit: 'mails',
      items: rows.map((row) => ({
        projectId: row.projectId,
        count: Number(row.count),
        open: Number(row.open),
      })),
    };
  }
}
