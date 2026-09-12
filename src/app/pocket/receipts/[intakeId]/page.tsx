import { PocketReceiptReview } from "@/components/pocket/pocket-receipts";

export default async function PocketReceiptReviewPage({ params }: { params: Promise<{ intakeId: string }> }) {
  const { intakeId } = await params;
  return <section aria-labelledby="receipt-review-title"><p className="text-sm font-bold text-[#087F5B]">Receipt candidate</p><h1 id="receipt-review-title" className="mt-2 text-3xl font-black text-[#092F2A]">Review Receipt</h1><PocketReceiptReview intakeId={intakeId}/></section>;
}
