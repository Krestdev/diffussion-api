import { AnalysisOpinion } from '../../generated/prisma/enums';

/**
 * Severity order of the 5-value scale. NA sits outside it: "non applicable"
 * never counts for or against anything.
 */
const SEVERITY: Record<AnalysisOpinion, number> = {
  [AnalysisOpinion.NA]: 0,
  [AnalysisOpinion.AF]: 1,
  [AnalysisOpinion.AFR]: 2,
  [AnalysisOpinion.AS]: 3,
  [AnalysisOpinion.AD]: 4,
};

/**
 * Proposal for one element, from its own criteria: the most severe criterion
 * wins. Returns null when there is nothing to judge (no criteria, or all NA)
 * — the expert then has nothing to be suggested.
 *
 * This is only ever a suggestion: the person in charge of the fiche gives the
 * element its final `opinion` (spec §9 — the system proposes, it does not
 * decide).
 */
export function suggestItemOpinion(
  criteria: { opinion: AnalysisOpinion }[],
): AnalysisOpinion | null {
  const graded = criteria.filter((c) => c.opinion !== AnalysisOpinion.NA);
  if (graded.length === 0) return null;
  return graded.reduce((worst, c) =>
    SEVERITY[c.opinion] > SEVERITY[worst.opinion] ? c : worst,
  ).opinion;
}

/**
 * Proposal for the whole delivery, from its elements (spec §7, as confirmed):
 *
 *   - AD  as soon as ONE element is défavorable
 *   - AS  otherwise, as soon as one is suspendu
 *   - AF  otherwise (AF and AFR both count as favourable)
 *
 * An element with no pronounced opinion falls back to its own suggestion; NA
 * elements are ignored. Null when there is nothing to conclude from.
 */
export function suggestSheetOpinion(
  items: {
    opinion: AnalysisOpinion | null;
    suggestedOpinion: AnalysisOpinion | null;
  }[],
): AnalysisOpinion | null {
  const effective = items
    .map((item) => item.opinion ?? item.suggestedOpinion)
    .filter(
      (opinion): opinion is AnalysisOpinion =>
        opinion !== null && opinion !== AnalysisOpinion.NA,
    );
  if (effective.length === 0) return null;
  if (effective.includes(AnalysisOpinion.AD)) return AnalysisOpinion.AD;
  if (effective.includes(AnalysisOpinion.AS)) return AnalysisOpinion.AS;
  return AnalysisOpinion.AF;
}
