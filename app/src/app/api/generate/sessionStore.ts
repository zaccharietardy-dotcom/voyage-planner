/**
 * Module-level session store for pipeline question resolvers.
 *
 * On Vercel, the Node.js worker stays alive for the full maxDuration=300
 * of the /api/generate route. A concurrent POST to /api/generate/answer
 * hits the same worker, so the Map is shared.
 */

interface PendingQuestion {
  resolve: (selectedOptionId: string, meta: { autoDefault: boolean }) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// sessionId:questionId → resolver
const pendingQuestions = new Map<string, PendingQuestion>();

export function registerQuestion(
  sessionId: string,
  questionId: string,
  resolve: (selectedOptionId: string, meta: { autoDefault: boolean }) => void,
  timeoutMs: number,
  defaultOptionId: string,
): void {
  const key = `${sessionId}:${questionId}`;

  const timeout = setTimeout(() => {
    const entry = pendingQuestions.get(key);
    if (entry) {
      entry.resolve(defaultOptionId, { autoDefault: true });
      pendingQuestions.delete(key);
    }
  }, timeoutMs);

  pendingQuestions.set(key, { resolve, timeout });
}

export function resolveQuestion(
  sessionId: string,
  questionId: string,
  selectedOptionId: string,
): boolean {
  const key = `${sessionId}:${questionId}`;
  const entry = pendingQuestions.get(key);
  if (!entry) return false;

  clearTimeout(entry.timeout);
  entry.resolve(selectedOptionId, { autoDefault: false });
  pendingQuestions.delete(key);
  return true;
}

export function cleanupSession(sessionId: string): void {
  for (const [key, entry] of pendingQuestions) {
    if (key.startsWith(`${sessionId}:`)) {
      clearTimeout(entry.timeout);
      pendingQuestions.delete(key);
    }
  }
}
