import { registerSW } from 'virtual:pwa-register';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installPrompt: InstallPrompt | null = null;
const install = document.getElementById('install');
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event as InstallPrompt;
  if (install) install.hidden = false;
});
install?.addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt(); await installPrompt.userChoice;
  installPrompt = null; install.hidden = true;
});
window.addEventListener('appinstalled', () => { if (install) install.hidden = true; });
if (import.meta.env.PROD) {
  // Prompt mode leaves updates waiting until the running editor is closed.
  registerSW({ immediate: true, onRegisterError() { /* Writing works without offline caching. */ } });
}
