import { NextRequest, NextResponse } from "next/server";
import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import { pocketPaymentPreviewSchema } from "@/lib/pocket/payments";

const headers={"Cache-Control":"private, no-store, max-age=0"};
export async function POST(request:NextRequest){
  const access=await requirePocketBillingAccess("case.read");if("code" in access)return NextResponse.json({error:access.error,code:access.code},{status:access.status,headers});
  const parsed=pocketPaymentPreviewSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Check the payment amount."},{status:400,headers});
  const {data:debt,error}=await access.service.from("obligations").select("id,customer_id,currency,original_amount_minor,paid_minor,outstanding_minor,status,archived_at,pocket_description")
    .eq("id",parsed.data.debtId).eq("business_id",access.businessId).eq("origin_product_type","pocket").maybeSingle();
  if(error)return NextResponse.json({error:"The latest balance is temporarily unavailable."},{status:503,headers});
  if(!debt||debt.archived_at||["draft","paid","void","written_off"].includes(debt.status))return NextResponse.json({error:"This debt cannot accept a payment.",code:"DEBT_NOT_PAYABLE"},{status:409,headers});
  let amountMinor:bigint;try{amountMinor=parseCurrencyToMinor(parsed.data.amount,debt.currency);}catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:"Enter a valid amount."},{status:400,headers});}
  if(amountMinor>BigInt(debt.outstanding_minor))return NextResponse.json({error:"The payment is higher than the current remaining balance.",code:"AMOUNT_TOO_HIGH"},{status:409,headers});
  const {data:customer}=await access.service.from("debtors").select("individual_name,business_name").eq("id",debt.customer_id).eq("business_id",access.businessId).maybeSingle();
  return NextResponse.json({debtId:debt.id,customerId:debt.customer_id,customerName:customer?.individual_name??customer?.business_name??"Customer",description:debt.pocket_description,currency:debt.currency,originalAmountMinor:debt.original_amount_minor,paidMinor:debt.paid_minor,currentRemainingMinor:debt.outstanding_minor,paymentAmountMinor:Number(amountMinor),resultingRemainingMinor:debt.outstanding_minor-Number(amountMinor),willSettle:Number(amountMinor)===debt.outstanding_minor},{headers});
}
