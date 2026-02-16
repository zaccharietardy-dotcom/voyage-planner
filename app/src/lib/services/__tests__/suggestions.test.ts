import { inferGroupTypeFromQuery } from '../suggestions';

describe('suggestions query group inference', () => {
  it('detects family_without_kids for parent companion phrases', () => {
    expect(inferGroupTypeFromQuery('week-end à Rome avec ma mère')).toBe('family_without_kids');
    expect(inferGroupTypeFromQuery('voyage avec mon père en Suisse')).toBe('family_without_kids');
  });

  it('detects family_with_kids when children are mentioned', () => {
    expect(inferGroupTypeFromQuery('road trip avec mes enfants en Italie')).toBe('family_with_kids');
  });

  it('detects couple only for explicit romantic/couple intent', () => {
    expect(inferGroupTypeFromQuery('city break romantique en couple')).toBe('couple');
  });

  it('returns null when no companion signal is present', () => {
    expect(inferGroupTypeFromQuery('idée voyage nature en avril')).toBeNull();
  });
});
