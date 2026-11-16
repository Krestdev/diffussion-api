import {
  ACTIONS_WITHOUT_READ,
  ADMIN_ROLE_CODE,
  ALL_PERMISSIONS,
  CATALOG_VERSION,
  compareVersions,
  DEFAULT_ROLES,
  IMPLIES,
  normalizePermissions,
  Permission,
  PERMISSION_CATALOG,
  roleCodeOf,
  UPGRADES,
} from './permissions';
import {
  PERMISSION_GROUP_LABELS,
  PERMISSION_LABELS,
} from './permission-labels';

const isRead = (code: string) => /\.read(\.all)?$/.test(code);
const known = new Set<string>(ALL_PERMISSIONS);

/** The 1.x codes, every one of them mapped to 2.0.0 (owner rule: no feature lost). */
const OLD_CODES = [
  'DOSSIER_CREATE',
  'DOSSIER_READ',
  'DOSSIER_UPDATE',
  'DOSSIER_CLOSE',
  'DOSSIER_REOPEN',
  'DOSSIER_ARCHIVE',
  'COURRIER_REGISTER_ENTRANT',
  'COURRIER_DISPATCH',
  'COURRIER_DISPATCH_VALIDATE',
  'COURRIER_WRITE_SORTANT',
  'COURRIER_UPDATE_DRAFT',
  'COURRIER_SEND',
  'COURRIER_READ',
  'INSTRUCTION_CREATE',
  'INSTRUCTION_ASSIGN',
  'INSTRUCTION_REASSIGN',
  'INSTRUCTION_UPDATE',
  'INSTRUCTION_ACCEPT',
  'INSTRUCTION_REFUSE',
  'INSTRUCTION_CANCEL',
  'INSTRUCTION_CLOSE',
  'LIVRABLE_DEPOSIT',
  'LIVRABLE_READ',
  'LIVRABLE_NEW_VERSION',
  'LIVRABLE_SUBMIT',
  'LIVRABLE_DOWNLOAD',
  'VALIDATION_VERIFY',
  'VALIDATION_APPROVE',
  'VALIDATION_REJECT',
  'VALIDATION_REQUEST_CORRECTIONS',
  'ADMIN_MANAGE_USERS',
  'ADMIN_MANAGE_COMPANIES',
  'ADMIN_MANAGE_CATEGORIES',
  'ADMIN_MANAGE_REFERENTIALS',
  'ADMIN_MANAGE_ROLES',
  'ADMIN_MANAGE_SETTINGS',
  'ANALYSIS_READ',
  'ANALYSIS_CREATE',
  'ANALYSIS_UPDATE',
  'ANALYSIS_DECIDE',
  'ADMIN_MANAGE_ANALYSIS_CRITERIA',
  'AUDIT_READ',
  'DASHBOARD_GLOBAL_READ',
  'CONTRACT_READ',
  'CONTRACT_CREATE',
  'CONTRACT_UPDATE',
  'CONTRACT_ARCHIVE',
  'CORRESPONDENT_READ',
  'CORRESPONDENT_CREATE',
  'CORRESPONDENT_UPDATE',
  'CORRESPONDENT_ARCHIVE',
  'PROJECT_READ',
  'PROJECT_CREATE',
  'PROJECT_UPDATE',
  'PROJECT_ARCHIVE',
  'COURRIER_UPDATE',
  'COURRIER_ARCHIVE',
  'COURRIER_APPROVE',
  'COURRIER_CLOSE',
  'COURRIER_READ_ALL',
  'ANALYSIS_ARCHIVE',
  'USERS_READ',
  'ROLES_READ',
  'ROLES_CREATE',
  'ROLES_ARCHIVE',
  'SETTINGS_READ',
];

describe('permission catalogue', () => {
  it('has no grouped code, a description and en/fr/it labels for every code and group', () => {
    expect(ALL_PERMISSIONS.filter((code) => code.endsWith('.manage'))).toEqual(
      [],
    );
    expect(ALL_PERMISSIONS.every((code) => /^[a-z.-]+$/.test(code))).toBe(true);
    expect(PERMISSION_CATALOG.every((p) => p.description.length > 5)).toBe(
      true,
    );
    for (const code of ALL_PERMISSIONS) {
      expect({
        code,
        labels: Object.keys(PERMISSION_LABELS[code] ?? {}),
      }).toEqual({ code, labels: ['en', 'fr', 'it'] });
      expect({
        group: code.split('.')[0],
        labels: Object.keys(PERMISSION_GROUP_LABELS[code.split('.')[0]] ?? {}),
      }).toEqual({ group: code.split('.')[0], labels: ['en', 'fr', 'it'] });
    }
  });

  it('gives every action the read it needs (one way: implied codes are reads)', () => {
    for (const code of ALL_PERMISSIONS) {
      if (isRead(code) || ACTIONS_WITHOUT_READ.includes(code)) continue;
      expect({ code, reads: (IMPLIES[code] ?? []).filter(isRead) }).toEqual({
        code,
        reads: expect.arrayContaining([expect.any(String)]) as unknown,
      });
    }
    for (const [code, implied] of Object.entries(IMPLIES)) {
      expect(known.has(code)).toBe(true);
      for (const each of implied) {
        expect({ code, each, read: isRead(each) && known.has(each) }).toEqual({
          code,
          each,
          read: true,
        });
      }
    }
  });

  it('maps every 1.x code to current ones', () => {
    const replaces = UPGRADES.find((u) => u.version === '2.0.0')!.replaces;
    // Withdrawn in 2.1.0 (projects come from the CREAPP core): nothing replaces them.
    const withdrawn = new Set(['PROJECT_CREATE', 'PROJECT_ARCHIVE']);
    for (const code of OLD_CODES) {
      expect({ code, mapped: (replaces[code] ?? []).length > 0 }).toEqual({
        code,
        mapped: !withdrawn.has(code),
      });
      for (const next of replaces[code]) expect(known.has(next)).toBe(true);
    }
    expect(UPGRADES.at(-1)?.version).toBe(CATALOG_VERSION);
    expect(compareVersions('1.0.0', CATALOG_VERSION)).toBe(-1);
    expect(compareVersions('2.10.0', '2.2.0')).toBe(1);
  });

  it('upgrades 1.x codes, splitting and merging them', () => {
    expect(normalizePermissions(['COURRIER_READ'], { from: '1.0.0' })).toEqual([
      Permission.INCOMING_READ,
      Permission.OUTGOING_READ,
    ]);
    expect(
      normalizePermissions(['ADMIN_MANAGE_ROLES'], { from: '1.0.0' }),
    ).toEqual([
      Permission.ROLE_READ,
      Permission.ROLE_CREATE,
      Permission.ROLE_UPDATE,
      Permission.ROLE_ARCHIVE,
    ]);
    expect(
      normalizePermissions(
        ['ADMIN_MANAGE_REFERENTIALS', 'ADMIN_MANAGE_SETTINGS'],
        { from: '1.0.0' },
      ),
    ).toEqual([Permission.SETTINGS_READ, Permission.SETTINGS_UPDATE]);
    expect(
      normalizePermissions(['INSTRUCTION_CLOSE'], { from: '1.0.0' }),
    ).toEqual([Permission.INSTRUCTION_READ, Permission.INSTRUCTION_CLOSE]);
    // 2.1.0 withdraws project.create and project.archive; project.update stays.
    expect(
      normalizePermissions(
        ['project.create', 'project.update', 'project.archive'],
        { from: '2.0.0' },
      ),
    ).toEqual([Permission.PROJECT_READ, Permission.PROJECT_UPDATE]);
    // Current codes are taken as they are; unknown ones are dropped; a read stays alone.
    expect(normalizePermissions(['COURRIER_READ'])).toEqual([]);
    expect(normalizePermissions([Permission.AUDIT_READ])).toEqual([
      Permission.AUDIT_READ,
    ]);
  });

  it('has default roles with known codes, the admin one holding everything', () => {
    const codes = DEFAULT_ROLES.map((r) => roleCodeOf(r.key));
    expect(codes).toEqual([
      ADMIN_ROLE_CODE,
      'RECEPTIONIST',
      'DISPATCHER',
      'ADMIN_DISPATCHER',
    ]);
    for (const role of DEFAULT_ROLES) {
      expect(role.permissions.every((code) => known.has(code))).toBe(true);
      expect(normalizePermissions(role.permissions)).toEqual(role.permissions);
    }
    expect(DEFAULT_ROLES[0].permissions).toEqual(ALL_PERMISSIONS);
  });
});
