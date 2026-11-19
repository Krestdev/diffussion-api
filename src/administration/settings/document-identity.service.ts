import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RbacService, SiteScopeList } from '../../auth/rbac/rbac.service';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { UpdateDocumentIdentityDto } from './dto/document-identity.dto';

const SETTINGS_ID = 1;

/** The module's own colour (PA·3: "utiliser la couleur du module"). */
export const MODULE_COLOR = '#7C3AED';
const DEFAULT_ACCENT = '#7C3AED';

export const LOGO_TYPES = ['image/png', 'image/svg+xml'] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const BACKGROUND_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;

function assertBackground(file: Express.Multer.File) {
  if (!(BACKGROUND_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new BadRequestException(
      'The analysis background must be a PDF, PNG or JPEG',
    );
  }
  if (file.size > BACKGROUND_MAX_BYTES) {
    throw new BadRequestException(
      'The analysis background must weigh 5 MB at most',
    );
  }
}

type IdentityRow = {
  accentColor: string | null;
  useModuleColor: boolean | null;
  logoKey: string | null;
  logoMime: string | null;
  analysisBackgroundKey: string | null;
  analysisBackgroundMime: string | null;
} | null;

/**
 * The documents' visual identity (PA·3) — the letterhead of the fiches
 * d'analyse: logo, accent colour, or the module's colour. Common, and each
 * site's own over it (a site that sets nothing inherits it).
 */
@Injectable()
export class DocumentIdentityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rbac: RbacService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
  ) {}

  /** The identity in force at `siteId` (the common one without a site). */
  async get(siteId: string | null) {
    const [common, own] = await this.rows(siteId);
    const pick = <K extends keyof NonNullable<IdentityRow>>(key: K) =>
      own?.[key] ?? common?.[key] ?? null;
    const logoFromSite = Boolean(own?.logoKey);
    const logoMime = logoFromSite ? own!.logoMime : (common?.logoMime ?? null);
    const hasLogo = logoFromSite || Boolean(common?.logoKey);
    const useModuleColor = pick('useModuleColor') ?? false;
    const accentColor = pick('accentColor') ?? DEFAULT_ACCENT;
    const hasBackground =
      Boolean(own?.analysisBackgroundKey) ||
      Boolean(common?.analysisBackgroundKey);
    return {
      siteId,
      accentColor,
      useModuleColor,
      // What a document is actually printed in.
      effectiveColor: useModuleColor ? MODULE_COLOR : accentColor,
      logo: hasLogo
        ? {
            mimeType: logoMime,
            url: `/settings/document-identity/logo${siteId ? `?siteId=${siteId}` : ''}`,
          }
        : null,
      analysisBackground: hasBackground
        ? {
            url: `/settings/document-identity/analysis-background${siteId ? `?siteId=${siteId}` : ''}`,
          }
        : null,
      inherited: siteId
        ? {
            accentColor: own?.accentColor == null,
            useModuleColor: own?.useModuleColor == null,
            logo: !own?.logoKey,
            analysisBackground: !own?.analysisBackgroundKey,
          }
        : null,
    };
  }

  /** Readable by every signed-in user: their own site's by default. */
  async getFor(siteId: string | undefined, userId: string) {
    const own = await this.ownSite(userId);
    if (siteId && siteId !== own) {
      await this.rbac.assertManagesSite(
        userId,
        PermissionCode.AdminManageSettings,
        siteId,
        'Ce réglage',
      );
    }
    return this.get(siteId ?? own);
  }

  /** The logo file in force at `siteId`. */
  async logo(siteId: string | null) {
    const [common, own] = await this.rows(siteId);
    const key = own?.logoKey ?? common?.logoKey;
    const mime = own?.logoKey ? own.logoMime : common?.logoMime;
    if (!key) throw new NotFoundException('No logo');
    const file = await this.storage.download(key);
    return { ...file, contentType: mime ?? file.contentType };
  }

  /** The analysis background file in force at `siteId` (PDF, PNG or JPEG). */
  async analysisBackground(siteId: string | null) {
    const [common, own] = await this.rows(siteId);
    const key =
      own?.analysisBackgroundKey ?? common?.analysisBackgroundKey ?? null;
    const mime =
      own?.analysisBackgroundMime ?? common?.analysisBackgroundMime ?? null;
    if (!key) throw new NotFoundException('No analysis background');
    const file = await this.storage.download(key);
    return { ...file, contentType: mime ?? file.contentType };
  }

  /** For a PDF: the colour, the logo when it is a PNG, and the background PDF. */
  async forPdf(siteId: string | null) {
    const identity = await this.get(siteId);
    let logo: Buffer | null = null;
    if (identity.logo?.mimeType === 'image/png') {
      try {
        const { body } = await this.logo(siteId);
        const chunks: Buffer[] = [];
        for await (const chunk of body)
          chunks.push(Buffer.from(chunk as ArrayBufferLike));
        logo = Buffer.concat(chunks);
      } catch {
        logo = null; // A missing file never blocks the PDF.
      }
    }
    let analysisBackground: Buffer | null = null;
    let analysisBackgroundMime: string | null = null;
    if (identity.analysisBackground) {
      try {
        const [common, own] = await this.rows(siteId);
        analysisBackgroundMime =
          own?.analysisBackgroundMime ??
          common?.analysisBackgroundMime ??
          null;
        const { body } = await this.analysisBackground(siteId);
        const chunks: Buffer[] = [];
        for await (const chunk of body)
          chunks.push(Buffer.from(chunk as ArrayBufferLike));
        analysisBackground = Buffer.concat(chunks);
      } catch {
        analysisBackground = null; // A missing background never blocks the PDF.
      }
    }
    return {
      color: identity.effectiveColor,
      logo,
      analysisBackground,
      analysisBackgroundMime,
    };
  }

  async update(
    dto: UpdateDocumentIdentityDto,
    logo: Express.Multer.File | undefined,
    background: Express.Multer.File | undefined,
    userId: string,
  ) {
    const scope = await this.rbac.managedSites(
      userId,
      PermissionCode.AdminManageSettings,
    );
    const siteId = targetSite(scope, dto.siteId);
    await this.rbac.explainOutOfScope(
      scope,
      siteId,
      siteId ? 'Cette identité visuelle' : "L'identité visuelle commune",
      PermissionCode.AdminManageSettings,
    );
    if (logo) assertLogo(logo);
    if (background) assertBackground(background);

    const [common, own] = await this.rows(siteId);
    const current = siteId ? own : common;
    const oldLogoKey = current?.logoKey ?? null;
    const oldBackgroundKey = current?.analysisBackgroundKey ?? null;

    // Upload new files before touching the DB (same pattern as mail.service).
    let logoUpdate:
      | { logoKey: string | null; logoMime: string | null }
      | undefined;
    if (logo) {
      const { key } = await this.storage.upload(logo.buffer, {
        originalName: logo.originalname,
        contentType: logo.mimetype,
        prefix: `settings/logos/${siteId ?? 'common'}`,
      });
      logoUpdate = { logoKey: key, logoMime: logo.mimetype };
    } else if (dto.removeLogo || (siteId && dto.reset)) {
      logoUpdate = { logoKey: null, logoMime: null };
    }

    let backgroundUpdate:
      | {
          analysisBackgroundKey: string | null;
          analysisBackgroundMime: string | null;
        }
      | undefined;
    if (background) {
      const { key } = await this.storage.upload(background.buffer, {
        originalName: background.originalname,
        contentType: background.mimetype,
        prefix: `settings/analysis-backgrounds/${siteId ?? 'common'}`,
      });
      backgroundUpdate = {
        analysisBackgroundKey: key,
        analysisBackgroundMime: background.mimetype,
      };
    } else if (dto.removeAnalysisBackground || (siteId && dto.reset)) {
      backgroundUpdate = {
        analysisBackgroundKey: null,
        analysisBackgroundMime: null,
      };
    }

    const data =
      dto.reset && siteId
        ? { accentColor: null, useModuleColor: null, ...logoUpdate, ...backgroundUpdate }
        : {
            ...(dto.accentColor !== undefined
              ? { accentColor: dto.accentColor.toUpperCase() }
              : {}),
            ...(dto.useModuleColor !== undefined
              ? { useModuleColor: dto.useModuleColor }
              : {}),
            ...logoUpdate,
            ...backgroundUpdate,
          };

    try {
      if (siteId) {
        await this.database.siteSettings.upsert({
          where: { siteId },
          create: { siteId, ...data },
          update: data,
        });
      } else {
        await this.database.appSettings.upsert({
          where: { id: SETTINGS_ID },
          create: { id: SETTINGS_ID, ...data },
          update: data,
        });
      }
    } catch (error) {
      // DB write failed — clean up any files just uploaded.
      if (logoUpdate?.logoKey)
        await this.storage.delete(logoUpdate.logoKey).catch(() => undefined);
      if (backgroundUpdate?.analysisBackgroundKey)
        await this.storage
          .delete(backgroundUpdate.analysisBackgroundKey)
          .catch(() => undefined);
      throw error;
    }

    // Replace means the old file is now orphaned — remove it.
    if (logoUpdate && oldLogoKey && oldLogoKey !== logoUpdate.logoKey) {
      await this.storage.delete(oldLogoKey).catch(() => undefined);
    }
    if (
      backgroundUpdate &&
      oldBackgroundKey &&
      oldBackgroundKey !== backgroundUpdate.analysisBackgroundKey
    ) {
      await this.storage.delete(oldBackgroundKey).catch(() => undefined);
    }

    await this.activity
      .tryRecord({
        action: 'settings.document-identity.updated',
        entityType: 'settings',
        entityId: siteId ?? String(SETTINGS_ID),
        siteId,
        metadata: {
          accentColor: dto.accentColor,
          useModuleColor: dto.useModuleColor,
          logo: logo ? 'replaced' : logoUpdate ? 'removed' : 'unchanged',
          analysisBackground: background
            ? 'replaced'
            : backgroundUpdate
              ? 'removed'
              : 'unchanged',
          reset: Boolean(dto.reset),
        },
      })
      .catch(() => undefined);
    return this.get(siteId);
  }

  private rows(siteId: string | null): Promise<[IdentityRow, IdentityRow]> {
    const select = {
      accentColor: true,
      useModuleColor: true,
      logoKey: true,
      logoMime: true,
      analysisBackgroundKey: true,
      analysisBackgroundMime: true,
    } as const;
    return Promise.all([
      this.database.appSettings.findUnique({
        where: { id: SETTINGS_ID },
        select,
      }),
      siteId
        ? this.database.siteSettings.findUnique({ where: { siteId }, select })
        : Promise.resolve(null),
    ]);
  }

  private async ownSite(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { siteId: true },
    });
    return user?.siteId ?? null;
  }
}

function assertLogo(file: Express.Multer.File) {
  if (!(LOGO_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new BadRequestException('The logo must be a PNG or an SVG');
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new BadRequestException('The logo must weigh 2 MB at most');
  }
}

function targetSite(
  scope: SiteScopeList,
  requested: string | undefined,
): string | null {
  if (requested) return requested;
  if (scope === 'ALL') return null;
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('siteId is required');
}
