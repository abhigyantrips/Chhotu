/// <reference types="astro/client" />
/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite-plugin-pwa/info" />
declare namespace Cloudflare {
  interface Env {
    APP_ORIGIN: string;
    GITHUB_CLIENT_ID: string;
    GITHUB_CLIENT_SECRET: string;
    SESSION_SECRET: string;
  }
}
// Only the binding import is needed. Keeping Worker runtime globals out of the
// browser type environment avoids collisions with DOM APIs such as HTMLElement.
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
}
