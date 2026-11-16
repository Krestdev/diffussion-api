import type { McpTool } from './mcp-tool';
import { CORE_TOOLS } from './tools/core.tools';
import { INSTRUCTION_TOOLS } from './tools/instructions.tools';
import { MAIL_TOOLS } from './tools/mail.tools';
import { PROJECT_TOOLS } from './tools/projects.tools';

/**
 * Every tool the MCP endpoint offers. Phase 2 adds one file per domain under tools/ (see the
 * tool plan) and lists it here.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  ...CORE_TOOLS,
  ...MAIL_TOOLS,
  ...INSTRUCTION_TOOLS,
  ...PROJECT_TOOLS,
];
