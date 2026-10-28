import { InstructionStatus, Prisma } from '../../generated/prisma/client';

// The executants still owe their livrables: not subscribed yet, at work, or
// correcting.
export const AGENT_OWES: InstructionStatus[] = [
  InstructionStatus.AFFECTEE,
  InstructionStatus.EN_COURS,
  InstructionStatus.A_CORRIGER,
];

// The task isn't done yet.
const TASK_OPEN_EXCLUDED: InstructionStatus[] = [
  InstructionStatus.TERMINEE,
  InstructionStatus.ANNULEE,
];

/** The executants' deadline has passed and their livrables are still due. */
export function agentOverdueWhere(now: Date): Prisma.InstructionWhereInput {
  return { agentDueDate: { lt: now }, status: { in: AGENT_OWES } };
}

/** The task's deadline has passed and it isn't validated yet. */
export function taskOverdueWhere(now: Date): Prisma.InstructionWhereInput {
  return { dueDate: { lt: now }, status: { notIn: TASK_OPEN_EXCLUDED } };
}

export function overdueWhere(now: Date): Prisma.InstructionWhereInput {
  return { OR: [agentOverdueWhere(now), taskOverdueWhere(now)] };
}

/** Adds `overdue: { agent, task }`, computed now, to a task. */
export function withOverdue<
  T extends {
    status: InstructionStatus;
    dueDate: Date | null;
    agentDueDate: Date | null;
  },
>(instruction: T, now = new Date()) {
  return {
    ...instruction,
    overdue: {
      agent:
        !!instruction.agentDueDate &&
        instruction.agentDueDate < now &&
        AGENT_OWES.includes(instruction.status),
      task:
        !!instruction.dueDate &&
        instruction.dueDate < now &&
        !TASK_OPEN_EXCLUDED.includes(instruction.status),
    },
  };
}
