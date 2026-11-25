// "Start lead search now" button: fires the Claude scheduled task through its API trigger.
// Needs ROUTINE_FIRE_URL and ROUTINE_TOKEN in Netlify environment variables (set by Rihards, never in code).
import { isLoggedIn, json, env, readJSON, writeJSON } from './lib/common.mjs';

export default async (req) => {
  if (!isLoggedIn(req)) return json({ error: 'unauthorized' }, 401);
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = env('ROUTINE_FIRE_URL'), token = env('ROUTINE_TOKEN');
  if (!url || !token) return json({ error: 'Start button not set up yet (ROUTINE_FIRE_URL / ROUTINE_TOKEN missing in Netlify).' }, 400);
  const last = await readJSON('run-started', null);
  if (last && Date.now() - new Date(last).getTime() < 30 * 60e3) return json({ error: 'A run was started less than 30 minutes ago. Give it time to finish.' }, 429);
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Started from the panel (Start lead search now).' })
  });
  const txt = await r.text();
  if (!r.ok) return json({ error: 'Claude answered ' + r.status + ': ' + txt.slice(0, 200) }, 502);
  await writeJSON('run-started', new Date().toISOString());
  return json({ ok: true });
};

export const config = { path: '/api/run' };
