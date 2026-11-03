'use client'
import Link from 'next/link'
import {NavigationGroup} from '@/components/NavigationGroup'
export function BrokerNavigation({canManageStaff=false,isHeadBroker=false,isPlatformOwner=false,clientId,className='brokerDeskNav applicationNav'}:{canManageStaff?:boolean;isHeadBroker?:boolean;isPlatformOwner?:boolean;clientId?:string;className?:string}){
 return <nav className={className+' groupedNavigation'} aria-label="BrokerDesk navigation"><NavigationGroup label="BrokerDesk" items={[{href:'/dashboard',label:'Dashboard'},{href:'/clients',label:'Clients'},{href:'/applications',label:'Applications'},{href:'/messages',label:'Messages'},{href:'/documents',label:'Document requests'},{href:'/clients/team',label:'Client team'},{href:'/announcements',label:'Announcements'},{href:'/settings/follow-up-templates',label:'Follow-up settings'}]}/>
 {(canManageStaff||isHeadBroker)&&<NavigationGroup label="Company & staff" items={[...(canManageStaff?[{href:'/admin/company',label:'Company details'},{href:'/admin/staff',label:'Staff & roles'},{href:'/admin/invitations',label:'Staff invitations'}]:[]),...(isHeadBroker?[{href:'/settings/mobile-appearance',label:'Mobile appearance'},{href:'/admin/document-delivery',label:'Delivery settings'},{href:'/billing',label:'Billing & invoices'},{href:'/admin/handover',label:'Head Broker handover'}]:[])]}/>}
 {clientId&&<NavigationGroup label="Selected client" items={[{href:`/applications/${clientId}`,label:'Active applications'},{href:`/applications/archive/${clientId}`,label:'Archive / past'},{href:`/applications/replacement/${clientId}`,label:'Replacement application'}]}/>}
 {isPlatformOwner&&<Link href="/platform/dashboard">Platform administration</Link>}<Link className="brokerDeskHelpLink" href="/help">Help & support</Link></nav>
}
