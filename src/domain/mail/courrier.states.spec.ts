import {
  CourrierDirection,
  CourrierStatus,
} from '../../generated/prisma/client';
import {
  COURRIER_DONE,
  COURRIER_ENTRANT_STATES,
  COURRIER_SORTANT_STATES,
  CourrierEvent,
  courrierStates,
} from './courrier.states';

const S = CourrierStatus;
const ALL = Object.values(CourrierStatus);
type Row = [
  CourrierStatus[],
  CourrierEvent,
  CourrierStatus | CourrierStatus[],
  string | undefined,
];

// Today's transitions (status map §1a / §1b / §1c, 2026-11-15): from, event, to, permission.
const ENTRANT: Row[] = [
  [[S.RECU, S.ENREGISTRE, S.AFFECTE], 'TRANSMIT', S.TRANSMIS, undefined],
  [
    [S.RECU, S.ENREGISTRE, S.EN_ATTENTE_TRANSMISSION, S.AFFECTE, S.TRANSMIS],
    'DISPATCH',
    S.TRANSMIS,
    'incoming.read',
  ],
  [
    [S.RECU, S.ENREGISTRE],
    'PROPOSE_DISPATCH',
    S.EN_ATTENTE_TRANSMISSION,
    'incoming.read',
  ],
  [[S.EN_ATTENTE_TRANSMISSION], 'VALIDATE_DISPATCH', S.TRANSMIS, undefined],
  [
    [S.EN_ATTENTE_TRANSMISSION],
    'REJECT_DISPATCH',
    S.RECU,
    'incoming.dispatch.validate',
  ],
  [[S.TRANSMIS], 'START_TREATMENT', S.EN_TRAITEMENT, undefined],
  [
    [S.TRANSMIS, S.EN_TRAITEMENT, S.A_CORRIGER],
    'SUBMIT_FOR_VALIDATION',
    S.EN_ATTENTE_VALIDATION,
    'outgoing.update',
  ],
  [[S.EN_ATTENTE_VALIDATION], 'VALIDATE', S.VALIDE, undefined],
  [[S.EN_ATTENTE_VALIDATION], 'REQUEST_CORRECTIONS', S.A_CORRIGER, undefined],
  [
    [S.RECU, S.ENREGISTRE, S.AFFECTE, S.TRANSMIS, S.EN_TRAITEMENT, S.VALIDE],
    'CLOSE',
    S.CLOTURE,
    'incoming.read',
  ],
  [
    [
      S.RECU,
      S.ENREGISTRE,
      S.AFFECTE,
      S.TRANSMIS,
      S.EN_TRAITEMENT,
      S.EN_ATTENTE_TRANSMISSION,
      S.EN_ATTENTE_VALIDATION,
      S.A_CORRIGER,
    ],
    'CANCEL',
    S.ANNULE,
    undefined,
  ],
  [[S.CLOTURE], 'ARCHIVE', S.ARCHIVE, undefined],
  [[S.ARCHIVE], 'UNARCHIVE', S.CLOTURE, undefined],
  [[S.CLOTURE, S.ANNULE], 'AUTO_ARCHIVE', S.ARCHIVE, undefined],
  [
    ALL.filter((s) => !COURRIER_DONE.includes(s)),
    'CLOSE_BY_PROJECT',
    S.CLOTURE,
    undefined,
  ],
  [ALL, 'REOPEN_BY_PROJECT', S.TRANSMIS, undefined],
  [
    ALL.filter((s) => s !== S.ARCHIVE),
    'ARCHIVE_BY_PROJECT',
    S.ARCHIVE,
    undefined,
  ],
  [[S.ARCHIVE], 'RESTORE_BY_PROJECT', S.EN_TRAITEMENT, undefined],
];

const SORTANT: Row[] = [
  [
    [S.BROUILLON, S.A_CORRIGER],
    'SUBMIT_FOR_VALIDATION',
    S.EN_ATTENTE_VALIDATION,
    'outgoing.update',
  ],
  [[S.EN_ATTENTE_VALIDATION], 'VALIDATE', S.VALIDE, undefined],
  [[S.EN_ATTENTE_VALIDATION], 'REQUEST_CORRECTIONS', S.A_CORRIGER, undefined],
  [[S.VALIDE], 'SIGN', S.SIGNE, 'outgoing.send'],
  [[S.SIGNE, S.PRET_A_ENVOYER], 'SEND', S.ENVOYE, 'outgoing.send'],
  [[S.ENVOYE], 'DISCHARGE', S.DECHARGE, undefined],
  [
    [S.BROUILLON, S.EN_ATTENTE_VALIDATION, S.A_CORRIGER],
    'CANCEL',
    S.ANNULE,
    undefined,
  ],
  [[S.DECHARGE, S.ANNULE], 'ARCHIVE', S.ARCHIVE, undefined],
  [[S.ARCHIVE], 'UNARCHIVE', S.VALIDE, undefined],
  [[S.DECHARGE, S.ANNULE], 'AUTO_ARCHIVE', S.ARCHIVE, undefined],
  [
    ALL.filter((s) => !COURRIER_DONE.includes(s)),
    'CANCEL_BY_PROJECT',
    S.ANNULE,
    undefined,
  ],
  [ALL, 'REOPEN_BY_PROJECT', S.A_CORRIGER, undefined],
  [
    ALL.filter((s) => s !== S.ARCHIVE),
    'ARCHIVE_BY_PROJECT',
    S.ARCHIVE,
    undefined,
  ],
  [[S.ARCHIVE], 'RESTORE_BY_PROJECT', S.DECHARGE, undefined],
];

describe.each([
  ['COURRIER_ENTRANT_STATES', COURRIER_ENTRANT_STATES, ENTRANT],
  ['COURRIER_SORTANT_STATES', COURRIER_SORTANT_STATES, SORTANT],
])('%s', (_name, table, rows) => {
  it.each(rows)(
    'from %j, %s leads to %s (permission %s)',
    (froms, event, to, permission) => {
      for (const from of froms) {
        const rule = table.resolve(from, event);
        expect(rule).toBeDefined();
        expect(table.target(rule!, to as CourrierStatus)).toBe(to);
        expect(rule!.permission).toBe(permission);
      }
      // …and from nowhere else.
      expect([...table.sourcesOf(event)].sort()).toEqual([...froms].sort());
    },
  );

  it('has no other event than the documented ones', () => {
    const documented = new Set(rows.map(([, event]) => event));
    for (const rule of table.all) expect(documented).toContain(rule.event);
  });
});

describe('the two directions', () => {
  it('keeps the steps of one direction off the other', () => {
    const entrantOnly: CourrierEvent[] = [
      'TRANSMIT',
      'DISPATCH',
      'PROPOSE_DISPATCH',
      'VALIDATE_DISPATCH',
      'REJECT_DISPATCH',
      'START_TREATMENT',
      'CLOSE',
      'CLOSE_BY_PROJECT',
    ];
    const sortantOnly: CourrierEvent[] = [
      'SIGN',
      'SEND',
      'DISCHARGE',
      'CANCEL_BY_PROJECT',
    ];
    for (const event of entrantOnly) {
      expect(COURRIER_SORTANT_STATES.sourcesOf(event)).toEqual([]);
    }
    for (const event of sortantOnly) {
      expect(COURRIER_ENTRANT_STATES.sourcesOf(event)).toEqual([]);
    }
  });

  it('refuses a few wrong steps', () => {
    expect(COURRIER_ENTRANT_STATES.allows(S.TRANSMIS, 'TRANSMIT')).toBe(false);
    expect(COURRIER_ENTRANT_STATES.allows(S.ANNULE, 'ARCHIVE')).toBe(false);
    expect(COURRIER_ENTRANT_STATES.allows(S.RECU, 'VALIDATE')).toBe(false);
    expect(
      COURRIER_ENTRANT_STATES.allows(
        S.EN_ATTENTE_TRANSMISSION,
        'PROPOSE_DISPATCH',
      ),
    ).toBe(false);
    expect(COURRIER_SORTANT_STATES.allows(S.VALIDE, 'SEND')).toBe(false);
    expect(COURRIER_SORTANT_STATES.allows(S.ENVOYE, 'ARCHIVE')).toBe(false);
    expect(COURRIER_SORTANT_STATES.allows(S.ENVOYE, 'CANCEL')).toBe(false);
    // Unarchiving never stays archived.
    expect(() =>
      COURRIER_ENTRANT_STATES.target(
        COURRIER_ENTRANT_STATES.resolve(S.ARCHIVE, 'UNARCHIVE')!,
        S.ARCHIVE,
      ),
    ).toThrow(/needs a target/);
  });

  it('picks the table of the direction', () => {
    expect(courrierStates(CourrierDirection.ENTRANT)).toBe(
      COURRIER_ENTRANT_STATES,
    );
    expect(courrierStates(CourrierDirection.SORTANT)).toBe(
      COURRIER_SORTANT_STATES,
    );
  });
});
