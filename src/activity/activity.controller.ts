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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RequirePermission } from '../auth/rbac/require-permission.decorator';

// Real read API for the Journal d'audit admin screen (RG-AUD-*).
// Note: only the request-level root log per authenticated, non-GET request
// (ActivityInterceptor) is populated today — domain services don't yet call
// activity.record() with entityType/entityId on individual business events
// (dossier.created, courrier.archived, etc.). That finer-grained
// instrumentation is a separate follow-up; this endpoint surfaces whatever
// has actually been recorded rather than fabricating richer data.
@ApiTags('activity-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('activity-logs')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  @RequirePermission(PermissionCode.AuditRead)
  findAll(@Query() query: FindActivityLogsQueryDto) {
    return this.activityService.findAll(query);
  }

  @Get(':id')
  @RequirePermission(PermissionCode.AuditRead)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.activityService.findOne(id);
  }
}
