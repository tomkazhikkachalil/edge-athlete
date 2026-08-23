# GHIN / USGA GPA Application Prep

The path to OFFICIAL handicaps. Our computed number is a WHS-style **estimate**
(clearly labeled); the official Handicap Index® lives in the USGA's GHIN
system, and third-party apps reach it through the USGA's **GPA (Golfer
Product Access)** licensing program — the same pathway TheGrint, 18Birdies
and Golfshot use. It is a CONTRACT with the USGA, not a public API. This doc
is the checklist to have ready when traction justifies applying. Checkbox
style follows LAUNCH_RUNBOOK.md: check on proof, not intent.

**Terminology guard:** the authority is the World Handicap System (USGA +
R&A), not the PGA. US delivery = GHIN; Canada = Golf Canada, whose
handicap/score tech is operated by partner **GolfNet** (no public API
program — the Canadian path is a direct partnership inquiry).

---

## 1. Pin the current program terms (do this first, in a browser)

- [ ] Read the USGA GPA overview — the page 403s automated fetchers, so this
      is a human step: usga.org → Handicapping → World Handicap System →
      "GPA Program Overview". Capture: what access tiers exist, fees, golfer
      consent requirements, and the application contact/form.
- [ ] Confirm what GPA licenses in the current cycle (historically: Handicap
      Index lookup by GHIN number, score posting into GHIN, revision-date
      data — scope is contract-dependent).
- [ ] Note the USGA display rules that come with a license: "Handicap
      Index®" trademark formatting, showing the revision date alongside the
      index, and restrictions on caching/retaining GHIN data long-term.

## 2. Application readiness (what the USGA will ask for)

- [ ] Legal entity for Edge Athlete (the license is signed by a company).
- [ ] Public privacy policy URL covering handicap/score data handling.
- [ ] Product description + screenshots (the golf loop: rounds, scorecards,
      trends, the labeled estimate).
- [ ] Active-golfer numbers (apply when there is traction to show; the
      program serves vendors with real users).
- [ ] Data-use plan: index displayed live per golfer consent, no long-term
      GHIN data caching, score-post mapping (below).

## 3. What Edge Athlete already has vs needs

Already in place:
- [x] Self-reported official index field (`sport_settings.golf.handicap`),
      displayed as "Official index (self-reported)" — never conflated with
      the estimate.
- [x] WHS-method estimate ("Handicap est.", explicitly "not an official
      index"), incl. net double bogey + 9-hole conversion.
- [x] Round data that maps cleanly onto a GHIN score post: date, course
      (catalog-linked with rating/slope per tee), gross/adjusted gross,
      9/18 holes, hole-by-hole detail.

Needed before integration work starts:
- [ ] GHIN-number field on the golf sport settings (with format validation).
- [ ] Golfer consent flow (explicit per-athlete opt-in before any GHIN call;
      minors: guardian consent rides the existing guardian rails).
- [ ] Score-post mapper `golf_rounds` → GHIN score payload (course/tee
      identification is the fiddly part — GHIN uses its own course IDs).
- [ ] Display work: Handicap Index® formatting + revision date, distinct
      from the estimate tile.

## 4. Canada (Golf Canada / GolfNet)

- [ ] Partnership inquiry to Golf Canada — their Score Centre tech is run by
      GolfNet; there is no self-serve API program. Ask for: index lookup +
      score posting for consenting members, terms, and fees.
- [ ] Until then: Canadian athletes use the self-reported field + estimate
      (the current, honest state).

## 5. Decision points

- **When to apply:** real golfer traction (the LAUNCH_RUNBOOK's 100-user
  goal is the floor, not the trigger — GPA fees only make sense when the
  official index is a retention lever for a meaningful cohort).
- **Cost vs demand:** pin fees in step 1; weigh against how many users
  actually hold GHIN memberships (US club/association golfers only).
- **Build-vs-wait trigger:** ≥N users with a filled self-reported index (we
  can query `sport_settings` for exactly this signal) — those are the
  athletes who already care about official numbers.
