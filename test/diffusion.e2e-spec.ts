/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument --
   HTTP response bodies (supertest) and the dynamically imported Prisma
   client are untyped here: the scenarios assert on them directly. */
/**
 * End-to-end check of the business flows, on a real database and the real
 * HTTP API: a throwaway database is built by `prisma migrate deploy`, the
 * whole application boots on it, and the scenarios below run as real users.
 * The developer's own database is never touched.
 *
 * Run: npm run test:e2e (needs the docker-compose Postgres and Redis).
 */
import 'dotenv/config';
import { execSync } from 'child_process';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { ClsService } from 'nestjs-cls';
import { Client } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

const TEMP_DB = 'diffusion_e2e';
const PASSWORD = 'Str0ngP@ssword';

const baseUrl = new URL(process.env.DATABASE_URL!);
const tempUrl = new URL(baseUrl);
tempUrl.pathname = '/' + TEMP_DB;

async function admin(sql: string) {
  const c = new Client({ connectionString: baseUrl.toString() });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

// Retries `read` until `done` holds (or ~3 s), for what is written after
// the response.
async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  let value = await read();
  for (let i = 0; i < 30 && !done(value); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

describe('Diffusion, end to end', () => {
  let app: INestApplication<App>;
  let db: any;
  const token: Record<string, string> = {};
  const id: Record<string, string> = {};

  const as = (who: string) => ({
    get: (url: string) =>
      request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${token[who]}`),
    post: (url: string, body?: object) =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${token[who]}`)
        .send(body ?? {}),
    patch: (url: string, body?: object) =>
      request(app.getHttpServer())
        .patch(url)
        .set('Authorization', `Bearer ${token[who]}`)
        .send(body ?? {}),
  });

  async function tokenFor(name: string, userId: string, email: string) {
    id[name] = userId;
    token[name] = await app
      .get(JwtService)
      .signAsync(
        { sub: userId, email, typ: 'access' },
        { secret: process.env.JWT_SECRET!, expiresIn: '1h' },
      );
  }

  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS "${TEMP_DB}" WITH (FORCE)`);
    await admin(`CREATE DATABASE "${TEMP_DB}"`);
    execSync('npx prisma migrate deploy', {
      cwd: __dirname + '/..',
      env: { ...process.env, DATABASE_URL: tempUrl.toString() },
      stdio: 'ignore',
    });
    // Everything the application opens from here on uses the throwaway
    // database.
    process.env.DATABASE_URL = tempUrl.toString();

    const { AppModule } = await import('../src/AppModule');
    const { AllExceptionsFilter } =
      await import('../src/common/filters/all-exceptions.filter');
    const { DbLogger } = await import('../src/logging/db.logger');
    const { DatabaseService } =
      await import('../src/database/database.service');
    const { PermissionCode, PERMISSION_LABELS } =
      await import('../src/auth/rbac/rbac.constants');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Same pipeline as main.ts.
    app.useGlobalFilters(
      new AllExceptionsFilter(app.get(ClsService), app.get(DbLogger)),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    db = app.get(DatabaseService);

    // Reference data a real installation gets from the seed.
    const codes = Object.values(PermissionCode);
    await db.permission.createMany({
      data: codes.map((code) => ({
        code,
        description: PERMISSION_LABELS[code],
      })),
    });
    const perms = await db.permission.findMany();
    const permId = (code: string) => perms.find((p: any) => p.code === code).id;
    const role = async (name: string, permCodes: string[]) =>
      (
        await db.role.create({
          data: {
            name,
            code: 'RO-' + name.slice(0, 6).toUpperCase(),
            rolePermissions: {
              create: permCodes.map((c) => ({ permissionId: permId(c) })),
            },
          },
        })
      ).id;
    id.roleAdmin = await role('Administrateur', codes);
    id.roleAgent = await role('Agent courrier', [
      'COURRIER_REGISTER_ENTRANT',
      'COURRIER_READ',
    ]);
    id.roleChef = await role('Chef de service', [
      'DOSSIER_CREATE',
      'DOSSIER_READ',
      'COURRIER_READ',
      'COURRIER_WRITE_SORTANT',
      'INSTRUCTION_CREATE',
      'INSTRUCTION_ASSIGN',
      'INSTRUCTION_UPDATE',
      'VALIDATION_APPROVE',
      'VALIDATION_REQUEST_CORRECTIONS',
      'VALIDATION_REJECT',
      'LIVRABLE_READ',
    ]);
    id.roleExec = await role('Exécutant', [
      'DOSSIER_READ',
      'COURRIER_READ',
      'LIVRABLE_DEPOSIT',
      'LIVRABLE_READ',
      'LIVRABLE_SUBMIT',
      'LIVRABLE_NEW_VERSION',
    ]);

    // The platform administrator: no site, the Administrateur role globally.
    const superAdmin = await db.user.create({
      data: {
        name: 'Super Admin',
        email: 'super@e2e.test',
        password: await bcrypt.hash(PASSWORD, 10),
        userRoles: { create: { roleId: id.roleAdmin, siteId: null } },
      },
    });
    await tokenFor('super', superAdmin.id, superAdmin.email);
  });

  // The throwaway database is left in place: dropping it here would cut
  // the application's still-pooled connections. The next run drops it
  // first.
  afterAll(async () => {
    await app?.close();
  });

  // ---------------------------------------------------------------------------
  describe('1. Connexion', () => {
    it('logs in with a real password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'super@e2e.test', password: PASSWORD })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
    });

    it('refuses a refresh token used as an access token', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'super@e2e.test', password: PASSWORD })
        .expect(200);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.refreshToken}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      // And an access token can't refresh the session.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(401);
      // The refresh token still does its own job.
      const refreshed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Authorization', `Bearer ${login.body.refreshToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
        .expect(200);
    });

    it('refuses a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'super@e2e.test', password: 'wrong-password' })
        .expect(401);
    });
  });

  // ---------------------------------------------------------------------------
  describe('2. Sites et leurs administrateurs', () => {
    it('the super-admin creates two sites', async () => {
      for (const [key, name] of [
        ['siteA', 'Douala'],
        ['siteB', 'Yaoundé'],
      ]) {
        const res = await as('super').post('/sites', { name }).expect(201);
        id[key] = res.body.id;
      }
    });

    it('names a responsible for each site, who becomes its admin', async () => {
      for (const [who, site] of [
        ['respA', 'siteA'],
        ['respB', 'siteB'],
      ]) {
        const user = await as('super')
          .post('/users', {
            name: who,
            email: `${who}@e2e.test`,
            password: PASSWORD,
            siteId: id[site],
          })
          .expect(201);
        await as('super')
          .patch(`/sites/${id[site]}`, { responsibleId: user.body.id })
          .expect(200);
        await tokenFor(who, user.body.id, `${who}@e2e.test`);
      }
    });

    it("the site admin creates their site's users, on their own site", async () => {
      const users: [string, string][] = [
        ['agentA', id.roleAgent],
        ['chefA', id.roleChef],
        ['exec1', id.roleExec],
        ['exec2', id.roleExec],
      ];
      for (const [who, roleId] of users) {
        const res = await as('respA')
          .post('/users', {
            name: who,
            email: `${who}@e2e.test`,
            password: PASSWORD,
            roleIds: [roleId],
          })
          .expect(201);
        expect(res.body.site.id).toBe(id.siteA);
        await tokenFor(who, res.body.id, `${who}@e2e.test`);
      }
    });

    it('a site admin only sees their own site', async () => {
      const res = await as('respA').get('/users').expect(200);
      const sites = new Set(res.body.data.map((u: any) => u.site?.id));
      expect([...sites]).toEqual([id.siteA]);
      await as('respA').get(`/users/${id.respB}`).expect(403);
      await as('respB').get(`/users/${id.agentA}`).expect(403);
    });

    it('a site admin cannot create a user on another site', async () => {
      await as('respA')
        .post('/users', {
          name: 'Intrus',
          email: 'intrus@e2e.test',
          password: PASSWORD,
          siteId: id.siteB,
        })
        .expect(403);
    });

    it('a site responsible cannot be suspended', async () => {
      const res = await as('super')
        .post(`/users/${id.respA}/toggle-status`)
        .expect(400);
      expect(res.body.message).toMatch(/responsible of site/);
    });

    it('someone who administers nothing cannot manage users', async () => {
      await as('agentA').get('/users').expect(403);
    });
  });

  // ---------------------------------------------------------------------------
  describe('3. Rôles et permissions du site', () => {
    it('the site admin creates a role for their site', async () => {
      const perms = await as('respA').get('/permissions').expect(200);
      const codes = perms.body.map((p: any) => p.code);
      expect(codes).toContain('COURRIER_READ');
      // Platform permissions are not offered to a site admin.
      expect(codes).not.toContain('ADMIN_MANAGE_ROLES');

      const read = perms.body.find((p: any) => p.code === 'COURRIER_READ');
      const res = await as('respA')
        .post('/roles', { name: 'Lecteur', permissionIds: [read.id] })
        .expect(201);
      expect(res.body.siteId).toBe(id.siteA);
      id.roleLecteurA = res.body.id;
    });

    it("another site's admin doesn't see that role", async () => {
      await as('respB').get(`/roles/${id.roleLecteurA}`).expect(404);
    });

    it('only the super-admin posts a notification by hand', async () => {
      const body = {
        recipientIds: [id.agentA],
        type: 'ANNONCE',
        message: 'Maintenance ce soir',
        canal: 'IN_APP',
      };
      await as('respA').post('/notifications', body).expect(403);
      await as('super').post('/notifications', body).expect(201);
    });
  });

  // ---------------------------------------------------------------------------
  describe("4. Parcours d'un effet entrant", () => {
    it('the dossier exists, with chefA as responsible', async () => {
      const res = await as('chefA')
        .post('/dossiers', {
          title: 'Construction du pont',
          siteId: id.siteA,
          responsibleId: id.chefA,
        })
        .expect(201);
      id.dossier = res.body.id;
    });

    it('the agent registers a physical effet without knowing its dossier', async () => {
      const types = await as('agentA').get('/effet-types').expect(200);
      const specimen = types.body.find(
        (t: any) => t.name === 'Matière / spécimen',
      );
      id.typeSpecimen = specimen.id;
      id.typeBordereau = types.body.find(
        (t: any) => t.name === 'Bordereau de transmission',
      ).id;

      const res = await as('agentA')
        .post('/courriers', {
          direction: 'ENTRANT',
          subject: 'Carottes de béton du pilier 3',
          typeId: specimen.id,
          quantity: 3,
          storageLocation: 'Armoire B2',
          returnExpected: true,
        })
        .expect(201);
      expect(res.body.status).toBe('RECU');
      expect(res.body.dossierId).toBeNull();
      expect(res.body.type.name).toBe('Matière / spécimen');
      id.effet = res.body.id;
    });

    it('refuses physical fields on a courrier', async () => {
      await as('agentA')
        .post('/courriers', {
          direction: 'ENTRANT',
          subject: 'Lettre',
          quantity: 2,
        })
        .expect(400);
    });

    it('cannot be transmitted before its dossier is known', async () => {
      await as('agentA').post(`/courriers/${id.effet}/transmit`).expect(400);
    });

    it('attaching the dossier and transmitting tells its responsible', async () => {
      const res = await as('agentA')
        .patch(`/courriers/${id.effet}`, {
          dossierId: id.dossier,
          transmit: true,
        })
        .expect(200);
      expect(res.body.status).toBe('TRANSMIS');

      // Notifications are written after the response (fire-and-forget).
      const types = await eventually(
        async () => {
          const inbox = await as('chefA').get('/notifications/me').expect(200);
          return inbox.body.map((n: any) => n.notification.type);
        },
        (t: string[]) => t.includes('COURRIER_TRANSMITTED'),
      );
      expect(types).toContain('COURRIER_TRANSMITTED');
    });

    it("is validated by its dossier's responsible, and nobody else", async () => {
      await as('chefA')
        .post(`/courriers/${id.effet}/submit-for-validation`)
        .expect(201);
      const waiting = await as('chefA')
        .get('/courriers/awaiting-my-validation')
        .expect(200);
      expect(waiting.body.map((c: any) => c.id)).toContain(id.effet);

      await as('agentA').post(`/courriers/${id.effet}/validate`).expect(403);
      const res = await as('chefA')
        .post(`/courriers/${id.effet}/validate`)
        .expect(201);
      expect(res.body.status).toBe('VALIDE');
      expect(res.body.validations[0].decision).toBe('VALIDE');
    });

    it('records the return of the specimens, once', async () => {
      const res = await as('agentA')
        .post(`/courriers/${id.effet}/return`)
        .expect(201);
      expect(res.body.returnedAt).toEqual(expect.any(String));
      await as('agentA').post(`/courriers/${id.effet}/return`).expect(400);
    });

    it('a bordereau lists the effets it came with', async () => {
      const bordereau = await as('agentA')
        .post('/courriers', {
          direction: 'ENTRANT',
          subject: 'Bordereau n° 42',
          typeId: id.typeBordereau,
        })
        .expect(201);
      await as('agentA')
        .post('/courriers', {
          direction: 'ENTRANT',
          subject: 'Rapport géotechnique',
          parentId: bordereau.body.id,
        })
        .expect(201);

      const res = await as('agentA')
        .get(`/courriers/${bordereau.body.id}`)
        .expect(200);
      expect(res.body.children).toHaveLength(1);
      expect(res.body.children[0].subject).toBe('Rapport géotechnique');
    });
  });

  // ---------------------------------------------------------------------------
  describe("5. Parcours d'une tâche", () => {
    it('is created, waiting for its executants to subscribe', async () => {
      const res = await as('chefA')
        .post('/instructions', {
          dossierId: id.dossier,
          title: 'Analyser les carottes',
          executantIds: [id.exec1, id.exec2],
          superviseurId: id.chefA,
          dueDate: '2026-12-15',
        })
        .expect(201);
      expect(res.body.status).toBe('AFFECTEE');
      id.task = res.body.id;
    });

    it("refuses an executants' deadline after the task's", async () => {
      await as('chefA')
        .patch(`/instructions/${id.task}/delai-execution`, {
          agentDueDate: '2026-12-20',
        })
        .expect(400);
      await as('chefA')
        .patch(`/instructions/${id.task}/delai-execution`, {
          agentDueDate: '2026-12-10',
        })
        .expect(200);
    });

    it("never leaks a user's password hash or refresh token", async () => {
      const res = await as('chefA')
        .get(`/dossiers/${id.dossier}/instructions`)
        .expect(200);
      const user = res.body.data[0].assignees[0].user;
      expect(user).toEqual({
        id: expect.any(String),
        name: expect.any(String),
        email: expect.any(String),
      });
    });

    it('one executant declines: the task stays with the other', async () => {
      await as('exec1')
        .patch(`/instructions/${id.task}/ne-pas-souscrire`, {
          motif: 'Charge de travail pleine',
        })
        .expect(200);
      const res = await as('chefA').get(`/instructions/${id.task}`).expect(200);
      expect(res.body.status).toBe('AFFECTEE');
      expect(res.body.subscriptions[0].decision).toBe('NON_SOUSCRITE');
    });

    it('the last one declines: back to its creator', async () => {
      await as('exec2')
        .patch(`/instructions/${id.task}/ne-pas-souscrire`, {
          motif: 'Hors de mon domaine',
        })
        .expect(200);
      const returned = await as('chefA')
        .get('/instructions/taches?tab=renvoyees')
        .expect(200);
      expect(returned.body.data.map((t: any) => t.id)).toContain(id.task);
      expect(returned.body.data[0].status).toBe('NON_SOUSCRITE');
    });

    it('the creator reassigns it, and the executant subscribes', async () => {
      await as('chefA')
        .post(`/instructions/${id.task}/assign`, {
          executantIds: [id.exec1],
          superviseurId: id.chefA,
        })
        .expect(201);
      // A superviseur can't subscribe in an executant's place.
      await as('chefA').patch(`/instructions/${id.task}/souscrire`).expect(403);
      const res = await as('exec1')
        .patch(`/instructions/${id.task}/souscrire`)
        .expect(200);
      expect(res.body.status).toBe('EN_COURS');
    });

    it('once subscribed, the executant can no longer decline', async () => {
      await as('exec1')
        .patch(`/instructions/${id.task}/ne-pas-souscrire`, {
          motif: 'Finalement non',
        })
        .expect(400);
    });

    it('the executant hands in a livrable, the superviseur approves: done', async () => {
      const livrable = await as('exec1')
        .post('/deliverables', {
          instructionId: id.task,
          title: "Rapport d'analyse",
        })
        .expect(201);
      await as('exec1')
        .post(`/deliverables/${livrable.body.id}/deposit`)
        .expect(201);
      await as('exec1')
        .post(`/deliverables/${livrable.body.id}/submit`)
        .expect(201);

      const waiting = await as('chefA')
        .get(`/instructions/${id.task}`)
        .expect(200);
      expect(waiting.body.status).toBe('EN_ATTENTE_VALIDATION');

      const done = await as('chefA')
        .patch(`/instructions/${id.task}/approve-livrables`)
        .expect(200);
      expect(done.body.status).toBe('TERMINEE');
    });
  });

  // ---------------------------------------------------------------------------
  describe("6. Journal d'audit", () => {
    it('only lists what users did, and a site admin only their site', async () => {
      const all = await as('super').get('/activity-logs').expect(200);
      expect(all.body.data.length).toBeGreaterThan(0);
      expect(all.body.data.every((log: any) => log.userId)).toBe(true);

      const siteB = await as('respB').get('/activity-logs').expect(200);
      const siteBUsers = new Set([id.respB]);
      expect(
        siteB.body.data.every((log: any) => siteBUsers.has(log.userId)),
      ).toBe(true);
    });
  });
});
