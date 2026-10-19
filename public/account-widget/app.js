const native = window.__TAURI__?.core;
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const compact = value => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(value);
const providerNames = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity', gemini: 'Gemini' };
let base = 'http://localhost:20127';
let pinned = true;
let busy = false;
let snapshot = null;
let receivedAt = null;
let offline = false;
try {
  base = localStorage.getItem('router-url') || base;
  pinned = localStorage.getItem('pinned') !== 'false';
} catch { /* Widget remains usable when browser storage is unavailable. */ }
$('url').value = base;
$('pin').hidden = !native;
$('quit').hidden = !native;
$('urlLabel').hidden = !native;
function save(key, value) { try { localStorage.setItem(key, value); } catch {} }

function relative(value) {
  if (!value) return 'Not reported';
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 'Not reported';
  if (ms <= 0) return 'Due now';
  const minutes = Math.ceil(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
function stamp(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not reported';
}
function countdown(value, prefix = '') {
  return `<span data-time="${esc(value || '')}" data-prefix="${esc(prefix)}" title="${esc(stamp(value))}">${esc(value ? prefix + relative(value) : 'Not reported')}</span>`;
}
function meter(quota) {
  const pct = typeof quota.remaining === 'number' && Number.isFinite(quota.remaining) ? Math.max(0, Math.min(100, quota.remaining)) : null;
  const label = ({ 'session (5h)': '5-hour', 'weekly (7d)': 'Weekly', '5h': '5-hour', session: '5-hour', weekly: 'Weekly' })[quota.name] || quota.name;
  return `<div><div class="meter-label"><span title="${esc(quota.name)}">${esc(label)}</span><b>${pct === null ? '—' : Math.round(pct) + '%'}</b></div><div class="track" role="meter" aria-label="${esc(label)} remaining" aria-valuemin="0" aria-valuemax="100" ${pct === null ? 'aria-valuetext="Not reported"' : `aria-valuenow="${pct}"`}><div class="fill ${pct < 15 ? 'empty' : pct < 40 ? 'low' : ''}" style="width:${pct ?? 0}%"></div></div><div class="countdown">${countdown(quota.resetAt, 'Resets in ')}</div></div>`;
}
function account(row) {
  const quotas = Array.isArray(row.quotas) ? row.quotas : [];
  const resets = row.resets;
  const expiries = Array.isArray(resets?.expiries) ? resets.expiries : [];
  const state = row.status || 'Unknown';
  return `<article class="account"><div class="identity"><span class="name" title="${esc(row.label)}">${esc(row.label)}</span><span class="state ${state !== 'Active' ? 'bad' : ''}" role="img" aria-label="${esc(state)}" title="${esc(state)}"></span></div><div class="plan">${esc([row.plan, state !== 'Active' ? state : null].filter(Boolean).join(' · ') || 'Connected account')}</div>${quotas.length ? `<div class="meters">${quotas.slice(0, 2).map(meter).join('')}</div>${quotas.length > 2 ? `<details class="plan"><summary>${quotas.length - 2} more limits</summary><div class="meters">${quotas.slice(2).map(meter).join('')}</div></details>` : ''}` : '<p class="quota-message">Quota not reported</p>'}${row.error ? `<p class="stale">${row.updatedAt ? 'Quota stale · last success ' + esc(stamp(row.updatedAt)) : 'Quota unavailable'}</p>` : ''}<div class="stats"><span><b>${esc(compact(row.requests ?? 0))}</b> requests</span><span><b>${esc(compact(row.tokens ?? 0))}</b> tokens</span>${resets ? `<div class="reset"><details><summary title="Reset credits and expiry">${esc(resets.count)} resets${expiries[0]?.expiresAt ? ' · ' + countdown(expiries[0].expiresAt) : ''}</summary><ul>${expiries.length ? expiries.map(item => `<li>${esc(item.count)} reset${item.count === 1 ? '' : 's'} · ${item.expiresAt ? countdown(item.expiresAt, 'expires in ') : 'No expiry reported'}<div class="plan">${esc(stamp(item.expiresAt))}</div></li>`).join('') : '<li>Expiry not reported</li>'}</ul></details></div>` : ''}</div></article>`;
}
function render(data) {
  const groups = new Map();
  for (const row of data.accounts) {
    if (!groups.has(row.provider)) groups.set(row.provider, []);
    groups.get(row.provider).push(row);
  }
  $('count').textContent = data.accounts.length;
  $('accounts').innerHTML = groups.size ? [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([provider, rows]) => `<section class="provider"><h2 class="provider-heading">${esc(providerNames[provider] || provider)} <span>${rows.length}</span></h2>${rows.map(account).join('')}</section>`).join('') : '<div class="empty">No accounts yet.<br>Add provider accounts in 9router.</div>';
}
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function preferences(open) { $('preferences').hidden = !open; $('settings').setAttribute('aria-expanded', String(open)); }
async function request(action, password, force = false) {
  if (native) return native.invoke(action, action === 'login' ? { base, password } : { base, force });
  const response = await fetch(action === 'login' ? '/api/auth/login' : '/api/usage/widget' + (force ? '?force=1' : ''), {
    method: action === 'login' ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: action === 'login' ? { 'Content-Type': 'application/json' } : {},
    body: action === 'login' ? JSON.stringify({ password }) : undefined,
  });
  if (response.status === 404) throw new Error('Update 9router to add widget support.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `9router returned HTTP ${response.status}`);
  return data;
}
async function refresh(force = false) {
  if (busy) return;
  busy = true;
  $('refresh').disabled = true;
  try {
    const data = await request('accounts', undefined, force);
    if (!Array.isArray(data.accounts)) throw new Error('Invalid account reply. Update 9router.');
    snapshot = data;
    receivedAt = new Date();
    offline = false;
    render(data);
    notice('');
    $('connection').innerHTML = '<i></i> Connected';
    $('updated').textContent = 'All-time · ' + receivedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    offline = true;
    const message = String(error?.message || error);
    notice(message + (snapshot ? ' Showing last received data.' : ' Open connection settings to sign in.'));
    $('connection').innerHTML = '<i></i> Offline';
    if (!snapshot) {
      $('accounts').innerHTML = '<div class="empty">Connect your 9router instance<br>to see account usage here.</div>';
      preferences(true);
    }
  } finally {
    document.querySelector('footer').classList.toggle('offline', offline);
    busy = false;
    $('refresh').disabled = false;
  }
}
$('refresh').onclick = () => refresh(true);
$('settings').onclick = () => preferences($('preferences').hidden);
$('handle').onpointerdown = event => {
  if (native && event.button === 0 && !event.target.closest('button')) native.invoke('drag').catch(error => notice(String(error)));
};
$('pin').setAttribute('aria-pressed', String(pinned));
if (native) native.invoke('pin', { pinned }).catch(error => notice(String(error)));
$('pin').onclick = async () => {
  try {
    await native.invoke('pin', { pinned: !pinned });
    pinned = !pinned;
    save('pinned', String(pinned));
    $('pin').setAttribute('aria-pressed', String(pinned));
  } catch (error) { notice(String(error)); }
};
$('quit').onclick = () => native.invoke('quit').catch(error => notice(String(error)));
$('connect').onsubmit = async event => {
  event.preventDefault();
  if (busy) return;
  const submit = event.target.querySelector('[type=submit]');
  submit.disabled = true;
  const previousBase = base;
  base = native ? $('url').value.trim().replace(/\/$/, '') : location.origin;
  if (base !== previousBase) {
    snapshot = null;
    $('count').textContent = '';
    $('accounts').innerHTML = '<div class="empty">Connecting…</div>';
  }
  const password = $('password').value;
  $('password').value = '';
  try {
    if (password) await request('login', password);
    save('router-url', base);
    await refresh();
    if (!offline) preferences(false);
  } catch (error) { notice(String(error?.message || error)); }
  finally { submit.disabled = false; }
};
document.addEventListener('keydown', event => { if (event.key === 'Escape') preferences(false); });
setInterval(refresh, 60000);
setInterval(() => {
  document.querySelectorAll('[data-time]').forEach(element => {
    element.textContent = element.dataset.time ? element.dataset.prefix + relative(element.dataset.time) : 'Not reported';
  });
}, 15000);
refresh();
