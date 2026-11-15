#!/usr/bin/env python3
"""Build an importable n8n workflow.json for the no double booking voice agent tool.

The booking rules live in logic.js. This script pastes that same file into every Code node
that needs it, so the n8n workflow, test_logic.js, and the browser sandbox run the same code.
"""

import json
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "workflow.json"
LIB = (HERE / "logic.js").read_text().replace("if (typeof module !== 'undefined') module.exports = NB;\n", "")

SETTINGS_JS = r"""// EDIT THESE. Sample values only. Do not put API keys here.
const settings = {
  business_name: 'Sample Barber Shop',
  timezone: 'America/New_York',
  // 0 = Sunday ... 6 = Saturday
  open_days: '1,2,3,4,5,6',
  open_time: '09:00',
  close_time: '17:00',
  // Optional lunch or break. Leave blank for none.
  break_time: '12:00-13:00',
  // Length of one appointment, and the gap you want between appointments.
  slot_minutes: 60,
  buffer_minutes: 0,
  // Do not book anything sooner than this many minutes from now.
  lead_minutes: 60,
  // How many open times to read back to the caller.
  max_offer: 3,
  lookahead_days: 14,
  // 'demo' keeps a practice calendar inside this workflow. 'google' uses Google Calendar.
  calendar_mode: 'demo',
  google_calendar_id: 'primary',
};
return $input.all().map(item => ({ json: { ...item.json, settings } }));
"""

PARSE_JS = LIB + r"""
// One item per tool call. Vapi can send more than one tool call in a request.
const first = $input.first().json;
const S = NB.normSettings(first.settings);
const body = first.body || {};
const req = NB.normalizeRequest(body);
// Test hook: a simple test body can pass "now" so you can test without waiting for a real date.
let nowMs = Date.now();
if (req.source === 'simple' && body.now && !isNaN(Date.parse(body.now))) nowMs = Date.parse(body.now);
if (!req.calls.length) {
  return [{ json: { source: req.source, kind: 'none', settings: S, calendar_mode: S.calendar_mode, now_ms: nowMs, window: NB.windowFor({ kind: 'check', args: {} }, S, nowMs) } }];
}
return req.calls.map(c => ({ json: { ...c, source: req.source, settings: S, calendar_mode: S.calendar_mode, now_ms: nowMs, window: NB.windowFor(c, S, nowMs) } }));
"""

ATTACH_BUSY_JS = r"""// Google free/busy answer for this one tool call.
const base = $('Loop Over Items').item.json;
const r = $json || {};
const cal = r.calendars ? (r.calendars[base.settings.google_calendar_id] || Object.values(r.calendars)[0]) : null;
if (!cal || (cal.errors && cal.errors.length)) {
  const why = JSON.stringify(r.error || (cal && cal.errors) || 'no data').slice(0, 200);
  return { json: { ...base, busy: [], calendar_error: 'Google free/busy failed: ' + why } };
}
return { json: { ...base, busy: cal.busy || [] } };
"""

DEMO_BUSY_JS = r"""// Practice calendar kept in this workflow's static data.
// Static data only saves when the workflow is Active (published), not in a manual test run.
const st = $getWorkflowStaticData('global');
st.demo_events = st.demo_events || [];
st.ledger = st.ledger || {};
const base = $json;
if (base.kind === 'reset') { st.demo_events = []; st.ledger = {}; st.demo_n = 0; }
return { json: { ...base, busy: st.demo_events.map(e => ({ start: e.start, end: e.end })) } };
"""

DECIDE_JS = LIB + r"""
// Check the fresh free/busy right before any write. Never book on a stale answer.
const it = $json;
const S = it.settings;
if (it.kind === 'none') return { json: { ...it, busy: undefined, action: 'none', text: '' } };
if (it.calendar_error) {
  return { json: { ...it, busy: undefined, action: 'error', is_error: true, text: 'The calendar is not reachable right now. Nothing was booked. Take a message and tell the caller the owner will call back.' } };
}
const st = $getWorkflowStaticData('global');
const d = NB.decide(it, S, it.busy, st.ledger || {}, it.now_ms);
return { json: { ...it, busy: undefined, ...d, is_error: d.action === 'error' } };
"""

VERIFY_JS = LIB + r"""
// Read the slot back after writing. If two bookings landed at the same time, the earliest created wins
// and every other copy deletes itself. Google Calendar has no lock, so this is the safety net.
const d = $('Decide').item.json;
const S = d.settings;
const created = $('Create Event').item.json || {};
const list = $json || {};
if (!created.id) {
  return { json: { ...d, action: 'error', outcome: 'error', is_error: true, delete_ours: false, text: 'Could not save the booking to the calendar. Nothing was booked. Take a message for the owner.' } };
}
const ours = { id: created.id, created: created.created || new Date().toISOString(), key: d.key };
const events = (Array.isArray(list.items) ? list.items : [])
  .filter(e => e.transparency !== 'transparent')
  .map(e => ({ id: e.id, created: e.created, status: e.status, key: e.extendedProperties && e.extendedProperties.private ? e.extendedProperties.private.nobsai_key : '' }));
const v = NB.verifyWinner(ours, events);
const st = $getWorkflowStaticData('global');
st.ledger = st.ledger || {};
if (v.outcome !== 'lost') st.ledger[d.key] = { code: d.code, start: d.start, event_id: v.outcome === 'won' ? created.id : v.winner_id, at: new Date().toISOString() };
// Keep the ledger small: drop bookings that started more than 30 days ago.
for (const k of Object.keys(st.ledger)) { if (Date.parse(st.ledger[k].start) < Date.now() - 30 * 86400000) delete st.ledger[k]; }
return { json: { ...d, outcome: v.outcome, event_id: created.id, verify_read_ok: Array.isArray(list.items), delete_ours: v.outcome !== 'won', action: v.outcome === 'won' ? 'booked' : v.outcome, text: NB.finalText(d, v.outcome, S) } };
"""

RESTORE_JS = r"""// The delete call returns an empty body. Put the booking result back on the item.
return { json: $('Verify Winner').item.json };
"""

DEMO_WRITE_JS = LIB + r"""
// Practice calendar write, with the same read-back check as the Google path.
const d = $json;
const S = d.settings;
const st = $getWorkflowStaticData('global');
st.demo_events = st.demo_events || [];
st.ledger = st.ledger || {};
st.demo_n = (st.demo_n || 0) + 1;
const ev = { id: 'demo-' + st.demo_n, created: new Date().toISOString(), start: d.start, end: d.end, key: d.key, summary: d.event.summary };
st.demo_events.push(ev);
const s0 = Date.parse(d.start), s1 = Date.parse(d.end);
const overlapping = st.demo_events.filter(e => Date.parse(e.start) < s1 && s0 < Date.parse(e.end));
const v = NB.verifyWinner(ev, overlapping);
if (v.outcome !== 'won') st.demo_events = st.demo_events.filter(e => e.id !== ev.id);
if (v.outcome !== 'lost') st.ledger[d.key] = { code: d.code, start: d.start, event_id: v.outcome === 'won' ? ev.id : v.winner_id, at: new Date().toISOString() };
if (st.demo_events.length > 200) st.demo_events = st.demo_events.slice(-200);
return { json: { ...d, outcome: v.outcome, event_id: ev.id, action: v.outcome === 'won' ? 'booked' : v.outcome, text: NB.finalText(d, v.outcome, S) } };
"""

BUILD_RESPONSE_JS = LIB + r"""
// One HTTP 200 answer for the whole request, in the shape the voice platform expects.
const items = $input.all().map(i => i.json);
const source = items.length ? items[0].source : 'unknown';
const results = items.filter(x => x.kind !== 'none').map(x => ({
  toolCallId: x.toolCallId, text: x.text, is_error: !!x.is_error, action: x.action, start: x.start, code: x.code, slots: x.slots,
}));
return [{ json: NB.buildResponse(source, results) }];
"""

STICKY = """## No double booking (No BS AI template)

Booking tool for a Vapi or Retell phone agent.

1. check_availability reads the calendar and offers open times.
2. book_appointment re-reads the calendar right before it writes. If the time is gone, nothing is booked and the caller gets other times.
3. After the write it reads the slot back. If two callers booked at once, the earliest wins and the other copy deletes itself.
4. A retried tool call returns the same confirmation instead of a second booking.

Always answers HTTP 200 in the shape Vapi expects: results, toolCallId, and a flat string.

Starts in demo mode (no Google account needed). Set calendar_mode to google in Settings to go live.

Built by Bobby Ve, No BS AI. Want it set up on your number? Text SETUP to (470) 779-2869
"""


def nid():
    return str(uuid.uuid4())


def node(name, typ, typver, x, y, parameters, **extra):
    n = {"id": nid(), "name": name, "type": typ, "typeVersion": typver, "position": [x, y], "parameters": parameters}
    n.update(extra)
    return n


def code(name, x, y, js, each=False):
    params = {"jsCode": js}
    if each:
        params["mode"] = "runOnceForEachItem"
    return node(name, "n8n-nodes-base.code", 2, x, y, params)


def iff(name, x, y, expr):
    return node(name, "n8n-nodes-base.if", 2, x, y, {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose"},
            "conditions": [{"id": nid(), "leftValue": expr, "rightValue": True,
                            "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
            "combinator": "and",
        },
        "options": {},
    })


def google_http(name, x, y, method, url, json_body=None, query=None):
    p = {
        "method": method,
        "url": url,
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "googleCalendarOAuth2Api",
        "options": {},
    }
    if json_body:
        p.update({"sendBody": True, "specifyBody": "json", "jsonBody": json_body})
    if query:
        p.update({"sendQuery": True, "queryParameters": {"parameters": [{"name": k, "value": v} for k, v in query]}})
    return node(name, "n8n-nodes-base.httpRequest", 4.2, x, y, p, onError="continueRegularOutput", alwaysOutputData=True)


CAL = "{{ encodeURIComponent($('Decide').item.json.settings.google_calendar_id) }}"


def main():
    hook = node("Booking Tool", "n8n-nodes-base.webhook", 2, 0, 300,
                {"httpMethod": "POST", "path": "booking-tool", "responseMode": "responseNode", "options": {}},
                webhookId=nid())
    settings = code("Settings", 220, 300, SETTINGS_JS)
    parse = code("Parse Tool Calls", 440, 300, PARSE_JS)
    loop = node("Loop Over Items", "n8n-nodes-base.splitInBatches", 3, 660, 300, {"options": {}})
    gmode = iff("Google Mode?", 880, 400, "={{ $json.calendar_mode === 'google' }}")
    freebusy = google_http(
        "Google Free/Busy", 1100, 300, "POST", "https://www.googleapis.com/calendar/v3/freeBusy",
        json_body="={{ JSON.stringify({ timeMin: $json.window.timeMin, timeMax: $json.window.timeMax, timeZone: $json.settings.timezone, items: [{ id: $json.settings.google_calendar_id }] }) }}",
    )
    attach = code("Attach Busy", 1320, 300, ATTACH_BUSY_JS, each=True)
    demo_busy = code("Demo Busy", 1320, 500, DEMO_BUSY_JS, each=True)
    decide = code("Decide", 1540, 400, DECIDE_JS, each=True)
    needs = iff("Needs Write?", 1760, 400, "={{ $json.action === 'create' }}")
    gwrite = iff("Google Write?", 1980, 300, "={{ $json.calendar_mode === 'google' }}")
    create = google_http(
        "Create Event", 2200, 200, "POST",
        "=https://www.googleapis.com/calendar/v3/calendars/{{ encodeURIComponent($json.settings.google_calendar_id) }}/events",
        json_body="={{ JSON.stringify($json.event) }}",
    )
    recheck = google_http(
        "Read Slot Back", 2420, 200, "GET",
        "=https://www.googleapis.com/calendar/v3/calendars/" + CAL + "/events",
        query=[("timeMin", "={{ $('Decide').item.json.start }}"), ("timeMax", "={{ $('Decide').item.json.end }}"),
               ("singleEvents", "true"), ("showDeleted", "false"), ("maxResults", "50")],
    )
    verify = code("Verify Winner", 2640, 200, VERIFY_JS, each=True)
    lost = iff("Delete Our Copy?", 2860, 200, "={{ $json.delete_ours === true }}")
    delete = google_http(
        "Delete Our Event", 3080, 100, "DELETE",
        "=https://www.googleapis.com/calendar/v3/calendars/{{ encodeURIComponent($json.settings.google_calendar_id) }}/events/{{ $json.event_id }}",
    )
    restore = code("Restore Result", 3300, 100, RESTORE_JS, each=True)
    demo_write = code("Demo Write", 2200, 420, DEMO_WRITE_JS, each=True)
    build = code("Build Response", 880, 100, BUILD_RESPONSE_JS)
    respond = node("Respond 200", "n8n-nodes-base.respondToWebhook", 1.1, 1100, 100,
                   {"respondWith": "firstIncomingItem", "options": {"responseCode": 200}})
    sticky = node("Read Me", "n8n-nodes-base.stickyNote", 1, -40, -380, {"content": STICKY, "height": 360, "width": 560})

    nodes = [hook, settings, parse, loop, gmode, freebusy, attach, demo_busy, decide, needs, gwrite, create,
             recheck, verify, lost, delete, restore, demo_write, build, respond, sticky]

    conns = {}

    def link(a, b, out=0):
        c = conns.setdefault(a["name"], {"main": []})
        while len(c["main"]) <= out:
            c["main"].append([])
        c["main"][out].append({"node": b["name"], "type": "main", "index": 0})

    link(hook, settings)
    link(settings, parse)
    link(parse, loop)
    link(loop, build, 0)          # done
    link(loop, gmode, 1)          # each item
    link(build, respond)
    link(gmode, freebusy, 0)
    link(gmode, demo_busy, 1)
    link(freebusy, attach)
    link(attach, decide)
    link(demo_busy, decide)
    link(decide, needs)
    link(needs, gwrite, 0)
    link(needs, loop, 1)
    link(gwrite, create, 0)
    link(gwrite, demo_write, 1)
    link(create, recheck)
    link(recheck, verify)
    link(verify, lost)
    link(lost, delete, 0)
    link(lost, loop, 1)
    link(delete, restore)
    link(restore, loop)
    link(demo_write, loop)

    wf = {
        "name": "No Double Booking for AI Phone Agents (No BS AI template)",
        "nodes": nodes,
        "connections": conns,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "meta": {"templateCredsSetupCompleted": False, "builtBy": "Bobby Ve, No BS AI"},
        "tags": [],
    }
    OUT.write_text(json.dumps(wf, indent=2) + "\n")
    print(f"Wrote {OUT} with {len(nodes)} nodes")


if __name__ == "__main__":
    main()
