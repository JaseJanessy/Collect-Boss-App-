import { PocketPaymentReceipt } from "@/components/pocket/pocket-payments";
export default async function PocketPaymentPage({params}:{params:Promise<{allocationId:string}>}){const{allocationId}=await params;return <PocketPaymentReceipt allocationId={allocationId}/>}
