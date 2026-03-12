import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

const DEFAULT_SIGNED_URL_TTL_SEC = 900;

export interface SignedUrlEntry {
  signedUrl: string;
  expiresAt: string;
}

function getStorageServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing Supabase environment variables for media signing');
  }

  return createClient<Database>(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function signObjectUrl(
  bucket: string,
  path: string | null | undefined,
  ttlSec: number = DEFAULT_SIGNED_URL_TTL_SEC
): Promise<SignedUrlEntry | null> {
  if (!path) {
    return null;
  }

  const serviceClient = getStorageServiceClient();
  const { data, error } = await serviceClient.storage
    .from(bucket)
    .createSignedUrl(path, ttlSec);

  if (error || !data?.signedUrl) {
    console.warn(`[mediaUrl] Failed to sign object URL for ${bucket}/${path}:`, error?.message || 'No URL');
    return null;
  }

  return {
    signedUrl: data.signedUrl,
    expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
}

export async function signManyObjectUrls(
  bucket: string,
  paths: Array<string | null | undefined>,
  ttlSec: number = DEFAULT_SIGNED_URL_TTL_SEC
): Promise<Record<string, SignedUrlEntry>> {
  const uniquePaths = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (uniquePaths.length === 0) {
    return {};
  }

  const serviceClient = getStorageServiceClient();
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const result: Record<string, SignedUrlEntry> = {};

  const { data, error } = await serviceClient.storage
    .from(bucket)
    .createSignedUrls(uniquePaths, ttlSec);

  if (!error && data) {
    data.forEach((row: { path?: string | null; signedUrl?: string | null }, index: number) => {
      const rowPath = row.path || uniquePaths[index];
      if (rowPath && row.signedUrl) {
        result[rowPath] = {
          signedUrl: row.signedUrl,
          expiresAt,
        };
      }
    });
    return result;
  }

  console.warn(`[mediaUrl] Bulk signing failed for bucket "${bucket}", falling back to one-by-one signing`, error?.message || '');

  const fallbackResults = await Promise.all(
    uniquePaths.map(async (path) => {
      const signed = await signObjectUrl(bucket, path, ttlSec);
      return { path, signed };
    })
  );

  fallbackResults.forEach(({ path, signed }) => {
    if (signed) {
      result[path] = signed;
    }
  });

  return result;
}
