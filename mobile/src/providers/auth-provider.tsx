import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { isSupabaseConfigured, requireSupabase, supabase } from '@/lib/supabase';
import { completeRegistration, provisionRegistration, registrationEmailRedirectUrl } from '@/lib/registration';
import {
  readUserRegistration,
  type RegistrationDetails,
  type RegistrationProduct,
} from '../../../shared/registration-contracts';

type MobileSignUpResult = { needsConfirmation: boolean };

type AuthContextValue = {
  configured: boolean;
  initializing: boolean;
  session: Session | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<MobileSignUpResult>;
  chooseProduct: (details: RegistrationDetails, mainRulesAccepted: boolean) => Promise<RegistrationProduct>;
  prepareRegisteredWorkspace: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(async ({ data, error }) => {
      const recoveredSession = error ? null : data.session;
      if (recoveredSession && readUserRegistration(recoveredSession.user)) {
        await provisionRegistration(recoveredSession.access_token).catch(() => undefined);
      }
      if (mounted) {
        setSession(recoveredSession);
        setInitializing(false);
      }
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession);
    });
    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: isSupabaseConfigured,
      initializing,
      session,
      async signIn(email, password) {
        const { data, error } = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        if (data.session && readUserRegistration(data.user)) {
          await provisionRegistration(data.session.access_token);
        }
      },
      async signUp(email, password) {
        const { data, error } = await requireSupabase().auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: registrationEmailRedirectUrl(),
          },
        });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      },
      async chooseProduct(details, mainRulesAccepted) {
        if (!session) throw new Error('Your secure session has expired. Sign in again.');
        return completeRegistration(session.access_token, details, mainRulesAccepted);
      },
      async prepareRegisteredWorkspace() {
        if (session && readUserRegistration(session.user)) {
          await provisionRegistration(session.access_token);
        }
      },
      async signOut() {
        const { error } = await requireSupabase().auth.signOut();
        if (error) throw error;
      },
    }),
    [initializing, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
