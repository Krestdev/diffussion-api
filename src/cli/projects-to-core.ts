import 'dotenv/config';
import { Client } from 'pg';
import {
  CoreState,
  DiffusionProject,
  planProjectsToCore,
} from './projects-to-core.plan';

/**
 * Moves Diffusion's own projects into the CREAPP core with the same ids (owner, 2026-11-23, as the
 * core's `npm run import:projects` did for EXPENZO): from then on the core owns them and Diffusion
 * keeps read-only copies (its directory). Diffusion's database is only read; the core's gets the
 * projects (upserted by id), Tenant.projectsSince and one audit event per company. Without
 * --apply nothing is written. Re-runnable.
 *
 * A Diffusion project whose reference a core project of the same company already has (e.g. one
 * imported from EXPENZO) is not imported: the next directory sync gives it the core project's id.
 * A company that also uses another app while the core doesn't own its projects yet is refused
 * (that app would lose the projects the core doesn't list): import that app's projects first, or
 * pass --first.
 *
 *   CORE_DATABASE_URL=… npm run projects:to-core -- [--apply] [--first]   (development)
 *   CORE_DATABASE_URL=… node dist/cli/projects-to-core.js [--apply] [--first]
 */

async function readDiffusion(url: string): Promise<DiffusionProject[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(
      // The core's columns through to_jsonb: null on a database before 20261123110000.
      `SELECT id, "companyId", name, reference, status::text AS status, "responsibleId",
              "startDate", "endDate", "createdAt",
              to_jsonb(p) ->> 'description' AS description,
              to_jsonb(p) ->> 'budget' AS budget,
              (to_jsonb(p) ->> 'coreSyncedAt')::timestamptz AS "coreSyncedAt"
         FROM "project" p ORDER BY "createdAt"`,
    );
    await client.query('ROLLBACK');
    return rows as DiffusionProject[];
  } finally {
    await client.end();
  }
}

async function readCore(
  client: Client,
  companyIds: string[],
  appId: string,
): Promise<CoreState> {
  const tenants = await client.query<{
    id: string;
    projectsSince: Date | null;
    otherApps: string[];
  }>(
    `SELECT t.id, t."projectsSince",
            COALESCE(array_agg(e."appId") FILTER (WHERE e."appId" IS NOT NULL AND e."appId" <> $2), '{}') AS "otherApps"
       FROM "Tenant" t
       LEFT JOIN "Entitlement" e ON e."tenantId" = t.id
      WHERE t.id = ANY($1)
      GROUP BY t.id, t."projectsSince"`,
    [companyIds, appId],
  );
  const users = await client.query<{ id: string; tenantId: string }>(
    `SELECT id, "tenantId" FROM "User" WHERE "tenantId" = ANY($1)`,
    [companyIds],
  );
  const projects = await client.query<{
    id: string;
    tenantId: string;
    reference: string;
  }>(
    `SELECT id, "tenantId", reference FROM "Project" WHERE "tenantId" = ANY($1)`,
    [companyIds],
  );
  return {
    tenants: tenants.rows,
    users: users.rows,
    projects: projects.rows,
  };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const first = process.argv.includes('--first');
  const diffusionUrl = process.env.DATABASE_URL;
  const coreUrl = process.env.CORE_DATABASE_URL;
  const appId = (process.env.CORE_APP_ID ?? 'diffusion').trim();
  if (!diffusionUrl || !coreUrl) {
    console.error('DATABASE_URL and CORE_DATABASE_URL must be set');
    process.exitCode = 2;
    return;
  }
  const projects = await readDiffusion(diffusionUrl);
  const companyIds = [...new Set(projects.map((p) => p.companyId))];
  const core = new Client({ connectionString: coreUrl });
  await core.connect();
  try {
    const plan = planProjectsToCore(
      projects,
      await readCore(core, companyIds, appId),
      { first },
    );
    console.log(
      `Projects ${plan.projects.length} to import in ${plan.tenantIds.length} companies, ${plan.matched.length} matched by reference`,
    );
    for (const m of plan.matched) {
      console.log(
        `  matched: ${m.reference} (Diffusion ${m.id}) takes the core's id ${m.coreId} at the next sync`,
      );
    }
    for (const warning of plan.warnings) console.log(`  warning: ${warning}`);
    for (const conflict of plan.conflicts)
      console.log(`  CONFLICT: ${conflict}`);
    if (plan.conflicts.length > 0) {
      console.log('Nothing written: resolve the conflicts first.');
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log(
        'Dry run: nothing written. Run again with --apply to import.',
      );
      return;
    }
    await core.query('BEGIN');
    try {
      for (const p of plan.projects) {
        await core.query(
          `INSERT INTO "Project" (id, "tenantId", reference, name, description, "leaderId",
                                  "startsOn", "endsOn", budget, status, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"ProjectStatus", $11, now())
           ON CONFLICT (id) DO UPDATE SET
             reference = EXCLUDED.reference, name = EXCLUDED.name,
             description = EXCLUDED.description, "leaderId" = EXCLUDED."leaderId",
             "startsOn" = EXCLUDED."startsOn", "endsOn" = EXCLUDED."endsOn",
             budget = EXCLUDED.budget, status = EXCLUDED.status, "updatedAt" = now()`,
          [
            p.id,
            p.tenantId,
            p.reference,
            p.name,
            p.description,
            p.leaderId,
            p.startsOn,
            p.endsOn,
            p.budget,
            p.status,
            p.createdAt,
          ],
        );
      }
      for (const tenantId of plan.tenantIds) {
        await core.query(
          `UPDATE "Tenant" SET "projectsSince" = now() WHERE id = $1 AND "projectsSince" IS NULL`,
          [tenantId],
        );
        await core.query(
          `INSERT INTO "AuditEvent" (id, scope, "tenantId", "actorKind", "actorLabel", action,
                                     category, "targetType", "targetId", data, at)
           VALUES (gen_random_uuid()::text, 'TENANT', $1, 'system',
                   'system (Diffusion projects-to-core command)', 'PROJECTS_IMPORTED',
                   'org', 'tenant', $1, $2::jsonb, now())`,
          [
            tenantId,
            JSON.stringify({
              app: appId,
              projects: plan.projects.filter((p) => p.tenantId === tenantId)
                .length,
            }),
          ],
        );
      }
      await core.query('COMMIT');
    } catch (error) {
      await core.query('ROLLBACK');
      throw error;
    }
    console.log(
      'Imported: the core now owns these companies’ projects; Diffusion copies them at its next directory sync.',
    );
  } finally {
    await core.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
