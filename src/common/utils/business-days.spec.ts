import { addDelay } from './business-days';

describe('addDelay', () => {
  // Friday 2026-11-06.
  const friday = new Date('2026-11-06T15:30:00Z');

  it('counts calendar days', () => {
    expect(addDelay(friday, 10, false)).toEqual(new Date('2026-11-16'));
  });

  it('skips weekends with business days only', () => {
    // Mon 9 … Fri 13 (5), Mon 16 … Fri 20 (10).
    expect(addDelay(friday, 10, true)).toEqual(new Date('2026-11-20'));
    expect(addDelay(friday, 1, true)).toEqual(new Date('2026-11-09'));
  });

  it('never lands on a weekend', () => {
    const saturday = new Date('2026-11-07T09:00:00Z');
    expect(addDelay(saturday, 0, true)).toEqual(new Date('2026-11-09'));
  });
});
