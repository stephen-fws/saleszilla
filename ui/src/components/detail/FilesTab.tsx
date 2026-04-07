import { useState, useEffect, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  Paperclip, Upload, Trash2, Loader2, Download,
  FileText, FileImage, FileVideo, FileAudio, File,
  Eye, X, AlertCircle,
} from "lucide-react";
import type { FileItem } from "@/lib/api";
import { getFiles, uploadFile, deleteFile, getFileTextContent, getFileBinaryContent } from "@/lib/api";

interface FilesTabProps {
  dealId: string;
}

// ── Preview type detection ────────────────────────────────────────────────────

type PreviewType = "image" | "pdf" | "video" | "audio" | "excel" | "office" | "text" | "none";

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);
const EXCEL_EXTS = new Set(["xls", "xlsx", "xlsm", "xlsb", "ods", "csv"]);
const OFFICE_EXTS = new Set(["doc", "docx", "ppt", "pptx"]);
const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "xml", "yaml", "yml",
  "js", "ts", "jsx", "tsx", "py", "java", "cs", "cpp", "c", "h",
  "html", "css", "scss", "sass", "sh", "bash", "zsh", "sql",
  "go", "rb", "php", "rs", "swift", "kt", "r", "log", "ini", "toml", "env",
]);

function getPreviewType(mimeType: string | null, fileName: string): PreviewType {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();

  if (mimeType) {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.includes("pdf")) return "pdf";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.includes("sheet") || mimeType.includes("excel") || mimeType === "text/csv") return "excel";
    if (mimeType.includes("word") || mimeType.includes("document") ||
        mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "office";
    if (mimeType.startsWith("text/") || mimeType.includes("json") ||
        mimeType.includes("xml") || mimeType.includes("javascript") ||
        mimeType.includes("typescript") || mimeType.includes("yaml")) return "text";
  }

  if (IMAGE_EXTS.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (EXCEL_EXTS.has(ext)) return "excel";
  if (OFFICE_EXTS.has(ext)) return "office";
  if (TEXT_EXTS.has(ext)) return "text";
  return "none";
}

function canPreview(mimeType: string | null, fileName: string): boolean {
  return getPreviewType(mimeType, fileName) !== "none";
}

// ── File icon ─────────────────────────────────────────────────────────────────

function FileIcon({ mimeType, fileName, size = "md" }: { mimeType: string | null; fileName: string; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-5 w-5";
  const type = getPreviewType(mimeType, fileName);
  const cls = `${sizeClass} flex-shrink-0`;
  if (type === "image") return <FileImage className={`${cls} text-violet-500`} />;
  if (type === "video") return <FileVideo className={`${cls} text-rose-500`} />;
  if (type === "audio") return <FileAudio className={`${cls} text-amber-500`} />;
  if (mimeType?.includes("pdf")) return <FileText className={`${cls} text-red-500`} />;
  if (mimeType?.includes("word") || mimeType?.includes("document")) return <FileText className={`${cls} text-blue-500`} />;
  if (type === "excel") return <FileText className={`${cls} text-emerald-500`} />;
  if (mimeType?.includes("presentation") || mimeType?.includes("powerpoint")) return <FileText className={`${cls} text-orange-500`} />;
  if (type === "text") return <FileText className={`${cls} text-slate-500`} />;
  return <File className={`${cls} text-slate-400`} />;
}

function formatSize(bytes: number | null) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string | null) {
  if (!dateStr) return "";
  const utc = dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : dateStr + "Z";
  const diff = Date.now() - new Date(utc).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Preview modal ─────────────────────────────────────────────────────────────

interface PreviewModalProps {
  file: FileItem;
  dealId: string;
  onClose: () => void;
}

function PreviewModal({ file, dealId, onClose }: PreviewModalProps) {
  const type = getPreviewType(file.mimeType, file.fileName);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState(false);

  // Excel state
  interface SheetData { name: string; html: string }
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelError, setExcelError] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Fetch text content
  useEffect(() => {
    if (type !== "text") return;
    setTextLoading(true);
    getFileTextContent(dealId, file.id)
      .then(setTextContent)
      .catch(() => setTextError(true))
      .finally(() => setTextLoading(false));
  }, [type, dealId, file.id]);

  // Fetch PDF as blob so it renders inline (signed URLs have attachment disposition)
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(false);

  useEffect(() => {
    if (type !== "pdf") return;
    setPdfLoading(true);
    setPdfError(false);
    getFileBinaryContent(dealId, file.id)
      .then((buffer) => {
        const blob = new Blob([buffer], { type: "application/pdf" });
        setPdfBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => setPdfError(true))
      .finally(() => setPdfLoading(false));
    return () => {
      setPdfBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [type, dealId, file.id]);

  // Parse Excel via SheetJS
  useEffect(() => {
    if (type !== "excel") return;
    setExcelLoading(true);
    setExcelError(false);
    setActiveSheet(0);
    getFileBinaryContent(dealId, file.id)
      .then((buffer) => {
        const wb = XLSX.read(buffer, { type: "array" });
        const parsed: SheetData[] = wb.SheetNames.map((name) => ({
          name,
          html: XLSX.utils.sheet_to_html(wb.Sheets[name], { header: "", footer: "" }),
        }));
        setSheets(parsed);
      })
      .catch(() => setExcelError(true))
      .finally(() => setExcelLoading(false));
  }, [type, dealId, file.id]);

  const handleDownload = () => {
    if (!file.downloadUrl) return;
    const a = document.createElement("a");
    a.href = file.downloadUrl;
    a.download = file.fileName;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Office Online viewer URL (Word/PPT only — Excel uses SheetJS)
  const officeViewerUrl = file.downloadUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.downloadUrl)}`
    : null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-900 border-b border-slate-700 flex-shrink-0">
        <FileIcon mimeType={file.mimeType} fileName={file.fileName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{file.fileName}</p>
          <p className="text-[10px] text-slate-400">{formatSize(file.fileSize)}</p>
        </div>
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-700 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {type === "image" && file.downloadUrl && (
          <img
            src={file.downloadUrl}
            alt={file.fileName}
            className="max-w-full max-h-full object-contain rounded shadow-2xl"
          />
        )}

        {type === "pdf" && (
          pdfLoading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading PDF...</span>
            </div>
          ) : pdfError ? (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm">Failed to load PDF</p>
              <button onClick={handleDownload} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors">
                <Download className="h-4 w-4" /> Download instead
              </button>
            </div>
          ) : pdfBlobUrl ? (
            <embed
              src={pdfBlobUrl}
              type="application/pdf"
              className="w-full rounded shadow-xl"
              style={{ height: "80vh" }}
            />
          ) : null
        )}

        {type === "video" && file.downloadUrl && (
          <video
            src={file.downloadUrl}
            controls
            autoPlay={false}
            className="max-w-full max-h-full rounded shadow-2xl"
            style={{ maxHeight: "80vh" }}
          >
            Your browser does not support the video tag.
          </video>
        )}

        {type === "audio" && file.downloadUrl && (
          <div className="bg-slate-800 rounded-2xl p-8 flex flex-col items-center gap-6 shadow-2xl">
            <FileAudio className="h-16 w-16 text-amber-400" />
            <p className="text-white font-medium text-center">{file.fileName}</p>
            <audio src={file.downloadUrl} controls className="w-full max-w-md">
              Your browser does not support the audio tag.
            </audio>
          </div>
        )}

        {/* Excel — rendered client-side via SheetJS */}
        {type === "excel" && (
          excelLoading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Parsing spreadsheet...</span>
            </div>
          ) : excelError ? (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm">Failed to parse spreadsheet</p>
              <button onClick={handleDownload} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors">
                <Download className="h-4 w-4" /> Download instead
              </button>
            </div>
          ) : sheets.length > 0 ? (
            <div className="w-full h-full flex flex-col bg-white rounded-lg shadow-xl overflow-hidden" style={{ minHeight: "80vh" }}>
              {/* Sheet tabs */}
              {sheets.length > 1 && (
                <div className="flex items-center gap-0.5 px-3 pt-2 border-b border-slate-200 bg-slate-50 flex-shrink-0 overflow-x-auto">
                  {sheets.map((s, i) => (
                    <button
                      key={s.name}
                      onClick={() => setActiveSheet(i)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-t whitespace-nowrap transition-colors ${
                        i === activeSheet
                          ? "bg-white border border-b-white border-slate-200 text-emerald-700"
                          : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              {/* Sheet content */}
              <div className="flex-1 overflow-auto p-2">
                <style>{`
                  .xlsx-table table { border-collapse: collapse; font-size: 12px; font-family: sans-serif; }
                  .xlsx-table td, .xlsx-table th { border: 1px solid #e2e8f0; padding: 4px 8px; white-space: nowrap; }
                  .xlsx-table tr:first-child td, .xlsx-table tr:first-child th { background: #f8fafc; font-weight: 600; position: sticky; top: 0; z-index: 1; }
                  .xlsx-table tr:hover td { background: #f0f9ff; }
                `}</style>
                <div
                  className="xlsx-table"
                  dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html ?? "" }}
                />
              </div>
            </div>
          ) : null
        )}

        {/* Word / PowerPoint — Microsoft Office Online viewer */}
        {type === "office" && officeViewerUrl && (
          <iframe
            src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(file.downloadUrl ?? "")}`}
            title={file.fileName}
            className="w-full h-full rounded shadow-xl bg-white"
            style={{ minHeight: "80vh" }}
          />
        )}

        {type === "text" && (
          textLoading ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading...</span>
            </div>
          ) : textError ? (
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <AlertCircle className="h-8 w-8 text-red-400" />
              <p className="text-sm">Failed to load file content</p>
            </div>
          ) : (
            <div className="w-full h-full overflow-auto rounded-lg bg-slate-900 border border-slate-700 shadow-xl" style={{ maxHeight: "80vh" }}>
              <pre className="p-5 text-xs text-slate-200 font-mono leading-relaxed whitespace-pre-wrap break-words">
                {textContent}
              </pre>
            </div>
          )
        )}

        {type === "none" && (
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <File className="h-16 w-16 text-slate-600" />
            <p className="text-sm font-medium text-slate-300">Preview not available</p>
            <p className="text-xs text-slate-500">Download the file to view it</p>
            <button
              onClick={handleDownload}
              className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

interface DropZoneProps {
  onFiles: (files: File[]) => void;
  uploading: boolean;
}

function DropZone({ onFiles, uploading }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = (files: FileList | null) => {
    if (!files?.length) return;
    onFiles(Array.from(files));
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files); }}
      onClick={() => !uploading && inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-5 cursor-pointer transition-colors ${
        dragging ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
      } ${uploading ? "opacity-60 cursor-not-allowed" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handle(e.target.files)}
        disabled={uploading}
      />
      {uploading ? (
        <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
      ) : (
        <Upload className={`h-5 w-5 ${dragging ? "text-blue-500" : "text-slate-400"}`} />
      )}
      <div className="text-center">
        <p className="text-xs font-medium text-slate-600">
          {uploading ? "Uploading..." : "Drop files or click to browse"}
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">Images, PDFs, Office, Video, Audio, Code · Max 25MB</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FilesTab({ dealId }: FilesTabProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);

  useEffect(() => {
    setLoading(true);
    setError("");
    getFiles(dealId)
      .then(setFiles)
      .catch(() => setError("Failed to load files"))
      .finally(() => setLoading(false));
  }, [dealId]);

  const handleUpload = useCallback(async (selectedFiles: File[]) => {
    if (!selectedFiles.length || uploading) return;
    setUploading(true);
    setError("");
    try {
      const results = await Promise.all(selectedFiles.map((f) => uploadFile(dealId, f)));
      setFiles((prev) => [...results, ...prev]);
    } catch {
      setError("Upload failed. Check file size (max 25MB) and try again.");
    } finally {
      setUploading(false);
    }
  }, [dealId, uploading]);

  const handleDelete = useCallback(async (fileId: number) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    if (previewFile?.id === fileId) setPreviewFile(null);
    try {
      await deleteFile(dealId, fileId);
    } catch {
      // optimistic — ignore
    }
  }, [dealId, previewFile]);

  const handleDownload = useCallback((file: FileItem) => {
    if (!file.downloadUrl) return;
    const a = document.createElement("a");
    a.href = file.downloadUrl;
    a.download = file.fileName;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  return (
    <>
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Upload zone */}
        <div className="p-4 border-b border-slate-200 flex-shrink-0">
          <DropZone onFiles={handleUpload} uploading={uploading} />
          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-8">
              <Paperclip className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-400">No files attached yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-slate-300 transition-colors"
                >
                  <FileIcon mimeType={file.mimeType} fileName={file.fileName} />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{file.fileName}</p>
                    <p className="text-[10px] text-slate-400">
                      {formatSize(file.fileSize)}
                      {file.createdTime && ` · ${timeAgo(file.createdTime)}`}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canPreview(file.mimeType, file.fileName) && (
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="rounded p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                        title="Preview"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {file.downloadUrl && (
                      <button
                        onClick={() => handleDownload(file)}
                        className="rounded p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Download"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(file.id)}
                      className="rounded p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Preview modal */}
      {previewFile && (
        <PreviewModal
          file={previewFile}
          dealId={dealId}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}
