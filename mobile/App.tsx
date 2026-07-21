import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CollectBossApp } from '@/components/collectboss-app';
import { AuthProvider } from '@/providers/auth-provider';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <CollectBossApp />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
