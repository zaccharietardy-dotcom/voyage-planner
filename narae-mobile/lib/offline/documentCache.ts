import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DOCS_INDEX_PREFIX = '@narae/docs/';

// ─── Track cached documents via AsyncStorage (metadata) ───
// Actual files stored via expo-file-system File API

function getDocDir(tripId: string): Directory {
  return new Directory(Paths.cache, 'narae-docs', tripId);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ─── Download a document for offline ───

export async function downloadDocument(
  tripId: string,
  fileUrl: string,
  filename: string,
): Promise<string> {
  const safeName = sanitizeFilename(filename);

  try {
    const dir = getDocDir(tripId);
    // Ensure directory exists by creating it (ignore if already exists)
    try { dir.create(); } catch { /* already exists */ }

    const file = new File(dir, safeName);

    // Download content
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const content = await res.text();
    await file.write(content);

    // Track in metadata
    const metaKey = `${DOCS_INDEX_PREFIX}${tripId}`;
    const existing = await AsyncStorage.getItem(metaKey);
    const docs: string[] = existing ? JSON.parse(existing) : [];
    if (!docs.includes(safeName)) {
      docs.push(safeName);
      await AsyncStorage.setItem(metaKey, JSON.stringify(docs));
    }

    return file.uri;
  } catch (e) {
    throw new Error(`Failed to cache document: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}

// ─── Check if document is cached (via metadata) ───

export async function isDocumentCached(tripId: string, filename: string): Promise<boolean> {
  const safeName = sanitizeFilename(filename);
  const metaKey = `${DOCS_INDEX_PREFIX}${tripId}`;
  const existing = await AsyncStorage.getItem(metaKey);
  if (!existing) return false;
  const docs: string[] = JSON.parse(existing);
  return docs.includes(safeName);
}

// ─── Open/share a cached document ───

export async function openCachedDocument(tripId: string, filename: string): Promise<void> {
  const safeName = sanitizeFilename(filename);
  const file = new File(getDocDir(tripId), safeName);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri);
  }
}

// ─── Download all documents for a trip ───

export async function downloadAllDocuments(
  tripId: string,
  documents: Array<{ fileUrl?: string; name: string }>,
): Promise<number> {
  let count = 0;
  for (const doc of documents) {
    if (!doc.fileUrl) continue;
    try {
      const cached = await isDocumentCached(tripId, doc.name);
      if (!cached) {
        await downloadDocument(tripId, doc.fileUrl, doc.name);
      }
      count++;
    } catch {
      // Skip failed downloads silently
    }
  }
  return count;
}

// ─── Get list of cached docs for a trip ───

export async function getCachedDocumentList(tripId: string): Promise<string[]> {
  const metaKey = `${DOCS_INDEX_PREFIX}${tripId}`;
  const existing = await AsyncStorage.getItem(metaKey);
  return existing ? JSON.parse(existing) : [];
}
