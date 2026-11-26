// Called by a small Google Apps Script on each brief form when someone submits it.
// Body: {email, form}. Only marks a lead that matches the email; never creates or deletes anything.
import { readJSON, writeJSON, json } from './lib/common.mjs';

const OPEN = ['found', 'approved', 'contacted', 'followup1', 'followup2', 'replied', 'interested', 'brief_sent', 'lost_brief', 'recontact'];

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  let b = {};
  try { b = JSON.parse(await req.text()); } catch {}
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const form = String(b.form || '').replace(/[^\w-]/g, '').slice(0, 30);
  if (!email.includes('@')) return json({ ok: false, error: 'no email' }, 400);
  const leads = await readJSON('leads', []);
  const l = leads.find((x) => String(x.email || '').trim().toLowerCase() === email);
  const at = new Date().toISOString();
  if (!l) {
    const inbox = await readJSON('briefs-unmatched', []);
    inbox.unshift({ email, form, at }); await writeJSON('briefs-unmatched', inbox.slice(0, 100));
    return json({ ok: true, matched: false });
  }
  l.briefFilledAt = at; l.briefForm = form || l.briefForm;
  l.history = l.history || [];
  if (OPEN.includes(l.status)) { l.status = 'qualified'; l.history.push({ s: 'qualified', at, note: 'filled the brief (' + (form || 'form') + ')', by: 'brief form' }); }
  else l.history.push({ s: l.status, at, note: 'filled the brief again (' + (form || 'form') + ')', by: 'brief form' });
  await writeJSON('leads', leads);
  return json({ ok: true, matched: true });
};

export const config = { path: '/api/brief-done' };
