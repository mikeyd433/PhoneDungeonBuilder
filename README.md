# The Delve

A dungeon-crawl authoring tool for a Twilio Studio choose-your-own-adventure IVR.

You stand in a room. The exits are your choices. A lit torch means the room's
audio is recorded; a bricked archway means an unwritten branch. The automap lays
itself out from the node graph — there is no dragging anywhere in this app.

Full spec: [`docs/delve-spec.md`](docs/delve-spec.md).
Working notes for contributors: [`CLAUDE.md`](CLAUDE.md).

## Running it

```bash
pnpm install
cp .env.example .env   # fill in the Supabase publishable key
pnpm dev
```

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest
pnpm build       # production build
```

## Deploying

Built with Vite `base = /delve/` and served from `dabingabongo.com/delve` via the
Dabingabongo repo's `build.sh` and `netlify.toml`. Set `DELVE_BASE=/` to build
for a standalone host instead.

## Database

Supabase project **the-delve**. Migrations in `supabase/migrations/`, applied in
order. Every table has Row Level Security from the migration that creates it.

Roles (spec §9): `owner` and `writer` restructure the story, `voice` may only set
`audio_path`, `audio_duration_ms` and `status`, `viewer` reads.
