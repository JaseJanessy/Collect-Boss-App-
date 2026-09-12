import { describe,expect,it } from "vitest";
import { paymentMethodLabel,pocketPaymentError,pocketPaymentInputSchema } from "@/lib/pocket/payments";

describe("Pocket payment inputs",()=>{
  const valid={debtId:"11111111-1111-4111-8111-111111111111",amount:"10.50",expectedOutstandingMinor:5000,paymentDate:"2026-08-21",method:"bank_transfer" as const,reference:"BANK-1",note:null};
  it("accepts decimal-string money and a server snapshot without accepting currency or ownership",()=>{
    expect(pocketPaymentInputSchema.safeParse(valid).success).toBe(true);
    expect(pocketPaymentInputSchema.safeParse({...valid,currency:"MYR"}).success).toBe(false);
    expect(pocketPaymentInputSchema.safeParse({...valid,businessId:"tenant-b"}).success).toBe(false);
    expect(pocketPaymentInputSchema.safeParse({...valid,remainingMinor:0}).success).toBe(false);
  });
  it("rejects floating point and unknown payment-method payloads",()=>{
    expect(pocketPaymentInputSchema.safeParse({...valid,amount:10.5}).success).toBe(false);
    expect(pocketPaymentInputSchema.safeParse({...valid,method:"crypto"}).success).toBe(false);
  });
  it("exposes stable safe conflicts",()=>{
    expect(pocketPaymentError("POCKET_PAYMENT_STALE_BALANCE")).toMatchObject({status:409,code:"STALE_BALANCE"});
    expect(pocketPaymentError("POCKET_PAYMENT_AMOUNT_TOO_HIGH")).toMatchObject({status:409,code:"AMOUNT_TOO_HIGH"});
    expect(pocketPaymentError("internal table detail")).toMatchObject({status:500,code:"PAYMENT_OPERATION_FAILED"});
  });
  it("formats the short chooser labels",()=>expect(paymentMethodLabel("bank_transfer")).toBe("Bank Transfer"));
});
