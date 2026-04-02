import { useState, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Send, Bot, Sparkles } from 'lucide-react-native';
import { colors, fonts } from '@/lib/theme';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { supabase } from '@/lib/supabase/client';
import { SITE_URL } from '@/lib/constants';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'Ajouter une activité culturelle',
  'Changer le restaurant du déjeuner',
  'Plus de temps libre',
  'Ajouter une visite guidée',
  'Trouver un meilleur hôtel',
];

export function ChatPanel({ isOpen, onClose, tripId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: text.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${SITE_URL}/api/trips/${tripId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text.trim(), history: messages }),
      });

      if (!res.ok) throw new Error('Erreur de réponse');

      const data = await res.json();
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response || data.message || 'Je n\'ai pas pu traiter votre demande.',
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Désolé, une erreur est survenue. Réessayez.',
      }]);
    } finally {
      setSending(false);
      setTimeout(() => flatListRef.current?.scrollToEnd(), 100);
    }
  }, [sending, messages, tripId]);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} height={0.85}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={40}
      >
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingBottom: 12 }}>
          <View style={{
            width: 36, height: 36, borderRadius: 12,
            backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={18} color={colors.gold} />
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: 16, fontFamily: fonts.display }}>Assistant Narae</Text>
            <Text style={{ color: colors.textMuted, fontSize: 11 }}>Modifiez votre voyage par chat</Text>
          </View>
        </View>

        {/* Messages */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, gap: 12, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
              <Bot size={40} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: 'center' }}>
                Demandez-moi de modifier{'\n'}votre itinéraire
              </Text>
              {/* Suggestions */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => sendMessage(s)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
                      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderSubtle,
                    }}
                  >
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{
              alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '80%',
              backgroundColor: item.role === 'user' ? colors.gold : colors.surface,
              borderRadius: 18,
              borderBottomRightRadius: item.role === 'user' ? 4 : 18,
              borderBottomLeftRadius: item.role === 'assistant' ? 4 : 18,
              padding: 14,
            }}>
              <Text style={{
                color: item.role === 'user' ? colors.bg : colors.text,
                fontSize: 14, lineHeight: 20,
              }}>
                {item.content}
              </Text>
            </View>
          )}
        />

        {/* Input */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingHorizontal: 16, paddingVertical: 12,
          borderTopWidth: 1, borderTopColor: colors.border,
        }}>
          <TextInput
            style={{
              flex: 1, backgroundColor: colors.surface, borderRadius: 16,
              paddingHorizontal: 16, paddingVertical: 12,
              color: colors.text, fontSize: 14,
              borderWidth: 1, borderColor: colors.borderSubtle,
            }}
            placeholder="Modifier mon itinéraire..."
            placeholderTextColor={colors.textDim}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => sendMessage(input)}
            returnKeyType="send"
          />
          <Pressable
            onPress={() => sendMessage(input)}
            disabled={!input.trim() || sending}
            style={{
              width: 44, height: 44, borderRadius: 14,
              backgroundColor: input.trim() ? colors.gold : colors.surface,
              alignItems: 'center', justifyContent: 'center',
              opacity: !input.trim() || sending ? 0.5 : 1,
            }}
          >
            <Send size={20} color={input.trim() ? colors.bg : colors.textMuted} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}
