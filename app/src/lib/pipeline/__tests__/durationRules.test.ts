import { getMinDuration, getMaxDuration, estimateActivityCost } from '../utils/constants';

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

  // Theme parks
  it('enforces Disneyland minimum at 300 minutes (5h)', () => {
    expect(getMinDuration('Tokyo Disneyland', 'attraction')).toBe(300);
  });

  it('enforces DisneySea minimum at 300 minutes', () => {
    expect(getMinDuration('Tokyo DisneySea', 'theme_park')).toBe(300);
  });

  it('enforces Universal Studios minimum at 300 minutes', () => {
    expect(getMinDuration('Universal Studios Japan', 'attraction')).toBe(300);
  });

  // Immersive / digital art
  it('enforces teamLab minimum at 90 minutes', () => {
    expect(getMinDuration('teamLab Borderless', 'attraction')).toBe(90);
  });

  it('enforces Atelier des Lumières minimum at 90 minutes', () => {
    expect(getMinDuration('Atelier des Lumières', 'culture')).toBe(90);
  });

  // Observation decks
  it('enforces Tokyo Skytree minimum at 60 minutes', () => {
    expect(getMinDuration('Tokyo Skytree', 'attraction')).toBe(60);
  });

  it('enforces Shibuya Sky minimum at 60 minutes', () => {
    expect(getMinDuration('Shibuya Sky', 'observation')).toBe(60);
  });

  it('enforces Tokyo Tower minimum at 60 minutes', () => {
    expect(getMinDuration('Tokyo Tower', 'attraction')).toBe(60);
  });

  it('enforces Burj Khalifa minimum at 60 minutes', () => {
    expect(getMinDuration('Burj Khalifa', 'attraction')).toBe(60);
  });

  // Quick activities: max-duration caps
  it('caps statues at max 30 minutes', () => {
    expect(getMaxDuration('Statue of Hachiko', 'monument')).toBe(30);
  });

  it('caps fountains at max 30 minutes', () => {
    expect(getMaxDuration('Fontaine de Trevi', 'attraction')).toBe(30);
  });

  it('caps viewpoints at max 45 minutes', () => {
    expect(getMaxDuration('Viewpoint Montmartre', 'attraction')).toBe(45);
  });

  it('caps museums at 150 minutes max', () => {
    expect(getMaxDuration('Musée du Louvre', 'museum')).toBe(150);
  });

  it('caps towers at 90 minutes for observation towers', () => {
    expect(getMaxDuration('Tour Eiffel', 'attraction')).toBe(90);
  });

  it('caps basilicas at 60 minutes', () => {
    expect(getMaxDuration('Basilique du Sacré-Cœur', 'church')).toBe(60);
  });

  it('caps cathedrals at 75 minutes', () => {
    expect(getMaxDuration('Cathédrale Notre-Dame', 'church')).toBe(75);
  });

  it('caps palaces at 120 minutes', () => {
    expect(getMaxDuration('Palais de Versailles', 'palace')).toBe(120);
  });

  it('caps parks at 90 minutes', () => {
    expect(getMaxDuration('Jardin du Luxembourg', 'park')).toBe(90);
  });
});

describe('estimateActivityCost', () => {
  // Theme parks
  it('estimates Disneyland at ~80 EUR', () => {
    expect(estimateActivityCost('Tokyo Disneyland')).toBe(80);
  });

  it('estimates Universal Studios at ~80 EUR', () => {
    expect(estimateActivityCost('Universal Studios Japan')).toBe(80);
  });

  // Immersive art
  it('estimates teamLab at ~25 EUR', () => {
    expect(estimateActivityCost('teamLab Borderless')).toBe(25);
  });

  // Major named museums
  it('estimates Louvre at ~20 EUR', () => {
    expect(estimateActivityCost('Musée du Louvre', 'museum')).toBe(20);
  });

  it('estimates Vatican Museums at ~20 EUR', () => {
    expect(estimateActivityCost('Musées du Vatican', 'museum')).toBe(20);
  });

  // Observation decks
  it('estimates Tokyo Skytree at ~18 EUR', () => {
    expect(estimateActivityCost('Tokyo Skytree', 'attraction')).toBe(18);
  });

  it('estimates Eiffel Tower at ~18 EUR', () => {
    expect(estimateActivityCost('Tour Eiffel', 'attraction')).toBe(18);
  });

  // Generic museums
  it('estimates generic museum at ~12 EUR', () => {
    expect(estimateActivityCost('Petit musée local', 'museum')).toBe(12);
  });

  // Palaces
  it('estimates palaces at ~10 EUR', () => {
    expect(estimateActivityCost('Château de Versailles', 'palace')).toBe(10);
  });

  // Free activities
  it('estimates parks as free', () => {
    expect(estimateActivityCost('Ueno Park', 'park')).toBe(0);
  });

  it('estimates statues as free', () => {
    expect(estimateActivityCost('Statue of Hachiko', 'monument')).toBe(0);
  });

  it('estimates churches as free', () => {
    expect(estimateActivityCost('Église Saint-Sulpice', 'church')).toBe(0);
  });

  it('estimates unknown activities as free by default', () => {
    expect(estimateActivityCost('Random Walk', 'other')).toBe(0);
  });
});
