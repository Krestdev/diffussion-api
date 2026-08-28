import { Controller, Get, Param, Query } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { DatabaseService } from '../database/database.service';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../cls.store';

/**
 * Test controller for verifying the activity-log parent-child traceability.
 * Remove or guard behind a feature flag before going to production.
 */
@Controller('activity-test')
export class ActivityTestController {
  constructor(
    private readonly activity: ActivityService,
    private readonly db: DatabaseService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * Simulates a user action that triggers two system sub-actions.
   *
   * Expected log tree:
   *   ROOT  – "GET /activity-test/user-action"  (created by the interceptor)
   *     ├── CHILD 1 – "document.created"         (user-level action)
   *     ├── CHILD 2 – "notification.sent"         (system sub-action)
   *     └── CHILD 3 – "search-index.updated"      (system sub-action)
   */
  @Get('user-action')
  async simulateUserAction() {
    // 1. User creates a document
    const docLogId = await this.activity.record({
      action: 'document.created',
      source: 'USER',
      entityType: 'document',
      entityId: 'doc-fake-001',
      message: 'User created a new document',
      changes: {
        label: [null, 'Test Document'],
        status: [null, 'ACTIVE'],
      },
    });

    // 2. System sends a notification (triggered by the document creation)
    const notifLogId = await this.activity.record({
      action: 'notification.sent',
      source: 'SYSTEM',
      entityType: 'notification',
      entityId: 'notif-fake-001',
      message: 'System sent notification for new document',
      metadata: { channel: 'EMAIL', recipientCount: 3 },
    });

    // 2a. System encounters a warning while sending notification (GRANDCHILD log)
    // We capture the root ID, override it to be the notification log ID for a moment, then restore it
    const rootId = this.cls.get('parentLogId');
    this.cls.set('parentLogId', notifLogId);

    // Logged as a grandchild of the root (nested under notifLogId above);
    // its own id isn't needed by anything past this point.
    await this.activity.record({
      action: 'notification.warning',
      source: 'SYSTEM',
      level: 'warn',
      message: 'SMTP server responded slowly while sending email',
    });

    // Restore the root log ID for the next sibling
    this.cls.set('parentLogId', rootId);

    // 3. System updates the search index
    const indexLogId = await this.activity.record({
      action: 'search-index.updated',
      source: 'SYSTEM',
      entityType: 'search-index',
      message: 'Search index updated after document creation',
    });

    return {
      message: 'Simulated user action with 3 child logs under the root',
      childLogIds: {
        documentLog: docLogId,
        notificationLog: notifLogId,
        searchIndexLog: indexLogId,
      },
      hint: 'Use GET /activity-test/trace/<any-child-id-or-root-id> to see the tree',
    };
  }

  /**
   * Simulates a system action that logs a warning and an error.
   *
   * Expected log tree:
   *   ROOT  – "GET /activity-test/system-error"   (created by the interceptor)
   *     ├── CHILD 1 – "system.disk-check"           (normal system log)
   *     └── CHILD 2 – "system.disk-check.failed"    (error log with stack)
   */
  @Get('system-error')
  async simulateSystemError() {
    const checkLogId = await this.activity.record({
      action: 'system.disk-check',
      source: 'SYSTEM',
      message: 'Running scheduled disk space check',
    });

    const errorLogId = await this.activity.record({
      action: 'system.disk-check.failed',
      source: 'SYSTEM',
      level: 'error',
      message: 'Disk space critically low on /dev/sda1',
      stack: new Error('Disk space below 5%').stack,
      metadata: { diskUsage: '97%', threshold: '95%' },
    });

    return {
      message: 'Simulated system error with child logs under the root',
      childLogIds: {
        checkLog: checkLogId,
        errorLog: errorLogId,
      },
    };
  }

  /**
   * Retrieves the full log tree for a given log ID.
   * If the ID is a child, it walks up to the root first, then returns
   * the entire tree from root down.
   */
  @Get('trace/:logId')
  async traceLog(
    @Param('logId') logId: string,
    @Query('depth') depth: 'surface' | 'deep' = 'deep',
  ) {
    // Find the target log
    const target = await this.db.activityLog.findUnique({
      where: { id: logId },
    });

    if (!target) {
      return { error: `Log ${logId} not found` };
    }

    // Walk up to the root
    let rootId = target.id;
    let current = target;
    while (current.parentLogId) {
      const parent = await this.db.activityLog.findUnique({
        where: { id: current.parentLogId },
      });
      if (!parent) break;
      rootId = parent.id;
      current = parent;
    }

    // Determine include depth
    const childrenInclude =
      depth === 'surface'
        ? false
        : {
            include: { children: true },
            orderBy: { createdAt: 'asc' },
          };

    // Fetch the tree from root down
    const tree = await this.db.activityLog.findUnique({
      where: { id: rootId },
      include: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- scratch/test endpoint (see file header); `children` include is conditionally shaped and not worth a full Prisma generic here.
        children: childrenInclude as any,
      },
    });

    return {
      rootId,
      targetId: logId,
      tree,
    };
  }
}
