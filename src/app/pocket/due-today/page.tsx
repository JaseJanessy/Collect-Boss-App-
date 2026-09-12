import { PocketDebtList } from "@/components/pocket/pocket-ledger";
export default function DueTodayPage(){return <section aria-labelledby="due-title"><p className="text-sm font-bold text-[#087F5B]">Simple Debt Ledger</p><h1 id="due-title" className="mt-2 text-3xl font-black text-[#092F2A]">Due Today</h1><PocketDebtList filter="due-today"/></section>}
