"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import { PrimaryButton } from "@/components/ui/primary-button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { evidenceTypes, type EvidenceType } from "@/lib/mock-legal-data";
import { type EvidenceFileRow, type EvidenceType as DbEvidenceType } from "@/lib/supabase/types";
import {
  uploadEvidenceFileClient,
  validateEvidenceFile,
  formatFileSize,
  getFileTypeLabel,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  archiveEvidenceFileClient,
  getEvidenceAccessUrl,
} from "@/lib/db/evidence-client";
import { track, fileSizeBucket } from "@/lib/analytics/tracker";
import { useEvidence } from "@/hooks/use-evidence";
import {
  ChevronLeft,
  Upload,
  CheckCircle2,
  X,
  FileText,
  Info,
  ArrowRight,
  Trash2,
  AlertCircle,
  File,
  Image,
  Loader2,
  Eye,
  Download,
} from "lucide-react";

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  caseId: string;
}

// ─── Completeness helpers ──────────────────────────────────────────────────────

function computeCompleteness(files: EvidenceFileRow[]): {
  pct:      number;
  mustDone: number;
  mustTotal: number;
  goodDone: number;
  goodTotal: number;
} {
  const uploadedTypes = new Set(files.map((f) => f.evidence_type));
  const mustHave   = evidenceTypes.filter((e) => e.category === "must_have");
  const goodToHave = evidenceTypes.filter((e) => e.category === "good_to_have");

  const mustDone = mustHave.filter((e) => uploadedTypes.has(e.id as DbEvidenceType)).length;
  const goodDone = goodToHave.filter((e) => uploadedTypes.has(e.id as DbEvidenceType)).length;
  const totalDone = mustDone + goodDone;
  const total = evidenceTypes.length;

  return {
    pct:      total > 0 ? Math.round((totalDone / total) * 100) : 0,
    mustDone,
    mustTotal: mustHave.length,
    goodDone,
    goodTotal: goodToHave.length,
  };
}

// ─── Main component ────────────────────────────────────────────────────────────

export function EvidenceUploadPage({ caseId }: Props) {
  const { files, loading, error, addFile, removeFile } = useEvidence(caseId);

  const completeness = computeCompleteness(files);
  const scoreColor =
    completeness.pct >= 75 ? "text-emerald-600" :
    completeness.pct >= 40 ? "text-amber-500" : "text-red-500";
  const barColor =
    completeness.pct >= 75 ? "bg-emerald-500" :
    completeness.pct >= 40 ? "bg-amber-500" : "bg-red-400";

  // Per-type uploaded files map
  const filesByType = files.reduce<Record<string, EvidenceFileRow[]>>((acc, f) => {
    if (!acc[f.evidence_type]) acc[f.evidence_type] = [];
    acc[f.evidence_type].push(f);
    return acc;
  }, {});

  const uploadedTypes = new Set(files.map((f) => f.evidence_type));

  return (
    <div className="flex flex-col pb-6 md:max-w-5xl md:mx-auto md:w-full">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="flex items-center gap-2 mb-1">
          <Link href={`/cases/${caseId}`} className="text-gray-400 hover:text-gray-600">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-[#0D1B3D]">Evidence</h1>
        </div>
        <p className="text-xs text-gray-400 ml-7">
          Upload documents to strengthen your case.
        </p>
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <div className="mx-4 mt-5 flex items-start gap-3 bg-red-50 border border-red-100 rounded-xl p-4">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      ) : (
        <div className="px-4 pt-5 flex flex-col gap-5">
          {/* Completeness score */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-semibold text-gray-500">Evidence Score</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {completeness.mustDone}/{completeness.mustTotal} must-have ·{" "}
                  {completeness.mustDone + completeness.goodDone}/{evidenceTypes.length} total
                </p>
              </div>
              <p className={cn("text-3xl font-black", scoreColor)}>{completeness.pct}%</p>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className={cn("h-3 rounded-full transition-all duration-500", barColor)}
                style={{ width: `${completeness.pct}%` }}
              />
            </div>
            {completeness.pct < 60 && (
              <p className="text-[11px] text-amber-600 mt-2 font-medium">
                ⚠️ Upload at least the 3 must-have documents to strengthen your case.
              </p>
            )}
            {completeness.pct >= 75 && (
              <p className="text-[11px] text-emerald-600 mt-2 font-medium">
                ✓ Good evidence coverage. You&apos;re well positioned for recovery action.
              </p>
            )}
          </div>

          {/* File format info */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex gap-2">
            <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-700 leading-relaxed">
              Accepted formats: <strong>PDF, PNG, JPG, JPEG</strong> · Maximum file size: <strong>10 MB</strong>
            </p>
          </div>

          {/* Must Have */}
          <SectionCard title="Must Have">
            <p className="text-[11px] text-gray-400 mt-1 mb-3">
              These documents are essential for any debt recovery action.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {evidenceTypes.filter((e) => e.category === "must_have").map((type) => (
                <EvidenceTypeRow
                  key={type.id}
                  type={type}
                  uploadedFiles={filesByType[type.id] ?? []}
                  caseId={caseId}
                  onFileAdded={addFile}
                  onFileRemoved={removeFile}
                />
              ))}
            </div>
          </SectionCard>

          {/* Good to Have */}
          <SectionCard title="Helpful Extras">
            <p className="text-[11px] text-gray-400 mt-1 mb-3">
              These strengthen your case if you have them available.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              {evidenceTypes.filter((e) => e.category === "good_to_have").map((type) => (
                <EvidenceTypeRow
                  key={type.id}
                  type={type}
                  uploadedFiles={filesByType[type.id] ?? []}
                  caseId={caseId}
                  onFileAdded={addFile}
                  onFileRemoved={removeFile}
                />
              ))}
            </div>
          </SectionCard>

          {/* Uploaded summary */}
          {files.length > 0 && (
            <SectionCard title="All Uploaded Documents">
              <div className="grid gap-x-5 md:grid-cols-2 mt-1">
                {files.map((f, i) => (
                  <UploadedFileRow
                    key={f.id}
                    file={f}
                    isLast={i === files.length - 1}
                    caseId={caseId}
                    onRemoved={removeFile}
                  />
                ))}
              </div>
            </SectionCard>
          )}

          {/* Legal disclaimer */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex gap-2">
            <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-gray-500 leading-relaxed">
              <strong>CollectBoss does not provide legal advice.</strong> Documents
              you upload are for your own record-keeping. Consult a qualified lawyer
              before taking legal action.
            </p>
          </div>

          <Link href={`/evidence/${caseId}/checklist`}>
            <PrimaryButton fullWidth size="lg" icon={<ArrowRight className="w-4 h-4" />}>
              View Evidence Checklist
            </PrimaryButton>
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Evidence type row ────────────────────────────────────────────────────────

function EvidenceTypeRow({
  type,
  uploadedFiles,
  caseId,
  onFileAdded,
  onFileRemoved,
}: {
  type:         EvidenceType;
  uploadedFiles: EvidenceFileRow[];
  caseId:       string;
  onFileAdded:  (f: EvidenceFileRow) => void;
  onFileRemoved: (id: string) => void;
}) {
  const inputRef   = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [showTip,   setShowTip]   = useState(false);
  const [description, setDescription] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [isInternal, setIsInternal] = useState(true);

  const hasFiles = uploadedFiles.length > 0;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset input

    const validErr = validateEvidenceFile(file);
    if (validErr) { setUploadErr(validErr); return; }

    setUploadErr(null);
    setUploading(true);
    setProgress(0);

    const result = await uploadEvidenceFileClient(
      file,
      caseId,
      type.id as DbEvidenceType,
      setProgress,
      { description, documentDate, isInternal }
    );

    if (result.error) {
      setUploadErr(result.error);
    } else if (result.data) {
      onFileAdded(result.data);
      track("evidence_uploaded", {
        evidence_type:    type.id,
        file_size_bucket: fileSizeBucket(file.size),
      });
    }
    setUploading(false);
    setProgress(0);
  }

  return (
    <div
      className={cn(
        "rounded-xl border-2 transition-all",
        hasFiles ? "border-emerald-200 bg-emerald-50" : "border-gray-100 bg-white"
      )}
    >
      <div className="flex items-start gap-3 p-3">
        <span className="text-xl shrink-0 mt-0.5">{type.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{type.name}</p>
          <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{type.description}</p>

          {/* Uploaded file names */}
          {uploadedFiles.length > 0 && (
            <div className="flex flex-col gap-0.5 mt-1.5">
              {uploadedFiles.map((f) => (
                <p key={f.id} className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span className="truncate">{f.file_name}</span>
                </p>
              ))}
            </div>
          )}

          {/* Upload progress */}
          {uploading && (
            <div className="mt-2">
              <div className="flex items-center gap-2 mb-1">
                <Loader2 className="w-3 h-3 text-[#009966] animate-spin shrink-0" />
                <p className="text-[11px] text-[#009966] font-semibold">Uploading… {progress}%</p>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div
                  className="bg-[#009966] h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {uploadErr && (
            <div className="flex items-start gap-1.5 mt-1.5">
              <AlertCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-600 leading-snug">{uploadErr}</p>
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] font-semibold text-gray-500">Add evidence metadata</summary>
            <div className="mt-2 grid gap-2">
              <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="Private description" className="rounded border border-gray-200 px-2 py-1 text-xs" />
              <input value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} type="date" className="rounded border border-gray-200 px-2 py-1 text-xs" />
              <label className="flex items-center gap-2 text-[10px] text-gray-600"><input checked={isInternal} onChange={(event) => setIsInternal(event.target.checked)} type="checkbox" /> Internal/private evidence</label>
            </div>
          </details>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowTip((v) => !v)}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-gray-300 hover:text-gray-500 transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1 text-xs font-bold text-[#009966] bg-white border border-emerald-200 px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {hasFiles ? "Add" : "Upload"}
          </button>

          {/* Hidden file input */}
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Tip */}
      {showTip && (
        <div className="px-3 pb-3 flex gap-2">
          <div className="w-px bg-emerald-200 shrink-0 ml-6" />
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex-1">
            <p className="text-[11px] font-bold text-blue-800 mb-0.5">💡 Tip</p>
            <p className="text-[11px] text-blue-700 leading-relaxed">{type.tip}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Uploaded file row (in summary list) ─────────────────────────────────────

function UploadedFileRow({
  file,
  isLast,
  caseId,
  onRemoved,
}: {
  file:       EvidenceFileRow;
  isLast:     boolean;
  caseId:     string;
  onRemoved:  (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const typeDef = evidenceTypes.find((e) => e.id === file.evidence_type);
  const uploadedDate = new Date(file.uploaded_at).toLocaleDateString("en-MY", {
    day: "numeric", month: "short", year: "numeric",
  });

  async function handleDelete() {
    if (!window.confirm(`Archive ${file.file_name}? It will be removed from active Evidence views, while the audit history remains.`)) return;
    setDeleting(true);
    setError(null);
    const result = await archiveEvidenceFileClient(caseId, file.id);
    if (result.error) {
      setError(result.error);
      setDeleting(false);
    } else {
      onRemoved(file.id);
    }
  }

  async function handleAccess(mode: "preview" | "download") {
    const result = await getEvidenceAccessUrl(caseId, file.id, mode);
    if (result.error) setError(result.error);
    else if (result.data) window.open(result.data, "_blank", "noopener,noreferrer");
  }

  return (
    <div className={cn("flex items-center gap-3 py-3", !isLast && "border-b border-gray-50")}>
      {/* File type icon */}
      <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center shrink-0">
        {file.file_type === "PDF" ? (
          <FileText className="w-4 h-4 text-emerald-600" />
        ) : (
          <Image className="w-4 h-4 text-emerald-600" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs font-semibold text-gray-800 truncate max-w-[160px]">
            {file.file_name}
          </p>
          <FileTypeBadge type={file.file_type} />
        </div>
        <p className="text-[10px] text-gray-400 mt-0.5">
          {typeDef?.name ?? file.evidence_type} · {formatFileSize(file.file_size_bytes)} · {uploadedDate}
        </p>
        {error && (
          <p className="text-[11px] text-red-500 mt-0.5">{error}</p>
        )}
      </div>

      <button onClick={() => void handleAccess("preview")} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-emerald-50 text-gray-300 hover:text-emerald-600 transition-colors shrink-0" title="Preview">
        <Eye className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => void handleAccess("download")} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-emerald-50 text-gray-300 hover:text-emerald-600 transition-colors shrink-0" title="Download">
        <Download className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={handleDelete}
        aria-label={`Archive evidence ${file.file_name}`}
        disabled={deleting}
        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors shrink-0 disabled:opacity-50"
      >
        {deleting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
}

// ─── File type badge ──────────────────────────────────────────────────────────

function FileTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    PDF:  "bg-red-100 text-red-700 border-red-200",
    PNG:  "bg-blue-100 text-blue-700 border-blue-200",
    JPG:  "bg-amber-100 text-amber-700 border-amber-200",
    JPEG: "bg-amber-100 text-amber-700 border-amber-200",
  };
  return (
    <span className={cn(
      "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase",
      colors[type] ?? "bg-gray-100 text-gray-600 border-gray-200"
    )}>
      {type}
    </span>
  );
}
