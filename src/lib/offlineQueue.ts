/**
 * F7.4 — an IndexedDB write queue, drained on reconnect.
 *
 * §1: "Van has bad signal." A write that fails because the network dropped is
 * not an error the author should have to think about; it is a write that hasn't
 * landed yet.
 *
 * Deliberately narrow. It queues *table row* mutations only — not audio uploads,
 * which can be tens of megabytes and belong in a deliberate retry, and not
 * anything that needs a server-generated id back before the next step can run.
 * Callers that need the returned row bypass the queue.
 *
 * Ordering matters: the queue is drained strictly oldest-first and stops at the
 * first failure, so a later edit can never be applied before the earlier one it
 * depends on.
 */

const DB_NAME = 'delve-offline'
const STORE = 'writes'
const DB_VERSION = 1

export interface QueuedWrite {
  id?: number
  table: string
  op: 'insert' | 'update' | 'delete'
  /** Row id for update/delete. */
  rowId?: string
  payload?: Record<string, unknown>
  storyId: string
  queuedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        t.oncomplete = () => db.close()
      }),
  )
}

export async function enqueue(write: Omit<QueuedWrite, 'id' | 'queuedAt'>): Promise<void> {
  await tx('readwrite', (s) => s.add({ ...write, queuedAt: Date.now() }))
}

export async function pending(): Promise<QueuedWrite[]> {
  const all = await tx<QueuedWrite[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedWrite[]>)
  return all.sort((a, b) => a.queuedAt - b.queuedAt)
}

export async function remove(id: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

export async function clear(): Promise<void> {
  await tx('readwrite', (s) => s.clear())
}

/** Does this failure look like "the network is gone" rather than "the server
 *  said no"? Only the former is worth queueing — an RLS rejection or a
 *  constraint violation will fail identically forever. */
export function isOffline(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /failed to fetch|network|networkerror|load failed|timeout/i.test(message)
}

export type Applier = (write: QueuedWrite) => Promise<void>

/**
 * Drain the queue oldest-first, stopping at the first failure.
 *
 * Stopping matters: if write #2 fails and #3 succeeded, an edit could be
 * applied out of order and the story would end up in a state the author never
 * created. Returns how many landed.
 */
export async function drain(apply: Applier): Promise<{ applied: number; remaining: number }> {
  const queue = await pending()
  let applied = 0
  for (const write of queue) {
    try {
      await apply(write)
      if (write.id !== undefined) await remove(write.id)
      applied++
    } catch (e) {
      // A permanent rejection would block the queue forever, so drop it and
      // carry on — the alternative is an author whose every future edit is
      // stuck behind one poisoned row.
      if (!isOffline(e)) {
        if (write.id !== undefined) await remove(write.id)
        continue
      }
      break
    }
  }
  return { applied, remaining: (await pending()).length }
}
