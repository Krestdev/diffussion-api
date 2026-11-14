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
import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import { Permission } from '../auth/permissions';
import { AccessService } from '../auth/access/access.service';
import { forbidden } from '../auth/access/permissions.guard';
import { AuthUser } from '../auth/types/auth-user.type';

// The Journal d'audit (AU·1, RG-AUD-*): each entry belongs to its object's
// company (else its author's) and carries its author's IP.
@ApiTags('activity-logs')
@ApiBearerAuth()
// Platform administrators (global AUDIT_READ) read everything; a company's
// responsible, or whoever holds AUDIT_READ at a company, reads that company's
// journal — checked in auditScope.
@UseGuards(CoreAuthGuard)
@Controller('activity-logs')
export class ActivityController {
  constructor(
    private readonly activityService: ActivityService,
    private readonly access: AccessService,
  ) {}

  @Get()
  async findAll(
    @Query() query: FindActivityLogsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.activityService.findAll(query, await this.auditScope(user));
  }

  // Every page of the same filtered journal, as CSV. Declared before ':id'.
  @Get('export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Query() query: FindActivityLogsQueryDto,
    @CurrentUser() user: AuthUser,
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
  // deleted: the caller's companies' (every one for a platform administrator).
  @Get('archives')
  async archives(
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.activityService.archives(
      await this.auditScope(user),
      companyId,
    );
  }

  @Get('archives/:archiveId/download')
  async downloadArchive(
    @Param('archiveId', ParseUUIDPipe) archiveId: string,
    @CurrentUser() user: AuthUser,
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
    @CurrentUser() user: AuthUser,
  ) {
    return this.activityService.findMine(query, user.sub);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.activityService.findOne(id, await this.auditScope(user));
  }

  private async auditScope(user: AuthUser) {
    // The person's own company's journal, with audit.read.
    const scope = await this.access.scope(user.sub, Permission.AUDIT_READ);
    if (scope.length === 0) throw forbidden(Permission.AUDIT_READ);
    return scope;
  }
}
