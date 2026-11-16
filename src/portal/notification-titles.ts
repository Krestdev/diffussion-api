// Copied from diffusion-ui's app/locales/{en,fr,it}.json (notifications.types, notifications.fallback):
// the titles the bell shows, for the core's portal. Keep in step when a type is added.

export type PortalLanguage = 'en' | 'fr' | 'it';

/** Each notification type's title in en, fr and it. */
export const NOTIFICATION_TITLES: Readonly<
  Record<string, Readonly<Record<PortalLanguage, string>>>
> = {
  COURRIER_REGISTERED: {
    en: 'Item registered',
    fr: 'Effet enregistré',
    it: 'Effetto registrato',
  },
  COURRIER_DISPATCH_PROPOSED: {
    en: 'Dispatch proposed',
    fr: 'Dispatching proposé',
    it: 'Smistamento proposto',
  },
  COURRIER_DISPATCH_REJECTED: {
    en: 'Dispatch rejected',
    fr: 'Dispatching rejeté',
    it: 'Smistamento respinto',
  },
  COURRIER_TRANSMITTED: {
    en: 'Item forwarded',
    fr: 'Effet transmis',
    it: 'Effetto trasmesso',
  },
  COURRIER_SUPERVISOR_ASSIGNED: {
    en: 'Supervisor assigned',
    fr: 'Superviseur désigné',
    it: 'Supervisore designato',
  },
  COURRIER_VALIDATION_PENDING: {
    en: 'Approval awaited',
    fr: 'Approbation attendue',
    it: 'Approvazione attesa',
  },
  COURRIER_VALIDATED: {
    en: 'Release authorised',
    fr: 'Sortie autorisée',
    it: 'Uscita autorizzata',
  },
  COURRIER_CORRECTIONS_REQUESTED: {
    en: 'Correction requested',
    fr: 'Correction demandée',
    it: 'Correzione richiesta',
  },
  COURRIER_SIGNED: {
    en: 'Item signed',
    fr: 'Effet signé',
    it: 'Effetto firmato',
  },
  COURRIER_SENT: {
    en: 'Item sent to the recipient',
    fr: 'Effet transmis au destinataire',
    it: 'Effetto trasmesso al destinatario',
  },
  COURRIER_DUE_SOON: {
    en: 'Due soon',
    fr: 'Échéance proche',
    it: 'Scadenza vicina',
  },
  COURRIER_OVERDUE: {
    en: 'Overdue',
    fr: 'Échéance dépassée',
    it: 'Scadenza superata',
  },
  TASK_ASSIGNED: {
    en: 'Instruction assigned',
    fr: 'Instruction assignée',
    it: 'Istruzione assegnata',
  },
  TASK_SUBSCRIBED: {
    en: 'Instruction taken on',
    fr: 'Instruction souscrite',
    it: 'Istruzione presa in carico',
  },
  TASK_NOT_SUBSCRIBED: {
    en: 'Instruction declined',
    fr: 'Instruction non souscrite',
    it: 'Istruzione non presa in carico',
  },
  TASK_ACCEPTED: {
    en: 'Instruction accepted',
    fr: 'Instruction acceptée',
    it: 'Istruzione accettata',
  },
  TASK_AGENT_DUE_DATE_SET: {
    en: 'Due date set',
    fr: 'Échéance fixée',
    it: 'Scadenza fissata',
  },
  TASK_LIVRABLES_DEPOSITED: {
    en: 'Deliverable submitted',
    fr: 'Livrable déposé',
    it: 'Consegna depositata',
  },
  TASK_VALIDATION_PENDING: {
    en: 'Validation awaited',
    fr: 'Validation attendue',
    it: 'Convalida attesa',
  },
  TASK_LIVRABLE_REJECTED: {
    en: 'Deliverable rejected',
    fr: 'Livrable refusé',
    it: 'Consegna rifiutata',
  },
  TASK_CORRECTIONS_REQUESTED: {
    en: 'Correction requested',
    fr: 'Correction demandée',
    it: 'Correzione richiesta',
  },
  TASK_COMPLETED: {
    en: 'Instruction completed',
    fr: 'Instruction terminée',
    it: 'Istruzione completata',
  },
  TASK_DUE_SOON: {
    en: 'Due soon',
    fr: 'Échéance proche',
    it: 'Scadenza vicina',
  },
  TASK_OVERDUE: {
    en: 'Instruction overdue',
    fr: 'Instruction en retard',
    it: 'Istruzione in ritardo',
  },
  TASK_OVERDUE_AGENT: {
    en: 'Instruction overdue',
    fr: 'Instruction en retard',
    it: 'Istruzione in ritardo',
  },
  TASK_REMINDER: {
    en: 'Reminder',
    fr: 'Relance',
    it: 'Sollecito',
  },
};

/** A type without a title. */
export const NOTIFICATION_FALLBACK: Readonly<Record<PortalLanguage, string>> = {
  en: 'Notification',
  fr: 'Notification',
  it: 'Notifica',
};
