import { isViatorLowRelevanceCandidate, scoreViatorPlusValue } from '../viator';

describe('viator quality scoring', () => {
  it('gives strong plus-value score to high-quality guided entries', () => {
    const assessment = scoreViatorPlusValue({
      title: 'Louvre Museum Skip the Line Guided Tour',
      description: 'Small group expert guide with priority access',
      rating: 4.8,
      reviewCount: 2400,
      price: 89,
      freeCancellation: true,
      instantConfirmation: true,
    });

    expect(assessment.score).toBeGreaterThanOrEqual(4);
    expect(assessment.reasons).toContain('has_clear_operational_benefit');
  });

  it('flags photoshoot-style activities as low relevance', () => {
    expect(
      isViatorLowRelevanceCandidate(
        'Private Eiffel Tower Photoshoot',
        'Professional photographer for social media session'
      )
    ).toBe(true);

    const assessment = scoreViatorPlusValue({
      title: 'Private Eiffel Tower Photoshoot',
      description: 'Professional photographer and social media reels',
      rating: 4.2,
      reviewCount: 19,
      price: 160,
    });

    expect(assessment.score).toBeLessThan(0);
    expect(assessment.reasons).toContain('low_relevance_pattern');
  });
});

