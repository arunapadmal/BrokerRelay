import { createClient } from '@supabase/supabase-js'

// Invitation auth requests must never replace the sender's signed-in session.
export async function sendInvitationEmail(email: string, redirectTo: string) {
  const sender = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
  const result = await sender.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: redirectTo } })
  if (result.error) throw result.error
  if (result.data.session) throw new Error('Email confirmation is disabled. The invitation is saved, but no verification email was sent. Ask the platform owner to enable Confirm email in Supabase, then resend.')
}
