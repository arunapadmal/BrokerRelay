'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
export function PlatformNavigation() {
 const path=usePathname()
 const links=[['/platform/dashboard','Dashboard'],['/platform/companies','Company settings'],['/platform/partners','Referral partners'],['/platform/billing','Platform finance'],['/platform/operations','Platform settings']]
 return <nav className="platformSidebar" aria-label="Platform navigation">{links.map(([href,label])=><Link key={href} href={href} className={path===href||path.startsWith(href+'/')?'platformNavActive':undefined} aria-current={path===href?'page':undefined}>{label}</Link>)}<div className="platformSidebarBottom"><Link href="/account/password">Change password</Link><button type="button" className="secondary" onClick={async()=>{const {error}=await supabase.auth.signOut();if(error){window.alert(error.message);return}window.location.replace('/login')}}>Sign out</button></div></nav>
}
