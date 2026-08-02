import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from '@/features/auth/useSession'
import Login from '@/routes/Login'
import Stories from '@/routes/Stories'
import Room from '@/routes/Room'
import Ledger from '@/routes/Ledger'
import Import from '@/routes/Import'

export default function App() {
  const { session, ready } = useSession()

  if (!ready) return <p className="p-6 text-mortar">…</p>
  if (!session) return <Login />

  return (
    <Routes>
      <Route path="/" element={<Stories />} />
      <Route path="/import" element={<Import />} />
      <Route path="/story/:storyId" element={<Room />} />
      <Route path="/story/:storyId/ledger" element={<Ledger />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
