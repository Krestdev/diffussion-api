import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  AccessProfile,
  Prisma,
  SiteStatus,
  UserStatus,
} from '../../generated/prisma/client';
import { generateReference } from '../common/utils/generate-reference';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { setUpSite, siteAdminRoleId } from '../referentials/site/site.service';
import { CoreClient, CoreDirectory } from './core-client';

/** Serialises syncs across instances (pg advisory lock id). */
const SYNC_LOCK = 4_000_701;
/** A sync asked for an unknown user waits at least this long after the previous one. */
const ON_DEMAND_GAP_MS = 5_000;

type Tx = Prisma.TransactionClient;

/** A person as the core describes them (directory entry or session-store record). */
export interface CorePerson {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  jobTitle?: string | null;
  status: 'INVITED' | 'ACTIVE' | 'DEACTIVATED';
  tenantAdmin: boolean;
  lastSignInAt?: string | null;
}

/** A company of the core: a Diffusion site. */
export interface CoreCompany {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

export interface SyncResult {
  /** False when the directory hadn't changed (or no key is configured). */
  applied: boolean;
  companies: number;
  users: number;
}

/**
 * Keeps Diffusion's sites and people equal to the core's companies and users (a site IS a company
 * of the core, same id). The core is their source of truth: a site's name and status, a person's
 * name, email, phone, job title, status and company are written here only. Every
 * CORE_SYNC_SECONDS, and at once when a token names a person Diffusion doesn't know yet. Nothing
 * is deleted: companies and people the core no longer lists are deactivated / suspended.
 *
 * Sites and accounts made in Diffusion before it moved onto the core are matched to the core's
 * (sites: CORE_SITE_LINKS, else the same name; people: the same email) and take the core's id
 * (every foreign key to "site" and "user" cascades on update).
 *
 * Roles stay Diffusion's own: a new site gets the default roles; a company administrator with no
 * role yet gets the site's Admin role, and becomes the site's responsible if it has none.
 */
@Injectable()
export class DirectorySyncService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DirectorySyncService.name);
  private version: string | undefined;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<SyncResult> | null = null;
  private lastRun = 0;
  /** Bumped after each applied directory: caches keyed on people are dropped. */
  generation = 0;

  constructor(
    private readonly database: DatabaseService,
    private readonly core: CoreClient,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.core.configured) {
      this.logger.warn(
        'CORE_APP_KEY is not set: companies and users are not synced from the core (people are copied from the session store at their first request)',
      );
      return;
    }
    if (this.config.get('NODE_ENV') === 'test') return;
    const every = this.config.get('CORE_SYNC_SECONDS') * 1000;
    void this.sync().catch(() => undefined);
    this.timer = setInterval(
      () => void this.sync().catch(() => undefined),
      every,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** For a token naming an unknown person: one sync, unless one ran a moment ago. */
  async syncSoon(): Promise<void> {
    if (!this.core.configured) return;
    if (this.running) {
      await this.running.catch(() => undefined);
      return;
    }
    if (Date.now() - this.lastRun < ON_DEMAND_GAP_MS) return;
    await this.sync().catch(() => undefined);
  }

  /** Reads the directory and applies it when it changed. One at a time. */
  sync(): Promise<SyncResult> {
    this.running ??= (async () => {
      try {
        const directory = await this.core.directory(this.version);
        if (!directory) return { applied: false, companies: 0, users: 0 };
        const result = await this.apply(directory);
        this.version = directory.version;
        return result;
      } catch (error) {
        this.logger.warn(
          `directory sync failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      } finally {
        this.lastRun = Date.now();
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Applies a whole directory in one transaction (also used by the tests). */
  async apply(directory: CoreDirectory): Promise<SyncResult> {
    const now = new Date();
    const links = this.config.get('CORE_SITE_LINKS');
    await this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK})`;
        for (const tenant of directory.tenants) {
          await upsertSite(tx, tenant, now, links, this.logger);
          for (const person of tenant.users) {
            await upsertPerson(tx, tenant.id, person, now, this.logger);
          }
          // People the core no longer lists for this company: suspended.
          await tx.user.updateMany({
            where: {
              siteId: tenant.id,
              coreSyncedAt: { not: null },
              id: { notIn: tenant.users.map((u) => u.id) },
              status: UserStatus.ACTIVE,
            },
            data: { status: UserStatus.SUSPENDED, deactivatedAt: now },
          });
          await setUpAdmins(
            tx,
            tenant.id,
            tenant.users
              .filter((u) => u.tenantAdmin && u.status === 'ACTIVE')
              .map((u) => u.id),
          );
        }
        // Companies the core no longer entitles to Diffusion: deactivated, data kept.
        const gone = await tx.site.updateMany({
          where: {
            coreSyncedAt: { not: null },
            id: { notIn: directory.tenants.map((t) => t.id) },
            status: SiteStatus.ACTIVE,
          },
          data: { status: SiteStatus.INACTIVE },
        });
        if (gone.count > 0) {
          this.logger.warn(
            `${gone.count} company(ies) no longer use Diffusion in the core: deactivated`,
          );
        }
      },
      { timeout: 120_000 },
    );
    this.generation += 1;
    return {
      applied: true,
      companies: directory.tenants.length,
      users: directory.tenants.reduce((n, t) => n + t.users.length, 0),
    };
  }
}

/**
 * The company's site: by id, else the site made before the core that CORE_SITE_LINKS names, or
 * the only one with the same name (it takes the core's id), else a new site with its default
 * roles and criteria.
 */
export async function upsertSite(
  tx: Tx,
  company: CoreCompany,
  now: Date,
  links: Record<string, string> = {},
  logger?: Logger,
): Promise<void> {
  const data = {
    name: company.name.slice(0, 100),
    status:
      company.status === 'ACTIVE' ? SiteStatus.ACTIVE : SiteStatus.INACTIVE,
    coreSyncedAt: now,
  };
  let exists = !!(await tx.site.findUnique({
    where: { id: company.id },
    select: { id: true },
  }));
  if (!exists) {
    const linked = links[company.id];
    const candidates = linked
      ? await tx.site.findMany({
          where: { id: linked, coreSyncedAt: null },
          select: { id: true },
        })
      : await tx.site.findMany({
          where: {
            coreSyncedAt: null,
            name: { equals: company.name.trim(), mode: 'insensitive' },
          },
          select: { id: true },
        });
    if (candidates.length === 1) {
      const legacy = candidates[0].id;
      // Every foreign key to "site" cascades on update; the audit journal keeps plain ids.
      await tx.$executeRaw`UPDATE "site" SET "id" = ${company.id} WHERE "id" = ${legacy}`;
      await tx.$executeRaw`UPDATE "activity_log" SET "siteId" = ${company.id} WHERE "siteId" = ${legacy}`;
      await tx.$executeRaw`UPDATE "audit_archive" SET "siteId" = ${company.id} WHERE "siteId" = ${legacy}`;
      logger?.log(
        `site ${legacy} matched to the core's company ${company.name} (${company.id})`,
      );
      exists = true;
    } else if (candidates.length > 1) {
      logger?.warn(
        `several sites are named "${company.name}": none matched to the core's company ${company.id} (set CORE_SITE_LINKS)`,
      );
    }
  }
  if (exists) {
    await tx.site.update({ where: { id: company.id }, data });
    return;
  }
  await tx.site.create({
    data: { id: company.id, code: await freeSiteCode(tx), ...data },
  });
  await setUpSite(tx, company.id, null);
}

async function freeSiteCode(tx: Tx): Promise<string> {
  for (;;) {
    const code = generateReference('ST');
    const taken = await tx.site.count({ where: { code } });
    if (!taken) return code;
  }
}

/**
 * The person's copy: by id, else the Diffusion account with their email made before the core
 * (it takes the core's id, its history follows), else a new one. Their site is their company.
 */
export async function upsertPerson(
  tx: Tx,
  siteId: string,
  person: CorePerson,
  now: Date,
  logger?: Logger,
): Promise<void> {
  const email = person.email.toLowerCase();
  const select = {
    id: true,
    status: true,
    accessProfile: true,
    lastLogin: true,
  } as const;
  let existing = await tx.user.findUnique({
    where: { id: person.id },
    select,
  });
  if (!existing) {
    const legacy = await tx.user.findUnique({
      where: { email },
      select: { id: true, coreSyncedAt: true },
    });
    if (legacy && !legacy.coreSyncedAt) {
      // Every foreign key to "user" cascades on update; the audit journal keeps plain ids.
      await tx.$executeRaw`UPDATE "user" SET "id" = ${person.id} WHERE "id" = ${legacy.id}`;
      await tx.$executeRaw`UPDATE "activity_log" SET "userId" = ${person.id} WHERE "userId" = ${legacy.id}`;
      logger?.log(
        `${email}: Diffusion account ${legacy.id} matched to core account ${person.id}`,
      );
      existing = await tx.user.findUnique({
        where: { id: person.id },
        select,
      });
    }
  }
  // Emails move between people at the core: whoever still holds this one here steps aside (they
  // get their own when their entry is applied).
  const holder = await tx.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (holder && holder.id !== person.id) {
    await tx.user.update({
      where: { id: holder.id },
      data: { email: `~${holder.id}` },
    });
  }

  const active = person.status === 'ACTIVE';
  const name = `${person.firstName} ${person.lastName}`.trim() || email;
  const lastLogin = latestOf(existing?.lastLogin ?? null, person.lastSignInAt);
  const data = {
    siteId,
    name,
    email,
    phone: person.phone?.slice(0, 30) ?? null,
    function: person.jobTitle ?? null,
    status: active ? UserStatus.ACTIVE : UserStatus.SUSPENDED,
    // The administration screens' label follows the core's company-administrator switch; a
    // Diffusion super-admin stays one.
    ...(existing?.accessProfile === AccessProfile.SUPER_ADMIN
      ? {}
      : {
          accessProfile: person.tenantAdmin
            ? AccessProfile.COMPANY_ADMIN
            : AccessProfile.USER,
        }),
    ...(lastLogin === undefined ? {} : { lastLogin }),
    coreSyncedAt: now,
  };
  if (existing) {
    const wasActive = existing.status === UserStatus.ACTIVE;
    await tx.user.update({
      where: { id: person.id },
      data: {
        ...data,
        ...(active
          ? { deactivatedAt: null, deactivatedById: null }
          : wasActive
            ? { deactivatedAt: now }
            : {}),
      },
    });
  } else {
    await tx.user.create({
      data: {
        id: person.id,
        ...data,
        ...(active ? {} : { deactivatedAt: now }),
      },
    });
  }
}

/**
 * The company's administrators: those holding no Diffusion role yet get the site's Admin role;
 * the first of them becomes the site's responsible (its administrator) when it has none.
 */
export async function setUpAdmins(
  tx: Tx,
  siteId: string,
  adminIds: string[],
): Promise<void> {
  if (adminIds.length === 0) return;
  const site = await tx.site.findUnique({
    where: { id: siteId },
    select: { responsibleId: true },
  });
  if (site && !site.responsibleId) {
    await tx.site.update({
      where: { id: siteId },
      data: { responsibleId: adminIds[0] },
    });
  }
  const without = await tx.user.findMany({
    where: { id: { in: adminIds }, userRoles: { none: {} } },
    select: { id: true },
  });
  if (without.length === 0) return;
  const roleId = await siteAdminRoleId(tx, siteId);
  if (!roleId) return;
  await tx.userRole.createMany({
    data: without.map((user) => ({ userId: user.id, roleId, siteId })),
    skipDuplicates: true,
  });
}

/**
 * The later of Diffusion's last sign-in and the core's. undefined: an older core that doesn't send
 * it (Diffusion's value stays as it is).
 */
function latestOf(
  local: Date | null,
  core: string | null | undefined,
): Date | null | undefined {
  if (core === undefined) return undefined;
  const at = core ? new Date(core) : null;
  if (!at || Number.isNaN(at.getTime())) return local;
  return local && local > at ? local : at;
}
