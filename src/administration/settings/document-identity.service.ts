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

type IdentityRow = {
  accentColor: string | null;
  useModuleColor: boolean | null;
  logoKey: string | null;
  logoMime: string | null;
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
      inherited: siteId
        ? {
            accentColor: own?.accentColor == null,
            useModuleColor: own?.useModuleColor == null,
            logo: !own?.logoKey,
          }
        : null,
    };
  }

  /** Readable by every signed-in user: their own site's by default. */
  async getFor(siteId: string | undefined, userId: string) {
    return this.get(siteId ?? (await this.ownSite(userId)));
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

  /** For a PDF: the colour, and the logo when it is a PNG (pdfkit). */
  async forPdf(siteId: string | null) {
    const identity = await this.get(siteId);
    let logo: Buffer | null = null;
    if (identity.logo?.mimeType === 'image/png') {
      try {
        const { body } = await this.logo(siteId);
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        logo = Buffer.concat(chunks);
      } catch {
        logo = null; // A missing file never blocks the PDF.
      }
    }
    return { color: identity.effectiveColor, logo };
  }

  async update(
    dto: UpdateDocumentIdentityDto,
    file: Express.Multer.File | undefined,
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
    if (file) assertLogo(file);

    const [common, own] = await this.rows(siteId);
    const current = siteId ? own : common;
    const oldKey = current?.logoKey ?? null;

    let logo: { logoKey: string | null; logoMime: string | null } | undefined;
    if (file) {
      const { key } = await this.storage.upload(file.buffer, {
        originalName: file.originalname,
        contentType: file.mimetype,
        prefix: `settings/logos/${siteId ?? 'common'}`,
      });
      logo = { logoKey: key, logoMime: file.mimetype };
    } else if (dto.removeLogo || (siteId && dto.reset)) {
      logo = { logoKey: null, logoMime: null };
    }

    const data =
      dto.reset && siteId
        ? { accentColor: null, useModuleColor: null, ...logo }
        : {
            ...(dto.accentColor !== undefined
              ? { accentColor: dto.accentColor.toUpperCase() }
              : {}),
            ...(dto.useModuleColor !== undefined
              ? { useModuleColor: dto.useModuleColor }
              : {}),
            ...logo,
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
      if (logo?.logoKey)
        await this.storage.delete(logo.logoKey).catch(() => undefined);
      throw error;
    }
    // The replaced logo's file goes.
    if (logo && oldKey && oldKey !== logo.logoKey) {
      await this.storage.delete(oldKey).catch(() => undefined);
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
          logo: file ? 'replaced' : logo ? 'removed' : 'unchanged',
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
