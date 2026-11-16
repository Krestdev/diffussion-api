import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../cls.store';
import {
  CoreAccessEvent,
  CoreAccessSummary,
  CoreClient,
} from '../core/core-client';
import { ActivityService } from './activity.service';
import { AUDIT_TABS, AuditTab } from './audit-categories';
import { AuditExportDto, FindAccessFeedQueryDto } from './dto/audit-access.dto';
import { maskIp } from './mask-ip';

/** The actions that are a signature (« Signatures » of « Sur 7 jours »). */
const SIGNATURES = ['COURRIER_SIGNE', 'analysis-sheet.signed'];
/** The most events read from each source for one page of « Accès et sécurité ». */
const MAX_MERGED = 5000;
const DAY = 86_400_000;

/** One line of « Accès et sécurité » (as EXPENZO's). */
export interface AccessFeedItem {
  id: string;
  at: Date;
  /** SIGN_IN_SUCCESS… from the core, AUDIT (the core's action) or APP (Diffusion's own action). */
  kind: CoreAccessEvent['kind'] | 'APP';
  action: string | null;
  /** The person concerned: who signed in, or who made the change. */
  user: { id: string | null; name: string } | null;
  /** Who made the change, for an action. */
  actorName: string | null;
  /** What or whom the action was about (a role's name, a person…). */
  targetLabel: string | null;
  /** Wrong passwords in a row, the attempt included. */
  failures: number | null;
  userAgent: string | null;
  /** « Douala, CM »: Diffusion's own lines only (the core keeps no place). */
  location: string | null;
  /** Masked (41.202.•••.18) for people who may not see addresses. */
  ip: string | null;
  data: unknown;
}

/**
 * The Journal d'audit's figures and « Accès et sécurité » (as EXPENZO's DS V2
 * « Journal d'audit »): the week's figures and each tab's count; the core's
 * sign-ins, wrong passwords, locks, new devices and timed-out sessions merged
 * with Diffusion's own role and delegation changes; the core's access
 * figures and rules; and « Exporter le journal », itself written in the
 * journal. The core's lines need Diffusion's app key: without it, or when the
 * core is down, they are left out and `coreAvailable` is false.
 */
@Injectable()
export class AuditFeedService {
  private readonly logger = new Logger(AuditFeedService.name);

  constructor(
    private readonly activity: ActivityService,
    private readonly core: CoreClient,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /**
   * The company whose core events are read: the one asked (within those the
   * caller may audit), else the caller's own, else their only one.
   */
  tenantOf(companyIds: string[], asked?: string): string | null {
    if (asked && companyIds.includes(asked)) return asked;
    const own = this.cls.get('companyId');
    if (own && companyIds.includes(own)) return own;
    return companyIds.length === 1 ? companyIds[0] : null;
  }

  /** The core's access summary, or null when it can't be read. */
  private async coreSummary(
    tenantId: string | null,
  ): Promise<CoreAccessSummary | null> {
    if (!tenantId || !this.core.configured) return null;
    try {
      return await this.core.accessSummary(tenantId);
    } catch (error) {
      this.logger.warn(`access summary: ${String(error)}`);
      return null;
    }
  }

  /**
   * « Sur 7 jours »: events, settings and access changes, signatures and
   * failed sign-ins (null when the core can't tell); and each tab's count.
   */
  async summary(companyIds: string[], companyId?: string) {
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const scope = companyId ? { companyId } : {};
    const [events, settings, access, signatures, tabs, core] =
      await Promise.all([
        this.activity.count({ ...scope, from: since }, companyIds),
        this.activity.count(
          { ...scope, from: since, tab: 'SETTINGS' },
          companyIds,
        ),
        this.activity.count(
          { ...scope, from: since, tab: 'ACCESS' },
          companyIds,
        ),
        this.activity.count(
          { ...scope, from: since, action: SIGNATURES },
          companyIds,
        ),
        Promise.all(
          AUDIT_TABS.map(async (tab): Promise<[AuditTab, number]> => [
            tab,
            await this.activity.count({ ...scope, tab }, companyIds),
          ]),
        ),
        this.coreSummary(this.tenantOf(companyIds, companyId)),
      ]);
    return {
      events,
      settings: settings + access,
      signatures,
      failedSignIns: core?.failed ?? null,
      byTab: Object.fromEntries(tabs) as Record<AuditTab, number>,
    };
  }

  /**
   * « Accès et sécurité »: the core's events and Diffusion's access changes
   * (roles, delegations, who may open what), newest first. Both sources are
   * read up to the page asked, then merged.
   */
  async access(query: FindAccessFeedQueryDto, companyIds: string[]) {
    const skip = query.skip ?? 0;
    const take = query.take ?? 20;
    const wanted = Math.min(skip + take, MAX_MERGED);
    const tenantId = this.tenantOf(companyIds, query.companyId);
    const term = query.search?.trim() || undefined;
    // Diffusion's own lines are never failed sign-ins.
    const appApplies = !query.failed;
    const [core, app] = await Promise.all([
      tenantId && this.core.configured
        ? this.core
            .accessEvents(tenantId, {
              from: query.from,
              to: query.to,
              userId: query.userId,
              ip: query.ip,
              failed: query.failed ? 'true' : undefined,
              search: term,
              page: 1,
              pageSize: wanted,
            })
            .catch((error: unknown) => {
              this.logger.warn(`access events: ${String(error)}`);
              return null;
            })
        : Promise.resolve(null),
      appApplies
        ? this.activity.findAll(
            {
              tab: 'ACCESS',
              companyId: query.companyId,
              userId: query.userId,
              ip: query.ip,
              from: query.from,
              to: query.to,
              search: term,
              skip: 0,
              take: wanted,
            },
            companyIds,
          )
        : Promise.resolve(null),
    ]);
    const seesIp = this.activity.seesIp();
    const lines: AccessFeedItem[] = [
      ...(core?.items ?? []).map((e): AccessFeedItem => ({
        id: e.id,
        at: new Date(e.at),
        kind: e.kind,
        action: e.action,
        user: e.userName ? { id: e.userId, name: e.userName } : null,
        actorName: e.actorLabel,
        targetLabel: e.targetLabel,
        failures: e.failures,
        userAgent: e.userAgent,
        location: null,
        ip: seesIp ? e.ip : maskIp(e.ip),
        data: e.data,
      })),
      ...(app?.data ?? []).map((log): AccessFeedItem => ({
        id: log.id,
        at: log.createdAt,
        kind: 'APP',
        action: log.action,
        user: log.actor ? { id: log.actor.id, name: log.actor.name } : null,
        actorName: log.actor?.name ?? null,
        targetLabel: log.entityReference,
        failures: null,
        userAgent: log.userAgent,
        location: log.location,
        // Already masked by findAll when the viewer may not see addresses.
        ip: log.ip,
        data: log.metadata,
      })),
    ]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(skip, skip + take);
    return {
      data: lines,
      total: (core?.total ?? 0) + (app?.total ?? 0),
      skip,
      take,
      /** False when the core's events couldn't be read (no app key, or the core down). */
      coreAvailable: !!core,
    };
  }

  /**
   * « Accès et sécurité » figures (7 days), the people failing in a row now,
   * and the rules in force (« Règles d'accès en vigueur »).
   */
  async accessSummary(companyIds: string[], companyId?: string) {
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const scope = companyId ? { companyId } : {};
    const roleChanges = { ...scope, from: since, tab: 'ACCESS' as const };
    const [core, appRoleChanges, last] = await Promise.all([
      this.coreSummary(this.tenantOf(companyIds, companyId)),
      this.activity.count(roleChanges, companyIds),
      this.activity.findAll({ ...roleChanges, skip: 0, take: 1 }, companyIds),
    ]);
    const seesIp = this.activity.seesIp();
    return {
      coreAvailable: !!core,
      signIns: core?.signIns ?? null,
      activeUsers: core?.activeUsers ?? null,
      failed: core?.failed ?? null,
      failedUsers: core?.failedUsers ?? null,
      newDevices: core?.newDevices ?? null,
      roleChanges: (core?.roleChanges ?? 0) + appRoleChanges,
      lastRoleChangeBy: last.data[0]?.actor?.name ?? null,
      streaks: (core?.streaks ?? []).map((streak) => ({
        ...streak,
        ip: seesIp ? streak.ip : maskIp(streak.ip),
      })),
      rules: core ? { ...core.rules, ipMaskedForNonAdmins: true } : null,
      /** The viewer sees masked addresses. */
      ipMasked: !seesIp,
    };
  }

  /** « Exporter le journal »: the export is itself an entry of the journal. */
  async recordExport(dto: AuditExportDto): Promise<void> {
    await this.activity.record({
      action: 'audit.exported',
      entityType: 'audit-log',
      metadata: {
        format: dto.format,
        from: dto.from,
        to: dto.to,
        count: dto.count,
        filters: dto.filters ?? null,
        details: !!dto.details,
        fingerprint: !!dto.fingerprint,
        maskIp: !!dto.maskIp,
      },
    });
  }
}
