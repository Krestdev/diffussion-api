import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/access/decorators';
import { PermissionsGuard } from '../auth/access/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import { Permission } from '../auth/permissions';
import { AuthUser } from '../auth/types/auth-user.type';
import { visibleProjectWhere } from '../common/utils/referential-access';
import { DatabaseService } from '../database/database.service';
import { MailService } from '../domain/mail/mail.service';

/** How many effets the tab lists (the newest). */
const TAB_SIZE = 50;

/** One effet in the core's project tab (unit "mails": reference, subject, party, date, status). */
export interface ProjectTabItem {
  id: string;
  reference: string;
  title: string;
  /** The correspondent (sender of an entrant, addressee of a sortant). */
  person: string | null;
  /** Received (entrant) or sent (sortant), else registered. */
  date: string | null;
  status: string;
  direction: 'ENTRANT' | 'SORTANT';
  /** The effet's page in Diffusion (the core prefixes Diffusion's address). */
  href: string;
}

/**
 * Contract C8, the person's side: Diffusion's tab of a project in the core's « Projets » (DS V2
 * 8074:17754), with the person's own rights here — the effets citing the project (directly, or
 * through a dossier or a contract of it) that they may see, as on the entrants / sortants lists.
 * A project they may not open answers 403 (the core shows no tab).
 */
@ApiTags('portal')
@ApiBearerAuth()
@UseGuards(CoreAuthGuard, PermissionsGuard)
@Controller('portal/projects')
export class ProjectPortalController {
  constructor(
    private readonly database: DatabaseService,
    private readonly mail: MailService,
  ) {}

  @Get(':id')
  @RequirePermissions(Permission.PROJECT_READ)
  async project(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    const project = await this.database.project.findFirst({
      where: { id, companyId: user.companyId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    const visible = await this.database.project.count({
      where: { id, ...visibleProjectWhere(user.sub) },
    });
    if (!visible) {
      throw new ForbiddenException('This project is restricted to others');
    }
    const page = await this.mail.findAll(
      { projectId: id, skip: 0, take: TAB_SIZE },
      user.sub,
    );
    const items: ProjectTabItem[] = page.data.map((effet) => {
      const direction = effet.direction;
      const date =
        (direction === 'ENTRANT' ? effet.receivedAt : effet.sentAt) ??
        effet.createdAt;
      return {
        id: effet.id,
        reference: effet.number,
        title: effet.subject,
        person: effet.correspondent?.name ?? null,
        date: date ? new Date(date).toISOString() : null,
        status: effet.status,
        direction,
        href: `/dashboard/${direction === 'SORTANT' ? 'outgoing' : 'incoming'}/${effet.id}`,
      };
    });
    return {
      unit: 'mails' as const,
      count: page.total,
      // No money figures in Diffusion: the core shows no amount tiles.
      currency: null,
      committed: null,
      paid: null,
      items,
    };
  }
}
