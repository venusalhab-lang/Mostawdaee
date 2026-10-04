import type { CapacitorConfig } from '@capacitor/cli';

const devServer = process.env.CAPACITOR_DEV_SERVER;

const config: CapacitorConfig = {
  appId: 'com.mostawdaee.app',
  appName: 'مستودعي',
  webDir: 'dist',
  ...(devServer
    ? { server: { url: devServer, cleartext: devServer.startsWith('http://') } }
    : {}),
};

export default config;
