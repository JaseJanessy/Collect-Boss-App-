import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { secureSessionStorage } from '@/lib/secure-session-storage';

type SupabaseExpoConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

const expoConfig = Constants.expoConfig?.extra as SupabaseExpoConfig | undefined;
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() || expoConfig?.supabaseUrl?.trim();
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() || expoConfig?.supabaseAnonKey?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const isServerRenderedWeb = Platform.OS === 'web' && typeof window === 'undefined';

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: isServerRenderedWeb
        ? {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          }
        : {
            storage: secureSessionStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: false,
          },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'CollectBoss mobile is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to a local .env file, then restart Expo.'
    );
  }
  return supabase;
}
