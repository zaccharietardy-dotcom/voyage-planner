import { View, Text } from 'react-native';
import { Button } from './Button';
import type { LucideIcon } from 'lucide-react-native';

interface Props {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: 20,
          backgroundColor: 'rgba(197,160,89,0.1)',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 20,
        }}
      >
        <Icon size={32} color="#c5a059" />
      </View>
      <Text style={{ color: '#f8fafc', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
        {title}
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 }}>
        {description}
      </Text>
      {action && <Button onPress={action.onPress}>{action.label}</Button>}
    </View>
  );
}
