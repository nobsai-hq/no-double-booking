# How to test this template

Start in demo mode (the default). You need no Google account and no voice platform. Turn the workflow on (Active / Published) so the practice calendar can save, then copy the **Booking Tool** Production URL.

The dates below are in November 2026. If they are in the past when you test, move them forward. All names and numbers are fake.

## 1. Clear the practice calendar

```
POST <booking-url>
Content-Type: application/json

{ "tool": "reset_demo" }
```

Expected: `Demo calendar cleared.` Wait a second before the next call (static data saves when the run ends).

## 2. Check a day (simple test body, with a fake clock)

```
{ "tool": "check_availability", "args": { "date": "2026-11-17" }, "now": "2026-11-15T12:00:00-05:00" }
```

Expected: three open times on Tuesday, Nov 17, starting 9:00 AM, each with a `start` value like `2026-11-17T09:00:00-05:00`. The `now` field only works on the simple test body, not on Vapi or Retell requests.

## 3. Book through a Vapi-shaped request

```
{
  "message": {
    "type": "tool-calls",
    "call": { "id": "call-A", "customer": { "number": "+15550100001" } },
    "toolCallList": [
      { "id": "tc-1", "type": "function",
        "function": { "name": "book_appointment",
                      "arguments": { "start": "2026-11-17T10:00:00-05:00", "name": "Alex" } } }
    ]
  }
}
```

Expected, HTTP 200:

```
{"results":[{"toolCallId":"tc-1","result":"Booked for Tuesday, Nov 17 at 10:00 AM. Confirmation NB-1MDLLA."}]}
```

## 4. Send the same booking again (a retry)

Same body, wait a second first. Expected: `Already booked for Tuesday, Nov 17 at 10:00 AM. Confirmation NB-1MDLLA. Do not book again.` No second event.

## 5. A second caller asks for the same time (Retell-shaped request)

```
{ "name": "book_appointment", "call": { "call_id": "call-B", "from_number": "+15550100002" },
  "args": { "start": "2026-11-17 10:00", "name": "Sam" } }
```

Expected: `action` is `taken`, the result says `That time is already taken.` with three other open times, and `Nothing was booked.`

## 6. Bad input and closed times

- `"start": "2026-11-17T12:00"` (lunch) or `"2026-11-17T16:30"` (ends after 5 PM): `We are closed at that time.` plus other times.
- `"start": "tomorrow 3pm"`: Vapi gets an `error` field: `I need the start time, like 2026-11-17T14:00...`
- A Vapi message with no tool calls (for example a status update): HTTP 200 with `{"results":[]}`.

## 7. Two callers at the same moment (Google mode)

This is the case demo mode cannot block (see README). To test it without a real Google account, use the fake Google API in `test/`:

```
node test/fake-google.js            # listens on localhost:7777
python3 test/make_mock_copy.py      # writes workflow-mock.json (google mode, no credentials, path booking-tool-mock)
```

Import and publish `workflow-mock.json` next to the real workflow, then run `./test/n8n_e2e.sh` (it starts the fake API itself, so stop the one above first). Two bookings for the same slot fire at once. Expected: one `booked`, one `lost` ("was just taken by another caller"), and exactly one event left on the fake calendar.

## Results (Nov 15, 2026)

Run on a local self-hosted n8n 2.47.7 on Linux, workflow imported from this `workflow.json` and published.

- `node test_logic.js`: 18 of 18 logic tests passed (time zones including summer time, Vapi and Retell parsing, hours, lunch, lead time, buffer, overlap, retry, race winner, tie break, cancelled events, response shape).
- Demo mode, real n8n run: cases 1 to 6 above returned the expected answers, all HTTP 200, including a Vapi request with three tool calls in one body (three results, each matched by `toolCallId`).
- Google mode against the fake Google API (`test/fake-google.js`), real n8n run:
  - Two different callers booking 2:00 PM at the same moment: one booked, the other was told it was just taken. The fake calendar showed the second event created and then deleted, leaving one.
  - The same call sent twice at the same moment: one booked, the other got `duplicate` with the same confirmation code. One event left.
  - Fake Google API turned off: Vapi got an `error` result ("The calendar is not reachable right now. Nothing was booked."), HTTP 200.
- `test/n8n_e2e.sh`: 5 of the first 6 runs passed. The one failure was the test itself sending the next request less than a second after a reset, before static data had saved. The script now waits a second, and passed every run after that (6 of 6, plus the final runs before publishing).
- Demo mode, two bookings for the same slot at the same moment: **both were booked.** That is expected (static data is not shared between parallel runs) and is why live use should be on Google mode.

## Not tested yet

- A real Google Calendar account and OAuth credential (the Google nodes were only run against the fake API, which copies the four Google endpoints this uses: freeBusy, events insert, events list, events delete).
- A live Vapi or Retell phone call. The request and response shapes follow the Vapi and Retell docs and were sent by hand.
- n8n Cloud, or n8n queue mode with several workers.
- More than two callers on the same slot at once.
- A same-call retry that arrives less than a second after a successful answer in Google mode. It may be told the time is taken (by its own booking) instead of getting the confirmation again.

If you run any of these, add the results here.
