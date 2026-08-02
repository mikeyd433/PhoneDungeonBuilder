import { beforeEach, describe, expect, it, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { clear, drain, enqueue, isOffline, pending, type QueuedWrite } from './offlineQueue'

beforeEach(async () => {
  await clear()
})

describe('isOffline', () => {
  it('recognises a dropped connection', () => {
    expect(isOffline(new Error('Failed to fetch'))).toBe(true)
    expect(isOffline(new TypeError('NetworkError when attempting to fetch resource'))).toBe(true)
  })

  it('does not treat a server rejection as offline', () => {
    // An RLS refusal or a constraint violation will fail identically forever;
    // queueing it would block every later edit behind a write that can't land.
    expect(isOffline(new Error('new row violates row-level security policy'))).toBe(false)
    expect(isOffline(new Error('duplicate key value violates unique constraint'))).toBe(false)
  })
})

describe('queue ordering', () => {
  it('returns writes oldest-first', async () => {
    await enqueue({ table: 'nodes', op: 'update', rowId: 'a', storyId: 's' })
    await enqueue({ table: 'nodes', op: 'update', rowId: 'b', storyId: 's' })
    expect((await pending()).map((w) => w.rowId)).toEqual(['a', 'b'])
  })
})

describe('drain', () => {
  it('applies every queued write and empties the queue', async () => {
    await enqueue({ table: 'nodes', op: 'update', rowId: 'a', storyId: 's' })
    await enqueue({ table: 'nodes', op: 'update', rowId: 'b', storyId: 's' })
    const seen: string[] = []
    const r = await drain(async (w) => {
      seen.push(w.rowId!)
    })
    expect(seen).toEqual(['a', 'b'])
    expect(r).toEqual({ applied: 2, remaining: 0 })
  })

  it('stops at the first network failure, preserving order', async () => {
    // If b fails and c were applied anyway, the story would reach a state the
    // author never created.
    await enqueue({ table: 'nodes', op: 'update', rowId: 'a', storyId: 's' })
    await enqueue({ table: 'nodes', op: 'update', rowId: 'b', storyId: 's' })
    await enqueue({ table: 'nodes', op: 'update', rowId: 'c', storyId: 's' })
    const apply = vi.fn(async (w: QueuedWrite) => {
      if (w.rowId === 'b') throw new Error('Failed to fetch')
    })
    const r = await drain(apply)
    expect(r.applied).toBe(1)
    expect(r.remaining).toBe(2)
    expect((await pending()).map((w) => w.rowId)).toEqual(['b', 'c'])
    expect(apply).not.toHaveBeenCalledWith(expect.objectContaining({ rowId: 'c' }))
  })

  it('drops a permanently rejected write instead of blocking the queue forever', async () => {
    await enqueue({ table: 'nodes', op: 'update', rowId: 'poison', storyId: 's' })
    await enqueue({ table: 'nodes', op: 'update', rowId: 'good', storyId: 's' })
    const r = await drain(async (w) => {
      if (w.rowId === 'poison') throw new Error('violates row-level security policy')
    })
    expect(r.applied).toBe(1)
    expect(r.remaining).toBe(0)
  })

  it('resumes where it left off on a later drain', async () => {
    await enqueue({ table: 'nodes', op: 'update', rowId: 'a', storyId: 's' })
    await enqueue({ table: 'nodes', op: 'update', rowId: 'b', storyId: 's' })
    let online = false
    const apply = async () => {
      if (!online) throw new Error('Failed to fetch')
    }
    expect((await drain(apply)).applied).toBe(0)
    online = true
    expect((await drain(apply)).applied).toBe(2)
    expect(await pending()).toHaveLength(0)
  })
})
