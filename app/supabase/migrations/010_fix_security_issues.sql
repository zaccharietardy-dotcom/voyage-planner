-- ============================================================
-- Migration 010: Correction de tous les problèmes de sécurité
-- ============================================================
-- Résout les alertes du Supabase Database Linter :
--   1. RLS désactivé sur notifications, conversations,
--      conversation_participants, messages
--   2. search_path mutable sur 3 fonctions
--   3. Policies trop permissives sur places et search_cache
-- ============================================================


-- ============================================================
-- PARTIE 1 : Activer RLS sur les tables de messagerie
-- ============================================================

-- 1a. Table notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Un utilisateur ne peut voir que SES notifications
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Un utilisateur authentifié peut recevoir des notifications
-- (insertion côté serveur via service_role, ou via triggers)
CREATE POLICY "Authenticated users can insert notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Un utilisateur peut marquer ses notifications comme lues
CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Un utilisateur peut supprimer ses propres notifications
CREATE POLICY "Users can delete their own notifications"
  ON public.notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Accorder les permissions au rôle authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;


-- 1b. Table conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Un utilisateur ne peut voir que les conversations auxquelles il participe
CREATE POLICY "Users can view their conversations"
  ON public.conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
      AND cp.user_id = auth.uid()
    )
  );

-- Un utilisateur authentifié peut créer une conversation
CREATE POLICY "Authenticated users can create conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Seuls les participants peuvent mettre à jour la conversation (ex: updated_at)
CREATE POLICY "Participants can update their conversations"
  ON public.conversations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
      AND cp.user_id = auth.uid()
    )
  );

-- Les participants peuvent supprimer une conversation
CREATE POLICY "Participants can delete conversations"
  ON public.conversations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id
      AND cp.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;


-- 1c. Table conversation_participants
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- Un utilisateur peut voir les participants des conversations auxquelles il participe
CREATE POLICY "Users can view participants of their conversations"
  ON public.conversation_participants FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp2
      WHERE cp2.conversation_id = conversation_participants.conversation_id
      AND cp2.user_id = auth.uid()
    )
  );

-- Un utilisateur authentifié peut ajouter des participants
-- (nécessaire pour créer la conversation et y ajouter l'autre personne)
CREATE POLICY "Authenticated users can add participants"
  ON public.conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Un participant peut mettre à jour sa propre entrée (ex: last_read_at)
CREATE POLICY "Users can update their own participation"
  ON public.conversation_participants FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Un participant peut quitter une conversation
CREATE POLICY "Users can leave conversations"
  ON public.conversation_participants FOR DELETE
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_participants TO authenticated;


-- 1d. Table messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Un utilisateur peut voir les messages des conversations auxquelles il participe
CREATE POLICY "Users can view messages in their conversations"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
    )
  );

-- Un utilisateur peut envoyer un message seulement dans ses conversations
CREATE POLICY "Users can send messages in their conversations"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND EXISTS (
      SELECT 1 FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id
      AND cp.user_id = auth.uid()
    )
  );

-- Un utilisateur peut modifier ses propres messages
CREATE POLICY "Users can update their own messages"
  ON public.messages FOR UPDATE
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);

-- Un utilisateur peut supprimer ses propres messages
CREATE POLICY "Users can delete their own messages"
  ON public.messages FOR DELETE
  USING (auth.uid() = sender_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;


-- ============================================================
-- PARTIE 2 : Corriger le search_path des fonctions
-- ============================================================

-- 2a. Recréer is_trip_member_or_owner avec search_path fixé
CREATE OR REPLACE FUNCTION public.is_trip_member_or_owner(p_trip_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM trip_members WHERE trip_id = p_trip_id AND user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM trips WHERE id = p_trip_id AND owner_id = p_user_id
  );
$$;

-- 2b. Recréer update_follow_counts avec search_path fixé
CREATE OR REPLACE FUNCTION public.update_follow_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
    UPDATE profiles SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET followers_count = GREATEST(0, followers_count - 1) WHERE id = OLD.following_id;
    UPDATE profiles SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
    RETURN OLD;
  END IF;
END;
$$;

-- 2c. Recréer update_trip_count avec search_path fixé
CREATE OR REPLACE FUNCTION public.update_trip_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE profiles SET trips_count = trips_count + 1 WHERE id = NEW.owner_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE profiles SET trips_count = GREATEST(0, trips_count - 1) WHERE id = OLD.owner_id;
    RETURN OLD;
  END IF;
END;
$$;


-- ============================================================
-- PARTIE 3 : Corriger les policies trop permissives
--            sur places et search_cache
-- ============================================================

-- 3a. Table places : restreindre au service_role + lecture publique
DROP POLICY IF EXISTS "Service role full access on places" ON public.places;

-- Le service_role (côté serveur) a accès total
CREATE POLICY "Service role full access on places"
  ON public.places FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Les utilisateurs authentifiés peuvent lire les places (données publiques de cache)
CREATE POLICY "Authenticated users can read places"
  ON public.places FOR SELECT
  TO authenticated
  USING (true);

-- Le rôle anon peut aussi lire (les pages publiques peuvent afficher des lieux)
CREATE POLICY "Anon users can read places"
  ON public.places FOR SELECT
  TO anon
  USING (true);


-- 3b. Table search_cache : restreindre au service_role + lecture publique
DROP POLICY IF EXISTS "Service role full access on search_cache" ON public.search_cache;

-- Le service_role (côté serveur) a accès total
CREATE POLICY "Service role full access on search_cache"
  ON public.search_cache FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Les utilisateurs authentifiés peuvent lire le cache
CREATE POLICY "Authenticated users can read search_cache"
  ON public.search_cache FOR SELECT
  TO authenticated
  USING (true);

-- Le rôle anon peut aussi lire
CREATE POLICY "Anon users can read search_cache"
  ON public.search_cache FOR SELECT
  TO anon
  USING (true);
