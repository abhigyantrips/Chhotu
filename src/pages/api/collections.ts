import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { clearSession, requireSession } from "../../lib/auth";
import { AppError, errorResponse, json } from "../../lib/errors";
import { getSnapshot } from "../../lib/github";
export const GET: APIRoute = async (context) => {
	try {
		const { token } = await requireSession(context, env);
		const { head, collections } = await getSnapshot(token);
		return json({ head, collections });
	} catch (error) {
		if (error instanceof AppError && error.status === 401) clearSession(context);
		return errorResponse(error);
	}
};
