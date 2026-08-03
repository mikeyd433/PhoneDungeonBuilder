-- Somebody is standing there.
--
-- A room's dialogue already says who speaks. It does not say who is PRESENT,
-- and those are different questions: Mike and Carter are the party — the caller
-- is one of them — and the narrator is nobody at all, so drawing a figure for
-- every voice would put three people in a room the caller is alone in.
--
-- So it is opt-in, per character, and it is a property of the character rather
-- than of the room: whoever the innkeeper is, he looks the same in every room
-- he turns up in, and nobody should have to say so once per scene.
--
-- Null is nobody to draw, which is what every existing character already is.

alter table characters
  add column figure text
  check (
    figure is null
    or figure in ('standing', 'looming', 'small', 'seated', 'beast')
  );

comment on column characters.figure is
  'Which silhouette to stand in the room when this character speaks there. Null draws nobody — which is right for the party and for the narrator.';
