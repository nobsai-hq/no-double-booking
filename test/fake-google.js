// Fake Google Calendar API for local tests. Only the 4 calls the workflow uses.
const http = require('http');
let events = []; let n = 0; const log = [];
const DELAY = +(process.env.DELAY || 400);
function send(res, code, obj) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); }
http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); log.push(req.method + ' ' + u.pathname);
    if (u.pathname === '/_state') return send(res, 200, { events, log });
    if (u.pathname === '/_reset') { events = []; log.length = 0; return send(res, 200, { ok: 1 }); }
    if (u.pathname === '/_seed') { const e = JSON.parse(b); e.id = 'seed' + (++n); e.created = new Date().toISOString(); e.status='confirmed'; events.push(e); return send(res, 200, e); }
    if (req.method === 'POST' && u.pathname === '/calendar/v3/freeBusy') {
      const q = JSON.parse(b); const t0 = Date.parse(q.timeMin), t1 = Date.parse(q.timeMax);
      const busy = events.filter(e => Date.parse(e.start.dateTime) < t1 && t0 < Date.parse(e.end.dateTime)).map(e => ({ start: e.start.dateTime, end: e.end.dateTime }));
      return setTimeout(() => send(res, 200, { calendars: { [q.items[0].id]: { busy } } }), DELAY);
    }
    const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(u.pathname);
    if (m && req.method === 'POST') { const e = JSON.parse(b); e.id = 'ev' + (++n); e.created = new Date().toISOString(); e.status = 'confirmed'; events.push(e); return send(res, 200, e); }
    if (m && req.method === 'GET') { const t0 = Date.parse(u.searchParams.get('timeMin')), t1 = Date.parse(u.searchParams.get('timeMax')); return send(res, 200, { items: events.filter(e => Date.parse(e.start.dateTime) < t1 && t0 < Date.parse(e.end.dateTime)) }); }
    if (m && req.method === 'DELETE') { events = events.filter(e => e.id !== m[2]); res.writeHead(204); return res.end(); }
    send(res, 404, { error: 'nope' });
  });
}).listen(7777, () => console.log('mock on 7777'));
