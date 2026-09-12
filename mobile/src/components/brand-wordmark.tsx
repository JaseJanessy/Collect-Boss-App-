import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { CollectBossTokens } from '@/constants/theme';

type WordmarkVariant = 'light' | 'dark' | 'monochrome';

export function CollectBossWordmark({
  variant = 'light',
  compact = false,
  style,
}: {
  variant?: WordmarkVariant;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const monochrome = variant === 'monochrome';

  return (
    <View style={[styles.base, variant === 'dark' && styles.darkClearSpace, style]}>
      <Text accessibilityLabel="CollectBoss" style={[styles.wordmark, compact && styles.compact]}>
        <Text style={monochrome ? styles.monochrome : styles.collect}>Collect</Text>
        <Text style={monochrome ? styles.monochrome : styles.boss}>Boss</Text>
      </Text>
    </View>
  );
}

export function CollectBossPocketWordmark({
  variant = 'light',
  compact = false,
  style,
}: {
  variant?: WordmarkVariant;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const monochrome = variant === 'monochrome';

  return (
    <View style={[styles.base, variant === 'dark' && styles.darkClearSpace, style]}>
      <Text accessibilityLabel="CollectBoss Pocket" style={[styles.wordmark, compact && styles.compact]}>
        <Text style={monochrome ? styles.monochrome : styles.collect}>Collect</Text>
        <Text style={monochrome ? styles.monochrome : styles.boss}>Boss Pocket</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignSelf: 'flex-start' },
  darkClearSpace: { borderRadius: 6, backgroundColor: CollectBossTokens.color.surface, paddingHorizontal: 10, paddingVertical: 8 },
  wordmark: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, lineHeight: 24 },
  compact: { fontSize: 18, lineHeight: 22 },
  collect: { color: CollectBossTokens.color.navy },
  boss: { color: CollectBossTokens.color.brandGreen },
  monochrome: { color: CollectBossTokens.color.foreground },
});
