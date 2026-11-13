import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SupportTicketStatus } from '../../generated/prisma/client';
import { ActivityService } from '../activity/activity.service';
import {
  DEFAULT_TAKE,
  PaginationQueryDto,
} from '../common/dto/pagination.query.dto';
import { DatabaseService } from '../database/database.service';
import { MailerService, SupportMail } from '../mail/mailer.service';
import { StorageService } from '../storage/storage.service';
import {
  CreateSupportMessageDto,
  CreateSupportTicketDto,
  HelpFeedbackDto,
} from './dto/support.dto';

const attachmentSelect = {
  id: true,
  filename: true,
  mimeType: true,
  size: true,
  createdAt: true,
} satisfies Prisma.SupportAttachmentSelect;

const messageSelect = {
  id: true,
  body: true,
  fromSupport: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} satisfies Prisma.SupportMessageSelect;

// `technicalInfo` comes through multipart as text.
function parseTechnicalInfo(raw?: string): Prisma.InputJsonValue | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Prisma.InputJsonValue;
  } catch {
    return raw;
  }
}

async function nextTicketNumber(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<string> {
  const year = now.getFullYear();
  const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "support_sequence" ("year", "last") VALUES (${year}, 1)
    ON CONFLICT ("year")
    DO UPDATE SET "last" = "support_sequence"."last" + 1
    RETURNING "last"`;
  return `SUP-${year}-${String(last).padStart(4, '0')}`;
}

/** The Centre d'aide: each user sees only the requests they made. */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: StorageService,
    private readonly mailer: MailerService,
    private readonly activity: ActivityService,
  ) {}

  private get supportAddress() {
    return process.env.SUPPORT_EMAIL ?? 'contact@krestdev.com';
  }

  async createTicket(
    dto: CreateSupportTicketDto,
    files: Express.Multer.File[],
    userId: string,
  ) {
    const requester = await this.database.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });
    const now = new Date();
    const uploaded = await Promise.all(
      files.map(async (file) => ({
        filename: file.originalname.slice(0, 255),
        mimeType: (file.mimetype || 'application/octet-stream').slice(0, 150),
        size: file.size,
        storageKey: (
          await this.storage.upload(file.buffer, {
            originalName: file.originalname,
            contentType: file.mimetype,
            prefix: `support/${now.getFullYear()}`,
          })
        ).key,
      })),
    );
    const { technicalInfo, ...data } = dto;
    const ticket = await this.database.$transaction(async (tx) =>
      tx.supportTicket.create({
        data: {
          ...data,
          number: await nextTicketNumber(tx, now),
          technicalInfo: parseTechnicalInfo(technicalInfo),
          requesterId: userId,
          attachments: { create: uploaded },
        },
        include: { attachments: { select: attachmentSelect } },
      }),
    );
    await this.activity.tryRecord({
      action: 'support.ticket.created',
      entityType: 'support-ticket',
      entityId: ticket.id,
      metadata: { number: ticket.number },
    });
    await this.notify({
      kind: 'ticket',
      to: this.supportAddress,
      copyTo: requester.email,
      number: ticket.number,
      subject: ticket.subject,
      body: ticket.description,
      from: requester.name,
    });
    return ticket;
  }

  async findMine(query: PaginationQueryDto, userId: string) {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const contains = query.search
      ? { contains: query.search, mode: 'insensitive' as const }
      : undefined;
    const where: Prisma.SupportTicketWhereInput = {
      requesterId: userId,
      OR: contains && [{ number: contains }, { subject: contains }],
    };
    const [data, total] = await this.database.$transaction([
      this.database.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { _count: { select: { messages: true, attachments: true } } },
      }),
      this.database.supportTicket.count({ where }),
    ]);
    return { data, total, skip, take };
  }

  async findOne(id: string, userId: string) {
    const ticket = await this.database.supportTicket.findFirst({
      where: { id, requesterId: userId },
      include: {
        attachments: { select: attachmentSelect },
        messages: { select: messageSelect, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  async addMessage(id: string, dto: CreateSupportMessageDto, userId: string) {
    const ticket = await this.findOne(id, userId);
    if (ticket.status === SupportTicketStatus.CLOSED) {
      throw new BadRequestException('This request is closed');
    }
    const message = await this.database.supportMessage.create({
      data: { ticketId: id, authorId: userId, body: dto.body },
      select: messageSelect,
    });
    const requester = await this.database.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });
    await this.notify({
      kind: 'reply',
      to: this.supportAddress,
      copyTo: requester.email,
      number: ticket.number,
      subject: ticket.subject,
      body: dto.body,
      from: requester.name,
    });
    return message;
  }

  async attachmentFile(id: string, attachmentId: string, userId: string) {
    await this.findOne(id, userId);
    const attachment = await this.database.supportAttachment.findFirst({
      where: { id: attachmentId, ticketId: id },
    });
    if (!attachment) {
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    }
    const file = await this.storage.download(attachment.storageKey);
    return {
      body: file.body,
      filename: attachment.filename,
    };
  }

  // One answer per user and article: answering again replaces it.
  async feedback(dto: HelpFeedbackDto, userId: string) {
    return this.database.helpFeedback.upsert({
      where: { slug_userId: { slug: dto.slug, userId } },
      create: { slug: dto.slug, helpful: dto.helpful, userId },
      update: { helpful: dto.helpful },
      select: { slug: true, helpful: true },
    });
  }

  // The request is saved whatever happens to its e-mail.
  private async notify(mail: SupportMail) {
    try {
      await this.mailer.sendSupport(mail);
    } catch (error) {
      this.logger.error(
        `Support e-mail for ${mail.number} failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
