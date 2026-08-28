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
  if (!bytes) return '0 B'
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
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return '🖼️'
  if (ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  if (['mp4', 'mov'].includes(ext)) return '🎥'
  return '📎'
}

function getFolderIcon(folderName) {
  const f = folderName.toLowerCase()
  if (f.includes('quote')) return '📊'
  if (f.includes('tender') || f.includes('submittal')) return '📑'
  if (f.includes('email') || f.includes('correspondence')) return '✉️'
  if (f.includes('contract') || f.includes('agreement')) return '📝'
  if (f.includes('safety') || f.includes('cert') || f.includes('inspection')) return '🦺'
  if (f.includes('work order') || f.includes('report')) return '📋'
  if (f.includes('invoice') || f.includes('receipt') || f.includes('expense')) return '💰'
  if (f.includes('locate') || f.includes('clearance')) return '📍'
  if (f.includes('photo') || f.includes('picture')) return '📷'
  if (f.includes('drawing') || f.includes('spec') || f.includes('as-built')) return '📐'
  if (f.includes('equipment') || f.includes('fuel')) return '🚜'
  if (f.includes('client')) return '👥'
  return '📁'
}

const BUCKET = 'project-files'

export default function FileDropbox({ projectId, folders }) {
  const { userRole } = useAuth()
  const initialFolder = folders?.[0] || 'Quotes'
  const [folderList, setFolderList] = useState(folders?.length ? [...new Set(folders)] : ['Quotes', 'Invoices', 'Emails & Correspondence', 'Safety Documents', 'Site Photos', 'General'])
  const [activeFolder, setActiveFolder] = useState(initialFolder)
  const [files, setFiles] = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)
  const [deletingKey, setDeletingKey] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [newFolderInput, setNewFolderInput] = useState('')
  const [showAddFolder, setShowAddFolder] = useState(false)
  const fileInputRef = useRef()

  const canDelete = userRole === 'admin' || userRole === 'full'

  // Update folder list if prop updates
  useEffect(() => {
    if (folders?.length) {
      setFolderList(prev => [...new Set([...prev, ...folders])])
    }
  }, [folders])

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true)
    setError(null)
    const path = `${projectId}/${activeFolder}/`
    const { data, error: err } = await supabase.storage.from(BUCKET).list(path, {
      limit: 200,
      sortBy: { column: 'created_at', order: 'desc' }
    })
    if (err) {
      console.error('File load error:', err)
      setError('Could not load files.')
    } else {
      setFiles((data || []).filter(f => f.name !== '.emptyFolderPlaceholder'))
    }
    setLoadingFiles(false)
  }, [activeFolder, projectId])

  useEffect(() => {
    if (activeFolder && projectId) {
      fetchFiles()
    }
  }, [activeFolder, projectId, fetchFiles])

  const uploadFiles = useCallback(async (rawFiles) => {
    setError(null)
    const valid = []
    for (const f of rawFiles) {
      if (!ALLOWED_TYPES.includes(f.type) && f.type !== '') {
        setError(`"${f.name}" is not an allowed file type.`)
        return
      }
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setError(`"${f.name}" exceeds the ${MAX_FILE_MB}MB limit.`)
        return
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
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`)
        setUploading(false)
        setUploadProgress(null)
        return
      }
    }
    setUploading(false)
    setUploadProgress(null)
    fetchFiles()
  }, [activeFolder, projectId, fetchFiles])

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

  function handleAddCustomFolder() {
    const name = newFolderInput.trim()
    if (name && !folderList.includes(name)) {
      setFolderList(prev => [...prev, name])
      setActiveFolder(name)
      setNewFolderInput('')
      setShowAddFolder(false)
    }
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
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handlePreview(file) {
    const path = `${projectId}/${activeFolder}/${file.name}`
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 180)
    if (data?.signedUrl) setPreviewUrl(data.signedUrl)
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: '1rem'
      }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', color: '#14202b', margin: 0, fontWeight: 700 }}>
            📁 Project Document &amp; File Vault
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#6e6e66', margin: '2px 0 0' }}>
            Active Folder: <strong>{activeFolder}</strong> ({files.length} file{files.length !== 1 ? 's' : ''})
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setShowAddFolder(!showAddFolder)}
            style={{
              background: '#ffffff',
              color: '#57544c',
              border: '1px solid #d8d5cb',
              padding: '8px 14px',
              borderRadius: 6,
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            + Add Folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              background: '#e8590c',
              color: '#ffffff',
              border: 'none',
              padding: '8px 18px',
              borderRadius: 6,
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: uploading ? 'not-allowed' : 'pointer'
            }}
          >
            {uploading ? uploadProgress || 'Uploading...' : '+ Upload Files'}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={onFileChange}
        />
      </div>

      {/* Add Custom Folder Input Bar */}
      {showAddFolder && (
        <div style={{
          background: '#ffffff',
          border: '1px solid #d8d5cb',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: '1rem',
          display: 'flex',
          gap: 8,
          alignItems: 'center'
        }}>
          <input
            style={{
              padding: '8px 12px',
              border: '1px solid #d8d5cb',
              borderRadius: 6,
              fontSize: '0.85rem',
              flex: 1,
              outline: 'none'
            }}
            placeholder="New folder name (e.g. Daily Tailgate Talks)"
            value={newFolderInput}
            onChange={e => setNewFolderInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddCustomFolder()}
            autoFocus
          />
          <button
            onClick={handleAddCustomFolder}
            style={{
              background: '#14202b',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Create
          </button>
          <button
            onClick={() => setShowAddFolder(false)}
            style={{
              background: 'none',
              border: 'none',
              color: '#8a8578',
              fontSize: '0.82rem',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Folder Tabs / Pills */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        marginBottom: '1rem',
        background: '#ffffff',
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid #e8e6df',
        boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
      }}>
        {folderList.map(folder => {
          const active = activeFolder === folder
          const icon = getFolderIcon(folder)
          return (
            <button
              key={folder}
              onClick={() => setActiveFolder(folder)}
              style={{
                background: active ? '#14202b' : '#faf9f5',
                color: active ? '#ffffff' : '#57544c',
                border: active ? '1px solid #14202b' : '1px solid #d8d5cb',
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: '0.82rem',
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease'
              }}
            >
              <span>{icon}</span>
              <span>{folder}</span>
            </button>
          )
        })}
      </div>

      {/* Error alert */}
      {error && (
        <div style={{
          background: '#ffe3e3', border: '1px solid #ffa8a8', color: '#c92a2a',
          borderRadius: 6, padding: '10px 14px', marginBottom: '1rem', fontSize: '0.85rem'
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* Drag & Drop Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? '#e8590c' : '#c8c4b7'}`,
          borderRadius: 8,
          padding: '2rem 1rem',
          textAlign: 'center',
          background: dragOver ? '#fff4eb' : '#faf9f5',
          cursor: 'pointer',
          marginBottom: '1.5rem',
          transition: 'all 0.2s ease'
        }}
      >
        <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>
          {getFolderIcon(activeFolder)}
        </div>
        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1c1c1a' }}>
          Drop files directly into <span style={{ color: '#e8590c' }}>{activeFolder}</span>, or click to browse
        </div>
        <div style={{ fontSize: '0.8rem', color: '#8a8578', marginTop: 4 }}>
          Supports Quotes, PDFs, Word, Excel Spreadsheets, Invoices, Pictures (up to 50MB)
        </div>
      </div>

      {/* Files List in Active Folder */}
      <div style={{
        background: '#ffffff',
        borderRadius: 8,
        padding: '1.5rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f0eee6', paddingBottom: 8 }}>
          <h3 style={{ fontSize: '1rem', color: '#14202b', margin: 0, fontWeight: 600 }}>
            Files in {activeFolder}
          </h3>
          <span style={{ fontSize: '0.8rem', color: '#8a8578' }}>
            {files.length} items
          </span>
        </div>

        {loadingFiles ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#8a8578' }}>
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#8a8578' }}>
            <p style={{ margin: '0 0 4px', fontWeight: 600, color: '#57544c' }}>This folder is empty.</p>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>Drag &amp; drop files above to start populating {activeFolder}.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {files.map((file, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid #e8e6df',
                  borderRadius: 6,
                  padding: '12px 14px',
                  background: '#fafaf8',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: '1.2rem' }}>{fileIcon(file.name)}</span>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '0.88rem',
                        color: '#14202b',
                        wordBreak: 'break-all',
                        lineHeight: 1.3
                      }}
                    >
                      {file.name.replace(/^\d+_/, '')}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#8a8578', marginBottom: 12 }}>
                    {formatBytes(file.metadata?.size)} &middot; {formatDate(file.created_at)}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, borderTop: '1px solid #f0eee6', paddingTop: 8 }}>
                  <button
                    onClick={() => handlePreview(file)}
                    style={{
                      flex: 1, background: '#fff', border: '1px solid #d8d5cb',
                      borderRadius: 4, padding: '5px 8px', fontSize: '0.75rem',
                      fontWeight: 600, color: '#57544c', cursor: 'pointer'
                    }}
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => handleDownload(file)}
                    style={{
                      flex: 1, background: '#e8590c', border: 'none',
                      borderRadius: 4, padding: '5px 8px', fontSize: '0.75rem',
                      fontWeight: 600, color: '#fff', cursor: 'pointer'
                    }}
                  >
                    Download
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(file)}
                      disabled={deletingKey === file.name}
                      style={{
                        background: '#fff', border: '1px solid #ffc9c9',
                        borderRadius: 4, padding: '5px 8px', fontSize: '0.75rem',
                        color: '#c92a2a', cursor: 'pointer'
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, padding: '2rem'
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 8, padding: '1rem',
              maxWidth: 900, width: '100%', maxHeight: '90vh',
              display: 'flex', flexDirection: 'column'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 600 }}>File Preview</span>
              <button onClick={() => setPreviewUrl(null)} style={{ cursor: 'pointer', border: 'none', background: 'none', fontSize: 16 }}>✕</button>
            </div>
            <iframe src={previewUrl} style={{ width: '100%', height: '75vh', border: 'none' }} title="Preview" />
          </div>
        </div>
      )}
    </div>
  )
}
