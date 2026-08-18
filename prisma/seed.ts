// import 'dotenv/config';
// import { PrismaPg } from '@prisma/adapter-pg';
// import * as bcrypt from 'bcrypt';
// import { Pool } from 'pg';
// import { PrismaClient } from '../generated/prisma/client';

// // RBAC skeleton fixture: one user, one affectation, one role, one
// // permission — just enough to prove Utilisateur -> Affectation -> Role ->
// // Permission resolves end to end. Re-runnable (find-or-create/upsert).
// export const RBAC_TEST_USER_EMAIL = 'rbac.test@example.com';
// export const RBAC_TEST_USER_PASSWORD = 'Str0ngP@ssword';
// export const RBAC_TEST_PERMISSION_CODE = 'DOC_READ';
// export const RBAC_TEST_ROLE_NAME = 'Admin';
// const RBAC_TEST_SITE_NAME = 'RBAC Test Site';

// const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// async function main() {
//   const site =
//     (await prisma.site.findFirst({ where: { name: RBAC_TEST_SITE_NAME } })) ??
//     (await prisma.site.create({ data: { name: RBAC_TEST_SITE_NAME } }));

//   const hashedPassword = await bcrypt.hash(RBAC_TEST_USER_PASSWORD, 10);
//   const user = await prisma.utilisateur.upsert({
//     where: { email: RBAC_TEST_USER_EMAIL },
//     update: {},
//     create: {
//       name: 'RBAC Test User',
//       email: RBAC_TEST_USER_EMAIL,
//       password: hashedPassword,
//       status: 'active',
//     },
//   });

//   const affectation =
//     (await prisma.affectation.findFirst({
//       where: { utilisateurUuid: user.uuid, siteUuid: site.uuid },
//     })) ??
//     (await prisma.affectation.create({
//       data: { utilisateurUuid: user.uuid, siteUuid: site.uuid },
//     }));

//   const role =
//     (await prisma.role.findFirst({
//       where: { affectationUuid: affectation.uuid, nom: RBAC_TEST_ROLE_NAME },
//     })) ??
//     (await prisma.role.create({
//       data: { affectationUuid: affectation.uuid, nom: RBAC_TEST_ROLE_NAME },
//     }));

//   const permission =
//     (await prisma.permission.findFirst({
//       where: { noms: RBAC_TEST_PERMISSION_CODE },
//     })) ??
//     (await prisma.permission.create({
//       data: { noms: RBAC_TEST_PERMISSION_CODE },
//     }));

//   await prisma.rolePermission.upsert({
//     where: {
//       permissionUuid_roleUuid: {
//         permissionUuid: permission.uuid,
//         roleUuid: role.uuid,
//       },
//     },
//     update: {},
//     create: { permissionUuid: permission.uuid, roleUuid: role.uuid },
//   });

//   console.log('RBAC seed complete:', {
//     user: { uuid: user.uuid, email: user.email },
//     site: site.uuid,
//     affectation: affectation.uuid,
//     role: { uuid: role.uuid, nom: role.nom },
//     permission: { uuid: permission.uuid, noms: permission.noms },
//   });
// }

// main()
//   .then(async () => {
//     await prisma.$disconnect();
//   })
//   .catch(async (error: unknown) => {
//     console.error(error);
//     await prisma.$disconnect();
//     process.exit(1);
//   });
