import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  Prisma,
  ValidationDecision,
} from '../../../generated/prisma/client';
import { SetAccessDto } from '../../common/dto/access.dto';
import { createWithUniqueReference } from '../../common/utils/generate-reference';
import { DatabaseService } from '../../database/database.service';
import { CreateMailDto } from './dto/create-mail.dto';
import { FindMailsQueryDto } from './dto/find-mails.query.dto';
import { UpdateMailDto } from './dto/update-mail.dto';

const mailInclude = {
  correspondent: true,
  nature: true,
  canal: true,
  // `priority` is included so the frontend can show a courrier's urgency —
  // Courrier has no priority of its own, it inherits its dossier's.
  dossier: { select: { id: true, number: true, title: true, priority: true } },
} satisfies Prisma.CourrierInclude;

const courrierAccessInclude = {
  user: { select: { id: true, name: true, email: true } },
} satisfies Prisma.CourrierAccessInclude;

// States in which the courrier can still be freely edited or deleted by the
// person who registered/drafted it (RG-COU-003/004).
const EDITABLE_STATUSES: CourrierStatus[] = [
  CourrierStatus.RECU,
  CourrierStatus.ENREGISTRE,
  CourrierStatus.BROUILLON,
  CourrierStatus.A_CORRIGER,
];

// Entrant workflow: statuses before the courrier has been fully treated —
// cancellable, and the only ones `close()` can be called from.
const ENTRANT_OPEN_STATUSES: CourrierStatus[] = [
  CourrierStatus.RECU,
  CourrierStatus.ENREGISTRE,
  CourrierStatus.TRANSMIS,
  CourrierStatus.EN_TRAITEMENT,
];

// Sortant workflow: statuses before it's been sent — cancellable.
const SORTANT_OPEN_STATUSES: CourrierStatus[] = [
  CourrierStatus.BROUILLON,
  CourrierStatus.EN_VERIFICATION,
  CourrierStatus.A_CORRIGER,
  CourrierStatus.EN_VALIDATION,
];

@Injectable()
export class MailService {
  constructor(private readonly database: DatabaseService) {}

  create(dto: CreateMailDto, createdById: string) {
    const { receivedAt, ...data } = dto;
    return createWithUniqueReference('M', (number) =>
      this.database.courrier.create({
        data: {
          ...data,
          number,
          receivedAt: receivedAt ? new Date(receivedAt) : undefined,
          status:
            dto.direction === CourrierDirection.ENTRANT
              ? CourrierStatus.RECU
              : CourrierStatus.BROUILLON,
          createdById,
        },
        include: mailInclude,
      }),
    );
  }

  async findAll(query: FindMailsQueryDto) {
    const where: Prisma.CourrierWhereInput = {
      dossierId: query.dossierId,
      direction: query.direction,
      status: query.status,
      correspondentId: query.correspondentId,
    };

    const [data, total] = await this.database.$transaction([
      this.database.courrier.findMany({
        where,
        include: mailInclude,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
      }),
      this.database.courrier.count({ where }),
    ]);

    return { data, total, skip: query.skip ?? 0, take: query.take ?? 20 };
  }

  async findOne(id: string) {
    const courrier = await this.database.courrier.findUnique({
      where: { id },
      include: mailInclude,
    });
    if (!courrier) {
      throw new NotFoundException(`Courrier ${id} not found`);
    }
    return courrier;
  }

  async update(id: string, dto: UpdateMailDto) {
    const courrier = await this.ensureEditable(id);
    const { receivedAt, ...data } = dto;
    return this.database.courrier.update({
      where: { id: courrier.id },
      data: {
        ...data,
        receivedAt: receivedAt ? new Date(receivedAt) : undefined,
      },
      include: mailInclude,
    });
  }

  async remove(id: string) {
    await this.ensureEditable(id);
    await this.database.courrier.delete({ where: { id } });
  }

  // Entrant: ENREGISTRE -> TRANSMIS (10.2.4.7 — handed to the dossier's
  // responsible for treatment).
  async transmit(id: string) {
    const courrier = await this.requireStatus(id, [
      CourrierStatus.RECU,
      CourrierStatus.ENREGISTRE,
    ]);
    return this.setStatus(courrier.id, CourrierStatus.TRANSMIS);
  }

  // Sortant: BROUILLON | A_CORRIGER -> EN_VERIFICATION.
  async submitForVerification(id: string) {
    const courrier = await this.requireStatus(id, [
      CourrierStatus.BROUILLON,
      CourrierStatus.A_CORRIGER,
    ]);
    return this.setStatus(courrier.id, CourrierStatus.EN_VERIFICATION);
  }

  // Sortant: EN_VERIFICATION -> EN_VALIDATION (approved) | A_CORRIGER.
  async verify(id: string, approved: boolean) {
    const courrier = await this.requireStatus(id, [
      CourrierStatus.EN_VERIFICATION,
    ]);
    return this.setStatus(
      courrier.id,
      approved ? CourrierStatus.EN_VALIDATION : CourrierStatus.A_CORRIGER,
    );
  }

  // Sortant: EN_VALIDATION -> VALIDE (approved) | A_CORRIGER, and records the
  // decision (10.6 / RG-VAL-*).
  async validateCourrier(
    id: string,
    approved: boolean,
    validatorId: string,
    motif?: string,
  ) {
    const courrier = await this.requireStatus(id, [
      CourrierStatus.EN_VALIDATION,
    ]);
    const [updated] = await this.database.$transaction([
      this.database.courrier.update({
        where: { id: courrier.id },
        data: {
          status: approved ? CourrierStatus.VALIDE : CourrierStatus.A_CORRIGER,
        },
        include: mailInclude,
      }),
      this.database.validation.create({
        data: {
          validatorId,
          decision: approved
            ? ValidationDecision.VALIDE
            : ValidationDecision.CORRECTIONS_DEMANDEES,
          motif,
        },
      }),
    ]);
    return updated;
  }

  // Sortant: VALIDE -> ENVOYE.
  async send(id: string) {
    const courrier = await this.requireStatus(id, [CourrierStatus.VALIDE]);
    return this.database.courrier.update({
      where: { id: courrier.id },
      data: { status: CourrierStatus.ENVOYE, sentAt: new Date() },
      include: mailInclude,
    });
  }

  async cancel(id: string) {
    const courrier = await this.requireStatus(id, [
      ...SORTANT_OPEN_STATUSES,
      ...ENTRANT_OPEN_STATUSES,
    ]);
    return this.setStatus(courrier.id, CourrierStatus.ANNULE);
  }

  // Entrant: mark a received courrier as fully treated (10.2.4.8).
  async close(id: string) {
    const courrier = await this.requireStatus(id, ENTRANT_OPEN_STATUSES);
    return this.setStatus(courrier.id, CourrierStatus.CLOTURE);
  }

  // Entrant: a treated courrier can be archived, mirroring Dossier's
  // close-before-archive rule.
  async archive(id: string) {
    const courrier = await this.requireStatus(id, [CourrierStatus.CLOTURE]);
    return this.setStatus(courrier.id, CourrierStatus.ARCHIVE);
  }

  // Inverse of archive() — back to CLOTURE, mirroring Dossier.unarchive().
  async unarchive(id: string) {
    const courrier = await this.requireStatus(id, [CourrierStatus.ARCHIVE]);
    return this.setStatus(courrier.id, CourrierStatus.CLOTURE);
  }

  // RG-COU-007: decharge can only be handed once the courrier is actually
  // registered.
  async discharge(id: string, dischargedById: string) {
    const courrier = await this.findOne(id);
    if (courrier.status === CourrierStatus.RECU) {
      throw new BadRequestException(
        'Courrier must be registered before a décharge can be issued',
      );
    }
    return this.database.courrier.update({
      where: { id },
      data: {
        dischargedAt: new Date(),
        dischargedById,
        dischargedStamp: true,
      },
      include: mailInclude,
    });
  }

  // Independent from the dossier's own access list (see CourrierAccess in
  // schema.prisma) — a user with access to the dossier is not automatically
  // granted access to this courrier, and vice versa.
  async getAccess(id: string) {
    await this.findOne(id);
    return this.database.courrierAccess.findMany({
      where: { courrierId: id },
      include: courrierAccessInclude,
      orderBy: { createdAt: 'asc' },
    });
  }

  async setAccess(id: string, dto: SetAccessDto) {
    await this.findOne(id);
    const userIds = dto.entries.map((entry) => entry.userId);

    await this.database.$transaction([
      this.database.courrierAccess.deleteMany({
        where: {
          courrierId: id,
          userId: { notIn: userIds.length > 0 ? userIds : ['__none__'] },
        },
      }),
      ...dto.entries.map((entry) =>
        this.database.courrierAccess.upsert({
          where: {
            courrierId_userId: { courrierId: id, userId: entry.userId },
          },
          create: {
            courrierId: id,
            userId: entry.userId,
            canView: entry.canView,
            canEdit: entry.canEdit,
          },
          update: { canView: entry.canView, canEdit: entry.canEdit },
        }),
      ),
    ]);

    return this.getAccess(id);
  }

  private async requireStatus(id: string, allowed: CourrierStatus[]) {
    const courrier = await this.findOne(id);
    if (!allowed.includes(courrier.status)) {
      throw new BadRequestException(
        `Courrier is ${courrier.status}, expected one of: ${allowed.join(', ')}`,
      );
    }
    return courrier;
  }

  private setStatus(id: string, status: CourrierStatus) {
    return this.database.courrier.update({
      where: { id },
      data: { status },
      include: mailInclude,
    });
  }

  private async ensureEditable(id: string) {
    const courrier = await this.findOne(id);
    if (!EDITABLE_STATUSES.includes(courrier.status)) {
      throw new BadRequestException(
        `Courrier is ${courrier.status} and can no longer be edited or removed`,
      );
    }
    return courrier;
  }
}
