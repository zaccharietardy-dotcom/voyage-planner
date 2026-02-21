/**
 * Safe localStorage wrappers that catch errors from SSR, private browsing, or quota limits.
 */

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('[localStorage] getItem failed:', error);
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('[localStorage] setItem failed:', error);
  }
}

export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('[localStorage] removeItem failed:', error);
  }
}
