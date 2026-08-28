import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CircuitInstanceStatus,
  CourrierStatus,
  NotificationCanal,
  Prisma,
  ValidationDecision,
} from '../../../generated/prisma/client';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CreateCircuitInstanceDto } from './dto/create-circuit-instance.dto';
import { DecideCircuitInstanceDto } from './dto/decide-circuit-instance.dto';
import { FindCircuitInstancesQueryDto } from './dto/find-circuit-instances.query.dto';

const instanceInclude = {
  circuit: {
    include: {
      dossierType: true,
      role: true,
      // Full ordered step list — the frontend renders every step as a
      // stepper and highlights currentStepId, not just the current one.
      steps: { orderBy: { order: 'asc' }, include: { role: true } },
    },
  },
  currentStep: { include: { role: true } },
  // Selected here (not just via courrier.dossier) so consumers like the
  // Approbation inbox can render a dossier/priority column uniformly across
  // courrier- and document-attached instances, without special-casing which
  // target type is present.
  dossier: { select: { id: true, number: true, title: true, priority: true } },
  courrier: {
    select: {
      id: true,
      number: true,
      subject: true,
      direction: true,
      createdAt: true,
      ownerId: true,
      dossier: {
        select: { id: true, number: true, title: true, priority: true },
      },
    },
  },
  document: {
    select: {
      id: true,
      originalName: true,
      ownerId: true,
      dossierId: true,
      courrierId: true,
      createdAt: true,
    },
  },
  stepHistory: {
    include: { circuitStep: { include: { role: true } } },
    orderBy: { enteredAt: 'asc' },
  },
  validations: {
    include: { validator: { select: { id: true, name: true } } },
    orderBy: { decidedAt: 'asc' },
  },
} satisfies Prisma.CircuitInstanceInclude;

// Fetched once per start()/decide() call to answer "who owns this target,
// and which site is it scoped to" — never sent to the frontend as-is (see
// instanceInclude above for that), just used to decide who may act.
const targetContextInclude = {
  courrier: {
    select: {
      ownerId: true,
      createdById: true,
      subject: true,
      dossier: { select: { siteId: true } },
    },
  },
  document: {
    select: {
      ownerId: true,
      uploadedById: true,
      originalName: true,
      dossier: { select: { siteId: true } },
      courrier: { select: { dossier: { select: { siteId: true } } } },
    },
  },
} satisfies Prisma.CircuitInstanceInclude;

type TargetContext = Prisma.CircuitInstanceGetPayload<{
  include: typeof targetContextInclude;
}>;

function resolveOwnerAndSite(instance: TargetContext) {
  const siteId =
    instance.courrier?.dossier.siteId ??
    instance.document?.dossier?.siteId ??
    instance.document?.courrier?.dossier.siteId ??
    null;
  const ownerId = instance.courrier?.ownerId ?? instance.document?.ownerId ?? null;
  // Who submitted the target in the first place (RG-NOT-*: they're the one
  // who needs to hear "validated"/"corrections requested" outcomes).
  const submitterId =
    instance.courrier?.createdById ?? instance.document?.uploadedById ?? null;
  return { siteId, ownerId, submitterId };
}

@Injectable()
export class CircuitInstanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  // Same site-scoping rule as userIsEligibleForRole, but the other
  // direction: everyone who could act on a step, not just one candidate.
  // Returns [] (rather than "everyone with the role") when siteId is
  // unknown, mirroring userIsEligibleForRole's own refusal in that case.
  private async findEligibleUserIds(roleId: string | null, siteId: string | null) {
    if (!roleId || !siteId) return [];
    const users = await this.database.user.findMany({
      where: {
        userRoles: { some: { roleId } },
        assignments: { some: { siteId } },
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  // Who should hear "this step now needs a decision": everyone eligible to
  // decide it, plus the owner (10.6) who can act regardless of role — minus
  // whoever just triggered this transition, so nobody gets notified about
  // their own action.
  private async stepPendingRecipients(
    roleId: string | null,
    siteId: string | null,
    ownerId: string | null,
    excludeUserId: string,
  ) {
    const roleUserIds = await this.findEligibleUserIds(roleId, siteId);
    const ids = new Set(roleUserIds);
    if (ownerId) ids.add(ownerId);
    ids.delete(excludeUserId);
    return [...ids];
  }

  private notify(params: {
    recipientIds: (string | null)[];
    type: string;
    message: string;
    dossierId?: string | null;
    courrierId?: string | null;
  }) {
    const recipientIds = [
      ...new Set(params.recipientIds.filter((id): id is string => Boolean(id))),
    ];
    if (recipientIds.length === 0) return;
    // Fire-and-forget: a notification failing to write must never roll back
    // or fail the circuit transition that triggered it.
    this.notifications
      .create({
        recipientIds,
        type: params.type,
        message: params.message,
        canal: NotificationCanal.IN_APP,
        dossierId: params.dossierId ?? undefined,
        courrierId: params.courrierId ?? undefined,
      })
      .catch((error: unknown) => {
        console.error('Failed to create circuit notification', error);
      });
  }

  // A role requirement (Circuit.roleId to trigger, CircuitStep.roleId to
  // decide) is only satisfied "on that courrier/document": holding the role
  // application-wide isn't enough on its own, the user must also be
  // assigned to the site that owns the target's dossier. Otherwise any
  // holder of e.g. "Approbateur" anywhere could act on a courrier from a
  // site they have no connection to.
  private async userIsEligibleForRole(
    userId: string,
    roleId: string,
    siteId: string | null,
  ) {
    if (!siteId) return false;
    const [hasRole, isAssignedToSite] = await Promise.all([
      this.database.userRole.findFirst({ where: { userId, roleId } }),
      this.database.assignment.findFirst({ where: { userId, siteId } }),
    ]);
    return hasRole !== null && isAssignedToSite !== null;
  }

  /**
   * Who can be picked as the circuit owner (10.6) for a courrier/document
   * about to be created against this dossier: holders of the role its
   * resolved Circuit requires, restricted to the dossier's own site — the
   * same eligibility rule `userIsEligibleForRole` enforces on decisions.
   * Returns an empty user list (not an error) when the dossier's type has
   * no circuit configured yet, or that circuit has no role requirement —
   * ownership can still be completed later by the creator, the site's
   * responsible, or a platform admin.
   */
  async getEligibleOwners(dossierId: string) {
    const dossier = await this.database.dossier.findUnique({
      where: { id: dossierId },
    });
    if (!dossier) {
      throw new NotFoundException(`Dossier ${dossierId} not found`);
    }
    const circuit = dossier.typeId
      ? await this.database.circuit.findFirst({
          where: { dossierTypeId: dossier.typeId },
          orderBy: { createdAt: 'asc' },
        })
      : null;
    if (!circuit?.roleId) {
      return { circuit: circuit && { id: circuit.id, name: circuit.name }, users: [] };
    }
    const users = await this.database.user.findMany({
      where: {
        userRoles: { some: { roleId: circuit.roleId } },
        assignments: { some: { siteId: dossier.siteId } },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
    return { circuit: { id: circuit.id, name: circuit.name }, users };
  }

  async findAll(query: FindCircuitInstancesQueryDto) {
    return this.database.circuitInstance.findMany({
      where: {
        dossierId: query.dossierId,
        courrierId: query.courrierId,
        documentId: query.documentId,
        status: query.status,
      },
      include: instanceInclude,
      orderBy: { id: 'desc' },
    });
  }

  async findOne(id: string) {
    const instance = await this.database.circuitInstance.findUnique({
      where: { id },
      include: instanceInclude,
    });
    if (!instance) {
      throw new NotFoundException(`Circuit instance ${id} not found`);
    }
    return instance;
  }

  /**
   * Starts a circuit against a courrier or a document — never against a
   * bare dossier (RG-VAL-*: circuits track the review of one piece of
   * correspondence or one file, not the whole dossier). dossierId is
   * resolved for internal bookkeeping only (see instanceInclude.dossier /
   * findAll's dossierId filter), never accepted as an input on its own.
   */
  async start(dto: CreateCircuitInstanceDto, userId: string) {
    if (!dto.courrierId && !dto.documentId) {
      throw new BadRequestException(
        'Either courrierId or documentId is required — a circuit cannot be started on a bare dossier',
      );
    }

    const courrier = dto.courrierId
      ? await this.database.courrier.findUnique({
          where: { id: dto.courrierId },
        })
      : null;
    if (dto.courrierId && !courrier) {
      throw new NotFoundException(`Courrier ${dto.courrierId} not found`);
    }

    const document = dto.documentId
      ? await this.database.document.findUnique({
          where: { id: dto.documentId },
          include: { courrier: true },
        })
      : null;
    if (dto.documentId && !document) {
      throw new NotFoundException(`Document ${dto.documentId} not found`);
    }

    const dossierId =
      courrier?.dossierId ?? document?.dossierId ?? document?.courrier?.dossierId;
    if (!dossierId) {
      throw new BadRequestException(
        document
          ? 'This document is not attached (directly, or via its courrier) to a dossier — a circuit cannot resolve a dossier type or site from it'
          : 'Unable to resolve a dossier for this target',
      );
    }
    const dossier = await this.database.dossier.findUnique({
      where: { id: dossierId },
    });
    if (!dossier) {
      throw new NotFoundException(`Dossier ${dossierId} not found`);
    }

    const circuit = dto.circuitId
      ? await this.database.circuit.findUnique({
          where: { id: dto.circuitId },
          include: { steps: { orderBy: { order: 'asc' } } },
        })
      : await this.resolveCircuitForDossierType(dossier.typeId, dossier.title);
    if (dto.circuitId && !circuit) {
      throw new NotFoundException(`Circuit ${dto.circuitId} not found`);
    }
    if (!circuit) {
      // resolveCircuitForDossierType always throws instead of returning
      // null — this branch is unreachable but keeps TS satisfied.
      throw new BadRequestException('Unable to resolve a circuit');
    }

    const ownerId = courrier?.ownerId ?? document?.ownerId ?? null;
    const isOwner = ownerId === userId;
    if (
      circuit.roleId &&
      !isOwner &&
      !(await this.userIsEligibleForRole(userId, circuit.roleId, dossier.siteId))
    ) {
      throw new ForbiddenException(
        'You do not hold the role required to trigger this circuit for this site',
      );
    }

    const firstStep = circuit.steps[0];
    if (!firstStep) {
      throw new BadRequestException(
        `Circuit "${circuit.name}" has no steps configured`,
      );
    }

    // Sequentially dependent writes (the step-history row needs the
    // instance's freshly-generated id) — needs the interactive transaction
    // form rather than this codebase's usual array-of-independent-ops one.
    const created = await this.database.$transaction(async (tx) => {
      const instance = await tx.circuitInstance.create({
        data: {
          circuitId: circuit.id,
          dossierId: dossier.id,
          courrierId: courrier?.id,
          documentId: document?.id,
          currentStepId: firstStep.id,
        },
      });
      await tx.circuitStepInstanceCircuit.create({
        data: { circuitStepId: firstStep.id, circuitInstanceId: instance.id },
      });
      if (courrier) {
        await tx.courrier.update({
          where: { id: courrier.id },
          data: { status: CourrierStatus.EN_CIRCUIT },
        });
      }
      return tx.circuitInstance.findUniqueOrThrow({
        where: { id: instance.id },
        include: instanceInclude,
      });
    });

    const targetLabel = courrier?.subject ?? document?.originalName ?? circuit.name;
    this.notify({
      recipientIds: await this.stepPendingRecipients(
        firstStep.roleId,
        dossier.siteId,
        ownerId,
        userId,
      ),
      type: 'CIRCUIT_STEP_PENDING',
      message: `« ${targetLabel} » attend votre décision (circuit "${circuit.name}", étape ${firstStep.order}).`,
      dossierId: dossier.id,
      courrierId: courrier?.id,
    });

    return created;
  }

  private async resolveCircuitForDossierType(
    dossierTypeId: string | null,
    dossierTitle: string,
  ) {
    if (!dossierTypeId) {
      throw new BadRequestException(
        `Dossier "${dossierTitle}" has no type set — a circuit can only be resolved automatically from a dossier type. Set the dossier's type, or pass an explicit circuitId.`,
      );
    }
    const candidates = await this.database.circuit.findMany({
      where: { dossierTypeId },
      include: { steps: { orderBy: { order: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
    if (candidates.length === 0) {
      throw new BadRequestException(
        'No validation circuit is configured for this dossier type. Configure one in Paramètres > Circuits de validation.',
      );
    }
    return candidates[0];
  }

  /**
   * Records a decision on the instance's current step and advances it:
   * VALIDE moves to the next step in order (or completes the instance if
   * this was the last one); a rejection falls back to the step's
   * `parentStepId` ("si rejet, retour à l'étape") or, if there is none,
   * cancels the instance outright.
   */
  async decide(id: string, dto: DecideCircuitInstanceDto, userId: string) {
    const instance = await this.database.circuitInstance.findUnique({
      where: { id },
      include: {
        circuit: { include: { steps: { orderBy: { order: 'asc' } } } },
        currentStep: true,
        ...targetContextInclude,
      },
    });
    if (!instance) {
      throw new NotFoundException(`Circuit instance ${id} not found`);
    }
    if (instance.status !== CircuitInstanceStatus.IN_PROGRESS) {
      throw new BadRequestException(
        `Circuit instance is ${instance.status}, no further decisions can be recorded`,
      );
    }

    const currentStep = instance.currentStep;
    const { siteId, ownerId, submitterId } = resolveOwnerAndSite(instance);
    const isOwner = ownerId === userId;
    if (
      currentStep.roleId &&
      !isOwner &&
      !(await this.userIsEligibleForRole(userId, currentStep.roleId, siteId))
    ) {
      throw new ForbiddenException(
        'You do not hold the role required to act on this step for this site',
      );
    }

    const steps = instance.circuit.steps;
    const approved = dto.decision === ValidationDecision.VALIDE;
    const nextStep = approved
      ? steps.find((step) => step.order > currentStep.order)
      : undefined;
    const parentStep = !approved
      ? steps.find((step) => step.id === currentStep.parentStepId)
      : undefined;

    const updated = await this.database.$transaction(async (tx) => {
      await tx.validation.create({
        data: {
          circuitInstanceId: instance.id,
          validatorId: userId,
          decision: dto.decision,
          motif: dto.motif,
        },
      });

      if (approved) {
        if (nextStep) {
          await tx.circuitInstance.update({
            where: { id: instance.id },
            data: { currentStepId: nextStep.id },
          });
          await tx.circuitStepInstanceCircuit.create({
            data: {
              circuitStepId: nextStep.id,
              circuitInstanceId: instance.id,
            },
          });
        } else {
          await tx.circuitInstance.update({
            where: { id: instance.id },
            data: {
              status: CircuitInstanceStatus.COMPLETED,
              completedAt: new Date(),
            },
          });
          if (instance.courrierId) {
            await tx.courrier.update({
              where: { id: instance.courrierId },
              data: { status: CourrierStatus.VALIDE },
            });
          }
        }
      } else if (currentStep.parentStepId) {
        await tx.circuitInstance.update({
          where: { id: instance.id },
          data: { currentStepId: currentStep.parentStepId },
        });
        await tx.circuitStepInstanceCircuit.create({
          data: {
            circuitStepId: currentStep.parentStepId,
            circuitInstanceId: instance.id,
          },
        });
      } else {
        await tx.circuitInstance.update({
          where: { id: instance.id },
          data: {
            status: CircuitInstanceStatus.CANCELLED,
            completedAt: new Date(),
          },
        });
        if (instance.courrierId) {
          await tx.courrier.update({
            where: { id: instance.courrierId },
            data: { status: CourrierStatus.A_CORRIGER },
          });
        }
      }

      return tx.circuitInstance.findUniqueOrThrow({
        where: { id: instance.id },
        include: instanceInclude,
      });
    });

    // Built from the pre-transaction `instance` fetch, not the post-decision
    // `updated` refetch — everything needed (labels, ids, circuit name) is
    // already resolved above and doesn't depend on the write having landed.
    const circuitName = instance.circuit.name;
    const targetLabel =
      instance.courrier?.subject ?? instance.document?.originalName ?? circuitName;
    const notifyBase = {
      dossierId: instance.dossierId,
      courrierId: instance.courrierId,
    };
    if (approved && nextStep) {
      this.notify({
        ...notifyBase,
        recipientIds: await this.stepPendingRecipients(
          nextStep.roleId,
          siteId,
          ownerId,
          userId,
        ),
        type: 'CIRCUIT_STEP_PENDING',
        message: `« ${targetLabel} » attend votre décision (circuit "${circuitName}", étape ${nextStep.order}).`,
      });
    } else if (approved) {
      this.notify({
        ...notifyBase,
        recipientIds: [submitterId, ownerId].filter((id) => id !== userId),
        type: 'CIRCUIT_COMPLETED',
        message: `« ${targetLabel} » a été validé au terme du circuit "${circuitName}".`,
      });
    } else if (parentStep) {
      this.notify({
        ...notifyBase,
        recipientIds: await this.stepPendingRecipients(
          parentStep.roleId,
          siteId,
          ownerId,
          userId,
        ),
        type: 'CIRCUIT_STEP_REJECTED',
        message: `« ${targetLabel} » a été rejeté à l'étape ${currentStep.order} et revient à l'étape ${parentStep.order} du circuit "${circuitName}".`,
      });
    } else {
      this.notify({
        ...notifyBase,
        recipientIds: [submitterId, ownerId].filter((id) => id !== userId),
        type: 'CIRCUIT_CANCELLED',
        message: `« ${targetLabel} » a été rejeté et nécessite des corrections (circuit "${circuitName}").`,
      });
    }

    return updated;
  }
}
