// Shared helpers for the Swiftprime panel functions.
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

export const store = () => getStore({ name: 'panel', consistency: 'strong' });

export async function readJSON(key, fallback) {
  const v = await store().get(key, { type: 'json' });
  return v == null ? fallback : v;
}
export async function writeJSON(key, value) {
  await store().setJSON(key, value);
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const env = (k) => (typeof Netlify !== 'undefined' && Netlify.env ? Netlify.env.get(k) : process.env[k]);
export { env };

function hmac(text) {
  return crypto.createHmac('sha256', env('PANEL_PASSWORD') || 'unset').update(text).digest('hex');
}
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function checkPassword(pw) {
  const real = env('PANEL_PASSWORD');
  return !!real && safeEqual(pw || '', real);
}
export function makeSession() {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  return exp + '.' + hmac('panel:' + exp);
}
export function sessionCookie(value, maxAge = 30 * 24 * 3600) {
  return `sp_panel=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
export function isLoggedIn(req) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)sp_panel=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  return Number(exp) > Date.now() && safeEqual(sig || '', hmac('panel:' + exp));
}
export function hasApiKey(req) {
  const real = env('PANEL_API_KEY');
  return !!real && safeEqual(req.headers.get('x-api-key') || '', real);
}

export const today = () => new Date().toISOString().slice(0, 10);
export const uid = () => crypto.randomBytes(6).toString('hex');
