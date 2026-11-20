'use client'

import Link from 'next/link'
import {useEffect,useState} from 'react'
import {ApplicationWorkspaceShell} from '@/components/ApplicationWorkspaceShell'
import {supabase} from '@/lib/supabase'

type ClientRow={first_name:string;last_name:string;email:string;mobile:string;birthday:string;application_number:string;lender:string}
type ResultRow={row:number;action:string;reason?:string}
type Summary={preview:boolean;received:number;clients_created:number;clients_matched:number;duplicate_client_rows:number;application_refs_created:number;duplicate_application_refs:number;lender_links_created:number;birthdays_added:number;conflicts:number;invalid:number;billing_events_created:number;rows:ResultRow[]}
const required=['first_name','last_name','email','mobile'] as const
const optional=['birthday','application_number','lender'] as const
const display=[...required,...optional]
const aliases:Record<string,string>={firstname:'first_name',lastname:'last_name',mobile_number:'mobile',phone:'mobile',phone_number:'mobile',date_of_birth:'birthday',dob:'birthday',application_no:'application_number',application_ref:'application_number',loan_number:'application_number',loan_application_number:'application_number',lender_name:'lender'}
function parseCSV(source:string):ClientRow[]{
 const rows:string[][]=[];let row:string[]=[],field='',quoted=false
 source=source.replace(/^\uFEFF/,'')
 for(let i=0;i<source.length;i++){
  const ch=source[i]
  if(ch==='"'){
   if(quoted && source[i+1]==='"'){field+='"';i++}
   else if(quoted)quoted=false
   else if(field==='')quoted=true
   else throw Error('Invalid CSV quotation')
  }else if(ch===','&&!quoted){row.push(field);field=''}
  else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&source[i+1]==='\n')i++;row.push(field);if(row.some(v=>v.trim()))rows.push(row);row=[];field=''}
  else field+=ch
 }
 if(quoted)throw Error('Unclosed CSV quotation')
 row.push(field);if(row.some(v=>v.trim()))rows.push(row)
 if(rows.length<2)throw Error('Include a header row and at least one client')
 const headers=rows[0].map(s=>{const key=s.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');return aliases[key]||key})
 if(new Set(headers).size!==headers.length)throw Error('Two CSV headers map to the same field')
 for(const key of required)if(!headers.includes(key))throw Error(`Missing required CSV header: ${key}`)
 if(rows.length-1>500)throw Error('Maximum 500 CRM records per import')
 return rows.slice(1).map((values,i)=>{
  if(values.length!==headers.length)throw Error(`CSV row ${i+2} has ${values.length} fields; expected ${headers.length}`)
  const r:Record<string,string>={}
  for(const key of display){const index=headers.indexOf(key);r[key]=index<0?'':values[index].trim()}
  return r as ClientRow
 })
}
export default function ImportExistingClientsPage(){
 const [companies,setCompanies]=useState<{organisation_id:string}[]>([])
 const [org,setOrg]=useState('')
 const [clients,setClients]=useState<ClientRow[]>([])
 const [fileName,setFileName]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [preview,setPreview]=useState<Summary|null>(null)
 const [completed,setCompleted]=useState<Summary|null>(null)
 useEffect(()=>{let active=true;(async()=>{
  const {data:auth}=await supabase.auth.getUser();if(!auth.user){window.location.replace('/login');return}
  const {data,error}=await supabase.from('broker_profiles').select('organisation_id').eq('user_id',auth.user.id).eq('is_active',true)
  if(!active)return
  if(error){setError(error.message);return}
  const found=(data??[]).map(v=>({organisation_id:v.organisation_id}))
  setCompanies(found);if(found.length===1)setOrg(found[0].organisation_id)
 })();return()=>{active=false}},[])
 async function load(file:File|undefined){
  setError('');setPreview(null);setCompleted(null);setClients([])
  if(!file)return
  if(file.size>400000){setError('File is too large (400 KB maximum)');return}
  try{const data=parseCSV(await file.text());setClients(data);setFileName(file.name)}
  catch(e){setError(e instanceof Error?e.message:'Could not read CSV')}
 }
 async function run(previewOnly:boolean){
  setError('');setBusy(true)
  try{
   if(!org || !companies.some(c=>c.organisation_id===org))throw Error('Choose an authorised company')
   if(!clients.length)throw Error('Select a CSV file first')
   if(!previewOnly && !preview)throw Error('Review the server-side preview before importing')
   const {data,error:rpcError}=await supabase.rpc('import_crm_clients_v5',{p_organisation_id:org,p_rows:clients,p_preview:previewOnly})
   if(rpcError)throw rpcError
   if(previewOnly){setPreview(data as Summary);setCompleted(null)}
   else{setCompleted(data as Summary);setPreview(null);setClients([])}
  }catch(e){setError(e instanceof Error?e.message:'Import failed')}
  finally{setBusy(false)}
 }
 const summary=(r:Summary)=> <div className="card" style={{marginTop:16}}>
  <h2>{r.preview?'Server-side import preview':'Import completed'}</h2>
  <div className="tableWrap"><table><tbody>
   <tr><th>CSV rows</th><td>{r.received}</td><th>New clients</th><td>{r.clients_created}</td></tr>
   <tr><th>Matched clients</th><td>{r.clients_matched}</td><th>Repeated client rows</th><td>{r.duplicate_client_rows}</td></tr>
   <tr><th>New historical references</th><td>{r.application_refs_created}</td><th>Repeated application numbers</th><td>{r.duplicate_application_refs}</td></tr>
   <tr><th>Lender relationships</th><td>{r.lender_links_created}</td><th>Birthdays filled</th><td>{r.birthdays_added}</td></tr>
   <tr><th>Needs review</th><td>{r.conflicts}</td><th>Invalid rows</th><td>{r.invalid}</td></tr>
   <tr><th>Settlement billing events</th><td colSpan={3}>{r.billing_events_created}</td></tr>
  </tbody></table></div>
  {(r.conflicts>0||r.invalid>0)&&<><h3>Records requiring review</h3><div className="tableWrap"><table><thead><tr><th>CSV row</th><th>Outcome</th><th>Reason</th></tr></thead><tbody>{r.rows.filter(x=>x.action==='invalid'||x.action==='review').slice(0,50).map(x=><tr key={x.row}><td>{x.row}</td><td>{x.action}</td><td>{x.reason??'—'}</td></tr>)}</tbody></table></div></>}
 </div>
 return <ApplicationWorkspaceShell section="active">
  <header className="applicationHeader"><div><p className="eyebrow">BROKERDESK / CLIENTS</p><h1>Import clients & existing loans (CSV)</h1><p className="muted">CRM exports can repeat the same client. Existing clients and historical loan references are matched, not recreated.</p></div><Link className="button secondary" href="/clients">Back to clients</Link></header>
  <section className="card">
   <p><strong>Required:</strong> first_name, last_name, email, mobile</p>
   <p><strong>Optional:</strong> birthday (DD/MM/YYYY), application_number, lender</p>
   <p className="muted">No description, application number or lender is required. Empty optional fields are ignored. Birthday data is stored as month/day; greetings remain disabled until consent.</p>
   <p className="muted">Historical loan references are not active applications and do not generate settlement charges or follow-ups. Conflicting client identities are flagged for review.</p>
   <p><a href="/examples/crm_clients_import_v5.csv" download>Download CSV example</a></p>
   {companies.length>1&&<label>Company<select value={org} onChange={e=>{setOrg(e.target.value);setPreview(null)}}><option value="">Select company</option>{companies.map(c=><option value={c.organisation_id} key={c.organisation_id}>{c.organisation_id}</option>)}</select></label>}
   {companies.length===0&&<p className="notice">You must have an active broker profile to import clients.</p>}
   <label>Choose CRM CSV<input type="file" accept=".csv,text/csv" onChange={e=>void load(e.target.files?.[0])}/></label>
   {!!clients.length&&<><h2>{clients.length} CSV records — {fileName}</h2><div className="tableWrap"><table><thead><tr>{display.map(k=><th key={k}>{k.replaceAll('_',' ')}</th>)}</tr></thead><tbody>{clients.slice(0,8).map((r,i)=><tr key={i}>{display.map(k=><td key={k}>{r[k]||'—'}</td>)}</tr>)}</tbody></table></div>
    {clients.length>8&&<p>Showing the first eight rows. The preview checks all {clients.length} records.</p>}
    <button disabled={busy||!org} onClick={()=>void run(true)}>{busy?'Checking…':'Check duplicates & preview'}</button>
   </>}
   {error&&<p role="alert" className="notice error">{error}</p>}
  </section>
  {preview&&<>{summary(preview)}<section className="card"><p><strong>Confirm import:</strong> Existing matching clients will be reused. Duplicate application numbers will not be recreated. Review any conflicts before proceeding.</p><button disabled={busy} onClick={()=>void run(false)}>{busy?'Importing…':'Confirm import'}</button></section></>}
  {completed&&summary(completed)}
 </ApplicationWorkspaceShell>
}
