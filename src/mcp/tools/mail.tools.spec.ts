import { ForbiddenException, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '../../auth/permissions';
import type { AuthUser } from '../../auth/types/auth-user.type';
import { MailController } from '../../domain/mail/mail.controller';
import { CorrespondantController } from '../../referentials/correspondent/correspondent.controller';
import { type McpTool, ToolDomain, ToolLevel } from '../mcp-tool';
import { McpToolRegistry } from '../mcp-tool.registry';
import { MAIL_TOOLS } from './mail.tools';

const EFFET = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const OTHER = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

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

const LEVELS: Record<string, ToolLevel> = {
  search_incoming_effets: 'READ',
  search_outgoing_effets: 'READ',
  search_effets: 'READ',
  list_effets_awaiting_my_validation: 'READ',
  get_effet: 'READ',
  get_effet_history: 'READ',
  get_effet_access: 'READ',
  register_incoming_effet: 'WRITE',
  create_outgoing_draft: 'WRITE',
  update_effet: 'WRITE',
  delete_effet: 'DECISION',
  set_effet_owner: 'DECISION',
  set_effet_access: 'ADMIN',
  transmit_effet: 'DECISION',
  dispatch_effet: 'DECISION',
  validate_dispatch: 'DECISION',
  reject_dispatch: 'DECISION',
  assign_effet_supervisor: 'DECISION',
  submit_outgoing_for_validation: 'DECISION',
  validate_outgoing: 'DECISION',
  request_outgoing_corrections: 'DECISION',
  send_outgoing: 'DECISION',
  discharge_effet: 'DECISION',
  cancel_effet: 'DECISION',
  close_incoming_effet: 'DECISION',
  mark_effet_returned: 'DECISION',
  archive_effet: 'DECISION',
  unarchive_effet: 'DECISION',
  list_correspondents: 'READ',
  get_correspondent: 'READ',
  list_correspondent_contacts: 'READ',
  create_correspondent: 'WRITE',
  update_correspondent: 'WRITE',
  add_correspondent_contact: 'WRITE',
  update_correspondent_contact: 'WRITE',
  remove_correspondent_contact: 'DECISION',
  archive_correspondent: 'DECISION',
  list_courrier_natures: 'READ',
  list_channels: 'READ',
  list_effet_types: 'READ',
  list_correspondent_types: 'READ',
};

describe('MAIL_TOOLS (package A)', () => {
  let levels: string[];
  let mailService: Record<string, jest.Mock>;
  let correspondentService: Record<string, jest.Mock>;
  let registry: McpToolRegistry;

  const byName = (name: string): McpTool => {
    const found = MAIL_TOOLS.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  // The MCP request is JSON: the upload interceptors (multer) of create / discharge let it
  // through untouched.
  const run = (name: string, args: Record<string, unknown>, u: AuthUser) =>
    byName(name).run(
      args,
      registry.context({
        user: u,
        headers: { 'content-type': 'application/json' },
      } as never),
    );

  beforeEach(() => {
    levels = ['READ', 'WRITE', 'DECISION', 'ADMIN'];
    mailService = {
      findOneDetailed: jest.fn().mockResolvedValue({ id: EFFET }),
      findAll: jest.fn().mockResolvedValue({
        data: [
          { id: OTHER, number: 'M-000124' },
          { id: EFFET, number: 'M-000123' },
        ],
        total: 2,
      }),
      validateDispatch: jest.fn().mockResolvedValue({ id: EFFET }),
      rejectDispatch: jest.fn().mockResolvedValue({ id: EFFET }),
      create: jest.fn().mockResolvedValue({ id: EFFET }),
      discharge: jest.fn().mockResolvedValue({ id: EFFET }),
      assertVisible: jest.fn().mockResolvedValue(undefined),
    };
    correspondentService = {
      update: jest.fn().mockResolvedValue({ id: OTHER }),
    };
    const controllers = new Map<Type<unknown>, unknown>([
      [MailController, new MailController(mailService as never)],
      [
        CorrespondantController,
        new CorrespondantController(correspondentService as never),
      ],
    ]);
    registry = new McpToolRegistry(
      { get: (type: Type<unknown>) => controllers.get(type) } as never,
      new Reflector(),
      { get: () => levels } as never,
      { assertSameCompany: jest.fn().mockResolvedValue(undefined) } as never,
      MAIL_TOOLS,
    );
    registry.onModuleInit();
  });

  it('registers every tool once, at its level, in the mail, referentials or (ADMIN) settings domain', () => {
    const names = MAIL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(
      Object.fromEntries(MAIL_TOOLS.map((t) => [t.name, t.level])),
    ).toEqual(LEVELS);
    for (const tool of MAIL_TOOLS) {
      expect([
        ToolDomain.MAIL,
        ToolDomain.REFERENTIALS,
        ToolDomain.SETTINGS,
      ]).toContain(tool.domain);
      if (tool.domain === ToolDomain.SETTINGS) expect(tool.level).toBe('ADMIN');
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('gives every decision on a record the preview of that record', () => {
    for (const tool of MAIL_TOOLS) {
      if (tool.level === ToolLevel.READ || !('id' in tool.input)) continue;
      expect([tool.name, tool.preview]).toEqual([
        tool.name,
        expect.stringMatching(/^get_(effet|correspondent)$/),
      ]);
    }
  });

  it('reads an effet through MailController.findOne, by id or by number', async () => {
    const reader = user([Permission.INCOMING_READ]);
    await expect(run('get_effet', { id: EFFET }, reader)).resolves.toEqual({
      id: EFFET,
    });
    expect(mailService.findOneDetailed).toHaveBeenCalledWith(EFFET, 'u-1');

    await run('get_effet', { reference: 'm-000123' }, reader);
    expect(mailService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'm-000123', take: 10 }),
      'u-1',
    );
    expect(mailService.findOneDetailed).toHaveBeenLastCalledWith(EFFET, 'u-1');

    await expect(
      run('get_effet', { reference: 'M-999' }, reader),
    ).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });

  it('validates and rejects a dispatching through MailController', async () => {
    const validator = user([
      Permission.INCOMING_READ,
      Permission.INCOMING_DISPATCH_VALIDATE,
    ]);
    await run('validate_dispatch', { id: EFFET }, validator);
    expect(mailService.validateDispatch).toHaveBeenCalledWith(EFFET, 'u-1');

    await run(
      'reject_dispatch',
      { id: EFFET, reason: 'Wrong project, see the letterhead' },
      validator,
    );
    expect(mailService.rejectDispatch).toHaveBeenCalledWith(
      EFFET,
      'Wrong project, see the letterhead',
      'u-1',
    );
    // The DTO still validates: 10 characters at least.
    await expect(
      run('reject_dispatch', { id: EFFET, reason: 'no' }, validator),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
  });

  it('refuses, and hides, a decision the user lacks the permission for', async () => {
    const reader = user([Permission.INCOMING_READ]);
    await expect(
      run('validate_dispatch', { id: EFFET }, reader),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mailService.validateDispatch).not.toHaveBeenCalled();

    const names = registry.forUser(reader).map((t) => t.name);
    expect(names).toContain('get_effet');
    expect(names).not.toContain('validate_dispatch');
    expect(names).not.toContain('register_incoming_effet');
    expect(names).not.toContain('list_correspondents');
    expect(registry.forUser(user([])).map((t) => t.name)).not.toContain(
      'get_effet',
    );
  });

  it('registers an incoming effet as ENTRANT, without files', async () => {
    await run(
      'register_incoming_effet',
      { subject: 'Demande de pièces' },
      user([Permission.INCOMING_CREATE]),
    );
    expect(mailService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Demande de pièces',
        direction: 'ENTRANT',
      }),
      'u-1',
      undefined,
    );
  });

  it('issues the décharge of an incoming effet without a file', async () => {
    await run(
      'discharge_effet',
      { id: EFFET },
      user([Permission.INCOMING_READ]),
    );
    expect(mailService.discharge).toHaveBeenCalledWith(
      EFFET,
      'u-1',
      expect.any(Object),
      undefined,
    );
  });

  it("takes a correspondent's id as `id` (the preview card's argument)", async () => {
    const tool = byName('update_correspondent');
    expect(Object.keys(tool.input)).toContain('id');
    expect(Object.keys(tool.input)).not.toContain('uuid');
    await run(
      'update_correspondent',
      { id: OTHER, city: 'Douala' },
      user([Permission.CORRESPONDENT_UPDATE]),
    );
    expect(correspondentService.update).toHaveBeenCalledWith(
      OTHER,
      expect.objectContaining({ city: 'Douala' }),
      'u-1',
    );
  });
});
