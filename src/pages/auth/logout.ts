import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { clearSession, requireOrigin } from '../../lib/auth';
import { errorResponse, json } from '../../lib/errors';
export const POST: APIRoute = context => {
  try { requireOrigin(context.request, env); clearSession(context); return json({ ok: true }); }
  catch (error) { return errorResponse(error); }
};
