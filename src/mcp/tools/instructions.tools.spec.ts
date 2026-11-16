import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AnalysisController } from '../../analysis/analysis.controller';
import { CriterionTemplateController } from '../../analysis/criterion-template.controller';
import { Permission } from '../../auth/permissions';
import type { AuthUser } from '../../auth/types/auth-user.type';
import { DeliverableController } from '../../domain/deliverable/deliverable.controller';
import { InstructionsController } from '../../instructions/instructions.controller';
import { ToolDomain, ToolLevel } from '../mcp-tool';
import { McpToolRegistry } from '../mcp-tool.registry';
import { INSTRUCTION_TOOLS } from './instructions.tools';

const ID = '0190a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b';
const LIVRABLE_ID = '0190a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5c';

const { READ, WRITE, DECISION, ADMIN } = ToolLevel;

const LEVELS: Record<string, ToolLevel> = {
  search_my_tasks: READ,
  search_instructions: READ,
  get_workload: READ,
  get_instruction: READ,
  get_instruction_history: READ,
  create_instructions: WRITE,
  update_instruction: WRITE,
  set_agent_due_date: WRITE,
  remind_instruction: DECISION,
  assign_instruction: DECISION,
  subscribe_instruction: DECISION,
  decline_instruction: DECISION,
  approve_livrables: DECISION,
  approve_selected_livrables: DECISION,
  request_instruction_corrections: DECISION,
  close_instruction: DECISION,
  cancel_instruction: DECISION,
  list_livrables: READ,
  get_livrable: READ,
  create_livrable: WRITE,
  update_livrable: WRITE,
  new_livrable_version: DECISION,
  delete_livrable: DECISION,
  deposit_livrable: DECISION,
  submit_livrable: DECISION,
  give_livrable_opinion: DECISION,
  reject_livrable: DECISION,
  search_analysis_sheets: READ,
  get_analysis_sheet: READ,
  get_analysis_summary: READ,
  create_analysis_sheet: WRITE,
  update_analysis_sheet: WRITE,
  add_analysis_item: WRITE,
  update_analysis_item: WRITE,
  set_analysis_criteria: WRITE,
  remove_analysis_item: DECISION,
  delete_analysis_sheet: DECISION,
  submit_analysis_sheet: DECISION,
  decide_analysis_sheet: DECISION,
  new_analysis_version: DECISION,
  archive_analysis_sheet: DECISION,
  unarchive_analysis_sheet: DECISION,
  list_analysis_criteria: READ,
  get_analysis_criterion: READ,
  get_analysis_settings: READ,
  create_analysis_criterion: ADMIN,
  update_analysis_criterion: ADMIN,
  delete_analysis_criterion: ADMIN,
  update_analysis_settings: ADMIN,
};

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

describe('INSTRUCTION_TOOLS (package B)', () => {
  // ctx.call runs the real handlers: mock the services they call.
  const instructions = {
    assertVisible: jest.fn().mockResolvedValue(undefined),
    findOneWithActions: jest.fn(),
    findMyTasks: jest.fn(),
    close: jest.fn(),
    rejectLivrable: jest.fn(),
  };
  const sheets = { findOneWithActions: jest.fn(), findAll: jest.fn() };
  const controllers = new Map<unknown, unknown>([
    [InstructionsController, { instructionsService: instructions }],
    [DeliverableController, { instructionsService: instructions }],
    [AnalysisController, { sheets }],
    [CriterionTemplateController, { templates: {} }],
  ]);
  const access = { assertSameCompany: jest.fn().mockResolvedValue(undefined) };

  const registry = new McpToolRegistry(
    { get: (type: unknown) => controllers.get(type) } as never,
    new Reflector(),
    { get: () => [READ, WRITE, DECISION, ADMIN] } as never,
    access as never,
    INSTRUCTION_TOOLS,
  );
  registry.onModuleInit();

  const tool = (name: string) => {
    const found = INSTRUCTION_TOOLS.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  const run = (name: string, args: object, u: AuthUser) =>
    tool(name).run(args as never, registry.context({ user: u } as never));

  beforeEach(() => jest.clearAllMocks());

  it('registers every tool once, at its level, with a known preview', () => {
    const names = INSTRUCTION_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(
      Object.fromEntries(INSTRUCTION_TOOLS.map((t) => [t.name, t.level])),
    ).toEqual(LEVELS);
    for (const t of INSTRUCTION_TOOLS) {
      if (t.preview) expect(names).toContain(t.preview);
    }
    expect(tool('close_instruction').preview).toBe('get_instruction');
    expect(tool('reject_livrable').preview).toBe('get_livrable');
    expect(tool('decide_analysis_sheet').preview).toBe('get_analysis_sheet');
  });

  it('puts each tool in its domain, ADMIN ones in settings', () => {
    for (const t of INSTRUCTION_TOOLS) {
      const expected =
        t.level === ADMIN
          ? ToolDomain.SETTINGS
          : t.route?.[0] === AnalysisController ||
              t.route?.[0] === CriterionTemplateController
            ? ToolDomain.ANALYSIS
            : ToolDomain.INSTRUCTIONS;
      expect([t.name, t.domain]).toEqual([t.name, expected]);
    }
  });

  it('get_instruction reads the task through InstructionsController.findOne', async () => {
    const u = user([]);
    instructions.findOneWithActions.mockResolvedValue({
      id: ID,
      livrables: [],
    });
    await expect(run('get_instruction', { id: ID }, u)).resolves.toEqual({
      id: ID,
      livrables: [],
    });
    expect(instructions.findOneWithActions).toHaveBeenCalledWith(ID, 'u-1');
  });

  it('get_instruction finds a task by its number among the user’s tasks', async () => {
    const u = user([]);
    instructions.findMyTasks.mockResolvedValue({
      data: [
        { id: LIVRABLE_ID, number: 'T-000124' },
        { id: ID, number: 'T-000123' },
      ],
      total: 2,
    });
    instructions.findOneWithActions.mockResolvedValue({ id: ID });
    await run('get_instruction', { reference: 't-000123' }, u);
    expect(instructions.findMyTasks).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'all', search: 't-000123' }),
      'u-1',
    );
    expect(instructions.findOneWithActions).toHaveBeenCalledWith(ID, 'u-1');
  });

  it('search_my_tasks pages with skip/take', async () => {
    const u = user([]);
    instructions.findMyTasks.mockResolvedValue({ data: [], total: 0 });
    await run('search_my_tasks', { tab: 'all', page: 3, limit: 5 }, u);
    expect(instructions.findMyTasks).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'all', skip: 10, take: 5 }),
      'u-1',
    );
  });

  it('reject_livrable calls DeliverableController.reject with the motif', async () => {
    const u = user([]);
    instructions.rejectLivrable.mockResolvedValue({ id: LIVRABLE_ID });
    await run(
      'reject_livrable',
      { id: LIVRABLE_ID, motif: 'Plan illisible' },
      u,
    );
    expect(instructions.rejectLivrable).toHaveBeenCalledWith(
      LIVRABLE_ID,
      'Plan illisible',
      'u-1',
    );
    expect(access.assertSameCompany).toHaveBeenCalledWith(
      'u-1',
      'livrable',
      LIVRABLE_ID,
    );
  });

  it('close_instruction needs INSTRUCTION_CLOSE: hidden and refused without it', async () => {
    const without = user([Permission.INSTRUCTION_READ]);
    expect(registry.forUser(without).map((t) => t.name)).not.toContain(
      'close_instruction',
    );
    await expect(
      run('close_instruction', { id: ID, comment: 'ok' }, without),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(instructions.close).not.toHaveBeenCalled();

    const holder = user([Permission.INSTRUCTION_CLOSE]);
    expect(registry.forUser(holder).map((t) => t.name)).toContain(
      'close_instruction',
    );
    instructions.close.mockResolvedValue({ id: ID, status: 'TERMINEE' });
    await run('close_instruction', { id: ID, comment: 'ok' }, holder);
    expect(instructions.close).toHaveBeenCalledWith(ID, 'ok');
  });

  it('shows the criterion administration to SETTINGS_UPDATE holders only', () => {
    const admin = ['create_analysis_criterion', 'update_analysis_settings'];
    const reader = registry
      .forUser(user([Permission.ANALYSIS_READ]))
      .map((t) => t.name);
    expect(reader).toContain('list_analysis_criteria');
    for (const name of admin) expect(reader).not.toContain(name);
    const manager = registry
      .forUser(user([Permission.ANALYSIS_READ, Permission.SETTINGS_UPDATE]))
      .map((t) => t.name);
    for (const name of admin) expect(manager).toContain(name);
  });
});
