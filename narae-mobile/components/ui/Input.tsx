import { TextInput, View, StyleSheet, Platform, type TextInputProps } from 'react-native';
import { colors, fonts, radius } from '@/lib/theme';

interface Props extends TextInputProps {
  containerStyle?: any;
}

export function Input({ containerStyle, ...props }: Props) {
  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        placeholderTextColor={colors.textDim}
        style={styles.input}
        selectionColor={colors.gold}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 56,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  input: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.sans,
    paddingTop: Platform.OS === 'ios' ? 0 : 2, // Minor alignment fix
  },
});
