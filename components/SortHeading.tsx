'use client'
import type { ReactNode } from 'react'

export type SortDirection = 'asc' | 'desc'
export function SortHeading({field,label,active,direction,onSort}:{
  field:string;label:ReactNode;active:string;direction:SortDirection;onSort:(field:string)=>void
}) {
 return <button type="button" onClick={()=>onSort(field)} aria-label={`Sort by ${String(label)} ${active===field&&direction==='asc'?'descending':'ascending'}`}
  aria-pressed={active===field} style={{border:0,background:'transparent',color:'inherit',font:'inherit',fontWeight:'inherit',cursor:'pointer',display:'inline-flex',gap:6,alignItems:'center'}}>
  {label}<span aria-hidden="true">{active===field?(direction==='asc'?'▲':'▼'):'↕'}</span>
 </button>
}
