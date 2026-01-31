/**
 * Transport feasibility checker
 *
 * Determines which transport modes are viable between two locations
 * based on distance, geography (islands, continents), and water crossings.
 * Purely deterministic — no API calls needed.
 */

// ---------- Types ----------

export interface FeasibilityResult {
  mode: 'plane' | 'train' | 'bus' | 'car' | 'ferry';
  feasible: boolean;
  reason?: string;
  requiresFerry?: boolean;
  warningDistance?: boolean;
}

interface Coords {
  lat: number;
  lng: number;
}

// ---------- Island definitions ----------

interface IslandGroup {
  name: string;
  cities: string[];
  ferryFromMainland: boolean;  // reachable by ferry from continent
  planeOnly?: boolean;         // too far for ferry
}

const ISLAND_GROUPS: IslandGroup[] = [
  {
    name: 'Corsica',
    cities: ['ajaccio', 'bastia', 'calvi', 'porto-vecchio', 'bonifacio', 'corte', 'corse', 'corsica'],
    ferryFromMainland: true,
  },
  {
    name: 'Sardinia',
    cities: ['cagliari', 'sassari', 'olbia', 'alghero', 'sardegna', 'sardinia'],
    ferryFromMainland: true,
  },
  {
    name: 'Sicily',
    cities: ['palermo', 'catania', 'messina', 'syracuse', 'siracusa', 'taormina', 'sicilia', 'sicily'],
    ferryFromMainland: true,
  },
  {
    name: 'Balearic Islands',
    cities: ['mallorca', 'palma de mallorca', 'palma', 'menorca', 'ibiza', 'formentera', 'balearic'],
    ferryFromMainland: true,
  },
  {
    name: 'Greek Islands',
    cities: [
      'crete', 'heraklion', 'chania', 'santorini', 'mykonos', 'rhodes',
      'corfu', 'zakynthos', 'kos', 'thira',
    ],
    ferryFromMainland: true,
  },
  {
    name: 'Canary Islands',
    cities: ['tenerife', 'gran canaria', 'las palmas', 'lanzarote', 'fuerteventura', 'canary'],
    ferryFromMainland: false,
    planeOnly: true,
  },
  {
    name: 'Madeira',
    cities: ['madeira', 'funchal'],
    ferryFromMainland: false,
    planeOnly: true,
  },
  {
    name: 'Azores',
    cities: ['azores', 'ponta delgada', 'angra do heroismo'],
    ferryFromMainland: false,
    planeOnly: true,
  },
  {
    name: 'Malta',
    cities: ['malta', 'valletta', 'gozo'],
    ferryFromMainland: true, // ferry from Sicily
  },
];

// UK cities for Chunnel / Eurostar detection
const UK_CITIES = [
  'london', 'manchester', 'birmingham', 'edinburgh', 'glasgow', 'liverpool',
  'bristol', 'leeds', 'sheffield', 'cardiff', 'belfast', 'oxford', 'cambridge',
  'brighton', 'york', 'bath', 'nottingham', 'newcastle',
];

// Eurostar-connected mainland cities
const EUROSTAR_MAINLAND = ['paris', 'brussels', 'bruxelles', 'amsterdam', 'lille', 'rotterdam'];

// ---------- Helpers ----------

function norm(city: string): string {
  return city.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function findIslandGroup(city: string): IslandGroup | null {
  const n = norm(city);
  for (const group of ISLAND_GROUPS) {
    if (group.cities.some((c) => n.includes(c) || c.includes(n))) {
      return group;
    }
  }
  return null;
}

function isUkCity(city: string): boolean {
  const n = norm(city);
  return UK_CITIES.some((c) => n.includes(c) || c.includes(n));
}

function isEurostarMainland(city: string): boolean {
  const n = norm(city);
  return EUROSTAR_MAINLAND.some((c) => n.includes(c) || c.includes(n));
}

/** Simple continent detection from coordinates */
function getContinent(coords: Coords): string {
  const { lat, lng } = coords;

  // Americas
  if (lng < -30) return 'americas';
  // Asia (east of Suez roughly)
  if (lng > 45 && lat > 0) return 'asia';
  // Africa (south of ~35N, east of Atlantic)
  if (lat < 35 && lng > -10 && lng <= 45) return 'africa';
  // Europe (default for remaining area)
  return 'europe';
}

function crossesOcean(originCoords?: Coords, destCoords?: Coords): boolean {
  if (!originCoords || !destCoords) return false;
  const c1 = getContinent(originCoords);
  const c2 = getContinent(destCoords);
  return c1 !== c2;
}

// Sicily–Messina is essentially connected via very short ferry
function isMessinaRoute(origin: string, destination: string): boolean {
  const o = norm(origin);
  const d = norm(destination);
  return (o.includes('messina') || d.includes('messina'));
}

// ---------- Main function ----------

export function checkTransportFeasibility(
  origin: string,
  destination: string,
  distance: number,
  originCoords?: Coords,
  destCoords?: Coords,
): FeasibilityResult[] {
  const results: FeasibilityResult[] = [];

  const originIsland = findIslandGroup(origin);
  const destIsland = findIslandGroup(destination);
  const oceanCrossing = crossesOcean(originCoords, destCoords);

  // Both on islands in the same group → inter-island (ferry if available)
  const isIslandRoute = !!(originIsland || destIsland);
  const bothOnSameIslandGroup = !!(originIsland && destIsland && originIsland.name === destIsland.name);
  const planeOnlyIsland = originIsland?.planeOnly || destIsland?.planeOnly;
  const ferryAvailable = isIslandRoute && !planeOnlyIsland &&
    (originIsland?.ferryFromMainland || destIsland?.ferryFromMainland || bothOnSameIslandGroup);

  // UK ↔ mainland Eurostar route
  const ukRoute = (isUkCity(origin) && !isUkCity(destination)) ||
    (!isUkCity(origin) && isUkCity(destination));
  const eurostarRoute = ukRoute && (
    (isUkCity(origin) && isEurostarMainland(destination)) ||
    (isEurostarMainland(origin) && isUkCity(destination))
  );

  // --- PLANE ---
  results.push({
    mode: 'plane',
    feasible: distance >= 100,
    reason: distance < 100 ? 'Distance too short for a flight' : undefined,
  });

  // --- Intercontinental → only plane ---
  if (oceanCrossing) {
    results.push(
      { mode: 'train', feasible: false, reason: 'Ocean crossing — flight required' },
      { mode: 'bus', feasible: false, reason: 'Ocean crossing — flight required' },
      { mode: 'car', feasible: false, reason: 'Ocean crossing — flight required' },
      { mode: 'ferry', feasible: false, reason: 'No ferry service across oceans' },
    );
    return results;
  }

  // --- Plane-only islands (Canaries, Madeira, Azores) ---
  if (planeOnlyIsland) {
    results.push(
      { mode: 'train', feasible: false, reason: `${(originIsland || destIsland)!.name} — too remote, flight only` },
      { mode: 'bus', feasible: false, reason: `${(originIsland || destIsland)!.name} — too remote, flight only` },
      { mode: 'car', feasible: false, reason: `${(originIsland || destIsland)!.name} — too remote, flight only` },
      { mode: 'ferry', feasible: false, reason: `${(originIsland || destIsland)!.name} — no mainland ferry service` },
    );
    return results;
  }

  // --- Island with ferry ---
  if (isIslandRoute && !bothOnSameIslandGroup) {
    // Train / bus not feasible to islands (no rail/road link)
    // Exception: Messina (very short strait crossing)
    const messinaException = isMessinaRoute(origin, destination);

    results.push({
      mode: 'train',
      feasible: messinaException,
      reason: messinaException ? undefined : 'No rail link to island',
      requiresFerry: messinaException,
    });

    results.push({
      mode: 'bus',
      feasible: messinaException,
      reason: messinaException ? undefined : 'No road link to island',
      requiresFerry: messinaException,
    });

    results.push({
      mode: 'car',
      feasible: ferryAvailable,
      reason: ferryAvailable ? undefined : 'No ferry service for vehicles',
      requiresFerry: ferryAvailable || undefined,
      warningDistance: ferryAvailable && distance > 1500 ? true : undefined,
    });

    results.push({
      mode: 'ferry',
      feasible: !!ferryAvailable,
      reason: ferryAvailable ? undefined : 'No ferry service on this route',
    });

    return results;
  }

  // --- UK ↔ continent ---
  if (ukRoute) {
    results.push({
      mode: 'train',
      feasible: !!eurostarRoute,
      reason: eurostarRoute ? undefined : 'No direct rail link — Eurostar only serves London↔Paris/Brussels/Amsterdam',
    });

    results.push({
      mode: 'bus',
      feasible: false,
      reason: 'No direct bus service across the Channel',
    });

    // Car via Eurotunnel shuttle
    results.push({
      mode: 'car',
      feasible: true,
      requiresFerry: true, // Eurotunnel or ferry
      warningDistance: distance > 1500 ? true : undefined,
    });

    results.push({
      mode: 'ferry',
      feasible: true, // Cross-channel ferries exist
    });

    return results;
  }

  // --- Standard mainland-to-mainland ---

  // Train
  if (distance > 2500) {
    results.push({ mode: 'train', feasible: true, warningDistance: true, reason: 'Very long train journey — consider flying' });
  } else {
    results.push({ mode: 'train', feasible: true });
  }

  // Bus
  if (distance > 2000) {
    results.push({ mode: 'bus', feasible: false, reason: 'Distance too far for bus travel' });
  } else if (distance > 1200) {
    results.push({ mode: 'bus', feasible: true, warningDistance: true });
  } else {
    results.push({ mode: 'bus', feasible: true });
  }

  // Car
  if (distance > 3000) {
    results.push({ mode: 'car', feasible: false, reason: 'Distance too far to drive' });
  } else if (distance > 1500) {
    results.push({ mode: 'car', feasible: true, warningDistance: true });
  } else {
    results.push({ mode: 'car', feasible: true });
  }

  // Ferry — not applicable mainland-to-mainland
  results.push({ mode: 'ferry', feasible: false, reason: 'No ferry needed for mainland route' });

  return results;
}
