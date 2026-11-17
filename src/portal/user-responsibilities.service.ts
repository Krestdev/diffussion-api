import { Injectable } from '@nestjs/common';
import {
  AnalysisSheetStatus,
  ContractStatus,
  CourrierDirection,
  CourrierStatus,
  DossierStatus,
  InstructionStatus,
  ProjectStatus,
  UserInstructionRole,
} from '../generated/prisma/client';
import { AccessService } from '../auth/access/access.service';
import { DatabaseService } from '../database/database.service';
import { PortalService } from './portal.service';
import {
  type ResponsibilityFacts,
  type ResponsibilityItem,
  responsibilityItems,
} from './user-responsibilities';

/** An instruction no longer needs anyone once done or cancelled. */
const INSTRUCTION_DONE = [
  InstructionStatus.TERMINEE,
  InstructionStatus.ANNULEE,
];
/** An effet no longer needs anyone once closed, archived, cancelled, sent or discharged. */
const COURRIER_DONE = [
  CourrierStatus.CLOTURE,
  CourrierStatus.ARCHIVE,
  CourrierStatus.ANNULE,
  CourrierStatus.ENVOYE,
  CourrierStatus.DECHARGE,
];

/**
 * Contract C9: before deleting a person, the core asks each app what they still hold there. The
 * administrator reassigns it first: responsible of dossiers, contracts, the company or Diffusion's
 * own projects (they validate outgoing effets), roles on open instructions, entrant effets they
 * supervise, analysis sheets awaiting their decision, their À traiter, role delegations.
 */
@Injectable()
export class UserResponsibilitiesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly portal: PortalService,
  ) {}

  async of(
    companyId: string,
    userId: string,
  ): Promise<{ items: ResponsibilityItem[] }> {
    const user = await this.database.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true },
    });
    // Unknown here, or of another company than the token's: nothing.
    if (!user || user.companyId !== companyId) return { items: [] };
    return { items: responsibilityItems(await this.facts(companyId, userId)) };
  }

  private async facts(
    companyId: string,
    userId: string,
  ): Promise<ResponsibilityFacts> {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const db = this.database;
    const openInstruction = { status: { notIn: INSTRUCTION_DONE } };
    const onInstructions = (role: UserInstructionRole) =>
      db.userInstructions.count({
        where: { userId, role, instruction: openInstruction },
      });
    const person = { select: { name: true } } as const;
    const [
      dossiers,
      contracts,
      projects,
      company,
      supervisor,
      validator,
      executant,
      incoming,
      analysisSheets,
      delegations,
      pending,
    ] = await Promise.all([
      db.dossier.count({
        where: {
          companyId,
          responsibleId: userId,
          archivedAt: null,
          status: { notIn: [DossierStatus.CLOSED, DossierStatus.ARCHIVED] },
        },
      }),
      db.contract.count({
        where: {
          responsibleId: userId,
          status: ContractStatus.ACTIVE,
          archivedAt: null,
        },
      }),
      // The core's projects are the core's to check (its leader): Diffusion's own only.
      db.project.count({
        where: {
          companyId,
          responsibleId: userId,
          coreSyncedAt: null,
          status: { in: [ProjectStatus.ACTIVE, ProjectStatus.SUSPENDED] },
        },
      }),
      db.company.findUnique({
        where: { id: companyId },
        select: { responsibleId: true },
      }),
      onInstructions(UserInstructionRole.SUPERVISEUR),
      onInstructions(UserInstructionRole.VALIDATEUR),
      onInstructions(UserInstructionRole.EXECUTANT),
      db.courrier.count({
        where: {
          direction: CourrierDirection.ENTRANT,
          status: { notIn: COURRIER_DONE },
          OR: [{ supervisorId: userId }, { ownerId: userId }],
        },
      }),
      db.analysisSheet.count({
        where: {
          validatorId: userId,
          decidedAt: null,
          archivedAt: null,
          status: { not: AnalysisSheetStatus.ARCHIVEE },
        },
      }),
      db.delegation.findMany({
        where: {
          companyId,
          OR: [{ delegantId: userId }, { delegataireId: userId }],
          endDate: { gte: startOfToday },
        },
        select: {
          delegantId: true,
          startDate: true,
          endDate: true,
          delegant: person,
          delegataire: person,
          role: { select: { name: true } },
        },
      }),
      this.pending(companyId, userId),
    ]);
    return {
      dossiers,
      contracts,
      projects,
      companyResponsible: company?.responsibleId === userId,
      instructions: { supervisor, validator, executant },
      incoming,
      analysisSheets,
      pending,
      delegations: delegations.map((d) => {
        const holder = d.delegantId === userId;
        return {
          side: holder ? ('HOLDER' as const) : ('SUBSTITUTE' as const),
          other: (holder ? d.delegataire : d.delegant).name,
          role: d.role.name,
          startsAt: d.startDate,
          endsAt: d.endDate,
        };
      }),
      now,
    };
  }

  /** What waits in their À traiter: the portal's kinds (C6), with their own rights. */
  private async pending(
    companyId: string,
    userId: string,
  ): Promise<ResponsibilityFacts['pending']> {
    const permissions = await this.access.computePermissions(userId, companyId);
    const items = await this.portal.pendingItems(
      { sub: userId, permissions: new Set<string>(permissions) },
      true,
    );
    return items.map((item) => ({ key: item.key, count: item.count }));
  }
}
