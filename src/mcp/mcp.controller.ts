import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import type { AuthUser } from '../auth/types/auth-user.type';
import { AppClsStore } from '../cls.store';
import { createMcpServer } from './mcp-server.factory';
import type { McpRequest } from './mcp-tool';
import { McpToolRegistry } from './mcp-tool.registry';

export const NOT_ALLOWED = {
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Method not allowed' },
  id: null,
};

/**
 * POST /api/v1/mcp: the Model Context Protocol (Streamable HTTP, stateless, JSON answers) for
 * the Whass AI assistant. Signed in like every route (CoreAuthGuard: the core's access cookie,
 * or the same token as a Bearer header from the AI gateway; session store and app access
 * checked): the assistant can never see or do more than the user.
 */
@ApiExcludeController()
// Owner 2026-11-16: every Whass call comes from the AI gateway's one address, so the global
// per-IP limit (100/min) would throttle all users together; the gateway applies its own
// per-user message rate and daily token budgets.
@SkipThrottle()
@UseGuards(CoreAuthGuard)
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly registry: McpToolRegistry,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  @Post()
  async handle(@Req() req: McpRequest, @Res() res: Response): Promise<void> {
    if (!this.registry.enabled) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'No MCP' });
    }
    const user = req.user;
    if (!user) throw new Error('MCP called without a signed-in user');

    const store = this.cls.isActive() ? this.cls.get() : undefined;
    const requestId = store?.requestId;
    const server = createMcpServer(
      this.registry.forUser(user),
      this.registry.context(req as McpRequest & { user: AuthUser }),
      {
        requestId,
        // Tools run in the request's context, like a REST call (audit actor, permissions).
        inContext: (run) => (store ? this.cls.runWith(store, run) : run()),
      },
    );
    const transport = new StreamableHTTPServerTransport({
      // Stateless: one server per request, no session to keep or route to.
      sessionIdGenerator: undefined,
      // A single JSON answer instead of an event stream: tools answer at once.
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(
        `[${requestId ?? '-'}] MCP request failed`,
        error instanceof Error ? error.stack : String(error),
      );
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error' },
          id: null,
        });
      }
    }
  }

  // Stateless: no server-initiated stream, no session to end.
  @Get()
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  stream() {
    return NOT_ALLOWED;
  }

  @Delete()
  @HttpCode(HttpStatus.METHOD_NOT_ALLOWED)
  end() {
    return NOT_ALLOWED;
  }
}
