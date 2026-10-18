const encoder = new TextEncoder();
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export function randomToken() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function challenge(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
async function key(secret: string) {
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', encoder.encode(secret)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
type Envelope = { kind: string; expires: number; [key: string]: unknown };
export async function seal(value: Envelope, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('chhotu:v1') }, await key(secret), encoder.encode(JSON.stringify(value))));
  return `${base64url(iv)}.${base64url(encrypted)}`;
}
export async function unseal<T extends Envelope>(value: string | undefined, secret: string, kind: string): Promise<T | null> {
  if (!value || value.length > 8000) return null;
  try {
    const [iv, encrypted, extra] = value.split('.');
    if (!iv || !encrypted || extra) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode('chhotu:v1') }, await key(secret), decode(encrypted));
    const result = JSON.parse(new TextDecoder().decode(plain));
    return result.kind === kind && Number.isFinite(result.expires) && result.expires > Date.now() ? result as T : null;
  } catch { return null; }
}
