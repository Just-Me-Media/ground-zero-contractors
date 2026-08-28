import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

const STAGES = [
  'All Projects',
  'Bidding / Quotes',
  'Awarded / Active',
  'Completed / Invoicing',
  'Closed / Archived'
]

export default function Dashboard() {
  const { user, userRole, logout } = useAuth()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeStage, setActiveStage] = useState('All Projects')
  const navigate = useNavigate()

  const isClient = userRole === 'client'
  const canCreate = userRole !== 'client'

  useEffect(() => {
    fetchProjects()
  }, [])

  async function fetchProjects() {
    setLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) setProjects(data)
    if (error) console.error('Error fetching projects:', error)
    setLoading(false)
  }

  // Parse project stage or fallback to Bidding/Active based on planned
  function getProjectStage(p) {
    try {
      if (p.folders) {
        const parsed = typeof p.folders === 'string' ? JSON.parse(p.folders) : p.folders
        if (parsed?.stage) return parsed.stage
      }
    } catch (_) {}
    return (p.total_planned && p.total_planned > 0) ? 'Awarded / Active' : 'Bidding / Quotes'
  }

  function getFolderCount(p) {
    try {
      if (p.folders) {
        const parsed = typeof p.folders === 'string' ? JSON.parse(p.folders) : p.folders
        if (Array.isArray(parsed?.all)) return parsed.all.length
        if (Array.isArray(parsed?.clientFiles) || Array.isArray(parsed?.projectFiles)) {
          return (parsed.clientFiles?.length || 0) + (parsed.projectFiles?.length || 0) + (parsed.fixed?.length || 0)
        }
      }
    } catch (_) {}
    return 10
  }

  const filteredProjects = projects.filter(p => {
    const stage = getProjectStage(p)
    const matchesStage = activeStage === 'All Projects' || stage === activeStage
    const query = searchQuery.toLowerCase().trim()
    const matchesQuery = !query ||
      p.name?.toLowerCase().includes(query) ||
      p.client?.toLowerCase().includes(query) ||
      p.assigned_client_email?.toLowerCase().includes(query)

    return matchesStage && matchesQuery
  })

  return (
    <div style={{ minHeight: '100vh', background: '#f2f0ea' }}>
      {/* Top bar */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, border: '2px solid #ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 16, color: '#ffffff', letterSpacing: 1
          }}>GZ</div>
          <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 14, letterSpacing: 1.5 }}>
            GROUND ZERO
            <span style={{ fontWeight: 400, fontSize: 11, color: '#b0b0b0', display: 'block' }}>
              CONTRACTORS INC.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          {!isClient && (
            <button
              onClick={() => navigate('/safety-certs')}
              style={{
                background: '#233342',
                color: '#fff',
                border: '1px solid #374a5d',
                padding: '6px 14px',
                borderRadius: 4,
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <span>🦺</span> Staff Certs &amp; Safety
            </button>
          )}

          <span style={{
            background: isClient ? '#854d0e' : '#2b8a3e',
            color: '#ffffff', fontSize: '0.7rem', fontWeight: 600,
            padding: '3px 8px', borderRadius: 10, textTransform: 'uppercase'
          }}>
            {userRole}
          </span>
          <span style={{ color: '#ffffff', fontSize: '0.85rem' }}>
            {user?.email}
          </span>
          <button
            onClick={logout}
            style={{
              background: 'transparent',
              color: '#c0c0c0',
              border: '1px solid #555',
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ maxWidth: 1140, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Header with Title and Create Button */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 14,
          marginBottom: '1.5rem'
        }}>
          <div>
            <h1 style={{ fontSize: '1.7rem', color: '#14202b', fontWeight: 700, margin: 0 }}>
              Project &amp; Quote Dashboard
            </h1>
            <p style={{ fontSize: '0.88rem', color: '#6e6e66', margin: '4px 0 0' }}>
              Civil remediation matter management, quotes, safety files, submittals, and field tracking.
            </p>
          </div>

          {canCreate && (
            <button
              onClick={() => navigate('/new')}
              style={{
                background: '#e8590c',
                color: '#ffffff',
                border: 'none',
                padding: '12px 24px',
                borderRadius: 6,
                fontSize: '0.92rem',
                fontWeight: 700,
                cursor: 'pointer',
                letterSpacing: 0.3,
                boxShadow: '0 2px 6px rgba(232, 89, 12, 0.25)'
              }}
            >
              + New Project &amp; Quote
            </button>
          )}
        </div>

        {/* Filter Bar & Search */}
        <div style={{
          background: '#ffffff',
          borderRadius: 8,
          padding: '1rem 1.2rem',
          marginBottom: '1.5rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12
        }}>
          {/* Stage Tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {STAGES.map(stage => {
              const active = activeStage === stage
              return (
                <button
                  key={stage}
                  onClick={() => setActiveStage(stage)}
                  style={{
                    background: active ? '#14202b' : '#faf9f5',
                    color: active ? '#ffffff' : '#57544c',
                    border: active ? '1px solid #14202b' : '1px solid #d8d5cb',
                    padding: '6px 14px',
                    borderRadius: 20,
                    fontSize: '0.82rem',
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {stage}
                </button>
              )
            })}
          </div>

          {/* Search Box */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="text"
              placeholder="Search projects or quotes..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                padding: '8px 14px',
                border: '1px solid #d8d5cb',
                borderRadius: 20,
                fontSize: '0.85rem',
                background: '#fafaf8',
                outline: 'none',
                width: 240
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  background: 'none', border: 'none', color: '#8a8578',
                  fontSize: 14, cursor: 'pointer'
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Project Grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: '#8a8578' }}>
            Loading projects...
          </div>
        ) : filteredProjects.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '3.5rem 1.5rem', color: '#8a8578',
            background: '#ffffff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
          }}>
            <div style={{ fontSize: '2.4rem', marginBottom: 10 }}>🏗️</div>
            <p style={{ fontSize: '1.15rem', fontWeight: 600, color: '#1c1c1a', margin: '0 0 6px' }}>
              {projects.length === 0
                ? 'No projects created yet'
                : 'No projects match your filter'}
            </p>
            <p style={{ fontSize: '0.9rem', margin: '0 0 20px', maxWidth: 460, marginInline: 'auto' }}>
              {isClient
                ? 'You do not have any assigned projects in this stage.'
                : 'Create your first project to start organizing quotes, submittals, safety docs, and invoices.'}
            </p>
            {canCreate && (
              <button
                onClick={() => navigate('/new')}
                style={{
                  background: '#e8590c', color: '#ffffff', border: 'none',
                  padding: '10px 22px', borderRadius: 6, fontSize: '0.9rem',
                  fontWeight: 600, cursor: 'pointer'
                }}
              >
                + Create New Project
              </button>
            )}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '1.4rem'
          }}>
            {filteredProjects.map(p => {
              const stage = getProjectStage(p)
              const folderCount = getFolderCount(p)
              const isBidding = stage === 'Bidding / Quotes'
              const isCompleted = stage === 'Completed / Invoicing'

              return (
                <div
                  key={p.id}
                  onClick={() => navigate(`/project/${p.id}`)}
                  style={{
                    background: '#ffffff',
                    borderRadius: 8,
                    padding: '1.4rem',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    border: '1px solid #e8e6df',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-2px)'
                    e.currentTarget.style.boxShadow = '0 6px 14px rgba(0,0,0,0.09)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'none'
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <span style={{
                        background: isBidding ? '#e7f5ff' : isCompleted ? '#e6fcf5' : '#fff4e6',
                        color: isBidding ? '#1864ab' : isCompleted ? '#087f5b' : '#d9480f',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 4,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em'
                      }}>
                        {stage}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#8a8578' }}>
                        📁 {folderCount} Folders
                      </span>
                    </div>

                    <h3 style={{ fontSize: '1.15rem', color: '#14202b', fontWeight: 700, margin: '6px 0 4px', lineHeight: 1.3 }}>
                      {p.name}
                    </h3>
                    <p style={{ fontSize: '0.88rem', color: '#6e6e66', margin: '0 0 12px' }}>
                      Client: <strong>{p.client}</strong>
                    </p>
                  </div>

                  <div style={{ borderTop: '1px solid #f0eee6', paddingTop: 10, marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#57544c', marginBottom: 4 }}>
                      <span>Planned:</span>
                      <span style={{ fontWeight: 600 }}>
                        {p.total_planned && p.total_planned > 0
                          ? `${p.total_planned.toLocaleString()} ${p.unit || 'units'}`
                          : 'As Quoted'}
                      </span>
                    </div>
                    {p.start_date && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#8a8578' }}>
                        <span>Timeline:</span>
                        <span>{p.start_date} → {p.target_date || 'TBD'}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
