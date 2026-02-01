import { createClient } from '@supabase/supabase-js';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type NotificationType = 'follow' | 'like' | 'comment' | 'reply' | 'proposal' | 'trip_invite' | 'message';

interface NotificationData {
  tripId?: string;
  userId?: string;
  commentId?: string;
  conversationId?: string;
  destination?: string;
  [key: string]: any;
}

export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string | null,
  data: NotificationData = {}
) {
  const serviceClient = getServiceClient();

  const { error } = await serviceClient
    .from('notifications')
    .insert({
      user_id: userId,
      type,
      title,
      body,
      data,
    });

  if (error) {
    console.error('Error creating notification:', error);
  }
}

export async function notifyFollow(followerId: string, followedId: string, followerName: string) {
  if (followerId === followedId) return;
  await createNotification(
    followedId,
    'follow',
    'Nouveau follower',
    `${followerName} vous suit maintenant`,
    { userId: followerId }
  );
}

export async function notifyLike(likerId: string, tripOwnerId: string, likerName: string, tripId: string, destination: string) {
  if (likerId === tripOwnerId) return;
  await createNotification(
    tripOwnerId,
    'like',
    'Nouveau like',
    `${likerName} a aimé votre voyage à ${destination}`,
    { userId: likerId, tripId, destination }
  );
}

export async function notifyComment(commenterId: string, tripOwnerId: string, commenterName: string, tripId: string, destination: string) {
  if (commenterId === tripOwnerId) return;
  await createNotification(
    tripOwnerId,
    'comment',
    'Nouveau commentaire',
    `${commenterName} a commenté votre voyage à ${destination}`,
    { userId: commenterId, tripId, destination }
  );
}

export async function notifyReply(replierId: string, parentCommentUserId: string, replierName: string, tripId: string) {
  if (replierId === parentCommentUserId) return;
  await createNotification(
    parentCommentUserId,
    'reply',
    'Nouvelle réponse',
    `${replierName} a répondu à votre commentaire`,
    { userId: replierId, tripId }
  );
}

export async function notifyMessage(senderId: string, recipientId: string, senderName: string, conversationId: string) {
  if (senderId === recipientId) return;
  await createNotification(
    recipientId,
    'message',
    'Nouveau message',
    `${senderName} vous a envoyé un message`,
    { userId: senderId, conversationId }
  );
}
