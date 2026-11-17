# Earthwork Takeoff Studio

WPM Construction's earthwork takeoff: a single-page studio (cut, fill, subgrade, utilities, bid sheet) with a small Node API and a Postgres database. The database layer is the Drizzle package described in [HANDOFF.md](HANDOFF.md) and [docs/DATABASE.md](docs/DATABASE.md).

**This repository is public.** It contains real job grids, aerials, grading plans, and the Buc-ee's sample bid. Making the GitHub repo private is the owner's choice; nothing in this project changes that setting.

The page still opens as a static site. On GitHub Pages, where there is no API, it keeps working and shows **Local mode — this browser only**. Edits then stay in `localStorage`. That copy is a cache, not the record.

## Local development

Requires Node 18 or newer. No `DATABASE_URL` means an embedded Postgres (PGlite) in `./.pglite`.

```bash
npm install
cp .env.example .env   # optional; leave DATABASE_URL unset for PGlite
npm start              # migrate, seed, import studio jobs, listen on 0.0.0.0:$PORT (3000)
```

Open http://localhost:3000. Pick your name. If `APP_PASSWORD` is unset, the password box is hidden. Set `APP_PASSWORD` in `.env` before you treat the machine as shared. `.env` is gitignored. Do not commit it.

Other commands:

```bash
npm test                         # package tests plus API, import, and earthwork tests
npm run db:migrate               # apply SQL migrations
npm run db:seed                  # company library, five employees, Buc-ee's sample bid
npm run db:import-studio         # load the studio job files (safe to re-run)
npm run db:import-project -- file.json
npm run db:reset                 # local only: wipe, migrate, seed
```

`STUDIO_IMPORT=0 npm start` skips the studio import. The first start writes the grids and PNGs into the database, so it takes longer than a later start.

`npm test` uses in-memory PGlite and does not read `DATABASE_URL`.

## What is stored

Company data (shared): HEB rate library (81 rates), crews, vendor quotes, FDOT prices, exclusion and note templates, and the five employees Zach, Clay Deering (Estimator), Darren, Joe, and Charles. Anything not known about the other four stays null.

Studio data (per job): the grid file, aerial and grading PNGs, subgrade depths, fill factors, mass balance, grading rows, equipment and crew card, trucking and material lines. Every save goes through `db/repo.js` and writes an `activity_log` row in the same transaction. The version `rev` is an optimistic lock; a stale save returns 409 and the page reloads.

Example equipment rates ship in the page so the sheet has a shape. They are not a bid. Direct cost and bid total stay null, and no bid snapshot is written, until someone edits those rates (`touched`). Bid outcome stays unset until someone picks one. The Buc-ee's sample bid is a separate estimating document and still ties to **$18,405,662.10**. The studio grid for that job is attached to the same project and does not replace that snapshot.

## How the job files were imported

| File | Project | Why |
|---|---|---|
| `data.json` | Building 820 Parking Lot - Brooks City Base | That is the `name` inside the file. The filename is only historical. |
| `bucees.json` | Existing Buc-ee's #49 sample (`ce08cc827c`) | Same job as the sample bid. The grid is an earthwork version, not a second project. |
| `va.json` | VA CBOC San Marcos TX | One site model. |
| `dunant.json` | McKinney Dunant Union, 7201 Dunant Way, Austin TX | One project. Phase names are stored. Per-phase cut and fill are not in the file, so those quantities stay null until the page computes them. |
| `alamo_base.json`, `alamo_alt.json` | One project, Alamo Church Phase 7 | Base (C3.00) and east alternate (C3.10) are two scenarios on one project. The job picker still lists both. |
| `innovation.json`, `innovation_p2.json`, `innovation_p3.json` | One project, Innovation Building #2, 1222 Kelly Pkwy, San Antonio TX | Three grids: the Phases 2 and 3 model, Phase 2, and Phase 3. There is no phase 1 file. The same `cut_cy` / `fill_cy` pair is written on each version because each file states it; it may describe the overall model. |

Where a file has no cut, fill, import, or export, those columns are null and the version is flagged. Shrink and swell are stored when the file states them, including an explicit 0. The page still opens with shrink 0 and swell 0, which is how the studio already behaved. A 6 in moisture default and a 1 ft curb overbuild are page defaults, not file facts, until someone edits them.

Import is idempotent. A second run with the same file bytes writes nothing. A version someone has edited (`rev > 1`) is not overwritten by a later import.

## Render

The Blueprint is [render.yaml](render.yaml). It defines one Node web service in Ohio and reads `DATABASE_URL` from the existing database **wpm-takeoff-studio-db** with `fromDatabase`. It does not create a database and it does not contain a URL or a password.

Before the first deploy, in the Render dashboard for that service (or when you sync the Blueprint):

1. Set `APP_PASSWORD` (secret, `sync: false`). The process refuses to boot in production without it. Everyone on the team uses this shared password, then picks their own name. The name is one of the five employees, and the activity log stores that employee id.
2. Leave `ANTHROPIC_API_KEY` unset unless you later add a server-side model call. The Ask AI button in the page only works inside claude.ai. This server does not call Anthropic.
3. Confirm the service region is Ohio, same as the database, so the internal connection string resolves.
4. Sync the Blueprint, or create the web service from it. `preDeployCommand` runs `npm run db:migrate && npm run db:seed && npm run db:import-studio`.
5. Health check is `GET /api/health`. It does not require a login.

Do not put `DATABASE_URL` in git. Copy the external URL from the Render database page only into a local `.env` if you want to migrate against that database from a laptop. This repo's code never connects unless that variable is set in the environment.

## Auth

`POST /api/login` with `{ employeeId, password }`. The cookie is `HttpOnly`. Clay's login is an admin role; the other four are estimator roles. That role is the app login, not a job title. Viewer role, if you assign it later, can read and cannot write. Sign out is in the header.

## Assumptions

- Alamo base and alternate are one project with two earthwork scenarios.
- Innovation phases 2 and 3 are one project with three earthwork versions. There is no phase 1 file.
- `data.json` is Building 820 Parking Lot at Brooks City Base.
- New studio projects have no estimator, no region, and no bid outcome. `TX-HEB` is the rate-library market, not a job region, so it is not copied onto Texas jobs.
- The address strings stored on Dunant and Innovation are taken from the job file names.
- City is not stored for Alamo, the VA clinic, or Brooks beyond the words already in the job name.
- The studio's example crew rates are not written into the HEB library.
- A project outcome is one row per project, so the Alamo base and alternate share it. The control is labeled "Project outcome".
- Changing the outcome on the Buc-ee's project keeps the original sample snapshot id, so the $18,405,662.10 basis stays put unless a separate studio pricing snapshot was saved on another project.
