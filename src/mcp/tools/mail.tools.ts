import {
  ConflictException,
  NotFoundException,
  type Type,
} from '@nestjs/common';
import { z } from 'zod';
import { CourrierDirection } from '../../generated/prisma/enums';
import { Permission } from '../../auth/permissions';
import { FindCompanyListQueryDto } from '../../common/dto/company-list-item.dto';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { CreateMailDto } from '../../domain/mail/dto/create-mail.dto';
import { DischargeMailDto } from '../../domain/mail/dto/discharge-mail.dto';
import { FindIncomingMailsQueryDto } from '../../domain/mail/dto/find-incoming-mails.query.dto';
import { FindMailsQueryDto } from '../../domain/mail/dto/find-mails.query.dto';
import { FindOutgoingMailsQueryDto } from '../../domain/mail/dto/find-outgoing-mails.query.dto';
import { MailController } from '../../domain/mail/mail.controller';
import { CanalController } from '../../referentials/canal/canal.controller';
import { CorrespondantController } from '../../referentials/correspondent/correspondent.controller';
import { CreateCorrespondentDto } from '../../referentials/correspondent/dto/create-correspondent.dto';
import { FindCorrespondantsQueryDto } from '../../referentials/correspondent/dto/find-correspondents.query.dto';
import { CorrespondentTypeController } from '../../referentials/correspondent-type/correspondent-type.controller';
import { CourrierNatureController } from '../../referentials/courrier-nature/courrier-nature.controller';
import { EffetTypeController } from '../../referentials/effet-type/effet-type.controller';
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
} from '../mcp-tool';
import { restTool } from '../rest-tool';

const { READ, WRITE, DECISION, ADMIN } = ToolLevel;
const MAIL = ToolDomain.MAIL;
const REFERENTIALS = ToolDomain.REFERENTIALS;

/** Appended to every workflow step: the user confirms it in the chat before it is sent. */
const ONCE =
  ' One workflow step: applied once, refused if the record moved on. ' +
  "Check the record's `available` actions first.";
const REASON =
  ' A reason is required: draft it from what the user said and let them confirm it.';

/**
 * Who may ever use the routes with no permission decorator (the service checks the
 * designation itself: author, person in charge, supervisor, validator…): anyone who reads
 * effets. The effet's `available` / `unavailable` tells the model the rest.
 */
const EFFET_READERS = [Permission.INCOMING_READ, Permission.OUTGOING_READ];

// ------------------------------------------------------------- lookups

type Row = Record<string, unknown>;

/** The fields a number or reference is matched on, exactly (case and spaces aside). */
const REFERENCE_FIELDS = ['number', 'reference', 'code', 'bordereauNumber'];

const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** The rows of a list answer (a page `{ data }` or an array). */
const rowsOf = (value: unknown): Row[] => {
  if (Array.isArray(value)) return value as Row[];
  const data = (value as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as Row[]) : [];
};

/**
 * The id of the one row of a search answer whose number / reference / code is `reference`:
 * NOT_FOUND when none, CONFLICT (with the candidates) when several.
 */
export function byNumberOrReference(
  found: unknown,
  reference: string,
  what: string,
): string {
  const wanted = normalize(reference);
  const matches = rowsOf(found).filter((row) =>
    REFERENCE_FIELDS.some(
      (field) =>
        typeof row[field] === 'string' && normalize(row[field]) === wanted,
    ),
  );
  if (!matches.length) {
    throw new NotFoundException({
      code: 'NOT_FOUND',
      message: `No ${what} the user may see carries the reference ${reference}`,
      params: { reference },
    });
  }
  if (matches.length > 1) {
    throw new ConflictException({
      code: 'AMBIGUOUS_REFERENCE',
      message: `Several ${what}s carry the reference ${reference}: give the id`,
      params: {
        reference,
        ids: matches.map((row) => String(row.id)).join(','),
      },
    });
  }
  return String(matches[0].id);
}

const effetIdOf = async (
  ctx: ToolContext,
  args: { id?: string; reference?: string },
) =>
  byIdOrReference(
    args,
    (effet) => Promise.resolve(effet),
    async (reference) =>
      byNumberOrReference(
        await ctx.call(
          MailController,
          'findAll',
          await ctx.dto(FindMailsQueryDto, { search: reference, take: 10 }),
          ctx.user,
        ),
        reference,
        'effet',
      ),
  );

const correspondentIdOf = async (
  ctx: ToolContext,
  args: { id?: string; reference?: string },
) =>
  byIdOrReference(
    args,
    (correspondent) => Promise.resolve(correspondent),
    async (reference) =>
      byNumberOrReference(
        await ctx.call(
          CorrespondantController,
          'findAll',
          await ctx.dto(FindCorrespondantsQueryDto, {
            search: reference,
            take: 10,
          }),
          ctx.user,
        ),
        reference,
        'correspondent',
      ),
  );

// ------------------------------------------------------------- helpers

/** A list query DTO as tool arguments: its filters, with `page` / `limit` / `search`. */
function listShape(type: Type<object>, without: string[] = []) {
  const shape = dtoShape(type);
  for (const field of ['skip', 'take', 'search', ...without]) {
    delete shape[field];
  }
  return { ...shape, ...pageInput };
}

/** A DTO's fields as tool arguments, some left out (set by the tool itself). */
function bodyShape(type: Type<object>, without: string[]) {
  const shape = dtoShape(type);
  for (const field of without) delete shape[field];
  return shape;
}

/**
 * A rest tool whose record parameter is not called `id` (the correspondent routes take
 * `:uuid`): the model and the gateway's preview card both send `id`.
 */
function recordAsId(tool: McpTool, param: string, what: string): McpTool {
  const input = { ...tool.input };
  delete input[param];
  return {
    ...tool,
    input: { id: id(what), ...input },
    run: (args, ctx) => {
      const { id: recordId, ...rest } = args;
      return tool.run({ ...rest, [param]: recordId }, ctx);
    },
  };
}

const onEffet = { id: 'effet' };

/** Package A: effets (incoming and outgoing mail), correspondents and the referentials effet forms need. */
export const MAIL_TOOLS: readonly McpTool[] = [
  // =========================================================== effets: read
  defineTool({
    name: 'search_incoming_effets',
    title: 'Incoming effets',
    description:
      'The incoming effets (courriers entrants) the user may see, as on the « Effets ' +
      'entrants » page: filter by tab (toDispatch, dispatchPending, affected, assigned, ' +
      'inTreatment, closed, archived, others, dispatched), status, dossier, project, ' +
      'contract, correspondent, nature, type, person in charge (ownerId) or reception ' +
      'dates; `search` matches subject, number and printed reference. Use for "what came ' +
      'in this week", "the letters still to dispatch". Returns one page, the total, the ' +
      "tabs' counts (metrics) and each effet's `link`.",
    level: READ,
    domain: MAIL,
    input: listShape(FindIncomingMailsQueryDto),
    route: [MailController, 'findIncoming'],
    link: LINKS.incoming,
    run: async (args, ctx) =>
      ctx.call(
        MailController,
        'findIncoming',
        await ctx.dto(FindIncomingMailsQueryDto, query(args)),
        ctx.user,
      ),
  }),
  defineTool({
    name: 'search_outgoing_effets',
    title: 'Outgoing effets',
    description:
      'The outgoing effets (courriers sortants) the user may see, as on the « Effets ' +
      'sortants » page: filter by group (drafts, submitted, corrections, authorized, ' +
      'cancelled, archived), status, dossier, project, contract, correspondent, nature, ' +
      'type, person in charge (ownerId) or registration dates; `search` matches subject, ' +
      'number and reference. Use for "my drafts", "letters waiting for validation". ' +
      "Returns one page, the total, the tabs' counts (metrics) and each effet's `link`.",
    level: READ,
    domain: MAIL,
    input: listShape(FindOutgoingMailsQueryDto),
    route: [MailController, 'findOutgoing'],
    link: LINKS.outgoing,
    run: async (args, ctx) =>
      ctx.call(
        MailController,
        'findOutgoing',
        await ctx.dto(FindOutgoingMailsQueryDto, query(args)),
        ctx.user,
      ),
  }),
  defineTool({
    name: 'search_effets',
    title: 'Search effets',
    description:
      'Effets of both directions the user may see (direction ENTRANT or SORTANT), by ' +
      'status, dossier, project, contract, correspondent, type or person in charge; ' +
      '`search` matches subject, number, printed reference and correspondent name. Use ' +
      'when the direction is unknown, e.g. "every letter exchanged with SOGEA on project ' +
      'X". Returns one page, the total and each effet\'s `link`.',
    level: READ,
    domain: MAIL,
    input: listShape(FindMailsQueryDto),
    route: [MailController, 'findAll'],
    link: EFFET_LINK,
    run: async (args, ctx) =>
      ctx.call(
        MailController,
        'findAll',
        await ctx.dto(FindMailsQueryDto, query(args)),
        ctx.user,
      ),
  }),
  {
    ...restTool({
      name: 'list_effets_awaiting_my_validation',
      title: 'Effets awaiting my validation',
      description:
        "The user's validation inbox: the outgoing effets submitted to them as validator " +
        '(EN_ATTENTE_VALIDATION), latest first, with their approvers. Use for "what must I ' +
        'validate". Then validate_outgoing or request_outgoing_corrections.',
      level: READ,
      domain: MAIL,
      route: [MailController, 'findAwaitingMyValidation'],
      link: EFFET_LINK,
    }),
    visibleTo: EFFET_READERS,
  },
  defineTool({
    name: 'get_effet',
    title: 'Open an effet',
    description:
      'One effet in full, by its id or its number / reference (M-000123, the reference ' +
      'printed on an incoming letter, or an outgoing one such as SOR-2026-000123): ' +
      'direction, status, subject, correspondent, nature, channel, type, dossier, project, ' +
      'contract, person in charge, supervisor, validator and approvers, due date, ' +
      'documents, instructions progress, dispatch proposal, transmission and discharge ' +
      'details. `available` lists the actions the user can take now (edit, delete, ' +
      'transmit, dispatch, validateDispatch, rejectDispatch, assignSupervisor, setOwner, ' +
      'submitForValidation, validate, requestCorrections, sign, send, discharge, close, ' +
      'cancel, archive, unarchive, markReturned); `unavailable` says why the others are ' +
      'blocked (NO_PERMISSION, NOT_DESIGNATED, WRONG_STATUS…). Signing an outgoing effet ' +
      'needs the signed scan: send the user to its `link` for that.',
    level: READ,
    domain: MAIL,
    input: idOrReference('effet', 'M-000123 or SOR-2026-000123'),
    route: [MailController, 'findOne'],
    visibleTo: EFFET_READERS,
    link: EFFET_LINK,
    run: async (args, ctx) =>
      ctx.call(MailController, 'findOne', await effetIdOf(ctx, args), ctx.user),
  }),
  defineTool({
    name: 'get_effet_history',
    title: "An effet's history",
    description:
      "An effet's journal, newest first: who did what and when (registered, dispatched, " +
      'transmitted, validated, sent, discharged, closed…), with the notes and reasons ' +
      'given. Use for "what happened to this letter", "who validated it". Returns one page.',
    level: READ,
    domain: MAIL,
    input: {
      id: id('effet'),
      page: pageInput.page,
      limit: pageInput.limit,
    },
    route: [MailController, 'historique'],
    run: ({ id: effet, page, limit }, ctx) =>
      ctx.call(
        MailController,
        'historique',
        effet,
        ctx.user,
        String((page - 1) * limit),
        String(limit),
      ),
  }),
  restTool({
    name: 'get_effet_access',
    title: 'Who may see an effet',
    description:
      'The users explicitly granted access to an effet (canView, canEdit), besides those ' +
      'who see it through their role or designation.',
    level: READ,
    domain: MAIL,
    route: [MailController, 'getAccess'],
    ids: onEffet,
  }),

  // =========================================================== effets: drafts
  defineTool({
    name: 'register_incoming_effet',
    title: 'Register an incoming effet',
    description:
      'Register a letter or parcel received (direction ENTRANT): subject (required), ' +
      'correspondent, nature, channel (canalId), type, the reference printed on it, ' +
      'reception date, copies, due date, and, for physical effets, quantity, description, ' +
      'condition, packaging, storage and returnExpected. The dossier (or project / ' +
      'contract) may be left out and set when dispatching; `transmit: true` also ' +
      "transmits it to its dossier's responsible. Get the ids from list_correspondents, " +
      'list_courrier_natures, list_channels and list_effet_types. Scanned files cannot be ' +
      "attached here: tell the user to add them on the effet's `link`. Returns the new " +
      'effet with its number.',
    level: WRITE,
    domain: MAIL,
    input: bodyShape(CreateMailDto, ['direction', 'documents', 'body']),
    route: [MailController, 'create'],
    link: LINKS.incoming,
    run: async (args, ctx) =>
      ctx.call(
        MailController,
        'create',
        await ctx.dto(CreateMailDto, {
          ...args,
          direction: CourrierDirection.ENTRANT,
        }),
        ctx.user,
      ),
  }),
  restTool({
    name: 'create_outgoing_draft',
    title: 'Draft an outgoing effet',
    description:
      'Start an outgoing effet (BROUILLON) from its subject and, optionally, its type: its ' +
      "reference is given at once from the type's model, so the type can't change later. " +
      'Then fill it (text, correspondent, dossier…) with update_effet and submit it with ' +
      'submit_outgoing_for_validation. Returns the draft with its number and reference.',
    level: WRITE,
    domain: MAIL,
    route: [MailController, 'createOutgoing'],
    link: LINKS.outgoing,
  }),
  {
    ...restTool({
      name: 'update_effet',
      title: 'Edit an effet',
      description:
        "Change an effet's fields while it is still editable (its `available` holds " +
        "edit): subject, an outgoing effet's text (body), correspondent, nature, channel, " +
        'dossier, project, contract, supervisor, reference, dates, copies, physical ' +
        'details, response to another effet. Only the fields given change. The direction ' +
        'and the person in charge are not edited here (set_effet_owner). Returns the effet.',
      level: WRITE,
      domain: MAIL,
      route: [MailController, 'update'],
      ids: onEffet,
      link: EFFET_LINK,
    }),
    visibleTo: EFFET_READERS,
  },

  // =========================================================== effets: workflow
  {
    ...restTool({
      name: 'delete_effet',
      title: 'Delete an effet',
      description:
        'Delete an effet still editable (a draft or a just-registered letter), for good. ' +
        'Prefer cancel_effet once it has gone further.' +
        ONCE,
      level: DECISION,
      domain: MAIL,
      route: [MailController, 'remove'],
      ids: onEffet,
    }),
    visibleTo: EFFET_READERS,
  },
  {
    ...restTool({
      name: 'set_effet_owner',
      title: 'Change who is in charge of an effet',
      description:
        "Name the person in charge of an effet (ownerId, a user id). Reserved to the effet's " +
        "creator, its company's responsible or an administrator of its company." +
        ONCE,
      level: DECISION,
      domain: MAIL,
      route: [MailController, 'setOwner'],
      ids: onEffet,
      link: EFFET_LINK,
    }),
    visibleTo: EFFET_READERS,
  },
  restTool({
    name: 'set_effet_access',
    title: 'Grant access to an effet',
    description:
      "Replace an effet's explicit access list: `entries` become the complete list of " +
      'users granted access (canView, canEdit); anyone not listed loses their explicit ' +
      'grant. Read get_effet_access first and send the whole list back.',
    level: ADMIN,
    // Like every ADMIN tool: SETTINGS (who may see what).
    domain: ToolDomain.SETTINGS,
    route: [MailController, 'setAccess'],
    ids: onEffet,
  }),
  restTool({
    name: 'transmit_effet',
    title: 'Transmit an incoming effet',
    description:
      "Transmit a dispatched incoming effet to its dossier's (or contract's) responsible, " +
      'who then treats it (status TRANSMIS). It needs its dossier or contract first ' +
      '(dispatch_effet).' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'transmit'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  restTool({
    name: 'dispatch_effet',
    title: 'Dispatch an incoming effet',
    description:
      'Attach an incoming effet to its project and exactly one of its contracts or ' +
      'dossiers. A user who may dispatch directly (incoming.dispatch) applies it at once; ' +
      'otherwise it is a proposal (EN_ATTENTE_TRANSMISSION) that a dispatch validator ' +
      'validates or rejects. Find the ids with the project, contract and dossier tools.' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'dispatch'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  restTool({
    name: 'validate_dispatch',
    title: 'Validate a proposed dispatching',
    description:
      'Accept the dispatching proposed for an incoming effet: it is attached to the ' +
      'proposed project and contract or dossier.' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'validateDispatch'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  restTool({
    name: 'reject_dispatch',
    title: 'Reject a proposed dispatching',
    description:
      'Refuse the dispatching proposed for an incoming effet: it goes back to be ' +
      'dispatched (RECU) and the proposer is told why (10 characters at least).' +
      REASON +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'rejectDispatch'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  restTool({
    name: 'assign_effet_supervisor',
    title: 'Assign a supervisor to an effet',
    description:
      'Name the supervisor of an effet (supervisorId, a user id), with an optional due ' +
      'date and instruction note for them.' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'assignSupervisor'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  restTool({
    name: 'submit_outgoing_for_validation',
    title: 'Submit an outgoing effet for validation',
    description:
      'Send an outgoing draft (or one sent back for corrections) to its validator (the ' +
      "dossier's responsible, else the company's), who validates it or asks for " +
      'corrections.' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'submitForValidation'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  {
    ...restTool({
      name: 'validate_outgoing',
      title: 'Validate an outgoing effet',
      description:
        'As its designated validator, approve an outgoing effet waiting for validation: ' +
        'it becomes VALIDE and gets its final reference; it can then be signed (on its ' +
        'page, with the signed scan) and sent.' +
        ONCE,
      level: DECISION,
      domain: MAIL,
      route: [MailController, 'validate'],
      ids: onEffet,
      link: EFFET_LINK,
    }),
    visibleTo: EFFET_READERS,
  },
  {
    ...restTool({
      name: 'request_outgoing_corrections',
      title: 'Ask for corrections on an outgoing effet',
      description:
        'As its designated validator, send an outgoing effet back to its author with what ' +
        'has to be corrected (motif): it becomes A_CORRIGER.' +
        REASON +
        ONCE,
      level: DECISION,
      domain: MAIL,
      route: [MailController, 'requestCorrections'],
      ids: onEffet,
      link: EFFET_LINK,
    }),
    visibleTo: EFFET_READERS,
  },
  restTool({
    name: 'send_outgoing',
    title: 'Send an outgoing effet',
    description:
      'Record that a signed outgoing effet left: the channel used (canalId, from ' +
      'list_channels), whom it was handed to and the date. It becomes ENVOYE under a new ' +
      'bordereau number (BT-…).' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'send'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  defineTool({
    name: 'discharge_effet',
    title: 'Issue the décharge of an incoming effet',
    description:
      'Stamp the décharge handed to whoever brought a registered incoming effet (no ' +
      "status change). A sent outgoing effet's discharge needs the scanned, signed " +
      "bordereau: send the user to the effet's `link` for that." +
      ONCE,
    level: DECISION,
    domain: MAIL,
    input: { id: id('effet') },
    route: [MailController, 'discharge'],
    visibleTo: EFFET_READERS,
    link: EFFET_LINK,
    preview: 'get_effet',
    run: async ({ id: effet }, ctx) =>
      ctx.call(
        MailController,
        'discharge',
        effet,
        await ctx.dto(DischargeMailDto, {}),
        undefined,
        ctx.user,
      ),
  }),
  {
    ...restTool({
      name: 'cancel_effet',
      title: 'Cancel an effet',
      description:
        'Cancel an effet (ANNULE). An outgoing one needs its reason (10 characters at ' +
        'least), kept on it and in its journal.' +
        REASON +
        ONCE,
      level: DECISION,
      domain: MAIL,
      route: [MailController, 'cancel'],
      ids: onEffet,
      link: EFFET_LINK,
    }),
    visibleTo: EFFET_READERS,
  },
  restTool({
    name: 'close_incoming_effet',
    title: 'Close an incoming effet',
    description:
      'Close a treated incoming effet (CLOTURE), with an optional closing note. Its open ' +
      'instructions are cancelled with it.' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'close'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  restTool({
    name: 'mark_effet_returned',
    title: 'Mark a physical effet returned',
    description:
      'Record that a physical effet expected back (returnExpected) has been handed back.' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'markReturned'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  restTool({
    name: 'archive_effet',
    title: 'Archive an effet',
    description:
      'Archive a finished effet: an incoming one once CLOTURE, an outgoing one once ' +
      'DECHARGE or ANNULE, with an optional reason.' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'archive'],
    ids: onEffet,
    link: EFFET_LINK,
  }),
  restTool({
    name: 'unarchive_effet',
    title: 'Restore an archived effet',
    description:
      'Take an effet out of the archives, back to the status it had, with an optional note ' +
      'kept in its history.' +
      ONCE,
    level: DECISION,
    domain: MAIL,
    route: [MailController, 'unarchive'],
    ids: onEffet,
    link: EFFET_LINK,
  }),

  // =========================================================== correspondents
  defineTool({
    name: 'list_correspondents',
    title: 'Correspondents',
    description:
      "The company's correspondents (senders and addressees of effets): filter by type, " +
      'city or status; `search` matches name, code (CP-…), email, phone and main contact. ' +
      'Use to find the correspondentId an effet needs. Returns one page, the total and ' +
      "each correspondent's `link`.",
    level: READ,
    domain: REFERENTIALS,
    input: listShape(FindCorrespondantsQueryDto),
    route: [CorrespondantController, 'findAll'],
    link: LINKS.correspondent,
    run: async (args, ctx) =>
      ctx.call(
        CorrespondantController,
        'findAll',
        await ctx.dto(FindCorrespondantsQueryDto, query(args)),
        ctx.user,
      ),
  }),
  defineTool({
    name: 'get_correspondent',
    title: 'Open a correspondent',
    description:
      'One correspondent in full, by its id or its code (CP-…): type, address, city, ' +
      'country, email, phone, main contact, status, company.',
    level: READ,
    domain: REFERENTIALS,
    input: idOrReference('correspondent', 'CP-000042'),
    route: [CorrespondantController, 'findOne'],
    link: LINKS.correspondent,
    run: async (args, ctx) =>
      ctx.call(
        CorrespondantController,
        'findOne',
        await correspondentIdOf(ctx, args),
        ctx.user,
      ),
  }),
  defineTool({
    name: 'list_correspondent_contacts',
    title: "A correspondent's contacts",
    description:
      'The people to address at a correspondent (name, position, phone, email). Returns ' +
      'one page and the total.',
    level: READ,
    domain: REFERENTIALS,
    input: { id: id('correspondent'), ...pageInput },
    route: [CorrespondantController, 'findContacts'],
    run: async ({ id: correspondent, ...args }, ctx) =>
      ctx.call(
        CorrespondantController,
        'findContacts',
        correspondent,
        await ctx.dto(PaginationQueryDto, query(args)),
        ctx.user,
      ),
  }),
  defineTool({
    name: 'create_correspondent',
    title: 'Create a correspondent',
    description:
      'Add a correspondent to the company (default: the user’s own): name (required), ' +
      'type, address, city, country, email, phone, main contact. Check with ' +
      'list_correspondents first that it does not exist yet. Returns it with its code (CP-…).',
    level: WRITE,
    domain: REFERENTIALS,
    input: {
      ...bodyShape(CreateCorrespondentDto, ['companyId']),
      companyId: z
        .uuid()
        .optional()
        .describe("The company it belongs to (default: the user's own)"),
    },
    route: [CorrespondantController, 'create'],
    link: LINKS.correspondent,
    run: async (args, ctx) =>
      ctx.call(
        CorrespondantController,
        'create',
        await ctx.dto(CreateCorrespondentDto, {
          ...args,
          companyId: args.companyId ?? ctx.user.companyId,
        }),
        ctx.user,
      ),
  }),
  {
    ...recordAsId(
      restTool({
        name: 'update_correspondent',
        title: 'Edit a correspondent',
        description:
          "Change a correspondent's fields (only those given): name, type, address, city, " +
          'country, email, phone, main contact, status. Returns it.',
        level: WRITE,
        domain: REFERENTIALS,
        route: [CorrespondantController, 'update'],
        preview: 'get_correspondent',
        link: LINKS.correspondent,
      }),
      'uuid',
      'correspondent',
    ),
    visibleTo: [Permission.CORRESPONDENT_UPDATE],
  },
  recordAsId(
    restTool({
      name: 'add_correspondent_contact',
      title: 'Add a contact to a correspondent',
      description:
        'Add a person to address at a correspondent: name (required), position, phone, ' +
        'email. Returns the contact.',
      level: WRITE,
      domain: REFERENTIALS,
      route: [CorrespondantController, 'createContact'],
      preview: 'get_correspondent',
    }),
    'uuid',
    'correspondent',
  ),
  recordAsId(
    restTool({
      name: 'update_correspondent_contact',
      title: "Edit a correspondent's contact",
      description:
        "Change a correspondent's contact (only the fields given). Find its contactId with " +
        'list_correspondent_contacts. Returns the contact.',
      level: WRITE,
      domain: REFERENTIALS,
      route: [CorrespondantController, 'updateContact'],
      ids: { contactId: 'contact' },
      preview: 'get_correspondent',
    }),
    'uuid',
    'correspondent',
  ),
  recordAsId(
    restTool({
      name: 'remove_correspondent_contact',
      title: "Remove a correspondent's contact",
      description:
        'Remove a contact from a correspondent, for good. Find its contactId with ' +
        'list_correspondent_contacts.',
      level: DECISION,
      domain: REFERENTIALS,
      route: [CorrespondantController, 'removeContact'],
      ids: { contactId: 'contact' },
      preview: 'get_correspondent',
    }),
    'uuid',
    'correspondent',
  ),
  recordAsId(
    restTool({
      name: 'archive_correspondent',
      title: 'Archive a correspondent',
      description:
        'Archive a correspondent: it is no longer offered for new effets; the effets ' +
        'already exchanged with it keep it.',
      level: DECISION,
      domain: REFERENTIALS,
      route: [CorrespondantController, 'remove'],
      preview: 'get_correspondent',
    }),
    'uuid',
    'correspondent',
  ),

  // =========================================================== referentials for effet forms
  defineTool({
    name: 'list_courrier_natures',
    title: 'Effet natures',
    description:
      'The natures an effet can have (natureId: e.g. letter, invoice, notice…), by name. ' +
      'Use to fill register_incoming_effet or update_effet.',
    level: READ,
    domain: REFERENTIALS,
    input: pageInput,
    route: [CourrierNatureController, 'findAll'],
    run: async (args, ctx) =>
      ctx.call(
        CourrierNatureController,
        'findAll',
        await ctx.dto(PaginationQueryDto, query(args)),
      ),
  }),
  restTool({
    name: 'list_channels',
    title: 'Channels',
    description:
      "The company's channels (canaux: post, email, hand delivery, courier…), `active: " +
      "true` for those still offered. Use for an effet's canalId and for send_outgoing.",
    level: READ,
    domain: REFERENTIALS,
    route: [CanalController, 'findAll'],
  }),
  restTool({
    name: 'list_effet_types',
    title: 'Effet types',
    description:
      'The effet types the user may use (global ones and their company’s), `active: true` ' +
      'for those offered for new effets: name, whether it is physical, whether it can list ' +
      'other effets (bordereau) and its referenceModel (how outgoing references are ' +
      'numbered). Use for typeId.',
    level: READ,
    domain: REFERENTIALS,
    route: [EffetTypeController, 'findAll'],
  }),
  defineTool({
    name: 'list_correspondent_types',
    title: 'Correspondent types',
    description:
      "The company's correspondent types (client, supplier, administration…), for a " +
      "correspondent's typeId or to filter list_correspondents.",
    level: READ,
    domain: REFERENTIALS,
    input: listShape(FindCompanyListQueryDto),
    route: [CorrespondentTypeController, 'findAll'],
    run: async (args, ctx) =>
      ctx.call(
        CorrespondentTypeController,
        'findAll',
        await ctx.dto(FindCompanyListQueryDto, query(args)),
        ctx.user,
      ),
  }),
];
