'use client'

import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function Home() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      window.location.href = data.session ? '/dashboard' : '/login'
    })
  }, [])
  return <main className="center"><div className="card">Loading BrokerRelay…</div></main>
}
