import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, challenge, randomToken } from '../src/lib/crypto';
import { requireOrigin, getSession, setSession, consumeOAuth, setOAuth, refreshSession, requireSession, validTokens, type Secrets } from '../src/lib/auth';
import type { APIContext } from 'astro';

const secret = 'test-secret-only-'.repeat(4);
const env: Secrets = { SESSION_SECRET: secret, APP_ORIGIN: 'https://chhotu.abhi.now', GITHUB_CLIENT_ID: 'test', GITHUB_CLIENT_SECRET: 'test' };
function context() {
  const cookies = new Map<string, { value: string; options: Record<string, unknown> }>();
  return { cookies, ctx: { url: new URL(env.APP_ORIGIN), cookies: { get: (key: string) => cookies.get(key), set: (key: string, value: string, options: Record<string, unknown>) => cookies.set(key, { value, options }), delete: (key: string) => cookies.delete(key) } } as unknown as Pick<APIContext, 'url' | 'cookies'> };
}
test('encrypts tokens and rejects tampered, expired, or wrong-kind cookies', async () => {
  const value = await seal({ kind: 'session', expires: Date.now()+60_000, token: 'private-test-token' }, secret);
  assert.equal(value.includes('private-test-token'), false);
  assert.equal((await unseal(value, secret, 'session'))?.token, 'private-test-token');
  const [iv, ciphertext] = value.split('.');
  assert.equal(await unseal(`${iv}.${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`, secret, 'session'), null);
  assert.equal(await unseal(value, 'different-secret-'.repeat(4), 'session'), null);
  assert.equal(await unseal(value, secret, 'oauth'), null);
  assert.equal(await unseal(await seal({ kind: 'session', expires: Date.now()-1 }, secret), secret, 'session'), null);
});
test('stores the OAuth token only in a secure HttpOnly host-only cookie', async () => {
  const { cookies, ctx } = context(); await setSession(ctx, env, 'private-test-token');
  const cookie = cookies.get('__Host-chhotu-session')!;
  assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.secure, true); assert.equal(cookie.options.path, '/'); assert.equal(cookie.options.sameSite, 'lax'); assert.equal(cookie.options.domain, undefined);
  assert.equal((await getSession(ctx, env))?.login, 'abhigyantrips');
  cookies.set('__Host-chhotu-session', { ...cookie, value: await seal({ kind: 'session', expires: Date.now()+60_000, token: 'x', login: 'abhigyantrips', userId: 123 }, secret) });
  assert.equal(await getSession(ctx, env), null);
});
test('requires both the pinned account ID and username', async () => {
  const { cookies, ctx } = context();
  cookies.set('__Host-chhotu-session', { value: await seal({ kind: 'session', expires: Date.now()+60_000, token: 'x', login: 'someoneelse', userId: 28886624 }, secret), options: {} });
  assert.equal(await getSession(ctx, env), null);
});
test('consumes OAuth state once and derives the PKCE challenge correctly', async () => {
  const { ctx } = context(); const state = randomToken(); const verifier = randomToken();
  assert.equal(state.length,43); assert.notEqual(state,verifier);
  await setOAuth(ctx,env,state,verifier);
  assert.equal((await consumeOAuth(ctx,env))?.state,state);
  assert.equal(await consumeOAuth(ctx,env), null);
  assert.equal(await challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('rejects cross-origin and missing-origin mutations', () => {
  for (const origin of ['https://evil.example', 'https://chhotu.abhi.now.evil.example', 'null', '']) assert.throws(() => requireOrigin(new Request(env.APP_ORIGIN, { headers: origin ? { Origin: origin } : {} }), env));
  assert.doesNotThrow(() => requireOrigin(new Request(env.APP_ORIGIN, { headers: { Origin: env.APP_ORIGIN } }), env));
});
test('validates both non-expiring and expiring GitHub token responses', () => {
  assert.equal(validTokens({ access_token: 'x' }), true);
  assert.equal(validTokens({ access_token: 'x', expires_in: 28800, refresh_token: 'refresh', refresh_token_expires_in: 15897600 }), true);
  for (const input of [null, { access_token: '' }, { access_token: 'x', expires_in: -1 }, { access_token: 'x', expires_in: '28800' }, { access_token: 'x', scope: [] }, { access_token: 'x', refresh_token: 42 }, { access_token: 'x', refresh_token_expires_in: Infinity }]) assert.equal(validTokens(input), false);
});
test('does not refresh long-lived or still-valid access tokens', async () => {
  const { ctx } = context();
  await setSession(ctx, env, 'long-lived');
  assert.equal((await refreshSession(ctx, env))?.token, 'long-lived');
  await setSession(ctx, env, 'still-valid', { access_token: 'still-valid', expires_in: 28800, refresh_token: 'refresh' });
  assert.equal((await refreshSession(ctx, env))?.token, 'still-valid');
});
test('rotates expiring tokens inside the encrypted cookie and preserves session expiry', async () => {
  const { cookies, ctx } = context();
  await setSession(ctx, env, 'old-access', { access_token: 'old-access', expires_in: 1, refresh_token: 'old-refresh', refresh_token_expires_in: 100 });
  const before = (await getSession(ctx,env))!;
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    if (String(url).endsWith('/login/oauth/access_token')) {
      const params = new URLSearchParams(init?.body as URLSearchParams);
      assert.equal(params.get('refresh_token'), 'old-refresh');
      assert.equal(params.get('grant_type'), 'refresh_token');
      assert.equal(params.get('client_secret'), env.GITHUB_CLIENT_SECRET);
      return Response.json({ access_token: 'new-access', expires_in: 28800, refresh_token: 'new-refresh', refresh_token_expires_in: 15897600 });
    }
    assert.equal((init?.headers as Record<string,string>).Authorization, 'Bearer new-access');
    return Response.json({ id: 28886624, login: 'abhigyantrips' });
  };
  try {
    assert.equal((await refreshSession(ctx,env))?.token,'new-access');
    const renewed = (await getSession(ctx,env))!;
    assert.equal(requests,2);
    assert.equal(renewed.refreshToken,'new-refresh');
    assert.equal(renewed.expires,before.expires);
    assert.ok(renewed.tokenExpires! > Date.now()+28000*1000);
    assert.equal(cookies.get('__Host-chhotu-session')!.value.includes('new-refresh'),false);
  } finally { globalThis.fetch=original; }
});
test('expired refresh tokens require sign-in and do not contact GitHub', async () => {
  const { cookies, ctx } = context();
  const value = await seal({ kind:'session', expires:Date.now()+60_000, token:'expired-access', tokenExpires:Date.now()-1, refreshToken:'expired-refresh', refreshExpires:Date.now()-1, login:'abhigyantrips', userId:28886624 }, secret);
  cookies.set('__Host-chhotu-session',{value, options:{}});
  await assert.rejects(refreshSession(ctx,env), /sign in again/);
  await assert.rejects(requireSession(ctx,env), /sign in with GitHub/);
});
test('revoked refresh tokens ask for sign-in without logging token values', async () => {
  const { ctx } = context();
  await setSession(ctx,env,'old',{access_token:'old',expires_in:1,refresh_token:'revoked'});
  const original=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({error:'bad_refresh_token',error_description:'private upstream details'});
  try { await assert.rejects(refreshSession(ctx,env), /session expired.*draft is safe/); }
  finally {globalThis.fetch=original;}
});
test('transient renewal errors preserve the session for a later retry', async () => {
  const { ctx } = context();
  await setSession(ctx,env,'old',{access_token:'old',expires_in:1,refresh_token:'refresh'});
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response('unavailable',{status:503});
  try {
    await assert.rejects(refreshSession(ctx,env), /couldn’t renew/);
    assert.equal((await getSession(ctx,env))?.refreshToken,'refresh');
  } finally {globalThis.fetch=original;}
});
test('renewal revalidates the pinned GitHub identity before storing new credentials', async () => {
  const { ctx } = context();
  await setSession(ctx,env,'old',{access_token:'old',expires_in:1,refresh_token:'refresh'});
  const original=globalThis.fetch;
  globalThis.fetch=async url=>Response.json(String(url).endsWith('/user') ? {id:123,login:'somebodyelse'} : {access_token:'new',expires_in:28800,refresh_token:'new-refresh'});
  try { await assert.rejects(refreshSession(ctx,env), /your own GitHub account/); assert.equal((await getSession(ctx,env))?.token,'old'); }
  finally {globalThis.fetch=original;}
});
