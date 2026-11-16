import { ForbiddenException, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { RoleController } from '../../administration/role/role.controller';
import { Permission } from '../../auth/permissions';
import type { AuthUser } from '../../auth/types/auth-user.type';
import { ProjectController } from '../../referentials/project/project.controller';
import { type McpTool, ToolDomain, ToolLevel } from '../mcp-tool';
import { McpToolRegistry } from '../mcp-tool.registry';
import { MCP_TOOLS } from '../mcp-tools';
import { PROJECT_TOOLS } from './projects.tools';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ALL_LEVELS = Object.values(ToolLevel);

const user = (permissions: string[]): AuthUser => ({
  sub: 'u-1',
  email: 'u@x.com',
  name: 'U',
  companyId: 'c-1',
  sid: 's-1',
  impersonator: null,
  permissions: new Set(permissions),
  platformAdmin: false,
});

describe('PROJECT_TOOLS (package C)', () => {
  const controllers = new Map<Type<unknown>, object>();
  /** The controller, its service (`field`) mocked: the tool runs the real handler. */
  const mock = (
    type: Type<unknown>,
    field: string,
    service: Record<string, jest.Mock>,
  ) =>
    controllers.set(
      type,
      Object.assign(Object.create(type.prototype as object) as object, {
        [field]: service,
      }),
    );

  const registry = (tools: readonly McpTool[] = PROJECT_TOOLS) => {
    const r = new McpToolRegistry(
      { get: (type: Type<unknown>) => controllers.get(type) ?? {} } as never,
      new Reflector(),
      { get: () => ALL_LEVELS } as never,
      { assertSameCompany: jest.fn() } as never,
      tools,
    );
    r.onModuleInit();
    return r;
  };
  const tool = (name: string) => {
    const found = PROJECT_TOOLS.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };

  beforeEach(() => controllers.clear());

  it('registers every tool with a unique name, alone and with the other packages', () => {
    expect(() => registry()).not.toThrow();
    expect(() => registry(MCP_TOOLS)).not.toThrow();
    const names = PROJECT_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(90);
  });

  it('gives every tool an input the MCP SDK can describe', () => {
    for (const t of PROJECT_TOOLS) {
      expect(() => z.toJSONSchema(z.object(t.input))).not.toThrow();
    }
  });

  it('sets the domain on every tool, ADMIN ones in SETTINGS', () => {
    for (const t of PROJECT_TOOLS) {
      expect(t.domain).toBeDefined();
      if (t.level === ToolLevel.ADMIN)
        expect(t.domain).toBe(ToolDomain.SETTINGS);
    }
  });

  it('gives each tool its level', () => {
    const levels: Record<string, ToolLevel> = {
      search_projects: ToolLevel.READ,
      get_project: ToolLevel.READ,
      get_contract_history: ToolLevel.READ,
      list_dossier_effets: ToolLevel.READ,
      create_project: ToolLevel.WRITE,
      update_contract: ToolLevel.WRITE,
      create_dossier: ToolLevel.WRITE,
      close_project: ToolLevel.DECISION,
      unarchive_project: ToolLevel.DECISION,
      delete_contract: ToolLevel.DECISION,
      archive_dossier: ToolLevel.DECISION,
      set_project_access: ToolLevel.ADMIN,
      update_user_roles: ToolLevel.ADMIN,
      create_role: ToolLevel.ADMIN,
      create_delegation: ToolLevel.ADMIN,
      update_settings: ToolLevel.ADMIN,
      update_notification_settings: ToolLevel.ADMIN,
      create_effet_type: ToolLevel.ADMIN,
      delete_correspondent_type: ToolLevel.ADMIN,
      mark_notification_read: ToolLevel.WRITE,
      list_documents: ToolLevel.READ,
      delete_document: ToolLevel.DECISION,
    };
    for (const [name, level] of Object.entries(levels)) {
      expect([name, tool(name).level]).toEqual([name, level]);
    }
    expect(tool('mark_notification_read').domain).toBe(ToolDomain.CORE);
    expect(tool('update_project').preview).toBe('get_project');
  });

  it('a READ tool pages the controller as the user (search_projects)', async () => {
    const findAll = jest.fn().mockResolvedValue({ data: [], total: 0 });
    mock(ProjectController, 'projectService', { findAll });
    const u = user([Permission.PROJECT_READ]);
    const ctx = registry().context({ user: u } as never);
    await tool('search_projects').run(
      { search: 'Viaduc', status: 'ACTIVE', page: 3, limit: 5 },
      ctx,
    );
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'Viaduc',
        status: 'ACTIVE',
        skip: 10,
        take: 5,
      }),
      u.sub,
    );
  });

  it('get_project finds a project by its reference', async () => {
    const findAll = jest.fn().mockResolvedValue({
      data: [{ id: ID, reference: 'PRJ-2026-07' }],
      total: 1,
    });
    const findOne = jest.fn().mockResolvedValue({ id: ID });
    mock(ProjectController, 'projectService', {
      findAll,
      findOneFor: findOne,
    });
    const u = user([Permission.PROJECT_READ]);
    const ctx = registry().context({ user: u } as never);
    await tool('get_project').run({ reference: 'prj-2026-07' }, ctx);
    expect(findOne).toHaveBeenCalledWith(ID, u.sub);
  });

  it('an ADMIN tool calls the controller with the DTO (update_role)', async () => {
    const update = jest.fn().mockResolvedValue({ id: ID });
    mock(RoleController, 'roles', { update });
    const u = user([Permission.ROLE_UPDATE]);
    const ctx = registry().context({ user: u } as never);
    await tool('update_role').run({ id: ID, name: 'Archivist' }, ctx);
    expect(update).toHaveBeenCalledWith(
      u.companyId,
      ID,
      expect.objectContaining({ name: 'Archivist' }),
    );
  });

  it('refuses and hides what the user may not do', async () => {
    const update = jest.fn();
    mock(RoleController, 'roles', { update });
    const u = user([Permission.ROLE_READ]);
    const r = registry();
    await expect(
      tool('update_role').run(
        { id: ID, name: 'X' },
        r.context({ user: u } as never),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();

    const visible = r.forUser(u).map((t) => t.name);
    expect(visible).toContain('list_roles');
    expect(visible).not.toContain('update_role');
    // visibleTo: the service checks USER_READ itself.
    expect(visible).not.toContain('list_users');
    // @PlatformAdmin: common lists.
    expect(visible).not.toContain('create_courrier_nature');
  });
});
