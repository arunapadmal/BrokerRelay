'use client'
import { companyLogoUrl,logoSize } from '@/lib/company-logo'
type Props={companyId:string;companyName:string;logoUrl:string|null;logoWidth:number;logoHeight:number;onUpdated:(url:string)=>void;onDimensionsUpdated:(width:number,height:number)=>void}
export function CompanyLogoEditor({companyName,logoUrl,logoWidth,logoHeight}:Props){
 const size=logoSize(logoWidth,logoHeight),url=companyLogoUrl(logoUrl)
 return <div className="platformLogoEditor"><div className="platformLogoPreview" style={{width:size.width,height:size.height,maxWidth:'100%',overflow:'hidden'}}>{url?<img src={url} alt={`${companyName} logo`} style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<span aria-hidden="true">{companyName.charAt(0).toUpperCase()}</span>}</div><div><strong>Company logo</strong><p className="muted smallText">Managed by the company’s Head Broker in Mobile app appearance.</p><p className="muted smallText">Display: {size.width} × {size.height} px · maximum 240 × 120 px</p></div></div>
}
