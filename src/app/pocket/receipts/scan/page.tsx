import { PocketReceiptCapture } from "@/components/pocket/pocket-receipts";
import { PocketPageHeader } from "@/components/pocket/pocket-ui";

export default function PocketReceiptScanPage() {
  return <section aria-labelledby="scan-receipt-title"><PocketPageHeader id="scan-receipt-title" eyebrow="Receipt" title="Scan Receipt" description="Capture, review, then confirm. Read details never change a balance by themselves."/><PocketReceiptCapture/></section>;
}
