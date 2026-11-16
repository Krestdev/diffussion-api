import { Injectable, Logger } from '@nestjs/common';
import {
  CourrierDirection,
  CourrierStatus,
  InstructionStatus,
  LivrableStatus,
  NotificationStatus,
  Prisma,
  SubscriptionDecision,
  UserInstructionRole,
} from '../generated/prisma/client';
import { Permission } from '../auth/permissions';
import { AuthUser, CoreRequestContext } from '../auth/types/auth-user.type';
import { awaitingValidationBy } from '../common/utils/courrier-validation';
import { DatabaseService } from '../database/database.service';
import {
  FindIncomingMailsQueryDto,
  IncomingMailSort,
} from '../domain/mail/dto/find-incoming-mails.query.dto';
import { MailService } from '../domain/mail/mail.service';
import {
  NOTIFICATION_FALLBACK,
  NOTIFICATION_TITLES,
  PortalLanguage,
} from './notification-titles';
import {
  notificationBody,
  readParams,
} from '../notifications/notification-texts';

const DAY = 86_400_000;
/** Waiting longer than this is "late" (À traiter's age pill, as in EXPENZO). */
const LATE_MS = 2 * DAY;
/** Rows read per kind to find the late and the oldest ones. */
const READ = 200;
/** A kind slower than this is left out: the core waits APP_API_TIMEOUT_MS (5 s) for the whole. */
const KIND_TIMEOUT_MS = 3000;
/** Latest notifications sent to the core (it keeps 6 across apps). */
const NOTIFICATIONS = 5;

export type PortalItemKey =
  | 'incomingToDispatch'
  | 'dispatchToValidate'
  | 'incomingToHandle'
  | 'tasksToSubscribe'
  | 'tasksToDeliver'
  | 'tasksToReassign'
  | 'livrablesToReview'
  | 'outgoingToValidate'
  | 'outgoingToCorrect'
  | 'outgoingToSend'
  | 'outgoingToDischarge';

/** Contract C6 (the core's AppSummary). */
export type PortalItem = {
  key: PortalItemKey;
  count: number;
  /** Diffusion's effets carry no amount. */
  amount: null;
  /** How many wait for more than two days, and since how many days the oldest waits. */
  late: number;
  oldestDays: number;
  /** Path in Diffusion (the core prefixes the app's address). */
  link: string;
};

export type PortalDelegation = {
  id: string;
  /** ACTING: I replace `person`; COVERED: `person` replaces me. */
  side: 'ACTING' | 'COVERED';
  status: 'UPCOMING' | 'ACTIVE';
  person: { id: string; firstName: string; lastName: string };
  startsAt: Date;
  endsAt: Date;
};

export type PortalNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export type PortalSummary = {
  pending: number;
  currency: string;
  items: PortalItem[];
  delegations: PortalDelegation[];
  notifications: PortalNotification[];
};

/** What one kind found: how many, and when each of the first rows started waiting. */
type Found = { total: number; since: Date[] };

type Kind = {
  key: PortalItemKey;
  /** Read only when the person holds it (null: their own work, always read). */
  permission: Permission | null;
  link: string;
  load: () => Promise<Found>;
};

type Dated = Record<string, unknown>;

/** The first date set among `fields` (the fallbacks the lists display). */
const firstDate = (row: Dated, fields: string[]): Date | null => {
  for (const field of fields) {
    const value = row[field];
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value) return new Date(value);
  }
  return null;
};

/** "Jean Paul Mbarga" → Jean / Paul Mbarga: Diffusion keeps one name (the core's, joined). */
const splitName = (name: string) => {
  const [firstName = '', ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') };
};

const languageOf = (core?: CoreRequestContext): PortalLanguage => {
  const language =
    core?.account.language || core?.account.tenant.defaultLanguage;
  return language === 'fr' || language === 'it' ? language : 'en';
};

/**
 * Diffusion's tile on the core's "Accueil du portail" (contract C6, as EXPENZO's PortalService):
 * what waits for the signed-in person — the same work as « À traiter » (diffusion-ui
 * components/tasks/use-to-process.ts) and the « Tâches » counters (InstructionsService
 * findMyTasks) —, their delegations and latest notifications. Each kind follows the person's
 * rights and fails soft: a failing or slow kind is left out, never the whole summary.
 */
@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly mail: MailService,
  ) {}

  async summary(
    user: AuthUser,
    core?: CoreRequestContext,
  ): Promise<PortalSummary> {
    const now = Date.now();
    const kinds = this.kinds(user.sub).filter(
      (kind) => !kind.permission || user.permissions.has(kind.permission),
    );
    const read = await Promise.all(
      kinds.map(async ({ key, link, load }): Promise<PortalItem | null> => {
        const found = await this.soft(key, load());
        if (!found || found.total === 0) return null;
        const since = found.since.map((at) => at.getTime());
        return {
          key,
          count: found.total,
          amount: null,
          late: since.filter((at) => now - at > LATE_MS).length,
          oldestDays: since.length
            ? Math.max(0, Math.floor((now - Math.min(...since)) / DAY))
            : 0,
          link,
        };
      }),
    );
    const items = read.filter((item): item is PortalItem => item !== null);
    const [delegations, notifications] = await Promise.all([
      this.soft('delegations', this.delegations(user.sub)),
      this.soft(
        'notifications',
        this.notifications(user.sub, languageOf(core)),
      ),
    ]);
    return {
      pending: items.reduce((sum, item) => sum + item.count, 0),
      // Amounts are always null: the company's currency, for the contract.
      currency: core?.account.tenant.currency || 'XAF',
      items,
      delegations: delegations ?? [],
      notifications: notifications ?? [],
    };
  }

  /** The kinds of work, in the order of « À traiter » (incoming, instructions, outgoing). */
  private kinds(userId: string): Kind[] {
    const db = this.database;
    const toProcess = (tab: 'incoming' | 'outgoing' | 'instructions') =>
      `/dashboard/tasks?tab=${tab}`;

    // Incoming lists of the « Effets entrants » page, with its visibility rules, oldest first.
    const incomingTab = (tab: string, dates: string[]) => async () => {
      const page = await this.mail.findIncoming(
        Object.assign(new FindIncomingMailsQueryDto(), {
          tab,
          sort: IncomingMailSort.Oldest,
          skip: 0,
          take: READ,
        }),
        userId,
      );
      return {
        total: page.total,
        since: (page.data as Dated[])
          .map((row) => firstDate(row, dates))
          .filter((at): at is Date => at !== null),
      };
    };

    const courriers =
      (where: Prisma.CourrierWhereInput, dates: string[]) => async () => {
        const [total, rows] = await Promise.all([
          db.courrier.count({ where }),
          db.courrier.findMany({
            where,
            select: {
              createdAt: true,
              updatedAt: true,
              receivedAt: true,
              proposedAt: true,
              dispatchValidatedAt: true,
              transmittedAt: true,
              submittedAt: true,
              approvedAt: true,
            },
            orderBy: { createdAt: 'asc' },
            take: READ,
          }),
        ]);
        return {
          total,
          since: rows
            .map((row) => firstDate(row, dates))
            .filter((at): at is Date => at !== null),
        };
      };

    const instructions = (where: Prisma.InstructionWhereInput) => async () => {
      const [total, rows] = await Promise.all([
        db.instruction.count({ where }),
        db.instruction.findMany({
          where,
          select: { assignedAt: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
          take: READ,
        }),
      ]);
      return {
        total,
        since: rows.map((row) => row.assignedAt ?? row.createdAt),
      };
    };

    const incoming = { direction: CourrierDirection.ENTRANT };
    const outgoing = { direction: CourrierDirection.SORTANT };
    // The author, or who approved it, signs, sends and records the discharge (use-to-process).
    const handles: Prisma.CourrierWhereInput = {
      OR: [{ createdById: userId }, { approvedById: userId }],
    };
    const executant = { userId, role: UserInstructionRole.EXECUTANT };
    const supervisor = { userId, role: UserInstructionRole.SUPERVISEUR };
    // Submitted livrables waiting on me (InstructionsService.findMyTasks avisAttendus + aValider).
    const submitted = { status: LivrableStatus.SOUMIS, isLatest: true };

    return [
      {
        key: 'incomingToDispatch',
        permission: Permission.INCOMING_DISPATCH,
        link: '/dashboard/incoming?tab=toDispatch',
        load: incomingTab('toDispatch', ['receivedAt', 'createdAt']),
      },
      {
        key: 'dispatchToValidate',
        permission: Permission.INCOMING_DISPATCH_VALIDATE,
        link: '/dashboard/incoming?tab=dispatchPending',
        load: incomingTab('dispatchPending', [
          'proposedAt',
          'receivedAt',
          'createdAt',
        ]),
      },
      {
        // Assign a supervisor, create the instructions, close once they are all done.
        key: 'incomingToHandle',
        permission: Permission.INCOMING_READ,
        link: toProcess('incoming'),
        load: courriers(
          {
            ...incoming,
            OR: [
              {
                status: CourrierStatus.TRANSMIS,
                ownerId: userId,
                supervisorId: null,
              },
              {
                status: CourrierStatus.TRANSMIS,
                supervisorId: userId,
                instructions: { none: {} },
              },
              {
                status: CourrierStatus.EN_TRAITEMENT,
                OR: [{ supervisorId: userId }, { ownerId: userId }],
                instructions: {
                  some: {},
                  every: { status: InstructionStatus.TERMINEE },
                },
              },
            ],
          },
          ['transmittedAt', 'dispatchValidatedAt', 'receivedAt', 'createdAt'],
        ),
      },
      {
        key: 'tasksToSubscribe',
        permission: null,
        link: toProcess('instructions'),
        load: instructions({
          status: InstructionStatus.AFFECTEE,
          assignees: { some: executant },
          subscriptions: { none: { userId } },
        }),
      },
      {
        // The executant who subscribed (or any executant while nobody did) deposits or corrects.
        key: 'tasksToDeliver',
        permission: null,
        link: toProcess('instructions'),
        load: instructions({
          status: {
            in: [
              InstructionStatus.ACCEPTEE,
              InstructionStatus.EN_COURS,
              InstructionStatus.A_CORRIGER,
            ],
          },
          assignees: { some: executant },
          OR: [
            {
              subscriptions: {
                none: { decision: SubscriptionDecision.SOUSCRITE },
              },
            },
            {
              subscriptions: {
                some: { userId, decision: SubscriptionDecision.SOUSCRITE },
              },
            },
          ],
        }),
      },
      {
        // Nobody subscribed: back to its superviseur, or its creator without one.
        key: 'tasksToReassign',
        permission: Permission.INSTRUCTION_REASSIGN,
        link: toProcess('instructions'),
        load: instructions({
          status: InstructionStatus.NON_SOUSCRITE,
          OR: [
            { assignees: { some: supervisor } },
            {
              createdById: userId,
              assignees: { none: { role: UserInstructionRole.SUPERVISEUR } },
            },
          ],
        }),
      },
      {
        key: 'livrablesToReview',
        permission: null,
        link: toProcess('instructions'),
        load: async () => {
          const where: Prisma.LivrableWhereInput = {
            ...submitted,
            instruction: {
              status: {
                notIn: [
                  InstructionStatus.ANNULEE,
                  InstructionStatus.TERMINEE,
                  InstructionStatus.NON_SOUSCRITE,
                ],
              },
            },
            OR: [
              // My opinion as validateur (step 0).
              {
                validationStep: 0,
                instruction: {
                  assignees: {
                    some: { userId, role: UserInstructionRole.VALIDATEUR },
                  },
                },
              },
              // My decision as superviseur (step 1, or from 0 without a validateur).
              {
                instruction: { assignees: { some: supervisor } },
                OR: [
                  { validationStep: { gte: 1 } },
                  {
                    instruction: {
                      assignees: {
                        none: { role: UserInstructionRole.VALIDATEUR },
                      },
                    },
                  },
                ],
              },
            ],
          };
          const [total, rows] = await Promise.all([
            db.livrable.count({ where }),
            db.livrable.findMany({
              where,
              select: { updatedAt: true },
              orderBy: { updatedAt: 'asc' },
              take: READ,
            }),
          ]);
          // Submitted: its last change.
          return { total, since: rows.map((row) => row.updatedAt) };
        },
      },
      {
        // Designation, not permission: the dossier's (contract's, company's) responsible.
        key: 'outgoingToValidate',
        permission: null,
        link: toProcess('outgoing'),
        load: courriers(awaitingValidationBy(userId), [
          'submittedAt',
          'updatedAt',
        ]),
      },
      {
        key: 'outgoingToCorrect',
        permission: Permission.OUTGOING_READ,
        link: toProcess('outgoing'),
        load: courriers(
          {
            ...outgoing,
            status: CourrierStatus.A_CORRIGER,
            createdById: userId,
          },
          ['updatedAt'],
        ),
      },
      {
        // Authorised: record the signed scan; signed: send it.
        key: 'outgoingToSend',
        permission: Permission.OUTGOING_SEND,
        link: toProcess('outgoing'),
        load: courriers(
          {
            ...outgoing,
            status: { in: [CourrierStatus.VALIDE, CourrierStatus.SIGNE] },
            ...handles,
          },
          ['approvedAt', 'updatedAt'],
        ),
      },
      {
        key: 'outgoingToDischarge',
        permission: Permission.OUTGOING_READ,
        link: toProcess('outgoing'),
        load: courriers(
          { ...outgoing, status: CourrierStatus.ENVOYE, ...handles },
          ['transmittedAt', 'updatedAt'],
        ),
      },
    ];
  }

  /** Role delegations running now or planned: those I hold and those covering me. */
  private async delegations(userId: string): Promise<PortalDelegation[]> {
    const now = new Date();
    const person = { select: { id: true, name: true } };
    const rows = await this.database.delegation.findMany({
      where: {
        OR: [{ delegantId: userId }, { delegataireId: userId }],
        endDate: { gte: now },
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        delegantId: true,
        delegant: person,
        delegataire: person,
      },
      orderBy: { startDate: 'asc' },
      take: 10,
    });
    return rows.map((row) => {
      const covered = row.delegantId === userId;
      const other = covered ? row.delegataire : row.delegant;
      return {
        id: row.id,
        side: covered ? 'COVERED' : 'ACTING',
        status: row.startDate <= now ? 'ACTIVE' : 'UPCOMING',
        person: { id: other.id, ...splitName(other.name) },
        startsAt: row.startDate,
        endsAt: row.endDate,
      };
    });
  }

  /**
   * The latest notifications of the bell (archived ones left out): the type's title in the
   * person's language, the text as written. Diffusion keeps no read date: a read one shows
   * its sending date.
   */
  private async notifications(
    userId: string,
    language: PortalLanguage,
  ): Promise<PortalNotification[]> {
    const rows = await this.database.userNotification.findMany({
      where: { userId, status: { not: NotificationStatus.ARCHIVED } },
      select: {
        status: true,
        notification: {
          select: {
            id: true,
            type: true,
            message: true,
            params: true,
            instructionId: true,
            courrierId: true,
            dossierId: true,
            createdAt: true,
            courrier: { select: { direction: true } },
          },
        },
      },
      orderBy: { notification: { createdAt: 'desc' } },
      take: NOTIFICATIONS,
    });
    return rows.map(({ status, notification: n }) => {
      const title = (NOTIFICATION_TITLES[n.type] ?? NOTIFICATION_FALLBACK)[
        language
      ];
      // Where the bell opens it (diffusion-ui components/shell/use-bell-notifications.ts).
      const link = n.instructionId
        ? `/dashboard/tasks/${n.instructionId}`
        : n.courrierId
          ? n.courrier?.direction === CourrierDirection.SORTANT
            ? `/dashboard/outgoing/${n.courrierId}`
            : `/dashboard/incoming/${n.courrierId}`
          : n.dossierId
            ? `/dashboard/dossiers/${n.dossierId}`
            : null;
      return {
        id: n.id,
        kind: n.type,
        title,
        // In the reader's language from its params (as the bell), else the text as written.
        body:
          notificationBody(n.type, readParams(n.params), language) ??
          n.message ??
          title,
        link,
        readAt: status === NotificationStatus.NOT_READ ? null : n.createdAt,
        createdAt: n.createdAt,
      };
    });
  }

  /** The part's answer, or null when it fails or is too slow (logged). */
  private async soft<T>(part: string, work: Promise<T>): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(`portal summary: ${part} took too long, left out`);
        resolve(null);
      }, KIND_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        work.catch((error: unknown) => {
          this.logger.warn(
            `portal summary: ${part} left out: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
