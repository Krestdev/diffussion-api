// The sentences of the notifications, in en, fr and it (as EXPENZO's notification-texts.ts). The
// UI dictionaries hold the same texts under notifications.bodies.<TYPE> (diffusion-ui
// app/locales/{en,fr,it}.json): keep them in step. Placeholders, filled from Notification.params:
// {number} {subject} (an effet), {title} (an instruction), {reason} {date} {actor} {count}
// {livrable} {reference} {opinion} {role} {delegant} {delegataire} {start} {end} {days}.
// `_one`: the singular sentence when {count} (or {days}) is 1. `_AGAIN`: a relaunch (params.again).

export type NotificationLanguage = 'en' | 'fr' | 'it';

type Texts = Readonly<Record<NotificationLanguage, string>>;

export const NOTIFICATION_BODIES: Readonly<Record<string, Texts>> = {
  COURRIER_REGISTERED: {
    en: 'Incoming item {number} “{subject}” has just been registered.',
    fr: 'L’effet entrant {number} « {subject} » vient d’être enregistré.',
    it: 'L’effetto in entrata {number} «{subject}» è appena stato registrato.',
  },
  COURRIER_DISPATCH_PROPOSED: {
    en: 'A dispatch of {number} “{subject}” awaits validation.',
    fr: 'Un dispatching de {number} « {subject} » attend sa validation.',
    it: 'Uno smistamento di {number} «{subject}» attende la convalida.',
  },
  COURRIER_DISPATCH_VALIDATED: {
    en: 'The dispatch proposed for {number} “{subject}” is validated.',
    fr: 'Le dispatching proposé pour {number} « {subject} » est validé.',
    it: 'Lo smistamento proposto per {number} «{subject}» è convalidato.',
  },
  COURRIER_DISPATCH_REJECTED: {
    en: 'The dispatch proposed for {number} “{subject}” was rejected: {reason}',
    fr: 'Le dispatching proposé pour {number} « {subject} » est rejeté : {reason}',
    it: 'Lo smistamento proposto per {number} «{subject}» è stato respinto: {reason}',
  },
  COURRIER_TRANSMITTED: {
    en: '{number} “{subject}” was forwarded to you.',
    fr: '{number} « {subject} » vous a été transmis.',
    it: '{number} «{subject}» ti è stato trasmesso.',
  },
  COURRIER_SUPERVISOR_ASSIGNED: {
    en: 'You were named supervisor of {number} “{subject}”.',
    fr: 'Vous avez été désigné superviseur de {number} « {subject} ».',
    it: 'Sei stato designato supervisore di {number} «{subject}».',
  },
  COURRIER_VALIDATION_PENDING: {
    en: '{number} “{subject}” awaits your approval.',
    fr: '{number} « {subject} » attend votre validation.',
    it: '{number} «{subject}» attende la tua approvazione.',
  },
  COURRIER_VALIDATED: {
    en: '{number} “{subject}” is approved: record its signature.',
    fr: '{number} « {subject} » est validé : signature à enregistrer.',
    it: '{number} «{subject}» è approvato: registra la firma.',
  },
  COURRIER_CORRECTIONS_REQUESTED: {
    en: '{number} “{subject}” must be corrected: {reason}',
    fr: '{number} « {subject} » doit être corrigé : {reason}',
    it: '{number} «{subject}» deve essere corretto: {reason}',
  },
  COURRIER_SIGNED: {
    en: '{number} “{subject}” is signed: to be sent.',
    fr: '{number} « {subject} » est signé : à transmettre.',
    it: '{number} «{subject}» è firmato: da trasmettere.',
  },
  COURRIER_SENT: {
    en: '{number} “{subject}” was sent: discharge expected.',
    fr: '{number} « {subject} » est transmis : décharge attendue.',
    it: '{number} «{subject}» è stato trasmesso: ricevuta attesa.',
  },
  COURRIER_DUE_SOON: {
    en: 'The deadline of {number} “{subject}” is on {date}.',
    fr: 'L’échéance de {number} « {subject} » arrive le {date}.',
    it: 'La scadenza di {number} «{subject}» è il {date}.',
  },
  COURRIER_OVERDUE: {
    en: 'The deadline of {number} “{subject}” has passed ({date}).',
    fr: 'L’échéance de {number} « {subject} » est dépassée ({date}).',
    it: 'La scadenza di {number} «{subject}» è superata ({date}).',
  },
  COURRIER_OVERDUE_AGAIN: {
    en: 'Reminder: the deadline of {number} “{subject}” has passed ({date}).',
    fr: 'Relance : l’échéance de {number} « {subject} » est dépassée ({date}).',
    it: 'Sollecito: la scadenza di {number} «{subject}» è superata ({date}).',
  },
  COURRIER_DISCHARGE_OVERDUE: {
    en: 'The discharge of outgoing item {number} “{subject}” was expected on {date}.',
    fr: 'La décharge de l’effet sortant {number} « {subject} » était attendue le {date}.',
    it: 'La ricevuta dell’effetto in uscita {number} «{subject}» era attesa il {date}.',
  },
  COURRIER_DISCHARGE_OVERDUE_AGAIN: {
    en: 'Reminder: the discharge of outgoing item {number} “{subject}” was expected on {date}.',
    fr: 'Relance : la décharge de l’effet sortant {number} « {subject} » était attendue le {date}.',
    it: 'Sollecito: la ricevuta dell’effetto in uscita {number} «{subject}» era attesa il {date}.',
  },
  TASK_ASSIGNED: {
    en: 'Instruction “{title}” was assigned to you.',
    fr: 'L’instruction « {title} » vous a été assignée.',
    it: 'L’istruzione «{title}» ti è stata assegnata.',
  },
  TASK_SUBSCRIBED: {
    en: '{actor} took on instruction “{title}”.',
    fr: '{actor} a souscrit à l’instruction « {title} ».',
    it: '{actor} ha preso in carico l’istruzione «{title}».',
  },
  TASK_NOT_SUBSCRIBED: {
    en: '{actor} declined instruction “{title}”: {reason}',
    fr: '{actor} ne souscrit pas à l’instruction « {title} » : {reason}',
    it: '{actor} non prende in carico l’istruzione «{title}»: {reason}',
  },
  TASK_AGENT_DUE_DATE_SET: {
    en: 'Execution deadline of instruction “{title}”: {date}.',
    fr: 'Date limite d’exécution de l’instruction « {title} » : {date}.',
    it: 'Termine di esecuzione dell’istruzione «{title}»: {date}.',
  },
  TASK_LIVRABLES_DEPOSITED: {
    en: '{actor} submitted {count} deliverables for instruction “{title}”.',
    fr: '{actor} a déposé {count} livrables pour l’instruction « {title} ».',
    it: '{actor} ha depositato {count} consegne per l’istruzione «{title}».',
  },
  TASK_LIVRABLES_DEPOSITED_one: {
    en: '{actor} submitted a deliverable for instruction “{title}”.',
    fr: '{actor} a déposé un livrable pour l’instruction « {title} ».',
    it: '{actor} ha depositato una consegna per l’istruzione «{title}».',
  },
  TASK_VALIDATION_PENDING: {
    en: 'The validator gave their opinion on “{livrable}” (instruction “{title}”): your decision.',
    fr: 'Le validateur a donné son avis sur « {livrable} » (instruction « {title} ») : à vous de décider.',
    it: 'Il validatore ha dato il suo parere su «{livrable}» (istruzione «{title}»): a te la decisione.',
  },
  TASK_LIVRABLE_REJECTED: {
    en: 'Deliverable “{livrable}” of instruction “{title}” was rejected: {reason}',
    fr: 'Le livrable « {livrable} » de l’instruction « {title} » est rejeté : {reason}',
    it: 'La consegna «{livrable}» dell’istruzione «{title}» è stata rifiutata: {reason}',
  },
  TASK_CORRECTIONS_REQUESTED: {
    en: 'Corrections are requested on instruction “{title}”: {reason}',
    fr: 'Des corrections sont demandées sur l’instruction « {title} » : {reason}',
    it: 'Sono richieste correzioni sull’istruzione «{title}»: {reason}',
  },
  TASK_COMPLETED: {
    en: 'Every deliverable of instruction “{title}” is validated: the instruction is complete.',
    fr: 'Tous les livrables de l’instruction « {title} » sont validés : l’instruction est terminée.',
    it: 'Tutte le consegne dell’istruzione «{title}» sono convalidate: l’istruzione è completata.',
  },
  TASK_OVERDUE_AGENT: {
    en: 'The execution deadline of instruction “{title}” has passed ({date}).',
    fr: 'La date limite d’exécution de l’instruction « {title} » est dépassée ({date}).',
    it: 'Il termine di esecuzione dell’istruzione «{title}» è superato ({date}).',
  },
  TASK_OVERDUE: {
    en: 'The deadline of instruction “{title}” has passed ({date}) and it is not validated.',
    fr: 'La date limite de l’instruction « {title} » est dépassée ({date}) et elle n’est pas validée.',
    it: 'La scadenza dell’istruzione «{title}» è superata ({date}) e non è convalidata.',
  },
  TASK_OVERDUE_AGAIN: {
    en: 'Reminder: the deadline of instruction “{title}” has passed ({date}).',
    fr: 'Relance : la date limite de l’instruction « {title} » est dépassée ({date}).',
    it: 'Sollecito: la scadenza dell’istruzione «{title}» è superata ({date}).',
  },
  TASK_REMINDER: {
    en: 'Reminder: instruction “{title}” awaits your action.',
    fr: 'Relance : l’instruction « {title} » attend votre action.',
    it: 'Sollecito: l’istruzione «{title}» attende una tua azione.',
  },
  TASK_DUE_SOON: {
    en: 'The deadline of instruction “{title}” is on {date}.',
    fr: 'L’échéance de l’instruction « {title} » arrive le {date}.',
    it: 'La scadenza dell’istruzione «{title}» è il {date}.',
  },
  ANALYSIS_SUBMITTED: {
    en: 'Analysis sheet {reference} (instruction “{title}”) awaits your decision.',
    fr: 'La fiche d’analyse {reference} (instruction « {title} ») attend votre décision.',
    it: 'La scheda di analisi {reference} (istruzione «{title}») attende la tua decisione.',
  },
  ANALYSIS_ACCEPTED: {
    en: 'Analysis sheet {reference} is accepted (opinion {opinion}).',
    fr: 'La fiche d’analyse {reference} est acceptée (avis {opinion}).',
    it: 'La scheda di analisi {reference} è accettata (parere {opinion}).',
  },
  ANALYSIS_REJECTED: {
    en: 'Analysis sheet {reference} is sent back (opinion {opinion}): a new version is to be written.',
    fr: 'La fiche d’analyse {reference} est renvoyée (avis {opinion}) : une nouvelle version est à rédiger.',
    it: 'La scheda di analisi {reference} è rinviata (parere {opinion}): una nuova versione è da redigere.',
  },
  DELEGATION_GRANTED: {
    en: 'The role {role} of {delegant} is delegated to {delegataire} from {start} to {end}.',
    fr: 'Le rôle {role} de {delegant} est délégué à {delegataire} du {start} au {end}.',
    it: 'Il ruolo {role} di {delegant} è delegato a {delegataire} dal {start} al {end}.',
  },
  DELEGATION_ENDED: {
    en: 'The delegation of the role {role} of {delegant} to {delegataire} has ended.',
    fr: 'La délégation du rôle {role} de {delegant} à {delegataire} a pris fin.',
    it: 'La delega del ruolo {role} di {delegant} a {delegataire} è terminata.',
  },
  REMINDER_APPROVAL_STALLED: {
    en: '{reference} “{title}” has been waiting for your decision for {days} days.',
    fr: '{reference} « {title} » attend votre décision depuis {days} jours.',
    it: '{reference} «{title}» attende la tua decisione da {days} giorni.',
  },
  REMINDER_APPROVAL_STALLED_one: {
    en: '{reference} “{title}” has been waiting for your decision for a day.',
    fr: '{reference} « {title} » attend votre décision depuis un jour.',
    it: '{reference} «{title}» attende la tua decisione da un giorno.',
  },
  DAILY_DIGEST: {
    en: '{count} items await your action.',
    fr: '{count} éléments attendent votre action.',
    it: '{count} elementi attendono una tua azione.',
  },
  DAILY_DIGEST_one: {
    en: 'One item awaits your action.',
    fr: 'Un élément attend votre action.',
    it: 'Un elemento attende una tua azione.',
  },
};

export type NotificationParams = Record<string, string>;

/** Parameters holding a day (an ISO date), written the reader's way. */
const DATE_PARAMS = new Set(['date', 'start', 'end']);

/** The params of a notification, as stored (a JSON object of strings), or null. */
export function readParams(value: unknown): NotificationParams | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
}

/** Text of a template with {param} filled in. */
export const fill = (template: string, params: NotificationParams) =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? '');

/**
 * A notification's sentence in `language`, from its params; null when it has none (older
 * notifications, announcements): its stored message is then shown.
 */
export function notificationBody(
  type: string,
  params: NotificationParams | null,
  language: NotificationLanguage,
): string | null {
  if (!params) return null;
  const count = params.count ?? params.days;
  const key =
    params.again === '1' && NOTIFICATION_BODIES[`${type}_AGAIN`]
      ? `${type}_AGAIN`
      : count === '1' && NOTIFICATION_BODIES[`${type}_one`]
        ? `${type}_one`
        : type;
  const texts = NOTIFICATION_BODIES[key];
  if (!texts) return null;
  const written = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      DATE_PARAMS.has(k) ? formatDay(v, language) : v,
    ]),
  );
  return fill(texts[language] ?? texts.en, written);
}

function formatDay(value: string, language: NotificationLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/** A day as stored in params (an ISO date, written by each reader's language), or ''. */
export const dayParam = (date: Date | null | undefined) =>
  date ? date.toISOString() : '';
