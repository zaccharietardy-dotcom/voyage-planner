import { api } from './client';

export interface Conversation {
  id: string;
  participant: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
  lastMessage: {
    content: string;
    sender_id: string;
    created_at: string;
  } | null;
  unreadCount: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await api.get<{ conversations: Conversation[] }>('/api/messages/conversations');
  return res.conversations ?? [];
}

export async function fetchOrCreateConversation(participantId: string): Promise<{ id: string }> {
  return api.post<{ id: string }>('/api/messages/conversations', { participantId });
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const res = await api.get<{ messages: Message[] }>(`/api/messages/conversations/${conversationId}`);
  return res.messages ?? [];
}

export async function sendMessage(conversationId: string, content: string): Promise<Message> {
  return api.post<Message>('/api/messages/send', { conversationId, content });
}
