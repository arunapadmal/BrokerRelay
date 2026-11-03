'use client'
import Link from 'next/link'
import {usePathname} from 'next/navigation'
import {NavigationGroup} from '@/components/NavigationGroup'
import {supabase} from '@/lib/supabase'
export function PlatformNavigation(){const path=usePathname();return <nav className="platformSidebar groupedNavigation" aria-label="Platform navigation">
 <Link href="/platform/dashboard" className={path==='/platform/dashboard'?'platformNavActive':undefined} aria-current={path==='/platform/dashboard'?'page':undefined}>Dashboard</Link>
 <NavigationGroup label="Companies" active={path.startsWith('/platform/companies')} items={[{href:'/platform/companies',label:'Company list'},{href:'/platform/companies/invitations',label:'Invitations'},{href:'/platform/companies/onboarding',label:'Onboarding history'}]}/>
 <NavigationGroup label="Partners" active={path==='/platform/partners'||['agreements','assignments','transfers'].some(v=>path==='/platform/partners/'+v)} items={[{href:'/platform/partners',label:'Partner list'},{href:'/platform/partners/agreements',label:'Agreements & review'},{href:'/platform/partners/assignments',label:'Company assignments'},{href:'/platform/partners/transfers',label:'Transfers'}]}/>
 <NavigationGroup label="Finance" active={path==='/platform/billing'||['commissions','payouts','recoveries'].some(v=>path==='/platform/partners/'+v)} items={[{href:'/platform/billing',label:'Invoices & payments'},{href:'/platform/partners/commissions',label:'Commissions'},{href:'/platform/partners/payouts',label:'Payout history'},{href:'/platform/partners/recoveries',label:'Refund recoveries'}]}/>
 <NavigationGroup label="Operations" active={path.startsWith('/platform/operations')} items={[{href:'/platform/operations',label:'Attention queue'},{href:'/platform/operations/delivery',label:'Billing delivery history'}]}/>
 <NavigationGroup label="Settings" active={path.startsWith('/platform/billing/')||path==='/platform/partners/reviews'} items={[{href:'/platform/billing/supplier',label:'Supplier details & fees'},{href:'/platform/billing/pricing',label:'Pricing'},{href:'/platform/billing/automation',label:'Billing automation'},{href:'/platform/partners/reviews',label:'Manager review settings'}]}/>
 <div className="platformSidebarBottom"><Link href="/account/password">Change password</Link><button type="button" className="secondary" onClick={async()=>{const r=await supabase.auth.signOut();if(r.error){window.alert(r.error.message);return}window.location.replace('/login')}}>Sign out</button></div>
 </nav>}
