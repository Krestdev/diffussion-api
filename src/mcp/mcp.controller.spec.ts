import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsModule } from 'nestjs-cls';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AccessService } from '../auth/access/access.service';
import { CoreAuthGuard } from '../auth/guards/core-auth.guard';
import { Permission } from '../auth/permissions';
import type { AuthUser } from '../auth/types/auth-user.type';
import { AppConfigService } from '../config/app-config.service';
import { McpController, NOT_ALLOWED } from './mcp.controller';
import { MCP_TOOL_LIST, McpToolRegistry } from './mcp-tool.registry';
import { MCP_TOOLS } from './mcp-tools';

type Tool = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  _meta?: Record<string, unknown>;
  inputSchema: { properties?: Record<string, unknown> };
};
type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

const HEADERS = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
};
let nextId = 1;
const rpc = (method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id: nextId++,
  method,
  params,
});

/** The MCP endpoint, signed in as a mocked user (CoreAuthGuard is tested on its own). */
describe('McpController (POST /mcp)', () => {
  let app: INestApplication<App>;
  let levels: string[];
  let signedIn: AuthUser | undefined;

  const userWith = (permissions: string[]): AuthUser => ({
    sub: 'u-1',
    email: 'clerk@x.com',
    name: 'Clerk',
    companyId: 'c-1',
    sid: 's-1',
    impersonator: null,
    permissions: new Set(permissions),
    platformAdmin: false,
  });

  const post = (body: object) =>
    request(app.getHttpServer()).post('/mcp').set(HEADERS).send(body);
  const tools = async () => {
    const res = await post(rpc('tools/list')).expect(200);
    return (res.body as { result: { tools: Tool[] } }).result.tools;
  };
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await post(rpc('tools/call', { name, arguments: args })).expect(
      200,
    );
    return (res.body as { result: ToolResult }).result;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ClsModule.forRoot({ global: true, middleware: { mount: true } }),
      ],
      controllers: [McpController],
      providers: [
        McpToolRegistry,
        { provide: MCP_TOOL_LIST, useValue: MCP_TOOLS },
        { provide: AppConfigService, useValue: { get: () => levels } },
        {
          provide: AccessService,
          useValue: { assertSameCompany: jest.fn() },
        },
      ],
    })
      .overrideGuard(CoreAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          if (!signedIn) return false;
          context.switchToHttp().getRequest<{ user?: AuthUser }>().user =
            signedIn;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  beforeEach(() => {
    levels = ['READ'];
    signedIn = userWith([Permission.INCOMING_READ]);
  });

  it('needs a signed-in user', async () => {
    signedIn = undefined;
    await post(rpc('tools/list')).expect(403);
  });

  it('answers 405 to GET and DELETE (stateless: no stream, no session)', async () => {
    const get = await request(app.getHttpServer()).get('/mcp').expect(405);
    expect(get.body).toEqual(NOT_ALLOWED);
    await request(app.getHttpServer()).delete('/mcp').expect(405);
  });

  it('is off (404) when MCP_TOOL_LEVELS is empty', async () => {
    levels = [];
    await post(rpc('tools/list')).expect(404);
  });

  it('lists the core tools the user may use, read-only, with the metadata the gateway reads', async () => {
    const list = await tools();
    const names = list.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_me',
        'get_my_permissions',
        'list_notifications',
        'get_unread_count',
        'global_search',
        'find_by_reference',
        'get_dashboard_overview',
        'get_dashboard_stats',
      ]),
    );
    expect(list.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(list.every((t) => t._meta?.['creapp/level'] === 'READ')).toBe(true);
    const domain = (name: string) =>
      list.find((t) => t.name === name)?._meta?.['creapp/domain'];
    expect(domain('global_search')).toBe('core');
    expect(domain('get_dashboard_overview')).toBe('dashboard');
    // The overview's company is the user's: not asked, but may be named.
    expect(
      list.find((t) => t.name === 'get_dashboard_overview')?.inputSchema
        .properties,
    ).toHaveProperty('period');
  });

  it('runs a tool as the user and answers JSON text', async () => {
    const result = await call('get_my_permissions');
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual({
      permissions: [{ code: 'incoming.read', label: expect.any(String) }],
    });
  });

  it('answers errors as { error, params }: invalid arguments, unknown tool', async () => {
    const invalid = await call('global_search', { text: 'x' });
    expect(invalid.isError).toBe(true);
    const unknown = await call('delete_everything');
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toMatch(/delete_everything/);
  });

  it('offers nothing above the levels switched on', async () => {
    levels = ['READ'];
    const readOnly = await tools();
    expect(readOnly.length).toBeGreaterThan(0);
    expect(readOnly.every((t) => t._meta?.['creapp/level'] === 'READ')).toBe(
      true,
    );

    levels = ['READ', 'WRITE'];
    const withWrite = await tools();
    expect(
      withWrite.every((t) =>
        ['READ', 'WRITE'].includes(t._meta?.['creapp/level'] as string),
      ),
    ).toBe(true);
    expect(withWrite.length).toBeGreaterThan(readOnly.length);
  });
});
