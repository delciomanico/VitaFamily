import type { CapacitorConfig } from '@capacitor/cli'

/**
 * APK de teste local (não versionado): embrulha a PWA já publicada em produção, apontando o
 * WebView diretamente para o domínio real para ter a mesma origem/API que o browser.
 */
const config: CapacitorConfig = {
  appId: 'com.cassfrei.vitafamily',
  appName: 'Vita Family',
  webDir: 'dist',
  server: {
    url: 'https://vitafamily.cassfrei.com',
    androidScheme: 'https',
  },
}

export default config
