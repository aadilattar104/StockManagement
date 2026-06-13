import { useRef, useState } from 'react'
import { Upload, FileText, X } from 'lucide-react'

export default function UploadZone({ accept, label, onFile, loading }) {
  const inputRef = useRef()
  const [dragging, setDragging] = useState(false)

  const handle = (file) => {
    if (!file) return
    onFile(file)
  }

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
        ${dragging ? 'border-brand-500 bg-brand-500/5' : 'border-slate-700 hover:border-slate-500 bg-slate-900/50'}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handle(e.dataTransfer.files[0]) }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handle(e.target.files[0])}
      />
      {loading ? (
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Processing…</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center">
            {accept?.includes('pdf') ? <FileText className="w-6 h-6 text-slate-400" /> : <Upload className="w-6 h-6 text-slate-400" />}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">{label}</p>
            <p className="text-xs text-slate-500 mt-1">Click to browse or drag & drop</p>
          </div>
        </div>
      )}
    </div>
  )
}
