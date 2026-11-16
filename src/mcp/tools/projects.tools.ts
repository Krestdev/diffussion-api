import { NotFoundException, type Type } from '@nestjs/common';
import { z } from 'zod';
import { ActivityController } from '../../activity/activity.controller';
import { FindActivityLogsQueryDto } from '../../activity/dto/find-activity-logs.query.dto';
import { FindMyActivityQueryDto } from '../../activity/dto/find-my-activity.query.dto';
import { DelegationController } from '../../administration/delegation/delegation.controller';
import { PermissionController } from '../../administration/permission/permission.controller';
import { FindRolesQueryDto } from '../../administration/role/dto/find-roles.query.dto';
import { RoleController } from '../../administration/role/role.controller';
import { UpdateDocumentIdentityDto } from '../../administration/settings/dto/document-identity.dto';
import { SettingsController } from '../../administration/settings/settings.controller';
import { FindDirectoryQueryDto } from '../../administration/users/dto/find-directory.query.dto';
import { FindUsersQueryDto } from '../../administration/users/dto/find-users.query.dto';
import { UsersController } from '../../administration/users/users.controller';
import { Permission } from '../../auth/permissions';
import { FindCompanyListQueryDto } from '../../common/dto/company-list-item.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { DocumentsController } from '../../documents/documents.controller';
import { FindDocumentsQueryDto } from '../../documents/dto/find-documents.query.dto';
import { DossierController } from '../../domain/dossier/dossier.controller';
import { FindDossiersQueryDto } from '../../domain/dossier/dto/find-dossiers.query.dto';
import { NotificationsController } from '../../notifications/notifications.controller';
import { CanalController } from '../../referentials/canal/canal.controller';
import { CategoryController } from '../../referentials/category/category.controller';
import { CompanyController } from '../../referentials/company/company.controller';
import { FindCompaniesQueryDto } from '../../referentials/company/dto/find-companies.query.dto';
import { ContractController } from '../../referentials/contract/contract.controller';
import { FindContractsQueryDto } from '../../referentials/contract/dto/find-contracts.query.dto';
import { ContractTypeController } from '../../referentials/contract-type/contract-type.controller';
import { FindContractTypesQueryDto } from '../../referentials/contract-type/contract-type.service';
import { CorrespondentTypeController } from '../../referentials/correspondent-type/correspondent-type.controller';
import { CourrierNatureController } from '../../referentials/courrier-nature/courrier-nature.controller';
import { DossierTypeController } from '../../referentials/dossier-type/dossier-type.controller';
import { EffetTypeController } from '../../referentials/effet-type/effet-type.controller';
import { FindProjectsQueryDto } from '../../referentials/project/dto/find-projects.query.dto';
import { UpdateProjectDto } from '../../referentials/project/dto/update-project.dto';
import { ProjectController } from '../../referentials/project/project.controller';
import { CreateSupportTicketDto } from '../../support/dto/support.dto';
import { SupportController } from '../../support/support.controller';
import { dtoShape } from '../dto-schema';
import { EFFET_LINK, LINKS } from '../links';
import {
  byIdOrReference,
  defineTool,
  id,
  idOrReference,
  type McpTool,
  pageInput,
  query,
  type ToolContext,
  ToolDomain,
  ToolLevel,
  type ToolLink,
} from '../mcp-tool';
import { restTool } from '../rest-tool';

const { READ, WRITE, DECISION, ADMIN } = ToolLevel;
const { PROJECTS, ORGANIZATION, SETTINGS, CORE } = ToolDomain;

const ONCE =
  ' One workflow step: applied once, refused if the record moved on. ' +
  "Check the record's `available` actions first.";
const REASON =
  ' A reason is required: draft it from what the user said and let them confirm it.';
const CAREFUL =
  " This changes how the whole company works: restate the change and get the user's " +
  'agreement first.';
const COMMON =
  ' The list is common to every company: only a Diffusion super-administrator may change it.';

/** UI pages without a record id (constant links on the rows of a list). */
const page =
  (path: string): ToolLink =>
  () =>
    path;
const ROLES_PAGE = page('/dashboard/admin/roles');
const AUDIT_PAGE = page('/dashboard/admin/audit-log');
const SUPPORT_PAGE = page('/dashboard/help/support');

// ------------------------------------------------------------------ helpers

type Row = Record<string, unknown>;
const REFERENCE_FIELDS = ['number', 'reference', 'code'];
const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** The id of the one row whose number / reference / code is `reference` (NOT_FOUND else). */
function idByReference(entity: string, reference: string, list: unknown) {
  const rows = Array.isArray(list)
    ? (list as Row[])
    : ((list as { data?: Row[] } | null)?.data ?? []);
  const wanted = normalize(reference);
  const hit = rows.find((row) =>
    REFERENCE_FIELDS.some(
      (field) =>
        typeof row[field] === 'string' && normalize(row[field]) === wanted,
    ),
  );
  if (!hit) {
    throw new NotFoundException({
      code: 'NOT_FOUND',
      message: `No ${entity} the user may see carries the reference ${reference}`,
      params: { reference },
    });
  }
  return String(hit.id);
}

/**
 * A list route as a tool: the query DTO's filters, `page` / `limit` instead of `skip` /
 * `take`, plus extra arguments (`params`, e.g. the record's id) handed to `call` only.
 */
function paged<Q extends object>(options: {
  name: string;
  title: string;
  description: string;
  domain: ToolDomain;
  route: [Type<unknown>, string];
  dto: Type<Q>;
  call: (ctx: ToolContext, dto: Q, args: Row) => Promise<unknown>;
  params?: z.ZodRawShape;
  omit?: string[];
  link?: ToolLink;
  visibleTo?: readonly Permission[];
}): McpTool {
  const shape: Record<string, z.ZodType> = { ...dtoShape(options.dto) };
  const pages = 'take' in shape;
  for (const field of ['skip', 'take', ...(options.omit ?? [])]) {
    delete shape[field];
  }
  const params = options.params ?? {};
  return defineTool({
    name: options.name,
    title: options.title,
    description: options.description,
    level: READ,
    domain: options.domain,
    route: options.route,
    link: options.link,
    visibleTo: options.visibleTo,
    input: {
      ...params,
      ...shape,
      ...(pages ? { page: pageInput.page, limit: pageInput.limit } : {}),
    },
    run: async (args: Row, ctx) => {
      const rest: Row = { ...args };
      for (const key of Object.keys(params)) delete rest[key];
      const plain = pages ? query(rest) : rest;
      return options.call(ctx, await ctx.dto(options.dto, plain), args);
    },
  });
}

/** A restTool shown only to holders of one of the permissions (the service checks itself). */
const only = (tool: McpTool, ...visibleTo: Permission[]): McpTool => ({
  ...tool,
  visibleTo,
});

const reasonInput = (what: string) =>
  z.string().trim().min(1).max(1000).describe(`Why the ${what} is archived`);
const noteInput = (what: string) =>
  z
    .string()
    .trim()
    .max(1000)
    .optional()
    .describe(`Why the ${what} is brought back (kept in its history)`);

// ------------------------------------------------------------------ projects

/** UpdateProjectDto without its workflow fields: status changes have their own tools. */
const projectEditShape: Record<string, z.ZodType> = {
  ...dtoShape(UpdateProjectDto),
};
for (const field of ['status', 'reason', 'note'])
  delete projectEditShape[field];

/** A project status change (PATCH /projects/:id { status }). */
function projectTransition(options: {
  name: string;
  title: string;
  description: string;
  status: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  extra?: 'reason' | 'note';
  permission: Permission;
}): McpTool {
  return defineTool({
    name: options.name,
    title: options.title,
    description: options.description,
    level: DECISION,
    domain: PROJECTS,
    route: [ProjectController, 'update'],
    visibleTo: [options.permission],
    link: LINKS.project,
    preview: 'get_project',
    input: {
      id: id('project'),
      ...(options.extra === 'reason' ? { reason: reasonInput('project') } : {}),
      ...(options.extra === 'note' ? { note: noteInput('project') } : {}),
    },
    run: async (args: Row, ctx) =>
      ctx.call(
        ProjectController,
        'update',
        String(args.id),
        await ctx.dto(UpdateProjectDto, {
          status: options.status,
          reason: options.extra === 'reason' ? args.reason : undefined,
          note: options.extra === 'note' ? args.note : undefined,
        }),
        ctx.user,
      ),
  });
}

const PROJECT_TOOLS_LIST: McpTool[] = [
  paged({
    name: 'search_projects',
    title: 'Search projects',
    description:
      "The company's projects the user may open, by name or reference and status (ACTIVE, " +
      'CLOSED, ARCHIVED), with their figures (effets, contracts, dossiers in progress). Use ' +
      'for "our projects", "the project X". Returns one page and the total, each with its ' +
      '`link`; open one with get_project.',
    domain: PROJECTS,
    route: [ProjectController, 'findAll'],
    dto: FindProjectsQueryDto,
    link: LINKS.project,
    call: (ctx, dto) => ctx.call(ProjectController, 'findAll', dto, ctx.user),
  }),
  defineTool({
    name: 'get_project',
    title: 'Open a project',
    description:
      'A project in full, by id or by its reference (e.g. PRJ-2026-07): content type ' +
      "(dossiers or contracts), maître d'ouvrage, responsible, dates, status, figures, and " +
      '`available` / `unavailable` actions (edit, close, reopen, archive, unarchive, ' +
      'delete). Projects are mirrored from the CREAPP core; edits made here stay in Diffusion.',
    level: READ,
    domain: PROJECTS,
    route: [ProjectController, 'findOne'],
    link: LINKS.project,
    input: idOrReference('project', 'PRJ-2026-07'),
    run: (args, ctx) =>
      byIdOrReference(
        args,
        (projectId) =>
          ctx.call(ProjectController, 'findOne', projectId, ctx.user),
        async (reference) =>
          ctx.call(
            ProjectController,
            'findOne',
            idByReference(
              'project',
              reference,
              await ctx.call(
                ProjectController,
                'findAll',
                await ctx.dto(FindProjectsQueryDto, {
                  search: reference,
                  take: 10,
                }),
                ctx.user,
              ),
            ),
            ctx.user,
          ),
      ),
  }),
  paged({
    name: 'get_project_history',
    title: 'Project history',
    description:
      "A project's history, newest first: creation, edits, status changes with their " +
      'reason, who did what and when. Returns one page and the total.',
    domain: PROJECTS,
    route: [ProjectController, 'history'],
    dto: PaginationQueryDto,
    params: { id: id('project') },
    call: (ctx, dto, args) =>
      ctx.call(ProjectController, 'history', String(args.id), dto, ctx.user),
  }),
  restTool({
    name: 'get_project_access',
    title: 'Who may open a project',
    description:
      'The users allowed to open a project (an empty list: everyone with project.read).',
    level: READ,
    domain: PROJECTS,
    route: [ProjectController, 'getAccess'],
    ids: { id: 'project' },
  }),
  restTool({
    name: 'create_project',
    title: 'Create a project',
    description:
      'Create a project in Diffusion: name, content type (DOSSIERS: dossiers directly, ' +
      'CONTRACTS: contracts with their dossiers), optional reference, mode, maître ' +
      "d'ouvrage (id or name), responsible and dates. Returns the new project with its `link`.",
    level: WRITE,
    domain: PROJECTS,
    route: [ProjectController, 'create'],
    link: LINKS.project,
  }),
  defineTool({
    name: 'update_project',
    title: 'Edit a project',
    description:
      "Change a project's details (name, reference, mode, maître d'ouvrage, responsible, " +
      'dates, content type while it is empty). Status changes have their own tools ' +
      '(close_project, reopen_project, archive_project, unarchive_project). Returns the project.',
    level: WRITE,
    domain: PROJECTS,
    route: [ProjectController, 'update'],
    visibleTo: [Permission.PROJECT_UPDATE],
    link: LINKS.project,
    preview: 'get_project',
    input: { id: id('project'), ...projectEditShape },
    run: async (args: Row, ctx) => {
      const { id: projectId, ...fields } = args;
      return ctx.call(
        ProjectController,
        'update',
        String(projectId),
        await ctx.dto(UpdateProjectDto, fields),
        ctx.user,
      );
    },
  }),
  projectTransition({
    name: 'close_project',
    title: 'Close a project',
    description:
      'Close an ACTIVE project: its contracts and dossiers follow. Returns the project.' +
      ONCE,
    status: 'CLOSED',
    permission: Permission.PROJECT_UPDATE,
  }),
  projectTransition({
    name: 'reopen_project',
    title: 'Reopen a project',
    description:
      'Reopen a CLOSED project (back to ACTIVE). Returns the project.' + ONCE,
    status: 'ACTIVE',
    permission: Permission.PROJECT_UPDATE,
  }),
  projectTransition({
    name: 'archive_project',
    title: 'Archive a project',
    description:
      'Archive a CLOSED project, with everything in it. Returns the project.' +
      ONCE +
      REASON,
    status: 'ARCHIVED',
    extra: 'reason',
    permission: Permission.PROJECT_ARCHIVE,
  }),
  projectTransition({
    name: 'unarchive_project',
    title: 'Unarchive a project',
    description:
      'Bring an ARCHIVED project back to CLOSED (reopen_project then makes it ACTIVE). ' +
      'Returns the project.' +
      ONCE,
    status: 'CLOSED',
    extra: 'note',
    permission: Permission.PROJECT_ARCHIVE,
  }),
  restTool({
    name: 'delete_project',
    title: 'Delete a project',
    description:
      'Delete a project for good: refused while dossiers or contracts still refer to it ' +
      '(archive it instead). Returns { done: true }.',
    level: DECISION,
    domain: PROJECTS,
    route: [ProjectController, 'remove'],
    ids: { id: 'project' },
  }),
  only(
    restTool({
      name: 'set_project_access',
      title: 'Restrict who may open a project',
      description:
        'Replace the list of users allowed to open a project (userIds; an empty list opens ' +
        "it to everyone). Only the project's responsible or a company administrator may. " +
        'Returns the new list.',
      level: ADMIN,
      domain: SETTINGS,
      route: [ProjectController, 'setAccess'],
      ids: { id: 'project' },
    }),
    Permission.PROJECT_UPDATE,
    Permission.SETTINGS_UPDATE,
  ),

  // ------------------------------------------------------------------ contracts
  paged({
    name: 'search_contracts',
    title: 'Search contracts',
    description:
      'Contracts the user may open: by reference / title, project, correspondent, status, ' +
      'type code, or ending within N days ("contracts ending this month"). Returns one ' +
      'page and the total, each with its `link`; open one with get_contract.',
    domain: PROJECTS,
    route: [ContractController, 'findAll'],
    dto: FindContractsQueryDto,
    link: LINKS.contract,
    call: (ctx, dto) => ctx.call(ContractController, 'findAll', dto, ctx.user),
  }),
  defineTool({
    name: 'get_contract',
    title: 'Open a contract',
    description:
      'A contract in full, by id or by its number / reference (CT-…): project, ' +
      'correspondent, type, amounts, dates, status, and `available` / `unavailable` actions.',
    level: READ,
    domain: PROJECTS,
    route: [ContractController, 'findOne'],
    link: LINKS.contract,
    input: idOrReference('contract', 'CT-000123'),
    run: (args, ctx) =>
      byIdOrReference(
        args,
        (contractId) =>
          ctx.call(ContractController, 'findOne', contractId, ctx.user),
        async (reference) =>
          ctx.call(
            ContractController,
            'findOne',
            idByReference(
              'contract',
              reference,
              await ctx.call(
                ContractController,
                'findAll',
                await ctx.dto(FindContractsQueryDto, {
                  search: reference,
                  take: 10,
                }),
                ctx.user,
              ),
            ),
            ctx.user,
          ),
      ),
  }),
  paged({
    name: 'get_contract_history',
    title: 'Contract history',
    description:
      "A contract's history, newest first: edits, archiving, who did what and when.",
    domain: PROJECTS,
    route: [ContractController, 'history'],
    dto: PaginationQueryDto,
    params: { id: id('contract') },
    call: (ctx, dto, args) =>
      ctx.call(ContractController, 'history', String(args.id), dto, ctx.user),
  }),
  restTool({
    name: 'get_contract_access',
    title: 'Who may open a contract',
    description:
      'The users allowed to open a contract (an empty list: everyone with contract.read).',
    level: READ,
    domain: PROJECTS,
    route: [ContractController, 'getAccess'],
    ids: { id: 'contract' },
  }),
  restTool({
    name: 'create_contract',
    title: 'Create a contract',
    description:
      'Create a contract in a project that holds contracts: title, reference, type code ' +
      '(list_contract_types), correspondent, amounts and dates. Returns the contract with ' +
      'its `link`.',
    level: WRITE,
    domain: PROJECTS,
    route: [ContractController, 'create'],
    link: LINKS.contract,
  }),
  restTool({
    name: 'update_contract',
    title: 'Edit a contract',
    description: "Change a contract's details. Returns the contract.",
    level: WRITE,
    domain: PROJECTS,
    route: [ContractController, 'update'],
    ids: { id: 'contract' },
    link: LINKS.contract,
  }),
  restTool({
    name: 'archive_contract',
    title: 'Archive a contract',
    description: 'Archive a contract. Returns the contract.' + ONCE + REASON,
    level: DECISION,
    domain: PROJECTS,
    route: [ContractController, 'archive'],
    ids: { id: 'contract' },
    link: LINKS.contract,
  }),
  restTool({
    name: 'unarchive_contract',
    title: 'Unarchive a contract',
    description:
      'Bring an archived contract back, with an optional note. Returns the contract.' +
      ONCE,
    level: DECISION,
    domain: PROJECTS,
    route: [ContractController, 'unarchive'],
    ids: { id: 'contract' },
    link: LINKS.contract,
  }),
  restTool({
    name: 'delete_contract',
    title: 'Delete a contract',
    description:
      'Delete a contract for good: refused while dossiers or effets refer to it (archive ' +
      'it instead). Returns { done: true }.',
    level: DECISION,
    domain: PROJECTS,
    route: [ContractController, 'remove'],
    ids: { id: 'contract' },
  }),
  only(
    restTool({
      name: 'set_contract_access',
      title: 'Restrict who may open a contract',
      description:
        'Replace the list of users allowed to open a contract (userIds; an empty list ' +
        "opens it to everyone). Only the contract's responsible or a company administrator " +
        'may. Returns the new list.',
      level: ADMIN,
      domain: SETTINGS,
      route: [ContractController, 'setAccess'],
      ids: { id: 'contract' },
    }),
    Permission.CONTRACT_UPDATE,
    Permission.SETTINGS_UPDATE,
  ),
  paged({
    name: 'list_contract_types',
    title: 'Contract types',
    description:
      'The contract types (code, label, description, active), common to every company: ' +
      "the codes a contract's `type` takes, and the ids the contract type tools act on.",
    domain: PROJECTS,
    route: [ContractTypeController, 'findAll'],
    dto: FindContractTypesQueryDto,
    call: (ctx, dto) => ctx.call(ContractTypeController, 'findAll', dto),
  }),

  // ------------------------------------------------------------------ dossiers
  paged({
    name: 'search_dossiers',
    title: 'Search dossiers',
    description:
      'Dossiers the user may open: by number / title, status, priority, responsible, ' +
      'project, correspondent or contract. Returns one page and the total, each with its ' +
      '`link`; open one with get_dossier.',
    domain: PROJECTS,
    route: [DossierController, 'findAll'],
    dto: FindDossiersQueryDto,
    link: LINKS.dossier,
    call: (ctx, dto) => ctx.call(DossierController, 'findAll', dto, ctx.user),
  }),
  defineTool({
    name: 'get_dossier',
    title: 'Open a dossier',
    description:
      'A dossier in full, by id or by its number (D-… or its own number such as ' +
      'DOS-2026-014): project, contract, correspondent, responsible, priority, status, ' +
      'figures and `available` / `unavailable` actions (edit, close, reopen, archive…).',
    level: READ,
    domain: PROJECTS,
    route: [DossierController, 'findOne'],
    link: LINKS.dossier,
    input: idOrReference('dossier', 'D-728391'),
    run: (args, ctx) =>
      byIdOrReference(
        args,
        (dossierId) =>
          ctx.call(DossierController, 'findOne', dossierId, ctx.user),
        async (reference) =>
          ctx.call(
            DossierController,
            'findOne',
            idByReference(
              'dossier',
              reference,
              await ctx.call(
                DossierController,
                'findAll',
                await ctx.dto(FindDossiersQueryDto, {
                  search: reference,
                  take: 10,
                }),
                ctx.user,
              ),
            ),
            ctx.user,
          ),
      ),
  }),
  paged({
    name: 'list_dossier_effets',
    title: "A dossier's effets",
    description:
      'The incoming and outgoing effets filed in a dossier. Returns one page and the ' +
      'total, each with its `link`.',
    domain: PROJECTS,
    route: [DossierController, 'getCourriers'],
    dto: PaginationQueryDto,
    params: { id: id('dossier') },
    link: EFFET_LINK,
    call: (ctx, dto, args) =>
      ctx.call(
        DossierController,
        'getCourriers',
        String(args.id),
        dto,
        ctx.user,
      ),
  }),
  paged({
    name: 'list_dossier_instructions',
    title: "A dossier's instructions",
    description:
      'The instructions (tasks) given in a dossier, with their status and people. Returns ' +
      'one page and the total, each with its `link`.',
    domain: PROJECTS,
    route: [DossierController, 'getInstructions'],
    dto: PaginationQueryDto,
    params: { id: id('dossier') },
    link: LINKS.task,
    call: (ctx, dto, args) =>
      ctx.call(
        DossierController,
        'getInstructions',
        String(args.id),
        dto,
        ctx.user,
      ),
  }),
  paged({
    name: 'list_dossier_livrables',
    title: "A dossier's livrables",
    description:
      'The livrables (deliverables) produced in a dossier, with their status. Returns one ' +
      'page and the total.',
    domain: PROJECTS,
    route: [DossierController, 'getLivrables'],
    dto: PaginationQueryDto,
    params: { id: id('dossier') },
    call: (ctx, dto, args) =>
      ctx.call(
        DossierController,
        'getLivrables',
        String(args.id),
        dto,
        ctx.user,
      ),
  }),
  restTool({
    name: 'get_dossier_history',
    title: 'Dossier history',
    description:
      "A dossier's audit history: what was done in it, by whom and when (audit.read).",
    level: READ,
    domain: PROJECTS,
    route: [DossierController, 'getHistorique'],
    ids: { id: 'dossier' },
  }),
  restTool({
    name: 'get_dossier_progress',
    title: 'Dossier progress',
    description:
      'How far a dossier has got: its effets and instructions done or open, late ones.',
    level: READ,
    domain: PROJECTS,
    route: [DossierController, 'getProgression'],
    ids: { id: 'dossier' },
  }),
  restTool({
    name: 'get_dossier_access',
    title: 'Who may open a dossier',
    description: 'The users allowed to view or edit a dossier.',
    level: READ,
    domain: PROJECTS,
    route: [DossierController, 'getAccess'],
    ids: { id: 'dossier' },
  }),
  restTool({
    name: 'create_dossier',
    title: 'Create a dossier',
    description:
      'Open a dossier: title, type (list_dossier_types), project, contract, correspondent, ' +
      'responsible, priority. Returns the dossier with its `link`.',
    level: WRITE,
    domain: PROJECTS,
    route: [DossierController, 'create'],
    link: LINKS.dossier,
  }),
  restTool({
    name: 'update_dossier',
    title: 'Edit a dossier',
    description: "Change a dossier's details. Returns the dossier.",
    level: WRITE,
    domain: PROJECTS,
    route: [DossierController, 'update'],
    ids: { id: 'dossier' },
    link: LINKS.dossier,
  }),
  restTool({
    name: 'close_dossier',
    title: 'Close a dossier',
    description:
      'Close a dossier (refused while instructions are open). Returns the dossier.' +
      ONCE,
    level: DECISION,
    domain: PROJECTS,
    route: [DossierController, 'close'],
    ids: { id: 'dossier' },
    link: LINKS.dossier,
  }),
  restTool({
    name: 'reopen_dossier',
    title: 'Reopen a dossier',
    description: 'Reopen a closed dossier. Returns the dossier.' + ONCE,
    level: DECISION,
    domain: PROJECTS,
    route: [DossierController, 'reopen'],
    ids: { id: 'dossier' },
    link: LINKS.dossier,
  }),
  restTool({
    name: 'archive_dossier',
    title: 'Archive a dossier',
    description:
      'Archive a closed dossier. Returns the dossier.' + ONCE + REASON,
    level: DECISION,
    domain: PROJECTS,
    route: [DossierController, 'archive'],
    ids: { id: 'dossier' },
    link: LINKS.dossier,
  }),
  restTool({
    name: 'unarchive_dossier',
    title: 'Unarchive a dossier',
    description:
      'Bring an archived dossier back, with an optional note. Returns the dossier.' +
      ONCE,
    level: DECISION,
    domain: PROJECTS,
    route: [DossierController, 'unarchive'],
    ids: { id: 'dossier' },
    link: LINKS.dossier,
  }),
  restTool({
    name: 'set_dossier_access',
    title: 'Set who may open a dossier',
    description:
      'Replace the list of users allowed to view / edit a dossier (entries: userId, ' +
      'canView, canEdit). Returns the new list.',
    level: ADMIN,
    domain: SETTINGS,
    route: [DossierController, 'setAccess'],
    ids: { id: 'dossier' },
  }),
  paged({
    name: 'list_dossier_types',
    title: 'Dossier types',
    description:
      "The company's dossier types (name, description, active): what a dossier's type " +
      'takes, and the ids the dossier type tools act on.',
    domain: PROJECTS,
    route: [DossierTypeController, 'findAll'],
    dto: FindCompanyListQueryDto,
    call: (ctx, dto) =>
      ctx.call(DossierTypeController, 'findAll', dto, ctx.user),
  }),
  paged({
    name: 'list_categories',
    title: 'Dossier categories',
    description:
      'The dossier categories (label, code, retention in months inherited by their ' +
      'dossiers), common to every company.',
    domain: PROJECTS,
    route: [CategoryController, 'findAll'],
    dto: PaginationQueryDto,
    call: (ctx, dto) => ctx.call(CategoryController, 'findAll', dto),
  }),
];

// ------------------------------------------------------------------ organization

const ORGANIZATION_TOOLS: McpTool[] = [
  paged({
    name: 'list_users',
    title: 'Users',
    description:
      "The company's users as the administration sees them: name, email, status, roles, " +
      'access profile. People are created and edited in the CREAPP console; Diffusion ' +
      'gives them its roles. Returns one page and the total, each with its `link`.',
    domain: ORGANIZATION,
    route: [UsersController, 'findAll'],
    dto: FindUsersQueryDto,
    link: LINKS.user,
    visibleTo: [Permission.USER_READ],
    call: (ctx, dto) => ctx.call(UsersController, 'findAll', dto, ctx.user),
  }),
  paged({
    name: 'find_people',
    title: 'Find people',
    description:
      'The people picker, open to every user: colleagues by name or email, optionally ' +
      'those holding a permission (e.g. who may validate). Use it to get the id of a ' +
      'person to name as responsible, executant, delegate….',
    domain: ORGANIZATION,
    route: [UsersController, 'directory'],
    dto: FindDirectoryQueryDto,
    call: (ctx, dto) => ctx.call(UsersController, 'directory', dto, ctx.user),
  }),
  only(
    restTool({
      name: 'get_user',
      title: 'Open a user',
      description:
        'A user in full: identity (from the CREAPP core), status, roles, access profile, ' +
        'company.',
      level: READ,
      domain: ORGANIZATION,
      route: [UsersController, 'findOne'],
      ids: { id: 'user' },
      link: LINKS.user,
    }),
    Permission.USER_READ,
  ),
  only(
    restTool({
      name: 'update_user_roles',
      title: "Change a user's roles",
      description:
        "Replace a user's Diffusion roles (roleIds, from list_roles) and/or access profile. " +
        "Never one's own, never a role with permissions one doesn't hold. Returns the user." +
        CAREFUL,
      level: ADMIN,
      domain: SETTINGS,
      route: [UsersController, 'update'],
      ids: { id: 'user' },
      link: LINKS.user,
    }),
    Permission.ROLE_ASSIGN,
  ),
  paged({
    name: 'list_roles',
    title: 'Roles',
    description:
      "The company's roles with their permissions and member counts (archived ones with " +
      'archived=true).',
    domain: ORGANIZATION,
    route: [RoleController, 'findAll'],
    dto: FindRolesQueryDto,
    omit: ['companyId'],
    link: ROLES_PAGE,
    call: (ctx, dto) => ctx.call(RoleController, 'findAll', dto, ctx.user),
  }),
  restTool({
    name: 'get_role',
    title: 'Open a role',
    description:
      'A role in full: name, permission codes, members, default or not.',
    level: READ,
    domain: ORGANIZATION,
    route: [RoleController, 'findOne'],
    ids: { id: 'role' },
    link: ROLES_PAGE,
  }),
  restTool({
    name: 'list_permission_catalog',
    title: 'Permission catalogue',
    description:
      'Every permission code, grouped, with its labels (en/fr/it) and the reads it ' +
      'implies: what a role can be given.',
    level: READ,
    domain: ORGANIZATION,
    route: [PermissionController, 'catalog'],
  }),
  restTool({
    name: 'create_role',
    title: 'Create a role',
    description:
      'Create a role with a name and permission codes (list_permission_catalog); one only ' +
      'grants permissions one holds. Returns the role.' +
      CAREFUL,
    level: ADMIN,
    domain: SETTINGS,
    route: [RoleController, 'create'],
    link: ROLES_PAGE,
  }),
  restTool({
    name: 'update_role',
    title: 'Edit a role',
    description:
      "Change a role's name, description or permissions (replaces the set). Returns the role." +
      CAREFUL,
    level: ADMIN,
    domain: SETTINGS,
    route: [RoleController, 'update'],
    ids: { id: 'role' },
    link: ROLES_PAGE,
  }),
  restTool({
    name: 'restore_role_defaults',
    title: "Restore a role's defaults",
    description:
      'Put a default role back to its default permissions. Returns the role.' +
      CAREFUL,
    level: ADMIN,
    domain: SETTINGS,
    route: [RoleController, 'restoreDefaults'],
    ids: { id: 'role' },
    link: ROLES_PAGE,
  }),
  restTool({
    name: 'archive_role',
    title: 'Archive a role',
    description:
      'Archive a role (roles are never deleted); its members can be moved to another role ' +
      '(reassignToRoleId). Returns the role.' +
      CAREFUL,
    level: ADMIN,
    domain: SETTINGS,
    route: [RoleController, 'archive'],
    ids: { id: 'role' },
    link: ROLES_PAGE,
  }),
  restTool({
    name: 'restore_role',
    title: 'Restore an archived role',
    description:
      'Bring an archived role back, with an optional note.' + CAREFUL,
    level: ADMIN,
    domain: SETTINGS,
    route: [RoleController, 'restore'],
    ids: { id: 'role' },
    link: ROLES_PAGE,
  }),
  paged({
    name: 'list_delegations',
    title: 'Delegations',
    description:
      "The delegations of the user's company: who stands in for whom, with which role, " +
      'from when to when. Returns one page and the total.',
    domain: ORGANIZATION,
    route: [DelegationController, 'findAll'],
    dto: PaginationQueryDto,
    visibleTo: [Permission.ROLE_ASSIGN],
    call: (ctx, dto) =>
      ctx.call(DelegationController, 'findAll', dto, ctx.user),
  }),
  only(
    restTool({
      name: 'get_delegation',
      title: 'Open a delegation',
      description:
        'A delegation in full: giver, receiver, role, period, responsibility, reason.',
      level: READ,
      domain: ORGANIZATION,
      route: [DelegationController, 'findOne'],
      ids: { id: 'delegation' },
    }),
    Permission.ROLE_ASSIGN,
  ),
  only(
    restTool({
      name: 'create_delegation',
      title: 'Create a delegation',
      description:
        "Hand one user's role to another for a period (delegantId, delegataireId, roleId, " +
        'companyId, startDate, endDate, optional responsibility and reason). Returns the ' +
        'delegation.' +
        CAREFUL,
      level: ADMIN,
      domain: SETTINGS,
      route: [DelegationController, 'create'],
    }),
    Permission.ROLE_ASSIGN,
  ),
  only(
    restTool({
      name: 'update_delegation',
      title: 'Edit a delegation',
      description:
        "Change a delegation's people, role, period or reason. Returns the delegation." +
        CAREFUL,
      level: ADMIN,
      domain: SETTINGS,
      route: [DelegationController, 'update'],
      ids: { id: 'delegation' },
    }),
    Permission.ROLE_ASSIGN,
  ),
  only(
    restTool({
      name: 'delete_delegation',
      title: 'End a delegation',
      description:
        'Delete a delegation: the receiver loses the delegated role at once. Returns ' +
        '{ done: true }.' +
        CAREFUL,
      level: ADMIN,
      domain: SETTINGS,
      route: [DelegationController, 'remove'],
      ids: { id: 'delegation' },
    }),
    Permission.ROLE_ASSIGN,
  ),
  paged({
    name: 'list_companies',
    title: 'Companies',
    description:
      'The companies the user sees (their own, those they are responsible for or hold by ' +
      'delegation), with city, status and responsible.',
    domain: ORGANIZATION,
    route: [CompanyController, 'findAll'],
    dto: FindCompaniesQueryDto,
    call: (ctx, dto) => ctx.call(CompanyController, 'findAll', dto, ctx.user),
  }),
  restTool({
    name: 'get_company',
    title: 'Open a company',
    description: 'A company the user sees: name, city, status, responsible.',
    level: READ,
    domain: ORGANIZATION,
    route: [CompanyController, 'findOne'],
    ids: { uuid: 'company' },
  }),
  only(
    restTool({
      name: 'update_company',
      title: 'Edit the company',
      description:
        "Change the company's city or responsible (its name and status are the CREAPP " +
        "core's). Returns the company." +
        CAREFUL,
      level: ADMIN,
      domain: SETTINGS,
      route: [CompanyController, 'update'],
      ids: { uuid: 'company' },
    }),
    Permission.COMPANY_UPDATE,
  ),
  paged({
    name: 'search_audit_log',
    title: 'Audit log',
    description:
      "The company's audit journal: who did what, on which record, when and from where, " +
      'filtered by text, level, entity, person, period, category or action. Returns one ' +
      'page and the total.',
    domain: ORGANIZATION,
    route: [ActivityController, 'findAll'],
    dto: FindActivityLogsQueryDto,
    link: AUDIT_PAGE,
    visibleTo: [Permission.AUDIT_READ],
    call: (ctx, dto) => ctx.call(ActivityController, 'findAll', dto, ctx.user),
  }),
  only(
    restTool({
      name: 'get_audit_entry',
      title: 'Open an audit entry',
      description:
        'One audit journal entry in full: author, action, record, changes, IP, device.',
      level: READ,
      domain: ORGANIZATION,
      route: [ActivityController, 'findOne'],
      ids: { id: 'audit entry' },
      link: AUDIT_PAGE,
    }),
    Permission.AUDIT_READ,
  ),
  paged({
    name: 'my_activity',
    title: 'My activity',
    description:
      "The user's own history: their actions, and what was done on their effets, " +
      'instructions and analysis sheets. Use for "what did I do yesterday".',
    domain: ORGANIZATION,
    route: [ActivityController, 'findMine'],
    dto: FindMyActivityQueryDto,
    call: (ctx, dto) => ctx.call(ActivityController, 'findMine', dto, ctx.user),
  }),
  only(
    restTool({
      name: 'list_audit_archives',
      title: 'Audit archives',
      description:
        'The audit journal batches past retention, exported before deletion (download ' +
        'them from the audit page).',
      level: READ,
      domain: ORGANIZATION,
      route: [ActivityController, 'archives'],
    }),
    Permission.AUDIT_READ,
  ),

  // ------------------------------------------------------------------ settings
  restTool({
    name: 'get_settings',
    title: 'Company settings',
    description:
      "The company's settings: processing delays (treatment, reply, discharge), reminders, " +
      'auto-archiving, audit retention, business days, session rules, instruction limit.',
    level: READ,
    domain: ORGANIZATION,
    route: [SettingsController, 'get'],
  }),
  restTool({
    name: 'get_notification_settings',
    title: 'Module notifications',
    description:
      'Which events the module notifies, in-app and by email, for the company.',
    level: READ,
    domain: ORGANIZATION,
    route: [SettingsController, 'getNotifications'],
  }),
  restTool({
    name: 'get_document_identity',
    title: 'Document letterhead',
    description:
      "The letterhead printed on the company's documents: accent colour, logo, module colour.",
    level: READ,
    domain: ORGANIZATION,
    route: [SettingsController, 'getIdentity'],
  }),
  only(
    restTool({
      name: 'update_settings',
      title: 'Edit company settings',
      description:
        'Change the company settings: delays (defaultTreatmentDays, outgoingReplyDays, ' +
        'dischargeExpectedDays), reminders, auto-archiving, audit retention, business days, ' +
        'session rules, instruction limit; `reset` puts keys back to default. Returns the ' +
        'settings.' +
        CAREFUL,
      level: ADMIN,
      domain: SETTINGS,
      route: [SettingsController, 'update'],
    }),
    Permission.SETTINGS_UPDATE,
  ),
  only(
    restTool({
      name: 'update_notification_settings',
      title: 'Edit module notifications',
      description:
        'Switch event notifications on or off, in-app and by email (events: type, inApp, ' +
        'email), or reset them. Returns the settings.' +
        CAREFUL,
      level: ADMIN,
      domain: SETTINGS,
      route: [SettingsController, 'updateNotifications'],
    }),
    Permission.SETTINGS_UPDATE,
  ),
  (() => {
    // The JSON form of the route: the logo is uploaded from the settings page.
    const shape: Record<string, z.ZodType> = {
      ...dtoShape(UpdateDocumentIdentityDto),
    };
    delete shape.logo;
    return defineTool({
      name: 'update_document_identity',
      title: 'Edit the letterhead',
      description:
        "Change the letterhead's accent colour, use the module colour, remove the logo or " +
        'reset it. A new logo is uploaded from the identity settings page. Returns the ' +
        'letterhead.' +
        CAREFUL,
      level: ADMIN,
      domain: SETTINGS,
      route: [SettingsController, 'updateIdentity'],
      visibleTo: [Permission.SETTINGS_UPDATE],
      input: shape,
      run: async (args, ctx) =>
        ctx.call(
          SettingsController,
          'updateIdentity',
          await ctx.dto(UpdateDocumentIdentityDto, args),
          undefined,
          ctx.user,
        ),
    });
  })(),
];

// ------------------------------------------------------------------ referential administration

/** create / update / delete of one referential list (ADMIN, so SETTINGS). */
function referentialTools(options: {
  what: string;
  plural: string;
  controller: Type<unknown>;
  note: string;
  visibleTo?: Permission[];
}): McpTool[] {
  const name = options.what.replace(/ /g, '_');
  const wrap = (tool: McpTool) =>
    options.visibleTo ? only(tool, ...options.visibleTo) : tool;
  return [
    wrap(
      restTool({
        name: `create_${name}`,
        title: `Create a ${options.what}`,
        description:
          `Add an item to the ${options.plural}. Returns the item.` +
          options.note,
        level: ADMIN,
        domain: SETTINGS,
        route: [options.controller, 'create'],
      }),
    ),
    wrap(
      restTool({
        name: `update_${name}`,
        title: `Edit a ${options.what}`,
        description:
          `Change an item of the ${options.plural} (or deactivate it). Returns the item.` +
          options.note,
        level: ADMIN,
        domain: SETTINGS,
        route: [options.controller, 'update'],
        ids: { id: options.what },
      }),
    ),
    wrap(
      restTool({
        name: `delete_${name}`,
        title: `Delete a ${options.what}`,
        description:
          `Delete an item of the ${options.plural}: refused once records use it ` +
          '(deactivate it instead).' +
          options.note,
        level: ADMIN,
        domain: SETTINGS,
        route: [options.controller, 'remove'],
        ids: { id: options.what },
      }),
    ),
  ];
}

const REFERENTIAL_TOOLS: McpTool[] = [
  ...referentialTools({
    what: 'courrier nature',
    plural: 'effet natures (list_courrier_natures)',
    controller: CourrierNatureController,
    note: COMMON,
  }),
  ...referentialTools({
    what: 'category',
    plural: 'dossier categories (list_categories)',
    controller: CategoryController,
    note: COMMON,
  }),
  ...referentialTools({
    what: 'channel',
    plural: "company's channels (canaux: list_channels)",
    controller: CanalController,
    note: CAREFUL,
    visibleTo: [Permission.SETTINGS_UPDATE],
  }),
  ...referentialTools({
    what: 'effet type',
    plural:
      "company's effet types (list_effet_types), with their reference model",
    controller: EffetTypeController,
    note: CAREFUL,
    visibleTo: [Permission.SETTINGS_UPDATE],
  }),
  ...referentialTools({
    what: 'contract type',
    plural: 'contract types (list_contract_types), common to every company',
    controller: ContractTypeController,
    note: CAREFUL,
  }),
  ...referentialTools({
    what: 'dossier type',
    plural: "company's dossier types (list_dossier_types)",
    controller: DossierTypeController,
    note: CAREFUL,
    visibleTo: [Permission.SETTINGS_UPDATE],
  }),
  ...referentialTools({
    what: 'correspondent type',
    plural: "company's correspondent types (list_correspondent_types)",
    controller: CorrespondentTypeController,
    note: CAREFUL,
    visibleTo: [Permission.SETTINGS_UPDATE],
  }),
];

// ------------------------------------------------------------------ CORE extras

const CORE_EXTRA_TOOLS: McpTool[] = [
  restTool({
    name: 'mark_notification_read',
    title: 'Mark a notification read',
    description: "Mark one of the user's notifications as read.",
    level: WRITE,
    domain: CORE,
    route: [NotificationsController, 'markRead'],
    ids: { id: 'notification' },
  }),
  restTool({
    name: 'mark_all_notifications_read',
    title: 'Mark all notifications read',
    description: "Mark all the user's notifications as read.",
    level: WRITE,
    domain: CORE,
    route: [NotificationsController, 'markAllRead'],
  }),
  restTool({
    name: 'archive_notification',
    title: 'Archive a notification',
    description:
      "Archive one of the user's notifications (hidden from the inbox).",
    level: WRITE,
    domain: CORE,
    route: [NotificationsController, 'archive'],
    ids: { id: 'notification' },
  }),
  restTool({
    name: 'get_notification_preferences',
    title: 'My notification preferences',
    description:
      'Which kinds of notification the user receives (type, enabled).',
    level: READ,
    domain: CORE,
    route: [NotificationsController, 'getPreferences'],
  }),
  restTool({
    name: 'set_notification_preferences',
    title: 'Change my notification preferences',
    description:
      'Turn kinds of notification on or off for the user (preferences: type, enabled). ' +
      'Returns the preferences.',
    level: WRITE,
    domain: CORE,
    route: [NotificationsController, 'setPreferences'],
  }),
  paged({
    name: 'list_documents',
    title: 'Documents',
    description:
      'The documents (attachments) the user may see, on a dossier, effet, livrable or ' +
      'contract: name, type, size, owner. Get a download link with get_document_link.',
    domain: CORE,
    route: [DocumentsController, 'findAll'],
    dto: FindDocumentsQueryDto,
    call: (ctx, dto) => ctx.call(DocumentsController, 'findAll', dto, ctx.user),
  }),
  restTool({
    name: 'get_document',
    title: 'Open a document',
    description:
      "A document's details: name, type, size, owner, the record it is on.",
    level: READ,
    domain: CORE,
    route: [DocumentsController, 'findOne'],
    ids: { id: 'document' },
  }),
  restTool({
    name: 'get_document_link',
    title: 'Download link of a document',
    description: 'A short-lived download URL of a document, to offer the user.',
    level: READ,
    domain: CORE,
    route: [DocumentsController, 'getDownloadUrl'],
    ids: { id: 'document' },
  }),
  restTool({
    name: 'get_document_access',
    title: 'Who may open a document',
    description: 'The users allowed to view or edit a document.',
    level: READ,
    domain: CORE,
    route: [DocumentsController, 'getAccess'],
    ids: { id: 'document' },
  }),
  restTool({
    name: 'set_document_owner',
    title: "Change a document's owner",
    description:
      "Give a document to another person (its uploader, the company's responsible or an " +
      'administrator may). Returns the document.',
    level: ADMIN,
    domain: SETTINGS,
    route: [DocumentsController, 'setOwner'],
    ids: { id: 'document' },
    preview: 'get_document',
  }),
  restTool({
    name: 'set_document_access',
    title: 'Set who may open a document',
    description:
      'Replace the list of users allowed to view / edit a document (entries: userId, ' +
      'canView, canEdit). Returns the new list.',
    level: ADMIN,
    domain: SETTINGS,
    route: [DocumentsController, 'setAccess'],
    ids: { id: 'document' },
    preview: 'get_document',
  }),
  restTool({
    name: 'delete_document',
    title: 'Delete a document',
    description: 'Delete a document for good. Returns { done: true }.',
    level: DECISION,
    domain: CORE,
    route: [DocumentsController, 'remove'],
    ids: { id: 'document' },
    preview: 'get_document',
  }),
  paged({
    name: 'list_my_tickets',
    title: 'My support tickets',
    description:
      "The user's support tickets, newest first, with their status. Returns one page and " +
      'the total.',
    domain: CORE,
    route: [SupportController, 'findMine'],
    dto: PaginationQueryDto,
    link: SUPPORT_PAGE,
    call: (ctx, dto) => ctx.call(SupportController, 'findMine', dto, ctx.user),
  }),
  restTool({
    name: 'get_ticket',
    title: 'Open a support ticket',
    description: 'A support ticket with its messages and attachments.',
    level: READ,
    domain: CORE,
    route: [SupportController, 'findOne'],
    ids: { id: 'ticket' },
    link: SUPPORT_PAGE,
  }),
  defineTool({
    name: 'create_support_ticket',
    title: 'Open a support ticket',
    description:
      "Send a request to CREAPP's support for the user (subject, message, page, technical " +
      'info), without attachments (files are added from the help page). Returns the ticket.',
    level: WRITE,
    domain: CORE,
    route: [SupportController, 'create'],
    link: SUPPORT_PAGE,
    input: dtoShape(CreateSupportTicketDto),
    run: async (args, ctx) =>
      ctx.call(
        SupportController,
        'create',
        await ctx.dto(CreateSupportTicketDto, args),
        [],
        ctx.user,
      ),
  }),
  restTool({
    name: 'add_ticket_message',
    title: 'Reply on a support ticket',
    description: "Add the user's message to one of their support tickets.",
    level: WRITE,
    domain: CORE,
    route: [SupportController, 'addMessage'],
    ids: { id: 'ticket' },
  }),
  restTool({
    name: 'send_help_feedback',
    title: 'Rate a help article',
    description:
      "Send the user's feedback on a help article or video (useful or not, comment).",
    level: WRITE,
    domain: CORE,
    route: [SupportController, 'feedback'],
  }),
];

/**
 * Package C: projects, contracts, dossiers, organization (users, roles, delegations,
 * companies, audit), settings, referential administration and the CORE extras
 * (notifications, documents, support). See the phase 2 tool plan.
 */
export const PROJECT_TOOLS: readonly McpTool[] = [
  ...PROJECT_TOOLS_LIST,
  ...ORGANIZATION_TOOLS,
  ...REFERENTIAL_TOOLS,
  ...CORE_EXTRA_TOOLS,
];
