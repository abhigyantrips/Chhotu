import { defineMiddleware } from 'astro:middleware';
export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (context.url.pathname.startsWith('/api/') || context.url.pathname.startsWith('/auth/')) response.headers.set('Cache-Control', 'no-store');
  return response;
});
