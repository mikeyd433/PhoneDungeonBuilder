import { useState } from 'react'
import BuildSheet from './BuildSheet'

/**
 * The version, where you can read it, and what changed behind it.
 *
 * Was four grey characters pinned to the top-right corner, taking no clicks —
 * enough to answer "did my push land" if you already knew what a commit hash
 * meant, and nothing otherwise. It sat where the nav wanted to be, too.
 *
 * Now it is a button on the header's FIRST line, which is the one that never
 * scrolls: the row below it holds nine destinations and slides sideways on a
 * phone, so a version living there would be the one thing you had to go
 * looking for. The commit and the build time move into the sheet, where there
 * is room to say what they are for.
 */
export default function BuildButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`Jackie Dungeon ${__APP_VERSION__} · build ${__APP_COMMIT__} — what changed`}
        className="ml-auto flex shrink-0 items-center rounded-lg border border-mortar/45 px-2.5 font-carved text-xs leading-none text-mortar hover:border-torch/70 hover:text-torch"
      >
        v{__APP_VERSION__}
      </button>
      {open && <BuildSheet onClose={() => setOpen(false)} />}
    </>
  )
}
