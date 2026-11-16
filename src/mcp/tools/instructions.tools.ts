import { NotFoundException, type Type } from '@nestjs/common';
import { AnalysisController } from '../../analysis/analysis.controller';
import { CriterionTemplateController } from '../../analysis/criterion-template.controller';
import { FindAnalysisSheetsQueryDto } from '../../analysis/dto/analysis.dto';
import { Permission } from '../../auth/permissions';
import { DeliverableController } from '../../domain/deliverable/deliverable.controller';
import { FindDeliverableQueryDto } from '../../domain/deliverable/dto/find-deliverable-query.dto';
import { FindInstructionsQueryDto } from '../../instructions/dto/find-instructions.query.dto';
import { FindMyTasksQueryDto } from '../../instructions/dto/find-my-tasks.query.dto';
import { InstructionsController } from '../../instructions/instructions.controller';
import { dtoShape } from '../dto-schema';
import { LINKS } from '../links';
import {
  byIdOrReference,
  defineTool,
  idOrReference,
  type McpTool,
  type ToolContext,
  ToolDomain,
  type ToolLink,
  ToolLevel,
  id,
  pageInput,
  query,
} from '../mcp-tool';
import { restTool } from '../rest-tool';

/** Package B: instructions (tasks), livrables, analysis sheets and their criteria. */

const { READ, WRITE, DECISION, ADMIN } = ToolLevel;
const { INSTRUCTIONS, ANALYSIS, SETTINGS } = ToolDomain;

const ONCE =
  ' One workflow step: applied once, refused if the record moved on. ' +
  "Check the record's `available` actions first.";
const REASON =
  ' A reason is required: draft it from what the user said and let them confirm it.';
/** Steps reserved to a designated person (executant, validateur, superviseur). */
const DESIGNATED =
  ' Reserved to the person designated on the task: when `available` lacks the action, ' +
  '`unavailable` says why (e.g. NOT_DESIGNATED).';

const TASK = LINKS.task;
const SHEET = LINKS.analysisSheet;
const CRITERIA_PAGE = '/dashboard/settings/analysis-criteria';
/** A livrable is shown on its task's page. */
const LIVRABLE: ToolLink = (record) =>
  typeof record.instructionId === 'string'
    ? TASK.replace('{id}', record.instructionId)
    : '';

type Row = Record<string, unknown>;
type ListHandler = (query: object, user: unknown) => Promise<unknown>;

const rowsOf = (value: unknown): Row[] => {
  if (Array.isArray(value)) return value as Row[];
  const data = (value as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as Row[]) : [];
};
const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** The id of the one row whose `field` is `reference` (NOT_FOUND otherwise). */
function idOfReference(
  rows: Row[],
  field: string,
  reference: string,
  what: string,
): string {
  const wanted = normalize(reference);
  const row = rows.find(
    (r) => typeof r[field] === 'string' && normalize(r[field]) === wanted,
  );
  if (!row || typeof row.id !== 'string') {
    throw new NotFoundException({
      code: 'NOT_FOUND',
      message: `No ${what} the user may see carries the reference ${reference}`,
      params: { reference },
    });
  }
  return row.id;
}

/**
 * A list route `(@Query() dto, @CurrentUser() user)` paged with page/limit instead of
 * skip/take; `search` only when the DTO has one.
 */
function listTool(options: {
  name: string;
  title: string;
  description: string;
  route: [Type<unknown>, string];
  dto: Type<object>;
  link?: ToolLink;
  domain: ToolDomain;
  visibleTo?: readonly Permission[];
}): McpTool {
  const shape = dtoShape(options.dto);
  const hasSearch = 'search' in shape;
  delete shape.skip;
  delete shape.take;
  delete shape.search;
  const [controller, method] = options.route;
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
      ...shape,
      ...(hasSearch ? { search: pageInput.search } : {}),
      page: pageInput.page,
      limit: pageInput.limit,
    },
    run: async (args: Record<string, unknown>, ctx) =>
      ctx.call(
        controller as Type<Record<string, ListHandler>>,
        method,
        await ctx.dto(options.dto, query(args)),
        ctx.user,
      ),
  });
}

const findTask = async (ctx: ToolContext, reference: string) =>
  idOfReference(
    rowsOf(
      await ctx.call(
        InstructionsController,
        'findMyTasks',
        await ctx.dto(FindMyTasksQueryDto, {
          tab: 'all',
          search: reference.trim(),
          take: 10,
        }),
        ctx.user,
      ),
    ),
    'number',
    reference,
    'task',
  );

const findSheet = async (ctx: ToolContext, reference: string) =>
  idOfReference(
    rowsOf(
      await ctx.call(
        AnalysisController,
        'findAll',
        await ctx.dto(FindAnalysisSheetsQueryDto, {
          search: reference.trim(),
          take: 10,
        }),
        ctx.user,
      ),
    ),
    'reference',
    reference,
    'analysis sheet',
  );

// ================================================================== instructions (tasks)

const INSTRUCTION_TOOLS_LIST: McpTool[] = [
  listTool({
    name: 'search_my_tasks',
    title: 'My tasks',
    description:
      'The tasks (instructions) the user takes part in: as executant, superviseur or ' +
      'validateur. `tab` picks the page tab: a-souscrire (assigned, to subscribe to), ' +
      'en-cours (default: in progress, awaiting validation, to correct), terminees, ' +
      'renvoyees (declined by their executants, among those the user supervises) or all. ' +
      'Filter by status, priority, role, overdue, dossier, contract or creation dates. Use ' +
      'for "what do I have to do", "my late tasks". Returns one page, each task with its ' +
      'number (T-…), status, deadlines, `available` actions and `link`.',
    route: [InstructionsController, 'findMyTasks'],
    dto: FindMyTasksQueryDto,
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  listTool({
    name: 'search_instructions',
    title: 'Search tasks',
    description:
      "Every task (instruction) of the user's company, not only theirs: filter by dossier, " +
      'effet (courrierId), assignee, status or overdue. Use for "the tasks of dossier X", ' +
      '"what is Y working on", "late tasks of the company". No free-text search here: use ' +
      'search_my_tasks or global_search for words. Returns one page with each `link`.',
    route: [InstructionsController, 'findAll'],
    dto: FindInstructionsQueryDto,
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'get_workload',
    title: 'Agents workload',
    description:
      'Tasks in progress per agent, with their capacity, in the companies where the user ' +
      'may assign tasks. Use before assigning a task ("who is free?").',
    level: READ,
    route: [InstructionsController, 'workload'],
    domain: INSTRUCTIONS,
  }),
  defineTool({
    name: 'get_instruction',
    title: 'Open a task',
    description:
      'One task (instruction) in full, by id or number (T-…): effet, dossier or contract, ' +
      'deadlines, executants, superviseur, validateur, its livrables (current version, ' +
      'earlier ones in `history`, each with its own `available` actions) and what the user ' +
      'may do on the task (`available`, and `unavailable` with the reason). Read it before ' +
      'any workflow step on a task or its livrables.',
    level: READ,
    domain: INSTRUCTIONS,
    input: idOrReference('task', 'T-000123'),
    route: [InstructionsController, 'findOne'],
    link: TASK,
    run: async (args, ctx) =>
      ctx.call(
        InstructionsController,
        'findOne',
        await byIdOrReference(
          args,
          (value) => Promise.resolve(value),
          (reference) => findTask(ctx, reference),
        ),
        ctx.user,
      ),
  }),
  defineTool({
    name: 'get_instruction_history',
    title: 'Task history',
    description:
      'What happened on a task, newest first: assignments, subscriptions, deposits, ' +
      'opinions, decisions, reminders, with who and when. Use for "who did what on this ' +
      'task". Returns one page.',
    level: READ,
    domain: INSTRUCTIONS,
    input: { id: id('task'), page: pageInput.page, limit: pageInput.limit },
    route: [InstructionsController, 'historique'],
    link: TASK,
    run: ({ id: taskId, page, limit }, ctx) =>
      ctx.call(
        InstructionsController,
        'historique',
        taskId,
        ctx.user,
        String((page - 1) * limit),
        String(limit),
      ),
  }),
  {
    ...restTool({
      name: 'create_instructions',
      title: 'Create a task',
      description:
        'Create a task (instruction) on a dossier or a contract (exactly one of dossierId / ' +
        'contractId), possibly following an effet (courrierId): title, description, ' +
        'priority, deadlines, executants or a superviseur who will designate them, an ' +
        'optional validateur and its first livrables. Draft the fields from what the user ' +
        'said and let them confirm. Returns the task with its `link`.',
      level: WRITE,
      route: [InstructionsController, 'create'],
      link: TASK,
      domain: INSTRUCTIONS,
    }),
    // INSTRUCTION_CREATE, or the effet's superviseur (checked in the service).
    visibleTo: [Permission.INSTRUCTION_CREATE, Permission.INCOMING_READ],
  },
  restTool({
    name: 'update_instruction',
    title: 'Edit a task',
    description:
      "Edit a task's title, description, priority, deadlines, contract, effet or " +
      'validateur. Only the fields given change. Returns the task.',
    level: WRITE,
    route: [InstructionsController, 'update'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'set_agent_due_date',
    title: "Set the executants' deadline",
    description:
      "Set the executants' deadline of a task (livrables submitted by then, not after the " +
      "task's own deadline). The task's superviseur (or its creator without one) only: " +
      'check `available` (setAgentDueDate) first. Returns the task.',
    level: WRITE,
    route: [InstructionsController, 'setAgentDueDate'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'remind_instruction',
    title: 'Remind the executants',
    description:
      "Notify a task's executants again. Its superviseur or creator; once an hour at most " +
      '(CONFLICT TOO_SOON otherwise).' +
      ONCE,
    level: DECISION,
    route: [InstructionsController, 'remind'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'assign_instruction',
    title: 'Assign a task',
    description:
      'Assign or reassign a task: its executants, superviseur and/or validateur, with an ' +
      'optional note. INSTRUCTION_ASSIGN or the superviseur of its effet. Use get_workload ' +
      'to pick someone free.' +
      ONCE,
    level: DECISION,
    route: [InstructionsController, 'assign'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'subscribe_instruction',
    title: 'Subscribe to a task',
    description:
      'The user, one of the executants, takes the task on (souscrire): it goes in progress ' +
      'and they become the one who deposits its livrables.' +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [InstructionsController, 'subscribe'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'decline_instruction',
    title: 'Decline a task',
    description:
      'The user, one of the executants, declines the task (ne pas souscrire): it goes back ' +
      'to its superviseur.' +
      REASON +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [InstructionsController, 'declineSubscription'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'approve_livrables',
    title: 'Approve the submitted livrables',
    description:
      'The superviseur approves every submitted livrable of the task that awaits their ' +
      "decision (after the validateur's opinion, or at once without a validateur). The " +
      'validateur may not.' +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [InstructionsController, 'approveLivrables'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'approve_selected_livrables',
    title: 'Approve some livrables',
    description:
      'The superviseur approves only the livrables named (livrableIds, from get_instruction) ' +
      'among those awaiting their decision.' +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [InstructionsController, 'approveSelectedLivrables'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'request_instruction_corrections',
    title: 'Request corrections',
    description:
      'The superviseur sends submitted livrables back to the executant for corrections ' +
      '(then to the validateur again): `livrables` lists each one (livrableId from ' +
      'get_instruction) with its own motif; those not listed stay submitted. Optional ' +
      "comment and new executants' deadline." +
      ' Each motif is required: draft it from what the user said and let them confirm it.' +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [InstructionsController, 'requestCorrections'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'close_instruction',
    title: 'Close a task',
    description:
      'Close a task (TERMINEE), with an optional closing comment.' + ONCE,
    level: DECISION,
    route: [InstructionsController, 'close'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'cancel_instruction',
    title: 'Cancel a task',
    description: 'Cancel a task: nobody works on it any more.' + REASON + ONCE,
    level: DECISION,
    route: [InstructionsController, 'cancel'],
    ids: { id: 'instruction' },
    link: TASK,
    domain: INSTRUCTIONS,
  }),
];

// ================================================================== livrables

const LIVRABLE_TOOLS: McpTool[] = [
  listTool({
    name: 'list_livrables',
    title: 'Livrables',
    description:
      'Livrables (deliverables), filtered by task (instructionId) and status. Use for "the ' +
      'livrables of task X", "livrables awaiting validation". Returns one page; each `link` ' +
      "is its task's page. Their actions are on get_instruction.",
    route: [DeliverableController, 'findAll'],
    dto: FindDeliverableQueryDto,
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'get_livrable',
    title: 'Open a livrable',
    description:
      'One livrable: title, description, status, version, files, validation step (0 = ' +
      "validateur's opinion awaited, 1 = superviseur's decision awaited), decisions and " +
      "earlier versions. It carries no actions: read get_instruction for the livrable's " +
      '`available` actions.',
    level: READ,
    route: [DeliverableController, 'findOne'],
    ids: { id: 'livrable' },
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'create_livrable',
    title: 'Add a livrable',
    description:
      'Add a livrable (title, description) to a task. The executant who subscribed to it, ' +
      "or a holder of the livrable permissions: check the task's `available` " +
      '(addLivrable) first. Returns the livrable.',
    level: WRITE,
    route: [DeliverableController, 'create'],
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'update_livrable',
    title: 'Edit a livrable',
    description:
      "Edit a livrable's title or description before it is submitted. Check the " +
      "livrable's `available` (edit) on get_instruction first. Returns the livrable.",
    level: WRITE,
    route: [DeliverableController, 'update'],
    ids: { id: 'livrable' },
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'new_livrable_version',
    title: 'New livrable version',
    description:
      'Start a new version of a livrable (e.g. after corrections were requested), with an ' +
      'optional new title or description; the earlier one stays in its history.' +
      ONCE,
    level: DECISION,
    route: [DeliverableController, 'newVersion'],
    ids: { id: 'livrable' },
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'delete_livrable',
    title: 'Delete a livrable',
    description:
      'Delete a livrable that was not submitted. Cannot be undone.' + ONCE,
    level: DECISION,
    route: [DeliverableController, 'remove'],
    ids: { id: 'livrable' },
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'deposit_livrable',
    title: 'Deposit a livrable',
    description:
      'Mark a livrable as deposited, with an optional comment for the superviseur. Files ' +
      "can't be sent from here: the user uploads them on the task's page (`link`)." +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [DeliverableController, 'deposit'],
    ids: { id: 'livrable' },
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'submit_livrable',
    title: 'Submit a livrable',
    description:
      'Submit a deposited livrable for validation (to the validateur, or the superviseur ' +
      'without one). The executant who subscribed to the task.' +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [DeliverableController, 'submit'],
    ids: { id: 'livrable' },
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'give_livrable_opinion',
    title: "Give the validateur's opinion",
    description:
      "The validateur's opinion (comment) on a submitted livrable at validation step 0: " +
      'it then moves on to the superviseur, who decides. The validateur never decides.' +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [DeliverableController, 'giveAvis'],
    ids: { id: 'livrable' },
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
  restTool({
    name: 'reject_livrable',
    title: 'Reject a livrable',
    description:
      'The superviseur rejects one submitted livrable (after the validateur gave their ' +
      'opinion): it goes back to the executant.' +
      REASON +
      DESIGNATED +
      ONCE,
    level: DECISION,
    route: [DeliverableController, 'reject'],
    ids: { id: 'livrable' },
    link: LIVRABLE,
    domain: INSTRUCTIONS,
  }),
];

// ================================================================== analysis sheets

const SHEET_IDS = { id: 'analysis sheet' };
const ITEM_IDS = { itemId: 'analysis sheet element (from get_analysis_sheet)' };

const ANALYSIS_TOOLS: McpTool[] = [
  listTool({
    name: 'search_analysis_sheets',
    title: 'Search analysis sheets',
    description:
      'Analysis sheets (fiches d’analyse) the user may read: by words (FA-…, title, effet ' +
      'subject), dossier, contract, effet (courrierId), author, overall opinion or status. ' +
      'Returns one page, each with its `link`.',
    route: [AnalysisController, 'findAll'],
    dto: FindAnalysisSheetsQueryDto,
    link: SHEET,
    domain: ANALYSIS,
  }),
  defineTool({
    name: 'get_analysis_sheet',
    title: 'Open an analysis sheet',
    description:
      'One analysis sheet in full, by id or reference (FA-…): its effet, author, ' +
      'validator, elements with their criteria and opinions, suggested and overall ' +
      'opinion, status, versions, and what the user may do (`available`, `unavailable` ' +
      'with the reason). Read it before editing or deciding.',
    level: READ,
    domain: ANALYSIS,
    input: idOrReference('analysis sheet', 'FA-000123'),
    route: [AnalysisController, 'findOne'],
    link: SHEET,
    run: async (args, ctx) =>
      ctx.call(
        AnalysisController,
        'findOne',
        await byIdOrReference(
          args,
          (value) => Promise.resolve(value),
          (reference) => findSheet(ctx, reference),
        ),
        ctx.user,
      ),
  }),
  restTool({
    name: 'get_analysis_summary',
    title: 'Analysis sheet summary',
    description:
      'The summary (récapitulatif) of an analysis sheet: one line per element with its ' +
      'suggested and given opinion, and the overall decision. Use for a quick overview.',
    level: READ,
    route: [AnalysisController, 'summary'],
    ids: SHEET_IDS,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'create_analysis_sheet',
    title: 'Create an analysis sheet',
    description:
      'Create a draft analysis sheet on an effet (courrierId), optionally tied to a task ' +
      'or project, with its header fields and elements (or seeded from the effet’s ' +
      'documents). Draft the fields from what the user said and let them confirm. Returns ' +
      'the sheet with its `link`.',
    level: WRITE,
    route: [AnalysisController, 'create'],
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'update_analysis_sheet',
    title: 'Edit an analysis sheet',
    description:
      "Edit an analysis sheet's header fields (title, references, author, validator, " +
      'comments…) while it is editable. Only the fields given change.',
    level: WRITE,
    route: [AnalysisController, 'update'],
    ids: SHEET_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'add_analysis_item',
    title: 'Add an analysis element',
    description:
      'Add an element (a document or point analysed) to an editable analysis sheet, with ' +
      'its norms, observation and opinion. Returns the sheet.',
    level: WRITE,
    route: [AnalysisController, 'addItem'],
    ids: SHEET_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'update_analysis_item',
    title: 'Edit an analysis element',
    description:
      'Edit an element of an analysis sheet: label, description, norms, observation or ' +
      'opinion. Returns the sheet.',
    level: WRITE,
    route: [AnalysisController, 'updateItem'],
    ids: ITEM_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'set_analysis_criteria',
    title: "Set an element's criteria",
    description:
      "Replace the whole criteria grid of an analysis element: each criterion's label, " +
      'opinion, observation and template (list_analysis_criteria). Send every criterion ' +
      'to keep. Returns the sheet.',
    level: WRITE,
    route: [AnalysisController, 'setCriteria'],
    ids: ITEM_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'remove_analysis_item',
    title: 'Remove an analysis element',
    description:
      'Remove an element (and its criteria) from an editable analysis sheet.' +
      ONCE,
    level: DECISION,
    route: [AnalysisController, 'removeItem'],
    ids: ITEM_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'delete_analysis_sheet',
    title: 'Delete an analysis sheet',
    description:
      'Delete a draft (BROUILLON) analysis sheet. Cannot be undone.' + ONCE,
    level: DECISION,
    route: [AnalysisController, 'remove'],
    ids: SHEET_IDS,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'submit_analysis_sheet',
    title: 'Submit an analysis sheet',
    description:
      'The author hands the analysis sheet over for validation.' + ONCE,
    level: DECISION,
    route: [AnalysisController, 'submit'],
    ids: SHEET_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'decide_analysis_sheet',
    title: 'Decide an analysis sheet',
    description:
      "Give a submitted analysis sheet its overall opinion (the validator's decision), " +
      'with a motif when it differs from the suggested one.' +
      ONCE,
    level: DECISION,
    route: [AnalysisController, 'decide'],
    ids: SHEET_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'new_analysis_version',
    title: 'New analysis sheet version',
    description:
      'From a saved or signed analysis sheet, start a new draft version (elements and ' +
      'criteria copied), with an optional motif. Returns the new sheet and its `link`.' +
      ONCE,
    level: DECISION,
    route: [AnalysisController, 'newVersion'],
    ids: SHEET_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'archive_analysis_sheet',
    title: 'Archive an analysis sheet',
    description: 'Archive an analysis sheet, with an optional reason.' + ONCE,
    level: DECISION,
    route: [AnalysisController, 'archive'],
    ids: SHEET_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'unarchive_analysis_sheet',
    title: 'Restore an analysis sheet',
    description: 'Bring an archived analysis sheet back.' + ONCE,
    level: DECISION,
    route: [AnalysisController, 'unarchive'],
    ids: SHEET_IDS,
    link: SHEET,
    domain: ANALYSIS,
  }),

  // -------------------------------------------------------------- criterion templates
  restTool({
    name: 'list_analysis_criteria',
    title: 'Analysis criteria',
    description:
      'The criteria an analysis sheet offers (common ones and the company’s own, ' +
      'companyId defaulting to the user’s): label, description, order, active, applied ' +
      'by default. Use to fill set_analysis_criteria.',
    level: READ,
    route: [CriterionTemplateController, 'findAll'],
    link: CRITERIA_PAGE,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'get_analysis_criterion',
    title: 'Open an analysis criterion',
    description: 'One analysis criterion template.',
    level: READ,
    route: [CriterionTemplateController, 'findOne'],
    ids: { id: 'criterion template' },
    link: CRITERIA_PAGE,
    domain: ANALYSIS,
  }),
  restTool({
    name: 'get_analysis_settings',
    title: 'Analysis settings',
    description:
      "A company's analysis sheet settings (e.g. whether custom criteria are allowed).",
    level: READ,
    route: [CriterionTemplateController, 'getSettings'],
    link: CRITERIA_PAGE,
    domain: ANALYSIS,
  }),
  ...[
    restTool({
      name: 'create_analysis_criterion',
      title: 'Create an analysis criterion',
      description:
        "Add a criterion template to the company's analysis grid (or a common one, for a " +
        'platform administrator): label, description, order, active, applied by default.',
      level: ADMIN,
      route: [CriterionTemplateController, 'create'],
      link: CRITERIA_PAGE,
      domain: SETTINGS,
    }),
    restTool({
      name: 'update_analysis_criterion',
      title: 'Edit an analysis criterion',
      description:
        'Edit a criterion template; only the fields given change. Sheets already filled ' +
        'keep their criteria.',
      level: ADMIN,
      route: [CriterionTemplateController, 'update'],
      ids: { id: 'criterion template' },
      link: CRITERIA_PAGE,
      domain: SETTINGS,
    }),
    restTool({
      name: 'delete_analysis_criterion',
      title: 'Delete an analysis criterion',
      description: 'Delete a criterion template from the analysis grid.',
      level: ADMIN,
      route: [CriterionTemplateController, 'remove'],
      ids: { id: 'criterion template' },
      domain: SETTINGS,
    }),
    restTool({
      name: 'update_analysis_settings',
      title: 'Edit analysis settings',
      description:
        "Change a company's analysis sheet settings (allowCustomCriteria: whether " +
        'authors may add criteria outside the grid).',
      level: ADMIN,
      route: [CriterionTemplateController, 'updateSettings'],
      link: CRITERIA_PAGE,
      domain: SETTINGS,
    }),
  ].map((tool) => ({
    ...tool,
    // The service checks SETTINGS_UPDATE itself (no decorator on these routes).
    visibleTo: [Permission.SETTINGS_UPDATE],
  })),
];

/**
 * Package B (instructions, livrables, analysis sheets): see the phase 2 tool plan.
 *
 * Not tools (file streams and multipart uploads): POST /instructions/:id/livrables/deposer,
 * GET /analysis-sheets/:id/pdf, POST /analysis-sheets/:id/sign; the deprecated aliases
 * PATCH /instructions/:id/accept and /refuse.
 */
export const INSTRUCTION_TOOLS: readonly McpTool[] = [
  ...INSTRUCTION_TOOLS_LIST,
  ...LIVRABLE_TOOLS,
  ...ANALYSIS_TOOLS,
];
