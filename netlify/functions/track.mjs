// Anonymous click counter: stores only {day, button, page} counts. No cookies, no IP, nothing personal.
import { readJSON, writeJSON, today } from './lib/common.mjs';

export default async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  let body = {};
  try { body = JSON.parse(await req.text()); } catch {}
  const e = String(body.e || '').slice(0, 60).replace(/[^\w-]/g, '');
  const p = String(body.p || '/').slice(0, 80);
  const r = String(body.r || '').slice(0, 80).replace(/[^\w.-]/g, '');
  if (!e) return new Response(null, { status: 204 });
  const key = 'clicks-' + today().slice(0, 7);
  const data = await readJSON(key, {});
  const d = today();
  data[d] = data[d] || {};
  const k = e + '|' + p + '|' + r;
  data[d][k] = (data[d][k] || 0) + 1;
  await writeJSON(key, data);
  return new Response(null, { status: 204 });
};

export const config = { path: '/api/track' };
