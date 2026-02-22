export function redactTripDataForLimitedViewer(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }

  const cloned = { ...(data as Record<string, unknown>) };
  if ('documents' in cloned) {
    delete cloned.documents;
  }
  return cloned;
}
