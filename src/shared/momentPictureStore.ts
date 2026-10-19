/**
 * Pictures kept with saved moments: the frame a Twitch tab already captured
 * (content/moment-frames.js) when a moment was bookmarked or watched from
 * History. They stay in this browser's extension storage and are never
 * uploaded.
 *
 * One picture per moment and scope (an account, or saves kept without one),
 * keyed by the moment's identity (channel, stream or VOD, whole second), so a
 * bookmark and its History entry share it. The worker writes; My Moments and
 * Settings read and remove.
 */

export interface SavedPicture {
  /** `${scope}\n${identity}` */
  key: string
  scope: string
  identity: string
  image: Blob
  /** The stream second the frame shows. */
  offset: number
  savedAt: number
  bytes: number
}

/** Oldest pictures go first past either limit. */
export const PICTURE_LIMITS = { count: 300, bytes: 8 * 1048576 }

export const pictureKey = (scope: string, identity: string) => `${scope}\n${identity}`

/** Keys to drop, oldest first, so at most `limits` remain. */
export function overLimit(pictures: readonly Pick<SavedPicture, 'key' | 'savedAt' | 'bytes'>[], limits = PICTURE_LIMITS): string[] {
  const newestFirst = [...pictures].sort((a, b) => b.savedAt - a.savedAt)
  const drop: string[] = []
  let bytes = 0
  newestFirst.forEach((picture, index) => {
    bytes += picture.bytes
    if (index >= limits.count || bytes > limits.bytes) drop.push(picture.key)
  })
  return drop
}

/** Keys of `scope` whose moment is no longer saved or in History. */
export function stalePictures(pictures: readonly Pick<SavedPicture, 'key' | 'scope' | 'identity'>[], scope: string, live: ReadonlySet<string>): string[] {
  return pictures.filter(picture => picture.scope === scope && !live.has(picture.identity)).map(picture => picture.key)
}

/** Where pictures are kept; IndexedDB in the extension, a Map in tests. */
export interface PictureBackend {
  all(): Promise<SavedPicture[]>
  get(key: string): Promise<SavedPicture | undefined>
  put(picture: SavedPicture): Promise<void>
  remove(keys: readonly string[]): Promise<void>
}

const DATABASE = 'pulse-moment-pictures-v1'
const STORE = 'pictures'

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await database()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = work(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request ? request.result : undefined)
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Local storage unavailable'))
    })
  } finally { db.close() }
}

export const indexedPictures: PictureBackend = {
  all: async () => (await run<SavedPicture[]>('readonly', store => store.getAll())) ?? [],
  get: key => run<SavedPicture>('readonly', store => store.get(key)),
  put: async picture => { await run('readwrite', store => { store.put(picture) }) },
  remove: async keys => {
    if (keys.length) await run('readwrite', store => { for (const key of keys) store.delete(key) })
  },
}

export class MomentPictureStore {
  constructor(private readonly backend: PictureBackend = indexedPictures, private readonly limits = PICTURE_LIMITS) {}

  /** Keeps the first picture of a moment; a moment that has one keeps it. True when stored. */
  async attach(scope: string, identity: string, image: Blob, offset: number, now: number): Promise<boolean> {
    const key = pictureKey(scope, identity)
    if (await this.backend.get(key)) return false
    await this.backend.put({ key, scope, identity, image, offset, savedAt: now, bytes: image.size })
    await this.backend.remove(overLimit(await this.backend.all(), this.limits))
    return true
  }

  async has(scope: string, identity: string): Promise<boolean> {
    return (await this.backend.get(pictureKey(scope, identity))) !== undefined
  }

  drop(scope: string, identity: string): Promise<void> {
    return this.backend.remove([pictureKey(scope, identity)])
  }

  /** Removes the pictures of `scope` whose moment is no longer saved or in History. */
  async reconcile(scope: string, live: ReadonlySet<string>): Promise<void> {
    await this.backend.remove(stalePictures(await this.backend.all(), scope, live))
  }

  async dropScope(scope: string): Promise<void> {
    await this.backend.remove((await this.backend.all()).filter(picture => picture.scope === scope).map(picture => picture.key))
  }

  /** A save that joined an account takes its picture along. */
  async move(from: string, to: string, identity: string): Promise<void> {
    const picture = await this.backend.get(pictureKey(from, identity))
    if (!picture) return
    if (!(await this.backend.get(pictureKey(to, identity)))) await this.backend.put({ ...picture, key: pictureKey(to, identity), scope: to })
    await this.backend.remove([picture.key])
  }

  async count(): Promise<number> {
    return (await this.backend.all()).length
  }

  async clear(): Promise<void> {
    await this.backend.remove((await this.backend.all()).map(picture => picture.key))
  }

  /** The newest picture of each identity asked for, from any scope. */
  async forMoments(identities: readonly string[]): Promise<Map<string, SavedPicture>> {
    const wanted = new Set(identities)
    const found = new Map<string, SavedPicture>()
    for (const picture of await this.backend.all()) {
      if (!wanted.has(picture.identity)) continue
      const prior = found.get(picture.identity)
      if (!prior || picture.savedAt > prior.savedAt) found.set(picture.identity, picture)
    }
    return found
  }
}

export const momentPictures = new MomentPictureStore()
