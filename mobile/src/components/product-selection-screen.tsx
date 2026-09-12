import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CollectBossPocketWordmark, CollectBossWordmark } from '@/components/brand-wordmark';
import { CollectBossTokens, PocketTokens } from '@/constants/theme';
import { registrationLegalUrl } from '@/lib/registration';
import { useAuth } from '@/providers/auth-provider';
import {
  MAIN_COLLECTBOSS_RULES,
  type RegistrationProduct,
} from '../../../shared/registration-contracts';

function friendlySelectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Product selection failed.';
  if (/network request failed|failed to fetch/i.test(message)) {
    return 'Cannot reach the secure workspace service. Check your connection and app configuration, then try again.';
  }
  return message;
}

function Field({ label, value, onChangeText, placeholder, inputMode = 'text' }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  inputMode?: 'text' | 'tel';
}) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput
    accessibilityLabel={label}
    value={value}
    onChangeText={onChangeText}
    inputMode={inputMode}
    autoCorrect={false}
    placeholder={placeholder}
    placeholderTextColor={CollectBossTokens.color.mutedForeground}
    style={styles.input}
  /></View>;
}

function ProductChoice({ product, selected, onPress }: {
  product: RegistrationProduct;
  selected: boolean;
  onPress: () => void;
}) {
  return <Pressable
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={product === 'main' ? 'Choose CollectBoss' : 'Choose CollectBoss Pocket'}
    onPress={onPress}
    style={({ pressed }) => [styles.productChoice, selected && styles.productSelected, pressed && styles.pressed]}
  >
    {product === 'main' ? <CollectBossWordmark compact /> : <CollectBossPocketWordmark compact />}
    <Text style={styles.productCopy}>{product === 'main' ? 'Complete collection workspace' : 'Mobile-first collection essentials'}</Text>
  </Pressable>;
}

export function ProductSelectionScreen({ onComplete }: { onComplete: () => void }) {
  const { chooseProduct, signOut } = useAuth();
  const [product, setProduct] = useState<RegistrationProduct | null>(null);
  const [fullName, setFullName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [phone, setPhone] = useState('');
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectProduct = (next: RegistrationProduct) => {
    setProduct(next);
    setRulesAccepted(false);
    setError(null);
  };

  const submit = async () => {
    if (!product) return setError('Choose CollectBoss or CollectBoss Pocket.');
    if (fullName.trim().length < 2) return setError('Enter your full name.');
    if (accountName.trim().length < 2) return setError('Enter your business or account name.');
    if (!/^[+()\-\s.0-9]{7,30}$/u.test(phone.trim())) return setError('Enter a valid phone number.');
    if (product === 'main' && !rulesAccepted) return setError('Read and accept all Main CollectBoss rules before continuing.');
    setBusy(true);
    setError(null);
    try {
      await chooseProduct({ fullName, accountName, phone, product }, product === 'main' && rulesAccepted);
      onComplete();
    } catch (next) {
      setError(friendlySelectionError(next));
    } finally {
      setBusy(false);
    }
  };

  return <SafeAreaView style={styles.safe}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
    <View style={styles.hero}>
      <CollectBossWordmark />
      <Text style={styles.step}>STEP 2 OF 2 · ACCOUNT CREATED</Text>
      <Text style={styles.title}>Choose your CollectBoss experience.</Text>
      <Text style={styles.subtitle}>Your email and password work across the CollectBoss web and mobile apps. Choose the workspace this account should open.</Text>
    </View>
    <View style={styles.card}>
      <Text style={styles.label}>Product</Text>
      <View style={styles.productRow}>
        <ProductChoice product="main" selected={product === 'main'} onPress={() => selectProduct('main')} />
        <ProductChoice product="pocket" selected={product === 'pocket'} onPress={() => selectProduct('pocket')} />
      </View>

      {product ? <>
        <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="Your full name" />
        <Field label="Business or account name" value={accountName} onChangeText={setAccountName} placeholder="Company or personal account name" />
        <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="+60 12 345 6789" inputMode="tel" />
      </> : null}

      {product === 'main' ? <View accessibilityLabel="Main CollectBoss strict-use rules" style={styles.rulesCard}>
        <Text style={styles.rulesTitle}>Main CollectBoss strict-use rules</Text>
        <Text style={styles.rulesIntro}>Main CollectBoss cannot be activated until you read and agree.</Text>
        {MAIN_COLLECTBOSS_RULES.map((rule, index) => <View key={rule} style={styles.ruleRow}><Text style={styles.ruleNumber}>{index + 1}.</Text><Text style={styles.ruleText}>{rule}</Text></View>)}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: rulesAccepted }}
          onPress={() => setRulesAccepted((current) => !current)}
          style={styles.checkboxRow}
        >
          <View style={[styles.checkbox, rulesAccepted && styles.checkboxChecked]}><Text style={styles.checkmark}>{rulesAccepted ? '✓' : ''}</Text></View>
          <Text style={styles.checkboxText}>I have read and agree to all Main CollectBoss rules and linked legal policies.</Text>
        </Pressable>
        <View style={styles.linkRow}>
          {([['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/pdpa-consent', 'PDPA'], ['/legal-disclaimer', 'Legal disclaimer']] as const).map(([path, label]) => {
            const url = registrationLegalUrl(path);
            return <Pressable key={path} accessibilityRole="link" disabled={!url} onPress={() => { if (url) void Linking.openURL(url); }}><Text style={[styles.link, !url && styles.linkDisabled]}>{label}</Text></Pressable>;
          })}
        </View>
      </View> : null}

      {error ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
      {product ? <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy || (product === 'main' && !rulesAccepted) }}
        disabled={busy || (product === 'main' && !rulesAccepted)}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed, (busy || (product === 'main' && !rulesAccepted)) && styles.disabled]}
      ><Text style={[styles.primaryText, (busy || (product === 'main' && !rulesAccepted)) && styles.disabledText]}>{busy ? 'Preparing workspace…' : product === 'main' ? 'Agree and continue to CollectBoss' : 'Continue to CollectBoss Pocket'}</Text></Pressable> : null}
      <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut}><Text style={styles.signOutText}>Sign out</Text></Pressable>
    </View>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: CollectBossTokens.color.canvas },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 48, gap: 18 },
  hero: { gap: 10 },
  step: { color: CollectBossTokens.color.primaryPressed, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  title: { color: CollectBossTokens.color.navy, fontSize: 29, lineHeight: 35, fontWeight: '700' },
  subtitle: { color: CollectBossTokens.color.mutedForeground, fontSize: 15, lineHeight: 22 },
  card: { gap: 15, borderRadius: 20, borderWidth: 1, borderColor: CollectBossTokens.color.border, backgroundColor: CollectBossTokens.color.surface, padding: 18 },
  productRow: { flexDirection: 'row', gap: 9 },
  productChoice: { flex: 1, minHeight: 92, justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 2, borderColor: CollectBossTokens.color.border, padding: 11, backgroundColor: CollectBossTokens.color.surface },
  productSelected: { borderColor: CollectBossTokens.color.primary, backgroundColor: PocketTokens.color.selectedSurface },
  productCopy: { color: CollectBossTokens.color.mutedForeground, fontSize: 11, lineHeight: 15 },
  pressed: { opacity: 0.82 },
  field: { gap: 7 },
  label: { color: CollectBossTokens.color.foreground, fontSize: 14, fontWeight: '600' },
  input: { minHeight: 52, borderRadius: 13, borderWidth: 1, borderColor: CollectBossTokens.color.border, backgroundColor: CollectBossTokens.color.surface, color: CollectBossTokens.color.foreground, paddingHorizontal: 14, fontSize: 16 },
  rulesCard: { gap: 10, borderRadius: 16, borderWidth: 2, borderColor: CollectBossTokens.color.navy, backgroundColor: CollectBossTokens.color.canvas, padding: 15 },
  rulesTitle: { color: CollectBossTokens.color.navy, fontSize: 17, fontWeight: '700' },
  rulesIntro: { color: CollectBossTokens.color.mutedForeground, fontSize: 12, lineHeight: 18 },
  ruleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  ruleNumber: { width: 18, color: CollectBossTokens.color.navy, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  ruleText: { flex: 1, color: CollectBossTokens.color.foreground, fontSize: 12, lineHeight: 18 },
  checkboxRow: { minHeight: 56, flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: CollectBossTokens.color.border, backgroundColor: CollectBossTokens.color.surface, padding: 12 },
  checkbox: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 5, borderWidth: 2, borderColor: CollectBossTokens.color.border },
  checkboxChecked: { borderColor: CollectBossTokens.color.primary, backgroundColor: CollectBossTokens.color.primary },
  checkmark: { color: CollectBossTokens.color.inverseForeground, fontSize: 15, lineHeight: 17, fontWeight: '700' },
  checkboxText: { flex: 1, color: CollectBossTokens.color.navy, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  link: { color: CollectBossTokens.color.primaryPressed, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' },
  linkDisabled: { color: CollectBossTokens.color.disabledText, textDecorationLine: 'none' },
  errorBox: { borderRadius: 12, borderWidth: 1, borderColor: CollectBossTokens.color.dangerBorder, backgroundColor: CollectBossTokens.color.dangerSurface, padding: 13 },
  errorText: { color: CollectBossTokens.color.foreground, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  primaryButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: CollectBossTokens.color.primary, paddingHorizontal: 15 },
  primaryPressed: { backgroundColor: CollectBossTokens.color.primaryPressed },
  primaryText: { color: CollectBossTokens.color.inverseForeground, textAlign: 'center', fontSize: 15, fontWeight: '700' },
  disabled: { borderWidth: 1, borderColor: CollectBossTokens.color.disabledBorder, backgroundColor: CollectBossTokens.color.disabledSurface },
  disabledText: { color: CollectBossTokens.color.disabledText },
  signOut: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  signOutText: { color: CollectBossTokens.color.mutedForeground, fontSize: 13, fontWeight: '600' },
});
