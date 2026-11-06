import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ActivityService } from './activity.service';
import { FindActivityLogsQueryDto } from './dto/find-activity-logs.query.dto';
import { FindMyActivityQueryDto } from './dto/find-my-activity.query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { assertAdministers, RbacService } from '../auth/rbac/rbac.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';

// The Journal d'audit (AU·1, RG-AUD-*): each entry belongs to its object's
// site (else its author's) and carries its author's IP.
@ApiTags('activity-logs')
@ApiBearerAuth()
// Platform administrators (global AUDIT_READ) read everything; a site's
// responsible, or whoever holds AUDIT_READ at a site, reads that site's
// journal — checked in auditScope.
@UseGuards(JwtAuthGuard)
@Controller('activity-logs')
export class ActivityController {
  constructor(
    private readonly activityService: ActivityService,
    private readonly rbac: RbacService,
  ) {}

  @Get()
  async findAll(
    @Query() query: FindActivityLogsQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.activityService.findAll(query, await this.auditScope(user));
  }

  // Every page of the same filtered journal, as CSV. Declared before ':id'.
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Query() query: FindActivityLogsQueryDto,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const csv = await this.activityService.exportCsv(
      query,
      await this.auditScope(user),
    );
    const day = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="journal-audit-${day}.csv"`,
    );
    res.send(csv);
  }

  // PA·8 — the batches past retention, exported as CSV before being
  // deleted: the caller's sites' (every one for a platform administrator).
  @Get('archives')
  async archives(
    @Query('siteId') siteId: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.activityService.archives(await this.auditScope(user), siteId);
  }

  @Get('archives/:archiveId/download')
  async downloadArchive(
    @Param('archiveId', ParseUUIDPipe) archiveId: string,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const file = await this.activityService.archiveFile(
      archiveId,
      await this.auditScope(user),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    file.body.pipe(res);
  }

  // The caller's own history, readable by every signed-in user: their
  // actions, and what was done on their effets, instructions and fiches.
  // Declared before ':id'.
  @Get('me')
  findMine(
    @Query() query: FindMyActivityQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.activityService.findMine(query, user.sub);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.activityService.findOne(id, await this.auditScope(user));
  }

  private async auditScope(user: JwtPayload) {
    const scope = await this.rbac.managedSites(
      user.sub,
      PermissionCode.AuditRead,
    );
    assertAdministers(scope);
    return scope;
  }
}
