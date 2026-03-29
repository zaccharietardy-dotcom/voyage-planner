import { View, Text, TextInput, type TextInputProps } from 'react-native';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react-native';

interface Props extends TextInputProps {
  label?: string;
  error?: string;
  icon?: LucideIcon;
}

export function Input({ label, error, icon: Icon, style, ...rest }: Props) {
  const [focused, setFocused] = useState(false);

  const borderColor = error ? '#ef4444' : focused ? '#c5a059' : '#1e293b';

  return (
    <View style={{ gap: 6 }}>
      {label && (
        <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600' }}>{label}</Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#0f172a',
          borderWidth: 1,
          borderColor,
          borderRadius: 12,
          paddingHorizontal: 14,
          height: 48,
          gap: 10,
        }}
      >
        {Icon && <Icon size={18} color={focused ? '#c5a059' : '#64748b'} />}
        <TextInput
          style={[{
            flex: 1,
            color: '#f8fafc',
            fontSize: 15,
          }, style]}
          placeholderTextColor="#475569"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
      </View>
      {error && (
        <Text style={{ color: '#ef4444', fontSize: 12 }}>{error}</Text>
      )}
    </View>
  );
}
