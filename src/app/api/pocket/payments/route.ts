import { NextRequest,NextResponse } from "next/server";
import { authorizePocketCapability,requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import { paymentOperationRequestHash } from "@/lib/payment-operations/validation";
import { pocketPaymentError,pocketPaymentInputSchema } from "@/lib/pocket/payments";

const headers={"Cache-Control":"private, no-store, max-age=0",Vary:"Cookie, Authorization"};
export const dynamic="force-dynamic";

export async function GET(request:NextRequest){
  const access=await requirePocketBillingAccess("case.read");if("code" in access)return NextResponse.json({error:access.error,code:access.code},{status:access.status,headers});
  const limit=Math.min(100,Math.max(1,Number(request.nextUrl.searchParams.get("limit"))||50));
  const {data:allocations,error}=await access.service.from("payment_allocations").select("id,receipt_id,event_type,reverses_allocation_id,obligation_id,target_amount_minor,target_currency,reason,created_at,created_by")
    .eq("business_id",access.businessId).is("case_id",null).not("obligation_id","is",null).order("created_at",{ascending:false}).limit(limit*2);
  if(error)return NextResponse.json({error:"Payment activity is temporarily unavailable."},{status:503,headers});
  const events=allocations??[];const originals=events.filter((item)=>item.event_type==="allocation").slice(0,limit);const reversedBy=new Map(events.filter((item)=>item.event_type==="reversal"&&item.reverses_allocation_id).map((item)=>[item.reverses_allocation_id as string,item]));
  const receiptIds=[...new Set(originals.map((item)=>item.receipt_id))];const debtIds=[...new Set(originals.flatMap((item)=>item.obligation_id?[item.obligation_id]:[]))];
  const [receipts,debts]=await Promise.all([receiptIds.length?access.service.from("payment_receipts").select("id,received_at,reference,metadata").eq("business_id",access.businessId).in("id",receiptIds):Promise.resolve({data:[],error:null}),debtIds.length?access.service.from("obligations").select("id,customer_id,pocket_description").eq("business_id",access.businessId).in("id",debtIds):Promise.resolve({data:[],error:null})]);
  const customerIds=[...new Set((debts.data??[]).map((item)=>item.customer_id))];const customers=customerIds.length?await access.service.from("debtors").select("id,individual_name,business_name").eq("business_id",access.businessId).in("id",customerIds):{data:[],error:null};
  const receiptMap=new Map((receipts.data??[]).map((item)=>[item.id,item]));const debtMap=new Map((debts.data??[]).map((item)=>[item.id,item]));const customerMap=new Map((customers.data??[]).map((item)=>[item.id,item.individual_name??item.business_name??"Customer"]));
  return NextResponse.json({payments:originals.map((item)=>{const receipt=receiptMap.get(item.receipt_id);const debt=item.obligation_id?debtMap.get(item.obligation_id):null;const metadata=receipt?.metadata&&typeof receipt.metadata==="object"&&!Array.isArray(receipt.metadata)?receipt.metadata as Record<string,unknown>:{};const reversal=reversedBy.get(item.id);return {allocationId:item.id,receiptId:item.receipt_id,debtId:item.obligation_id,customerId:debt?.customer_id??null,customerName:debt?customerMap.get(debt.customer_id)??"Customer":"Customer",description:debt?.pocket_description??"Debt payment",amountMinor:item.target_amount_minor,currency:item.target_currency,paymentDate:metadata.payment_date??receipt?.received_at?.slice(0,10),method:metadata.method??"other",reference:receipt?.reference??null,note:metadata.note??null,status:reversal?"reversed":"confirmed",reversedAt:reversal?.created_at??null,reversalReason:reversal?.reason??null,createdAt:item.created_at};})},{headers});
}

export async function POST(request:NextRequest){
  const access=await requirePocketBillingAccess("payment.approve");if("code" in access)return NextResponse.json({error:access.error,code:access.code},{status:access.status,headers});
  const key=request.headers.get("idempotency-key")?.trim();if(!key||key.length>120)return NextResponse.json({error:"A valid retry key is required.",code:"IDEMPOTENCY_KEY_REQUIRED"},{status:400,headers});
  const parsed=pocketPaymentInputSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Check the payment details and try again.",issues:parsed.error.flatten().fieldErrors},{status:400,headers});
  const authorization=await authorizePocketCapability({access,capability:"pocket.payment.record",operationKey:key});if("error" in authorization)return NextResponse.json({error:authorization.error,code:authorization.code},{status:authorization.status,headers});
  const {data:debt}=await access.service.from("obligations").select("currency").eq("id",parsed.data.debtId).eq("business_id",access.businessId).eq("origin_product_type","pocket").maybeSingle();if(!debt)return NextResponse.json({error:"The selected debt is unavailable.",code:"DEBT_NOT_FOUND"},{status:404,headers});
  let amountMinor:bigint;try{amountMinor=parseCurrencyToMinor(parsed.data.amount,debt.currency);}catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:"Enter a valid amount."},{status:400,headers});}if(amountMinor>BigInt(Number.MAX_SAFE_INTEGER))return NextResponse.json({error:"Amount is too large."},{status:400,headers});
  const hash=paymentOperationRequestHash({...parsed.data,amountMinor:Number(amountMinor)});const {data,error}=await access.service.rpc("pocket_post_payment",{p_business_id:access.businessId,p_actor_id:access.user.id,p_debt_id:parsed.data.debtId,p_amount_minor:Number(amountMinor),p_expected_outstanding_minor:parsed.data.expectedOutstandingMinor,p_payment_date:parsed.data.paymentDate,p_method:parsed.data.method,p_reference:parsed.data.reference||null,p_note:parsed.data.note||null,p_idempotency_key:key,p_request_hash:hash});
  if(error){const mapped=pocketPaymentError(error.message);return NextResponse.json({error:mapped.message,code:mapped.code},{status:mapped.status,headers});}
  return NextResponse.json({payment:data},{status:201,headers});
}
