# Backend / Architecture Documentation Template

The structure the **Backend Architect** fills in to produce the project's second
deliverable: a thorough, well-structured understanding of how the target system
works. Write it to `docs/research/ARCHITECTURE.md`. The test of quality: a team
that has never seen the site could design their own version of this system from
this document alone.

Fill every section. Where something truly doesn't apply, write "N/A — <reason>".
Everywhere, **separate what you observed from what you inferred**, and never
record real secrets (credentials, tokens, keys, personal data) — describe
mechanisms, redact values.

```markdown
# <Site Name> — System Architecture (reverse-engineered)

> Status: <partial | substantial | complete> · Depth: <flows | inferred | deep>
> Method: observed via agent-browser on <date>. Observed vs. inferred is marked
> throughout. No real credentials or tokens are recorded here.

## 1. Overview & Purpose
- What the product is and who it's for.
- The core value/flow in two or three sentences.
- High-level shape (SPA / SSR / static / hybrid; rough client/server split).

## 2. Page & Route Map
| Route | Purpose | Auth required | Notes |
|-------|---------|---------------|-------|
| `/` | … | no | … |
| `/dashboard` | … | yes | … |

## 3. Observed API & Network Surface
For the real flows you exercised, the requests the client makes.
| Endpoint | Method | Purpose | Key params | Response shape (summary) | Observed/Inferred |
|----------|--------|---------|------------|--------------------------|-------------------|
| `/api/...` | GET | … | … | `{ … }` | observed |

- Protocol(s): REST / GraphQL / RPC / WebSocket — with examples.
- Pagination, filtering, sorting conventions.
- Error/status patterns.
- Representative request/response examples (redacted of secrets).

## 4. Data Model (entities & relationships)
The entities you reconstructed from responses + UI. Mark each field
observed/inferred.
- **<Entity>** — fields, types, relationships (1:1, 1:many, many:many).
- A simple relationship diagram (text or mermaid) if it helps.
- Explicit note on what's inference vs. seen in payloads.

## 5. Auth & Session
- Login mechanism (form / OAuth / SSO / magic link / …).
- Token/cookie/session model and how it's carried on requests.
- How authenticated routes are protected; refresh/expiry behavior observed.
- (Mechanism only — never actual tokens or credentials.)

## 6. Client State & Navigation
- Routing approach (client-side router / server routes).
- State management signals (cache, optimistic updates, real-time channels).
- Loading/empty/error-state patterns the app uses.

## 7. Key End-to-End User Journeys
For each important journey, an ordered trace:
### Journey: <e.g. Sign-up → Onboard → First action>
1. User does X → client sends `POST /…` → server returns `…` → state Y changes.
2. …
(Repeat for the 2–4 journeys that define the product.)

## 8. Third-Party Services & Infra Signals
Analytics, payments, auth providers, CDNs, maps, feature flags, error tracking —
whatever the traffic, headers, and page source reveal.

## 9. Rebuild Notes
Pragmatic guidance for a team building their own version: the non-obvious
decisions, the parts that look hard, the data the system clearly depends on, and
where a simpler design would suffice.

## 10. Assumptions & Unknowns
- Everything you inferred rather than observed, listed plainly.
- What you could not reach (paywalled flows, admin areas, server internals).
- Open questions a follow-up investigation should resolve.
```

## Writing standard

- **Precise naming** for entities, endpoints, and flows — clean-code discipline
  applied to prose.
- **Observed vs. inferred** marked on every non-trivial claim.
- **Honest edges** — the Assumptions & Unknowns section is what makes the rest
  trustworthy. A document that's transparently 70% complete beats one that's
  confidently wrong.
- **Redaction by default** — mechanisms, not secrets.
