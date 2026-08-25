import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import FileDropbox from './FileDropbox'

function daysBetween(a, b) {
  if (!a || !b) return 0
  const ms = new Date(b) - new Date(a)
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)))
}

export default function ProductionLog() {
  const { id } = useParams()
  const { userRole } = useAuth()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [entries, setEntries] = useState([])
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [quantity, setQuantity] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)

  const canDelete = userRole === 'admin' || userRole === 'full'

  useEffect(() => {
    Promise.all([fetchProject(), fetchEntries()]).then(() => setLoading(false))
  }, [id])

  async function fetchProject() {
    const { data } = await supabase.from('projects').select('*').eq('id', id).single()
    if (data) setProject(data)
  }

  async function fetchEntries() {
    const { data } = await supabase
      .from('production_entries')
      .select('*')
      .eq('project_id', id)
      .order('date', { ascending: false })
    if (data) setEntries(data)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!date || !quantity) return
    await supabase.from('production_entries').insert({
      project_id: id,
      date,
      quantity: parseFloat(quantity)
    })
    setQuantity('')
    fetchEntries()
  }

  async function handleRemove(entryId) {
    setDeleting(entryId)
    await supabase.from('production_entries').delete().eq('id', entryId)
    setDeleting(null)
    fetchEntries()
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#8a8578', background: '#f2f0ea', minHeight: '100vh' }}>
        Loading...
      </div>
    )
  }

  if (!project) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#8a8578', background: '#f2f0ea', minHeight: '100vh' }}>
        Project not found.
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)
  const totalPlanned = project.total_planned || 0
  const startDate = project.start_date
  const targetDate = project.target_date
  const totalCompleted = entries.reduce((sum, e) => sum + (e.quantity || 0), 0)
  const percentComplete = totalPlanned > 0 ? (totalCompleted / totalPlanned) * 100 : 0

  const elapsedDays = daysBetween(startDate, today)
  const remainingDays = daysBetween(today, targetDate)

  const actualDailyRate = elapsedDays > 0 ? totalCompleted / elapsedDays : 0
  const remainingWork = totalPlanned - totalCompleted
  const requiredDailyRate = remainingDays > 0 ? remainingWork / remainingDays : (remainingWork > 0 ? Infinity : 0)

  const projectedDaysRemaining = actualDailyRate > 0 ? Math.ceil(remainingWork / actualDailyRate) : Infinity
  const projectedFinish = actualDailyRate > 0
    ? new Date(Date.now() + projectedDaysRemaining * 86400000).toISOString().slice(0, 10)
    : '—'

  const daysAheadOrBehind = targetDate
    ? remainingDays - projectedDaysRemaining
    : 0

  let paceLabel = 'On Track'
  let paceColor = '#2b8a3e'
  if (daysAheadOrBehind > 5) {
    paceLabel = 'Ahead'
    paceColor = '#2b8a3e'
  } else if (daysAheadOrBehind < -5) {
    paceLabel = 'Behind'
    paceColor = '#c92a2a'
  } else if (daysAheadOrBehind < 0) {
    paceLabel = 'Slightly Behind'
    paceColor = '#e8590c'
  }

  const paceSuffix = targetDate && actualDailyRate > 0
    ? ` (${Math.abs(daysAheadOrBehind)} day${daysAheadOrBehind !== 1 ? 's' : ''} ${daysAheadOrBehind >= 0 ? 'ahead' : 'behind'})`
    : ''

  return (
    <div style={{ minHeight: '100vh', background: '#f2f0ea' }}>
      {/* Top bar */}
      <div style={{
        background: '#14202b', height: 72, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 2rem', position: 'sticky', top: 0, zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'transparent', color: '#c0c0c0', border: '1px solid #555',
            padding: '6px 14px', borderRadius: 4, fontSize: '0.8rem', cursor: 'pointer'
          }}
        >
          &larr; Dashboard
        </button>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem' }}>
        {/* Project header */}
        <h1 style={{ fontSize: '1.5rem', color: '#1c1c1a', marginBottom: 4 }}>{project.name}</h1>
        <p style={{ fontSize: '0.9rem', color: '#8a8578', marginBottom: '1.5rem' }}>
          {project.client} &middot; {totalPlanned.toLocaleString()} {project.unit || 'units'} planned
        </p>

        {/* Metric cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem'
        }}>
          {/* Completed so far */}
          <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: '0.75rem', color: '#8a8578', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
              Completed so far
            </p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1c1c1a' }}>
              {totalCompleted.toLocaleString()} <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#8a8578' }}>/ {totalPlanned.toLocaleString()}</span>
            </p>
            <div style={{
              width: '100%', height: 8, background: '#e8e6df', borderRadius: 4, marginTop: 8, overflow: 'hidden'
            }}>
              <div style={{
                width: `${Math.min(percentComplete, 100)}%`,
                height: '100%',
                background: '#e8590c',
                borderRadius: 4,
                transition: 'width 0.3s'
              }} />
            </div>
            <p style={{ fontSize: '0.8rem', color: '#6e6e66', marginTop: 4 }}>
              {percentComplete.toFixed(1)}% complete
            </p>
          </div>

          {/* Actual daily rate */}
          <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: '0.75rem', color: '#8a8578', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
              Actual daily rate
            </p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1c1c1a' }}>
              {actualDailyRate.toFixed(1)}
              <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#8a8578' }}> /day</span>
            </p>
            <p style={{ fontSize: '0.8rem', color: '#6e6e66', marginTop: 4 }}>
              over {elapsedDays} day{elapsedDays !== 1 ? 's' : ''}
            </p>
          </div>

          {/* Required daily rate */}
          <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: '0.75rem', color: '#8a8578', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
              Required daily rate
            </p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: requiredDailyRate === Infinity ? '#c92a2a' : '#1c1c1a' }}>
              {requiredDailyRate === Infinity ? '—' : requiredDailyRate.toFixed(1)}
              <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#8a8578' }}> /day</span>
            </p>
            <p style={{ fontSize: '0.8rem', color: '#6e6e66', marginTop: 4 }}>
              to finish by target
            </p>
          </div>

          {/* Projected finish */}
          <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <p style={{ fontSize: '0.75rem', color: '#8a8578', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
              Projected finish
            </p>
            <p style={{ fontSize: '1.5rem', fontWeight: 700, color: paceColor }}>
              {projectedFinish}
            </p>
            <p style={{ fontSize: '0.8rem', color: paceColor, marginTop: 4, fontWeight: 600 }}>
              {paceLabel}
              {paceSuffix && (
                <span style={{ fontWeight: 400, color: '#8a8578' }}>{paceSuffix}</span>
              )}
            </p>
          </div>
        </div>

        {/* Log entry form */}
        <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.5rem', marginBottom: '2rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: '1rem', color: '#1c1c1a', marginBottom: '1rem' }}>Log Production Entry</h2>
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#1c1c1a', marginBottom: 4 }}>Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                style={{
                  padding: '8px 10px', border: '1px solid #d4d0c8', borderRadius: 4,
                  fontSize: '0.9rem', background: '#fafaf8', outline: 'none'
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#1c1c1a', marginBottom: 4 }}>
                Quantity ({project.unit || 'units'})
              </label>
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="0"
                style={{
                  padding: '8px 10px', border: '1px solid #d4d0c8', borderRadius: 4,
                  fontSize: '0.9rem', width: 140, background: '#fafaf8', outline: 'none'
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                background: '#e8590c', color: '#ffffff', border: 'none',
                padding: '8px 20px', borderRadius: 4, fontSize: '0.85rem',
                fontWeight: 600, cursor: 'pointer'
              }}
            >
              Log Entry
            </button>
          </form>
        </div>

        {/* Entries list */}
        <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: '1rem', color: '#1c1c1a', marginBottom: '1rem' }}>
            Production Entries ({entries.length})
          </h2>
          {entries.length === 0 ? (
            <p style={{ color: '#8a8578', fontSize: '0.9rem' }}>No entries logged yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e8e6df' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Date</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Quantity</th>
                    {canDelete && <th style={{ textAlign: 'center', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}></th>}
                  </tr>
                </thead>
                <tbody>
                    {entries.map((entry, i) => (
                    <tr key={entry.id} style={{ borderBottom: i < entries.length - 1 ? '1px solid #f2f0ea' : 'none' }}>
                      <td style={{ padding: '10px 12px', color: '#1c1c1a' }}>{entry.date}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#1c1c1a', fontWeight: 600 }}>
                        {entry.quantity?.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {canDelete && (
                          <button
                            onClick={() => handleRemove(entry.id)}
                            disabled={deleting === entry.id}
                            style={{
                              background: 'transparent', border: '1px solid #d4d0c8',
                              color: '#8a8578', padding: '4px 10px', borderRadius: 4,
                              fontSize: '0.75rem', cursor: deleting === entry.id ? 'not-allowed' : 'pointer'
                            }}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Client passwords (admin/full/limited only) */}
        {canDelete && project.contacts && (() => {
          let parsed
          try { parsed = typeof project.contacts === 'string' ? JSON.parse(project.contacts) : project.contacts } catch(e) { parsed = null }
          const clientList = Array.isArray(parsed) ? parsed.filter(c => c.password) : []
          if (clientList.length === 0) return null
          return (
            <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.5rem', marginTop: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <h2 style={{ fontSize: '1rem', color: '#1c1c1a', marginBottom: '1rem' }}>
                Client Passwords
              </h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e8e6df' }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Client</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Email</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Password</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clientList.map((c, i) => (
                      <tr key={i} style={{ borderBottom: i < clientList.length - 1 ? '1px solid #f2f0ea' : 'none' }}>
                        <td style={{ padding: '10px 12px', color: '#1c1c1a' }}>{c.name}</td>
                        <td style={{ padding: '10px 12px', color: '#1c1c1a' }}>{c.email}</td>
                        <td style={{ padding: '10px 12px', color: '#a8380d', fontWeight: 700 }}>{c.password}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })()}
        {/* File Dropbox */}
        {(() => {
          let allFolders = []
          try {
            const cf = typeof project.folders === 'string' ? JSON.parse(project.folders) : project.folders
            if (cf) {
              allFolders = [
                ...(cf.clientFiles || []),
                ...(cf.projectFiles || [])
              ]
            }
          } catch(e) {}
          return (
            <FileDropbox
              projectId={id}
              folders={allFolders.length > 0 ? allFolders : undefined}
            />
          )
        })()}
      </div>
    </div>
  )
}
