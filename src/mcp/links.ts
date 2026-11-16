import type { ToolLink } from './mcp-tool';

/**
 * Diffusion UI pages (diffusion-ui/app/dashboard), `{id}` replaced by the record's id. The AI
 * gateway drops a link that matches none of the UI's routes (its app-routes list).
 */
export const LINKS = {
  incoming: '/dashboard/incoming/{id}',
  outgoing: '/dashboard/outgoing/{id}',
  task: '/dashboard/tasks/{id}',
  dossier: '/dashboard/dossiers/{id}',
  contract: '/dashboard/contracts/{id}',
  project: '/dashboard/projects/{id}',
  analysisSheet: '/dashboard/analysis-sheets/{id}',
  correspondent: '/dashboard/correspondents/{id}',
  user: '/dashboard/admin/users/{id}',
} as const;

/** An effet's page: incoming or outgoing, by its direction (ENTRANT / SORTANT). */
export const EFFET_LINK: ToolLink = (record) =>
  (record.direction === 'SORTANT' ? LINKS.outgoing : LINKS.incoming).replace(
    '{id}',
    String(record.id),
  );
