type DedupCandidate = {
  id?: string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type ActivityDedupCandidate = DedupCandidate;

type DedupOptions = {
  nearDistanceKm?: number;
  canonicalDistanceKm?: number;
};

const DEFAULT_OPTIONS: Required<DedupOptions> = {
  nearDistanceKm: 0.35,
  canonicalDistanceKm: 2.5,
};

const STOPWORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'the', 'of', 'and', 'et', 'a', 'au',
  'di', 'del', 'della', 'dei', 'degli', 'il', 'lo', 'gli', 'una', 'un',
  'en', 'nel', 'nella', 'al', 'alla', 'da', 'dal',
]);

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// ── Landmark prefix-stripping (generic, multilingual) ─────────────────────

const LANDMARK_PREFIXES: RegExp[] = [
  /^(cathedrale?|cattedrale?|cathedral)\s+(de|di|of|du)\s+/i,
  /^(terrazza?|terrasse?|terrace)\s+(del?|di|du|of)\s+/i,
  /^(torre?|tour|tower)\s+(del?|di|du|of)\s+/i,
  /^(museo?|musee?|museum)\s+(del?|di|du|of)\s+/i,
  /^(basilica?|basilique?)\s+(di|de|of)\s+/i,
  /^(chiesa|eglise|church)\s+(di|de|of)\s+/i,
  /^(palazzo|palais|palace)\s+(di|de|of)\s+/i,
  /^(piazza|place|plaza)\s+/i,
  /^(teatro|theatre|theater)\s+(alla|del?|di|du|of)\s+/i,
  /^(pinacoteca|galerie|gallery)\s+(di|de|of)\s+/i,
  /^(fontana|fontaine|fountain)\s+(di|de|of)\s+/i,
  /^(ponte|pont|bridge)\s+(di|de|of|du)\s+/i,
  /^(parco|parc|park)\s+(di|de|of|du)\s+/i,
  /^(giardino|jardin|garden)\s+(di|de|of|du)\s+/i,
  /^(monastero|monastere|monastery)\s+(di|de|of|du)\s+/i,
];

/**
 * Strip landmark prefixes and extract core tokens (4+ chars, no stopwords).
 * E.g. "Terrazza del Duomo" → Set {"terrazza", "duomo"}
 * E.g. "Cathédrale de Milan (Duomo)" → Set {"cathedrale", "milan", "duomo"}
 */
function extractCoreLandmarkTokens(name: string): Set<string> {
  const normalized = normalizeText(name);
  // Also strip text in parentheses for a secondary set
  const withoutParens = normalized.replace(/\([^)]*\)/g, '').trim();
  const inParens = (normalized.match(/\(([^)]+)\)/g) || [])
    .map(s => s.replace(/[()]/g, '').trim());

  const allText = [withoutParens, ...inParens].join(' ');

  // Strip prefixes
  let stripped = allText;
  for (const prefix of LANDMARK_PREFIXES) {
    stripped = stripped.replace(prefix, '');
  }

  return new Set(
    stripped
      .split(/\s+/)
      .map(t => t.trim())
      .filter(t => t.length >= 4 && !STOPWORDS.has(t))
  );
}

// ── Canonical name rules (fast-path for known landmarks) ──────────────────

function canonicalizeActivityName(name?: string | null): string {
  const normalized = normalizeText(name || '');
  if (!normalized) return '';

  // Duomo: any mention of "duomo" (regardless of city qualifier)
  if (/\bduomo\b/.test(normalized)) {
    return 'duomo';
  }

  // Milan Cathedral without the word "duomo"
  const hasCathedral = /\bcathedral\b|\bcathedrale?\b/.test(normalized);
  const hasMilan = /\bmilano?\b/.test(normalized);
  if (hasCathedral && hasMilan) {
    return 'duomo';
  }

  // Last Supper / La Cène
  const hasLastSupper =
    /\blast supper\b/.test(normalized) ||
    /\bla cene\b/.test(normalized) ||
    /\bcene\b/.test(normalized) ||
    /\bcenacolo\b/.test(normalized) ||
    /\bleonard[oa]?\b/.test(normalized) ||
    /\bda vinci\b/.test(normalized);
  if (hasLastSupper) {
    return 'last supper da vinci';
  }

  // Colosseum / Colisée
  if (/\bcolosse[uo]m?\b|\bcolisee?\b/.test(normalized)) {
    return 'colosseum';
  }

  // Eiffel Tower
  if (/\beiffel\b/.test(normalized)) {
    return 'tour eiffel';
  }

  // Sagrada Familia
  if (/\bsagrada\b/.test(normalized)) {
    return 'sagrada familia';
  }

  return normalized;
}

// ── Distance calculation ──────────────────────────────────────────────────

function hasValidCoords(candidate: DedupCandidate): boolean {
  return Boolean(
    candidate.latitude &&
      candidate.longitude &&
      candidate.latitude !== 0 &&
      candidate.longitude !== 0
  );
}

function distanceKm(a: DedupCandidate, b: DedupCandidate): number | null {
  if (!hasValidCoords(a) || !hasValidCoords(b)) return null;
  const lat1 = a.latitude as number;
  const lng1 = a.longitude as number;
  const lat2 = b.latitude as number;
  const lng2 = b.longitude as number;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return 6371 * c;
}

// ── Token overlap ─────────────────────────────────────────────────────────

function tokenOverlapScore(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const token of ta) {
    if (tb.has(token)) intersection++;
  }

  return intersection / Math.max(ta.size, tb.size);
}

// ── Core duplicate detection ──────────────────────────────────────────────

export function isDuplicateActivityCandidate(
  candidate: DedupCandidate,
  existing: DedupCandidate,
  options?: DedupOptions
): boolean {
  const cfg = { ...DEFAULT_OPTIONS, ...(options || {}) };

  // Fast-path: same ID
  if (candidate.id && existing.id && candidate.id === existing.id) {
    return true;
  }

  const rawCandidateName = candidate.name || '';
  const rawExistingName = existing.name || '';
  if (!rawCandidateName || !rawExistingName) return false;

  const candidateName = canonicalizeActivityName(rawCandidateName);
  const existingName = canonicalizeActivityName(rawExistingName);
  if (!candidateName || !existingName) return false;

  const dist = distanceKm(candidate, existing);

  // Check 1: Canonical names match (e.g. both → "duomo")
  if (candidateName === existingName) {
    if (dist === null) return true;
    return dist <= cfg.canonicalDistanceKm;
  }

  // Check 2: High token overlap + proximity
  const overlap = tokenOverlapScore(candidateName, existingName);
  if (overlap >= 0.82) {
    if (dist === null) return false;
    return dist <= cfg.nearDistanceKm;
  }

  // Check 3: Substring inclusion + proximity
  const includesMatch =
    candidateName.length >= 12 &&
    existingName.length >= 12 &&
    (candidateName.includes(existingName) || existingName.includes(candidateName));
  if (includesMatch) {
    if (dist === null) return false;
    return dist <= cfg.nearDistanceKm;
  }

  // Check 4a: Ultra-close proximity (< 100m) → same physical location regardless of name.
  // Catches e.g. "Madonnina" (statue on top of Duomo) vs "Duomo Milan" which share GPS
  // coordinates but have zero token overlap and different canonical names.
  if (dist !== null && dist < 0.1) {
    return true;
  }

  // Check 4: Proximity + shared core landmark token (catches "Terrazza del Duomo" vs "Duomo Milan")
  if (dist !== null && dist <= 0.15) {
    const tokensA = extractCoreLandmarkTokens(rawCandidateName);
    const tokensB = extractCoreLandmarkTokens(rawExistingName);
    for (const t of tokensA) {
      if (t.length >= 4 && tokensB.has(t)) return true;
    }
  }

  return false;
}

// ── Batch deduplication ───────────────────────────────────────────────────

export function dedupeActivitiesBySimilarity<T extends DedupCandidate>(
  activities: T[],
  globalSeen: DedupCandidate[] = [],
  options?: DedupOptions
): { deduped: T[]; dropped: number; seen: DedupCandidate[] } {
  const deduped: T[] = [];
  const seen: DedupCandidate[] = [...globalSeen];
  let dropped = 0;

  for (const activity of activities) {
    const existingMatch = seen.find((existing) =>
      isDuplicateActivityCandidate(activity, existing, options)
    );
    if (existingMatch) {
      // Propagate mustSee flag from dropped duplicate to survivor (safety net)
      if ((activity as any).mustSee && !(existingMatch as any).mustSee) {
        (existingMatch as any).mustSee = true;
      }
      dropped++;
      continue;
    }
    deduped.push(activity);
    seen.push(activity);
  }

  return { deduped, dropped, seen };
}

// ── Experience category classification ────────────────────────────────────

const EXPERIENCE_CATEGORIES: Record<string, string[]> = {
  cooking_class: [
    'cooking class', 'cours de cuisine', 'atelier culinaire', 'atelier cuisine',
    'cooking experience', 'cooking lesson', 'lecon de cuisine',
    'cours de gnocchi', 'cours de pizza', 'cours de pasta', 'cours de pates',
    'pizza class', 'pasta class', 'gnocchi class',
    'cooking workshop', 'culinary class', 'culinary workshop',
  ],
  food_tour: [
    'food tour', 'food tasting', 'street food tour', 'degustation gastronomique',
    'gastronomic tour', 'food walk', 'tasting tour', 'culinary tour',
    'food experience tour',
  ],
  wine_tasting: [
    'wine tasting', 'degustation de vin', 'wine tour', 'oenologie',
    'wine experience', 'vineyard tour', 'visite vignoble',
  ],
  bike_tour: [
    'bike tour', 'velo tour', 'cycling tour', 'e-bike tour',
    'bicycle tour', 'balade a velo', 'tour en velo',
  ],
  boat_cruise: [
    'boat cruise', 'croisiere', 'boat tour', 'canal cruise',
    'river cruise', 'sailing tour', 'yacht tour', 'bateau',
  ],
  walking_tour: [
    'walking tour', 'visite guidee a pied', 'guided walk',
    'free tour', 'free walking tour',
  ],
};

/**
 * Classify an activity into an experiential category (cooking_class, food_tour, etc.)
 * Returns null if not a categorizable experience.
 */
export function classifyExperienceCategory(name: string): string | null {
  const text = normalizeText(name);
  for (const [cat, keywords] of Object.entries(EXPERIENCE_CATEGORIES)) {
    if (keywords.some(k => text.includes(normalizeText(k)))) return cat;
  }
  return null;
}
