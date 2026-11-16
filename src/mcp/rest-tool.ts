import type { Type } from '@nestjs/common';
import { z } from 'zod';
import { dtoShape } from './dto-schema';
import type { McpTool, ToolDomain, ToolLevel, ToolLink } from './mcp-tool';
import { routeArgs } from './route-args';

/**
 * The READ tool showing each kind of record, by what a tool's `id` parameter identifies
 * (`ids: { id: 'effet' }`): the gateway shows it on the confirmation card. Each must exist
 * (the registry checks at start-up).
 */
const PREVIEWS: Record<string, string> = {
  effet: 'get_effet',
  instruction: 'get_instruction',
  livrable: 'get_livrable',
  dossier: 'get_dossier',
  contract: 'get_contract',
  project: 'get_project',
  correspondent: 'get_correspondent',
  'analysis sheet': 'get_analysis_sheet',
  user: 'get_user',
  role: 'get_role',
};

type Arg =
  | { kind: 'param'; name: string }
  | { kind: 'field'; name: string }
  | { kind: 'dto'; type: Type<object> | undefined; fields: string[] }
  | { kind: 'user' }
  | { kind: 'request' };

/**
 * A tool that is exactly one REST handler: its path parameters and its body (or query) DTO
 * become the tool's flat arguments, read from the route's own metadata; @CurrentUser() and
 * @Req() are the signed-in person and the MCP request.
 *
 * `ids` names what each path parameter identifies, for the model ("effet", "contact").
 * Handlers taking a file (@UploadedFile), a response stream (@Res) or anything else a tool
 * can't give are refused at start-up.
 */
export function restTool(options: {
  name: string;
  title: string;
  description: string;
  level: ToolLevel;
  route: [Type<unknown>, string];
  ids?: Record<string, string>;
  link?: ToolLink;
  domain?: ToolDomain;
  /** Defaults to the READ tool of the record `ids.id` names (see PREVIEWS). */
  preview?: string;
  /** Fixed values for some arguments (hidden from the model), e.g. a tab. */
  fixed?: Record<string, unknown>;
}): McpTool {
  const [controller, method] = options.route;
  const fixed = options.fixed ?? {};
  const input: Record<string, z.ZodType> = {};
  const args: Arg[] = [];
  const add = (name: string, schema: z.ZodType) => {
    if (name in fixed) return;
    if (name in input) {
      throw new Error(
        `MCP tool ${options.name}: argument "${name}" appears twice in ${controller.name}.${method}`,
      );
    }
    input[name] = schema;
  };

  for (const arg of routeArgs(controller, method)) {
    switch (arg.kind) {
      case 'param': {
        const what = options.ids?.[arg.name] ?? arg.name;
        add(
          arg.name,
          arg.uuid
            ? z.uuid().describe(`Id (UUID) of the ${what}`)
            : z.string().min(1).describe(what),
        );
        args[arg.index] = { kind: 'param', name: arg.name };
        break;
      }
      case 'body':
      case 'query': {
        if (arg.field) {
          add(arg.field, z.string().optional());
          args[arg.index] = { kind: 'field', name: arg.field };
          break;
        }
        const shape = arg.type ? dtoShape(arg.type) : {};
        for (const [field, schema] of Object.entries(shape)) add(field, schema);
        args[arg.index] = {
          kind: 'dto',
          type: arg.type,
          fields: Object.keys(shape),
        };
        break;
      }
      case 'user':
        args[arg.index] = { kind: 'user' };
        break;
      case 'request':
        args[arg.index] = { kind: 'request' };
        break;
      default:
        throw new Error(
          `MCP tool ${options.name}: ${controller.name}.${method} takes ${arg.what}, which a tool can't give`,
        );
    }
  }

  return {
    name: options.name,
    title: options.title,
    description: options.description,
    level: options.level,
    input,
    route: options.route,
    link: options.link,
    domain: options.domain,
    preview:
      options.preview ??
      (options.ids?.id ? PREVIEWS[options.ids.id] : undefined),
    run: async (given: Record<string, unknown>, ctx) => {
      const values = { ...given, ...fixed };
      const callArgs = await Promise.all(
        args.map(async (arg) => {
          switch (arg.kind) {
            case 'param':
            case 'field':
              return values[arg.name];
            case 'user':
              return ctx.user;
            case 'request':
              return ctx.request;
            case 'dto': {
              const plain = Object.fromEntries(
                arg.fields.map((field) => [field, values[field]]),
              );
              return arg.type ? ctx.dto(arg.type, plain) : plain;
            }
          }
        }),
      );
      const result = await ctx.call(
        controller as Type<Record<string, (...a: unknown[]) => unknown>>,
        method,
        ...(callArgs as never[]),
      );
      // Handlers answering 204 return nothing: tell the model it worked.
      return result ?? { done: true };
    },
  };
}
