import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'
import FileDropbox from './FileDropbox'
import { CONTRACTOR_FOLDER_PRESETS } from './NewProjectWizard'

function daysBetween(a, b) {
  if (!a || !b) return 0
  const ms = new Date(b) - new Date(a)
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)))
}

const ALL_FALLBACK_FOLDERS = CONTRACTOR_FOLDER_PRESETS.flatMap(p => p.folders)

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
  const [savingStage, setSavingStage] = useState(false)

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

  async function handleStageChange(newStage) {
    if (!project) return
    setSavingStage(true)
    let parsedFolders = {}
    try {
      parsedFolders = typeof project.folders === 'string' ? JSON.parse(project.folders) : (project.folders || {})
    } catch (_) {}

    parsedFolders.stage = newStage

    const { error } = await supabase
      .from('projects')
      .update({ folders: JSON.stringify(parsedFolders) })
      .eq('id', id)

    if (!error) {
      setProject(prev => ({ ...prev, folders: JSON.stringify(parsedFolders) }))
    }
    setSavingStage(false)
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#8a8578', background: '#f2f0ea', minHeight: '100vh' }}>
        Loading project details...
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

  // Extract all folders
  let projectFolders = []
  let currentStage = 'Bidding / Quotes'
  try {
    const cf = typeof project.folders === 'string' ? JSON.parse(project.folders) : project.folders
    if (cf) {
      if (cf.stage) currentStage = cf.stage
      if (Array.isArray(cf.all) && cf.all.length > 0) {
        projectFolders = cf.all
      } else {
        projectFolders = [
          ...(cf.fixed || []),
          ...(cf.clientFiles || []),
          ...(cf.projectFiles || []),
          ...(cf.expenses || [])
        ]
      }
    }
  } catch(e) {}

  if (projectFolders.length === 0) {
    projectFolders = ALL_FALLBACK_FOLDERS
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f2f0ea' }}>
      {/* Top bar */}
      <div style={{
        background: '#14202b', height: 72, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 2rem', position: 'sticky', top: 0, zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => navigate('/')}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => navigate('/safety-certs')}
            style={{
              background: '#233342', color: '#fff', border: '1px solid #374a5d',
              padding: '6px 12px', borderRadius: 4, fontSize: '0.8rem', cursor: 'pointer'
            }}
          >
            🦺 Staff Safety Library
          </button>
          <button
            onClick={() => navigate('/')}
            style={{
              background: '#e8590c', color: '#fff', border: 'none',
              padding: '6px 14px', borderRadius: 4, fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer'
            }}
          >
            ← Dashboard
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1140, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Project Header Card */}
        <div style={{
          background: '#ffffff',
          borderRadius: 8,
          padding: '1.5rem 1.8rem',
          marginBottom: '1.5rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          borderLeft: '5px solid #e8590c'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h1 style={{ fontSize: '1.6rem', color: '#14202b', margin: 0, fontWeight: 700 }}>
                  {project.name}
                </h1>
              </div>
              <p style={{ fontSize: '0.92rem', color: '#57544c', margin: '4px 0 0' }}>
                Client: <strong>{project.client}</strong>
                {project.assigned_client_email && (
                  <span style={{ color: '#8a8578', marginLeft: 8 }}>
                    (Portal: {project.assigned_client_email})
                  </span>
                )}
              </p>
            </div>

            {/* Stage Selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#8a8578', textTransform: 'uppercase' }}>
                Stage:
              </span>
              <select
                value={currentStage}
                onChange={e => handleStageChange(e.target.value)}
                disabled={savingStage}
                style={{
                  background: '#fafaf8',
                  border: '1px solid #d8d5cb',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#14202b',
                  cursor: 'pointer'
                }}
              >
                <option value="Bidding / Quotes">Bidding / Quotes</option>
                <option value="Awarded / Active">Awarded / Active</option>
                <option value="Completed / Invoicing">Completed / Invoicing</option>
                <option value="Closed / Archived">Closed / Archived</option>
              </select>
            </div>
          </div>
        </div>

        {/* Metric cards (if total planned is specified) */}
        {totalPlanned > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            {/* Completed so far */}
            <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: '0.75rem', color: '#8a8578', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
                Completed so far
              </p>
              <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1c1c1a', margin: 0 }}>
                {totalCompleted.toLocaleString()} <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#8a8578' }}>/ {totalPlanned.toLocaleString()} {project.unit || 'units'}</span>
              </p>
              <div style={{ width: '100%', height: 8, background: '#e8e6df', borderRadius: 4, marginTop: 10, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(percentComplete, 100)}%`, height: '100%', background: '#e8590c', borderRadius: 4, transition: 'width 0.3s' }} />
              </div>
              <p style={{ fontSize: '0.75rem', color: '#8a8578', marginTop: 6, margin: '6px 0 0' }}>
                {percentComplete.toFixed(1)}% of planned total
              </p>
            </div>

            {/* Daily rate */}
            <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: '0.75rem', color: '#8a8578', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
                Actual daily rate
              </p>
              <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1c1c1a', margin: 0 }}>
                {actualDailyRate > 0 ? actualDailyRate.toFixed(1) : '—'} <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#8a8578' }}>{project.unit || 'units'}/day</span>
              </p>
              <p style={{ fontSize: '0.75rem', color: '#8a8578', margin: '6px 0 0' }}>
                Over {elapsedDays} calendar day{elapsedDays !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Schedule / Pace */}
            <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: '0.75rem', color: '#8a8578', fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>
                Pace Status
              </p>
              <p style={{ fontSize: '1.35rem', fontWeight: 700, color: paceColor, margin: 0 }}>
                {actualDailyRate > 0 ? paceLabel : 'Pending logs'}
              </p>
              <p style={{ fontSize: '0.75rem', color: '#8a8578', margin: '6px 0 0' }}>
                Target: {targetDate || 'Flexible'}
              </p>
            </div>
          </div>
        )}

        {/* File Dropbox (Quotes, Submittals, Invoices, Safety, Photos, etc.) */}
        <FileDropbox
          projectId={id}
          folders={projectFolders}
        />

        {/* Daily Production Logging Section */}
        <div style={{
          background: '#ffffff',
          borderRadius: 8,
          padding: '1.5rem',
          marginTop: '2rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <h2 style={{ fontSize: '1.1rem', color: '#14202b', margin: '0 0 1rem', fontWeight: 700 }}>
            📊 Daily Quantity Log
          </h2>

          <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#57544c', marginBottom: 4 }}>Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                style={{ padding: '8px 10px', border: '1px solid #d4d0c8', borderRadius: 4, fontSize: '0.9rem', background: '#fafaf8' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#57544c', marginBottom: 4 }}>
                Quantity ({project.unit || 'units'})
              </label>
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="0"
                style={{ padding: '8px 10px', border: '1px solid #d4d0c8', borderRadius: 4, fontSize: '0.9rem', width: 140, background: '#fafaf8' }}
              />
            </div>
            <button
              type="submit"
              style={{
                background: '#e8590c', color: '#ffffff', border: 'none',
                padding: '8px 20px', borderRadius: 4, fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer'
              }}
            >
              + Add Entry
            </button>
          </form>

          {/* Entries Table */}
          {entries.length === 0 ? (
            <p style={{ color: '#8a8578', fontSize: '0.88rem', margin: 0 }}>No daily production entries recorded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e8e6df' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Date</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Quantity</th>
                    {canDelete && <th style={{ textAlign: 'center', padding: '8px 12px', color: '#8a8578', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <tr key={entry.id} style={{ borderBottom: i < entries.length - 1 ? '1px solid #f2f0ea' : 'none' }}>
                      <td style={{ padding: '10px 12px', color: '#1c1c1a' }}>{entry.date}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#1c1c1a', fontWeight: 600 }}>
                        {entry.quantity?.toLocaleString()} {project.unit || ''}
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

        {/* Client Access Credentials (Admin/Full/Limited) */}
        {canDelete && project.contacts && (() => {
          let parsed
          try { parsed = typeof project.contacts === 'string' ? JSON.parse(project.contacts) : project.contacts } catch(e) { parsed = null }
          const clientList = Array.isArray(parsed) ? parsed.filter(c => c.password) : []
          if (clientList.length === 0) return null
          return (
            <div style={{ background: '#ffffff', borderRadius: 8, padding: '1.5rem', marginTop: '1.5rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <h2 style={{ fontSize: '1rem', color: '#1c1c1a', marginBottom: '1rem' }}>
                Client Portal Passwords
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
      </div>
    </div>
  )
}
