/**
 * The notifications the server sends, each with its label. A user may turn
 * any of them off (NotificationPreference); a type outside this list (an
 * announcement posted by a platform administrator) always reaches everyone.
 * Add a type here when a service starts sending it. ACCESS_REQUESTED is the
 * one exception: it is listed for the settings, but no request-for-access
 * feature exists yet to send it.
 */
export const NOTIFICATION_TYPES = {
  COURRIER_TRANSMITTED: 'Un effet vous est transmis',
  COURRIER_VALIDATION_PENDING: 'Un effet attend votre validation',
  COURRIER_VALIDATED: 'Un effet que vous suivez est validé',
  COURRIER_SIGNED: 'Un effet sortant signé est à transmettre',
  COURRIER_SENT: 'Un effet sortant est transmis, décharge attendue',
  COURRIER_CORRECTIONS_REQUESTED: 'Un effet que vous suivez doit être corrigé',
  COURRIER_SUPERVISOR_ASSIGNED: 'Vous êtes désigné superviseur d’un effet',
  TASK_ASSIGNED: 'Une tâche vous est affectée',
  TASK_SUBSCRIBED: 'Un exécutant a souscrit à une tâche',
  TASK_NOT_SUBSCRIBED: "Un exécutant n'a pas souscrit à une tâche",
  TASK_AGENT_DUE_DATE_SET: "La date limite d'exécution d'une tâche est fixée",
  TASK_LIVRABLES_DEPOSITED: 'Des livrables sont déposés sur une tâche',
  TASK_VALIDATION_PENDING: 'Des livrables attendent votre validation',
  TASK_LIVRABLE_REJECTED: 'Un livrable est rejeté',
  TASK_CORRECTIONS_REQUESTED: 'Des corrections sont demandées sur une tâche',
  TASK_COMPLETED: 'Une tâche est terminée',
  TASK_OVERDUE_AGENT: "La date limite d'exécution d'une tâche est dépassée",
  TASK_OVERDUE: "La date limite d'une tâche est dépassée",
  TASK_REMINDER: 'Une tâche fait l’objet d’une relance',
  // PA·8 — rappels et relances automatiques.
  TASK_DUE_SOON: "L'échéance d'une tâche approche",
  COURRIER_DUE_SOON: "L'échéance d'un effet approche",
  COURRIER_OVERDUE: "L'échéance d'un effet est dépassée",
  COURRIER_DISCHARGE_OVERDUE: "La décharge d'un effet sortant est en retard",
  COURRIER_REGISTERED: 'Un effet entrant est enregistré',
  COURRIER_DISPATCH_PROPOSED: 'Un dispatching est proposé',
  COURRIER_DISPATCH_VALIDATED:
    'Le validateur a donné son avis sur un dispatching',
  ACCESS_CHANGED:
    "Un rôle est attribué ou retiré, ou un ajout à une liste d'autorisés",
  ACCESS_REQUESTED: "Une demande d'accès est reçue",
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

/** Who each event reaches. Nobody is told about their own action. */
export const NOTIFICATION_DESCRIPTIONS: Record<NotificationType, string> = {
  COURRIER_TRANSMITTED:
    "Le responsable désigné de l'effet, sinon le validateur de son dossier ou de son contrat.",
  COURRIER_VALIDATION_PENDING: "Le validateur de l'effet sortant.",
  COURRIER_VALIDATED: "L'auteur de l'effet et son responsable désigné.",
  COURRIER_SIGNED: "L'auteur de l'effet et celui qui l'a approuvé.",
  COURRIER_SENT: "L'auteur de l'effet.",
  COURRIER_CORRECTIONS_REQUESTED:
    "L'auteur de l'effet et son responsable désigné.",
  COURRIER_SUPERVISOR_ASSIGNED: 'Le superviseur désigné.',
  TASK_ASSIGNED: 'Les personnes affectées à la tâche.',
  TASK_SUBSCRIBED: 'Le créateur de la tâche et ses superviseurs.',
  TASK_NOT_SUBSCRIBED: 'Les superviseurs de la tâche, sinon son créateur.',
  TASK_AGENT_DUE_DATE_SET: 'Les exécutants de la tâche.',
  TASK_LIVRABLES_DEPOSITED:
    'Le validateur de la tâche, sinon celui qui décide.',
  TASK_VALIDATION_PENDING: 'Celui qui décide de la validation des livrables.',
  TASK_LIVRABLE_REJECTED: 'Toutes les personnes affectées à la tâche.',
  TASK_CORRECTIONS_REQUESTED: 'Toutes les personnes affectées à la tâche.',
  TASK_COMPLETED: 'Toutes les personnes affectées à la tâche.',
  TASK_OVERDUE_AGENT: 'Toutes les personnes affectées à la tâche.',
  TASK_OVERDUE:
    "Les superviseurs et le créateur de la tâche, et le responsable désigné de l'effet si le site l'a activé.",
  TASK_REMINDER: 'Les exécutants de la tâche.',
  TASK_DUE_SOON: 'Les personnes affectées à la tâche, hors validateurs.',
  COURRIER_DUE_SOON:
    "Le superviseur de l'effet, sinon son responsable désigné, et l'auteur d'un sortant.",
  COURRIER_OVERDUE:
    "Le superviseur de l'effet, sinon son responsable désigné, l'auteur d'un sortant, et le responsable désigné si le site l'a activé.",
  COURRIER_DISCHARGE_OVERDUE:
    "L'auteur de l'effet, celui qui l'a transmis, et le responsable désigné si le site l'a activé.",
  COURRIER_REGISTERED:
    "Les personnes pouvant dispatcher ou valider un dispatching sur le site de l'effet.",
  COURRIER_DISPATCH_PROPOSED:
    "Les personnes pouvant dispatcher ou valider un dispatching sur le site de l'effet.",
  COURRIER_DISPATCH_VALIDATED: 'La personne qui a proposé le dispatching.',
  ACCESS_CHANGED: "L'utilisateur concerné.",
  ACCESS_REQUESTED: 'Les administrateurs du site.',
};

export function isNotificationType(type: string): type is NotificationType {
  return Object.keys(NOTIFICATION_TYPES).includes(type);
}
