-- ============================================================
-- Migration 015: Atomic helpful toggle for reviews
-- ============================================================

CREATE OR REPLACE FUNCTION public.toggle_review_helpful_atomic(
  p_review_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  helpful BOOLEAN,
  helpful_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_vote_id UUID;
BEGIN
  -- Lock the target review to serialize concurrent toggles.
  PERFORM 1
  FROM public.place_reviews
  WHERE id = p_review_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVIEW_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT id
  INTO existing_vote_id
  FROM public.review_helpful
  WHERE review_id = p_review_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF existing_vote_id IS NULL THEN
    INSERT INTO public.review_helpful (review_id, user_id)
    VALUES (p_review_id, p_user_id)
    ON CONFLICT (review_id, user_id) DO NOTHING;

    IF FOUND THEN
      UPDATE public.place_reviews
      SET helpful_count = helpful_count + 1,
          updated_at = NOW()
      WHERE id = p_review_id
      RETURNING place_reviews.helpful_count INTO helpful_count;
    ELSE
      -- Concurrent insert already added vote: keep state as helpful=true.
      SELECT place_reviews.helpful_count
      INTO helpful_count
      FROM public.place_reviews
      WHERE id = p_review_id;
    END IF;

    helpful := true;
  ELSE
    DELETE FROM public.review_helpful
    WHERE id = existing_vote_id;

    UPDATE public.place_reviews
    SET helpful_count = GREATEST(0, helpful_count - 1),
        updated_at = NOW()
    WHERE id = p_review_id
    RETURNING place_reviews.helpful_count INTO helpful_count;

    helpful := false;
  END IF;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_review_helpful_atomic(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_review_helpful_atomic(UUID, UUID) TO service_role;
