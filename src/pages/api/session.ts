import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { clearSession, configured, getSession, refreshSession, requireOrigin } from '../../lib/auth';
import { AppError, errorResponse, json } from '../../lib/errors';
export const GET: APIRoute = async context => {
  const session = await getSession(context, env);
  return json({ authenticated: !!session, configured: configured(env), login: session?.login });
};
export const POST: APIRoute = async context => {
  try {
    requireOrigin(context.request, env);
    const session = await refreshSession(context, env);
    return json({ authenticated: !!session, configured: configured(env), login: session?.login });
  } catch (error) {
    if (error instanceof AppError && error.status === 401) clearSession(context);
    return errorResponse(error);
  }
};
