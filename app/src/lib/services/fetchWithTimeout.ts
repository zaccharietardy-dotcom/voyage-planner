/**
 * Fetch with explicit timeout using AbortController.
 * Wraps native fetch() to ensure all API calls have a hard deadline.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init?: RequestInit,
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(input.toString(), {
      ...init,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`API timeout after ${timeoutMs}ms: ${input.toString().substring(0, 100)}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
