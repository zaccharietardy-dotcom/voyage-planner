import { getMinDuration } from '../utils/constants';

describe('pipeline minimum duration rules', () => {
  it('enforces Louvre floor above generic museum floor', () => {
    expect(getMinDuration('Musée du Louvre', 'museum')).toBe(150);
  });

  it('enforces Vatican floor for major complex visits', () => {
    expect(getMinDuration('Musées du Vatican', 'museum')).toBe(180);
  });

  it('keeps generic museum minimum at 60 minutes', () => {
    expect(getMinDuration('Petit musée local', 'museum')).toBe(60);
  });
});
