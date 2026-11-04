import { ForbiddenException, Injectable } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

// The settings live in a single row.
const SETTINGS_ID = 1;

/** The platform's settings, shared by every site. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    private readonly activity: ActivityService,
  ) {}

  // The defaults until an administrator changes them.
  async get() {
    const settings = await this.database.appSettings.findUnique({
      where: { id: SETTINGS_ID },
      select: { maxActiveInstructionsPerAgent: true, updatedAt: true },
    });
    return settings ?? { maxActiveInstructionsPerAgent: null, updatedAt: null };
  }

  // Organisation-wide: only a platform administrator (global grant).
  async update(dto: UpdateSettingsDto, userId: string) {
    const allowed = await this.rbac.hasGlobalPermission(
      userId,
      PermissionCode.AdminManageSettings,
    );
    if (!allowed) {
      throw new ForbiddenException(
        'Reserved to platform administrators: ADMIN_MANAGE_SETTINGS',
      );
    }
    await this.database.appSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...dto },
      update: dto,
    });
    await this.activity
      .tryRecord({
        action: 'settings.updated',
        entityType: 'settings',
        entityId: String(SETTINGS_ID),
        metadata: { ...dto },
      })
      .catch(() => undefined);
    return this.get();
  }
}
