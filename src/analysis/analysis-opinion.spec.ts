import { AnalysisOpinion } from '../../generated/prisma/enums';
import { suggestItemOpinion, suggestSheetOpinion } from './analysis-opinion';

const { AF, AFR, AS, AD, NA } = AnalysisOpinion;
const crit = (...opinions: AnalysisOpinion[]) =>
  opinions.map((opinion) => ({ opinion }));
const items = (...values: (AnalysisOpinion | null)[]) =>
  values.map((opinion) => ({ opinion, suggestedOpinion: null }));

describe('suggestItemOpinion — worst criterion wins', () => {
  it('is AF when every criterion is favourable', () => {
    expect(suggestItemOpinion(crit(AF, AF, AF))).toBe(AF);
  });

  it('is AFR when the worst is a reservation', () => {
    expect(suggestItemOpinion(crit(AF, AFR, AF))).toBe(AFR);
  });

  it('is AS when one criterion suspends', () => {
    expect(suggestItemOpinion(crit(AF, AFR, AS, AF))).toBe(AS);
  });

  it('is AD as soon as one criterion is unfavourable', () => {
    expect(suggestItemOpinion(crit(AF, AD, AS))).toBe(AD);
  });

  it('ignores N/A criteria', () => {
    expect(suggestItemOpinion(crit(NA, AF, NA))).toBe(AF);
  });

  it('has nothing to suggest when there is no criterion, or all are N/A', () => {
    expect(suggestItemOpinion([])).toBeNull();
    expect(suggestItemOpinion(crit(NA, NA))).toBeNull();
  });
});

describe('suggestSheetOpinion — the delivery as a whole', () => {
  it('is AF when every element is favourable', () => {
    expect(suggestSheetOpinion(items(AF, AF, AF))).toBe(AF);
  });

  it('counts AFR as favourable', () => {
    expect(suggestSheetOpinion(items(AF, AFR, AF))).toBe(AF);
    expect(suggestSheetOpinion(items(AFR, AFR))).toBe(AF);
  });

  it('is AS when one element is suspended', () => {
    expect(suggestSheetOpinion(items(AF, AS, AF))).toBe(AS);
  });

  it('is AD as soon as ONE element is unfavourable', () => {
    expect(suggestSheetOpinion(items(AF, AD, AF))).toBe(AD);
    expect(suggestSheetOpinion(items(AS, AD, AD))).toBe(AD);
  });

  it('ignores N/A elements', () => {
    expect(suggestSheetOpinion(items(NA, AF))).toBe(AF);
  });

  it('falls back to an element own suggestion when the expert has not pronounced', () => {
    expect(
      suggestSheetOpinion([
        { opinion: null, suggestedOpinion: AS },
        { opinion: AF, suggestedOpinion: AF },
      ]),
    ).toBe(AS);
  });

  it('has nothing to suggest on an empty sheet', () => {
    expect(suggestSheetOpinion([])).toBeNull();
    expect(suggestSheetOpinion(items(null, null))).toBeNull();
  });
});
