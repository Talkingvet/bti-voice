import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId:    'com.businesstechnologyinsight.btivoice',
  appName:  'BTI Voice',
  webDir:   'dist',
  server: {
    // For production the bundled dist/ files are served locally and all
    // API calls go to Railway via the VITE_API_URL baked in at build time.
    androidScheme: 'https',
  },
  ios: {
    contentInset:         'always',
    backgroundColor:      '#0f1117',
    preferredContentMode: 'mobile',
    // Allow WebRTC (Twilio Voice) to use the microphone inside WKWebView
    // The NSMicrophoneUsageDescription string is set in Xcode Info.plist
    // (see build-ios.sh instructions)
  },
};

export default config;
