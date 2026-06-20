export default function GlobalLoading() {
  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-center gap-4">
      <span className="text-2xl font-black text-[#0D1B3D]">
        Collect<span className="text-[#009966]">Boss</span>
      </span>
      <div className="w-6 h-6 border-2 border-[#009966] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
