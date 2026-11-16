import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

/**
 * What a modification touched, sent live to the browsers so they refresh that data (as
 * EXPENZO's). It carries no record content: each browser reloads what it shows, with its own
 * permissions.
 */
export interface DataChange {
  /** First segment of the route: courriers, instructions, deliverables, analysis-sheets… */
  domain: string;
  /** What in the domain (the domain itself: Diffusion's controllers are one segment). */
  resource: string;
  /** The record's id when the route names one. */
  id?: string;
  /** The route's action (validate, sign, transmit…), or created / updated / deleted. */
  action: string;
  /** Who made it, and from which browser tab (the tab skips its own change). */
  by: string;
  clientId?: string;
  /** Made by the AI assistant (MCP tool). */
  viaAssistant?: boolean;
  at: string;
}

/** Routes whose calls are not data changes (sessions, the assistant's door, the portal). */
const IGNORED = new Set(['auth', 'mcp', 'portal']);

/** Changes that concern only the user who made them: sent to their own tabs. */
const PERSONAL = ['notifications'];

const VERB: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.POST]: 'created',
  [RequestMethod.PUT]: 'updated',
  [RequestMethod.PATCH]: 'updated',
  [RequestMethod.DELETE]: 'deleted',
};

const segments = (path: string | string[] | undefined): string[] =>
  ((Array.isArray(path) ? path[0] : path) ?? '').split('/').filter(Boolean);

/**
 * The change a handler makes, read from its route (`@Controller('courriers')` +
 * `@Post(':id/validate')` → courriers / courriers / validate), or null for reads and ignored
 * routes.
 */
export function changeOf(
  controller: Type<unknown>,
  handler: (...args: never[]) => unknown,
  params: Record<string, unknown> | undefined,
  actor: { by: string; clientId?: string; viaAssistant?: boolean },
): { change: DataChange; personal: boolean } | null {
  const method = Reflect.getMetadata(METHOD_METADATA, handler) as
    RequestMethod | undefined;
  const verb = method === undefined ? undefined : VERB[method];
  if (!verb) return null;
  const base = segments(
    Reflect.getMetadata(PATH_METADATA, controller) as string | undefined,
  );
  const own = segments(
    Reflect.getMetadata(PATH_METADATA, handler) as string | undefined,
  );
  const words = own.filter((part) => !part.startsWith(':'));
  // `@Controller()` (the app-admin routes have their own prefix): the route's first word.
  const domain = base[0] ?? words[0];
  if (!domain || IGNORED.has(domain)) return null;
  const resource = base[1] ?? domain;
  const last = words.at(-1);
  const action = last && last !== resource && last !== domain ? last : verb;
  const id = typeof params?.id === 'string' ? params.id : undefined;
  return {
    change: {
      domain,
      resource,
      ...(id ? { id } : {}),
      action,
      by: actor.by,
      ...(actor.clientId ? { clientId: actor.clientId } : {}),
      ...(actor.viaAssistant ? { viaAssistant: true } : {}),
      at: new Date().toISOString(),
    },
    personal: PERSONAL.includes(domain),
  };
}
