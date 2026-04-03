import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { SITE_URL } from '@/lib/constants';
import { getAuthHeaders } from './client';

function buildExportFilename() {
  const date = new Date().toISOString().slice(0, 10);
  return `narae-export-${date}.json`;
}

export async function exportAccountData(): Promise<void> {
  const response = await fetch(`${SITE_URL}/api/account`, {
    headers: await getAuthHeaders(),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Impossible d’exporter vos données');
  }

  const content = await response.text();
  const file = new File(Paths.cache, buildExportFilename());
  if (file.exists) {
    file.delete();
  }
  file.create();
  await file.write(content);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Le partage de fichier n’est pas disponible sur cet appareil');
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Exporter mes données',
  });
}

export async function deleteAccount(): Promise<void> {
  const response = await fetch(`${SITE_URL}/api/account`, {
    method: 'DELETE',
    headers: await getAuthHeaders(),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Impossible de supprimer votre compte');
  }
}
