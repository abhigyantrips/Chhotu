import type { APIContext } from "astro";
import { OWNER, OWNER_ID, SESSION_SECONDS } from "./config";
import { seal, unseal } from "./crypto";
import { AppError } from "./errors";
import { github } from "./github";

export interface Secrets {
	APP_ORIGIN: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	SESSION_SECRET: string;
}
export type Session = {
	kind: "session";
	expires: number;
	token: string;
	login: string;
	userId: number;
	tokenExpires?: number;
	refreshToken?: string;
	refreshExpires?: number;
};
export interface OAuthTokens {
	access_token: string;
	scope?: string;
	expires_in?: number;
	refresh_token?: string;
	refresh_token_expires_in?: number;
}
export type OAuthState = { kind: "oauth"; expires: number; state: string; verifier: string };
export function configured(env: Secrets) {
	return !!(
		env.APP_ORIGIN &&
		env.GITHUB_CLIENT_ID &&
		env.GITHUB_CLIENT_SECRET &&
		env.SESSION_SECRET?.length >= 32
	);
}
export function cookieName(context: Pick<APIContext, "url">, kind = "session") {
	return `${context.url.protocol === "https:" ? "__Host-" : ""}chhotu-${kind}`;
}
function cookieOptions(context: Pick<APIContext, "url">, seconds: number) {
	return {
		path: "/",
		httpOnly: true,
		secure: context.url.protocol === "https:",
		sameSite: "lax" as const,
		maxAge: seconds,
	};
}
export async function getSession(context: Pick<APIContext, "cookies" | "url">, env: Secrets) {
	const session = await unseal<Session>(
		context.cookies.get(cookieName(context))?.value,
		env.SESSION_SECRET,
		"session"
	);
	return session?.login === OWNER &&
		session.userId === OWNER_ID &&
		typeof session.token === "string"
		? session
		: null;
}
export async function requireSession(context: Pick<APIContext, "cookies" | "url">, env: Secrets) {
	const session = await getSession(context, env);
	if (!session || (session.tokenExpires !== undefined && session.tokenExpires <= Date.now()))
		throw new AppError(401, "sign in with GitHub to publish. your draft is saved on this device.");
	return session;
}
export function validTokens(value: unknown): value is OAuthTokens {
	if (!value || typeof value !== "object") return false;
	const data = value as OAuthTokens;
	const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
	return (
		typeof data.access_token === "string" &&
		!!data.access_token &&
		(data.scope === undefined || typeof data.scope === "string") &&
		(data.expires_in === undefined || positive(data.expires_in)) &&
		(data.refresh_token === undefined ||
			(typeof data.refresh_token === "string" && !!data.refresh_token)) &&
		(data.refresh_token_expires_in === undefined || positive(data.refresh_token_expires_in))
	);
}
export async function setSession(
	context: Pick<APIContext, "cookies" | "url">,
	env: Secrets,
	token: string,
	tokens?: OAuthTokens,
	sessionExpires = Date.now() + SESSION_SECONDS * 1000
) {
	const now = Date.now();
	const session: Session = {
		kind: "session",
		expires: sessionExpires,
		token,
		login: OWNER,
		userId: OWNER_ID,
		...(tokens?.expires_in !== undefined ? { tokenExpires: now + tokens.expires_in * 1000 } : {}),
		...(tokens?.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
		...(tokens?.refresh_token_expires_in !== undefined
			? { refreshExpires: now + tokens.refresh_token_expires_in * 1000 }
			: {}),
	};
	context.cookies.set(
		cookieName(context),
		await seal(session, env.SESSION_SECRET),
		cookieOptions(context, Math.max(0, Math.floor((sessionExpires - now) / 1000)))
	);
}
// Only POST /api/session renews credentials. The browser serializes these calls
// across tabs with Web Locks, so two tabs cannot rotate the same refresh token.
export async function refreshSession(context: Pick<APIContext, "cookies" | "url">, env: Secrets) {
	const session = await getSession(context, env);
	if (!session) return null;
	if (session.tokenExpires === undefined || session.tokenExpires > Date.now() + 60_000)
		return session;
	if (
		!session.refreshToken ||
		(session.refreshExpires !== undefined && session.refreshExpires <= Date.now())
	)
		throw new AppError(401, "your GitHub session expired. sign in again; your draft is safe.");
	const response = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		signal: AbortSignal.timeout(20_000),
		headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			grant_type: "refresh_token",
			refresh_token: session.refreshToken,
		}),
	});
	if (response.status >= 500 || response.status === 429)
		throw new AppError(
			502,
			"GitHub couldn’t renew your session right now. your draft is safe; please try again."
		);
	const data: unknown = await response.json();
	if (!response.ok || !validTokens(data))
		throw new AppError(401, "your GitHub session expired. sign in again; your draft is safe.");
	// GitHub requires identity to be checked each time a new access token is issued.
	const user = await github<{ id: number; login: string }>(data.access_token, "/user");
	if (user.id !== OWNER_ID || user.login !== OWNER)
		throw new AppError(401, "sign in with your own GitHub account. your draft is safe.");
	await setSession(context, env, data.access_token, data, session.expires);
	return { ...session, token: data.access_token };
}
export function clearSession(context: Pick<APIContext, "cookies" | "url">) {
	context.cookies.delete(cookieName(context), { path: "/" });
}
export async function setOAuth(
	context: Pick<APIContext, "cookies" | "url">,
	env: Secrets,
	state: string,
	verifier: string
) {
	context.cookies.set(
		cookieName(context, "oauth"),
		await seal(
			{ kind: "oauth", expires: Date.now() + 600_000, state, verifier },
			env.SESSION_SECRET
		),
		cookieOptions(context, 600)
	);
}
export async function consumeOAuth(context: Pick<APIContext, "cookies" | "url">, env: Secrets) {
	const value = context.cookies.get(cookieName(context, "oauth"))?.value;
	context.cookies.delete(cookieName(context, "oauth"), { path: "/" });
	return unseal<OAuthState>(value, env.SESSION_SECRET, "oauth");
}
export function requireOrigin(request: Request, env: Secrets) {
	if (!env.APP_ORIGIN || request.headers.get("Origin") !== new URL(env.APP_ORIGIN).origin)
		throw new AppError(403, "please publish from Chhotu itself.");
}
