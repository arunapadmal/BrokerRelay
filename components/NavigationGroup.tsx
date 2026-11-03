'use client'
import Link from 'next/link'
import {useEffect,useState} from 'react'
import {usePathname} from 'next/navigation'
export type NavigationItem={href:string;label:string}
export function NavigationGroup({label,items,active:override}:{label:string;items:NavigationItem[];active?:boolean}){
 const path=usePathname(),active=override??items.some(i=>i.href===path||path.startsWith(i.href+'/'))
 const [open,setOpen]=useState(active)
 useEffect(()=>{if(active)setOpen(true)},[path,active])
 return <details className="navigationGroup" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{label}</summary><div>{items.map(i=><Link href={i.href} key={i.href} className={path===i.href?'navigationCurrent':undefined} aria-current={path===i.href?'page':undefined}>{i.label}</Link>)}</div></details>
}
