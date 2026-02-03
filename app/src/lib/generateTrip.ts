import { Trip, TripPreferences } from './types';

/**
 * Appelle /api/generate en streaming SSE.
 * Le serveur envoie des keepalive pings puis le résultat final.
 * Ceci évite les timeouts 504 sur Vercel (le stream maintient la connexion).
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

    // Parser les événements SSE (format: "data: {...}\n\n")
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || ''; // garder le reste non terminé

    for (const line of lines) {
      const dataMatch = line.match(/^data:\s*(.+)$/m);
      if (!dataMatch) continue;

      try {
        const msg = JSON.parse(dataMatch[1]);

        if (msg.status === 'generating') {
          onProgress?.(msg.status);
          continue;
        }

        if (msg.status === 'done' && msg.trip) {
          return msg.trip as Trip;
        }

        if (msg.status === 'error') {
          throw new Error(msg.error || 'Erreur de génération');
        }
      } catch (e) {
        if (e instanceof SyntaxError) {
          // JSON partiel, on continue à lire
          continue;
        }
        throw e;
      }
    }
  }

  throw new Error('Stream terminé sans résultat');
}
