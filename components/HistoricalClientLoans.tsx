'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'

type Historical={loans:{application_number:string;lender:string|null}[];lenders:string[]}
export function HistoricalClientLoans({clientId}:{clientId:string}){
 const [data,setData]=useState<Historical|null>(null)
 const [error,setError]=useState('')
 useEffect(()=>{let active=true;void supabase.rpc('get_historical_client_loans_v5',{p_client_id:clientId}).then(({data,error})=>{
  if(!active)return
  if(error)setError(error.message)
  else setData(data as Historical)
 });return()=>{active=false}},[clientId])
 return <section className="card" style={{marginTop:16}}>
  <h2>Imported historical loans & lenders</h2>
  <p className="muted">For reference only. These CRM records are separate from active applications and never create settlement billing events.</p>
  {error&&<p className="notice error" role="alert">{error}</p>}
  {!data&&!error&&<p>Loading historical records…</p>}
  {data&&<>
   {data.loans.length>0?<div className="tableWrap"><table><thead><tr><th>Application number</th><th>Lender</th></tr></thead><tbody>{data.loans.map((r,i)=><tr key={`${r.application_number}-${i}`}><td>{r.application_number}</td><td>{r.lender||'Not provided'}</td></tr>)}</tbody></table></div>:<p>No historical application numbers recorded.</p>}
   <h3>Known lenders</h3>
   {data.lenders.length>0?<p>{data.lenders.join(', ')}</p>:<p>No lender information recorded.</p>}
  </>}
 </section>
}
