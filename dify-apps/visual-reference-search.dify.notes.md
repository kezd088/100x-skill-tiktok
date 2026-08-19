# visual-reference-search — build notes

Companion to `visual-reference-search.dify.yml`. This app is the execution layer that
sits downstream of `100x-search-query` (which only *generates* the 45 query strings,
15 each for Pinterest/TikTok/Reddit, and does not search anything). This app takes
that `SearchQueryBundle` and actually runs search: real API calls where a platform's
official API legitimately supports it, honestly-labeled manual fallback where it
doesn't.

Research date: 2026-08-05. APIs and access tiers change — re-verify before relying on
this in production if much time has passed.

## Per-platform verdict (top line)

| Platform | Verdict | One-line reason |
|---|---|---|
| **Reddit** | **Real API execution** | Official Data API has a genuine keyword `GET /search` endpoint returning public posts (with image URLs) under a standard, stable OAuth2 app-only flow — but see the 2026 access-gate caveat below, it is not friction-free. |
| **Pinterest** | **Manual fallback** | API v5's only search-shaped endpoints are scoped to the authenticated account's own pins/boards, or to approved commerce catalog partners — there is no endpoint that searches Pinterest's general public content by keyword. |
| **TikTok** | **Manual fallback** | Research API (the only tier with keyword content discovery) explicitly excludes commercial/advertiser/creator applicants; Display/Content Posting API scopes only ever cover the authenticated user's own account, never general search. |

No ToS-violating scraping or workaround was used for Pinterest/TikTok. Both fall back to pre-built manual search URLs,
clearly tagged `execution_mode: "manual_fallback"` in both the workflow output and
this document — never silently presented as fetched results.

---

## 1. Reddit — real API execution

**Verdict: real, automated, per-query HTTP calls against Reddit's official Data API.**

### How it works technically (stable, long-standing, high confidence)

- Auth: OAuth2 **app-only / "userless"** token via the `client_credentials` grant.
  Reddit's own OAuth2 wiki confirms this is sufficient for read-only public data:
  "App clients can request a 'user-less' Authorization token via... the standard
  `client_credentials` grant" and "If your application only reads public subreddit
  data, application-only OAuth is usually enough."
  Source: <https://github.com/reddit-archive/reddit/wiki/oauth2>
- Token endpoint: `POST https://www.reddit.com/api/v1/access_token`, HTTP Basic auth
  with `client_id:client_secret`, body `grant_type=client_credentials`. Token is
  valid for 1 hour. This exact endpoint/grant combination is independently
  corroborated by multiple 2026-dated secondary sources (redditapis.com's
  "Reddit API Authentication 2026" guide) in addition to the archive wiki.
- Search endpoint: `GET https://oauth.reddit.com/search` (and
  `/r/{subreddit}/search`), parameters `q`, `sort`, `t`, `type`, `limit`,
  `restrict_sr`. This is a long-standing, well-documented listing endpoint; results
  are Reddit "Link" objects that expose `thumbnail` and `preview.images[].source.url`
  for image posts — exactly what a visual-reference tool needs.
  Triangulated across: SitePoint's Reddit API walkthrough, data365.co's Reddit
  Search API guide, and the PRAW-based usage pattern described by multiple
  independent write-ups. I could not load Reddit's own interactive
  `reddit.com/dev/api` reference directly (see "what I could not verify" below), so
  this is corroborated-secondary-source confidence, not primary-source-quoted
  confidence, for the exact parameter list — the core fact that `/search` exists and
  returns image-bearing posts is not in serious doubt (it has been Reddit's public
  API for well over a decade).
- Reddit requires a descriptive `User-Agent` header on every request (long-standing,
  stable policy; generic/shared user agents get rate-limited harder) — the DSL
  declares `REDDIT_USER_AGENT` as a required environment variable for this reason.

### What I could NOT independently verify (and why — be honest about this)

`WebFetch` returned HTTP 403 on every direct attempt against `reddit.com`,
`www.reddit.com`, `old.reddit.com`, `redditinc.com`, and `support.reddithelp.com`
(all six attempts were blocked at the tool level, not a "page
doesn't exist" signal). So the following is based on **triangulated secondary
sources** (multiple independent write-ups agreeing on specific, mechanistic details,
including one direct quote surfaced through Google's index of Reddit's own official
help-center article title), not a directly-quoted primary source:

- **2026 commercial/access gate**: multiple sources (redditorshop.com,
  redditapis.com, and others) describe a "Responsible Builder Policy" that, as of
  late 2025/2026, closed **instant self-service** OAuth app registration — new script
  apps reportedly now go through a manual approval/ticket form (selecting
  developer/researcher/moderator category), while **already-approved existing
  credentials keep working unaffected**. An official Reddit Help Center article
  titled "Developer Platform & Accessing Reddit Data" exists (confirmed via search
  index) but I could not open it directly to quote it verbatim.
- **Free-tier rate limit**: consistently reported at **100 queries/minute per
  OAuth-authenticated client** (non-commercial framing), ~10 qpm without OAuth.
- **Commercial pricing**: consistently reported at **$0.24 per 1,000 calls above an
  included allowance, with a $12,000/year (some sources say /month for the
  bulk-allowance tier — sources disagree on year-vs-month framing, flagging this
  explicitly rather than picking one) minimum commitment** for the paid commercial
  tier, announced in 2023 and apparently still the structure in 2026. TechCrunch's
  April 2023 announcement piece confirms the *existence* of paid commercial tiers and
  a free tier for "developers who want to build apps and bots" and "researchers... for
  strictly academic or noncommercial purposes," but did not itself carry the specific
  dollar figures (those came from later reporting).

**Practical implication for this workflow**: the DSL design itself is correct and
uses only stable, long-documented mechanics (OAuth2 client_credentials, `/search`).
The open question is purely operational: as of 2026, obtaining (or renewing) the
`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` pair may require going through Reddit's
approval process rather than instant signup, and sustained commercial-scale use may
cross into Reddit's paid tier. This is a business/access-timeline caveat, not a
workflow-design defect — budget lead time before first run if the user does not
already hold an approved Reddit script app. This is called out again in the "what
needs manual reconnection" section below.

### Design choices worth flagging

- `is_parallel: false` on the iteration node — sequential requests, deliberately
  conservative against the 100 qpm limit (15 sequential search calls is nowhere near
  the limit even run back-to-back).
- `error_handle_mode: continue-on-error` — one failed/rate-limited query shouldn't
  discard the other 14 results for a batch reference-gathering tool.
- Reddit results are filtered to posts where an image URL could actually be
  extracted (`preview.images[0].source.url`, falling back to `thumbnail`); text-only
  posts are dropped rather than returned as noise, since the goal is reference
  images specifically. Up to 5 image-bearing posts per query, from a fetch of up to
  15 raw results. Verified by smoke-testing `reddit_normalize` locally: correctly
  keeps the image post and drops the text-only one, and correctly un-escapes
  Reddit's `&amp;`-encoded preview URLs.
- `http-request` node body/`x-www-form-urlencoded` sub-shape (`body.data[].{key,
  type, value}`) is inferred by analogy to the one concretely-documented body shape
  in this skill's local reference (`body.type: json`, same `data[]` item shape) —
  this specific sub-case wasn't independently re-verified against a live Dify export.
  `validate_dsl.py` does not deep-validate this
  sub-structure either way, so it cannot catch a wrong shape here — treat as
  best-effort and confirm once against a real Dify workspace after import.
- Similarly, `timeout: {connect, read, write}` follows `node-schemas.md`'s primary
  http-request example; a second local example (`complete-examples.md`'s weather
  workflow) uses different key names (`max_connect_timeout` etc.) for the same
  concept. The two local references disagree with each other; I picked the one from
  the per-node-type authoritative reference rather than the illustrative one, and
  flag the discrepancy here rather than silently picking one.

---

## 2. Pinterest — manual fallback

**Verdict: no legitimate general keyword-search access at any tier a normal business
account can obtain. Manual fallback only.**

### Evidence

Pinterest's own generated Python API client (official `pinterest` GitHub org,
auto-generated from the real OpenAPI spec) documents exactly three search-shaped v5
endpoints:

| Endpoint | Scope |
|---|---|
| `GET /search/pins` (`search_user_pins_list`) | "Search for pins for the 'operation user_account'" — the **authenticated account's own pins only**. |
| `GET /search/boards` (`search_user_boards_get`) | "Search for boards for the 'operation user_account'" — the **authenticated account's own boards only**. |
| `GET /search/partner/pins` (`search_partner_pins`) | "Get the top 10 Pins by a given search term" — but scoped to Pinterest's **approved commerce/catalog partner** program (see `developers.pinterest.com/docs/api-features/shopping-overview/` and the Pinterest Partners directory), i.e. an entirely separate business relationship, not a generally obtainable API access tier. |

Source: <https://github.com/pinterest/pinterest-python-generated-api-client/blob/main/docs/SearchApi.md>
(official Pinterest-org repo, generated directly from their real v5 OpenAPI spec).

This matches independent secondary-source summaries: "The official Pinterest API
does not offer a public search endpoint" / "the official API v5 is not suitable [for]
public searches" (blotato.com, netrows.com Pinterest API guides).

Access tiers (confirmed via `developers.pinterest.com/docs/getting-started/access-tiers/`
indexed content plus Pinterest's own Business/Developer community threads): **Trial**
(instant, capped at 1,000 requests/day across all endpoints) → **Standard** (requires
app review: a video demo of the OAuth flow, a hosted privacy policy, and Developer
Guidelines compliance). Both tiers are free, and **both only ever grant deeper access
to the same account-scoped/partner-scoped endpoints above** — upgrading tiers does
not unlock general content search. So this isn't an "apply and wait" situation like
Reddit; it's a structural API-surface gap.

### What this means for the design

To avoid ToS-violating scraping or non-compliant workarounds, Pinterest
gets a single `code` node (`pinterest_fallback`) that builds
`https://www.pinterest.com/search/pins/?q=<urlencoded query>` for each of the 15
queries — a plain public search-results URL for a human to open, not an API call.
Every item is tagged `execution_mode: "manual_fallback"` with an explanatory `note`
field carrying this same justification, so nobody downstream mistakes it for a real
fetch.

---

## 3. TikTok — manual fallback

**Verdict: no currently-obtainable API tier supports keyword-based content
discovery for a commercial use case. Manual fallback only.**

### Evidence

**Research API** (the only TikTok API surface with real keyword/topic content
query capability) explicitly and directly excludes this use case. From TikTok's own
Research API FAQ:

> "I am a creator, advertiser, or commercial user. Am I eligible for access to the
> Research Tools? No."

Source: <https://developers.tiktok.com/doc/research-api-faq>

Eligibility (from `developers.tiktok.com/products/research-api/`, fetched directly):
restricted to academic institutions (US/EEA/UK/Switzerland), or not-for-profit/
independent research organizations (EU, beta, select countries), or academic/
non-profit orgs in Brazil studying youth safety — applicants must be "independent
from commercial interests," conduct research "on a not-for-profit or non-commercial
basis," disclose funding, and pass an ethics review. None of this fits a commercial
ad-production pipeline, by TikTok's own explicit design.

**Display API / Content Posting API** (the tiers a normal business account *can*
get): fetched `developers.tiktok.com/doc/tiktok-api-scopes/` directly. Every
video-related scope is user-account-scoped, not content-discovery-scoped:

| Scope | Grants |
|---|---|
| `video.list` | Read the *authenticated user's own* public videos. |
| `user.info.basic` | Read the *authenticated user's own* basic profile info. |
| `video.publish` / `video.upload` | Post/upload to the *authenticated user's own* profile. |
| `research.data.basic` | "Access to TikTok public data for research purposes" — but this is gated behind the same excluded-for-commercial-use Research API above, not a standalone scope a business app can request. |

No scope, at any tier, allows searching TikTok's general public video library by
keyword for an app that isn't an approved research applicant.

### What this means for the design

Same treatment as Pinterest: a single `code` node (`tiktok_fallback`) builds
`https://www.tiktok.com/search?q=<urlencoded query>` for each of the 15 queries,
tagged `execution_mode: "manual_fallback"` with an explanatory `note`.

---

## 4. Dify marketplace check

Searched `marketplace.dify.ai` and the `langgenius/dify-plugins` /
`langgenius/dify-official-plugins` GitHub listings for Reddit, Pinterest, and TikTok
integrations.

- **No official or community plugin found that wraps Reddit's, Pinterest's, or
  TikTok's own sanctioned API** for this search-by-keyword use case.
- General-purpose scraping plugins **do** exist in the marketplace (e.g. "Bright
  Data Web Scraper," advertised as covering 20+ sources "including TikTok, Reddit,
  Instagram"; also "Anakin," a Playwright-based browser-automation/search plugin).
  **These were deliberately not used.** They scrape rendered pages/content outside
  each platform's own sanctioned API surface, which falls into the category of ToS-violating
  workarounds that should be avoided. Their
  existence in the marketplace doesn't change Pinterest's/TikTok's own API terms.
- Given no real plugin exists to copy identity fields from, Reddit's real-API branch
  uses a plain `http-request` node (per `plugin-marketplace-tools.md`'s own
  guidance: never invent a `plugin_unique_identifier` without a real export/source
  to copy from — `http-request` was the documented, no-invention-required
  alternative for exactly this situation, and serves as the standard fallback when no real plugin is found).

---

## 5. What needs manual reconnection after import

| Item | Action required |
|---|---|
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Set as real values in Dify's workflow Environment Variables panel after import (left empty/placeholder in the DSL by design — never hardcode credentials). Obtaining these in 2026 may require going through Reddit's manual app-approval process rather than instant self-serve signup — see the Reddit section above. If the user already holds an approved Reddit script-type app, its existing `client_id`/`client_secret` should work as-is. |
| `REDDIT_USER_AGENT` | Set to a real, descriptive value, e.g. `visual-reference-search/1.0 (by /u/<reddit_username>)`. Do not leave generic/blank — Reddit rate-limits generic user agents harder. |
| `reddit_get_token` / `reddit_search` HTTP nodes | Best-effort `body`/`timeout` sub-field shapes (see "design choices" above) — open both nodes in Dify's editor after import and confirm the body/timeout fields render correctly in the UI; adjust if Dify's importer normalizes them differently than authored. |
| Everything else (Pinterest/TikTok fallback nodes, `start`/`end`/`build_meta`) | No credentials or plugins needed — pure computation, nothing to reconnect. |
| Wiring to `100x-search-query`'s Dify app (once that conversion exists) | Map its `end` node's `queries.pinterest` / `queries.tiktok` / `queries.reddit` outputs directly onto this app's `start` inputs `pinterest_queries` / `tiktok_queries` / `reddit_queries` (all `type: json`, same 15-item `{q, intent_cn, stage}` array shape per `skills/100x-search-query/schema.json`). |

No plugin installs are required at all — every node in this DSL is a native
`start`/`code`/`http-request`/`iteration`/`end` node type, zero `tool` nodes, zero
`dependencies` entries.

---

## 6. Validator output (final, clean)

```
$ python scripts/validate_dsl.py --strict --target-version 0.7.0 visual-reference-search.dify.yml
== visual-reference-search.dify.yml
OK

$ python scripts/validate_dsl.py --strict --target-version 0.7.0 --format json visual-reference-search.dify.yml
{
  "path": "visual-reference-search.dify.yml",
  "status": "valid",
  "summary": { "errors": 0, "warnings": 0 },
  "diagnostics": []
}
```

Zero errors, zero warnings — no warnings needed justifying.

Beyond the structural validator (which only regex-checks Python code nodes for a
`def main(` signature, not real syntax), every `code` node's Python was additionally
compiled with `compile(..., "exec")` and smoke-tested with representative inputs
(including a simulated Reddit `/search` JSON response and a query containing `&` to
confirm URL-encoding is correct) — all 7 code nodes compiled and behaved as
designed. This was a local one-off check script, not part of the deliverable.

## 7. Graph summary

13 nodes, 14 edges. `app.mode: workflow`, `version: "0.7.0"`, `kind: app`,
`dependencies: []`.

- `start` → `build_meta` (static per-platform mode summary, parallel branch)
- `start` → `reddit_build_auth_header` → `reddit_get_token` → `reddit_parse_token` →
  `reddit_iteration` (iteration over 15 Reddit queries; inside:
  `reddit_extract_query` → `reddit_search` → `reddit_normalize`)
- `start` → `pinterest_fallback` (single code node, all 15 queries in one pass)
- `start` → `tiktok_fallback` (single code node, all 15 queries in one pass)
- `build_meta` / `reddit_iteration` / `pinterest_fallback` / `tiktok_fallback` → `end`
  (outputs: `reddit`, `pinterest`, `tiktok`, `meta`)
