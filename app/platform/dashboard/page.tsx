'use client'
import { useEffect,useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { PLATFORM_OWNER_EMAIL } from '@/lib/platform-owner'
import { BrokerRelayBrand } from '@/components/BrokerRelayBrand'
import { PlatformNavigation } from '@/components/PlatformNavigation'
export default function PlatformDashboard(){
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[companies,setCompanies]=useState<number|null>(null)
 useEffect(()=>{void(async()=>{
 const {data:auth,error:authError}=await supabase.auth.getUser()
 if(authError||!auth.user){window.location.replace('/login');return}
 const {data:owner,error:ownerError}=await supabase.from('platform_admins').select('user_id').eq('user_id',auth.user.id).maybeSingle()
 if(ownerError){setError(ownerError.message);return}
 if(!owner||auth.user.email?.toLowerCase()!==PLATFORM_OWNER_EMAIL){window.location.replace('/dashboard');return}
 setReady(true)
 const result=await supabase.rpc('platform_list_companies')
 if(result.error)setError('Company overview unavailable: '+result.error.message)
 else setCompanies((result.data??[]).length)
 })()},[])
 if(!ready)return <main className="page"><p>Checking platform access…</p>{error&&<p role="alert">{error}</p>}</main>
 return <main className="platformShell ownerDashboard"><header className="platformHeader"><BrokerRelayBrand compact/><strong>Platform administration</strong></header><div className="platformBody"><PlatformNavigation/><div className="platformMain"><div className="platformHeading"><div><p className="eyebrow">PLATFORM OWNER</p><h1>Platform dashboard</h1><p>Manage BrokerRelay companies, referral partners, finance and platform settings.</p></div></div>{error&&<p className="notice error" role="alert">{error}</p>}<div className="ownerDashboardGrid"><section className="card"><h2>Companies</h2><p>{companies===null?'Loading company count…':`${companies} registered companies`}</p><p>Manage brokerage accounts and Head Broker invitations.</p><Link className="button" href="/platform/companies">Manage companies</Link></section>{[['Referral partners','Manage partner records and company referrals.','/platform/partners'],['Platform finance','Manage subscriptions, billing plans and invoices.','/platform/billing'],['Platform settings','Review operational checks, delivery issues and scheduled jobs.','/platform/operations']].map(([title,description,href])=><section key={href} className="card"><h2>{title}</h2><p>{description}</p><Link className="button" href={href}>{title==='Referral partners'?'Manage referral partners':title==='Platform finance'?'Manage platform finance':'Manage platform settings'}</Link></section>)}</div></div></div></main>
}
