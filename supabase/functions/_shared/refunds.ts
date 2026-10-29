import {checked,stripe} from './billing.ts'
export async function reconcileRefund(db:any,chargeId:string,eventId:string){
 const charge=await stripe(`charges/${encodeURIComponent(chargeId)}`)
 if(charge.livemode!==false||charge.currency!=='aud'||!charge.payment_intent)return
 const pi=await stripe(`payment_intents/${encodeURIComponent(typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent.id)}`)
 if(pi.livemode!==false||pi.metadata?.brokerrelay_invoice_test!=='true')return
 let refunded=0,after='',complete=false
 for(let page=0;page<50;page++){
  const r=await stripe(`refunds?charge=${encodeURIComponent(charge.id)}&limit=100${after?'&starting_after='+encodeURIComponent(after):''}`)
  for(const x of r.data){if(x.status==='succeeded')refunded+=x.amount}
  if(!r.has_more){complete=true;break}after=r.data.at(-1)?.id;if(!after)break
 }
 if(!complete)throw new Error('REFUND_PAGINATION_REVIEW_REQUIRED')
 await checked(db.rpc('billing_reconcile_sandbox_refund',{p_event:eventId,p_invoice:pi.metadata.brokerrelay_invoice_id,p_intent:pi.id,p_charge:charge.id,p_customer:charge.customer,p_amount:charge.amount,p_refunded:refunded,p_currency:charge.currency,p_live:charge.livemode}))
}
