-- Room designs.
--
-- A dungeon that is one texture for 143 rooms reads as one room visited 143
-- times. This lets a room say what KIND of place it is — a flooded lagoon, the
-- inside of a tree, a bone house — while every element that encodes data stays
-- exactly where it was.
--
-- Deliberately a plain text column rather than an enum: designs are a rendering
-- concern and the set will grow, and adding an enum value in Postgres cannot be
-- done inside a transaction with other DDL. An unknown value falls back to
-- `stone` in the renderer rather than erroring, so the app tolerates a design
-- that a later migration removes.
--
-- This does NOT change what any visual element means (spec §0, rule 1). The
-- torch still means recorded audio, a bricked arch still means an unwritten
-- branch. Only the surface changes.

alter table nodes
  add column room_design text not null default 'stone';

comment on column nodes.room_design is
  'Visual treatment for the room view. Falls back to stone if unrecognised.';
