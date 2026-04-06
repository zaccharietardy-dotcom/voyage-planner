import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Search } from 'lucide-react-native';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { colors, fonts, radius } from '@/lib/theme';

export interface SelectionSheetOption {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
}

interface Props<T extends SelectionSheetOption> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  options: T[];
  selectedValue?: string;
  onSelect: (value: string) => void;
  height?: number;
  searchPlaceholder?: string;
  emptyText?: string;
  getSearchText?: (option: T) => string;
  renderOption?: (option: T, meta: { selected: boolean }) => ReactNode;
}

export function SelectionSheet<T extends SelectionSheetOption>({
  isOpen,
  onClose,
  title,
  subtitle,
  options,
  selectedValue,
  onSelect,
  height = 0.62,
  searchPlaceholder,
  emptyText = 'Aucun résultat.',
  getSearchText,
  renderOption,
}: Props<T>) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;

    return options.filter((option) => {
      const haystack = (
        getSearchText?.(option)
        || option.searchText
        || `${option.label} ${option.description || ''}`
      ).toLowerCase();

      return haystack.includes(normalized);
    });
  }, [getSearchText, options, query]);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} height={height}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {searchPlaceholder ? (
          <View style={styles.searchShell}>
            <Search size={16} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
              autoCorrect={false}
            />
          </View>
        ) : null}

        <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled bounces contentContainerStyle={styles.list}>
          {filteredOptions.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>{emptyText}</Text>
            </View>
          ) : filteredOptions.map((option) => {
            const selected = option.value === selectedValue;

            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                style={[styles.optionRow, selected ? styles.optionRowSelected : null]}
              >
                <View style={{ flex: 1 }}>
                  {renderOption ? renderOption(option, { selected }) : (
                    <>
                      <Text style={[styles.optionLabel, selected ? styles.optionLabelSelected : null]}>
                        {option.label}
                      </Text>
                      {option.description ? (
                        <Text style={styles.optionDescription}>{option.description}</Text>
                      ) : null}
                    </>
                  )}
                </View>
                {selected ? <Check size={18} color={colors.gold} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    gap: 16,
  },
  header: {
    gap: 6,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontFamily: fonts.display,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontFamily: fonts.sans,
    lineHeight: 20,
  },
  searchShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 16,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansMedium,
  },
  list: {
    gap: 10,
    paddingBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radius['2xl'],
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  optionRowSelected: {
    backgroundColor: colors.goldBg,
    borderColor: colors.goldBorder,
  },
  optionLabel: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansSemiBold,
  },
  optionLabelSelected: {
    color: colors.gold,
  },
  optionDescription: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: fonts.sans,
    marginTop: 4,
    lineHeight: 18,
  },
  emptyState: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyStateText: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
});
