import {
  type CallHandler,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  type NestInterceptor,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { map, type Observable } from 'rxjs';
import { z } from 'zod';
import {
  AppAdmin,
  fromParam,
  PlatformAdmin,
  RequireAnyPermission,
  RequirePermissions,
  SameCompany,
} from '../auth/access/decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Permission } from '../auth/permissions';
import type { AuthUser } from '../auth/types/auth-user.type';
import { defineTool, type McpTool, ToolDomain, ToolLevel } from './mcp-tool';
import { McpToolRegistry } from './mcp-tool.registry';
import { restTool } from './rest-tool';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

class FakeQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  take?: number;
}

@Injectable()
class Upper implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next
      .handle()
      .pipe(map((value) => ({ ...(value as object), intercepted: true })));
  }
}

@Controller('fake')
class FakeController {
  @Get()
  @RequirePermissions(Permission.INCOMING_READ)
  list(@Query() query: FakeQueryDto, @CurrentUser() user: AuthUser) {
    return { data: [{ id: ID, by: user.sub, search: query.search }], total: 1 };
  }

  @Get('any')
  @RequireAnyPermission(Permission.INCOMING_READ, Permission.OUTGOING_READ)
  any() {
    return { ok: true };
  }

  @Get('common')
  @RequirePermissions(Permission.SETTINGS_UPDATE)
  @PlatformAdmin()
  common() {
    return { ok: true };
  }

  @Get(':id')
  @SameCompany(fromParam('courrier'))
  @UseInterceptors(Upper)
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return { id, by: user.sub };
  }

  @Get('nothing')
  nothing() {
    return undefined;
  }

  @Get('admin')
  @AppAdmin()
  admin() {
    return { ok: true };
  }

  @Get('file')
  file(@Res() res: unknown) {
    return res;
  }
}

const user = (permissions: string[], platformAdmin = false): AuthUser => ({
  sub: 'u-1',
  email: 'u@x.com',
  name: 'U',
  companyId: 'c-1',
  sid: 's-1',
  impersonator: null,
  permissions: new Set(permissions),
  platformAdmin,
});

const tool = (overrides: Partial<McpTool>): McpTool =>
  defineTool({
    name: 'some_tool',
    title: 'T',
    description: 'D',
    level: ToolLevel.READ,
    input: {},
    run: () => Promise.resolve({}),
    ...overrides,
  });

describe('McpToolRegistry', () => {
  let levels: string[];
  let access: { assertSameCompany: jest.Mock };
  const controller = new FakeController();

  const registryOf = (tools: McpTool[]) => {
    const registry = new McpToolRegistry(
      { get: () => controller } as never,
      new Reflector(),
      { get: () => levels } as never,
      access as never,
      tools,
    );
    registry.onModuleInit();
    return registry;
  };
  const contextFor = (registry: McpToolRegistry, u: AuthUser) =>
    registry.context({ user: u } as never);

  beforeEach(() => {
    levels = ['READ'];
    access = { assertSameCompany: jest.fn().mockResolvedValue(undefined) };
  });

  describe('start-up checks', () => {
    it('refuses a misnamed or repeated tool', () => {
      expect(() => registryOf([tool({ name: 'Bad-Name' })])).toThrow(
        /invalid or repeated/,
      );
      expect(() => registryOf([tool({}), tool({})])).toThrow(
        /invalid or repeated/,
      );
    });

    it('refuses a route that does not exist, an app-admin route, an unknown preview', () => {
      expect(() =>
        registryOf([tool({ route: [FakeController, 'gone'] })]),
      ).toThrow(/route missing/);
      expect(() =>
        registryOf([tool({ route: [FakeController, 'admin'] })]),
      ).toThrow(/app-admin/);
      expect(() => registryOf([tool({ preview: 'get_nothing' })])).toThrow(
        /unknown preview/,
      );
    });

    it('gives each tool a domain: its own, SETTINGS for ADMIN, else CORE', () => {
      const own = tool({ name: 'own', domain: ToolDomain.MAIL });
      const admin = tool({ name: 'admin_tool', level: ToolLevel.ADMIN });
      const plain = tool({ name: 'plain' });
      registryOf([own, admin, plain]);
      expect([own.domain, admin.domain, plain.domain]).toEqual([
        'mail',
        'settings',
        'core',
      ]);
    });
  });

  describe('forUser', () => {
    const tools = () => [
      tool({ name: 'reads', route: [FakeController, 'list'] }),
      tool({ name: 'reads_any', route: [FakeController, 'any'] }),
      tool({ name: 'common_admin', route: [FakeController, 'common'] }),
      tool({ name: 'writes', level: ToolLevel.WRITE }),
      tool({ name: 'decides', level: ToolLevel.DECISION }),
      tool({ name: 'visible_to', visibleTo: [Permission.ROLE_READ] }),
    ];
    const names = (registry: McpToolRegistry, u: AuthUser) =>
      registry.forUser(u).map((t) => t.name);

    it('offers only the levels switched on (READ by default)', () => {
      const registry = registryOf(tools());
      const all = user([
        Permission.INCOMING_READ,
        Permission.SETTINGS_UPDATE,
        Permission.ROLE_READ,
      ]);
      expect(names(registry, all)).toEqual([
        'reads',
        'reads_any',
        'visible_to',
      ]);
      levels = ['READ', 'WRITE', 'DECISION'];
      expect(names(registry, all)).toEqual([
        'reads',
        'reads_any',
        'writes',
        'decides',
        'visible_to',
      ]);
      levels = [];
      expect(registry.enabled).toBe(false);
      expect(names(registry, all)).toEqual([]);
    });

    it("hides a tool whose route's permissions the user lacks", () => {
      const registry = registryOf(tools());
      expect(names(registry, user([]))).toEqual([]);
      expect(names(registry, user([Permission.OUTGOING_READ]))).toEqual([
        'reads_any',
      ]);
    });

    it('keeps @PlatformAdmin routes to platform administrators', () => {
      const registry = registryOf(tools());
      expect(
        names(registry, user([Permission.SETTINGS_UPDATE], true)),
      ).toContain('common_admin');
      expect(
        names(registry, user([Permission.SETTINGS_UPDATE], false)),
      ).not.toContain('common_admin');
    });
  });

  describe('context.call', () => {
    it('checks the route permissions before running the handler', async () => {
      const spy = jest.spyOn(controller, 'list');
      const ctx = contextFor(registryOf([]), user([]));
      await expect(
        ctx.call(FakeController, 'list', {}, ctx.user),
      ).rejects.toMatchObject({
        response: {
          code: 'FORBIDDEN',
          params: { permission: Permission.INCOMING_READ },
        },
      });
      expect(spy).not.toHaveBeenCalled();

      const allowed = contextFor(
        registryOf([]),
        user([Permission.INCOMING_READ]),
      );
      await expect(
        allowed.call(FakeController, 'list', { search: 'x' }, allowed.user),
      ).resolves.toEqual({
        data: [{ id: ID, by: 'u-1', search: 'x' }],
        total: 1,
      });
      spy.mockRestore();
    });

    it('needs one of @RequireAnyPermission, @PlatformAdmin, and refuses app-admin routes', async () => {
      const registry = registryOf([]);
      await expect(
        contextFor(registry, user([])).call(FakeController, 'any'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        contextFor(registry, user([Permission.OUTGOING_READ])).call(
          FakeController,
          'any',
        ),
      ).resolves.toEqual({ ok: true });
      await expect(
        contextFor(registry, user([Permission.SETTINGS_UPDATE])).call(
          FakeController,
          'common',
        ),
      ).rejects.toMatchObject({ response: { code: 'PLATFORM_ADMIN_ONLY' } });
      await expect(
        contextFor(registry, user([], true)).call(FakeController, 'admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('checks @SameCompany on the id the handler gets, then runs its interceptors', async () => {
      const ctx = contextFor(registryOf([]), user([]));
      await expect(
        ctx.call(FakeController, 'one', ID, ctx.user),
      ).resolves.toEqual({ id: ID, by: 'u-1', intercepted: true });
      expect(access.assertSameCompany).toHaveBeenCalledWith(
        'u-1',
        'courrier',
        ID,
      );

      access.assertSameCompany.mockRejectedValue(
        new ForbiddenException('This belongs to another company'),
      );
      await expect(
        ctx.call(FakeController, 'one', ID, ctx.user),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('validates a DTO as the REST pipe does', async () => {
      const ctx = contextFor(registryOf([]), user([]));
      await expect(ctx.dto(FakeQueryDto, { take: 5 })).resolves.toEqual({
        take: 5,
      });
      await expect(
        ctx.dto(FakeQueryDto, { take: -1, other: 1 }),
      ).rejects.toMatchObject({
        response: {
          code: 'VALIDATION_FAILED',
          params: { fields: expect.arrayContaining(['take', 'other']) },
        },
      });
    });
  });

  describe('restTool', () => {
    it('turns path parameters and the query DTO into flat arguments, and passes the user', async () => {
      const list = restTool({
        name: 'list_fake',
        title: 'List',
        description: 'D',
        level: ToolLevel.READ,
        route: [FakeController, 'list'],
      });
      expect(Object.keys(list.input)).toEqual(['search', 'take']);
      const one = restTool({
        name: 'get_fake',
        title: 'Get',
        description: 'D',
        level: ToolLevel.READ,
        route: [FakeController, 'one'],
        ids: { id: 'effet' },
      });
      expect(Object.keys(one.input)).toEqual(['id']);
      expect(one.preview).toBe('get_effet');
      expect(z.object(one.input).safeParse({ id: 'nope' }).success).toBe(false);

      const ctx = contextFor(registryOf([]), user([Permission.INCOMING_READ]));
      await expect(list.run({ search: 'abc' }, ctx)).resolves.toEqual({
        data: [{ id: ID, by: 'u-1', search: 'abc' }],
        total: 1,
      });
      await expect(one.run({ id: ID }, ctx)).resolves.toMatchObject({
        id: ID,
        by: 'u-1',
      });
    });

    it('answers { done: true } for a handler that returns nothing', async () => {
      const nothing = restTool({
        name: 'do_nothing',
        title: 'N',
        description: 'D',
        level: ToolLevel.WRITE,
        route: [FakeController, 'nothing'],
      });
      const ctx = contextFor(registryOf([]), user([]));
      await expect(nothing.run({}, ctx)).resolves.toEqual({ done: true });
    });

    it('refuses a handler that takes what a tool cannot give (@Res, files)', () => {
      expect(() =>
        restTool({
          name: 'download_fake',
          title: 'F',
          description: 'D',
          level: ToolLevel.READ,
          route: [FakeController, 'file'],
        }),
      ).toThrow(/@Res\(\)/);
    });
  });
});
