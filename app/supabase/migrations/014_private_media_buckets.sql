-- ============================================================
-- Migration 014: Private media buckets for trip photos/documents
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'trip-photos') THEN
    UPDATE storage.buckets
    SET public = false
    WHERE id = 'trip-photos';
  ELSE
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'trip-photos',
      'trip-photos',
      false,
      10485760,
      ARRAY['image/*', 'video/*']
    );
  END IF;

  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'trip-documents') THEN
    UPDATE storage.buckets
    SET public = false
    WHERE id = 'trip-documents';
  ELSE
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'trip-documents',
      'trip-documents',
      false,
      10485760,
      ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'text/plain']
    );
  END IF;
END $$;
