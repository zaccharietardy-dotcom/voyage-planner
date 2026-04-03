import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Clock3 } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import type { PipelineQuestion } from '@/lib/types/pipeline';

interface QuestionCardProps {
  question: PipelineQuestion;
  onAnswer: (questionId: string, selectedOptionId: string) => void;
}

export function QuestionCard({ question, onAnswer }: QuestionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(Math.ceil(question.timeoutMs / 1000));
  const totalSeconds = useMemo(() => Math.ceil(question.timeoutMs / 1000), [question.timeoutMs]);

  useEffect(() => {
    setSelectedId(null);
    setTimeLeft(Math.ceil(question.timeoutMs / 1000));
  }, [question]);

  useEffect(() => {
    if (selectedId) return undefined;

    const interval = setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          clearInterval(interval);
          const defaultOption = question.options.find((option) => option.isDefault) ?? question.options[0];
          if (defaultOption) {
            setSelectedId(defaultOption.id);
            onAnswer(question.questionId, defaultOption.id);
          }
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [onAnswer, question, selectedId]);

  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, timeLeft / totalSeconds)) : 0;

  const handleSelect = (optionId: string) => {
    if (selectedId) return;
    setSelectedId(optionId);
    onAnswer(question.questionId, optionId);
  };

  return (
    <View
      style={{
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderRadius: radius['2xl'],
        borderCurve: 'continuous',
        padding: 20,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.08)',
        gap: 16,
      }}
    >
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.display, flex: 1 }}>
            {question.title}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: radius.full,
              borderCurve: 'continuous',
              backgroundColor: 'rgba(197,160,89,0.14)',
            }}
          >
            <Clock3 size={14} color={colors.gold} />
            <Text style={{ color: colors.gold, fontSize: 12, fontFamily: fonts.sansBold }}>
              {timeLeft}s
            </Text>
          </View>
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, lineHeight: 22 }}>
          {question.prompt}
        </Text>
      </View>

      <View
        style={{
          height: 4,
          borderRadius: radius.full,
          borderCurve: 'continuous',
          backgroundColor: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            width: `${progress * 100}%`,
            height: '100%',
            backgroundColor: colors.gold,
          }}
        />
      </View>

      <View style={{ gap: 10 }}>
        {question.options.map((option) => {
          const isSelected = selectedId === option.id;

          return (
            <Pressable
              key={option.id}
              onPress={() => handleSelect(option.id)}
              disabled={!!selectedId}
              style={{
                padding: 16,
                borderRadius: radius.xl,
                borderCurve: 'continuous',
                backgroundColor: isSelected ? 'rgba(197,160,89,0.16)' : 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: isSelected ? colors.gold : 'rgba(255,255,255,0.08)',
                opacity: selectedId && !isSelected ? 0.55 : 1,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {option.emoji ? (
                  <Text style={{ fontSize: 20 }}>{option.emoji}</Text>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: isSelected ? colors.gold : colors.text,
                      fontSize: 15,
                      fontFamily: fonts.sansSemiBold,
                    }}
                  >
                    {option.label}
                  </Text>
                  {option.subtitle ? (
                    <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: fonts.sans, marginTop: 4 }}>
                      {option.subtitle}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
