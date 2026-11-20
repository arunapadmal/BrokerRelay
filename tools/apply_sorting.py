#!/usr/bin/env python3
"""Apply BrokerRelay sorting UI changes to an exact development-branch checkout.
Idempotency: refuse a second application. Fails closed on unexpected source changes.
Run from the repository root after copying the package contents into it.
"""
from pathlib import Path
import hashlib


def replace_once(source: str, old: str, new: str, path: Path):
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one anchor, found {count}: {old[:100]!r}')
    return source.replace(old,new,1)


EXPECTED_BLOBS = {
 'components/BrokerWorkspace.tsx':'86b1dc2c2bc2e5574996a02d7f3064ed30b4cd1b',
 'app/platform/companies/page.tsx':'f292ceda811bf47cce16484006634a1c8c5901ef',
 'app/platform/partners/page.tsx':'b4d0bd562f77243f0111afad479a933b966b1428',
}
PENDING = {}

def edit(pathname: str, changes):
    p=Path(pathname)
    raw=p.read_bytes()
    s=raw.decode("utf-8")
    if "SORTING_UPGRADE_20261121" in s:
        print(f'Already patched: {pathname}')
        return
    git_sha=hashlib.sha1((f"blob {len(raw)}\0").encode()+raw).hexdigest()
    if git_sha!=EXPECTED_BLOBS[pathname]:
        raise RuntimeError(f"{pathname}: upstream changed (Git blob SHA {git_sha}); review before applying")
    for before,after in changes:
        s=replace_once(s,before,after,p)
    PENDING[pathname]=s
    print(f'Validated {pathname}')


def broker():
    p='components/BrokerWorkspace.tsx'
    edit(p,[
      ("import Link from 'next/link'", "import Link from 'next/link'\nimport {SortHeading, type SortDirection} from '@/components/SortHeading' // SORTING_UPGRADE_20261121"),
      ('unread?:number}', 'unread?:number;settlement_date?:string|null;loan_count?:number}'),
      (" const title={applications:", " const [sortBy,setSortBy]=useState('client'),[sortDirection,setSortDirection]=useState<SortDirection>('asc')\n const sortable=kind==='clients'||kind==='applications'\n const sortOptions=kind==='clients'? [['client','Client'],['email','Email'],['mobile','Mobile'],['status','Status'],['loan_count','Loan count'],['settlement_date','Last settlement'],['created_at','Created']] : [['client','Client'],['reference','Application'],['lender','Lender'],['status','Status'],['settlement_date','Settlement date'],['created_at','Created']]\n const changeSort=(field:string)=>{setSortDirection(d=>sortBy===field?(d==='asc'?'desc':'asc'):'asc');setSortBy(field);setPage(1)}\n const heading=(field:string,label:string)=><SortHeading field={field} label={label} active={sortBy} direction={sortDirection} onSort={changeSort}/>\n const title={applications:"),
      ("supabase.rpc('broker_workspace_search',{p_kind:kind,p_query:query,p_status:status,p_page:page})", "supabase.rpc(sortable?'broker_workspace_sorted':'broker_workspace_search',{p_kind:kind,p_query:query,p_status:status,p_page:page,...(sortable?{p_sort:sortBy,p_direction:sortDirection}:{})})"),
      ('[kind,query,status,page,refresh])','[kind,query,status,page,refresh,sortBy,sortDirection,sortable])'),
      ('</select></label></div>\n {error', '</select></label>{sortable&&<label className="sortMobileControl">Sort by<select value={sortBy} onChange={e=>{setSortBy(e.target.value);setPage(1)}}>{sortOptions.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select><button type="button" className="secondary small" aria-label="Reverse sort direction" onClick={()=>{setSortDirection(d=>d===\'asc\'?\'desc\':\'asc\');setPage(1)}}>{sortDirection===\'asc\'?\'Ascending ↑\':\'Descending ↓\'}</button></label>}</div>\n {error'),
      ('<th>Client</th><th>{kind===\'applications\'?\'Application / lender\':kind===\'documents\'?\'Request / application\':\'Contact\'}</th><th>Status</th><th>Action</th>', '<th>{sortable?heading(\'client\',\'Client\'):\'Client\'}</th><th>{kind===\'applications\'?heading(\'reference\',\'Application / lender\'):kind===\'clients\'?heading(\'email\',\'Contact\'):\'Request / application\'}</th><th>{sortable?heading(\'status\',\'Status\'):\'Status\'}</th>{sortable&&<><th>{heading(\'settlement_date\',\'Settlement date\')}</th><th>{kind===\'clients\'?heading(\'loan_count\',\'Loans\'):heading(\'lender\',\'Lender\')}</th></>}<th>Action</th>'),
      ("<td>{r.status?.replaceAll('_',' ')||'—'}</td><td><div className=\"workspaceRowActions\">", "<td>{r.status?.replaceAll('_',' ')||'—'}</td>{sortable&&<><td>{r.settlement_date?new Date(r.settlement_date+'T12:00:00').toLocaleDateString('en-AU'):'—'}</td><td>{kind==='clients'?(r.loan_count??0):(r.lender??'—')}</td></>}<td><div className=\"workspaceRowActions\">")
    ])


def company():
    edit('app/platform/companies/page.tsx',[
      ("import Link from 'next/link'", "import Link from 'next/link'\nimport {SortHeading, type SortDirection} from '@/components/SortHeading' // SORTING_UPGRADE_20261121"),
      (" const [page,setPage]=useState(1),[invitationPage,setInvitationPage]=useState(1)", " const [page,setPage]=useState(1),[invitationPage,setInvitationPage]=useState(1)\n const [sortBy,setSortBy]=useState('name'),[sortDirection,setSortDirection]=useState<SortDirection>('asc')\n const [directoryIds,setDirectoryIds]=useState<string[]>([]),[directoryTotal,setDirectoryTotal]=useState(0)\n const sortOptions=[['name','Company'],['status','Status'],['created_at','Created'],['clients','Clients'],['applications','Applications'],['settled','Settled loans'],['broker_count','Brokers'],['settlement_date','Latest settlement']]\n const changeSort=(field:string)=>{setSortDirection(d=>sortBy===field?(d==='asc'?'desc':'asc'):'asc');setSortBy(field);setPage(1)}\n const heading=(field:string,label:string)=><SortHeading field={field} label={label} active={sortBy} direction={sortDirection} onSort={changeSort}/>"),
      ("  const shownPerformance=period==='month'?monthly:performance", "  const shownPerformance=period==='month'?monthly:performance\n  useEffect(()=>{if(!ready)return;let active=true;void supabase.rpc('platform_sorted_directory',{p_kind:'companies',p_query:companySearch,p_page:page,p_sort:sortBy,p_direction:sortDirection}).then(({data,error})=>{if(!active)return;if(error){setError('Company sorting unavailable: '+error.message);return}setDirectoryIds(data.ids);setDirectoryTotal(data.total)});return()=>{active=false}},[ready,companySearch,page,sortBy,sortDirection,companies.length])"),
      ("  const searchText = companySearch.trim().toLocaleLowerCase()", "  const searchText = companySearch.trim().toLocaleLowerCase()"),
      ("  const visibleCompanies = companies.filter(company =>\n    !searchText || [company.name, company.head_broker_name, company.head_broker_email, referralNames[company.id]?.referrer, referralNames[company.id]?.manager]\n      .some(value => value?.toLocaleLowerCase().includes(searchText))\n  )", "  const visibleCompanies = directoryIds.map(id=>companies.find(c=>c.id===id)).filter((c):c is Company=>Boolean(c))"),
      ('<th>Company</th><th>Referral partner</th><th>Head Broker</th><th>Contact number</th><th>Status</th><th>{period===\'month\'?\'New clients\':\'Clients\'}</th><th>{period===\'month\'?\'New applications\':\'Applications\'}</th>', '<th>{heading(\'name\',\'Company\')}</th><th>Referral partner</th><th>Head Broker</th><th>Contact number</th><th>{heading(\'status\',\'Status\')}</th><th>{heading(\'clients\',period===\'month\'?\'New clients\':\'Clients\')}</th><th>{heading(\'applications\',period===\'month\'?\'New applications\':\'Applications\')}</th><th>{heading(\'settled\',\'Settled loans\')}</th><th>{heading(\'settlement_date\',\'Last settlement\')}</th>'),
      ("<tbody>{visibleCompanies.slice((Math.min(page,Math.max(1,Math.ceil(visibleCompanies.length/10)))-1)*10,Math.min(page,Math.max(1,Math.ceil(visibleCompanies.length/10)))*10).map(company =>", "<tbody>{visibleCompanies.map(company =>"),
      ("</small>}</td></tr>", "</small>}</td><td>{shownPerformance[company.id]?.application_statuses?.settled??0}</td></tr>"),
      ("{visibleCompanies.length} companies · Page {Math.min(page,Math.max(1,Math.ceil(visibleCompanies.length/10)))} of {Math.max(1,Math.ceil(visibleCompanies.length/10))}", "{directoryTotal} companies · Page {page} of {Math.max(1,Math.ceil(directoryTotal/20))}"),
      ("disabled={page>=Math.ceil(visibleCompanies.length/10)}", "disabled={page>=Math.ceil(directoryTotal/20)}"),
      ("<div className=\"tableWrap\"><table><thead><tr><th>{heading(\'name\',\'Company\')}", "<div className=\"workspaceToolbar\"><label>Sort by<select value={sortBy} onChange={e=>{setSortBy(e.target.value);setPage(1)}}>{sortOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><button type=\"button\" className=\"secondary small\" onClick={()=>{setSortDirection(d=>d==='asc'?'desc':'asc');setPage(1)}}>{sortDirection==='asc'?'Ascending ↑':'Descending ↓'}</button></label></div><div className=\"tableWrap\"><table><thead><tr><th>{heading('name','Company')}"),
    ])


def partners():
    edit('app/platform/partners/page.tsx',[
      ("import { usePathname } from 'next/navigation'", "import { usePathname } from 'next/navigation'\nimport {SortHeading, type SortDirection} from '@/components/SortHeading' // SORTING_UPGRADE_20261121"),
      (" const [showForm,setShowForm]=useState(false)", " const [sortBy,setSortBy]=useState('name'),[sortDirection,setSortDirection]=useState<SortDirection>('asc')\n const [directoryIds,setDirectoryIds]=useState<string[]>([]),[directoryTotal,setDirectoryTotal]=useState(0)\n const sortOptions=[['name','Partner'],['status','Status'],['companies','Companies'],['managed','Managed'],['agreement','Agreement'],['created_at','Created']]\n const changeSort=(field:string)=>{setSortDirection(d=>sortBy===field?(d==='asc'?'desc':'asc'):'asc');setSortBy(field);setPage(1)}\n const heading=(field:string,label:string)=><SortHeading field={field} label={label} active={sortBy} direction={sortDirection} onSort={changeSort}/>\n const [showForm,setShowForm]=useState(false)"),
      (" const filtered=data.partners.filter(p=>[p.display_name,p.contact_email,p.contact_mobile,p.partner_code].some(v=>v?.toLowerCase().includes(query.toLowerCase()))&&(statusFilter==='all'||p.status===statusFilter)&&(roleFilter==='all'||(roleFilter==='referrer'?p.is_referrer:p.is_account_manager))&&(agreementFilter==='all'||(agreementFilter==='accepted'?Boolean(p.agreement_accepted_at):!p.agreement_accepted_at))).sort((a,b)=>a.display_name.localeCompare(b.display_name))", " const filtered=directoryIds.map(id=>data.partners.find(p=>p.id===id)).filter((p):p is Partner=>Boolean(p))"),
      (" const pages=Math.max(1,Math.ceil(filtered.length/20)),currentPage=Math.min(page,pages)", " const pages=Math.max(1,Math.ceil(directoryTotal/20)),currentPage=Math.min(page,pages)\n useEffect(()=>{if(!ready)return;let active=true;void supabase.rpc('platform_sorted_directory',{p_kind:'partners',p_query:query,p_status:statusFilter,p_page:page,p_sort:sortBy,p_direction:sortDirection,p_role:roleFilter,p_agreement:agreementFilter}).then(({data:result,error})=>{if(!active)return;if(error){setError('Partner sorting unavailable: '+error.message);return}setDirectoryIds(result.ids);setDirectoryTotal(result.total)});return()=>{active=false}},[ready,query,statusFilter,page,sortBy,sortDirection,roleFilter,agreementFilter,refreshKey])"),
      ("<th>Partner</th><th>Role</th><th>Status</th><th>Companies</th><th>Agreement</th><th>Action</th>", "<th>{heading('name','Partner')}</th><th>Role</th><th>{heading('status','Status')}</th><th>{heading('companies','Companies')}</th><th>{heading('agreement','Agreement')}</th><th>Action</th>"),
      ("{filtered.slice((currentPage-1)*20,currentPage*20).map(p=>", "{filtered.map(p=>"),
      ("{filtered.length} partners · Page {currentPage} of {pages}", "{directoryTotal} partners · Page {currentPage} of {pages}"),
      ("<label>Agreement<select value={agreementFilter}", "<label>Sort by<select value={sortBy} onChange={e=>{setSortBy(e.target.value);setPage(1)}}>{sortOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select><button type=\"button\" className=\"secondary small\" onClick={()=>{setSortDirection(d=>d==='asc'?'desc':'asc');setPage(1)}}>{sortDirection==='asc'?'Ascending ↑':'Descending ↓'}</button></label><label>Agreement<select value={agreementFilter}"),
    ])

if __name__=='__main__':
    broker()
    company()
    partners()
    for path, contents in PENDING.items():
        Path(path).write_text(contents)
        print(f'Patched {path}')
    print('Review git diff and run npm run build before merging.')
