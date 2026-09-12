import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CollectBossWordmark } from '@/components/brand-wordmark';
import { CollectBossTokens } from '@/constants/theme';
import { useAuth } from '@/providers/auth-provider';

type Mode = 'sign-in' | 'sign-up';

function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Authentication failed.';
  if (/network request failed|failed to fetch/i.test(message)) {
    return 'Cannot reach the secure sign-in service. Check your internet connection and app configuration, then try again.';
  }
  if (/already registered/i.test(message)) return 'This email is already registered. Sign in instead.';
  if (/invalid login credentials/i.test(message)) return 'Incorrect email or password.';
  if (/email not confirmed/i.test(message)) return 'Confirm your email address before signing in.';
  return message;
}

function AuthField({
  label,
  value,
  onChangeText,
  secureTextEntry,
  inputMode,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  inputMode?: 'email' | 'tel' | 'text';
  autoComplete?: 'email' | 'name' | 'organization' | 'tel' | 'current-password' | 'new-password';
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCapitalize={inputMode === 'email' ? 'none' : 'sentences'}
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={CollectBossTokens.color.mutedForeground}
        style={styles.input}
      />
    </View>
  );
}

export function CollectBossAuthScreen() {
  const { configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const changeMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setConfirmationSent(false);
  };

  const submitSignIn = async () => {
    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (next) {
      setError(friendlyAuthError(next));
    } finally {
      setBusy(false);
    }
  };

  const submitSignUp = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must contain at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await signUp(email, password);
      if (result.needsConfirmation) setConfirmationSent(true);
    } catch (next) {
      setError(friendlyAuthError(next));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <CollectBossWordmark />
          <Text style={styles.title}>{mode === 'sign-up' ? 'Create your official account.' : 'Urgent collection work, in your pocket.'}</Text>
          <Text style={styles.subtitle}>{mode === 'sign-up' ? 'First create one email and password. Choose CollectBoss or Pocket afterward.' : 'Live tenant-scoped data only. No production demo fallback.'}</Text>
        </View>

        {!configured ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <Text style={styles.errorText}>Supabase is not configured. Add the required EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY values.</Text>
          </View>
        ) : confirmationSent ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Check your email</Text>
            <Text style={styles.body}>We sent a confirmation link to {email.trim()}. Open it to activate your shared account, then return here to sign in and choose a product.</Text>
            <Pressable accessibilityRole="button" onPress={() => changeMode('sign-in')} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Return to sign in</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.modeRow}>
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'sign-in' }} onPress={() => changeMode('sign-in')} style={[styles.modeButton, mode === 'sign-in' && styles.modeButtonSelected]}>
                <Text style={[styles.modeText, mode === 'sign-in' && styles.modeTextSelected]}>Sign in</Text>
              </Pressable>
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === 'sign-up' }} onPress={() => changeMode('sign-up')} style={[styles.modeButton, mode === 'sign-up' && styles.modeButtonSelected]}>
                <Text style={[styles.modeText, mode === 'sign-up' && styles.modeTextSelected]}>Create account</Text>
              </Pressable>
            </View>

            <AuthField label="Email" value={email} onChangeText={setEmail} inputMode="email" autoComplete="email" placeholder="you@example.com" />
            <AuthField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} placeholder={mode === 'sign-up' ? 'At least 8 characters' : 'Your password'} />
            {mode === 'sign-up' ? <AuthField label="Confirm password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoComplete="new-password" placeholder="Re-enter your password" /> : null}

            {error ? <View accessibilityRole="alert" style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
            {mode === 'sign-up' ? <Text style={styles.legal}>By creating this shared login, you agree to the CollectBoss Terms of Service and Privacy Policy. Product selection follows account confirmation.</Text> : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void (mode === 'sign-up' ? submitSignUp() : submitSignIn())}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, busy && styles.disabled]}
            >
              <Text style={[styles.primaryButtonText, busy && styles.disabledText]}>{busy ? (mode === 'sign-up' ? 'Creating account…' : 'Signing in…') : (mode === 'sign-up' ? 'Create account securely' : 'Sign in securely')}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: CollectBossTokens.color.canvas },
  content: { width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 34, paddingBottom: 48, gap: 20 },
  hero: { gap: 12 },
  title: { color: CollectBossTokens.color.navy, fontSize: 31, lineHeight: 37, fontWeight: '700' },
  subtitle: { color: CollectBossTokens.color.mutedForeground, fontSize: 16, lineHeight: 23 },
  card: { gap: 15, borderRadius: 20, borderWidth: 1, borderColor: CollectBossTokens.color.border, backgroundColor: CollectBossTokens.color.surface, padding: 20 },
  cardTitle: { color: CollectBossTokens.color.navy, fontSize: 24, fontWeight: '700' },
  body: { color: CollectBossTokens.color.mutedForeground, fontSize: 15, lineHeight: 22 },
  modeRow: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: CollectBossTokens.color.surfaceMuted },
  modeButton: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 8 },
  modeButtonSelected: { backgroundColor: CollectBossTokens.color.surface },
  modeText: { color: CollectBossTokens.color.mutedForeground, fontSize: 14, fontWeight: '600' },
  modeTextSelected: { color: CollectBossTokens.color.navy, fontWeight: '700' },
  field: { gap: 7 },
  label: { color: CollectBossTokens.color.foreground, fontSize: 14, fontWeight: '600' },
  input: { minHeight: 52, borderRadius: 13, borderWidth: 1, borderColor: CollectBossTokens.color.border, backgroundColor: CollectBossTokens.color.surface, color: CollectBossTokens.color.foreground, paddingHorizontal: 14, fontSize: 16 },
  errorBox: { borderRadius: 12, borderWidth: 1, borderColor: CollectBossTokens.color.dangerBorder, backgroundColor: CollectBossTokens.color.dangerSurface, padding: 13 },
  errorText: { color: CollectBossTokens.color.foreground, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  legal: { color: CollectBossTokens.color.mutedForeground, fontSize: 11, lineHeight: 17 },
  primaryButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: CollectBossTokens.color.primary, paddingHorizontal: 16 },
  primaryButtonPressed: { backgroundColor: CollectBossTokens.color.primaryPressed },
  primaryButtonText: { color: CollectBossTokens.color.inverseForeground, fontSize: 15, fontWeight: '700' },
  disabled: { backgroundColor: CollectBossTokens.color.disabledSurface, borderWidth: 1, borderColor: CollectBossTokens.color.disabledBorder },
  disabledText: { color: CollectBossTokens.color.disabledText },
});
