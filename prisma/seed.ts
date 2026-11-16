import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  createDefaultRoles,
  giveAdminRole,
  syncPermissionCatalog,
} from '../src/auth/default-roles';
import { ALL_PERMISSIONS } from '../src/auth/permissions';

// People come from the CREAPP core (they sign in there): the seed makes no
// account. A company administrator gets the company's ADMIN role at their
// first directory sync; SEED_ADMIN_EMAIL (optional) names a person already
// synced from the core who also gets every role of their company, every
// restricted dossier and the SUPER_ADMIN profile, for tests.
const DEFAULT_COMPANY_NAME = 'Cristal';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// The permission table mirrors the catalogue (src/auth/permissions.ts).
async function seedPermissions() {
  await prisma.$transaction((tx) => syncPermissionCatalog(tx));
  console.log(`✓ ${ALL_PERMISSIONS.length} permissions ensured`);
}

async function seedCompany() {
  const existing = await prisma.company.findFirst({
    where: { name: DEFAULT_COMPANY_NAME },
  });
  if (existing) return existing;

  const company = await prisma.company.create({
    data: { code: 'CO-001', name: DEFAULT_COMPANY_NAME, city: 'Douala' },
  });
  await prisma.$transaction((tx) => createDefaultRoles(tx, company.id));
  console.log(`✓ Company "${DEFAULT_COMPANY_NAME}" created`);
  return company;
}

// A person already synced from the core, given their company's ADMIN role,
// every other role of their company and the SUPER_ADMIN profile (what every
// company shares) for tests. Null when SEED_ADMIN_EMAIL is unset or that
// person hasn't signed in to Diffusion / been synced yet.
async function seedAdminUser() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.companyId) {
    console.log(`! ${email} is not synced from the core yet: no admin granted`);
    return null;
  }
  const companyId = user.companyId;
  await prisma.$transaction(async (tx) => {
    await createDefaultRoles(tx, companyId);
    await giveAdminRole(tx, companyId, [user.id]);
    await tx.user.update({
      where: { id: user.id },
      data: { accessProfile: 'SUPER_ADMIN' },
    });
  });
  console.log(`✓ ${email} holds ADMIN and the SUPER_ADMIN profile`);
  return user;
}

/// Test-only: RESTRICTED dossiers need a DossierAccess row — holding every
/// permission doesn't cover them. Give the admin every role of their company
/// and every restricted dossier. Re-run the seed after creating new
/// roles/dossiers to catch up.
async function grantAdminFullAccess(userId: string, companyId: string) {
  const [roles, restrictedDossiers] = await Promise.all([
    prisma.role.findMany({
      where: { companyId, archivedAt: null },
      select: { id: true },
    }),
    prisma.dossier.findMany({
      where: { confidentiality: 'RESTRICTED' },
      select: { id: true },
    }),
  ]);

  await prisma.userRole.createMany({
    data: roles.map((role) => ({ userId, roleId: role.id })),
    skipDuplicates: true,
  });
  for (const dossier of restrictedDossiers) {
    await prisma.dossierAccess.upsert({
      where: { dossierId_userId: { dossierId: dossier.id, userId } },
      update: { canView: true, canEdit: true },
      create: { dossierId: dossier.id, userId, canView: true, canEdit: true },
    });
  }

  console.log(
    `✓ Admin granted ${roles.length} roles, ${restrictedDossiers.length} restricted dossiers`,
  );
}

// The starting list of global effet types (see the effet_types migration).
// Looked up rather than upserted: a nullable column can't be part of a
// Prisma unique-key lookup.
const referenceModel = (prefix: string) => ({
  prefix,
  separator: '-',
  counterDigits: 6,
  counterReset: 'YEARLY',
  yearDigits: 4,
  monthIncluded: false,
  codes: [],
});

const EFFET_TYPES = [
  {
    name: 'Courrier',
    isPhysical: false,
    canListEffets: false,
    referenceModel: referenceModel('LET'),
  },
  {
    name: 'Bordereau de transmission',
    isPhysical: false,
    canListEffets: true,
    referenceModel: referenceModel('BT'),
  },
  {
    name: 'Matière / spécimen',
    isPhysical: true,
    canListEffets: false,
    referenceModel: referenceModel('MAT'),
  },
  {
    name: 'Document',
    isPhysical: false,
    canListEffets: false,
    referenceModel: referenceModel('DOC'),
  },
  {
    name: 'Support numérique',
    isPhysical: true,
    canListEffets: false,
    referenceModel: referenceModel('SUP'),
  },
  {
    name: 'Dossier complet',
    isPhysical: true,
    canListEffets: false,
    referenceModel: referenceModel('DOS'),
  },
];

async function seedEffetTypes() {
  for (const type of EFFET_TYPES) {
    const existing = await prisma.effetType.findFirst({
      where: { name: type.name, companyId: null },
      select: { id: true },
    });
    if (!existing) await prisma.effetType.create({ data: type });
  }
  console.log(`✓ ${EFFET_TYPES.length} effet types ensured`);
}

// Canaux belong to a company: the default ones go to the default company.
async function seedReferentials(companyId: string) {
  const correspondentTypes = [
    'Administration publique',
    'Entreprise',
    'Prestataire',
    'Partenaire technique',
    'Personne physique',
  ];
  const canaux = [
    'Courrier électronique',
    'Courrier postal',
    'Remise en main propre',
  ];
  const natures = [
    'Demande d’information',
    'Rapport',
    'Réponse administrative',
  ];

  await Promise.all(
    correspondentTypes.map((name) =>
      prisma.correspondentType.upsert({
        where: { companyId_name: { companyId, name } },
        update: {},
        create: { name, companyId },
      }),
    ),
  );
  await Promise.all(
    canaux.map((name) =>
      prisma.canal.upsert({
        where: { companyId_name: { companyId, name } },
        update: {},
        create: { name, companyId },
      }),
    ),
  );
  await Promise.all(
    natures.map((name) =>
      prisma.courrierNature.upsert({
        where: { name },
        update: {},
        create: { name },
      }),
    ),
  );
  await prisma.category.upsert({
    where: { id: '00000000-0000-0000-0000-000000000000' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000000',
      label: 'Correspondance administrative',
      retentionMonths: 60,
    },
  });

  console.log(
    '✓ Referentials seeded (dossier types, correspondent types, canaux, natures, a default category)',
  );
}

/// Default "document de critères d'analyse" (module spec §5): the grid
/// proposed on every element of a fiche d'analyse. Admins can add to it.
const DEFAULT_ANALYSIS_CRITERIA = [
  'Forme',
  'Fonctionnalité',
  'Constitution',
  'Conformité aux cahiers des charges',
  'Exploitabilité',
  'Autres conformités',
];

async function seedAnalysisCriteria() {
  await Promise.all(
    DEFAULT_ANALYSIS_CRITERIA.map((label, index) =>
      // Common criteria (no company): a nullable key can't be upserted on.
      prisma.analysisCriterionTemplate
        .findFirst({ where: { label, companyId: null }, select: { id: true } })
        .then((found) =>
          found
            ? prisma.analysisCriterionTemplate.update({
                where: { id: found.id },
                data: { order: index + 1 },
              })
            : prisma.analysisCriterionTemplate.create({
                data: { label, order: index + 1 },
              }),
        ),
    ),
  );
  console.log(
    `✓ ${DEFAULT_ANALYSIS_CRITERIA.length} analysis criteria ensured`,
  );
}

async function main() {
  await seedPermissions();
  const company = await seedCompany();
  const admin = await seedAdminUser();
  await seedReferentials(company.id);
  await seedEffetTypes();
  await seedAnalysisCriteria();
  if (admin?.companyId) await grantAdminFullAccess(admin.id, admin.companyId);

  console.log('\nSeed complete. Sign in through the CREAPP core.');
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
