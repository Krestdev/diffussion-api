/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument --
   HTTP response bodies (supertest) and the dynamically imported Prisma
   client are untyped here: the scenarios assert on them directly. */
/**
 * End-to-end check of the business flows, on a real database and the real
 * HTTP API: a throwaway database is built by `prisma migrate deploy`, the
 * whole application boots on it, and the scenarios below run as real users.
 * The developer's own database is never touched.
 *
 * Run: npm run test:e2e (needs the docker-compose Postgres).
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
    put: (url: string, body?: object) =>
      request(app.getHttpServer())
        .put(url)
        .set('Authorization', `Bearer ${token[who]}`)
        .send(body ?? {}),
    delete: (url: string) =>
      request(app.getHttpServer())
        .delete(url)
        .set('Authorization', `Bearer ${token[who]}`),
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
      'COURRIER_SEND',
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
  describe("4b. Parcours d'un effet sortant", () => {
    it('is drafted from its subject, then given its text and its dossier', async () => {
      const draft = await as('chefA')
        .post('/courriers/sortants', { subject: 'Réponse au maître d’ouvrage' })
        .expect(201);
      expect(draft.body.status).toBe('BROUILLON');
      expect(draft.body.createdBy).toEqual({ id: id.chefA, name: 'chefA' });
      id.sortant = draft.body.id;

      await as('chefA')
        .patch(`/courriers/${id.sortant}`, {
          body: 'Monsieur,\nNous accusons réception de votre demande.',
          dossierId: id.dossier,
        })
        .expect(200);
      const res = await as('chefA').get(`/courriers/${id.sortant}`).expect(200);
      expect(res.body.body).toContain('accusons réception');
      // Its dossier's responsible approves it.
      expect(res.body.approver).toEqual({ id: id.chefA, name: 'chefA' });
    });

    it('has no PDF before its approval', async () => {
      await as('chefA').get(`/courriers/${id.sortant}/pdf`).expect(400);
    });

    it('gets its outgoing reference once approved', async () => {
      const submitted = await as('chefA')
        .post(`/courriers/${id.sortant}/submit-for-validation`)
        .expect(201);
      expect(submitted.body.submittedAt).toEqual(expect.any(String));

      const res = await as('chefA')
        .post(`/courriers/${id.sortant}/validate`)
        .expect(201);
      expect(res.body.status).toBe('VALIDE');
      expect(res.body.reference).toBe(`SOR-${new Date().getFullYear()}-000001`);
      expect(res.body.approvedAt).toEqual(expect.any(String));
      expect(res.body.approvedBy).toEqual({ id: id.chefA, name: 'chefA' });
    });

    it('downloads its PDF', async () => {
      const res = await as('chefA')
        .get(`/courriers/${id.sortant}/pdf`)
        .responseType('blob')
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(
        `SOR-${new Date().getFullYear()}-000001.pdf`,
      );
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('is cancelled only with a reason of 10 characters', async () => {
      const other = await as('chefA')
        .post('/courriers/sortants', { subject: 'Relance fournisseur' })
        .expect(201);
      await as('chefA').post(`/courriers/${other.body.id}/cancel`).expect(400);
      await as('chefA')
        .post(`/courriers/${other.body.id}/cancel`, { reason: '  Erreur  ' })
        .expect(400);
      const res = await as('chefA')
        .post(`/courriers/${other.body.id}/cancel`, {
          reason: 'Le fournisseur a déjà livré',
        })
        .expect(201);
      expect(res.body.status).toBe('ANNULE');
      expect(res.body.cancellationReason).toBe('Le fournisseur a déjà livré');
    });

    it('counts every tab, whatever the tab shown', async () => {
      const res = await as('chefA')
        .get('/courriers/sortants?group=drafts')
        .expect(200);
      expect(res.body.metrics.byTab).toEqual({
        all: 2,
        drafts: 0,
        submitted: 0,
        corrections: 0,
        authorized: 1,
        cancelled: 1,
        archived: 0,
      });
    });

    it('exports the list as CSV', async () => {
      const res = await as('chefA')
        .get('/courriers/sortants/export?group=authorized')
        .expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain(`SOR-${new Date().getFullYear()}-000001`);
      expect(res.text).not.toContain('Relance fournisseur');
    });

    const multipart = (url: string) =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${token.chefA}`);
    const year = new Date().getFullYear();

    it('is archived only once discharged', async () => {
      await as('chefA')
        .post(`/courriers/${id.sortant}/archive`, { reason: 'Trop tôt' })
        .expect(400);
    });

    it('is signed with its signed scan, its signatory and its date', async () => {
      // Not sent before its signature.
      const canal = await as('super')
        .post('/canaux', { name: 'Porteur', siteId: id.siteA })
        .expect(201);
      id.canalPorteur = canal.body.id;
      await as('chefA')
        .post(`/courriers/${id.sortant}/send`, {
          canalId: id.canalPorteur,
          recipient: 'M. Diallo',
          transmittedAt: '2026-11-03',
        })
        .expect(400);
      // Only the accepted attachment types.
      await multipart(`/courriers/${id.sortant}/sign`)
        .field('signatoryId', id.chefA)
        .field('signedAt', '2026-11-02')
        .attach('file', Buffer.from('signé'), 'signe.txt')
        .expect(400);

      const res = await multipart(`/courriers/${id.sortant}/sign`)
        .field('signatoryId', id.chefA)
        .field('signedAt', '2026-11-02')
        .attach('file', Buffer.from('%PDF-1.4'), 'signe.pdf')
        .expect(201);
      expect(res.body.status).toBe('SIGNE');
      expect(res.body.signedAt).toBe('2026-11-02T00:00:00.000Z');
      expect(res.body.signedBy).toEqual({ id: id.chefA, name: 'chefA' });
      expect(res.body.signedDocument.originalName).toBe('signe.pdf');
    });

    it("is only sent through its own site's canal", async () => {
      const other = await as('super')
        .post('/canaux', { name: 'Porteur', siteId: id.siteB })
        .expect(201);
      await as('chefA')
        .post(`/courriers/${id.sortant}/send`, {
          canalId: other.body.id,
          recipient: 'M. Diallo',
          transmittedAt: '2026-11-03',
        })
        .expect(400);

      // Each site sees its own canaux and correspondents only.
      const mine = await as('chefA').get('/canaux').expect(200);
      expect(mine.body.map((c: any) => c.id)).toContain(id.canalPorteur);
      expect(mine.body.map((c: any) => c.id)).not.toContain(other.body.id);
      await as('chefA').get(`/canaux/${other.body.id}`).expect(404);
      const all = await as('super')
        .get(`/canaux?siteId=${id.siteB}`)
        .expect(200);
      expect(all.body.map((c: any) => c.id)).toEqual([other.body.id]);
      // A name is unique within a site only.
      await as('super')
        .post('/canaux', { name: 'Porteur', siteId: id.siteB })
        .expect(409);
      // Only a platform administrator makes them.
      await as('respA')
        .post('/canaux', { name: 'Coursier', siteId: id.siteA })
        .expect(403);

      const sender = await as('super')
        .post('/correspondents', {
          name: 'Mairie de Yaoundé',
          siteId: id.siteB,
        })
        .expect(201);
      expect(sender.body.site).toMatchObject({ id: id.siteB });
      const seen = await as('chefA').get('/correspondents').expect(200);
      expect(seen.body.data.map((c: any) => c.id)).not.toContain(
        sender.body.id,
      );
      await as('agentA')
        .post('/courriers', {
          direction: 'ENTRANT',
          subject: 'Lettre de Yaoundé',
          correspondentId: sender.body.id,
        })
        .expect(400);
    });

    it('is sent under its bordereau de transmission', async () => {
      const res = await as('chefA')
        .post(`/courriers/${id.sortant}/send`, {
          canalId: id.canalPorteur,
          recipient: 'M. Diallo',
          transmittedAt: '2026-11-03',
        })
        .expect(201);
      expect(res.body.status).toBe('ENVOYE');
      expect(res.body.bordereauNumber).toBe(`BT-${year}-000001`);
      expect(res.body.transmissionMode).toBe('Porteur');
      expect(res.body.transmissionRecipient).toBe('M. Diallo');
      expect(res.body.transmittedAt).toBe('2026-11-03T00:00:00.000Z');
      expect(res.body.transmittedBy).toEqual({ id: id.chefA, name: 'chefA' });
    });

    it('downloads its bordereau', async () => {
      const res = await as('chefA')
        .get(`/courriers/${id.sortant}/bordereau`)
        .responseType('blob')
        .expect(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(
        `BT-${year}-000001.pdf`,
      );
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('is discharged with the bordereau signed by its recipient', async () => {
      await multipart(`/courriers/${id.sortant}/discharge`)
        .field('receivedBy', 'M. Diallo')
        .field('dischargedAt', '2026-11-04')
        .expect(400);

      const res = await multipart(`/courriers/${id.sortant}/discharge`)
        .field('receivedBy', 'M. Diallo')
        .field('dischargedAt', '2026-11-04')
        .attach('file', Buffer.from('%PDF-1.4'), 'decharge.pdf')
        .expect(201);
      expect(res.body.status).toBe('DECHARGE');
      expect(res.body.dischargeReceivedBy).toBe('M. Diallo');
      expect(res.body.dischargedAt).toBe('2026-11-04T00:00:00.000Z');
      expect(res.body.dischargeDocument.originalName).toBe('decharge.pdf');

      const tabs = await as('chefA').get('/courriers/sortants').expect(200);
      expect(tabs.body.metrics.byTab.authorized).toBe(1);
    });

    it('is archived with its reason, then restored as it was', async () => {
      const archived = await as('chefA')
        .post(`/courriers/${id.sortant}/archive`, { reason: 'Affaire soldée' })
        .expect(201);
      expect(archived.body.status).toBe('ARCHIVE');
      expect(archived.body.archiveReason).toBe('Affaire soldée');

      const restored = await as('chefA')
        .post(`/courriers/${id.sortant}/unarchive`)
        .expect(201);
      expect(restored.body.status).toBe('DECHARGE');
    });

    it('journals each step', async () => {
      const actions = await eventually(
        async () => {
          const res = await as('chefA')
            .get(`/courriers/${id.sortant}/historique?take=50`)
            .expect(200);
          return res.body.data as any[];
        },
        (rows: any[]) => rows.some((r) => r.action === 'COURRIER_DESARCHIVE'),
      );
      const codes = actions.map((r) => r.action);
      expect(codes).toEqual(
        expect.arrayContaining([
          'COURRIER_BROUILLON_CREE',
          'COURRIER_EN_ATTENTE_VALIDATION',
          'COURRIER_VALIDE',
          'COURRIER_SIGNE',
          'COURRIER_ENVOYE',
          'COURRIER_DECHARGE',
          'COURRIER_ARCHIVE',
          'COURRIER_DESARCHIVE',
        ]),
      );
      const approval = actions.find((r) => r.action === 'COURRIER_VALIDE');
      expect(approval.metadata.reference).toBe(
        `SOR-${new Date().getFullYear()}-000001`,
      );
      const sent = actions.find((r) => r.action === 'COURRIER_ENVOYE');
      expect(sent.metadata.reference).toBe(
        `BT-${new Date().getFullYear()}-000001`,
      );
      const discharged = actions.find((r) => r.action === 'COURRIER_DECHARGE');
      expect(discharged.metadata.receivedBy).toBe('M. Diallo');
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
          validateurId: id.respA,
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

    it('the executant hands in a livrable: the validateur gives an opinion, the superviseur decides', async () => {
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

      // The superviseur waits for the validateur.
      await as('chefA')
        .patch(`/instructions/${id.task}/approve-livrables`)
        .expect(400);
      // The validateur gives an opinion, never a decision.
      await as('respA')
        .patch(`/instructions/${id.task}/approve-livrables`)
        .expect(403);
      // An opinion made only of spaces is empty.
      await as('respA')
        .patch(`/deliverables/${livrable.body.id}/avis`, { comment: '   ' })
        .expect(400);
      const avis = await as('respA')
        .patch(`/deliverables/${livrable.body.id}/avis`, {
          comment: 'Analyse complète',
        })
        .expect(200);
      expect(avis.body.validationStep).toBe(1);
      expect(avis.body.validations[0]).toMatchObject({
        decision: 'AVIS',
        comment: 'Analyse complète',
      });

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

  // ---------------------------------------------------------------------------
  describe('7. Contrats', () => {
    it("only its site's responsible or a platform administrator creates a contract", async () => {
      const project = await db.project.create({
        data: { name: 'Port de Kribi', siteId: id.siteA },
      });
      id.project = project.id;
      id.otherProject = (
        await db.project.create({
          data: { name: 'Route Douala', siteId: id.siteA },
        })
      ).id;
      const body = { title: 'Marché des quais', projectId: id.project };
      await as('chefA').post('/contracts', body).expect(403);
      // The responsible of another site neither.
      await as('respB').post('/contracts', body).expect(403);
      const res = await as('super').post('/contracts', body).expect(201);
      expect(res.body.number).toMatch(/^CT-/);
      id.contract = res.body.id;
    });

    it("a dossier under the contract takes the contract's project", async () => {
      const res = await as('chefA')
        .post('/dossiers', {
          title: 'Quai nord',
          siteId: id.siteA,
          responsibleId: id.chefA,
          contractId: id.contract,
        })
        .expect(201);
      expect(res.body.projectId).toBe(id.project);
      expect(res.body.contract.id).toBe(id.contract);
      id.contractDossier = res.body.id;
    });

    it("refuses a project other than the contract's", async () => {
      await as('chefA')
        .post('/dossiers', {
          title: 'Quai sud',
          siteId: id.siteA,
          responsibleId: id.chefA,
          contractId: id.contract,
          projectId: id.otherProject,
        })
        .expect(400);
    });

    it('lists the dossiers of a contract', async () => {
      const list = await as('chefA')
        .get(`/dossiers?contractId=${id.contract}`)
        .expect(200);
      expect(list.body.data.map((d: any) => d.id)).toEqual([
        id.contractDossier,
      ]);
      const contract = await as('chefA')
        .get(`/contracts/${id.contract}`)
        .expect(200);
      expect(contract.body.dossiers.map((d: any) => d.id)).toEqual([
        id.contractDossier,
      ]);
    });

    it('moving the contract to another project moves its dossiers', async () => {
      await as('super')
        .patch(`/contracts/${id.contract}`, { projectId: id.otherProject })
        .expect(200);
      const dossier = await as('chefA')
        .get(`/dossiers/${id.contractDossier}`)
        .expect(200);
      expect(dossier.body.projectId).toBe(id.otherProject);
    });

    it('lists the entrants of a contract, or of a project', async () => {
      const effet = await as('agentA')
        .post('/courriers', {
          direction: 'ENTRANT',
          subject: 'Plans du quai nord',
          dossierId: id.contractDossier,
        })
        .expect(201);

      const ids = async (filter: string) =>
        (
          await as('chefA').get(`/courriers/entrants?${filter}`).expect(200)
        ).body.data.map((c: any) => c.id);
      expect(await ids(`contractId=${id.contract}`)).toEqual([effet.body.id]);
      expect(await ids(`projectId=${id.otherProject}`)).toEqual([
        effet.body.id,
      ]);
      expect(await ids(`projectId=${id.project}`)).toEqual([]);
    });

    it('cannot be deleted while it contains dossiers', async () => {
      await as('super').delete(`/contracts/${id.contract}`).expect(409);
    });
  });

  // ---------------------------------------------------------------------------
  describe('7b. Projets', () => {
    it('belong to a site: managed by its responsible, seen by its users only', async () => {
      const own = await as('respA')
        .post('/projects', { name: 'Digue de Bonabéri' })
        .expect(201);
      expect(own.body.site).toMatchObject({ id: id.siteA });
      // Not on another site.
      await as('respA')
        .post('/projects', { name: 'Pont de Mbalmayo', siteId: id.siteB })
        .expect(403);
      await as('chefA').post('/projects', { name: 'Hors droits' }).expect(403);

      const seenA = await as('chefA').get('/projects?take=100').expect(200);
      expect(seenA.body.data.map((p: any) => p.id)).toContain(own.body.id);
      const seenB = await as('respB').get('/projects?take=100').expect(200);
      expect(seenB.body.data.map((p: any) => p.id)).not.toContain(own.body.id);
      await as('respB').get(`/projects/${own.body.id}`).expect(404);

      // A dossier of another site cannot belong to it.
      await as('respB')
        .post('/dossiers', {
          title: 'Hors site',
          siteId: id.siteB,
          responsibleId: id.respB,
          projectId: own.body.id,
        })
        .expect(400);
      await as('respA').delete(`/projects/${own.body.id}`).expect(204);
    });

    it('lists projects with their responsible, counts and metrics', async () => {
      const updated = await as('super')
        .patch(`/projects/${id.otherProject}`, {
          responsibleId: id.chefA,
          startDate: '2026-01-01',
          endDate: '2027-12-31',
        })
        .expect(200);
      expect(updated.body.responsible.id).toBe(id.chefA);

      const res = await as('chefA').get('/projects').expect(200);
      const project = res.body.data.find((p: any) => p.id === id.otherProject);
      expect(project.status).toBe('ACTIVE');
      expect(project._count).toEqual({ contracts: 1, dossiers: 1 });
      expect(res.body.metrics.byStatus).toEqual({
        ACTIVE: 2,
        CLOSED: 0,
        ARCHIVED: 0,
      });
      expect(res.body.metrics.withoutResponsible).toBe(1);
    });

    it('closes, then archives, one step at a time', async () => {
      await as('super')
        .patch(`/projects/${id.project}`, { status: 'ARCHIVED' })
        .expect(400);
      const closed = await as('super')
        .patch(`/projects/${id.project}`, { status: 'CLOSED' })
        .expect(200);
      expect(closed.body.closedAt).not.toBeNull();

      const tab = await as('chefA').get('/projects?status=CLOSED').expect(200);
      expect(tab.body.data.map((p: any) => p.id)).toEqual([id.project]);
      expect(tab.body.metrics.byStatus.ACTIVE).toBe(1);
    });

    it('lists the contracts ending within N days', async () => {
      const soon = new Date();
      soon.setDate(soon.getDate() + 10);
      await as('super')
        .patch(`/contracts/${id.contract}`, {
          endDate: soon.toISOString().slice(0, 10),
        })
        .expect(200);
      const ids = async (days: number) =>
        (
          await as('chefA')
            .get(`/contracts?endingWithinDays=${days}`)
            .expect(200)
        ).body.data.map((c: any) => c.id);
      expect(await ids(30)).toEqual([id.contract]);
      expect(await ids(5)).toEqual([]);
      const metrics = (await as('chefA').get('/projects').expect(200)).body
        .metrics;
      expect(metrics.contractsEndingSoon).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  describe('7c. Fiches projet et contrat', () => {
    it("names the maître d'ouvrage by name, creating the correspondent", async () => {
      const res = await as('super')
        .patch(`/projects/${id.otherProject}`, {
          maitreOuvrageName: 'Port Autonome de Kribi',
        })
        .expect(200);
      expect(res.body.maitreOuvrage.name).toBe('Port Autonome de Kribi');
      id.client = res.body.maitreOuvrage.id;
    });

    it('creates a complete contract, open to its authorized users only', async () => {
      const types = await as('chefA').get('/contracts/types').expect(200);
      expect(types.body.map((t: any) => t.value)).toContain('TRAVAUX');

      const res = await as('super')
        .post('/contracts', {
          title: 'Marché des digues',
          projectId: id.otherProject,
          type: 'TRAVAUX',
          amount: 1500000.5,
          tenderReference: 'AO-2026-012',
          clientId: id.client,
          responsibleId: id.chefA,
          authorizedUserIds: [id.chefA],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        type: 'TRAVAUX',
        client: { name: 'Port Autonome de Kribi' },
        responsible: { id: id.chefA },
        _count: { dossiers: 0, authorized: 1, courriers: 0 },
      });
      id.restrictedContract = res.body.id;

      await as('chefA').get(`/contracts/${id.restrictedContract}`).expect(200);
      await as('agentA').get(`/contracts/${id.restrictedContract}`).expect(404);
      const list = await as('agentA').get('/contracts').expect(200);
      expect(list.body.data.map((c: any) => c.id)).not.toContain(
        id.restrictedContract,
      );
    });

    it("the project page shows what's going on in it", async () => {
      const res = await as('chefA')
        .get(`/projects/${id.otherProject}`)
        .expect(200);
      expect(res.body.metrics).toEqual({
        contractsSigning: 2,
        dossiersActive: 1,
        openCourriers: { incoming: 1, outgoing: 0 },
        overdueInstructions: { count: 0, firstReference: null },
        courriers: 1,
        authorized: 0,
      });
    });

    it("only the project's responsible restricts it, and it is then hidden", async () => {
      await as('respB')
        .put(`/projects/${id.otherProject}/access`, { userIds: [id.respB] })
        .expect(403);
      const res = await as('chefA')
        .put(`/projects/${id.otherProject}/access`, { userIds: [id.chefA] })
        .expect(200);
      expect(res.body.map((u: any) => u.id)).toEqual([id.chefA]);
      await as('agentA').get(`/projects/${id.otherProject}`).expect(404);

      const history = await as('chefA')
        .get(`/projects/${id.otherProject}/historique`)
        .expect(200);
      expect(history.body.data.map((log: any) => log.action)).toEqual(
        expect.arrayContaining(['project.access.updated', 'project.updated']),
      );
    });

    it('archives a contract with its reason, which then takes nothing new', async () => {
      const res = await as('super')
        .post(`/contracts/${id.restrictedContract}/archive`, {
          reason: 'Marché résilié',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'ARCHIVED',
        archiveReason: 'Marché résilié',
      });

      await as('chefA')
        .post('/dossiers', {
          title: 'Digue est',
          siteId: id.siteA,
          responsibleId: id.chefA,
          contractId: id.restrictedContract,
        })
        .expect(400);
      await request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${token.chefA}`)
        .field('contractId', id.restrictedContract)
        .attach('file', Buffer.from('%PDF-1.4'), 'pv.pdf')
        .expect(400);

      const history = await as('chefA')
        .get(`/contracts/${id.restrictedContract}/historique`)
        .expect(200);
      expect(history.body.data.map((log: any) => log.action)).toContain(
        'contract.archived',
      );
    });

    it('lists the dossiers of a project', async () => {
      const res = await as('chefA')
        .get(`/dossiers?projectId=${id.otherProject}`)
        .expect(200);
      expect(res.body.data.map((d: any) => d.id)).toEqual([id.contractDossier]);
    });

    it('takes the number typed for a dossier, once', async () => {
      const body = {
        title: 'Dossier saisi',
        siteId: id.siteA,
        responsibleId: id.chefA,
        number: 'DOS-E2E-001',
      };
      const res = await as('chefA').post('/dossiers', body).expect(201);
      expect(res.body.number).toBe('DOS-E2E-001');
      await as('chefA').post('/dossiers', body).expect(409);
    });

    it("an effet shows its dossier's contract", async () => {
      const res = await as('chefA')
        .get(`/courriers/entrants?contractId=${id.contract}`)
        .expect(200);
      expect(res.body.data[0].dossier.contract).toMatchObject({
        id: id.contract,
        title: 'Marché des quais',
      });
    });
  });

  // ---------------------------------------------------------------------------
  describe("7d. Fiches d'analyse", () => {
    it('is opened from an effet entrant alone, with its elements', async () => {
      await as('super')
        .post('/analysis-criteria', { label: 'Forme', order: 1 })
        .expect(201);
      await as('super')
        .post('/analysis-criteria', {
          label: 'Exploitabilité',
          order: 2,
          appliedByDefault: false,
        })
        .expect(201);

      const res = await as('super')
        .post('/analysis-sheets', {
          courrierId: id.effet,
          title: 'Remise des plans de ferraillage',
          owner: 'Port Autonome',
          validatorId: id.chefA,
          validatorFunction: 'Chef de projet',
          items: [
            { label: 'Plan R+1', norms: 'NF EN 1992-1-1', opinion: 'AF' },
          ],
        })
        .expect(201);
      expect(res.body.status).toBe('BROUILLON');
      expect(res.body.version).toBe('1.0');
      expect(res.body.livrable).toBeNull();
      expect(res.body.validator).toMatchObject({ id: id.chefA });
      expect(res.body.items[0]).toMatchObject({
        documentId: null,
        norms: 'NF EN 1992-1-1',
        opinion: 'AF',
      });
      // Only the criteria applied by default.
      expect(res.body.items[0].criteria.map((c: any) => c.label)).toEqual([
        'Forme',
      ]);
      expect(res.body.versions).toEqual([
        expect.objectContaining({ version: '1.0', status: 'BROUILLON' }),
      ]);
      id.sheet = res.body.id;
    });

    it('takes the header fields through PATCH, and is recorded', async () => {
      const res = await as('super')
        .patch(`/analysis-sheets/${id.sheet}`, {
          mode: 'Porteur',
          allotment: 'Lot 2',
          comments: 'RAS',
          validatorId: id.super,
          authorId: id.chefA,
          overallOpinion: 'AFR',
          status: 'ENREGISTREE',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        mode: 'Porteur',
        allotment: 'Lot 2',
        status: 'ENREGISTREE',
        overallOpinion: 'AFR',
        validatorId: id.super,
        validator: { id: id.super },
        authorId: id.chefA,
        author: { id: id.chefA, name: 'chefA' },
      });
      const read = await as('super')
        .get(`/analysis-sheets/${id.sheet}`)
        .expect(200);
      expect(read.body.validator).toEqual(
        expect.objectContaining({ id: id.super, email: expect.any(String) }),
      );
    });

    it('downloads its PDF', async () => {
      const res = await as('super')
        .get(`/analysis-sheets/${id.sheet}/pdf`)
        .responseType('blob')
        .expect(200);
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('is signed with a PDF, then locked', async () => {
      const sign = () =>
        request(app.getHttpServer())
          .post(`/analysis-sheets/${id.sheet}/sign`)
          .set('Authorization', `Bearer ${token.super}`)
          .field('signatoryName', 'M. Sow')
          .field('signedAt', '2026-11-02');
      await sign().attach('file', Buffer.from('fake'), 'fiche.png').expect(400);
      const res = await sign()
        .attach('file', Buffer.from('%PDF-1.4'), 'fiche.pdf')
        .expect(201);
      expect(res.body.status).toBe('SIGNEE');
      expect(res.body.signatoryName).toBe('M. Sow');
      expect(res.body.signedDocument.originalName).toBe('fiche.pdf');

      await as('super')
        .patch(`/analysis-sheets/${id.sheet}`, { comments: 'Trop tard' })
        .expect(400);
      await as('super').delete(`/analysis-sheets/${id.sheet}`).expect(400);
    });

    it('gets a new version, its elements copied', async () => {
      const res = await as('super')
        .post(`/analysis-sheets/${id.sheet}/new-version`, {
          motif: 'Plan révisé',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'BROUILLON',
        version: '1.1',
        parentSheetId: id.sheet,
        title: 'Remise des plans de ferraillage',
      });
      expect(res.body.items[0]).toMatchObject({
        label: 'Plan R+1',
        opinion: 'AF',
      });
      expect(res.body.versions.map((v: any) => v.version)).toEqual([
        '1.0',
        '1.1',
      ]);
      expect(res.body.versions[1].motif).toBe('Plan révisé');
      // Only from the latest version.
      await as('super')
        .post(`/analysis-sheets/${id.sheet}/new-version`)
        .expect(409);
      id.sheetV2 = res.body.id;
    });

    it('lists its fiches with their counts per status', async () => {
      const res = await as('super')
        .get(`/analysis-sheets?status=SIGNEE&courrierId=${id.effet}`)
        .expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        courrierId: id.effet,
        status: 'SIGNEE',
        version: '1.0',
        title: 'Remise des plans de ferraillage',
      });
      expect(res.body.metrics.byStatus).toEqual({
        BROUILLON: 1,
        ENREGISTREE: 0,
        SIGNEE: 1,
        ARCHIVEE: 0,
      });
    });

    it('archives and restores a fiche; deletes a draft', async () => {
      const archived = await as('super')
        .post(`/analysis-sheets/${id.sheet}/archive`, { reason: 'Remplacée' })
        .expect(201);
      expect(archived.body).toMatchObject({
        status: 'ARCHIVEE',
        archiveReason: 'Remplacée',
      });
      const restored = await as('super')
        .post(`/analysis-sheets/${id.sheet}/unarchive`)
        .expect(201);
      expect(restored.body.status).toBe('SIGNEE');

      await as('super').delete(`/analysis-sheets/${id.sheetV2}`).expect(204);
    });

    it('is opened on an effet dispatched to a contract, without a dossier', async () => {
      const effet = await as('agentA')
        .post('/courriers', { direction: 'ENTRANT', subject: 'Note de calcul' })
        .expect(201);
      // Neither a dossier nor a contract yet.
      await as('super')
        .post('/analysis-sheets', { courrierId: effet.body.id, items: [] })
        .expect(400);

      await db.courrier.update({
        where: { id: effet.body.id },
        data: { contractId: id.contract },
      });
      const res = await as('super')
        .post('/analysis-sheets', {
          courrierId: effet.body.id,
          items: [{ label: 'Note de calcul', opinion: 'AF' }],
        })
        .expect(201);
      expect(res.body.dossierId).toBeNull();
      expect(res.body.contract).toMatchObject({ id: id.contract });

      const list = await as('super')
        .get(`/analysis-sheets?contractId=${id.contract}`)
        .expect(200);
      expect(list.body.data.map((s: any) => s.id)).toContain(res.body.id);
      await as('super').get(`/analysis-sheets/${res.body.id}/pdf`).expect(200);
    });

    it('dispatching transmits at once and tells its responsible', async () => {
      const effet = await as('agentA')
        .post('/courriers', { direction: 'ENTRANT', subject: 'Avis technique' })
        .expect(201);
      const { projectId } = await db.contract.findUniqueOrThrow({
        where: { id: id.contract },
      });
      const res = await as('super')
        .post(`/courriers/${effet.body.id}/dispatch`, {
          projectId,
          contractId: id.contract,
        })
        .expect(201);
      expect(res.body.status).toBe('TRANSMIS');
      expect(res.body.transmittedAt).toBeTruthy();
      expect(res.body.transmittedBy).toMatchObject({ id: id.super });
      if (res.body.ownerId && res.body.ownerId !== id.super) {
        // Notifications are written after the response (fire-and-forget).
        const notice = await eventually(
          () =>
            db.notification.findFirst({
              where: {
                courrierId: effet.body.id,
                type: 'COURRIER_TRANSMITTED',
              },
            }),
          (n) => n !== null,
        );
        expect(notice).not.toBeNull();
      }
      // No instruction yet: its dispatching can still be corrected.
      const again = await as('super')
        .post(`/courriers/${effet.body.id}/dispatch`, {
          projectId,
          contractId: id.contract,
        })
        .expect(201);
      expect(again.body.status).toBe('TRANSMIS');
    });

    it('lists the effets a fiche can be opened on', async () => {
      const transmitted = await as('agentA')
        .post('/courriers', {
          direction: 'ENTRANT',
          subject: 'Plans de coffrage',
          dossierId: id.dossier,
          transmit: true,
        })
        .expect(201);
      expect(transmitted.body.status).toBe('TRANSMIS');

      const dispatched = await as('super')
        .get('/courriers/entrants?tab=dispatched&take=100')
        .expect(200);
      const ids = dispatched.body.data.map((c: any) => c.id);
      expect(ids).toContain(transmitted.body.id);
      // Not yet dispatched, or validated: not listed.
      expect(ids).not.toContain(id.effet);
      for (const c of dispatched.body.data) {
        expect(['AFFECTE', 'TRANSMIS', 'EN_TRAITEMENT']).toContain(c.status);
      }
      expect(dispatched.body.metrics.byTab.dispatched).toBe(
        dispatched.body.total,
      );

      // Once it has its fiche in progress, it leaves the list.
      await as('super')
        .post('/analysis-sheets', {
          courrierId: transmitted.body.id,
          items: [{ label: 'Plan P1' }],
        })
        .expect(201);
      const free = await as('super')
        .get('/courriers/entrants?tab=dispatched&withoutLiveSheet=true')
        .expect(200);
      expect(free.body.data.map((c: any) => c.id)).not.toContain(
        transmitted.body.id,
      );
    });

    it('can forbid criteria outside the catalogue', async () => {
      const settings = await as('super')
        .patch('/analysis-criteria/settings', { allowCustomCriteria: false })
        .expect(200);
      expect(settings.body.allowCustomCriteria).toBe(false);
      const next = await as('super')
        .post(`/analysis-sheets/${id.sheet}/new-version`)
        .expect(201);
      await as('super')
        .put(`/analysis-sheets/items/${next.body.items[0].id}/criteria`, {
          criteria: [{ label: 'Esthétique', opinion: 'AF' }],
        })
        .expect(400);
      await as('super')
        .patch('/analysis-criteria/settings', { allowCustomCriteria: true })
        .expect(200);
      const read = await as('super')
        .get('/analysis-criteria/settings')
        .expect(200);
      expect(read.body.allowCustomCriteria).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('8. Préférences de notification', () => {
    const assignedCount = async (who: string) => {
      const inbox = await as(who).get('/notifications/me').expect(200);
      return inbox.body.filter(
        (n: any) => n.notification.type === 'TASK_ASSIGNED',
      ).length;
    };

    it('every notification is on by default', async () => {
      const res = await as('exec1')
        .get('/notifications/preferences')
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.every((p: any) => p.enabled && p.label)).toBe(true);
    });

    it('refuses an unknown type', async () => {
      await as('exec1')
        .put('/notifications/preferences', {
          preferences: [{ type: 'NOPE', enabled: false }],
        })
        .expect(400);
    });

    it('a user who turned a type off no longer receives it', async () => {
      const res = await as('exec1')
        .put('/notifications/preferences', {
          preferences: [{ type: 'TASK_ASSIGNED', enabled: false }],
        })
        .expect(200);
      expect(
        res.body.find((p: any) => p.type === 'TASK_ASSIGNED').enabled,
      ).toBe(false);

      const exec1Before = await assignedCount('exec1');
      const exec2Before = await assignedCount('exec2');
      await as('chefA')
        .post('/instructions', {
          dossierId: id.contractDossier,
          title: 'Relevé du quai',
          executantIds: [id.exec1, id.exec2],
          validateurId: id.respA,
          superviseurId: id.chefA,
          dueDate: '2026-12-15',
        })
        .expect(201);

      // Both are decided in the same notification: once exec2 has it,
      // exec1 was left out or never will be.
      await eventually(
        () => assignedCount('exec2'),
        (n: number) => n > exec2Before,
      );
      expect(await assignedCount('exec1')).toBe(exec1Before);
    });
  });

  // ---------------------------------------------------------------------------
  describe('9. Accueils', () => {
    it('keeps the platform settings, changed by a platform administrator', async () => {
      await as('chefA')
        .patch('/settings', { maxActiveInstructionsPerAgent: 3 })
        .expect(403);
      const res = await as('super')
        .patch('/settings', { maxActiveInstructionsPerAgent: 3 })
        .expect(200);
      expect(res.body.maxActiveInstructionsPerAgent).toBe(3);
      const read = await as('exec1').get('/settings').expect(200);
      expect(read.body.maxActiveInstructionsPerAgent).toBe(3);
    });

    it('reminds the executants of a task, once an hour', async () => {
      const task = await as('chefA')
        .post('/instructions', {
          dossierId: id.dossier,
          title: 'Relire la note de calcul',
          executantIds: [id.exec1],
          superviseurId: id.chefA,
        })
        .expect(201);
      await as('exec1')
        .post(`/instructions/${task.body.id}/remind`)
        .expect(403);
      const res = await as('chefA')
        .post(`/instructions/${task.body.id}/remind`)
        .expect(201);
      expect(res.body.executantIds).toEqual([id.exec1]);
      await as('chefA')
        .post(`/instructions/${task.body.id}/remind`)
        .expect(409);

      const types = await eventually(
        async () => {
          const inbox = await as('exec1').get('/notifications/me').expect(200);
          return inbox.body.map((n: any) => n.notification.type);
        },
        (t: string[]) => t.includes('TASK_REMINDER'),
      );
      expect(types).toContain('TASK_REMINDER');
    });

    it("counts each agent's instructions in progress, against the capacity", async () => {
      const res = await as('super').get('/instructions/workload').expect(200);
      expect(res.body.capacity).toBe(3);
      const exec1 = res.body.data.find((row: any) => row.user.id === id.exec1);
      expect(exec1.inProgress).toBeGreaterThan(0);
      expect(exec1).toMatchObject({ capacity: 3 });
      expect(typeof exec1.overCapacity).toBe('boolean');
    });

    it('tells who is a designated responsible, of what', async () => {
      const chef = await as('chefA').get('/auth/me').expect(200);
      expect(chef.body.isDesignatedResponsible).toBe(true);
      expect(chef.body.responsibleOf.dossiers.map((d: any) => d.id)).toContain(
        id.dossier,
      );
      const exec = await as('exec1').get('/auth/me').expect(200);
      expect(exec.body.isDesignatedResponsible).toBe(false);
    });

    it('names the actor and the object of each journal entry', async () => {
      const res = await as('super')
        .get('/activity-logs?entityType=Instruction&take=50')
        .expect(200);
      const reminded = res.body.data.find(
        (log: any) => log.action === 'INSTRUCTION_RELANCEE',
      );
      expect(reminded).toBeDefined();
      expect(reminded.actorName).toBe('chefA');
      expect(reminded.entityReference).toMatch(/^T-/);
    });

    it('gives each user their own history, without AUDIT_READ', async () => {
      await as('exec1').get('/activity-logs').expect(403);
      const res = await as('exec1')
        .get('/activity-logs/me?take=50')
        .expect(200);
      // chefA reminded exec1 of a task exec1 is on.
      const reminded = res.body.data.find(
        (log: any) => log.action === 'INSTRUCTION_RELANCEE',
      );
      expect(reminded).toMatchObject({
        actorName: 'chefA',
        entityType: 'Instruction',
      });
      expect(reminded.entityReference).toMatch(/^T-/);
      // Only business events, on an object.
      for (const log of res.body.data) {
        expect(log.entityType).toEqual(expect.any(String));
      }
      // Nothing of objects exec1 has no part in: chefA's sortant.
      expect(res.body.data.map((log: any) => log.entityId)).not.toContain(
        id.sortant,
      );

      const tasks = await as('exec1')
        .get('/activity-logs/me?entityType=Instruction&take=5')
        .expect(200);
      expect(tasks.body.take).toBe(5);
      for (const log of tasks.body.data) {
        expect(log.entityType).toBe('Instruction');
      }
    });

    it('adds the week and month comparisons to the dashboard', async () => {
      const res = await as('chefA')
        .get('/dashboard/stats?tz=Africa/Douala')
        .expect(200);
      expect(res.body.scope).toBe('mine');
      expect(res.body.incoming).toMatchObject({
        dispatched: {
          thisWeek: expect.any(Number),
          lastWeek: expect.any(Number),
        },
        inProgress: {
          current: expect.any(Number),
          lastWeek: expect.any(Number),
        },
        treatmentDelayDays: expect.any(Object),
      });

      await as('chefA').get('/dashboard/stats?scope=global').expect(403);
      const global = await as('super')
        .get('/dashboard/stats?scope=global')
        .expect(200);
      expect(global.body.scope).toBe('global');
      expect(global.body.courriers.received).toBeGreaterThanOrEqual(
        res.body.courriers.received,
      );
    });
  });
});
