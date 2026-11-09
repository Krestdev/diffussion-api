import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import {
  PERMISSION_LABELS,
  PermissionCode,
} from '../src/auth/rbac/rbac.constants';

const SALT_ROUNDS = 10;

export const ADMIN_EMAIL = 'admin@creaconsult.com';
export const ADMIN_PASSWORD = 'Admin@2026!';
const ADMIN_ROLE_NAME = 'Administrateur';
const DEFAULT_SITE_NAME = 'Cristal';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function seedPermissions() {
  const codes = Object.values(PermissionCode);
  await Promise.all(
    codes.map((code) =>
      prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, description: PERMISSION_LABELS[code] },
      }),
    ),
  );
  // Label permissions created before labels existed; a reworded label is
  // left alone.
  await Promise.all(
    codes.map((code) =>
      prisma.permission.updateMany({
        where: { code, description: null },
        data: { description: PERMISSION_LABELS[code] },
      }),
    ),
  );
  console.log(`✓ ${codes.length} permissions ensured`);
  return codes;
}

async function seedAdminRole(allPermissionCodes: string[]) {
  const permissions = await prisma.permission.findMany({
    where: { code: { in: allPermissionCodes } },
  });

  // A global role (no site). Looked up rather than upserted: a nullable
  // column can't be part of a Prisma unique-key lookup.
  const role =
    (await prisma.role.findFirst({
      where: { name: ADMIN_ROLE_NAME, siteId: null },
    })) ??
    (await prisma.role.create({
      data: {
        code: 'RO-ADMIN',
        name: ADMIN_ROLE_NAME,
        description: 'Accès complet — tous les droits, pour les tests',
      },
    }));

  // Replace-set: make sure the admin role always ends up with every
  // permission that currently exists, even if it was created earlier with
  // a smaller set.
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id,
    })),
  });

  console.log(
    `✓ Role "${ADMIN_ROLE_NAME}" ensured with ${permissions.length} permissions`,
  );
  return role;
}

async function seedSite() {
  const existing = await prisma.site.findFirst({
    where: { name: DEFAULT_SITE_NAME },
  });
  if (existing) return existing;

  const site = await prisma.site.create({
    data: { code: 'ST-001', name: DEFAULT_SITE_NAME, city: 'Douala' },
  });
  console.log(`✓ Site "${DEFAULT_SITE_NAME}" created`);
  return site;
}

// The platform administrator (super-admin): no site, global roles.
async function seedAdminUser(roleId: string) {
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { password: hashedPassword, status: 'ACTIVE' },
    create: {
      name: 'Admin Diffusion',
      email: ADMIN_EMAIL,
      password: hashedPassword,
      status: 'ACTIVE',
      isVerified: true,
      function: 'Administrateur système',
    },
  });

  // Global grant (siteId null). skipDuplicates relies on the
  // NULLS NOT DISTINCT unique index to keep re-runs idempotent.
  await prisma.userRole.createMany({
    data: [{ userId: user.id, roleId, siteId: null }],
    skipDuplicates: true,
  });

  console.log(`✓ Admin user ensured: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  return user;
}

/// Test-only: RESTRICTED dossiers need a DossierAccess row — holding every
/// permission doesn't cover them. Give the admin every role (globally) and
/// every restricted dossier. Re-run the seed after creating new
/// roles/dossiers to catch up.
async function grantAdminFullAccess(userId: string) {
  const [roles, restrictedDossiers] = await Promise.all([
    prisma.role.findMany({ select: { id: true } }),
    prisma.dossier.findMany({
      where: { confidentiality: 'RESTRICTED' },
      select: { id: true },
    }),
  ]);

  await prisma.userRole.createMany({
    data: roles.map((role) => ({ userId, roleId: role.id, siteId: null })),
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
      where: { name: type.name, siteId: null },
      select: { id: true },
    });
    if (!existing) await prisma.effetType.create({ data: type });
  }
  console.log(`✓ ${EFFET_TYPES.length} effet types ensured`);
}

// Canaux belong to a site: the default ones go to the default site.
async function seedReferentials(siteId: string) {
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
        where: { siteId_name: { siteId, name } },
        update: {},
        create: { name, siteId },
      }),
    ),
  );
  await Promise.all(
    canaux.map((name) =>
      prisma.canal.upsert({
        where: { siteId_name: { siteId, name } },
        update: {},
        create: { name, siteId },
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
      // Common criteria (no site): a nullable key can't be upserted on.
      prisma.analysisCriterionTemplate
        .findFirst({ where: { label, siteId: null }, select: { id: true } })
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
  const permissionCodes = await seedPermissions();
  const role = await seedAdminRole(permissionCodes);
  const site = await seedSite();
  const admin = await seedAdminUser(role.id);
  await seedReferentials(site.id);
  await seedEffetTypes();
  await seedAnalysisCriteria();
  await grantAdminFullAccess(admin.id);

  console.log('\nSeed complete. Log in with:');
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
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
