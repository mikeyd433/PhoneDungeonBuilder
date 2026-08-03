import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from '@/features/auth/useSession'
import Login from '@/routes/Login'
import Stories from '@/routes/Stories'
import Room from '@/routes/Room'
import Ledger from '@/routes/Ledger'
import Import from '@/routes/Import'
import Preview from '@/routes/Preview'
import MapScreen from '@/routes/Map'
import Playtest from '@/routes/Playtest'
import Export from '@/routes/Export'
import Cast from '@/routes/Cast'
import AudioImport from '@/routes/AudioImport'
import Record from '@/routes/Record'
import VersionBadge from '@/features/app/VersionBadge'

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
      {screen()}
      {/* Outside the routes: the sign-in screen is exactly where you most need
          to know whether a deploy has landed. */}
      <VersionBadge />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
