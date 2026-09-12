import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MobileProductGate } from '@/components/product-gate';
import { AuthProvider } from '@/providers/auth-provider';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <MobileProductGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
