import { PocketDebtProfile } from "@/components/pocket/pocket-ledger";

export default async function PocketDebtPage({ params }: { params: Promise<{ debtId: string }> }) { const { debtId } = await params; return <PocketDebtProfile debtId={debtId}/> }
