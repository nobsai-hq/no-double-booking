// No BS AI booking logic. Shared, dependency free.
// The same text is pasted into the n8n Code nodes, run by test_logic.js in Node,
// and run in the browser sandbox page. Edit here, then run build_workflow.py.
const NB = (function () {
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function pad(n) { return String(n).padStart(2, '0'); }
  function clean(s) { return String(s == null ? '' : s).replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ').trim(); }

  // ---------- time zone helpers (Intl only, no libraries) ----------
  function partsInTz(ms, tz) {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    });
    const o = {};
    for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: WD.indexOf(o.weekday) };
  }
  function tzOffsetMin(ms, tz) {
    const p = partsInTz(ms, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  }
  function localToMs(y, m, d, h, mi, tz) {
    const guess = Date.UTC(y, m - 1, d, h, mi);
    const off = tzOffsetMin(guess, tz);
    let ms = guess - off * 60000;
    const off2 = tzOffsetMin(ms, tz);
    if (off2 !== off) ms = guess - off2 * 60000;
    return ms;
  }
  function isoLocal(ms, tz) {
    const p = partsInTz(ms, tz);
    const off = tzOffsetMin(ms, tz);
    const a = Math.abs(off);
    return p.y + '-' + pad(p.m) + '-' + pad(p.d) + 'T' + pad(p.h) + ':' + pad(p.mi) + ':00' +
      (off >= 0 ? '+' : '-') + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }
  function speakDay(ms, tz) {
    return clean(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(ms)));
  }
  function speakTime(ms, tz) {
    return clean(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)));
  }
  function addDays(y, m, d, n) {
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function hm(str, fallback) {
    const m = /^(\d{1,2}):?(\d{2})?$/.exec(String(str || '').trim());
    if (!m) return fallback;
    return (+m[1]) * 60 + (+(m[2] || 0));
  }

  // Accepts "2026-11-17", "2026-11-17 14:00", "2026-11-17T14:00", or a full ISO with offset or Z.
  function parseWhen(raw, tz) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return { dateOnly: true, y: +m[1], m: +m[2], d: +m[3], ms: localToMs(+m[1], +m[2], +m[3], 0, 0, tz) };
    m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s);
    if (m) {
      const ms = localToMs(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
      return { dateOnly: false, y: +m[1], m: +m[2], d: +m[3], ms };
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
      const ms = Date.parse(s);
      if (isNaN(ms)) return null;
      const p = partsInTz(ms, tz);
      return { dateOnly: false, y: p.y, m: p.m, d: p.d, ms };
    }
    return null;
  }

  // ---------- settings ----------
  function normSettings(s) {
    s = s || {};
    const days = String(s.open_days == null ? '1,2,3,4,5,6' : s.open_days)
      .split(',').map(x => parseInt(x, 10)).filter(x => x >= 0 && x <= 6);
    let brk = null;
    const bm = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(String(s.break_time || '').trim());
    if (bm) brk = [hm(bm[1]), hm(bm[2])];
    return {
      business_name: String(s.business_name || 'the shop'),
      timezone: String(s.timezone || 'America/New_York'),
      open_days: days,
      open_min: hm(s.open_time, 9 * 60),
      close_min: hm(s.close_time, 17 * 60),
      break_min: brk,
      slot_minutes: Math.max(5, parseInt(s.slot_minutes, 10) || 60),
      buffer_minutes: Math.max(0, parseInt(s.buffer_minutes, 10) || 0),
      lead_minutes: Math.max(0, parseInt(s.lead_minutes == null ? 60 : s.lead_minutes, 10) || 0),
      max_offer: Math.max(1, parseInt(s.max_offer, 10) || 3),
      lookahead_days: Math.min(60, Math.max(1, parseInt(s.lookahead_days, 10) || 14)),
      calendar_mode: String(s.calendar_mode || 'demo') === 'google' ? 'google' : 'demo',
      google_calendar_id: String(s.google_calendar_id || 'primary'),
    };
  }

  // ---------- request parsing ----------
  function parseArgs(a) {
    if (a == null) return {};
    if (typeof a === 'string') { try { const o = JSON.parse(a); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; } }
    return typeof a === 'object' ? a : {};
  }
  function toolKind(name) {
    const n = String(name || '').toLowerCase().replace(/[^a-z_]/g, '');
    if (['check_availability', 'checkavailability', 'get_availability', 'get_open_slots', 'check_calendar', 'availability'].includes(n)) return 'check';
    if (['book_appointment', 'bookappointment', 'book', 'create_booking', 'book_consultation', 'create_appointment'].includes(n)) return 'book';
    if (n === 'reset_demo') return 'reset';
    return 'unknown';
  }
  // Returns { source, calls: [{ toolCallId, name, kind, args, callId, phone }] }
  function normalizeRequest(body) {
    body = body || {};
    const msg = body.message;
    if (msg && typeof msg === 'object') {
      const list = Array.isArray(msg.toolCallList) ? msg.toolCallList : (Array.isArray(msg.toolCalls) ? msg.toolCalls : []);
      const call = msg.call || {};
      const phone = (call.customer && call.customer.number) || (msg.customer && msg.customer.number) || '';
      return {
        source: 'vapi',
        calls: list.map(tc => {
          const fn = tc.function || {};
          return { toolCallId: String(tc.id || ''), name: fn.name || tc.name || '', kind: toolKind(fn.name || tc.name), args: parseArgs(fn.arguments || tc.arguments), callId: String(call.id || ''), phone: String(phone || '') };
        }),
      };
    }
    if (body.name && body.args !== undefined) {
      const call = body.call || {};
      return { source: 'retell', calls: [{ toolCallId: '', name: body.name, kind: toolKind(body.name), args: parseArgs(body.args), callId: String(call.call_id || ''), phone: String(call.from_number || '') }] };
    }
    if (body.tool) {
      return { source: 'simple', calls: [{ toolCallId: String(body.tool_call_id || 'test-1'), name: body.tool, kind: toolKind(body.tool), args: parseArgs(body.args), callId: String(body.call_id || ''), phone: String(body.caller_phone || '') }] };
    }
    return { source: 'unknown', calls: [] };
  }

  // ---------- calendar math ----------
  function overlaps(a0, a1, b0, b1) { return a0 < b1 && b0 < a1; }
  function busyMs(busy) {
    return (busy || []).map(b => ({ s: Date.parse(b.start), e: Date.parse(b.end) })).filter(b => !isNaN(b.s) && !isNaN(b.e));
  }
  // Why a time is not bookable, or '' if it is.
  function blockReason(startMs, S, busy, nowMs) {
    const endMs = startMs + S.slot_minutes * 60000;
    const p = partsInTz(startMs, S.timezone);
    const startMin = p.h * 60 + p.mi;
    const endMin = startMin + S.slot_minutes;
    if (startMs < nowMs + S.lead_minutes * 60000) return 'too_soon';
    if (!S.open_days.includes(p.wd)) return 'closed';
    if (startMin < S.open_min || endMin > S.close_min) return 'closed';
    if (S.break_min && overlaps(startMin, endMin, S.break_min[0], S.break_min[1])) return 'closed';
    const buf = S.buffer_minutes * 60000;
    for (const b of busyMs(busy)) if (overlaps(startMs - buf, endMs + buf, b.s, b.e)) return 'taken';
    return '';
  }
  function slotsForDay(y, m, d, S, busy, nowMs) {
    const out = [];
    for (let t = S.open_min; t + S.slot_minutes <= S.close_min; t += S.slot_minutes) {
      const ms = localToMs(y, m, d, Math.floor(t / 60), t % 60, S.timezone);
      if (!blockReason(ms, S, busy, nowMs)) out.push(ms);
    }
    return out;
  }
  // Up to max open slots, starting on the given local day.
  function findOpen(y, m, d, S, busy, nowMs, max) {
    const out = [];
    for (let i = 0; i < S.lookahead_days && out.length < max; i++) {
      const day = addDays(y, m, d, i);
      for (const ms of slotsForDay(day.y, day.m, day.d, S, busy, nowMs)) { if (out.length < max) out.push(ms); }
    }
    return out;
  }
  function listSlots(slots, S, knownDay) {
    if (!slots.length) return '';
    const tz = S.timezone;
    let lastDay = knownDay || '';
    const parts = slots.map(ms => {
      const day = speakDay(ms, tz);
      const txt = (day !== lastDay ? day + ' at ' : '') + speakTime(ms, tz) + ' (start ' + isoLocal(ms, tz) + ')';
      lastDay = day;
      return txt;
    });
    return parts.join('; ');
  }

  // Free/busy window to read before deciding. For a booking we read the booked day through the lookahead,
  // so we can offer other times if the slot is gone.
  function windowFor(call, S, nowMs) {
    const tz = S.timezone;
    const raw = call.kind === 'book' ? (call.args.start || call.args.datetime || call.args.start_time) : (call.args.date || call.args.day || call.args.start);
    const w = parseWhen(raw, tz);
    const base = w || (() => { const p = partsInTz(nowMs, tz); return { y: p.y, m: p.m, d: p.d }; })();
    const end = addDays(base.y, base.m, base.d, S.lookahead_days + 1);
    return { timeMin: new Date(localToMs(base.y, base.m, base.d, 0, 0, tz)).toISOString(), timeMax: new Date(localToMs(end.y, end.m, end.d, 0, 0, tz)).toISOString() };
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36).toUpperCase().slice(0, 6);
  }
  function bookingKey(call, startIso) {
    const who = call.callId || call.phone || String(call.args.phone || '') || String(call.args.name || '') || 'anon';
    return who + '|' + startIso;
  }

  // Decide what to do with one tool call. busy is [{start,end}] read fresh from the calendar.
  // ledger is { key: { code, start, event_id } } of bookings this workflow already made.
  function decide(call, S, busy, ledger, nowMs) {
    const tz = S.timezone;
    ledger = ledger || {};
    if (call.kind === 'check') {
      const raw = call.args.date || call.args.day || call.args.start;
      let w = parseWhen(raw, tz);
      if (raw && !w) return { action: 'error', text: 'I could not read that date. Send date as YYYY-MM-DD.' };
      if (!w) { const p = partsInTz(nowMs, tz); w = { y: p.y, m: p.m, d: p.d }; }
      const day = slotsForDay(w.y, w.m, w.d, S, busy, nowMs).slice(0, S.max_offer);
      const label = speakDay(localToMs(w.y, w.m, w.d, 12, 0, tz), tz);
      if (day.length) return { action: 'reply', slots: day.map(ms => isoLocal(ms, tz)), text: 'Open times on ' + label + ': ' + listSlots(day, S, label) + '. To book, pass the start value exactly. Times are ' + tz + '.' };
      const next = findOpen(addDays(w.y, w.m, w.d, 1).y, addDays(w.y, w.m, w.d, 1).m, addDays(w.y, w.m, w.d, 1).d, S, busy, nowMs, S.max_offer);
      if (next.length) return { action: 'reply', slots: next.map(ms => isoLocal(ms, tz)), text: 'No open times on ' + label + '. Next open: ' + listSlots(next, S) + '. Times are ' + tz + '.' };
      return { action: 'reply', slots: [], text: 'No open times in the next ' + S.lookahead_days + ' days. Offer to take a message for the owner.' };
    }
    if (call.kind === 'book') {
      const raw = call.args.start || call.args.datetime || call.args.start_time;
      const w = parseWhen(raw, tz);
      if (!w || w.dateOnly) return { action: 'error', text: 'I need the start time, like 2026-11-17T14:00. Check availability first and pass the start value exactly.' };
      const startMs = w.ms;
      const startIso = isoLocal(startMs, tz);
      const endIso = isoLocal(startMs + S.slot_minutes * 60000, tz);
      const key = bookingKey(call, startIso);
      if (ledger[key]) {
        return { action: 'duplicate', key, start: startIso, code: ledger[key].code, text: 'Already booked for ' + speakDay(startMs, tz) + ' at ' + speakTime(startMs, tz) + '. Confirmation ' + ledger[key].code + '. Do not book again.' };
      }
      const why = blockReason(startMs, S, busy, nowMs);
      if (why) {
        const p = partsInTz(startMs, tz);
        const alt = findOpen(p.y, p.m, p.d, S, busy, nowMs, S.max_offer);
        const lead = why === 'taken' ? 'That time is already taken.' : why === 'too_soon' ? 'That time is too soon or in the past.' : 'We are closed at that time.';
        return { action: why, start: startIso, slots: alt.map(ms => isoLocal(ms, tz)), text: lead + (alt.length ? ' Open times: ' + listSlots(alt, S) + '.' : ' No open times soon. Offer to take a message.') + ' Nothing was booked.' };
      }
      const name = clean(call.args.name || call.args.customer_name || 'Caller').slice(0, 80);
      const phone = clean(call.args.phone || call.phone || '').slice(0, 30);
      const service = clean(call.args.service || 'Appointment').slice(0, 80);
      const notes = clean(call.args.notes || '').slice(0, 300);
      return {
        action: 'create', key, start: startIso, end: endIso, code: 'NB-' + hash(key),
        event: {
          summary: service + ' - ' + name,
          description: 'Booked by the AI phone agent. Phone: ' + (phone || 'not given') + (notes ? '. Notes: ' + notes : '') + '. Booking key: ' + key,
          start: { dateTime: startIso, timeZone: tz },
          end: { dateTime: endIso, timeZone: tz },
          extendedProperties: { private: { nobsai_key: key } },
        },
      };
    }
    if (call.kind === 'reset') return { action: 'reset', text: 'Demo calendar cleared.' };
    return { action: 'error', text: 'Unknown tool ' + clean(call.name) + '. Use check_availability or book_appointment.' };
  }

  // After we write, read the slot back. If two bookings landed at once, the earliest created wins.
  // events: [{ id, created, status, key }] overlapping the slot. ours: { id, created, key }.
  function verifyWinner(ours, events) {
    const list = (events || []).filter(e => e && e.id && e.status !== 'cancelled');
    if (!list.some(e => e.id === ours.id)) list.push(ours);
    list.sort((a, b) => (Date.parse(a.created) - Date.parse(b.created)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const first = list[0];
    if (first.id === ours.id) return { outcome: 'won' };
    if (first.key && first.key === ours.key) return { outcome: 'duplicate', winner_id: first.id };
    return { outcome: 'lost', winner_id: first.id };
  }

  function finalText(d, outcome, S) {
    const tz = S.timezone;
    const ms = Date.parse(d.start);
    const when = speakDay(ms, tz) + ' at ' + speakTime(ms, tz);
    if (outcome === 'won') return 'Booked for ' + when + '. Confirmation ' + d.code + '.';
    if (outcome === 'duplicate') return 'Already booked for ' + when + '. Confirmation ' + d.code + '. Do not book again.';
    return 'Sorry, ' + when + ' was just taken by another caller. Nothing was booked. Check availability again and offer another time.';
  }

  // Build the HTTP body the voice platform expects. Always sent with HTTP 200.
  function buildResponse(source, results) {
    const flat = s => clean(s).slice(0, 1000);
    if (source === 'vapi') {
      return { results: results.map(r => r.is_error ? { toolCallId: r.toolCallId, error: flat(r.text) } : { toolCallId: r.toolCallId, result: flat(r.text) }) };
    }
    if (source === 'retell') {
      const r = results[0] || { text: 'No tool call found.', action: 'error' };
      return { result: flat(r.text), action: r.action || '', start: r.start || '', code: r.code || '' };
    }
    if (source === 'simple') {
      return { results: results.map(r => ({ toolCallId: r.toolCallId, action: r.action, result: flat(r.text), start: r.start || '', code: r.code || '', slots: r.slots || [] })) };
    }
    return { ok: true, note: 'No tool calls in this request.' };
  }

  return { partsInTz, tzOffsetMin, localToMs, isoLocal, speakDay, speakTime, parseWhen, normSettings, normalizeRequest, toolKind, blockReason, slotsForDay, findOpen, windowFor, decide, verifyWinner, finalText, buildResponse, bookingKey, hash };
})();
if (typeof module !== 'undefined') module.exports = NB;
