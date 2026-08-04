import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useToggle } from './preference'

/**
 * A preference outlives the tab, and never takes the app down with it.
 *
 * The second half is the part worth testing: `localStorage` throws outright in
 * some private-browsing modes, on read as well as on write, and a switch
 * remembering which way it was left is not worth a blank screen.
 */
function Switch({ name, fallback }: { name: string; fallback: boolean }) {
  const [on, set] = useToggle(name, fallback)
  return (
    <button onClick={() => set(!on)}>{on ? 'on' : 'off'}</button>
  )
}

describe('useToggle', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('starts on the default nobody has answered yet', () => {
    render(<Switch name="doors-panel" fallback={true} />)
    expect(screen.getByRole('button').textContent).toBe('on')
  })

  it('remembers being turned off', () => {
    const { unmount } = render(<Switch name="doors-panel" fallback={true} />)
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('off')
    unmount()

    // A fresh mount is a fresh tab: the answer has to survive it, which is the
    // whole reason this is not `useState`.
    render(<Switch name="doors-panel" fallback={true} />)
    expect(screen.getByRole('button').textContent).toBe('off')
  })

  it('keeps preferences apart by name', () => {
    render(<Switch name="one" fallback={true} />)
    act(() => screen.getByRole('button').click())
    expect(localStorage.getItem('delve.pref.one')).toBe('off')
    expect(localStorage.getItem('delve.pref.two')).toBeNull()
  })

  it('falls back to the default when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    render(<Switch name="doors-panel" fallback={true} />)
    expect(screen.getByRole('button').textContent).toBe('on')
  })

  /** A preference that lasts the session is a fine outcome; a crash is not. */
  it('still switches when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    render(<Switch name="doors-panel" fallback={true} />)
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('off')
  })
})
