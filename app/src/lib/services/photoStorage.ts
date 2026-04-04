/**
 * Download trip photos from Google Places proxy and persist them in Supabase Storage.
 * Replaces relative proxy URLs (/api/place-photo?...) with permanent Supabase public URLs.
 */
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'trip-photos';
const CONCURRENCY = 5;
const DOWNLOAD_TIMEOUT = 8_000;

function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://naraevoyage.com';
}

/** Hash a string to a short hex for file naming */
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}

async function downloadPhoto(proxyUrl: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  const fullUrl = proxyUrl.startsWith('/') ? `${getSiteUrl()}${proxyUrl}` : proxyUrl;
  try {
    const res = await fetch(fullUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 1000) return null; // too small, probably error
    return { buffer, contentType };
  } catch {
    return null;
  }
}

async function uploadToStorage(
  supabase: ReturnType<typeof getStorageClient>,
  tripId: string,
  photoId: string,
  buffer: ArrayBuffer,
  contentType: string,
): Promise<string | null> {
  const ext = contentType.includes('png') ? 'png' : 'jpg';
  const path = `${tripId}/${photoId}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType,
      upsert: true,
    });

  if (error) {
    console.error(`[photoStorage] Upload failed for ${path}:`, error.message);
    return null;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Process a batch of URLs with concurrency limit */
async function processBatch<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

interface PhotoJob {
  dayIndex: number;
  itemIndex: number;
  field: 'imageUrl' | 'photoGallery';
  galleryIndex?: number;
  url: string;
}

/**
 * Download all proxy photos from a trip and upload them to Supabase Storage.
 * Returns a modified copy of tripData with permanent URLs.
 */
export async function persistTripPhotos(tripId: string, tripData: any): Promise<any> {
  if (!tripData?.days) return tripData;

  const supabase = getStorageClient();

  // Ensure bucket exists (create if needed, ignore error if already exists)
  await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/*'],
  }).catch(() => {});

  // Collect all proxy URLs
  const jobs: PhotoJob[] = [];
  for (let di = 0; di < tripData.days.length; di++) {
    const day = tripData.days[di];
    for (let ii = 0; ii < (day.items?.length ?? 0); ii++) {
      const item = day.items[ii];
      if (item.imageUrl?.includes('/api/place-photo')) {
        jobs.push({ dayIndex: di, itemIndex: ii, field: 'imageUrl', url: item.imageUrl });
      }
      if (item.photoGallery) {
        for (let gi = 0; gi < item.photoGallery.length; gi++) {
          if (item.photoGallery[gi]?.includes('/api/place-photo')) {
            jobs.push({ dayIndex: di, itemIndex: ii, field: 'photoGallery', galleryIndex: gi, url: item.photoGallery[gi] });
          }
        }
      }
    }
  }

  if (jobs.length === 0) {
    console.log('[photoStorage] No proxy photos to persist');
    return tripData;
  }

  console.log(`[photoStorage] Persisting ${jobs.length} photos for trip ${tripId}`);

  // Deep clone to avoid mutating original
  const result = JSON.parse(JSON.stringify(tripData));

  // Process in batches
  await processBatch(jobs, async (job) => {
    const photoId = hashStr(job.url);
    const photo = await downloadPhoto(job.url);
    if (!photo) return;

    const publicUrl = await uploadToStorage(supabase, tripId, photoId, photo.buffer, photo.contentType);
    if (!publicUrl) return;

    // Replace URL in result
    const item = result.days[job.dayIndex].items[job.itemIndex];
    if (job.field === 'imageUrl') {
      item.imageUrl = publicUrl;
    } else if (job.field === 'photoGallery' && job.galleryIndex !== undefined) {
      item.photoGallery[job.galleryIndex] = publicUrl;
    }
  }, CONCURRENCY);

  console.log(`[photoStorage] Done persisting photos for trip ${tripId}`);
  return result;
}
