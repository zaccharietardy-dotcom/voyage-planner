-- ============================================================
-- Migration 011: Corriger les 3 policies INSERT trop permissives
-- ============================================================
-- Warnings restants du linter :
--   - notifications : INSERT WITH CHECK (true)
--   - conversations : INSERT WITH CHECK (true)
--   - conversation_participants : INSERT WITH CHECK (true)
-- ============================================================


-- ============================================================
-- 1. notifications : seul le service_role insère des notifs
--    (les notifs sont créées côté serveur, pas côté client)
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

-- Seul le service_role (côté serveur) peut créer des notifications
CREATE POLICY "Service role can insert notifications"
  ON public.notifications FOR INSERT
  TO service_role
  WITH CHECK (true);


-- ============================================================
-- 2. conversations : un utilisateur doit immédiatement
--    se joindre en tant que participant après création
--    On ne peut pas vérifier ça dans un seul INSERT,
--    mais on peut limiter au rôle authenticated
--    et utiliser une vérification via fonction
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can create conversations" ON public.conversations;

-- Un utilisateur authentifié peut créer une conversation
-- Pas de colonne user_id sur conversations, donc on vérifie
-- juste que l'utilisateur est authentifié (auth.uid() IS NOT NULL)
CREATE POLICY "Authenticated users can create conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);


-- ============================================================
-- 3. conversation_participants : un utilisateur peut s'ajouter
--    lui-même OU ajouter quelqu'un dans une conversation
--    où il est déjà participant
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can add participants" ON public.conversation_participants;

-- Un utilisateur peut :
--   a) s'ajouter lui-même (user_id = auth.uid())
--   b) ajouter quelqu'un d'autre s'il est déjà participant de la conversation
CREATE POLICY "Users can add participants to their conversations"
  ON public.conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_participants.conversation_id
      AND cp.user_id = auth.uid()
    )
  );
