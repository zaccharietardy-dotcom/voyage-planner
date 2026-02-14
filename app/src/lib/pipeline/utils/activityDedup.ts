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

function canonicalizeActivityName(name?: string | null): string {
  const normalized = normalizeText(name || '');
  if (!normalized) return '';

  const hasDuomo = /\bduomo\b/.test(normalized);
  const hasMilan = /\bmilano?\b/.test(normalized);
  const hasCathedral = /\bcathedral\b|\bcathedrale?\b|\bcathedrale\b/.test(normalized);
  if ((hasDuomo && hasMilan) || (hasCathedral && hasMilan)) {
    return 'duomo milan';
  }

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

  return normalized;
}

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

export function isDuplicateActivityCandidate(
  candidate: DedupCandidate,
  existing: DedupCandidate,
  options?: DedupOptions
): boolean {
  const cfg = { ...DEFAULT_OPTIONS, ...(options || {}) };

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

  if (candidateName === existingName) {
    if (dist === null) return true;
    return dist <= cfg.canonicalDistanceKm;
  }

  const overlap = tokenOverlapScore(candidateName, existingName);
  if (overlap >= 0.82) {
    if (dist === null) return false;
    return dist <= cfg.nearDistanceKm;
  }

  const includesMatch =
    candidateName.length >= 12 &&
    existingName.length >= 12 &&
    (candidateName.includes(existingName) || existingName.includes(candidateName));
  if (includesMatch) {
    if (dist === null) return false;
    return dist <= cfg.nearDistanceKm;
  }

  return false;
}

export function dedupeActivitiesBySimilarity<T extends DedupCandidate>(
  activities: T[],
  globalSeen: DedupCandidate[] = [],
  options?: DedupOptions
): { deduped: T[]; dropped: number; seen: DedupCandidate[] } {
  const deduped: T[] = [];
  const seen: DedupCandidate[] = [...globalSeen];
  let dropped = 0;

  for (const activity of activities) {
    const isDup = seen.some((existing) =>
      isDuplicateActivityCandidate(activity, existing, options)
    );
    if (isDup) {
      dropped++;
      continue;
    }
    deduped.push(activity);
    seen.push(activity);
  }

  return { deduped, dropped, seen };
}

