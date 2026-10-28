'use client'

import { useEffect } from 'react'
import { workspaceDestination } from '@/lib/workspace-destination'
import { useState } from 'react'

export default function Home() {
  const [message, setMessage] = useState('Loading BrokerRelay…')
  useEffect(() => {
    void workspaceDestination().then(path => window.location.replace(path)).catch(() => setMessage('Could not open your workspace. Please refresh or open /login to sign in again.'))
  }, [])
  return <main className="center"><div className="card">{message}</div></main>
}
