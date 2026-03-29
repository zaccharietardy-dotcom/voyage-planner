import { View, Text, Image, type ViewStyle } from 'react-native';

type Size = 'sm' | 'md' | 'lg';

interface Props {
  url: string | null | undefined;
  name: string;
  size?: Size;
}

const DIMS: Record<Size, number> = { sm: 32, md: 44, lg: 72 };
const FONT: Record<Size, number> = { sm: 13, md: 17, lg: 28 };

export function Avatar({ url, name, size = 'md' }: Props) {
  const dim = DIMS[size];
  const container: ViewStyle = {
    width: dim,
    height: dim,
    borderRadius: dim / 2,
    backgroundColor: '#c5a059',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  };

  const initial = (name || '?').charAt(0).toUpperCase();

  if (url) {
    return (
      <View style={container}>
        <Image source={{ uri: url }} style={{ width: dim, height: dim }} />
      </View>
    );
  }

  return (
    <View style={container}>
      <Text style={{ color: '#020617', fontSize: FONT[size], fontWeight: '800' }}>{initial}</Text>
    </View>
  );
}
