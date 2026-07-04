/**
 * @author sgz
 * @since 2026-07-03
 */
'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface UploadFormProps {
  onClose: () => void
}

export default function UploadForm({ onClose }: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = e.dataTransfer.files
    if (files?.[0]?.name.endsWith('.zip')) {
      setFile(files[0])
      if (!name) {
        setName(files[0].name.replace(/\.zip$/, ''))
      }
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files?.[0]) {
      setFile(files[0])
      if (!name) {
        setName(files[0].name.replace(/\.zip$/, ''))
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (name.trim()) formData.append('name', name.trim())
      if (version.trim()) formData.append('version', version.trim())
      formData.append('overwrite', 'true') // 同名技能总是覆盖，不再需要用户勾选

      const res = await fetch('/api/skills', {
        method: 'POST',
        body: formData
      })

      if (!res.ok) {
        const text = await res.text()
        alert(`上传失败: ${text}`)
        return
      }

      router.refresh()
      onClose()
    } catch (err) {
      alert(`上传失败: ${err}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg">
        {/* Glow effect */}
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-fuchsia-500/20 to-cyan-500/20 rounded-2xl blur-2xl" />

        {/* Modal */}
        <div className="relative bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-zinc-800">
            <h2 className="text-2xl font-bold text-zinc-100">上传技能</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <svg className="w-6 h-6 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            {/* Drag & Drop Zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-xl p-8 transition-all duration-300 ${
                dragActive
                  ? 'border-cyan-500 bg-cyan-500/10'
                  : 'border-zinc-700 hover:border-zinc-600 bg-zinc-900/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="text-center space-y-4">
                <div className="flex justify-center">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
                    dragActive ? 'bg-cyan-500/20' : 'bg-zinc-800'
                  }`}>
                    <svg className={`w-8 h-8 transition-colors ${dragActive ? 'text-cyan-400' : 'text-zinc-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                </div>

                {file ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-center gap-2 text-cyan-400">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="font-medium">{file.name}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      className="text-sm text-zinc-500 hover:text-zinc-400 transition-colors"
                    >
                      移除
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-zinc-300 font-medium">
                      拖拽 ZIP 文件到此处
                    </p>
                    <p className="text-zinc-500 text-sm">或</p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-4 py-2 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-lg hover:bg-cyan-500/20 hover:border-cyan-500/50 transition-all duration-300 font-medium"
                    >
                      选择文件
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Name Input */}
            <div className="space-y-2">
              <label htmlFor="skill-name" className="block text-sm font-medium text-zinc-300">
                技能名称 <span className="text-zinc-600">(可选)</span>
              </label>
              <input
                id="skill-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="留空则使用文件名"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300"
              />
            </div>

            {/* Version Input */}
            <div className="space-y-2">
              <label htmlFor="skill-version" className="block text-sm font-medium text-zinc-300">
                版本号 <span className="text-zinc-600">(可选，如 1.0.0)</span>
              </label>
              <input
                id="skill-version"
                type="text"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="留空：新技能默认 1.0.0，覆盖则自动 +1"
                className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all duration-300"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-4">
              <button
                type="submit"
                disabled={!file || uploading}
                className="flex-1 px-6 py-3 bg-cyan-500 text-white rounded-lg font-medium hover:bg-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-[0_0_20px_rgba(0,217,255,0.3)] hover:shadow-[0_0_30px_rgba(0,217,255,0.5)]"
              >
                {uploading ? '上传中...' : '上传'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={uploading}
                className="px-6 py-3 bg-zinc-800 text-zinc-300 rounded-lg font-medium hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
