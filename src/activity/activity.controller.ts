import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActivityService } from './activity.service';
import { FindActivityLogsQueryDto } from './dto/find-activity-logs.query.dto';
import { FindMyActivityQueryDto } from './dto/find-my-activity.query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { assertAdministers, RbacService } from '../auth/rbac/rbac.service';
import { JwtPayload } from '../auth/types/jwt-payload.type';

// Real read API for the Journal d'audit admin screen (RG-AUD-*).
// Note: only the request-level root log per authenticated, non-GET request
// (ActivityInterceptor) is populated today — domain services don't yet call
// activity.record() with entityType/entityId on individual business events
// (dossier.created, courrier.archived, etc.). That finer-grained
// instrumentation is a separate follow-up; this endpoint surfaces whatever
// has actually been recorded rather than fabricating richer data.
@ApiTags('activity-logs')
@ApiBearerAuth()
// Platform administrators (global AUDIT_READ) read everything; a site's
// responsible reads their site's journal — checked in auditScope.
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
    const scope = await this.rbac.administeredSites(
      user.sub,
      PermissionCode.AuditRead,
    );
    assertAdministers(scope);
    return scope;
  }
}
