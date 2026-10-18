export class AppError extends Error {
  constructor(public status: number, message: string, public link?: string) { super(message); }
}
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
export function errorResponse(error: unknown) {
  if (error instanceof AppError) return json({ error: error.message, link: error.link }, error.status);
  // Never return or log upstream credentials, request bodies, or OAuth codes.
  return json({ error: 'couldn’t reach GitHub. your draft is safe; please try again.' }, 502);
}
