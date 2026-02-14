import {
  dedupeActivitiesBySimilarity,
  isDuplicateActivityCandidate,
} from '../utils/activityDedup';

describe('activityDedup', () => {
  it('detects Duomo/Cathedrale duplicates', () => {
    const a = {
      id: 'duomo-a',
      name: 'Cathédrale de Milan (Duomo)',
      latitude: 45.4641,
      longitude: 9.1919,
    };
    const b = {
      id: 'duomo-b',
      name: 'Duomo Milan',
      latitude: 45.4650,
      longitude: 9.1908,
    };

    expect(isDuplicateActivityCandidate(a, b)).toBe(true);
  });

  it('detects Last Supper / La Cène duplicates', () => {
    const a = {
      id: 'last-supper-a',
      name: "Leonardo's Last Supper Museum",
      latitude: 45.4658,
      longitude: 9.1706,
    };
    const b = {
      id: 'last-supper-b',
      name: 'La Cène de Léonard de Vinci',
      latitude: 45.4662,
      longitude: 9.1702,
    };

    expect(isDuplicateActivityCandidate(a, b)).toBe(true);
  });

  it('keeps distinct attractions', () => {
    const a = {
      id: 'sforza',
      name: 'Château des Sforza',
      latitude: 45.4707,
      longitude: 9.1795,
    };
    const b = {
      id: 'scala',
      name: 'Teatro alla Scala',
      latitude: 45.4676,
      longitude: 9.1899,
    };

    expect(isDuplicateActivityCandidate(a, b)).toBe(false);
  });

  it('dedupes while preserving order', () => {
    const activities = [
      { id: '1', name: 'Cathédrale de Milan (Duomo)', latitude: 45.4641, longitude: 9.1919 },
      { id: '2', name: 'Duomo Milan', latitude: 45.4650, longitude: 9.1908 },
      { id: '3', name: 'Teatro alla Scala', latitude: 45.4676, longitude: 9.1899 },
    ];

    const result = dedupeActivitiesBySimilarity(activities);
    expect(result.dropped).toBe(1);
    expect(result.deduped.map((a) => a.id)).toEqual(['1', '3']);
  });
});

