#!/usr/bin/env bash
# End to end test against a running local n8n that has BOTH workflows imported and published:
#   workflow.json (demo mode, path booking-tool) and the mock copy from make_mock_copy.py (path booking-tool-mock).
# Starts test/fake-google.js on port 7777. Uses dates in November 2026; edit them if those are in the past.
set -euo pipefail
cd "$(dirname "$0")"
N8N=${N8N:-http://localhost:5678}
RUN=$(date +%s)  # fresh call ids each run, because the workflow remembers bookings it made
node fake-google.js > /tmp/fake-google.log 2>&1 & FG=$!
trap 'kill $FG 2>/dev/null' EXIT
sleep 1
post() { curl -s -H 'content-type: application/json' -d "$2" "$N8N/webhook/$1"; }
check() { python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert eval(sys.argv[2]), d; print('ok ', sys.argv[3])" "$1" "$2" "$3"; }

echo "== demo mode"
post booking-tool '{"tool":"reset_demo"}' >/dev/null
sleep 1  # static data saves when the run ends, a moment after the reply
r=$(post booking-tool '{"tool":"check_availability","args":{"date":"2026-11-17"},"now":"2026-11-15T12:00:00-05:00"}')
check "$r" "d['results'][0]['slots'][0]=='2026-11-17T09:00:00-05:00'" "check lists open times"
V='{"message":{"type":"tool-calls","call":{"id":"call-A"},"toolCallList":[{"id":"tc-1","function":{"name":"book_appointment","arguments":{"start":"2026-11-17T10:00:00-05:00","name":"Alex"}}}]}}'
r=$(post booking-tool "$V"); check "$r" "d['results'][0]['toolCallId']=='tc-1' and d['results'][0]['result'].startswith('Booked')" "Vapi book answers results/toolCallId/result"
sleep 1
r=$(post booking-tool "$V"); check "$r" "d['results'][0]['result'].startswith('Already booked')" "Vapi retry is a duplicate"
r=$(post booking-tool '{"name":"book_appointment","call":{"call_id":"call-B"},"args":{"start":"2026-11-17 10:00","name":"Sam"}}')
check "$r" "d['action']=='taken'" "Retell second caller gets taken plus other times"

echo "== google mode against fake Google API"
curl -s localhost:7777/_reset >/dev/null
post booking-tool-mock '{"tool":"book_appointment","call_id":"call-X-'"$RUN"'","args":{"start":"2026-11-18T14:00","name":"X"}}' > /tmp/race-x.json & P1=$!
post booking-tool-mock '{"tool":"book_appointment","call_id":"call-Y-'"$RUN"'","args":{"start":"2026-11-18T14:00","name":"Y"}}' > /tmp/race-y.json & P2=$!
wait $P1 $P2
both="[$(cat /tmp/race-x.json),$(cat /tmp/race-y.json)]"
check "$both" "sorted(x['results'][0]['action'] for x in d)==['booked','lost']" "two callers at once: one booked, one told it was just taken"
s=$(curl -s localhost:7777/_state)
check "$s" "len([e for e in d['events'] if e['start']['dateTime'].startswith('2026-11-18T14:00')])==1" "calendar holds exactly one event for that slot"
post booking-tool-mock '{"tool":"book_appointment","call_id":"call-Z-'"$RUN"'","args":{"start":"2026-11-18T15:00","name":"Z"}}' > /tmp/rz1.json & P1=$!
post booking-tool-mock '{"tool":"book_appointment","call_id":"call-Z-'"$RUN"'","args":{"start":"2026-11-18T15:00","name":"Z"}}' > /tmp/rz2.json & P2=$!
wait $P1 $P2
both="[$(cat /tmp/rz1.json),$(cat /tmp/rz2.json)]"
check "$both" "sorted(x['results'][0]['action'] for x in d)==['booked','duplicate']" "same call retried at once: booked once, retry gets the same confirmation"
s=$(curl -s localhost:7777/_state)
check "$s" "len([e for e in d['events'] if e['start']['dateTime'].startswith('2026-11-18T15:00')])==1" "still one event for the retried slot"
echo "all n8n checks passed"
