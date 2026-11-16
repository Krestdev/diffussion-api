import { NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { NotificationStatus } from '../../generated/prisma/enums';
import { AnalysisController } from '../../analysis/analysis.controller';
import { FindAnalysisSheetsQueryDto } from '../../analysis/dto/analysis.dto';
import { AuthController } from '../../auth/auth.controller';
import { PERMISSION_LABELS } from '../../auth/permission-labels';
import { DashboardController } from '../../dashboard/dashboard.controller';
import { DashboardOverviewQueryDto } from '../../dashboard/dto/dashboard-overview.query.dto';
import { DossierController } from '../../domain/dossier/dossier.controller';
import { FindDossiersQueryDto } from '../../domain/dossier/dto/find-dossiers.query.dto';
import { FindMailsQueryDto } from '../../domain/mail/dto/find-mails.query.dto';
import { MailController } from '../../domain/mail/mail.controller';
import { FindMyTasksQueryDto } from '../../instructions/dto/find-my-tasks.query.dto';
import { InstructionsController } from '../../instructions/instructions.controller';
import { NotificationsController } from '../../notifications/notifications.controller';
import { ContractController } from '../../referentials/contract/contract.controller';
import { FindContractsQueryDto } from '../../referentials/contract/dto/find-contracts.query.dto';
import { CorrespondantController } from '../../referentials/correspondent/correspondent.controller';
import { FindCorrespondantsQueryDto } from '../../referentials/correspondent/dto/find-correspondents.query.dto';
import { FindProjectsQueryDto } from '../../referentials/project/dto/find-projects.query.dto';
import { ProjectController } from '../../referentials/project/project.controller';
import { dtoShape } from '../dto-schema';
import { EFFET_LINK, LINKS } from '../links';
import { linkOf, shape } from '../mcp-result';
import {
  defineTool,
  type ToolContext,
  type ToolLink,
  ToolLevel,
  pageInput,
} from '../mcp-tool';
import { restTool } from '../rest-tool';

const PER_KIND = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fields a short search row keeps. */
const SHORT = [
  'id',
  'number',
  'reference',
  'code',
  'direction',
  'subject',
  'title',
  'name',
  'status',
  'link',
];
/** The fields a reference is matched on, exactly (case and spaces aside). */
const REFERENCE_FIELDS = [
  'number',
  'reference',
  'code',
  'bordereauNumber',
  'tenderReference',
  'refBL',
];

type Row = Record<string, unknown>;

/** One kind of record: its search (the user's own view of its list) and its detail. */
type Kind = {
  kind: string;
  /** What `entity` says in find_by_reference. */
  entity: string;
  link: ToolLink;
  search: (ctx: ToolContext, text: string, take: number) => Promise<unknown>;
  read: (ctx: ToolContext, id: string) => Promise<unknown>;
};

const KINDS: Kind[] = [
  {
    kind: 'effets',
    entity: 'Effet',
    link: EFFET_LINK,
    search: async (ctx, search, take) =>
      ctx.call(
        MailController,
        'findAll',
        await ctx.dto(FindMailsQueryDto, { search, take }),
        ctx.user,
      ),
    read: (ctx, id) => ctx.call(MailController, 'findOne', id, ctx.user),
  },
  {
    kind: 'tasks',
    entity: 'Instruction',
    link: LINKS.task,
    // The tasks the user takes part in (executant, supervisor, validator), every tab.
    search: async (ctx, search, take) =>
      ctx.call(
        InstructionsController,
        'findMyTasks',
        await ctx.dto(FindMyTasksQueryDto, { tab: 'all', search, take }),
        ctx.user,
      ),
    read: (ctx, id) =>
      ctx.call(InstructionsController, 'findOne', id, ctx.user),
  },
  {
    kind: 'dossiers',
    entity: 'Dossier',
    link: LINKS.dossier,
    search: async (ctx, search, take) =>
      ctx.call(
        DossierController,
        'findAll',
        await ctx.dto(FindDossiersQueryDto, { search, take }),
        ctx.user,
      ),
    read: (ctx, id) => ctx.call(DossierController, 'findOne', id, ctx.user),
  },
  {
    kind: 'contracts',
    entity: 'Contract',
    link: LINKS.contract,
    search: async (ctx, search, take) =>
      ctx.call(
        ContractController,
        'findAll',
        await ctx.dto(FindContractsQueryDto, { search, take }),
        ctx.user,
      ),
    read: (ctx, id) => ctx.call(ContractController, 'findOne', id, ctx.user),
  },
  {
    kind: 'projects',
    entity: 'Project',
    link: LINKS.project,
    search: async (ctx, search, take) =>
      ctx.call(
        ProjectController,
        'findAll',
        await ctx.dto(FindProjectsQueryDto, { search, take }),
        ctx.user,
      ),
    read: (ctx, id) => ctx.call(ProjectController, 'findOne', id, ctx.user),
  },
  {
    kind: 'analysisSheets',
    entity: 'AnalysisSheet',
    link: LINKS.analysisSheet,
    search: async (ctx, search, take) =>
      ctx.call(
        AnalysisController,
        'findAll',
        await ctx.dto(FindAnalysisSheetsQueryDto, { search, take }),
        ctx.user,
      ),
    read: (ctx, id) => ctx.call(AnalysisController, 'findOne', id, ctx.user),
  },
  {
    kind: 'correspondents',
    entity: 'Correspondent',
    link: LINKS.correspondent,
    search: async (ctx, search, take) =>
      ctx.call(
        CorrespondantController,
        'findAll',
        await ctx.dto(FindCorrespondantsQueryDto, { search, take }),
        ctx.user,
      ),
    read: (ctx, id) =>
      ctx.call(CorrespondantController, 'findOne', id, ctx.user),
  },
];

/** The rows of a list answer (a page `{ data }` or an array). */
const rowsOf = (value: unknown): Row[] => {
  if (Array.isArray(value)) return value as Row[];
  const data = (value as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as Row[]) : [];
};

const short = (row: Row): Row =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => SHORT.includes(key)),
  );

const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** Runs `each` on every kind, keeping those that answer: a list one may not read is skipped. */
type Answer = { kind: Kind; value: unknown };

async function eachKind(
  run: (kind: Kind) => Promise<unknown>,
): Promise<Answer[]> {
  const found: Answer[] = [];
  await Promise.all(
    KINDS.map(async (kind) => {
      try {
        const value: unknown = await run(kind);
        if (value !== undefined) found.push({ kind, value });
      } catch {
        // A list the user may not read is simply not searched.
      }
    }),
  );
  // In the order of KINDS, whatever answered first.
  return KINDS.flatMap((kind) => found.filter((f) => f.kind === kind));
}

const NOTIFICATION_STATUSES = Object.values(NotificationStatus) as [
  NotificationStatus,
  ...NotificationStatus[],
];

/** The overview's query, the company being the user's unless another is named. */
const overviewShape = dtoShape(DashboardOverviewQueryDto);
delete overviewShape.companyId;

export const CORE_TOOLS = [
  // ------------------------------------------------------------- who am I
  defineTool({
    name: 'get_me',
    title: 'Who am I',
    description:
      'The signed-in user: name, email, language (answer in it), company, roles, permission ' +
      'codes, delegations and what they are responsible for (companies, projects, contracts, ' +
      'dossiers). Use it to know who the user is and what they may do before suggesting an ' +
      'action.',
    level: ToolLevel.READ,
    input: {},
    route: [AuthController, 'me'],
    run: (_args, ctx) => ctx.call(AuthController, 'me', ctx.user, ctx.request),
  }),
  defineTool({
    name: 'get_my_permissions',
    title: 'What I may do',
    description:
      "The user's permission codes in their company (from their roles and the delegations " +
      'in force), each with its label in their language. Use for "what can I do", "why ' +
      "can't I…\" (compare with a record's `unavailable` reason NO_PERMISSION).",
    level: ToolLevel.READ,
    input: {},
    run: (_args, ctx) => {
      const language = ctx.request.core?.account.language;
      const lang = language === 'fr' || language === 'it' ? language : 'en';
      const permissions = [...ctx.user.permissions].sort().map((code) => ({
        code,
        label: PERMISSION_LABELS[code]?.[lang],
      }));
      return Promise.resolve({
        platformAdmin: ctx.user.platformAdmin || undefined,
        permissions,
      });
    },
  }),

  // ------------------------------------------------------------- notifications
  defineTool({
    name: 'list_notifications',
    title: 'My notifications',
    description:
      "The user's notifications, newest first: what happened (an effet to dispatch or " +
      'validate, a task assigned, a livrable submitted…), on which effet (its direction), ' +
      'read or not. Use for "what\'s new", "what do I have to do". Returns one page and the ' +
      'total.',
    level: ToolLevel.READ,
    input: {
      status: z
        .enum(NOTIFICATION_STATUSES)
        .optional()
        .describe('NOT_READ, READ or ARCHIVED (default: all)'),
      page: pageInput.page,
      limit: pageInput.limit,
    },
    route: [NotificationsController, 'findMine'],
    run: async ({ status, page, limit }, ctx) => {
      const all = await ctx.call(
        NotificationsController,
        'findMine',
        ctx.user,
        status,
      );
      const skip = (page - 1) * limit;
      return {
        data: all.slice(skip, skip + limit),
        total: all.length,
        skip,
        take: limit,
      };
    },
  }),
  defineTool({
    name: 'get_unread_count',
    title: 'Unread notifications',
    description: 'How many notifications the user has not read yet.',
    level: ToolLevel.READ,
    input: {},
    route: [NotificationsController, 'findMine'],
    run: async (_args, ctx) => ({
      unread: (
        await ctx.call(
          NotificationsController,
          'findMine',
          ctx.user,
          NotificationStatus.NOT_READ,
        )
      ).length,
    }),
  }),

  // ------------------------------------------------------------- search
  defineTool({
    name: 'global_search',
    title: 'Search everything',
    description:
      'Find records of any kind by id, number, reference or words: effets (incoming and ' +
      'outgoing mail: number M-…, reference, subject, correspondent), tasks (instructions ' +
      'the user takes part in: T-…, title), dossiers (D-… or their number, title), contracts ' +
      '(CT-…, reference, title), projects (reference, name), analysis sheets (FA-…, title, ' +
      'effet subject) and correspondents (CP-…, name, email, phone). A UUID finds the record ' +
      'itself. Use first when the user names something without saying what it is. Returns ' +
      'up to 5 short matches per kind, each with its `link`, only among what the user may ' +
      'see; then open one with find_by_reference or the matching get_* tool.',
    level: ToolLevel.READ,
    input: {
      text: z
        .string()
        .trim()
        .min(2)
        .max(100)
        .describe('Id, number, reference or words to look for'),
    },
    run: async ({ text }, ctx) => {
      const found: Record<string, Row[]> = {};
      if (UUID.test(text)) {
        for (const { kind, value } of await eachKind((kind) =>
          kind.read(ctx, text),
        )) {
          const row = shape(value, kind.link) as Row | undefined;
          if (row) found[kind.kind] = [short(row)];
        }
        return found;
      }
      for (const { kind, value } of await eachKind((kind) =>
        kind.search(ctx, text, PER_KIND),
      )) {
        const rows = rowsOf(value)
          .slice(0, PER_KIND)
          .map((row) => shape(row, kind.link) as Row)
          .filter(Boolean)
          .map(short);
        if (rows.length) found[kind.kind] = rows;
      }
      return found;
    },
  }),
  defineTool({
    name: 'find_by_reference',
    title: 'Open a record by its reference',
    description:
      'The record a number or reference stands for, read in full with the actions the user ' +
      'can take on it: an effet (number M-000123, or its reference: the one printed on an ' +
      "incoming letter, SOR-2026-000123 or the effet type's model for an outgoing one), a " +
      'task (T-…), a dossier (D-… or its own number such as DOS-2026-014), a contract (CT-… ' +
      'or its reference), a project (its reference, e.g. PRJ-2026-07), an analysis sheet ' +
      "(FA-…) or a correspondent (CP-…). Case and spaces don't matter. Returns { entity, id, " +
      'reference, link, record }, or { matches } when several records carry it; NOT_FOUND ' +
      'when none the user may see does.',
    level: ToolLevel.READ,
    input: {
      reference: z
        .string()
        .trim()
        .min(2)
        .max(100)
        .describe('The number or reference, e.g. M-000123 or FA-004512'),
    },
    run: async ({ reference }, ctx) => {
      const wanted = normalize(reference);
      const matches: { kind: Kind; row: Row }[] = [];
      for (const { kind, value } of await eachKind((kind) =>
        kind.search(ctx, reference.trim(), 10),
      )) {
        for (const row of rowsOf(value)) {
          const hit = REFERENCE_FIELDS.some(
            (field) =>
              typeof row[field] === 'string' &&
              normalize(row[field]) === wanted,
          );
          if (hit) matches.push({ kind, row });
        }
      }
      if (!matches.length) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `Nothing the user may see carries the reference ${reference}`,
          params: { reference },
        });
      }
      if (matches.length > 1) {
        return {
          matches: matches.map(({ kind, row }) => ({
            entity: kind.entity,
            ...short(shape(row, kind.link) as Row),
          })),
        };
      }
      const [{ kind, row }] = matches;
      const id = String(row.id);
      return {
        entity: kind.entity,
        id,
        reference,
        link: linkOf(kind.link, row),
        record: shape(await kind.read(ctx, id)),
      };
    },
  }),

  // ------------------------------------------------------------- dashboard
  defineTool({
    name: 'get_dashboard_overview',
    title: 'Dashboard overview',
    description:
      "The company dashboard's figures for a period (default the last 30 days, compared " +
      'with the previous one): effets received and sent, in progress and late, tasks and ' +
      'their lateness, processing times, workload, by project, contract, dossier, team, ' +
      'supervisor or effet type when filtered. Use for "how are we doing", "how many late ' +
      'effets this month", "the situation of project X".',
    level: ToolLevel.READ,
    input: {
      ...overviewShape,
      companyId: z
        .uuid()
        .optional()
        .describe("The company (default: the user's own)"),
    },
    route: [DashboardController, 'overview'],
    run: async (args, ctx) =>
      ctx.call(
        DashboardController,
        'overview',
        await ctx.dto(DashboardOverviewQueryDto, {
          ...args,
          companyId: args.companyId ?? ctx.user.companyId,
        }),
        ctx.user,
      ),
  }),
  restTool({
    name: 'get_dashboard_stats',
    title: 'Dashboard trends',
    description:
      "The home page's activity trends over the last days (effets received, sent and " +
      "closed, tasks…), for the user's own work or the whole company (scope). Use for " +
      '"what happened this week".',
    level: ToolLevel.READ,
    route: [DashboardController, 'getStats'],
  }),
];
