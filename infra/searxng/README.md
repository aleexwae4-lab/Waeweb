# WAE Search Core

Self-hosted SearXNG node used as WAEWEB's optional general web-index layer.

## Supply-chain pin

Upstream SearXNG is pinned to:

`3cd69d30e2a78dfc817be9e349e7c2e4317c92e3`

The build fails if the checked-out SHA differs.

## Runtime

- Python package install from the pinned official SearXNG source.
- Granian WSGI server.
- JSON search output explicitly enabled.
- Metrics, public-instance mode, autocomplete, image proxy and limiter disabled.
- Secret key must be supplied as `SEARXNG_SECRET`.
- One startup-only loopback smoke check verifies that `/search?...&format=json`
  returns a JSON result array. No recurring background probe is run.

WAEWEB should only set `WAE_SEARXNG_URL` after the Render service reaches
`live` and the startup log reports `WAE_SEARCH_CORE_READY`.
