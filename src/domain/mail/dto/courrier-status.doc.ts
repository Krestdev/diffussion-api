// What each courrier status means, for the API documentation.
export const COURRIER_STATUS_DOC = [
  'Entrant: RECU (received) → ENREGISTRE (registered) → EN_ATTENTE_TRANSMISSION (its dispatching — project, contract or dossier — was proposed by someone without the dispatch permission and awaits the Dispatching corridor) → TRANSMIS (dispatched and handed to its designated responsible at once, by POST /courriers/:id/dispatch or /dispatch/validate; its dispatching can be corrected until a first instruction). AFFECTE is legacy: no effet reaches it any more → EN_TRAITEMENT (a first agent subscribed to one of its tasks) → CLOTURE (fully treated, its open instructions cancelled) → ARCHIVE.',
  'Sortant: BROUILLON (draft) → EN_ATTENTE_VALIDATION (submitted to its approver) → A_CORRIGER (sent back with a motif) or VALIDE (approved, gets its SOR-AAAA-NNNNNN reference) → SIGNE (signed scan recorded) → ENVOYE (sent under its bordereau BT-AAAA-NNNNNN) → DECHARGE (discharged bordereau back) → ARCHIVE; ARCHIVE also once cancelled. PRET_A_ENVOYER: legacy, sendable like SIGNE.',
  'Either: ANNULE (cancelled, with its reason). EN_ATTENTE is never set by the application.',
].join(' ');
