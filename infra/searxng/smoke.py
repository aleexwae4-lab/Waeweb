import json
import os
import time
import urllib.parse
import urllib.request

port = int(os.environ.get("PORT", "0") or "0")
if not port:
    raise SystemExit(0)

base = f"http://127.0.0.1:{port}"
params = urllib.parse.urlencode({
    "q": "open source software",
    "format": "json",
    "language": "en-US",
    "safesearch": "1",
})

for attempt in range(1, 31):
    time.sleep(1)
    try:
        request = urllib.request.Request(
            f"{base}/search?{params}",
            headers={
                "User-Agent": "WAE-Search-Core-Smoke/1.0",
                "Accept": "application/json",
                "X-Forwarded-For": "127.0.0.1",
                "X-Real-IP": "127.0.0.1",
            },
        )
        with urllib.request.urlopen(request, timeout=8) as response:
            if response.status != 200:
                continue
            payload = json.loads(response.read(2_000_000))
        results = payload.get("results")
        if isinstance(results, list):
            print(
                "WAE_SEARCH_CORE_READY "
                f"json=true results={len(results)} attempt={attempt}",
                flush=True,
            )
            raise SystemExit(0)
    except Exception as exc:
        if attempt in (10, 20, 30):
            print(
                "WAE_SEARCH_CORE_STARTUP_CHECK "
                f"attempt={attempt} status=degraded error={type(exc).__name__}",
                flush=True,
            )

print("WAE_SEARCH_CORE_DEGRADED json=false", flush=True)
