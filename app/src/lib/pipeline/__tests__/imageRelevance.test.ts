import { scoreGooglePlaceCandidate } from '../services/wikimediaImages';

describe('image relevance scoring', () => {
  it('rejects mismatched monument candidate despite available photo', () => {
    const score = scoreGooglePlaceCandidate({
      queryName: 'Château des Sforza',
      candidate: {
        name: 'Duomo di Milano',
        formatted_address: 'Piazza del Duomo, Milano',
        geometry: { location: { lat: 45.4641, lng: 9.1919 } },
        photos: [{ photo_reference: 'abc' }],
      },
      latitude: 45.4707,
      longitude: 9.1795,
      destinationHint: 'Milan',
    });

    expect(score).toBeLessThan(0.5);
  });

  it('accepts strong name + geo match candidate', () => {
    const score = scoreGooglePlaceCandidate({
      queryName: 'Château des Sforza',
      candidate: {
        name: 'Château des Sforza',
        formatted_address: 'Piazza Castello, Milano',
        geometry: { location: { lat: 45.4709, lng: 9.1792 } },
        photos: [{ photo_reference: 'xyz' }],
      },
      latitude: 45.4707,
      longitude: 9.1795,
      destinationHint: 'Milan',
    });

    expect(score).toBeGreaterThan(0.7);
  });
});

