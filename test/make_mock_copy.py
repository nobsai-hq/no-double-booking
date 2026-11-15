#!/usr/bin/env python3
"""Make a test copy of workflow.json that talks to test/fake-google.js on localhost:7777
instead of Google, with no credentials, in google mode, on webhook path booking-tool-mock."""
import json, sys
from pathlib import Path
src = Path(__file__).resolve().parent.parent / "workflow.json"
w = json.loads(src.read_text())
w["name"] = "MOCK Google test copy"
for n in w["nodes"]:
    n["id"] = n["id"][:-4] + "beef"
    if n["type"] == "n8n-nodes-base.webhook":
        n["parameters"]["path"] = "booking-tool-mock"
        n["webhookId"] = "11111111-2222-3333-4444-555555555555"
    if n["type"] == "n8n-nodes-base.httpRequest":
        p = n["parameters"]
        p["url"] = p["url"].replace("https://www.googleapis.com", "http://localhost:7777")
        p["authentication"] = "none"
        p.pop("nodeCredentialType", None)
    if n["name"] == "Settings":
        n["parameters"]["jsCode"] = n["parameters"]["jsCode"].replace("calendar_mode: 'demo'", "calendar_mode: 'google'")
out = Path(sys.argv[1] if len(sys.argv) > 1 else "workflow-mock.json")
out.write_text(json.dumps(w, indent=2))
print("wrote", out)
