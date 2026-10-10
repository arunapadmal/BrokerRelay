'use client'
import './company-messages.css'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
export function CompanySchedulePermission({organisationId,userId}:{organisationId:string;userId:string}){
 const [enabled,setEnabled]=useState(false),[notice,setNotice]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false)
 useEffect(()=>{let current=true;void supabase.from('company_schedule_permissions').select('enabled').eq('organisation_id',organisationId).eq('user_id',userId).maybeSingle().then(({data,error})=>{if(current){setEnabled(Boolean(data?.enabled));setReady(!error);setNotice(error?.message??'')}});return()=>{current=false}},[organisationId,userId])
 async function save(){setBusy(true);const {error}=await supabase.rpc('set_company_schedule_permission',{p_org:organisationId,p_user:userId,p_enabled:enabled});setBusy(false);setNotice(error?.message??'Scheduling permission saved.')}
 return <section className="card brMessagePanel schedulePermission"><h3>Company message scheduling</h3><p className="muted">Only the Head Broker can grant this permission. The broker can schedule messages for their assigned clients; company-wide sending requires its separate announcement permission.</p><label className="check"><input type="checkbox" disabled={!ready||busy} checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Can schedule company messages</label><button type="button" disabled={!ready||busy} onClick={()=>void save()}>Save scheduling permission</button>{notice&&<p role="status">{notice}</p>}</section>
}
