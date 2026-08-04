import { useMemo, useState } from 'react'
import { callSheetText, type CallSheet } from './callSheet'

/**
 * The page you hand a voice actor.
 *
 * The recording queue above answers "how much is left"; this answers "what do I
 * read". Only their lines, in the order the story is read, with the exact
 * filename each take has to come back as — the same string the bulk importer
 * matches on, so a folder of files named from this sheet lands without anybody
 * renaming anything.
 *
 * Copy and download rather than print: what actually happens is that this gets
 * pasted into a message, and a .txt survives being forwarded in a way a styled
 * page does not.
 */
function Sheet({ sheet, storyTitle }: { sheet: CallSheet; storyTitle: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const text = useMemo(() => callSheetText(sheet, storyTitle), [sheet, storyTitle])
  const who = sheet.actor ?? 'unassigned'

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `call-sheet-${who.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mt-2 border-t border-mortar/25 pt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {/* A real button: this was an underlined half-sentence three sections
            down a long page, and "I can't find the call sheet" is what that
            gets you. */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-torch/60 px-2.5 py-1 text-torch hover:border-torch"
        >
          {open ? '▾ Hide call sheet' : '▸ Call sheet'} · {sheet.lines.length} line(s)
          {sheet.outstanding > 0 &&
            ` · ${sheet.outstanding} to record, ~${Math.ceil(sheet.outstandingSeconds / 60)} min`}
        </button>
        {sheet.lines.length > 0 && (
          <>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(text)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="rounded border border-mortar/60 px-2 py-0.5 text-mortar"
            >
              {copied ? 'copied' : 'copy'}
            </button>
            <button
              onClick={download}
              className="rounded border border-mortar/60 px-2 py-0.5 text-mortar"
            >
              download
            </button>
          </>
        )}
      </div>

      {open && (
        <ol className="mt-2 flex flex-col gap-2">
          {sheet.lines.map((line) => (
            <li
              key={line.file}
              className={[
                'rounded border border-mortar/25 p-2 text-sm',
                // A finished line stays on the sheet, greyed: a second session
                // needs to see what it is skipping, not have it vanish.
                line.done ? 'opacity-40' : '',
              ].join(' ')}
            >
              <div className="flex flex-wrap items-baseline gap-2 text-xs text-mortar">
                <span className="font-carved text-torch">{line.file}</span>
                <span>{line.where}</span>
                <span className="ml-auto">{line.done ? 'recorded' : `~${line.seconds}s`}</span>
              </div>
              <p className="mt-1 font-voice">{line.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default Sheet
