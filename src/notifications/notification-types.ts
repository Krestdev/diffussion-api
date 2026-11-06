/**
 * The notifications the server sends, each with its label. A user may turn
 * any of them off (NotificationPreference); a type outside this list (an
 * announcement posted by a platform administrator) always reaches everyone.
 * Add a type here when a service starts sending it.
 */
export const NOTIFICATION_TYPES = {
  COURRIER_TRANSMITTED: 'Un effet vous est transmis',
  COURRIER_VALIDATION_PENDING: 'Un effet attend votre validation',
  COURRIER_VALIDATED: 'Un effet que vous suivez est validé',
  COURRIER_CORRECTIONS_REQUESTED: 'Un effet que vous suivez doit être corrigé',
  COURRIER_SUPERVISOR_ASSIGNED: 'Vous êtes désigné superviseur d’un effet',
  TASK_ASSIGNED: 'Une tâche vous est affectée',
  TASK_SUBSCRIBED: 'Un exécutant a souscrit à une tâche',
  TASK_NOT_SUBSCRIBED: "Un exécutant n'a pas souscrit à une tâche",
  TASK_AGENT_DUE_DATE_SET: "La date limite d'exécution d'une tâche est fixée",
  TASK_LIVRABLES_DEPOSITED: 'Des livrables sont déposés sur une tâche',
  TASK_VALIDATION_PENDING: 'Des livrables attendent votre validation',
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
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export function isNotificationType(type: string): type is NotificationType {
  return Object.keys(NOTIFICATION_TYPES).includes(type);
}
