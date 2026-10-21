# Security and privacy

FieldWise is a static web page: there is no server of ours to attack, no account to steal and no database to leak. That
removes most risks. This file lists the ones that remain, what the code does about each, and what it does not cover.

## What data exists and where it goes

| Data | Where it lives | Leaves the device? |
| --- | --- | --- |
| Profiles, plans, soil numbers, boundary, photos' analysis | This browser's localStorage | No |
| API key | sessionStorage (forgotten when the tab closes), or localStorage if "Remember" is ticked | Only to Google, in an `x-goog-api-key` header |
| Photos | In memory only (shrunk, metadata removed) | Only to Gemini, and only after a per-photo tick box |
| Address text | Typed in the Land tab | To Nominatim when "Find address" is pressed |
| Land position | In the profile | To USDA / SoilGrids when "Get soil data" is pressed; to map tile servers as tiles are requested |

Settings, Privacy and security shows this table to the user. There is no analytics, advertising or tracking code.

## Threats and defenses

| Threat | Defense | Where |
| --- | --- | --- |
| Script injection (XSS) from typed text, imported files or AI text | The page never builds HTML from text. `h()` creates elements and text nodes; `innerHTML`, `outerHTML` and `srcdoc` throw. Links are limited to http(s). Strict Content-Security-Policy: scripts and styles only from the page's own files | `src/ui/dom.js`, `index.html` |
| Page talks to somewhere it should not | CSP `connect-src` lists the few services used; `net.js` re-checks https and an allowlist, caps time (15 s default) and size (2 MB), sends no cookies and no referrer | `index.html`, `src/net.js` |
| Prompt injection (text in a photo or note that says "ignore your rules") | Prompts mark farm data and image text as untrusted; the model's answer is only ever **data**: validated by `validate.js` (known keys only, cleaned text, clamped numbers, whitelisted words). Nothing from the AI can run code or change land data without an Apply click | `src/ai/tasks.js`, `src/ai/validate.js` |
| Wrong quiz answer keys from the AI | A question with an out-of-range or malformed answer index is rejected, never "fixed" | `validateQuiz` |
| Leaking the API key | Header only (never the URL), not in exports or profiles, not logged, sessionStorage by default, removable, and erased by "Erase everything" | `src/ai/gemini.js`, `src/storage.js` |
| Leaking identity or location to the AI | `buildAIContext` is the only door: rounded numbers, no name, address, coordinates or profile title; photos have EXIF removed | `src/ai/tasks.js`, `src/photo.js` |
| Malicious or corrupt imported profile | 2 MB cap, JSON parse in try/catch, every field re-built through `sanitizeProfile` (types, ranges, lengths, ids, counts); unknown fields dropped | `src/storage.js` |
| Malicious image file | Type from magic bytes (not the name), 15 MB cap, decoded and re-encoded on a canvas, 1024 px cap | `src/photo.js` |
| Burning through a free quota (cost / lock-out) | 4 s minimum gap, one call at a time, repeats cached 10 minutes, 60 calls per session | `guardProvider` |
| Open-source dependency problems | Two runtime dependencies, versions pinned exactly (Leaflet 1.9.4, three 0.186.1); `npm audit` is reviewed below | `package.json` |

## Dependency audit

`npm audit` reports 0 vulnerabilities. Run it again before each release and read any new finding rather than applying
`--force`.

## Honest limits

- The key is in browser storage, so **anything running in the page can read it**. The CSP and the no-HTML rule are the
  defense; browser extensions and malware on the computer are out of scope. Use a key with a low quota, never on a shared
  computer with "Remember" on, and delete it in Settings or the Google AI Studio console when finished.
- A key owner must be **18 or older** (Google's free-tier terms). The app asks for this confirmation before saving a key.
  The free tier may use content to improve Google products and let people review it. Do not send photos of people.
- A meta-tag CSP cannot set some headers (`frame-ancestors`, `X-Frame-Options`, HSTS). If you host the page yourself, add
  these at the host (GitHub Pages cannot; Netlify/Cloudflare Pages can):
  `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Profiles in localStorage are not encrypted. Anyone with access to the browser profile can read them. Export files are
  plain JSON.
- Tile servers (Esri, OpenStreetMap, USGS) and USDA/Nominatim see your IP address and the map area you view, as any website
  you visit does.
- Security testing here was: unit tests of the validators and sanitizers, and a real-browser run under the CSP that
  fails on any CSP violation. It was not a professional penetration test.

## If you find a problem

Do not post a working exploit publicly. Tell the team lead and fix it in `validate.js`, `storage.js`, `dom.js` or
`net.js`, then add a test in `tests/` that fails before the fix and passes after.
