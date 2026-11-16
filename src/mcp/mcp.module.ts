import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { MCP_TOOL_LIST, McpToolRegistry } from './mcp-tool.registry';
import { MCP_TOOLS } from './mcp-tools';

/**
 * The Whass AI assistant's door into the API (Model Context Protocol). Tools call the domain
 * controllers already registered by their own modules, resolved from the app at call time.
 */
@Module({
  controllers: [McpController],
  providers: [McpToolRegistry, { provide: MCP_TOOL_LIST, useValue: MCP_TOOLS }],
})
export class McpModule {}
