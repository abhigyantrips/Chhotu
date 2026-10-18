import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { configured, consumeOAuth, setSession, validTokens } from '../../lib/auth';
import { OWNER, OWNER_ID } from '../../lib/config';
import { github } from '../../lib/github';

export const GET: APIRoute = async context => {
  if (!configured(env)) return context.redirect('/login?error=setup');
  const state = await consumeOAuth(context, env);
  if (!state || state.state !== context.url.searchParams.get('state')) return context.redirect('/login?error=expired');
  if (context.url.searchParams.has('error')) return context.redirect('/login?error=cancelled');
  const code = context.url.searchParams.get('code');
  if (!code) return context.redirect('/login?error=failed');
  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${new URL(env.APP_ORIGIN).origin}/auth/callback`, code_verifier: state.verifier }),
    });
    const data: unknown = await response.json();
    if (!response.ok || !validTokens(data) || !data.scope?.split(/[ ,]+/).some(scope => scope === 'public_repo' || scope === 'repo')) return context.redirect('/login?error=failed');
    const user = await github<{ id: number; login: string }>(data.access_token, '/user');
    if (user.id !== OWNER_ID || user.login !== OWNER) return context.redirect('/login?error=denied');
    await setSession(context, env, data.access_token, data);
    return context.redirect('/snippets');
  } catch { return context.redirect('/login?error=failed'); }
};
