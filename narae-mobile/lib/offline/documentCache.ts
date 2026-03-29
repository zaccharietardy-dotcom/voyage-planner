import { File, Directory, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

function getDocsDir(tripId: string): Directory {
  return new Directory(Paths.document, 'narae-docs', tripId);
}

// ─── Download a document for offline ───

export async function downloadDocument(
  tripId: string,
  fileUrl: string,
  filename: string,
): Promise<string> {
  const dir = getDocsDir(tripId);
  if (!dir.exists) dir.create();

  const file = new File(dir, filename);

  // Download via fetch + write
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const text = await blob.text();
  await file.write(text);

  return file.uri;
}

// ─── Check if document is cached ───

export function isDocumentCached(tripId: string, filename: string): boolean {
  const file = new File(getDocsDir(tripId), filename);
  return file.exists;
}

// ─── Open/share a cached document ───

export async function openCachedDocument(tripId: string, filename: string): Promise<void> {
  const file = new File(getDocsDir(tripId), filename);
  if (!file.exists) throw new Error('Document not found in cache');

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
    const filename = doc.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    try {
      if (!isDocumentCached(tripId, filename)) {
        await downloadDocument(tripId, doc.fileUrl, filename);
      }
      count++;
    } catch {
      // Skip failed downloads
    }
  }
  return count;
}
