import { CourrierStatus, Prisma } from '../../../generated/prisma/client';

// Who validates a courrier submitted for validation: its dossier's
// responsible; failing that, the responsible of the dossier's site; and for
// a courrier with no dossier yet (a sortant draft), the responsible of its
// creator's site. MailService.validatorOf resolves the same rule for one
// courrier — keep both in step.

/** Courriers waiting on `userId`'s decision. */
export function awaitingValidationBy(
  userId: string,
): Prisma.CourrierWhereInput {
  return {
    status: CourrierStatus.EN_ATTENTE_VALIDATION,
    OR: [
      { dossier: { responsibleId: userId } },
      { dossier: { responsibleId: null, site: { responsibleId: userId } } },
      { dossierId: null, createdBy: { site: { responsibleId: userId } } },
    ],
  };
}
