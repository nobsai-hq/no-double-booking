# No Double Booking for AI Phone Agents

A free n8n booking tool for a Vapi or Retell phone agent. It checks the calendar, books one appointment, and refuses to double book, even when two callers grab the same time at once or the voice platform retries the call.

Built by Bobby Ve, No BS AI.

Try it in the browser first (sandbox, no login, collects no data): https://no-double-booking.nobsai.com
Want it set up on your number? Text SETUP to [(470) 779-2869](sms:+14707792869)

## The problem

This keeps coming up on the n8n community forum.

@imel (Nov 29, 2025), building a roofing appointment line:

> The check_availability custom tool keeps returning "No result returned" error in VAPI.

Source: https://community.n8n.io/t/vapi-check-availabilitycustom-tool-returns-no-result-returned-n8n-workflow-not-executing-either/228454

@LNZMAI (Oct 17, 2025):

> I am having issues with my n8n workflow doing 'double appointment' bookings.

Source: https://community.n8n.io/t/how-to-make-switch-node-route-to-a-specific-path-first/207340

And this week, on a Retell receptionist build by @jamilur_reza, @RodrigoSyncData (Nov 13, 2026) pointed out that if checking and booking are separate calls, "two callers asking for the last slot at the same moment can both get it." The builder confirmed the booking tool "creates an event in the calendar without checking for availability beforehand."

Source: https://community.n8n.io/t/retell-ai-mcp-n8n-an-ai-receptionist-that-books-consultations-and-escalates-to-a-human/328375

Three different things break here:

1. **"No result returned."** Per Vapi's docs, the answer must come back with HTTP 200 (any other status shows up as "No result returned"), as `{ "results": [ { "toolCallId": "...", "result": "..." } ] }`, where `result` is one flat string, not an object.
2. **Stale check.** The agent checks availability, chats for a minute, then books. Someone else may have taken that time in between.
3. **Two at once.** Two calls (or one call plus a retry) hit the last slot within a second. Both see it free. Both book. Google Calendar has no lock to stop that.

## What this workflow does

1. **check_availability** reads free/busy for that day and offers up to 3 open times, inside your hours, outside lunch, with a minimum lead time. If the day is full or closed it offers the next open times.
2. **book_appointment** reads the calendar again right before it writes. If the time is gone, nothing is booked and the caller is offered other times.
3. **Read back after the write.** It reads that slot again. If two bookings landed at once, the earliest one wins and every other copy deletes itself. The loser hears "that time was just taken" and the agent offers another time.
4. **Retries are safe.** A retried tool call for the same call and time returns the same confirmation code instead of a second booking.
5. **Always HTTP 200** in the shape Vapi expects (flat string `result`, or `error` when something failed). Retell gets a JSON object with `result`, `action`, `start`, and `code`.

It starts in **demo mode**: a practice calendar inside the workflow, so you can import and test with no Google account. Switch to Google Calendar when you go live.

## What you need

- n8n (cloud or self-hosted). Tested on n8n 2.47.7 self-hosted.
- A Vapi or Retell agent that can call a custom tool (function).
- For live use: a Google Calendar and an n8n **Google Calendar OAuth2** credential.

## Setup

1. In n8n, **Import from File** and pick `workflow.json`.
2. Open **Settings** and set your hours, days, lunch break, appointment length, buffer, lead time, and time zone.
3. Turn the workflow on (Active / Published) and copy the **Production URL** of the **Booking Tool** webhook.
4. In Vapi, create the two Function tools in `vapi-tools.json` and paste that URL as the server URL on both. Tell the agent today's date in its prompt so it can turn "Tuesday" into `2026-11-17`.
   - Retell: add two custom functions with the same names and parameters, pointing at the same URL. Leave "Payload: args only" off, so the function name is sent.
5. Test in demo mode with the cases in `TESTING.md`.
6. Go live: in **Settings** set `calendar_mode` to `google` and `google_calendar_id` (or keep `primary`). Add your Google Calendar OAuth2 credential to the four Google nodes: **Google Free/Busy**, **Create Event**, **Read Slot Back**, **Delete Our Event**.

## Good to know

- **Demo mode is for practice with one caller at a time.** Its calendar lives in n8n static data, and two n8n runs at the same moment do not see each other's static data. In our test, two demo bookings fired at once both succeeded. Google mode is the one that blocks this, because the calendar itself is shared.
- The retry memory (same call, same time) is also static data. It is a fast path, not the safety net. The read back after the write is the safety net.
- Static data only saves when the workflow is Active, and it saves when the run ends, a moment after the reply goes out.
- One calendar means one appointment at a time. For a shop with four chairs, use one calendar per person and one copy of this workflow (or tool) per calendar.
- Events marked "free" (transparent) in Google are ignored, same as Google's own free/busy.
- Not tested yet against a real Google account or a live Vapi or Retell call. See `TESTING.md` for exactly what was and was not run.

## Files

- `workflow.json`: the n8n workflow to import (21 nodes, including a note).
- `logic.js`: the booking rules. The same code is pasted into the n8n Code nodes, run by the tests, and run by the demo page.
- `build_workflow.py`: rebuilds `workflow.json` from `logic.js`.
- `test_logic.js`: logic tests. Run `node test_logic.js`.
- `test/`: a fake Google Calendar API and an end to end script for a local n8n.
- `vapi-tools.json`: the two Vapi tool definitions.
- `TESTING.md`: payloads, expected answers, and test results.
- `src/`: the Cloudflare Worker for the demo page.
- `LICENSE`: MIT. Free to use and change.

## Built by

Built by Bobby Ve, No BS AI. I bridge the gap between enterprise AI and entrepreneurs.

Live demo: https://no-double-booking.nobsai.com

---

Want it set up on your number? Text SETUP to [(470) 779-2869](sms:+14707792869)
