// Demo data for the Circuit execution engine — lets you look at a dossier
// list and see one example of every CircuitInstance state instead of having
// to create/advance one by hand. Safe to re-run: it deletes its own demo
// dossiers (identified by the "Démo circuit — " title prefix) before
// recreating them.
//
// This intentionally duplicates the (small) transition logic from
// CircuitInstanceService.start()/decide() with raw Prisma calls rather than
// booting the full Nest app — a seed script shouldn't depend on Redis/BullMQ
// etc. just to write rows. Keep it in sync if that service's logic changes.
//
// Run with: npx ts-node prisma/seed-circuit-demo.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { createWithUniqueReference } from '../src/common/utils/generate-reference';
import { ADMIN_EMAIL } from './seed';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const DOSSIER_TITLE_PREFIX = 'Démo circuit — ';
const DOSSIER_TYPE_NAME = 'Démonstration circuit';
const CIRCUIT_NAME = 'Circuit de démonstration (3 étapes)';
// Matches seed.ts's ADMIN_ROLE_NAME — not exported from there, so kept in
// sync by value rather than importing a private constant.
const ADMIN_ROLE_NAME = 'Administrateur';

async function cleanupPreviousRun() {
  const dossiers = await prisma.dossier.findMany({
    where: { title: { startsWith: DOSSIER_TITLE_PREFIX } },
    select: { id: true },
  });
  const dossierIds = dossiers.map((d) => d.id);
  if (dossierIds.length > 0) {
    await prisma.document.deleteMany({ where: { dossierId: { in: dossierIds } } });
    await prisma.validation.deleteMany({
      where: { circuitInstance: { dossierId: { in: dossierIds } } },
    });
    await prisma.circuitStepInstanceCircuit.deleteMany({
      where: { circuitInstance: { dossierId: { in: dossierIds } } },
    });
    await prisma.circuitInstance.deleteMany({ where: { dossierId: { in: dossierIds } } });
    await prisma.courrier.deleteMany({ where: { dossierId: { in: dossierIds } } });
    await prisma.dossier.deleteMany({ where: { id: { in: dossierIds } } });
  }
  await prisma.circuitStep.deleteMany({ where: { circuit: { name: CIRCUIT_NAME } } });
  await prisma.circuit.deleteMany({ where: { name: CIRCUIT_NAME } });
  console.log('✓ Previous demo run cleaned up');
}

async function createDossierWithCourrier(
  title: string,
  typeId: string,
  siteId: string,
  userId: string,
) {
  const dossier = await createWithUniqueReference('D', (number) =>
    prisma.dossier.create({
      data: { number, title, typeId, siteId, responsibleId: userId, createdById: userId },
    }),
  );
  const courrier = await createWithUniqueReference('M', (number) =>
    prisma.courrier.create({
      data: {
        number,
        dossierId: dossier.id,
        direction: 'SORTANT',
        subject: title,
        createdById: userId,
        status: 'BROUILLON',
      },
    }),
  );
  return { dossier, courrier };
}

// target is a courrier or a document — never a bare dossier (see
// CircuitInstanceService.start()).
async function startInstance(
  circuitId: string,
  dossierId: string,
  target: { courrierId?: string; documentId?: string },
  firstStepId: string,
) {
  const instance = await prisma.circuitInstance.create({
    data: { circuitId, dossierId, ...target, currentStepId: firstStepId },
  });
  await prisma.circuitStepInstanceCircuit.create({
    data: { circuitStepId: firstStepId, circuitInstanceId: instance.id },
  });
  if (target.courrierId) {
    await prisma.courrier.update({
      where: { id: target.courrierId },
      data: { status: 'EN_CIRCUIT' },
    });
  }
  return instance;
}

// courrierId is omitted for a document-attached instance — a Document has
// no status of its own to flip on completion/cancellation.
async function decide(
  instanceId: string,
  courrierId: string | undefined,
  validatorId: string,
  step: { id: string; order: number; parentStepId: string | null },
  nextStep: { id: string } | null,
  decision: 'VALIDE' | 'REJETE' | 'CORRECTIONS_DEMANDEES',
  motif?: string,
) {
  await prisma.validation.create({
    data: { circuitInstanceId: instanceId, validatorId, decision, motif },
  });
  const approved = decision === 'VALIDE';
  if (approved && nextStep) {
    await prisma.circuitInstance.update({
      where: { id: instanceId },
      data: { currentStepId: nextStep.id },
    });
    await prisma.circuitStepInstanceCircuit.create({
      data: { circuitStepId: nextStep.id, circuitInstanceId: instanceId },
    });
  } else if (approved) {
    await prisma.circuitInstance.update({
      where: { id: instanceId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (courrierId) {
      await prisma.courrier.update({ where: { id: courrierId }, data: { status: 'VALIDE' } });
    }
  } else if (step.parentStepId) {
    await prisma.circuitInstance.update({
      where: { id: instanceId },
      data: { currentStepId: step.parentStepId },
    });
    await prisma.circuitStepInstanceCircuit.create({
      data: { circuitStepId: step.parentStepId, circuitInstanceId: instanceId },
    });
  } else {
    await prisma.circuitInstance.update({
      where: { id: instanceId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    if (courrierId) {
      await prisma.courrier.update({ where: { id: courrierId }, data: { status: 'A_CORRIGER' } });
    }
  }
}

async function main() {
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  const adminRole = await prisma.role.findFirstOrThrow({ where: { name: ADMIN_ROLE_NAME } });
  const site = await prisma.site.findFirstOrThrow();

  await cleanupPreviousRun();

  const dossierType = await prisma.dossierType.upsert({
    where: { name: DOSSIER_TYPE_NAME },
    update: {},
    create: { name: DOSSIER_TYPE_NAME },
  });

  const circuit = await prisma.circuit.create({
    data: { name: CIRCUIT_NAME, dossierTypeId: dossierType.id },
  });
  const step1 = await prisma.circuitStep.create({
    data: { circuitId: circuit.id, order: 1, actionType: 'VERIFICATION', maxDelayHours: 48 },
  });
  const step2 = await prisma.circuitStep.create({
    data: {
      circuitId: circuit.id,
      order: 2,
      actionType: 'APPROBATION',
      roleId: adminRole.id,
      parentStepId: step1.id,
      maxDelayHours: 72,
    },
  });
  const step3 = await prisma.circuitStep.create({
    data: {
      circuitId: circuit.id,
      order: 3,
      actionType: 'VALIDATION_FINALE',
      parentStepId: step2.id,
    },
  });
  console.log(`✓ Circuit "${CIRCUIT_NAME}" created with 3 steps (step 2 requires the ${ADMIN_ROLE_NAME} role)`);

  // 1. No circuit started yet.
  await createDossierWithCourrier(
    `${DOSSIER_TITLE_PREFIX}Aucun circuit démarré`,
    dossierType.id,
    site.id,
    adminUser.id,
  );

  // 2. In progress, step 1.
  const d2 = await createDossierWithCourrier(
    `${DOSSIER_TITLE_PREFIX}Étape 1 en cours (vérification)`,
    dossierType.id,
    site.id,
    adminUser.id,
  );
  await startInstance(circuit.id, d2.dossier.id, { courrierId: d2.courrier.id }, step1.id);

  // 3. In progress, step 2 (role-gated) — one approval already recorded.
  const d3 = await createDossierWithCourrier(
    `${DOSSIER_TITLE_PREFIX}Étape 2 en cours (rôle requis)`,
    dossierType.id,
    site.id,
    adminUser.id,
  );
  const inst3 = await startInstance(circuit.id, d3.dossier.id, { courrierId: d3.courrier.id }, step1.id);
  await decide(inst3.id, d3.courrier.id, adminUser.id, step1, step2, 'VALIDE');
  // Attach a document to this dossier so its detail page's circuit panel
  // has something to show too — no real file behind it (storage isn't
  // exercised here, see the RustFS/S3 upload issue tracked separately).
  await prisma.document.create({
    data: {
      dossierId: d3.dossier.id,
      originalName: 'Rapport de vérification.pdf',
      storageKey: `demo/${d3.dossier.id}/rapport-verification.pdf`,
      mimeType: 'application/pdf',
      uploadedById: adminUser.id,
    },
  });

  // 4. Rejected at step 2 with no motif-free path, looped back to step 1,
  // re-approved, now in progress at step 3 — shows the fallback in history.
  const d4 = await createDossierWithCourrier(
    `${DOSSIER_TITLE_PREFIX}Étape 3 en cours (après un rejet)`,
    dossierType.id,
    site.id,
    adminUser.id,
  );
  const inst4 = await startInstance(circuit.id, d4.dossier.id, { courrierId: d4.courrier.id }, step1.id);
  await decide(inst4.id, d4.courrier.id, adminUser.id, step1, step2, 'VALIDE');
  await decide(
    inst4.id,
    d4.courrier.id,
    adminUser.id,
    step2,
    null,
    'CORRECTIONS_DEMANDEES',
    'Signature manquante',
  );
  await decide(inst4.id, d4.courrier.id, adminUser.id, step1, step2, 'VALIDE');
  await decide(inst4.id, d4.courrier.id, adminUser.id, step2, step3, 'VALIDE');

  // 5. Fully completed — courrier VALIDE.
  const d5 = await createDossierWithCourrier(
    `${DOSSIER_TITLE_PREFIX}Terminé (validé)`,
    dossierType.id,
    site.id,
    adminUser.id,
  );
  const inst5 = await startInstance(circuit.id, d5.dossier.id, { courrierId: d5.courrier.id }, step1.id);
  await decide(inst5.id, d5.courrier.id, adminUser.id, step1, step2, 'VALIDE');
  await decide(inst5.id, d5.courrier.id, adminUser.id, step2, step3, 'VALIDE');
  await decide(inst5.id, d5.courrier.id, adminUser.id, step3, null, 'VALIDE');

  // 6. Rejected at step 1 (no fallback) — cancelled, courrier A_CORRIGER.
  const d6 = await createDossierWithCourrier(
    `${DOSSIER_TITLE_PREFIX}Annulé (à corriger)`,
    dossierType.id,
    site.id,
    adminUser.id,
  );
  const inst6 = await startInstance(circuit.id, d6.dossier.id, { courrierId: d6.courrier.id }, step1.id);
  await decide(inst6.id, d6.courrier.id, adminUser.id, step1, null, 'REJETE', 'Hors sujet');

  // 7. Entrant courrier, circuit-eligible once TRANSMIS (BAD 10.6 applies
  // to entrant treatment the same as sortant drafting — see
  // MailService.submitForVerification).
  const d7dossier = await createWithUniqueReference('D', (number) =>
    prisma.dossier.create({
      data: {
        number,
        title: `${DOSSIER_TITLE_PREFIX}Courrier entrant — étape 1 en cours`,
        typeId: dossierType.id,
        siteId: site.id,
        responsibleId: adminUser.id,
        createdById: adminUser.id,
      },
    }),
  );
  const d7courrier = await createWithUniqueReference('M', (number) =>
    prisma.courrier.create({
      data: {
        number,
        dossierId: d7dossier.id,
        direction: 'ENTRANT',
        subject: `${DOSSIER_TITLE_PREFIX}Courrier entrant — étape 1 en cours`,
        createdById: adminUser.id,
        status: 'TRANSMIS',
      },
    }),
  );
  await startInstance(circuit.id, d7dossier.id, { courrierId: d7courrier.id }, step1.id);

  // 8. Circuit attached directly to a document (not a courrier) — the
  // document also has an explicit circuit owner (10.6), who can decide any
  // step regardless of role/site gating. Set to the admin here since it's
  // the only seeded user; to see the bypass actually matter, create a
  // second user without the Administrateur role/site assignment and make
  // them the owner instead.
  const d8dossier = await createWithUniqueReference('D', (number) =>
    prisma.dossier.create({
      data: {
        number,
        title: `${DOSSIER_TITLE_PREFIX}Circuit sur un document (avec propriétaire)`,
        typeId: dossierType.id,
        siteId: site.id,
        responsibleId: adminUser.id,
        createdById: adminUser.id,
      },
    }),
  );
  const d8document = await prisma.document.create({
    data: {
      dossierId: d8dossier.id,
      originalName: 'Plan technique.pdf',
      storageKey: `demo/${d8dossier.id}/plan-technique.pdf`,
      mimeType: 'application/pdf',
      uploadedById: adminUser.id,
      ownerId: adminUser.id,
    },
  });
  await startInstance(circuit.id, d8dossier.id, { documentId: d8document.id }, step1.id);

  console.log('✓ 8 demo dossiers created, one per CircuitInstance state/shape:');
  console.log('  1. Aucun circuit démarré');
  console.log('  2. Étape 1 en cours (vérification)');
  console.log('  3. Étape 2 en cours (rôle requis) — includes a demo document');
  console.log("  4. Étape 3 en cours (après un rejet, montre le retour en arrière dans l'historique)");
  console.log('  5. Terminé (validé)');
  console.log('  6. Annulé (à corriger)');
  console.log('  7. Courrier entrant — étape 1 en cours');
  console.log('  8. Circuit sur un document, avec propriétaire — voir /documents/:id');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
