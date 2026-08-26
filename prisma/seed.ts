import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { PermissionCode } from '../src/auth/rbac/rbac.constants';

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
        create: { code },
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

  const role = await prisma.role.upsert({
    where: { name: ADMIN_ROLE_NAME },
    update: {},
    create: {
      name: ADMIN_ROLE_NAME,
      description: 'Accès complet — tous les droits, pour les tests',
    },
  });

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
    data: { name: DEFAULT_SITE_NAME, city: 'Douala' },
  });
  console.log(`✓ Site "${DEFAULT_SITE_NAME}" created`);
  return site;
}

async function seedAdminUser(roleId: string, siteId: string) {
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

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId } },
    update: {},
    create: { userId: user.id, roleId },
  });

  await prisma.assignment.upsert({
    where: { userId_siteId: { userId: user.id, siteId } },
    update: {},
    create: { userId: user.id, siteId },
  });

  // The site needs a responsible; default to the admin if none is set yet.
  await prisma.site.updateMany({
    where: { id: siteId, responsibleId: null },
    data: { responsibleId: user.id },
  });

  console.log(`✓ Admin user ensured: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  return user;
}

async function seedReferentials() {
  const dossierTypes = ['Étude technique', 'Contrôle des travaux', 'Expertise'];
  const correspondentTypes = [
    'Administration publique',
    'Entreprise',
    'Prestataire',
    'Partenaire technique',
    'Personne physique',
  ];
  const canaux = ['Courrier électronique', 'Courrier postal', 'Remise en main propre'];
  const natures = ['Demande d’information', 'Rapport', 'Réponse administrative'];

  await Promise.all(
    dossierTypes.map((name) =>
      prisma.dossierType.upsert({ where: { name }, update: {}, create: { name } }),
    ),
  );
  await Promise.all(
    correspondentTypes.map((name) =>
      prisma.correspondentType.upsert({
        where: { name },
        update: {},
        create: { name },
      }),
    ),
  );
  await Promise.all(
    canaux.map((name) =>
      prisma.canal.upsert({ where: { name }, update: {}, create: { name } }),
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

  console.log('✓ Referentials seeded (dossier types, correspondent types, canaux, natures, a default category)');
}

async function main() {
  const permissionCodes = await seedPermissions();
  const role = await seedAdminRole(permissionCodes);
  const site = await seedSite();
  await seedAdminUser(role.id, site.id);
  await seedReferentials();

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
