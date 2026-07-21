# CollectBoss Mobile (Expo SDK 54)

This is the mobile companion colocated with the CollectBoss web app. Scanning its Expo Go QR code opens the real secured CollectBoss experience, not the former runtime test screen.

## Configure

Copy `.env.example` to `.env` and set:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Never use the Supabase service-role key here. Every `EXPO_PUBLIC_` value is readable from the installed client.

## Run in Expo Go

```powershell
npm.cmd install
npm.cmd start
```

Connect the phone and computer to the same network and scan the QR code with the current Expo Go app. If LAN discovery is blocked, use:

```powershell
node ./node_modules/expo/bin/cli start --tunnel --clear
```

## Verify

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run export
node ./node_modules/expo/bin/cli install --check
```
