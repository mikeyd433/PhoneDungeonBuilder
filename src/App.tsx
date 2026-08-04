import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from '@/features/auth/useSession'
import Login from '@/routes/Login'
import Stories from '@/routes/Stories'
import Room from '@/routes/Room'

/**
 * Everything but the two screens you arrive on is fetched when you go there.
 *
 * Eagerly, this was one 2 MB bundle: the export compiler, the state solver, the
 * CSV importer and the whole recording queue downloaded before the first room
 * could render. On the target device order — tablet, then phone — that is the
 * difference between the app opening and the app appearing to hang, and it also
 * put the bundle over the service worker's precache ceiling, which failed the
 * build outright.
 *
 * Room and Stories stay eager because they are where you land.
 */
const Ledger = lazy(() => import('@/routes/Ledger'))
const Import = lazy(() => import('@/routes/Import'))
const Preview = lazy(() => import('@/routes/Preview'))
const MapScreen = lazy(() => import('@/routes/Map'))
const Playtest = lazy(() => import('@/routes/Playtest'))
const Export = lazy(() => import('@/routes/Export'))
const Cast = lazy(() => import('@/routes/Cast'))
const AudioImport = lazy(() => import('@/routes/AudioImport'))
const Record = lazy(() => import('@/routes/Record'))
const Tidy = lazy(() => import('@/routes/Tidy'))

export default function App() {
  const { session, ready } = useSession()

  // Two routes need neither data nor an account, so they stay reachable without
  // a session: the room-art bench, and the walkthrough story, which is built in
  // memory and never touches the database.
  const path = window.location.pathname
  const screen = () => {
    if (path.endsWith('/preview')) {
      return (
        <Routes>
          <Route path="/preview" element={<Preview />} />
        </Routes>
      )
    }
    if (path.includes('/story/demo')) return <StoryRoutes />

    if (!ready) return <p className="p-6 text-mortar">…</p>
    if (!session) return <Login />

    return (
      <Routes>
        <Route path="/" element={<Stories />} />
        <Route path="/import" element={<Import />} />
        <Route path="*" element={<StoryRoutes />} />
      </Routes>
    )
  }

  return (
    <>
      {/* One boundary around everything, rather than one per route: a chunk
          arriving is a fraction of a second on any connection that loaded the
          shell, and a spinner per screen would flash more than it informed. */}
      <Suspense fallback={<p className="p-6 text-mortar">…</p>}>{screen()}</Suspense>
    </>
  )
}

/** Every screen that hangs off one story. Shared so the walkthrough gets the
 *  real routes rather than a parallel set that could drift from them. */
function StoryRoutes() {
  return (
    <Routes>
      <Route path="/story/:storyId" element={<Room />} />
      <Route path="/story/:storyId/map" element={<MapScreen />} />
      <Route path="/story/:storyId/cast" element={<Cast />} />
      <Route path="/story/:storyId/ledger" element={<Ledger />} />
      <Route path="/story/:storyId/playtest" element={<Playtest />} />
      <Route path="/story/:storyId/export" element={<Export />} />
      <Route path="/story/:storyId/audio" element={<AudioImport />} />
      <Route path="/story/:storyId/record" element={<Record />} />
      <Route path="/story/:storyId/tidy" element={<Tidy />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
