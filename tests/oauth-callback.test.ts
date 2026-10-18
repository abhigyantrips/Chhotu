import type { APIContext } from "astro";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { getSession, setOAuth, setSession, type Secrets } from "../src/lib/auth";

const env: Secrets = {
	APP_ORIGIN: "https://chhotu.abhi.now",
	GITHUB_CLIENT_ID: "callback-test-client",
	GITHUB_CLIENT_SECRET: "callback-test-secret",
	SESSION_SECRET: "callback-test-session-secret-".repeat(2),
};
// Import the real route with test-only Worker bindings; no live OAuth requests.
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "cloudflare:workers")
			return {
				url: `data:text/javascript,${encodeURIComponent(`export const env = ${JSON.stringify(env)};`)}`,
				shortCircuit: true,
			};
		return nextResolve(specifier, context);
	},
});
const { GET } = await import("../src/pages/auth/callback");
hooks.deregister();

async function callbackAs(user: { login: string; id: number }) {
	const cookies = new Map<string, { value: string }>();
	const context = {
		url: new URL(`${env.APP_ORIGIN}/auth/callback?code=test-code&state=test-state`),
		cookies: {
			get: (key: string) => cookies.get(key),
			set: (key: string, value: string) => cookies.set(key, { value }),
			delete: (key: string) => cookies.delete(key),
		},
		redirect: (location: string) =>
			new Response(null, { status: 302, headers: { Location: location } }),
	} as unknown as APIContext;
	await setOAuth(context, env, "test-state", "test-verifier");
	// A rejected account must not retain an earlier owner session in this browser.
	await setSession(context, env, "previous-test-token");
	const original = globalThis.fetch;
	globalThis.fetch = async (url) =>
		Response.json(
			String(url).endsWith("/user")
				? user
				: { access_token: "new-test-token", scope: "public_repo" }
		);
	try {
		const response = await GET(context);
		return { response, session: await getSession(context, env) };
	} finally {
		globalThis.fetch = original;
	}
}

test("another GitHub account goes to the video and receives no session", async () => {
	const { response, session } = await callbackAs({ login: "someone-else", id: 123 });
	assert.equal(response.status, 302);
	assert.equal(response.headers.get("Location"), "https://www.youtube.com/watch?v=cw9FIeHbdB8");
	assert.equal(session, null);
});

test("the redirect still requires the pinned account ID as well as the username", async () => {
	for (const user of [
		{ login: "abhigyantrips", id: 123 },
		{ login: "someone-else", id: 28886624 },
	]) {
		const { response, session } = await callbackAs(user);
		assert.equal(response.headers.get("Location"), "https://www.youtube.com/watch?v=cw9FIeHbdB8");
		assert.equal(session, null);
	}
});

test("the owner still signs in and goes straight to the editor", async () => {
	const { response, session } = await callbackAs({ login: "abhigyantrips", id: 28886624 });
	assert.equal(response.headers.get("Location"), "/snippets");
	assert.equal(session?.token, "new-test-token");
});
