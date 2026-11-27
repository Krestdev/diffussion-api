import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { Permission } from '../../auth/permissions';
import { AccessService } from '../../auth/access/access.service';
import { DatabaseService } from '../../database/database.service';
import { StorageService } from '../../storage/storage.service';
import { UpdateDocumentIdentityDto } from './dto/document-identity.dto';

const SETTINGS_ID = 1;

/** The module's own colour (PA·3: "utiliser la couleur du module"). */
export const MODULE_COLOR = '#7C3AED';
const DEFAULT_ACCENT = '#7C3AED';

export const LOGO_TYPES = ['image/png', 'image/svg+xml'] as const;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** The fiche d'analyse's background: an A4 page drawn behind every page. */
export const BACKGROUND_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
] as const;
export const BACKGROUND_MAX_BYTES = 5 * 1024 * 1024;

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
 * d'analyse: logo, accent colour, or the module's colour, and the fiche's
 * page background. Common, and each company's own over it (a company that
 * sets nothing inherits it).
 */
@Injectable()
export class DocumentIdentityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
  ) {}

  /** The identity in force at `companyId` (the common one without a company). */
  async get(companyId: string | null) {
    const [common, own] = await this.rows(companyId);
    const pick = <K extends keyof NonNullable<IdentityRow>>(key: K) =>
      own?.[key] ?? common?.[key] ?? null;
    const logoFromCompany = Boolean(own?.logoKey);
    const logoMime = logoFromCompany
      ? own!.logoMime
      : (common?.logoMime ?? null);
    const hasLogo = logoFromCompany || Boolean(common?.logoKey);
    const background = pickBackground(common, own);
    const useModuleColor = pick('useModuleColor') ?? false;
    const accentColor = pick('accentColor') ?? DEFAULT_ACCENT;
    const query = companyId ? `?companyId=${companyId}` : '';
    return {
      companyId,
      accentColor,
      useModuleColor,
      // What a document is actually printed in.
      effectiveColor: useModuleColor ? MODULE_COLOR : accentColor,
      logo: hasLogo
        ? {
            mimeType: logoMime,
            url: `/settings/document-identity/logo${query}`,
          }
        : null,
      analysisBackground: background
        ? {
            mimeType: background.mime,
            url: `/settings/document-identity/analysis-background${query}`,
          }
        : null,
      inherited: companyId
        ? {
            accentColor: own?.accentColor == null,
            useModuleColor: own?.useModuleColor == null,
            logo: !own?.logoKey,
            analysisBackground: !own?.analysisBackgroundKey,
          }
        : null,
    };
  }

  /** Readable by every signed-in user: their own company's by default. */
  async getFor(companyId: string | undefined, userId: string) {
    const own = await this.ownCompany(userId);
    if (companyId && companyId !== own) {
      await this.access.assertManages(
        userId,
        Permission.SETTINGS_UPDATE,
        companyId,
        'Ce réglage',
      );
    }
    return this.get(companyId ?? own);
  }

  /** The logo file in force at `companyId`. */
  async logo(companyId: string | null) {
    const [common, own] = await this.rows(companyId);
    const key = own?.logoKey ?? common?.logoKey;
    const mime = own?.logoKey ? own.logoMime : common?.logoMime;
    if (!key) throw new NotFoundException('No logo');
    const file = await this.storage.download(key);
    return { ...file, contentType: mime ?? file.contentType };
  }

  /** The fiche d'analyse's background file in force at `companyId`. */
  async analysisBackground(companyId: string | null) {
    const [common, own] = await this.rows(companyId);
    const background = pickBackground(common, own);
    if (!background) throw new NotFoundException('No analysis background');
    const file = await this.storage.download(background.key);
    return { ...file, contentType: background.mime ?? file.contentType };
  }

  /**
   * For a PDF: the colour, the logo when it is a PNG (pdfkit), and the fiche
   * d'analyse's background. A missing file never blocks the PDF.
   */
  async forPdf(companyId: string | null) {
    const identity = await this.get(companyId);
    const logo =
      identity.logo?.mimeType === 'image/png'
        ? await this.logo(companyId)
            .then((file) => readAll(file.body))
            .catch(() => null)
        : null;
    const background = identity.analysisBackground
      ? await this.analysisBackground(companyId)
          .then(async (file) => ({
            data: await readAll(file.body),
            mimeType: file.contentType ?? null,
          }))
          .catch(() => null)
      : null;
    return { color: identity.effectiveColor, logo, background };
  }

  async update(
    dto: UpdateDocumentIdentityDto,
    logo: Express.Multer.File | undefined,
    background: Express.Multer.File | undefined,
    userId: string,
  ) {
    const companyId = targetCompany(
      await this.access.scope(userId, Permission.SETTINGS_UPDATE),
      await this.access.isPlatformAdmin(userId),
      dto.companyId,
    );
    await this.access.assertManages(
      userId,
      Permission.SETTINGS_UPDATE,
      companyId,
      companyId ? 'Cette identité visuelle' : "L'identité visuelle commune",
    );
    if (logo) assertLogo(logo);
    if (background) assertBackground(background);

    const [common, own] = await this.rows(companyId);
    const current = companyId ? own : common;
    const oldLogoKey = current?.logoKey ?? null;
    const oldBackgroundKey = current?.analysisBackgroundKey ?? null;
    const folder = companyId ?? 'common';

    // The files are stored first; the row changes only once they are.
    let logoUpdate:
      { logoKey: string | null; logoMime: string | null } | undefined;
    if (logo) {
      const { key } = await this.storage.upload(logo.buffer, {
        originalName: logo.originalname,
        contentType: logo.mimetype,
        prefix: `settings/logos/${folder}`,
      });
      logoUpdate = { logoKey: key, logoMime: logo.mimetype };
    } else if (dto.removeLogo || (companyId && dto.reset)) {
      logoUpdate = { logoKey: null, logoMime: null };
    }

    let backgroundUpdate:
      | {
          analysisBackgroundKey: string | null;
          analysisBackgroundMime: string | null;
        }
      | undefined;
    if (background) {
      const { key } = await this.storage
        .upload(background.buffer, {
          originalName: background.originalname,
          contentType: background.mimetype,
          prefix: `settings/analysis-backgrounds/${folder}`,
        })
        .catch(async (error: unknown) => {
          // The logo just stored would be left without its row.
          await this.deleteQuietly(logoUpdate?.logoKey);
          throw error;
        });
      backgroundUpdate = {
        analysisBackgroundKey: key,
        analysisBackgroundMime: background.mimetype,
      };
    } else if (dto.removeAnalysisBackground || (companyId && dto.reset)) {
      backgroundUpdate = {
        analysisBackgroundKey: null,
        analysisBackgroundMime: null,
      };
    }

    const data =
      dto.reset && companyId
        ? {
            accentColor: null,
            useModuleColor: null,
            ...logoUpdate,
            ...backgroundUpdate,
          }
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
      if (companyId) {
        await this.database.companySettings.upsert({
          where: { companyId },
          create: { companyId, ...data },
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
      // The files just stored go with the failed write.
      await this.deleteQuietly(logoUpdate?.logoKey);
      await this.deleteQuietly(backgroundUpdate?.analysisBackgroundKey);
      throw error;
    }
    // The replaced files go.
    if (logoUpdate && oldLogoKey !== logoUpdate.logoKey)
      await this.deleteQuietly(oldLogoKey);
    if (
      backgroundUpdate &&
      oldBackgroundKey !== backgroundUpdate.analysisBackgroundKey
    )
      await this.deleteQuietly(oldBackgroundKey);

    await this.activity
      .tryRecord({
        action: 'settings.document-identity.updated',
        entityType: 'settings',
        entityId: companyId ?? String(SETTINGS_ID),
        companyId,
        metadata: {
          accentColor: dto.accentColor,
          useModuleColor: dto.useModuleColor,
          logo: fileChange(logo, logoUpdate),
          analysisBackground: fileChange(background, backgroundUpdate),
          reset: Boolean(dto.reset),
        },
      })
      .catch(() => undefined);
    return this.get(companyId);
  }

  private rows(companyId: string | null): Promise<[IdentityRow, IdentityRow]> {
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
      companyId
        ? this.database.companySettings.findUnique({
            where: { companyId },
            select,
          })
        : Promise.resolve(null),
    ]);
  }

  private async deleteQuietly(key: string | null | undefined) {
    if (key) await this.storage.delete(key).catch(() => undefined);
  }

  private async ownCompany(userId: string) {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    return user?.companyId ?? null;
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

function assertBackground(file: Express.Multer.File) {
  if (!(BACKGROUND_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new BadRequestException(
      'The analysis background must be a PDF, a PNG or a JPEG',
    );
  }
  if (file.size > BACKGROUND_MAX_BYTES) {
    throw new BadRequestException(
      'The analysis background must weigh 5 MB at most',
    );
  }
}

/** The background in force: the company's own, else the common one. */
function pickBackground(common: IdentityRow, own: IdentityRow) {
  const row = own?.analysisBackgroundKey ? own : common;
  return row?.analysisBackgroundKey
    ? { key: row.analysisBackgroundKey, mime: row.analysisBackgroundMime }
    : null;
}

/** What an update did to a file, for the activity log. */
function fileChange(uploaded: unknown, update: unknown) {
  if (uploaded) return 'replaced';
  return update ? 'removed' : 'unchanged';
}

async function readAll(body: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body)
    chunks.push(Buffer.from(chunk as ArrayBufferLike));
  return Buffer.concat(chunks);
}

function targetCompany(
  scope: string[],
  platformAdmin: boolean,
  requested: string | undefined,
): string | null {
  if (requested) return requested;
  // A super-administrator naming no company changes the common ones.
  if (platformAdmin) return null;
  if (scope.length === 1) return scope[0];
  throw new BadRequestException('companyId is required');
}
