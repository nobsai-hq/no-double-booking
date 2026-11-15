// Logic tests for logic.js (the same code that runs in the n8n Code nodes and the demo page).
// Run: node test_logic.js
const assert = require('assert');
const NB = require('./logic.js');
let pass = 0;
function t(name, fn) { fn(); pass++; console.log('ok  ' + name); }

const S = NB.normSettings({ open_days: '1,2,3,4,5,6', open_time: '09:00', close_time: '17:00', break_time: '12:00-13:00', slot_minutes: 60, lead_minutes: 60, max_offer: 3, timezone: 'America/New_York' });
const NOW = Date.parse('2026-11-16T09:30:00-05:00'); // Monday 9:30 AM ET
const call = (kind, args, extra) => Object.assign({ kind, name: kind, args, toolCallId: 'tc', callId: 'call-1', phone: '+15550100001' }, extra || {});

t('time zone: local 2 PM ET in November is 19:00 UTC', () => {
  assert.strictEqual(new Date(NB.localToMs(2026, 11, 17, 14, 0, S.timezone)).toISOString(), '2026-11-17T19:00:00.000Z');
});
t('time zone: summer time is handled (July is UTC-4)', () => {
  assert.strictEqual(NB.isoLocal(NB.localToMs(2026, 7, 7, 9, 0, S.timezone), S.timezone), '2026-07-07T09:00:00-04:00');
});
t('parseWhen reads date, local time, and ISO with offset', () => {
  assert.ok(NB.parseWhen('2026-11-17', S.timezone).dateOnly);
  assert.strictEqual(NB.parseWhen('2026-11-17 14:00', S.timezone).ms, Date.parse('2026-11-17T19:00:00Z'));
  assert.strictEqual(NB.parseWhen('2026-11-17T14:00:00-05:00', S.timezone).ms, Date.parse('2026-11-17T19:00:00Z'));
  assert.strictEqual(NB.parseWhen('tomorrow 3pm', S.timezone), null);
});
t('Vapi request: toolCallList, arguments as object or JSON string', () => {
  const r = NB.normalizeRequest({ message: { type: 'tool-calls', call: { id: 'c9', customer: { number: '+1555' } }, toolCallList: [
    { id: 'a', function: { name: 'check_availability', arguments: { date: '2026-11-17' } } },
    { id: 'b', function: { name: 'book_appointment', arguments: '{"start":"2026-11-17T10:00"}' } }] } });
  assert.strictEqual(r.source, 'vapi');
  assert.strictEqual(r.calls.length, 2);
  assert.strictEqual(r.calls[1].args.start, '2026-11-17T10:00');
  assert.strictEqual(r.calls[1].callId, 'c9');
});
t('Retell request: name, args, call.call_id', () => {
  const r = NB.normalizeRequest({ name: 'book_appointment', call: { call_id: 'r1', from_number: '+1555' }, args: { start: '2026-11-17T10:00' } });
  assert.strictEqual(r.source, 'retell');
  assert.strictEqual(r.calls[0].kind, 'book');
});
t('check: offers open times, skips past, lead time, lunch, and busy', () => {
  const busy = [{ start: '2026-11-16T14:00:00-05:00', end: '2026-11-16T15:00:00-05:00' }];
  const d = NB.decide(call('check', { date: '2026-11-16' }), Object.assign({}, S, { max_offer: 10 }), busy, {}, NOW);
  // 9 is past, 10 is inside the 60 min lead time, 12 is lunch, 2 PM is busy.
  assert.deepStrictEqual(d.slots, ['2026-11-16T11:00:00-05:00', '2026-11-16T13:00:00-05:00', '2026-11-16T15:00:00-05:00', '2026-11-16T16:00:00-05:00']);
});
t('check: closed day rolls to the next open day', () => {
  const d = NB.decide(call('check', { date: '2026-11-22' }), S, [], {}, NOW); // Sunday
  assert.ok(/^No open times on Sunday/.test(d.text));
  assert.strictEqual(d.slots[0], '2026-11-23T09:00:00-05:00');
});
t('book: free slot becomes a create with an event body', () => {
  const d = NB.decide(call('book', { start: '2026-11-17T10:00', name: 'Alex' }), S, [], {}, NOW);
  assert.strictEqual(d.action, 'create');
  assert.strictEqual(d.event.start.dateTime, '2026-11-17T10:00:00-05:00');
  assert.strictEqual(d.event.end.dateTime, '2026-11-17T11:00:00-05:00');
  assert.strictEqual(d.event.extendedProperties.private.nobsai_key, 'call-1|2026-11-17T10:00:00-05:00');
});
t('book: busy slot is refused, nothing booked, other times offered', () => {
  const busy = [{ start: '2026-11-17T15:00:00Z', end: '2026-11-17T16:00:00Z' }]; // 10 to 11 AM ET
  const d = NB.decide(call('book', { start: '2026-11-17T10:00' }), S, busy, {}, NOW);
  assert.strictEqual(d.action, 'taken');
  assert.ok(/Nothing was booked/.test(d.text));
  assert.ok(d.slots.length > 0 && !d.slots.includes('2026-11-17T10:00:00-05:00'));
});
t('book: partial overlap and buffer both count as taken', () => {
  const busy = [{ start: '2026-11-17T10:30:00-05:00', end: '2026-11-17T10:45:00-05:00' }];
  assert.strictEqual(NB.decide(call('book', { start: '2026-11-17T10:00' }), S, busy, {}, NOW).action, 'taken');
  const busy2 = [{ start: '2026-11-17T11:00:00-05:00', end: '2026-11-17T11:30:00-05:00' }];
  const S2 = Object.assign({}, S, { buffer_minutes: 15 });
  assert.strictEqual(NB.decide(call('book', { start: '2026-11-17T10:00' }), S, busy2, {}, NOW).action, 'create');
  assert.strictEqual(NB.decide(call('book', { start: '2026-11-17T10:00' }), S2, busy2, {}, NOW).action, 'taken');
});
t('book: lunch, after hours, too soon, and date-only are refused', () => {
  assert.strictEqual(NB.decide(call('book', { start: '2026-11-17T12:00' }), S, [], {}, NOW).action, 'closed');
  assert.strictEqual(NB.decide(call('book', { start: '2026-11-17T16:30' }), S, [], {}, NOW).action, 'closed');
  assert.strictEqual(NB.decide(call('book', { start: '2026-11-16T10:00' }), S, [], {}, NOW).action, 'too_soon');
  assert.strictEqual(NB.decide(call('book', { start: '2026-11-17' }), S, [], {}, NOW).action, 'error');
});
t('book: retried tool call returns the same confirmation, no second create', () => {
  const first = NB.decide(call('book', { start: '2026-11-17T10:00' }), S, [], {}, NOW);
  const ledger = { [first.key]: { code: first.code, start: first.start } };
  const again = NB.decide(call('book', { start: '2026-11-17T10:00:00-05:00' }, { toolCallId: 'tc-retry' }), S, [], ledger, NOW);
  assert.strictEqual(again.action, 'duplicate');
  assert.strictEqual(again.code, first.code);
});
t('race: earliest created wins, the other copy loses', () => {
  const a = { id: 'evA', created: '2026-11-16T15:00:00.100Z', key: 'call-A|x' };
  const b = { id: 'evB', created: '2026-11-16T15:00:00.180Z', key: 'call-B|x' };
  assert.strictEqual(NB.verifyWinner(a, [a, b]).outcome, 'won');
  assert.strictEqual(NB.verifyWinner(b, [a, b]).outcome, 'lost');
});
t('race: same caller retry that landed twice is a duplicate, not a loss', () => {
  const a = { id: 'evA', created: '2026-11-16T15:00:00.100Z', key: 'call-A|x' };
  const a2 = { id: 'evA2', created: '2026-11-16T15:00:00.300Z', key: 'call-A|x' };
  assert.strictEqual(NB.verifyWinner(a2, [a, a2]).outcome, 'duplicate');
});
t('race: same created time breaks the tie the same way for both sides', () => {
  const a = { id: 'evA', created: '2026-11-16T15:00:00.100Z', key: 'k1' };
  const b = { id: 'evB', created: '2026-11-16T15:00:00.100Z', key: 'k2' };
  const ra = NB.verifyWinner(a, [a, b]).outcome, rb = NB.verifyWinner(b, [b, a]).outcome;
  assert.deepStrictEqual([ra, rb].sort(), ['lost', 'won']);
});
t('race: cancelled events are ignored', () => {
  const a = { id: 'evA', created: '2026-11-16T15:00:00.100Z', key: 'k1', status: 'cancelled' };
  const b = { id: 'evB', created: '2026-11-16T15:00:00.200Z', key: 'k2' };
  assert.strictEqual(NB.verifyWinner(b, [a, b]).outcome, 'won');
});
t('Vapi response: results, toolCallId, flat string, error field on errors', () => {
  const r = NB.buildResponse('vapi', [{ toolCallId: 'a', text: 'Line one\nline two' }, { toolCallId: 'b', text: 'bad', is_error: true }]);
  assert.deepStrictEqual(r, { results: [{ toolCallId: 'a', result: 'Line one line two' }, { toolCallId: 'b', error: 'bad' }] });
});
t('no em dashes in anything the caller hears', () => {
  const d = NB.decide(call('check', { date: '2026-11-17' }), S, [], {}, NOW);
  assert.ok(!/[\u2014\u2013]/.test(d.text));
});
console.log('\n' + pass + ' tests passed');
