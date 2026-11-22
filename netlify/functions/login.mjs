// Panel login / logout. The password lives only in Netlify (PANEL_PASSWORD).
import { checkPassword, makeSession, sessionCookie, json } from './lib/common.mjs';

export default async (req) => {
  if (req.method === 'DELETE') return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let body = {};
  try { body = await req.json(); } catch {}
  await new Promise((r) => setTimeout(r, 400)); // slow down guessing
  if (!checkPassword(body.password)) return json({ ok: false }, 401);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(makeSession()) });
};

export const config = { path: '/api/login' };
