import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

const BUCKET = 'project-files'
const CERT_PREFIX = '_company_safety_and_certs'

const CERT_CATEGORIES = [
  'All Certifications',
  'Working at Heights',
  'WHMIS',
  'First Aid & CPR',
  'Confined Space',
  'Heavy Equipment Operator',
  'Driver Abstracts & Licences',
  'Company Safety Manuals',
  'Form 1000 / WSIB'
]

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv'
]

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

export default function StaffCertifications() {
  const { user, userRole, logout } = useAuth()
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState('All Certifications')
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [deletingKey, setDeletingKey] = useState(null)
  const fileInputRef = useRef()

  const canDelete = userRole === 'admin' || userRole === 'full'

  const fetchCerts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const folderPath = activeCategory === 'All Certifications'
        ? `${CERT_PREFIX}/`
        : `${CERT_PREFIX}/${activeCategory}/`

      const { data, error: err } = await supabase.storage.from(BUCKET).list(folderPath, {
        limit: 200,
        sortBy: { column: 'created_at', order: 'desc' }
      })

      if (err) {
        console.error('Error fetching cert files:', err)
        setError('Could not load certification files.')
      } else {
        setFiles((data || []).filter(f => f.name !== '.emptyFolderPlaceholder'))
      }
    } catch (e) {
      console.error(e)
      setError('Network error loading certifications.')
    } finally {
      setLoading(false)
    }
  }, [activeCategory])

  useEffect(() => {
    fetchCerts()
  }, [fetchCerts])

  const uploadFiles = async (rawFiles) => {
    setError(null)
    const targetSubfolder = activeCategory === 'All Certifications' ? 'General' : activeCategory
    const valid = []

    for (const f of rawFiles) {
      if (!ALLOWED_TYPES.includes(f.type) && f.type !== '') {
        setError(`"${f.name}" is not an allowed file type.`)
        return
      }
      valid.push(f)
    }

    setUploading(true)
    for (let i = 0; i < valid.length; i++) {
      const f = valid[i]
      setUploadProgress(`Uploading ${i + 1} of ${valid.length}: ${f.name}`)
      const safeName = f.name.replace(/[^a-zA-Z0-9._\-() ]/g, '_')
      const targetPath = `${CERT_PREFIX}/${targetSubfolder}/${Date.now()}_${safeName}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(targetPath, f, { upsert: false })
      if (upErr) {
        setError(`Upload failed: ${upErr.message}`)
        setUploading(false)
        setUploadProgress(null)
        return
      }
    }

    setUploading(false)
    setUploadProgress(null)
    fetchCerts()
  }

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

  async function handleDownload(file) {
    const targetSubfolder = activeCategory === 'All Certifications' ? 'General' : activeCategory
    const path = `${CERT_PREFIX}/${targetSubfolder}/${file.name}`
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handlePreview(file) {
    const targetSubfolder = activeCategory === 'All Certifications' ? 'General' : activeCategory
    const path = `${CERT_PREFIX}/${targetSubfolder}/${file.name}`
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 180)
    if (data?.signedUrl) setPreviewUrl(data.signedUrl)
  }

  async function handleDelete(file) {
    if (!window.confirm(`Delete "${file.name}"? This cannot be undone.`)) return
    setDeletingKey(file.name)
    const targetSubfolder = activeCategory === 'All Certifications' ? 'General' : activeCategory
    const path = `${CERT_PREFIX}/${targetSubfolder}/${file.name}`
    await supabase.storage.from(BUCKET).remove([path])
    setDeletingKey(null)
    fetchCerts()
  }

  const filteredFiles = files.filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f2f0ea' }}>
      {/* Top Header Bar */}
      <div style={{
        background: '#14202b',
        height: 72,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2rem',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div style={{
            width: 36, height: 36, border: '2px solid #ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 16, color: '#ffffff', letterSpacing: 1
          }}>GZ</div>
          <div>
            <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 14, letterSpacing: 1.2 }}>
              GROUND ZERO CONTRACTORS
            </div>
            <div style={{ fontWeight: 400, fontSize: 11, color: '#b0b0b0' }}>
              Staff &amp; Company Safety Library
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: '#e8590c',
              color: '#fff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ← Back to Projects
          </button>
          <span style={{ color: '#ffffff', fontSize: '0.85rem' }}>
            {user?.email}
          </span>
          <button
            onClick={logout}
            style={{
              background: 'transparent',
              color: '#c0c0c0',
              border: '1px solid #555',
              padding: '6px 12px',
              borderRadius: 4,
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Title and Intro */}
        <div style={{
          background: '#ffffff',
          borderRadius: 8,
          padding: '1.5rem 2rem',
          marginBottom: '1.5rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
          borderLeft: '5px solid #e8590c'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: '1.5rem', color: '#14202b', margin: '0 0 6px', fontWeight: 700 }}>
                🦺 Staff Safety &amp; Training Certifications
              </h1>
              <p style={{ fontSize: '0.9rem', color: '#6e6e66', margin: 0 }}>
                Central repository for employee tickets, WSIB, equipment qualifications, and safety compliance documents. Upload here once and reuse across any project tender or quote.
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                background: '#e8590c',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 6,
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer'
              }}
            >
              {uploading ? uploadProgress || 'Uploading...' : '+ Upload Certificate / Document'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={onFileChange}
            />
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div style={{
            background: '#ffe3e3', border: '1px solid #ffa8a8', color: '#c92a2a',
            borderRadius: 6, padding: '10px 14px', marginBottom: '1.5rem', fontSize: '0.9rem'
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Categories Bar & Search */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: '1.2rem'
        }}>
          {/* Category Tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {CERT_CATEGORIES.map(cat => {
              const active = activeCategory === cat
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  style={{
                    background: active ? '#14202b' : '#ffffff',
                    color: active ? '#ffffff' : '#57544c',
                    border: active ? '1px solid #14202b' : '1px solid #d8d5cb',
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontSize: '0.82rem',
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer'
                  }}
                >
                  {cat}
                </button>
              )
            })}
          </div>

          {/* Search Input */}
          <input
            type="text"
            placeholder="Search certificates..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              padding: '8px 14px',
              border: '1px solid #d8d5cb',
              borderRadius: 20,
              fontSize: '0.85rem',
              background: '#fff',
              outline: 'none',
              width: 220
            }}
          />
        </div>

        {/* Drag & Drop Upload Zone */}
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
          <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>📄</div>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1c1c1a' }}>
            Drag &amp; drop certificate files here, or <span style={{ color: '#e8590c', textDecoration: 'underline' }}>browse</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#8a8578', marginTop: 4 }}>
            Uploading to folder: <strong>{activeCategory}</strong> (PDF, JPG, PNG, DOCX, XLSX up to 50MB)
          </div>
        </div>

        {/* Files Grid / List */}
        <div style={{
          background: '#ffffff',
          borderRadius: 8,
          padding: '1.5rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #f0eee6', paddingBottom: 10 }}>
            <h2 style={{ fontSize: '1.05rem', color: '#14202b', margin: 0, fontWeight: 600 }}>
              Stored Documents ({filteredFiles.length})
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#8a8578' }}>
              Category: {activeCategory}
            </span>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '2.5rem', color: '#8a8578' }}>
              Loading safety files...
            </div>
          ) : filteredFiles.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#8a8578' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📋</div>
              <p style={{ margin: '0 0 6px', fontWeight: 600, color: '#57544c' }}>No documents in {activeCategory}</p>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>Drag and drop files above to upload training records and compliance certs.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
              {filteredFiles.map((file, i) => (
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
                      <span style={{ fontSize: '1.2rem' }}>📜</span>
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
                      {formatBytes(file.metadata?.size)} • {formatDate(file.created_at)}
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
      </div>

      {/* Full Preview Modal */}
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
              <span style={{ fontWeight: 600 }}>Document Preview</span>
              <button onClick={() => setPreviewUrl(null)} style={{ cursor: 'pointer', border: 'none', background: 'none', fontSize: 16 }}>✕</button>
            </div>
            <iframe src={previewUrl} style={{ width: '100%', height: '75vh', border: 'none' }} title="Preview" />
          </div>
        </div>
      )}
    </div>
  )
}
