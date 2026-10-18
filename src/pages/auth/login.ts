import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { configured, setOAuth } from '../../lib/auth';
import { challenge, randomToken } from '../../lib/crypto';

export const GET: APIRoute = async context => {
  if (!configured(env)) return context.redirect('/login?error=setup');
  const state = randomToken();
  const verifier = randomToken();
  await setOAuth(context, env, state, verifier);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${new URL(env.APP_ORIGIN).origin}/auth/callback`, scope: 'public_repo', state, code_challenge: await challenge(verifier), code_challenge_method: 'S256', allow_signup: 'false', login: 'abhigyantrips' }).toString();
  return context.redirect(url.toString());
};
