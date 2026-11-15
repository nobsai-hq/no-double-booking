#!/usr/bin/env python3
"""Embed logic.js into page.html, then page.html into the Worker source."""
import json
from pathlib import Path

here = Path(__file__).resolve().parent
logic = (here.parent / "logic.js").read_text()
html = here.joinpath("page.html").read_text().replace("/*LOGIC*/", logic)
src = f'''export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {{
      return new Response(HTML, {{
        headers: {{
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
        }},
      }});
    }}
    if (url.pathname === "/health") {{
      return new Response("ok", {{ headers: {{ "content-type": "text/plain" }} }});
    }}
    return new Response("Not found", {{ status: 404 }});
  }},
}};

const HTML = {json.dumps(html)};
'''
here.joinpath("index.js").write_text(src)
print(f"Wrote {here / 'index.js'} ({len(src)} bytes)")
