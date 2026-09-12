import { PocketDebtList } from "@/components/pocket/pocket-ledger";
export default function OverduePage(){return <section aria-labelledby="overdue-title"><p className="text-sm font-bold text-[#087F5B]">Simple Debt Ledger</p><h1 id="overdue-title" className="mt-2 text-3xl font-black text-[#092F2A]">Overdue</h1><PocketDebtList filter="overdue"/></section>}
