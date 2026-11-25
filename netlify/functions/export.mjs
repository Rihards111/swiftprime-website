// CSV for Warmerly import: GET /api/export?campaign=<name>[&all=1]   (logged in)
// Default: only approved leads of that campaign that were not exported before; they get marked exported.
import { readJSON, writeJSON, isLoggedIn, json } from './lib/common.mjs';

export const exportGroup = (l) => {
  const c = String(l.campaign || 'Other').replace(/\s*\(not in Warmerly yet\)\s*/i, '').trim();
  if (/^LV/i.test(c) && !l.firstName) return 'LV – bez vārda';
  return c;
};
const cleanCompany = (c) => String(c || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
const cell = (v) => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

export default async (req) => {
  if (!isLoggedIn(req)) return json({ error: 'unauthorized' }, 401);
  const u = new URL(req.url);
  const group = u.searchParams.get('campaign') || '';
  const all = u.searchParams.get('all') === '1';
  const leads = await readJSON('leads', []);
  const rows = leads
    .filter((l) => l.status === 'approved' && l.email && exportGroup(l) === group && (all || !l.exportedAt))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const english = !/^LV/i.test(group);
  const header = group === 'LV – bez vārda' ? ['email', 'companyName', 'personal_line', 'website'] : ['email', 'firstName', 'companyName', 'personal_line', 'website'];
  const lines = [header.join(',')].concat(rows.map((l) => {
    const r = { email: l.email, firstName: l.firstName || (english ? 'there' : ''), companyName: cleanCompany(l.company), personal_line: l.personalLine || '', website: l.website || '' };
    return header.map((h) => cell(r[h])).join(',');
  }));
  if (rows.length) {
    const now = new Date().toISOString();
    rows.forEach((l) => { if (!l.exportedAt) l.exportedAt = now; });
    await writeJSON('leads', leads);
  }
  const name = (group || 'leads').replace(/[^\w-]+/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
  return new Response('﻿' + lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + name + '"', 'Cache-Control': 'no-store' }
  });
};

export const config = { path: '/api/export' };
