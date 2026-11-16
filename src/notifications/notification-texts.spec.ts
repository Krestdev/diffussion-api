import {
  NOTIFICATION_BODIES,
  notificationBody,
  readParams,
} from './notification-texts';
import { NOTIFICATION_TYPES } from './notification-types';

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('notification texts', () => {
  it('has a sentence in en, fr and it with the same placeholders', () => {
    for (const [key, texts] of Object.entries(NOTIFICATION_BODIES)) {
      expect([key, placeholders(texts.fr)]).toEqual([
        key,
        placeholders(texts.en),
      ]);
      expect([key, placeholders(texts.it)]).toEqual([
        key,
        placeholders(texts.en),
      ]);
    }
  });

  it('writes a sentence for every type sent with params', () => {
    const withoutBody = Object.keys(NOTIFICATION_TYPES).filter(
      (type) => !NOTIFICATION_BODIES[type],
    );
    // ACCESS_CHANGED keeps the message written by its sender; ACCESS_REQUESTED is never sent.
    expect(withoutBody.sort()).toEqual(['ACCESS_CHANGED', 'ACCESS_REQUESTED']);
  });

  it("fills the reader's language, the singular for one and the relaunch", () => {
    expect(
      notificationBody(
        'COURRIER_VALIDATION_PENDING',
        { number: 'ES-1', subject: 'Offre' },
        'fr',
      ),
    ).toBe('ES-1 « Offre » attend votre validation.');
    expect(
      notificationBody(
        'REMINDER_APPROVAL_STALLED',
        { reference: 'ES-1', title: 'Offre', days: '1' },
        'en',
      ),
    ).toBe('ES-1 “Offre” has been waiting for your decision for a day.');
    expect(notificationBody('DAILY_DIGEST', { count: '4' }, 'it')).toBe(
      '4 elementi attendono una tua azione.',
    );
    expect(
      notificationBody(
        'TASK_OVERDUE',
        { title: 'Analyser', date: '2026-11-10T12:00:00.000Z', again: '1' },
        'en',
      ),
    ).toMatch(/^Reminder: the deadline of instruction “Analyser” has passed/);
  });

  it('gives null without params or for an unknown type (the message is shown)', () => {
    expect(notificationBody('TASK_ASSIGNED', null, 'en')).toBeNull();
    expect(notificationBody('ANNOUNCEMENT', { a: 'b' }, 'en')).toBeNull();
    expect(readParams(['x'])).toBeNull();
    expect(readParams({ count: 2, empty: null })).toEqual({ count: '2' });
  });
});
