-- Not every ending is a death.
--
-- `node_type = 'ending'` has meant one thing since the first migration: the
-- call is read out and then hung up on. That is true of getting ashore and of
-- drowning, but a story with both needs to tell them apart — and the room view
-- has been drawing rubble and a skull over every one of them, which reads as
-- "you lost" on the one room where the caller won.
--
-- Nothing about the exported flow changes: both still end the call by reaching
-- a transition with no target. This is the author's own bookkeeping, and what
-- the room and the map draw.

alter table nodes
  add column ending_kind text
  check (ending_kind is null or ending_kind in ('death', 'win'));

-- Null is a death, which is what every existing ending already was, so nothing
-- has to be backfilled and a room that is not an ending simply has none.
comment on column nodes.ending_kind is
  'death | win | null. Only meaningful when node_type = ''ending''; null reads as a death.';
