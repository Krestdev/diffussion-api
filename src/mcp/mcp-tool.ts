import { BadRequestException, type Type } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Permission } from '../auth/permissions';
import type {
  AuthUser,
  CoreRequestContext,
} from '../auth/types/auth-user.type';

/**
 * How much harm a tool can do. The AI gateway asks the user to confirm DECISION and ADMIN tools
 * (and WRITE ones) before calling them; MCP_TOOL_LEVELS decides which levels the endpoint
 * exposes at all.
 */
export const ToolLevel = {
  /** Reads only. */
  READ: 'READ',
  /** Creates or edits a draft: nobody decides, nothing leaves the company. */
  WRITE: 'WRITE',
  /** A workflow decision: dispatch, validate, reject, sign, send, close, approve… */
  DECISION: 'DECISION',
  /** Changes who may do what, or how the company works (roles, settings, referentials). */
  ADMIN: 'ADMIN',
} as const;
export type ToolLevel = (typeof ToolLevel)[keyof typeof ToolLevel];

/**
 * The area a tool belongs to. The AI gateway sends the model the `core` tools plus the
 * domains a conversation needs, instead of all of them at once.
 */
export const ToolDomain = {
  /** Who am I, notifications, global search, find by reference. */
  CORE: 'core',
  /** Effets: incoming and outgoing mail (courriers). */
  MAIL: 'mail',
  /** Instructions (tasks), livrables and their validations. */
  INSTRUCTIONS: 'instructions',
  /** Analysis sheets (fiches d'analyse) and their criteria. */
  ANALYSIS: 'analysis',
  /** Projects, contracts and dossiers. */
  PROJECTS: 'projects',
  /** Correspondents, natures, channels, effet/dossier/contract types, categories. */
  REFERENTIALS: 'referentials',
  /** Dashboard figures. */
  DASHBOARD: 'dashboard',
  /** Users, roles, companies, delegations, audit. */
  ORGANIZATION: 'organization',
  /** Every ADMIN tool: how the company is set up. */
  SETTINGS: 'settings',
} as const;
export type ToolDomain = (typeof ToolDomain)[keyof typeof ToolDomain];

type Handler = (...args: never[]) => unknown;
type HandlerKeys<T> = {
  [K in keyof T]: T[K] extends Handler ? K : never;
}[keyof T] &
  string;
type HandlerArgs<T, K extends keyof T> = T[K] extends (
  ...args: infer P
) => unknown
  ? P
  : never;
type HandlerResult<T, K extends keyof T> = T[K] extends (
  ...args: never[]
) => infer R
  ? Awaited<R>
  : never;

/** The request of the MCP call, as CoreAuthGuard left it. */
export type McpRequest = Request & {
  user?: AuthUser;
  core?: CoreRequestContext;
};

/** What a tool's `run` gets besides its arguments. */
export interface ToolContext {
  /** The signed-in person (what @CurrentUser() gives a handler). */
  user: AuthUser;
  /** The MCP request (what @Req() gives a handler: `user`, `core`). */
  request: McpRequest;
  /**
   * Calls a REST handler as the signed-in user: what PermissionsGuard checks first
   * (@RequirePermissions, @RequireAnyPermission, @PlatformAdmin, @SameCompany), then the same
   * code as the UI's call runs, with the handler's result interceptors. App-admin routes are
   * refused.
   */
  call<T, K extends HandlerKeys<T>>(
    type: Type<T>,
    method: K,
    ...args: HandlerArgs<T, K>
  ): Promise<HandlerResult<T, K>>;
  /** Builds and validates a DTO exactly as the REST validation pipe does. */
  dto<T extends object>(type: Type<T>, plain: object): Promise<T>;
  /** Whether the signed-in user holds a permission (in their company). */
  can(permission: Permission): boolean;
}

/** UI page of a record: `{id}` is replaced by its id, or a function of the record. */
export type ToolLink = string | ((record: Record<string, unknown>) => string);

export interface McpTool<S extends z.ZodRawShape = z.ZodRawShape> {
  /** snake_case, stable: the gateway and the model refer to it. */
  name: string;
  title: string;
  /** The model's only documentation: say when to use it and what comes back. */
  description: string;
  level: ToolLevel;
  input: S;
  /**
   * The REST handler the tool stands for. Its @RequirePermissions / @RequireAnyPermission /
   * @PlatformAdmin decide who sees the tool, so a tool is never wider than its route.
   */
  route?: [Type<unknown>, string];
  /**
   * Extra rule for showing the tool, when the service checks rights itself (any of them).
   * Hides tools that could only answer FORBIDDEN.
   */
  visibleTo?: readonly Permission[];
  /** UI page of a record, added to results as `link`. */
  link?: ToolLink;
  /** Set by the registry from the route's controller when not given (see tool-domains.ts). */
  domain?: ToolDomain;
  /**
   * A READ tool that shows the record a WRITE, DECISION or ADMIN tool acts on (called with its
   * `id`): the gateway puts it on the confirmation card.
   */
  preview?: string;
  run(args: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<unknown>;
}

/** Keeps each tool's argument types while storing them in one list. */
export const defineTool = <S extends z.ZodRawShape>(tool: McpTool<S>) =>
  tool as unknown as McpTool;

// ------------------------------------------------------------ shared inputs

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The values of a `{ KEY: 'value' } as const` object, for z.enum. */
export const values = <T extends Record<string, string>>(o: T) =>
  Object.values(o) as [T[keyof T], ...T[keyof T][]];

export const id = (what: string) =>
  z.uuid().describe(`Id (UUID) of the ${what}`);
export const optionalId = (what: string) =>
  z.uuid().optional().describe(`Only those of this ${what} (its UUID)`);

/** A record named by its id or by its reference / number (one of the two). */
export const idOrReference = (what: string, example: string) => ({
  id: z.uuid().optional().describe(`Id (UUID) of the ${what}`),
  reference: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe(
      `Or its reference or number, e.g. ${example} (when the id is not known)`,
    ),
});

/** VALIDATION_FAILED naming the fields, as the REST validation pipe answers. */
export function validationFailed(fields: string[], message?: string[]) {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: message ?? fields.map((field) => `${field} is invalid`),
    params: { fields },
  });
}

/** Looks a record up by `id`, else by `reference` (VALIDATION_FAILED without either). */
export function byIdOrReference<T>(
  args: { id?: string; reference?: string },
  byId: (id: string) => T,
  byReference: (reference: string) => T,
): T {
  if (args.id) return byId(args.id);
  if (args.reference) return byReference(args.reference);
  throw validationFailed(['id', 'reference'], ['Give an id or a reference']);
}

/** Page through a list: the model asks for small pages. */
export const pageInput = {
  search: z
    .string()
    .max(100)
    .optional()
    .describe(
      'Text matched against numbers, references, subjects, titles and names',
    ),
  page: z.number().int().min(1).default(1).describe('Page number, from 1'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Rows per page (default 10, at most 50)'),
};

/** A period, as day strings. */
export const periodInput = {
  from: z
    .string()
    .regex(DAY)
    .optional()
    .describe('First day included, YYYY-MM-DD'),
  to: z
    .string()
    .regex(DAY)
    .optional()
    .describe('Last day included, YYYY-MM-DD'),
};

/**
 * The tool's arguments as the REST query: Diffusion pages with `skip` / `take`, the model with
 * `page` / `limit`.
 */
export function query<A extends { page?: number; limit?: number }>(
  args: A,
): Omit<A, 'page' | 'limit'> & { skip?: number; take?: number } {
  const { page, limit, ...rest } = args;
  if (limit === undefined) return rest;
  return { ...rest, take: limit, skip: ((page ?? 1) - 1) * limit };
}
