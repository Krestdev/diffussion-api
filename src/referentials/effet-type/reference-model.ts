import { BadRequestException } from '@nestjs/common';

export const REFERENCE_SEPARATORS = ['-', '/', '.'] as const;
export const REFERENCE_COUNTER_DIGITS = [3, 4, 5, 6] as const;
export const REFERENCE_COUNTER_RESETS = ['YEARLY', 'MONTHLY', 'NEVER'] as const;
export const REFERENCE_YEAR_DIGITS = [4, 2, 0] as const;
// SERVICE is in the design but has no source yet: no service is recorded.
export const REFERENCE_CODES = [
  'PROJECT',
  'RECORD',
  'AUTHOR_INITIALS',
] as const;

export type ReferenceCode = (typeof REFERENCE_CODES)[number];

/** How the references of a type's sortants are built. */
export type ReferenceModel = {
  prefix: string;
  separator: (typeof REFERENCE_SEPARATORS)[number];
  counterDigits: (typeof REFERENCE_COUNTER_DIGITS)[number];
  counterReset: (typeof REFERENCE_COUNTER_RESETS)[number];
  yearDigits: (typeof REFERENCE_YEAR_DIGITS)[number];
  monthIncluded: boolean;
  codes: ReferenceCode[];
};

/**
 * A counter that starts over must have what changed printed next to it, or
 * the same reference comes back.
 */
export function assertReferenceModelCoherent(model: ReferenceModel) {
  if (model.counterReset !== 'NEVER' && model.yearDigits === 0) {
    throw new BadRequestException(
      "Un compteur remis à zéro doit être accompagné de l'année dans la référence",
    );
  }
  if (model.counterReset === 'MONTHLY' && !model.monthIncluded) {
    throw new BadRequestException(
      'Un compteur remis à zéro chaque mois doit être accompagné du mois dans la référence',
    );
  }
}

/** The period a counter runs over: it starts over with the next one. */
export function referencePeriod(model: ReferenceModel, now: Date) {
  const year = String(now.getFullYear());
  if (model.counterReset === 'NEVER') return 'ALL';
  if (model.counterReset === 'YEARLY') return year;
  return `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Prefix, codes, year, month, counter. */
export function formatReference(
  model: ReferenceModel,
  codes: string[],
  now: Date,
  counter: number,
) {
  const year = String(now.getFullYear());
  return [
    model.prefix,
    ...codes,
    ...(model.yearDigits ? [year.slice(-model.yearDigits)] : []),
    ...(model.monthIncluded
      ? [String(now.getMonth() + 1).padStart(2, '0')]
      : []),
    String(counter).padStart(model.counterDigits, '0'),
  ].join(model.separator);
}
