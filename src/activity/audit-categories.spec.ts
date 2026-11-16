import { categoryOf, tabOf, tabWhere } from './audit-categories';
import { maskIp } from './mask-ip';

describe('audit categories and tabs', () => {
  it('puts every entry in one tab', () => {
    expect(tabOf({ action: 'COURRIER_VALIDE', entityType: 'Courrier' })).toBe(
      'DECISION',
    );
    expect(
      tabOf({ action: 'COURRIER_DISPATCH_REJETE', entityType: 'Courrier' }),
    ).toBe('DECISION');
    expect(tabOf({ action: 'role.updated', entityType: 'role' })).toBe(
      'ACCESS',
    );
    expect(tabOf({ action: 'dossier.closed', entityType: 'dossier' })).toBe(
      'DOCUMENT',
    );
    expect(tabOf({ action: 'canal.created', entityType: 'canal' })).toBe(
      'SETTINGS',
    );
    // Without an object nor a known action: « Paramètres ».
    expect(tabOf({ action: 'audit.exported', entityType: null })).toBe(
      'SETTINGS',
    );
  });

  it('keeps the first category of an entry', () => {
    expect(
      categoryOf({ action: 'dossier.access-updated', entityType: 'dossier' }),
    ).toBe('permissions');
    expect(categoryOf({ action: 'x', entityType: 'livrable' })).toBe(
      'instruction',
    );
    expect(categoryOf({ action: 'x', entityType: 'unknown' })).toBeNull();
  });

  it('never leaves out entries without an object when excluding categories', () => {
    // NOT(entityType ILIKE …) is NULL in SQL for an empty entityType: the
    // « Paramètres » filter keeps them explicitly.
    expect(JSON.stringify(tabWhere('SETTINGS'))).toContain(
      '{"entityType":null}',
    );
  });
});

describe('maskIp', () => {
  it('hides the third part of an IPv4 address', () => {
    expect(maskIp('41.202.18.18')).toBe('41.202.•••.18');
    expect(maskIp('::ffff:10.0.0.7')).toBe('10.0.•••.7');
  });

  it('keeps the first two groups of an IPv6 address', () => {
    expect(maskIp('2001:db8:85a3::8a2e:370:7334')).toBe('2001:db8:•••');
  });

  it('leaves an unknown address alone', () => {
    expect(maskIp(null)).toBeNull();
  });
});
