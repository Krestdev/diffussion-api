import { Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { errorBody, shape } from './mcp-result';
import { type McpTool, type ToolContext, ToolLevel } from './mcp-tool';

const logger = new Logger('McpTools');

/** Told to the model once per session: how to read what the tools return. */
export const INSTRUCTIONS = [
  'Diffusion manages a company\'s mail ("effets"): incoming mail (registered, dispatched to ' +
    'a supervisor, handled through instructions), outgoing mail (drafted, validated, signed, ' +
    'sent, discharged), the instructions (tasks) given on them and their livrables ' +
    "(deliverables), analysis sheets (fiches d'analyse), and the projects, contracts and " +
    'dossiers they belong to, with the correspondents they come from or go to.',
  'Every tool acts as the signed-in user: it only sees and does what the user may.',
  'Records are found by id or by number/reference: effets have a number (M-000123) and ' +
    "a reference (printed on an incoming letter; SOR-2026-000123 or the effet type's model " +
    'for an outgoing one); tasks T-…, dossiers D-… (or their own number), contracts CT-… ' +
    '(or their reference), analysis sheets FA-…, correspondents CP-…, projects their ' +
    'reference. When the user names a reference, a number or an id, use find_by_reference ' +
    'or global_search instead of asking.',
  "Dates are ISO; day filters are YYYY-MM-DD. Statuses are the API's codes (RECU, " +
    'EN_TRAITEMENT, BROUILLON, VALIDE, ENVOYE…): say them in plain words.',
  '`available` lists the actions the user can take on a record now; `unavailable` gives ' +
    'each other action with a reason code (NO_PERMISSION, WRONG_STATUS, NOT_DESIGNATED, ' +
    'OWN_ITEM, DOSSIER_CLOSED, INSTRUCTIONS_OPEN, NOTHING_TO_DECIDE, PREREQUISITE_MISSING, ' +
    'TOO_SOON): explain it.',
  "`link` is the record's page in the app: offer it to the user.",
  'Errors come back as {"error": CODE, "params": {...}, "message": ...}: explain them ' +
    "plainly, never invent data, and answer in the user's language (get_me: language).",
].join('\n');

const text = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value ?? null) }],
});

/** An MCP server for one request of one user (stateless: no session is kept). */
export function createMcpServer(
  tools: McpTool[],
  ctx: ToolContext,
  options: {
    requestId?: string;
    /** Runs a tool in the request's context (CLS: user, company, audit). */
    inContext: <T>(run: () => Promise<T>) => Promise<T>;
  },
): McpServer {
  const server = new McpServer(
    { name: 'diffusion', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  for (const tool of tools) {
    const reads = tool.level === ToolLevel.READ;
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: reads,
          destructiveHint: !reads && tool.level !== ToolLevel.WRITE,
          idempotentHint: reads,
          openWorldHint: false,
        },
        // The AI gateway reads the same keys as for EXPENZO: it asks the user to confirm
        // WRITE, DECISION and ADMIN tools; `domain` lets it send only the tools a
        // conversation needs; `preview` names the READ tool that shows the record on the
        // confirmation card.
        _meta: {
          'creapp/level': tool.level,
          'creapp/domain': tool.domain,
          ...(tool.preview ? { 'creapp/preview': tool.preview } : {}),
        },
      },
      (args: Record<string, unknown>) =>
        options.inContext(async () => {
          try {
            return text(shape(await tool.run(args, ctx), tool.link));
          } catch (error) {
            const body = errorBody(error);
            if (body.statusCode >= 500) {
              logger.error(
                `[${options.requestId ?? '-'}] ${tool.name}: ${body.code}`,
                error instanceof Error ? error.stack : String(error),
              );
            }
            return {
              ...text({
                error: body.code,
                params: body.params,
                message: body.message,
              }),
              isError: true,
            };
          }
        }),
    );
  }
  return server;
}
