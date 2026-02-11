import { Trip, TripPreferences } from './types';

/**
 * Appelle /api/generate en streaming SSE.
 * Le serveur envoie des keepalive pings puis le résultat final.
 * Ceci évite les timeouts 504 sur Vercel (le stream maintient la connexion).
 *
 * Le message final ("done") peut être très gros (100KB+ de JSON pour un trip
 * complet) et arriver en plusieurs chunks réseau. On accumule donc le buffer
 * complet et on ne tente le parse qu'après un `\n\n` terminateur ou quand le
 * stream se ferme.
 */
export async function generateTripStream(
  preferences: Partial<TripPreferences>,
  onProgress?: (status: string) => void,
): Promise<Trip> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });

  if (!res.ok) {
    // Non-streaming error (validation, quota, etc.)
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Erreur ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';

  // Si c'est du JSON classique (fallback), le lire directement
  if (contentType.includes('application/json')) {
    return res.json();
  }

  // Lire le stream SSE
  const reader = res.body?.getReader();
  if (!reader) throw new Error('Pas de stream dans la réponse');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Essayer de traiter les événements SSE complets (terminés par \n\n)
    const result = processSSEBuffer(buffer, onProgress);
    if (result.trip) return result.trip;
    if (result.error) throw new Error(result.error);
    buffer = result.remaining;
  }

  // Stream terminé — traiter tout ce qui reste dans le buffer
  // (le serveur peut fermer le stream juste après le message final sans \n\n)
  if (buffer.trim()) {
    const result = processSSEBuffer(buffer + '\n\n', onProgress);
    if (result.trip) return result.trip;
    if (result.error) throw new Error(result.error);

    // Dernière tentative : chercher le JSON brut du trip dans le buffer
    const tripJson = extractTripJson(buffer);
    if (tripJson) return tripJson;

    console.error('[SSE] Buffer restant non parseable:', buffer.substring(0, 500));
  }

  throw new Error('Stream terminé sans résultat');
}

/**
 * Traite les événements SSE complets dans le buffer.
 * Retourne le trip si trouvé, l'erreur si trouvée, ou le buffer restant.
 */
function processSSEBuffer(
  buffer: string,
  onProgress?: (status: string) => void,
): { trip?: Trip; error?: string; remaining: string } {
  // Séparer les événements SSE par \n\n (double newline = fin d'événement)
  const parts = buffer.split('\n\n');
  const remaining = parts.pop() || ''; // dernier élément = fragment non terminé

  for (const part of parts) {
    if (!part.trim()) continue;

    // Extraire le contenu après "data: " — peut être multi-ligne
    // (SSE spec: lignes multiples "data: xxx\ndata: yyy" → concaténées)
    const dataLines: string[] = [];
    for (const line of part.split('\n')) {
      const m = line.match(/^data:\s?(.*)/);
      if (m) dataLines.push(m[1]);
    }
    if (dataLines.length === 0) continue;

    const jsonStr = dataLines.join('');

    try {
      const msg = JSON.parse(jsonStr);

      if (msg.status === 'generating') {
        onProgress?.(msg.status);
        continue;
      }

      if (msg.status === 'done' && msg.trip) {
        return { trip: msg.trip as Trip, remaining: '' };
      }

      if (msg.status === 'error') {
        return { error: msg.error || 'Erreur de génération', remaining: '' };
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        // JSON partiel ou corrompu — log et continue
        console.warn('[SSE] JSON parse failed for event, length:', jsonStr.length, 'preview:', jsonStr.substring(0, 200));
        continue;
      }
      throw e;
    }
  }

  return { remaining };
}

/**
 * Dernier recours : extraire le JSON du trip directement du buffer brut.
 * Utile si le wrapping SSE est cassé mais le JSON est présent.
 */
function extractTripJson(buffer: string): Trip | null {
  // Chercher le pattern {"status":"done","trip":{...}}
  const idx = buffer.indexOf('"trip"');
  if (idx === -1) return null;

  // Trouver le début du wrapper JSON
  const wrapStart = buffer.lastIndexOf('{', idx);
  if (wrapStart === -1) return null;

  try {
    const msg = JSON.parse(buffer.substring(wrapStart));
    if (msg.status === 'done' && msg.trip) {
      return msg.trip as Trip;
    }
  } catch {
    // Essayer de trouver juste le trip object
    const tripStart = buffer.indexOf('{', idx);
    if (tripStart === -1) return null;

    try {
      return JSON.parse(buffer.substring(tripStart)) as Trip;
    } catch {
      return null;
    }
  }

  return null;
}
