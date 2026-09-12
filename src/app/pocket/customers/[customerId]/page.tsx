import { PocketCustomerProfile } from "@/components/pocket/pocket-ledger";

export default async function PocketCustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  return <PocketCustomerProfile customerId={customerId} />;
}
