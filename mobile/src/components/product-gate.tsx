import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CollectBossApp } from '@/components/collectboss-app';
import { ProductSelectionScreen } from '@/components/product-selection-screen';
import { PocketApp } from '@/products/pocket/pocket-app';
import { CollectBossTokens } from '@/constants/theme';
import { loadWorkspaceContext, WorkspaceContextError } from '@/lib/workspace-context';
import { useAuth } from '@/providers/auth-provider';
import type { WorkspaceContextResponse } from '../../../shared/workspace-contracts';

export function MobileProductGate() {
  const { session, initializing, prepareRegisteredWorkspace, signOut } = useAuth();
  const [context, setContext] = useState<WorkspaceContextResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsProductSelection, setNeedsProductSelection] = useState(false);

  const resolveProduct = useCallback(async (repairRegistration = false) => {
    if (!session?.access_token) return;
    setLoading(true);
    setError(null);
    setNeedsProductSelection(false);
    try {
      if (repairRegistration) await prepareRegisteredWorkspace();
      setContext(await loadWorkspaceContext(session.access_token));
    } catch (next) {
      setContext(null);
      if (next instanceof WorkspaceContextError && next.code === 'WORKSPACE_ACCESS_DENIED') {
        setNeedsProductSelection(true);
        return;
      }
      setError(next instanceof Error ? next.message : 'Your authorised business could not be verified.');
    } finally {
      setLoading(false);
    }
  }, [prepareRegisteredWorkspace, session?.access_token]);

  useEffect(() => { void resolveProduct(false); }, [resolveProduct]);

  if (initializing) return <GateLoading label="Recovering secure session…" />;
  if (!session) return <CollectBossApp />;
  if (loading && !context) return <GateLoading label="Opening your authorised business…" />;
  if (needsProductSelection) return <ProductSelectionScreen onComplete={() => void resolveProduct(false)} />;
  if (error || !context) {
    return (
      <SafeAreaView style={styles.safe}>
        <View accessibilityRole="alert" style={styles.errorCard}>
          <Text style={styles.title}>CollectBoss couldn&apos;t open</Text>
          <Text style={styles.copy}>{error ?? 'Your authorised business could not be verified.'}</Text>
          <Pressable accessibilityRole="button" onPress={() => void resolveProduct(true)} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Sign out</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }
  return context.workspace.productType === 'pocket' ? <PocketApp context={context} /> : <CollectBossApp />;
}

function GateLoading({ label }: { label: string }) {
  return <SafeAreaView style={styles.safe}><View accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}><ActivityIndicator size="large" color={CollectBossTokens.color.primary} /><Text style={styles.copy}>{label}</Text></View></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: CollectBossTokens.color.canvas, justifyContent: 'center', padding: 24 },
  loading: { alignItems: 'center', gap: 14 },
  errorCard: { width: '100%', maxWidth: 440, alignSelf: 'center', gap: 14, padding: 24, borderRadius: 20, borderWidth: 1, borderColor: CollectBossTokens.color.dangerBorder, backgroundColor: CollectBossTokens.color.surface },
  title: { color: CollectBossTokens.color.foreground, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  copy: { color: CollectBossTokens.color.mutedForeground, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: CollectBossTokens.targetSize, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: CollectBossTokens.color.primary, paddingHorizontal: 18 },
  buttonText: { color: CollectBossTokens.color.inverseForeground, fontWeight: '700' },
  secondaryButton: { minHeight: CollectBossTokens.targetSize, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: CollectBossTokens.color.border, paddingHorizontal: 18 },
  secondaryText: { color: CollectBossTokens.color.foreground, fontWeight: '700' },
});
