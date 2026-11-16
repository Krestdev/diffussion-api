import { InstructionStatus as S } from '../../generated/prisma/client';
import { Permission } from '../auth/permissions';
import { InstructionEvent, INSTRUCTION_STATES } from './instruction.states';

// Today's transitions (status map §2), from -> event -> to, and the permission the route needs.
const DOCUMENTED: [S, InstructionEvent, S, string?][] = [
  [S.A_AFFECTER, 'ASSIGN', S.AFFECTEE],
  [S.EN_COURS, 'ASSIGN', S.AFFECTEE],
  [S.NON_SOUSCRITE, 'ASSIGN', S.AFFECTEE],
  [S.AFFECTEE, 'ASSIGN', S.A_AFFECTER],
  [S.AFFECTEE, 'SUBSCRIBE', S.EN_COURS],
  [S.AFFECTEE, 'DECLINE', S.NON_SOUSCRITE],
  [S.EN_COURS, 'DEPOSIT', S.EN_ATTENTE_VALIDATION],
  [S.A_CORRIGER, 'DEPOSIT', S.EN_ATTENTE_VALIDATION],
  [S.EN_ATTENTE_VALIDATION, 'DEPOSIT', S.EN_ATTENTE_VALIDATION],
  [S.EN_ATTENTE_VALIDATION, 'APPROVE_LIVRABLES', S.TERMINEE],
  [S.EN_ATTENTE_VALIDATION, 'APPROVE_LIVRABLES', S.A_CORRIGER],
  [S.A_CORRIGER, 'APPROVE_LIVRABLES', S.TERMINEE],
  [S.EN_ATTENTE_VALIDATION, 'REJECT_LIVRABLE', S.A_CORRIGER],
  [S.EN_ATTENTE_VALIDATION, 'REQUEST_CORRECTIONS', S.A_CORRIGER],
  [S.EN_COURS, 'SUBMIT_ANALYSIS', S.EN_ATTENTE_VALIDATION],
  [S.EN_ATTENTE_VALIDATION, 'DECIDE_ANALYSIS', S.TERMINEE],
  [S.EN_ATTENTE_VALIDATION, 'DECIDE_ANALYSIS', S.A_CORRIGER],
  [S.EN_COURS, 'CLOSE', S.TERMINEE, Permission.INSTRUCTION_CLOSE],
  [S.A_CORRIGER, 'CLOSE', S.TERMINEE, Permission.INSTRUCTION_CLOSE],
  [S.EN_ATTENTE_VALIDATION, 'CLOSE', S.TERMINEE, Permission.INSTRUCTION_CLOSE],
  [S.A_AFFECTER, 'CANCEL', S.ANNULEE, Permission.INSTRUCTION_CANCEL],
  [S.EN_COURS, 'CANCEL', S.ANNULEE, Permission.INSTRUCTION_CANCEL],
  [S.AFFECTEE, 'CANCEL_BY_COURRIER', S.ANNULEE],
  [S.A_CORRIGER, 'CANCEL_BY_PROJECT', S.ANNULEE],
  [S.ANNULEE, 'REOPEN_BY_PROJECT', S.EN_COURS],
];

// Refused today (400, now 409 INVALID_TRANSITION).
const REFUSED: [S, InstructionEvent][] = [
  [S.TERMINEE, 'ASSIGN'],
  [S.ANNULEE, 'CANCEL'],
  [S.TERMINEE, 'CANCEL'],
  [S.EN_COURS, 'SUBSCRIBE'],
  [S.EN_COURS, 'DECLINE'],
  [S.AFFECTEE, 'DEPOSIT'],
  [S.AFFECTEE, 'CLOSE'],
  [S.EN_COURS, 'APPROVE_LIVRABLES'],
  [S.EN_COURS, 'REQUEST_CORRECTIONS'],
  [S.TERMINEE, 'CANCEL_BY_COURRIER'],
  [S.ANNULEE, 'CANCEL_BY_PROJECT'],
];

describe('INSTRUCTION_STATES', () => {
  // Every row with its permission (null: none), so jest passes four arguments.
  const rows = DOCUMENTED.map(
    ([from, event, to, permission]) =>
      [from, event, to, permission ?? null] as const,
  );

  it.each(rows)('%s -> %s -> %s', (from, event, to, permission) => {
    const rule = INSTRUCTION_STATES.resolve(from, event);
    expect(rule).toBeDefined();
    expect(INSTRUCTION_STATES.target(rule!, to)).toBe(to);
    expect(rule!.permission ?? null).toBe(permission);
  });

  it.each(REFUSED)('refuses %s -> %s', (from, event) => {
    expect(INSTRUCTION_STATES.allows(from, event)).toBe(false);
  });

  it('names Instruction.status in the history', () => {
    expect([INSTRUCTION_STATES.entity, INSTRUCTION_STATES.field]).toEqual([
      'Instruction',
      'status',
    ]);
  });
});
