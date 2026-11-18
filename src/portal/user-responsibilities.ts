import type { PortalItemKey } from './portal.service';

/** Contract C9: what a person still holds in Diffusion, which the core shows before deleting them. */
export type ResponsibilityKind =
  | 'APPROVER'
  | 'SIGNATORY'
  | 'VALIDATOR'
  | 'PENDING_ITEMS'
  | 'DELEGATION'
  | 'OTHER';

export interface ResponsibilityItem {
  kind: ResponsibilityKind;
  /** Ready to show (French), e.g. « Responsable de 2 dossiers ouverts (…) ». */
  label: string;
  count: number;
  /** Where the administrator reassigns it in Diffusion (the core prefixes the app's address). */
  href?: string;
}

export interface ResponsibilityFacts {
  /** Open dossiers they answer for: they validate their outgoing effets. */
  dossiers: number;
  /** Active contracts they answer for (outgoing effets of their dossiers without a responsible). */
  contracts: number;
  /** Open projects Diffusion owns (made before the core owned projects) they answer for. */
  projects: number;
  /** They answer for the company: its outgoing effets without another validator. */
  companyResponsible: boolean;
  /** Open instructions where they hold each role. */
  instructions: { supervisor: number; validator: number; executant: number };
  /** Entrant effets in progress they supervise or were handed. */
  incoming: number;
  /** Analysis sheets naming them as validator, not decided yet. */
  analysisSheets: number;
  /** What waits for them by name in À traiter (NAMED_KINDS; zero counts ignored). */
  pending: { key: PortalItemKey; count: number }[];
  /** Role delegations running now or planned. */
  delegations: {
    side: 'HOLDER' | 'SUBSTITUTE';
    /** The other person of the delegation. */
    other: string;
    role: string;
    startsAt: Date;
    endsAt: Date;
  }[];
  now: Date;
}

/**
 * The kinds of À traiter that name the person (owner, 2026-11-18: only work that names the person
 * blocks the deletion): effets they own or supervise, instructions they are assigned to,
 * livrables waiting for their opinion or decision, outgoing effets they answer for, wrote or
 * approved. Left out, because any holder of the right may handle them: incoming effets to
 * dispatch (incomingToDispatch) and dispatchings to validate (dispatchToValidate).
 */
export const NAMED_KINDS: readonly PortalItemKey[] = [
  'incomingToHandle',
  'tasksToSubscribe',
  'tasksToDeliver',
  'tasksToReassign',
  'livrablesToReview',
  'outgoingToValidate',
  'outgoingToCorrect',
  'outgoingToSend',
  'outgoingToDischarge',
];

/** Singular and plural of each kind of waiting work. */
const PENDING: Record<PortalItemKey, { one: string; many: string }> = {
  incomingToDispatch: {
    one: 'effet entrant à dispatcher',
    many: 'effets entrants à dispatcher',
  },
  dispatchToValidate: {
    one: 'dispatching à valider',
    many: 'dispatchings à valider',
  },
  incomingToHandle: {
    one: 'effet entrant à traiter',
    many: 'effets entrants à traiter',
  },
  tasksToSubscribe: {
    one: 'tâche à souscrire',
    many: 'tâches à souscrire',
  },
  tasksToDeliver: { one: 'tâche à livrer', many: 'tâches à livrer' },
  tasksToReassign: {
    one: 'tâche à réaffecter',
    many: 'tâches à réaffecter',
  },
  livrablesToReview: {
    one: 'livrable à examiner',
    many: 'livrables à examiner',
  },
  outgoingToValidate: {
    one: 'effet sortant à valider',
    many: 'effets sortants à valider',
  },
  outgoingToCorrect: {
    one: 'effet sortant à corriger',
    many: 'effets sortants à corriger',
  },
  outgoingToSend: {
    one: 'effet sortant à envoyer',
    many: 'effets sortants à envoyer',
  },
  outgoingToDischarge: {
    one: 'décharge à enregistrer',
    many: 'décharges à enregistrer',
  },
};

/** « 1 dossier », « 2 dossiers ». */
const plural = (count: number, one: string, many: string) =>
  `${count} ${count > 1 ? many : one}`;

/** « 30/11/2026 », in the companies' time zone (Douala). */
export function frenchDay(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Africa/Douala',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/**
 * The live responsibilities that keep the core from deleting a person (C9), each a ready-to-show
 * French fragment. Empty: nothing in Diffusion blocks the deletion.
 */
export function responsibilityItems(
  facts: ResponsibilityFacts,
): ResponsibilityItem[] {
  const items: ResponsibilityItem[] = [];

  if (facts.dossiers > 0) {
    items.push({
      kind: 'VALIDATOR',
      label: `Responsable de ${plural(facts.dossiers, 'dossier ouvert', 'dossiers ouverts')} (valide leurs effets sortants)`,
      count: facts.dossiers,
      href: '/dashboard/dossiers',
    });
  }
  if (facts.contracts > 0) {
    items.push({
      kind: 'VALIDATOR',
      label: `Responsable de ${plural(facts.contracts, 'contrat actif', 'contrats actifs')} (valide leurs effets sortants)`,
      count: facts.contracts,
      href: '/dashboard/contracts',
    });
  }
  if (facts.companyResponsible) {
    items.push({
      kind: 'VALIDATOR',
      label:
        'Responsable de la société (valide les effets sortants sans autre responsable)',
      count: 1,
    });
  }
  if (facts.instructions.supervisor > 0) {
    const n = facts.instructions.supervisor;
    items.push({
      kind: 'VALIDATOR',
      label: `Superviseur de ${plural(n, 'tâche en cours', 'tâches en cours')} (décide de leurs livrables)`,
      count: n,
      href: '/dashboard/tasks?tab=instructions',
    });
  }
  if (facts.instructions.validator > 0) {
    const n = facts.instructions.validator;
    items.push({
      kind: 'VALIDATOR',
      label: `Validateur de ${plural(n, 'tâche en cours', 'tâches en cours')} (donne son avis sur leurs livrables)`,
      count: n,
      href: '/dashboard/tasks?tab=instructions',
    });
  }
  if (facts.analysisSheets > 0) {
    const n = facts.analysisSheets;
    items.push({
      kind: 'VALIDATOR',
      label: `Validateur nommé sur ${plural(n, "fiche d'analyse", "fiches d'analyse")} en attente de décision`,
      count: n,
      href: '/dashboard/analysis-sheets',
    });
  }

  const pending = facts.pending.filter((p) => p.count > 0);
  if (pending.length) {
    const total = pending.reduce((sum, p) => sum + p.count, 0);
    items.push({
      kind: 'PENDING_ITEMS',
      label: `${plural(total, 'élément', 'éléments')} à son nom en attente dans À traiter (${pending
        .map((p) => plural(p.count, PENDING[p.key].one, PENDING[p.key].many))
        .join(', ')})`,
      count: total,
      href: '/dashboard/tasks',
    });
  }

  for (const delegation of [...facts.delegations].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  )) {
    const role = delegation.side === 'SUBSTITUTE' ? 'Suppléant' : 'Titulaire';
    const other =
      delegation.side === 'SUBSTITUTE'
        ? `titulaire : ${delegation.other}`
        : `suppléant : ${delegation.other}`;
    const period =
      delegation.startsAt <= facts.now
        ? `active jusqu'au ${frenchDay(delegation.endsAt)}`
        : `à venir du ${frenchDay(delegation.startsAt)} au ${frenchDay(delegation.endsAt)}`;
    items.push({
      kind: 'DELEGATION',
      label: `${role} d'une délégation ${period} (rôle ${delegation.role}, ${other})`,
      count: 1,
    });
  }

  if (facts.projects > 0) {
    items.push({
      kind: 'OTHER',
      label: `Responsable de ${plural(facts.projects, 'projet ouvert', 'projets ouverts')} de Diffusion`,
      count: facts.projects,
      href: '/dashboard/projects',
    });
  }
  if (facts.instructions.executant > 0) {
    const n = facts.instructions.executant;
    items.push({
      kind: 'OTHER',
      label: `Exécutant de ${plural(n, 'tâche en cours', 'tâches en cours')}`,
      count: n,
      href: '/dashboard/tasks?tab=instructions',
    });
  }
  if (facts.incoming > 0) {
    const n = facts.incoming;
    items.push({
      kind: 'OTHER',
      label: `Superviseur ou responsable de ${plural(n, 'effet entrant en cours', 'effets entrants en cours')}`,
      count: n,
      href: '/dashboard/incoming',
    });
  }

  return items;
}
