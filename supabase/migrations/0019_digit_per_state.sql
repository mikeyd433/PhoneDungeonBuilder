-- Two doors behind one key, one per state.
--
-- `unique (from_node_id, digit)` was right for every version of this app that
-- had one wall per room. It is wrong now: a room with readings has a wall per
-- state, and "press 2" is allowed to be a different door in each of them —
-- different words, different destination — as long as no single caller is ever
-- offered both.
--
-- That rule cannot be a unique index, because whether two doors collide depends
-- on the `hidden_doors` rows pointing at them, and on which readings exist. A
-- constraint that could only be checked by joining three tables and evaluating
-- a boolean tree is not a constraint, it is a trigger pretending to be one.
--
-- So it moves into the app, the same way §2 puts "an ending may not have exits"
-- there: `keyConflicts` finds a digit two visible doors share in one state, the
-- room marks it, the ledger lists it and the export refuses to guess quietly.
-- The failure mode this protects against is real — two `Digits equals 2`
-- transitions off one split, where Studio silently takes the first.
--
-- The index stays, without the uniqueness: every lookup in the app is "the
-- doors of this room, by digit", and that is what it was really for.

alter table choices drop constraint choices_from_node_id_digit_key;

create index choices_from_digit_idx on choices (from_node_id, digit);

comment on column choices.digit is
  'The key the caller presses. Unique per room only within one reading state — two doors may share a digit when no state offers both. Checked in the app (features/room/keys.ts), not here.';
