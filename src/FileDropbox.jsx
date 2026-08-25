import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'video/mp4', 'video/quicktime',
]
const MAX_FILE_MB = 50

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase()
  if (['jpg','jpeg','png','gif','webp','heic'].includes(ext)) return '🖼️'
  if (ext === 'pdf') return '📄'
  if (['doc','docx'].includes(ext)) return '📝'
  if (['xls','xlsx','csv'].includes(ext)) return '📊'
  if (['mp4','mov'].includes(ext)) return '🎥'
  return '📎'
}

const BUCKET = 'project-files'

export default function FileDropbox({ projectId, folders }) {
  const { user, userRole } = useAuth()
  const [activeFolder, setActiveFolder] = useState(folders?.[0] || 'General')
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)
  const [deletingKey, setDeletingKey] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const fileInputRef = useRef()

  const canDelete = userRole === 'admin' || userRole === 'full'
  const allFolders = folders?.length ? [...folders, 'General'] : ['General', 'Photos', 'Invoices', 'Daily Notes', 'PDFs', 'Other']

  // deduplicate folders
  const uniqueFolders = [...new Set(allFolders)]

  useEffect(() => {
    if (activeFolder) fetchFiles()
  }, [activeFolder, projectId])

  async function fetchFiles() {
    setError(null)
    const path = `${projectId}/${activeFolder}/`
    const { data, error: err } = await supabase.storage.from(BUCKET).list(path, {
      limit: 200, sortBy: { column: 'created_at', order: 'desc' }
    })
    if (err) { setError('Could not load files.'); return }
    setFiles((data || []).filter(f => f.name !== '.emptyFolderPlaceholder'))
  }

  const uploadFiles = useCallback(async (rawFiles) => {
    setError(null)
    const valid = []
    for (const f of rawFiles) {
      if (!ALLOWED_TYPES.includes(f.type) && f.type !== '') {
        setError(`"${f.name}" is not an allowed file type.`); return
      }
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`"${f.name}" exceeds the ${MAX_FILE_MB}MB limit.`); return
      }
      valid.push(f)
    }
    setUploading(true)
    for (let i = 0; i < valid.length; i++) {
      const f = valid[i]
      setUploadProgress(`Uploading ${i + 1} of ${valid.length}: ${f.name}`)
      const safeName = f.name.replace(/[^a-zA-Z0-9._\-() ]/g, '_')
      const path = `${projectId}/${activeFolder}/${Date.now()}_${safeName}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { upsert: false })
      if (upErr) { setError(`Upload failed: ${upErr.message}`); setUploading(false); setUploadProgress(null); return }
    }
    setUploading(false)
    setUploadProgress(null)
    fetchFiles()
  }, [activeFolder, projectId])

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length) uploadFiles(dropped)
  }

  function onFileChange(e) {
    const picked = Array.from(e.target.files)
    if (picked.length) uploadFiles(picked)
    e.target.value = ''
  }

  async function handleDelete(file) {
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return
    setDeletingKey(file.name)
    const path = `${projectId}/${activeFolder}/${file.name}`
    await supabase.storage.from(BUCKET).remove([path])
    setDeletingKey(null)
    fetchFiles()
  }

  async function handleDownload(file) {
    const path = `${projectId}/${activeFolder}/${file.name}`
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handlePreview(file) {
    const path = `${projectId}/${activeFolder}/${file.name}`
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
    if (data?.signedUrl) setPreviewUrl(data.signedUrl)
  }

  const isImage = (name) => /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(name)
  const isPDF = (name) => /\.pdf$/i.test(name)

  return (
    <div style={{ marginTop: '2rem' }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1rem', color: '#1c1c1a', margin: 0 }}>📁 Files & Documents</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            background: '#e8590c', color: '#ffffff', border: 'none',
            padding: '7px 16px', borderRadius: 4, fontSize: '0.82rem',
            fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1
          }}
        >
          {uploading ? uploadProgress || 'Uploading…' : '+ Upload Files'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>

      {/* Folder tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '1rem' }}>
        {uniqueFolders.map(folder => (
          <button
            key={folder}
            onClick={() => setActiveFolder(folder)}
            style={{
              background: activeFolder === folder ? '#14202b' : '#ffffff',
              color: activeFolder === folder ? '#ffffff' : '#6e6e66',
              border: `1px solid ${activeFolder === folder ? '#14202b' : '#d4d0c8'}`,
              padding: '5px 14px', borderRadius: 20, fontSize: '0.8rem',
              fontWeight: activeFolder === folder ? 600 : 400,
              cursor: 'pointer', transition: 'all 0.15s'
            }}
          >
            {folder}
          </button>
        ))}
      </div>

      {/* Drag & drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#e8590c' : '#d4d0c8'}`,
          borderRadius: 8,
          padding: '1.5rem',
          textAlign: 'center',
          background: dragOver ? '#fff4ef' : '#fafaf8',
          cursor: uploading ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
          marginBottom: '1rem'
        }}
      >
        {uploading ? (
          <div>
            <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>⏳</div>
            <p style={{ color: '#e8590c', fontSize: '0.85rem', fontWeight: 600, margin: 0 }}>
              {uploadProgress || 'Uploading…'}
            </p>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>☁️</div>
            <p style={{ color: '#8a8578', fontSize: '0.85rem', margin: 0 }}>
              Drag & drop files here, or <span style={{ color: '#e8590c', fontWeight: 600 }}>click to browse</span>
            </p>
            <p style={{ color: '#b0aba3', fontSize: '0.75rem', marginTop: 4 }}>
              Photos, PDFs, Word, Excel, videos · Max {MAX_FILE_MB}MB per file
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: '#fff0f0', border: '1px solid #f5a6a6', borderRadius: 6,
          padding: '0.6rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#c92a2a'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* File list */}
      <div style={{ background: '#ffffff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        {files.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#8a8578', fontSize: '0.9rem' }}>
            No files in <strong>{activeFolder}</strong> yet. Upload something above.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e8e6df', background: '#fafaf8' }}>
                <th style={{ textAlign: 'left', padding: '10px 14px', color: '#8a8578', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>File</th>
                <th style={{ textAlign: 'right', padding: '10px 14px', color: '#8a8578', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>Size</th>
                <th style={{ textAlign: 'left', padding: '10px 14px', color: '#8a8578', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>Uploaded</th>
                <th style={{ textAlign: 'center', padding: '10px 14px', color: '#8a8578', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file, i) => {
                // strip timestamp prefix for display
                const displayName = file.name.replace(/^\d+_/, '')
                return (
                  <tr key={file.name} style={{ borderBottom: i < files.length - 1 ? '1px solid #f2f0ea' : 'none' }}>
                    <td style={{ padding: '10px 14px', color: '#1c1c1a' }}>
                      <span style={{ marginRight: 6 }}>{fileIcon(displayName)}</span>
                      <span style={{ wordBreak: 'break-all' }}>{displayName}</span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#6e6e66', whiteSpace: 'nowrap' }}>
                      {formatBytes(file.metadata?.size || 0)}
                    </td>
                    <td style={{ padding: '10px 14px', color: '#8a8578', whiteSpace: 'nowrap' }}>
                      {formatDate(file.created_at)}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        {(isImage(displayName) || isPDF(displayName)) && (
                          <button
                            onClick={() => handlePreview(file)}
                            style={{
                              background: 'transparent', border: '1px solid #d4d0c8',
                              color: '#6e6e66', padding: '4px 10px', borderRadius: 4,
                              fontSize: '0.75rem', cursor: 'pointer'
                            }}
                          >
                            View
                          </button>
                        )}
                        <button
                          onClick={() => handleDownload(file)}
                          style={{
                            background: 'transparent', border: '1px solid #d4d0c8',
                            color: '#6e6e66', padding: '4px 10px', borderRadius: 4,
                            fontSize: '0.75rem', cursor: 'pointer'
                          }}
                        >
                          ↓ Download
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(file)}
                            disabled={deletingKey === file.name}
                            style={{
                              background: 'transparent', border: '1px solid #f5a6a6',
                              color: '#c92a2a', padding: '4px 10px', borderRadius: 4,
                              fontSize: '0.75rem', cursor: deletingKey === file.name ? 'not-allowed' : 'pointer',
                              opacity: deletingKey === file.name ? 0.5 : 1
                            }}
                          >
                            {deletingKey === file.name ? '…' : 'Delete'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Lightbox preview */}
      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '2rem', cursor: 'zoom-out'
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', position: 'relative' }}>
            <button
              onClick={() => setPreviewUrl(null)}
              style={{
                position: 'absolute', top: -16, right: -16,
                background: '#ffffff', border: 'none', borderRadius: '50%',
                width: 32, height: 32, fontWeight: 700, fontSize: '1rem',
                cursor: 'pointer', zIndex: 10000
              }}
            >✕</button>
            {previewUrl.match(/\.pdf/i) ? (
              <iframe src={previewUrl} style={{ width: '80vw', height: '85vh', border: 'none', borderRadius: 8 }} title="Preview" />
            ) : (
              <img src={previewUrl} alt="Preview" style={{ maxWidth: '85vw', maxHeight: '85vh', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
