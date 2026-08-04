-- Readings, removed.
--
-- 0016 added `node_variants` — a room that reads differently depending on what
-- the caller is carrying. 0017 gave a reading a destination, so it could send
-- the caller onward. 0018 added `hidden_doors`, so a reading could decide which
-- doors were offered. 0019 dropped `unique (from_node_id, digit)` so two doors
-- could share a key, one per reading.
--
-- Between them those four are a second way to say what a FORK on a door already
-- says, and the more expensive way: a reading with a destination is an arrival
-- fork written once on the room instead of once per door in, and a reading with
-- hidden doors is a state — which is the model the room view has just stopped
-- showing. Measured, the cost is a wash (two recorded readings, +4 widgets; one
-- forked twin room, +5), so the only thing keeping readings was that a twin
-- room duplicates the doors and effects and can drift. That is a real cost, and
-- a smaller one than two mechanisms for one job.
--
-- What survives is the plainer pair: a room can say one thing, and a door can
-- go to two rooms depending on a check.
--
-- `unique (from_node_id, digit)` is deliberately NOT restored. Rows written
-- under 0019 may already violate it, and a migration that fails on live data is
-- a worse way to learn that than the marker `features/room/keys.ts` puts on the
-- door — which the room, the editor and the export all now show.

-- Nothing an author WROTE is destroyed by this.
--
-- A reading's words are script, and script is the one thing in here that cannot
-- be reconstructed from anything else — so before the table goes, every
-- reading with words in it is appended to its room's notes, labelled with the
-- condition it answered. The author can then rebuild it as a fork, or a hide
-- gate, or decide it was not needed; what they cannot do is get the words back
-- once the rows are gone.
--
-- Takes are NOT preserved: a recorded reading's file stays in the bucket, but
-- nothing points at it any more. Said out loud rather than hidden, because a
-- silent orphaning of audio is exactly the kind of thing this project has been
-- bitten by before.
update public.nodes n
set notes = concat_ws(
  E'\n\n',
  nullif(n.notes, ''),
  (
    select string_agg(
      concat(
        '[was an alternate reading — when ', v.expression::text, ']',
        case when v.audio_path is not null then E'\n[its take is orphaned: ' || v.audio_path || ']' else '' end,
        E'\n', v.narration
      ),
      E'\n\n' order by v.sort_order
    )
    from public.node_variants v
    where v.node_id = n.id and coalesce(trim(v.narration), '') <> ''
  )
)
where exists (
  select 1 from public.node_variants v
  where v.node_id = n.id and coalesce(trim(v.narration), '') <> ''
);

drop table if exists public.hidden_doors;
drop table if exists public.node_variants;

-- 0016's triggers went with the table; their functions did not.
drop function if exists public.enforce_variant_story();
drop function if exists public.restrict_voice_variant_updates();
