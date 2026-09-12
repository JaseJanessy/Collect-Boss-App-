import Link from "next/link";
import { PocketReceiptList } from "@/components/pocket/pocket-receipts";

export default function PocketReceiptsPage(){return <section aria-labelledby="pocket-receipts-title"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-bold text-[#087F5B]">Private evidence</p><h1 id="pocket-receipts-title" className="mt-2 text-3xl font-black text-[#092F2A]">Receipts</h1><p className="mt-2 text-sm leading-6 text-slate-500">Review processing drafts and open payments created from confirmed receipts.</p></div><Link href="/pocket/receipts/scan" className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#087F5B] px-5 text-sm font-black text-white">Scan Receipt</Link></div><PocketReceiptList/></section>}
