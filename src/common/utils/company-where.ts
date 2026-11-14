import { Prisma } from '../../../generated/prisma/client';

type CompanyFilter = string | { in: string[] };

// Prisma filters for "belongs to this company", following the rule of
// AccessService.resolveCompanyId. Each one is an OR: put it inside an AND.

/** An effet's company: its dossier's, else its registrant's. */
export function courrierOfCompany(
  companyId: CompanyFilter,
): Prisma.CourrierWhereInput {
  return {
    OR: [
      { dossier: { companyId } },
      { dossierId: null, createdBy: { companyId } },
    ],
  };
}

/** A task's company: its dossier's, else its effet's, else its contract's project's. */
export function taskOfCompany(
  companyId: CompanyFilter,
): Prisma.InstructionWhereInput {
  return {
    OR: [
      { dossier: { companyId } },
      { dossierId: null, courrier: courrierOfCompany(companyId) },
      {
        dossierId: null,
        courrierId: null,
        contract: { project: { companyId } },
      },
    ],
  };
}
