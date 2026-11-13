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
    // Its dossier's responsible, else its contract's, else its site's;
    // without a dossier: its contract's (else that contract's project's),
    // its project's, else its registrant's site's.
    OR: [
      { dossier: { responsibleId: userId } },
      {
        dossier: {
          responsibleId: null,
          contract: { responsibleId: userId },
        },
      },
      {
        dossier: {
          responsibleId: null,
          OR: [{ contractId: null }, { contract: { responsibleId: null } }],
          site: { responsibleId: userId },
        },
      },
      { dossierId: null, contract: { responsibleId: userId } },
      {
        dossierId: null,
        contract: { responsibleId: null, project: { responsibleId: userId } },
      },
      {
        dossierId: null,
        contractId: null,
        project: { responsibleId: userId },
      },
      {
        dossierId: null,
        contractId: null,
        OR: [{ projectId: null }, { project: { responsibleId: null } }],
        createdBy: { site: { responsibleId: userId } },
      },
    ],
  };
}
