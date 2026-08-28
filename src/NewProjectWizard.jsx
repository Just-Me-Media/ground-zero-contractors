import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

// Standard contractor folder presets tailored to GZCI civil & environmental remediation
export const CONTRACTOR_FOLDER_PRESETS = [
  {
    category: 'Quotes & Bidding',
    icon: '📊',
    folders: ['Quotes', 'Revised Quotes', 'Excel Quotes & Takeoffs']
  },
  {
    category: 'Tenders & Submittals',
    icon: '📑',
    folders: ['Tender Documents', 'Submittals', 'References']
  },
  {
    category: 'Correspondence',
    icon: '✉️',
    folders: ['Emails & Correspondence', 'Meeting Minutes']
  },
  {
    category: 'Contracts & Approvals',
    icon: '📝',
    folders: ['Contracts', 'Signed Documents', 'Change Orders']
  },
  {
    category: 'Safety & Compliance',
    icon: '🦺',
    folders: ['Safety Documents', 'Daily Safety Talks', 'Machine Inspections', 'Staff Certifications']
  },
  {
    category: 'Work Orders & Field',
    icon: '📋',
    folders: ['Work Orders', 'Daily Field Reports']
  },
  {
    category: 'Invoices & Billing',
    icon: '💰',
    folders: ['Invoices', 'Receipts & Expenses']
  },
  {
    category: 'Locates & Photos',
    icon: '📍',
    folders: ['Locates & Clearances', 'Site Photos']
  },
  {
    category: 'Engineering & Drawings',
    icon: '📐',
    folders: ['Drawings', 'Specs', 'As-Builts', 'Survey & Geotechnical Reports']
  },
  {
    category: 'Equipment & Rentals',
    icon: '🚜',
    folders: ['Equipment Rentals', 'Fuel & Maintenance']
  },
  {
    category: 'Client Files (Portal)',
    icon: '👥',
    folders: ['Client Shared Files', 'Permits', 'Client Change Orders']
  }
]

// All default folders enabled out-of-the-box
const ALL_DEFAULT_FOLDERS = CONTRACTOR_FOLDER_PRESETS.flatMap(p => p.folders)

export default function NewProjectWizard() {
  const { userRole } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState(null)

  // Step 1: Project Details
  const [projectName, setProjectName] = useState('')
  const [clientName, setClientName] = useState('')
  const [projectStage, setProjectStage] = useState('Bidding / Quotes')
  const [unit, setUnit] = useState('units')
  const [totalPlanned, setTotalPlanned] = useState('')
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10))
  const [targetDate, setTargetDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  )
  const [assignedClientEmail, setAssignedClientEmail] = useState('')

  // Step 2: Client Contacts
  const [contacts, setContacts] = useState([{ name: '', email: '', password: '' }])

  // Step 3: Selected Folders
  const [selectedFolders, setSelectedFolders] = useState(ALL_DEFAULT_FOLDERS)
  const [customFolderInput, setCustomFolderInput] = useState('')

  // Created Result State
  const [createdResult, setCreatedResult] = useState(null)

  function updateContact(i, field, value) {
    setContacts(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: value } : c))
  }

  function addContact() {
    setContacts(prev => [...prev, { name: '', email: '', password: '' }])
  }

  function removeContact(i) {
    setContacts(prev => prev.filter((_, idx) => idx !== i))
  }

  function toggleFolder(folderName) {
    setSelectedFolders(prev =>
      prev.includes(folderName)
        ? prev.filter(f => f !== folderName)
        : [...prev, folderName]
    )
  }

  function toggleCategoryAll(categoryFolders) {
    const allSelected = categoryFolders.every(f => selectedFolders.includes(f))
    if (allSelected) {
      setSelectedFolders(prev => prev.filter(f => !categoryFolders.includes(f)))
    } else {
      setSelectedFolders(prev => [...new Set([...prev, ...categoryFolders])])
    }
  }

  function addCustomFolder() {
    const name = customFolderInput.trim()
    if (name && !selectedFolders.includes(name)) {
      setSelectedFolders(prev => [...prev, name])
    }
    setCustomFolderInput('')
  }

  async function handleCreate() {
    setSubmitting(true)
    setErrorMessage(null)

    // Build safe defaults to strictly satisfy PostgreSQL NOT NULL constraints
    const safeStartDate = startDate || new Date().toISOString().slice(0, 10)
    const safeTargetDate = targetDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const safeTotalPlanned = totalPlanned && !isNaN(parseFloat(totalPlanned)) ? parseFloat(totalPlanned) : 0

    const validContacts = contacts.filter(c => c.name.trim() || c.email.trim())
    const clientEmails = validContacts.filter(c => c.email.trim()).map(c => c.email.trim())

    const foldersPayload = {
      all: selectedFolders.length > 0 ? selectedFolders : ALL_DEFAULT_FOLDERS,
      stage: projectStage,
      created_at: new Date().toISOString()
    }

    try {
      // 1. Insert into Supabase projects table
      const { data, error } = await supabase.from('projects').insert({
        name: projectName.trim(),
        client: clientName.trim(),
        unit: unit || 'units',
        total_planned: safeTotalPlanned,
        start_date: safeStartDate,
        target_date: safeTargetDate,
        contacts: JSON.stringify(validContacts),
        folders: JSON.stringify(foldersPayload),
        assigned_client_email: clientEmails[0] || assignedClientEmail || null
      }).select().single()

      if (error) {
        console.error('Supabase project creation error:', error)
        setErrorMessage(`Project creation failed: ${error.message || 'Database error'}`)
        setSubmitting(false)
        return
      }

      if (!data) {
        setErrorMessage('No project record was returned by the server.')
        setSubmitting(false)
        return
      }

      // 2. Auto-create client Auth accounts if provided
      const createdClients = []
      for (const contact of validContacts) {
        if (contact.email && contact.email.trim()) {
          try {
            const pwd = contact.password || 'PeterSabota'
            const res = await fetch('/api/create-client', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: contact.email.trim(), name: contact.name, password: pwd })
            })
            if (res.ok) {
              const result = await res.json()
              if (result.id || result.exists) {
                createdClients.push({ email: contact.email.trim(), password: pwd })
              }
            }
          } catch (e) {
            console.warn('Optional client auth creation error:', e)
          }
        }
      }

      setSubmitting(false)
      setCreatedResult({ projectId: data.id, clients: createdClients })
    } catch (err) {
      console.error('Unexpected error creating project:', err)
      setErrorMessage(`Unexpected error: ${err.message || 'Connection failed'}`)
      setSubmitting(false)
    }
  }

  const canProceedStep1 = projectName.trim().length > 0 && clientName.trim().length > 0

  if (createdResult) {
    return (
      <div style={styles.app}>
        <div style={styles.topbar}>
          <div style={styles.brandMark}>GZ</div>
          <div style={styles.brandName}>Project Created Successfully</div>
        </div>
        <div style={styles.body}>
          <div style={{ background: '#2b8a3e', color: '#fff', borderRadius: 8, padding: '16px 20px', marginBottom: 20, fontWeight: 600, fontSize: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>✓</span>
            <div>
              <div style={{ fontWeight: 700 }}>{projectName} is live!</div>
              <div style={{ fontSize: 13, fontWeight: 400, opacity: 0.9 }}>Client: {clientName} • Stage: {projectStage}</div>
            </div>
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Client Login Credentials</div>
            {createdResult.clients.length === 0 ? (
              <div style={styles.summaryRowMuted}>No client portal credentials configured. You can add client access anytime later.</div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: '#c92a2a', fontWeight: 600, marginBottom: 10 }}>
                  SAVE THESE PASSWORDS NOW. Share with your client for portal access.
                </p>
                {createdResult.clients.map((c, i) => (
                  <div key={i} style={{ background: '#fff4e5', border: '1px solid #f0997b', borderRadius: 6, padding: '10px 14px', marginBottom: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{c.email}</div>
                    <div style={{ fontSize: 15, color: '#a8380d', fontWeight: 700, letterSpacing: 0.5 }}>Password: {c.password}</div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div style={styles.summaryCard}>
            <div style={styles.summaryLabel}>Folders Ready for Drag &amp; Drop ({selectedFolders.length})</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {selectedFolders.map(f => (
                <span key={f} style={{ background: '#f2f0ea', border: '1px solid #d8d5cb', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
                  📁 {f}
                </span>
              ))}
            </div>
          </div>

          <button style={styles.primaryBtn} onClick={() => navigate(`/project/${createdResult.projectId}`)}>
            Open Project &amp; Start Uploading Files →
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.app}>
      <div style={styles.topbar}>
        <div style={styles.brandMark}>GZ</div>
        <div style={styles.brandName}>New Project &amp; Quote Setup</div>
        <button onClick={() => navigate('/')} style={styles.cancelBtn}>Cancel</button>
      </div>

      <div style={styles.stepIndicator}>
        <div style={{ ...styles.stepDot, ...(step >= 1 ? styles.stepDotActive : {}) }}>1</div>
        <div style={{ ...styles.stepLine, ...(step >= 2 ? styles.stepLineActive : {}) }} />
        <div style={{ ...styles.stepDot, ...(step >= 2 ? styles.stepDotActive : {}) }}>2</div>
        <div style={{ ...styles.stepLine, ...(step >= 3 ? styles.stepLineActive : {}) }} />
        <div style={{ ...styles.stepDot, ...(step >= 3 ? styles.stepDotActive : {}) }}>3</div>
        <div style={{ ...styles.stepLine, ...(step >= 4 ? styles.stepLineActive : {}) }} />
        <div style={{ ...styles.stepDot, ...(step >= 4 ? styles.stepDotActive : {}) }}>4</div>
      </div>

      <div style={styles.body}>
        {errorMessage && (
          <div style={styles.errorBanner}>
            ⚠️ {errorMessage}
          </div>
        )}

        {/* STEP 1: Project Details */}
        {step === 1 && (
          <>
            <h2 style={styles.stepTitle}>Project &amp; Client Details</h2>
            <p style={styles.stepSub}>Enter the job name or quote title to organize it on your dashboard.</p>

            <label style={styles.label}>Project / Job Name *</label>
            <input
              style={styles.input}
              placeholder="e.g. Tank 409 Remediation or Hwy 7 Civil"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              autoFocus
            />

            <label style={styles.label}>Client Name *</label>
            <input
              style={styles.input}
              placeholder="e.g. Suncor, Enbridge, or General Contractor"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
            />

            <label style={styles.label}>Project Stage</label>
            <select
              value={projectStage}
              onChange={e => setProjectStage(e.target.value)}
              style={styles.input}
            >
              <option value="Bidding / Quotes">Bidding / Quotes (Preparing estimate or tender)</option>
              <option value="Awarded / Active">Awarded / Active (Work in progress)</option>
              <option value="Completed / Invoicing">Completed / Invoicing (Job done, collecting invoices)</option>
              <option value="Closed / Archived">Closed / Archived</option>
            </select>

            <div style={styles.divider} />

            <h3 style={styles.sectionTitle}>Production &amp; Timeline (Optional)</h3>
            <p style={styles.stepSub}>You can fill this in now or update it anytime later.</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={styles.label}>Tracking Unit</label>
                <select value={unit} onChange={e => setUnit(e.target.value)} style={styles.input}>
                  <option value="units">units</option>
                  <option value="m³">m³ (cubic meters)</option>
                  <option value="tonnes">tonnes</option>
                  <option value="sq ft">sq ft</option>
                  <option value="lin ft">lin ft</option>
                  <option value="hours">hours</option>
                  <option value="loads">loads</option>
                  <option value="each">each</option>
                </select>
              </div>

              <div>
                <label style={styles.label}>Total Planned Qty</label>
                <input
                  type="number"
                  style={styles.input}
                  placeholder="e.g. 5000"
                  value={totalPlanned}
                  onChange={e => setTotalPlanned(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={styles.label}>Start Date</label>
                <input
                  type="date"
                  style={styles.input}
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label style={styles.label}>Target Completion</label>
                <input
                  type="date"
                  style={styles.input}
                  value={targetDate}
                  onChange={e => setTargetDate(e.target.value)}
                />
              </div>
            </div>

            <button
              style={{ ...styles.primaryBtn, ...(!canProceedStep1 ? styles.disabledBtn : {}) }}
              disabled={!canProceedStep1}
              onClick={() => { setErrorMessage(null); setStep(2); }}
            >
              Next: Client Contacts →
            </button>
          </>
        )}

        {/* STEP 2: Client Contacts */}
        {step === 2 && (
          <>
            <h2 style={styles.stepTitle}>Client Contacts &amp; Portal Access</h2>
            <p style={styles.stepSub}>Optional. Add contacts if you want the client to log in and see their specific project files.</p>

            {contacts.map((c, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #d8d5cb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#8a8578', textTransform: 'uppercase' }}>Contact #{i + 1}</span>
                  {contacts.length > 1 && (
                    <button style={styles.removeBtn} onClick={() => removeContact(i)}>Remove</button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input
                    style={styles.input}
                    placeholder="Full Name (e.g. John Doe)"
                    value={c.name}
                    onChange={e => updateContact(i, 'name', e.target.value)}
                  />
                  <input
                    style={styles.input}
                    placeholder="Email Address"
                    value={c.email}
                    onChange={e => updateContact(i, 'email', e.target.value)}
                  />
                </div>
                <input
                  style={{ ...styles.input, marginTop: 6 }}
                  placeholder="Set Initial Password (defaults to PeterSabota)"
                  type="text"
                  value={c.password}
                  onChange={e => updateContact(i, 'password', e.target.value)}
                />
              </div>
            ))}

            <button style={styles.secondaryBtn} onClick={addContact}>+ Add Another Contact</button>

            <div style={styles.stepButtons}>
              <button style={styles.secondaryBtn} onClick={() => { setErrorMessage(null); setStep(1); }}>← Back</button>
              <button style={styles.primaryBtn} onClick={() => { setErrorMessage(null); setStep(3); }}>Next: Folders Setup →</button>
            </div>
          </>
        )}

        {/* STEP 3: Folders Setup */}
        {step === 3 && (
          <>
            <h2 style={styles.stepTitle}>Project Folder Structure</h2>
            <p style={styles.stepSub}>
              We have pre-configured industry standard folders for quotes, submittals, safety docs, work orders, locates, and invoices. Click to toggle or add custom folders.
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#57544c' }}>
                {selectedFolders.length} Folders Selected
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ fontSize: 12, color: '#e8590c', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setSelectedFolders(ALL_DEFAULT_FOLDERS)}
                >
                  Select All Defaults
                </button>
                <span style={{ color: '#d8d5cb' }}>|</span>
                <button
                  style={{ fontSize: 12, color: '#8a8578', background: 'none', border: 'none', cursor: 'pointer' }}
                  onClick={() => setSelectedFolders([])}
                >
                  Clear All
                </button>
              </div>
            </div>

            {/* Category Groups */}
            {CONTRACTOR_FOLDER_PRESETS.map((cat, idx) => (
              <div key={idx} style={{ background: '#fff', border: '1px solid #e2ded2', borderRadius: 8, padding: '12px 14px', marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#1c1c1a', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{cat.icon}</span> {cat.category}
                  </div>
                  <button
                    style={{ fontSize: 11, color: '#8a8578', background: 'none', border: 'none', cursor: 'pointer' }}
                    onClick={() => toggleCategoryAll(cat.folders)}
                  >
                    Toggle All
                  </button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {cat.folders.map(fName => {
                    const isSelected = selectedFolders.includes(fName)
                    return (
                      <button
                        key={fName}
                        style={{ ...styles.chip, ...(isSelected ? styles.chipActive : {}) }}
                        onClick={() => toggleFolder(fName)}
                      >
                        {isSelected ? '✓ ' : '+ '}{fName}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Custom Folder Input */}
            <div style={{ marginTop: 16 }}>
              <label style={styles.label}>Add Custom Folder</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  style={{ ...styles.input, marginBottom: 0, flex: 1 }}
                  placeholder="e.g. Environmental Soil Tests"
                  value={customFolderInput}
                  onChange={e => setCustomFolderInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustomFolder()}
                />
                <button style={styles.secondaryBtn} onClick={addCustomFolder}>+ Add Folder</button>
              </div>
            </div>

            <div style={styles.stepButtons}>
              <button style={styles.secondaryBtn} onClick={() => { setErrorMessage(null); setStep(2); }}>← Back</button>
              <button style={styles.primaryBtn} onClick={() => { setErrorMessage(null); setStep(4); }}>Next: Review &amp; Create →</button>
            </div>
          </>
        )}

        {/* STEP 4: Review and Create */}
        {step === 4 && (
          <>
            <h2 style={styles.stepTitle}>Review &amp; Create Project</h2>
            <p style={styles.stepSub}>Review your setup below and click create to initialize the project and folders.</p>

            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Project Information</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#1c1c1a' }}>{projectName}</div>
              <div style={styles.summaryRowMuted}>Client: <strong>{clientName}</strong></div>
              <div style={{ ...styles.summaryRowMuted, marginTop: 4 }}>
                Stage: <span style={{ background: '#fde4d3', color: '#a8380d', fontWeight: 600, padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>{projectStage}</span>
              </div>
            </div>

            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Folders ({selectedFolders.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                {selectedFolders.map(f => (
                  <span key={f} style={{ background: '#f2f0ea', border: '1px solid #d8d5cb', borderRadius: 4, padding: '3px 8px', fontSize: 12 }}>
                    📁 {f}
                  </span>
                ))}
              </div>
            </div>

            <div style={styles.summaryCard}>
              <div style={styles.summaryLabel}>Tracking &amp; Schedule</div>
              <div style={styles.summaryRow}>
                Target: {totalPlanned ? `${totalPlanned} ${unit}` : 'Not set (tracking as needed)'}
              </div>
              <div style={styles.summaryRowMuted}>
                Timeline: {startDate} → {targetDate}
              </div>
            </div>

            {contacts.filter(c => c.name || c.email).length > 0 && (
              <div style={styles.summaryCard}>
                <div style={styles.summaryLabel}>Client Access</div>
                {contacts.filter(c => c.name || c.email).map((c, i) => (
                  <div key={i} style={styles.summaryRow}>
                    👤 {c.name || 'Unnamed'} ({c.email || 'No email'})
                  </div>
                ))}
              </div>
            )}

            <div style={styles.stepButtons}>
              <button style={styles.secondaryBtn} onClick={() => setStep(3)} disabled={submitting}>
                ← Back
              </button>
              <button
                style={{ ...styles.primaryBtn, flex: 2 }}
                onClick={handleCreate}
                disabled={submitting}
              >
                {submitting ? 'Creating Project &amp; Folders...' : '✓ Create Project'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles = {
  app: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    color: '#1c1c1a',
    background: '#f2f0ea',
    minHeight: '100vh',
    maxWidth: 680,
    margin: '0 auto',
    paddingBottom: 40
  },
  topbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '16px 24px',
    background: '#14202b',
    color: '#fff',
  },
  brandMark: {
    width: 34,
    height: 34,
    background: '#e8590c',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 800,
    fontSize: 14,
    borderRadius: 4
  },
  brandName: { fontWeight: 600, fontSize: 16, flex: 1 },
  cancelBtn: {
    background: 'transparent',
    color: '#c0c0c0',
    border: '1px solid #555',
    padding: '6px 14px',
    borderRadius: 4,
    fontSize: '0.8rem',
    cursor: 'pointer'
  },
  stepIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '20px 0 8px',
    background: '#f2f0ea',
  },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: '#e2ded2',
    color: '#8a8578',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
  stepDotActive: {
    background: '#e8590c',
    color: '#fff'
  },
  stepLine: {
    width: 44,
    height: 2,
    background: '#e2ded2'
  },
  stepLineActive: {
    background: '#e8590c'
  },
  body: {
    padding: '20px 24px 32px',
    background: '#f2f0ea'
  },
  stepTitle: {
    fontSize: 20,
    fontWeight: 700,
    margin: '0 0 6px',
    color: '#14202b'
  },
  stepSub: {
    fontSize: 13,
    color: '#6e6e66',
    margin: '0 0 18px',
    lineHeight: 1.4
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 600,
    margin: '0 0 4px',
    color: '#14202b'
  },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 6,
    marginTop: 12,
    color: '#57544c',
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid #d8d5cb',
    borderRadius: 6,
    boxSizing: 'border-box',
    background: '#ffffff',
    color: '#1c1c1a',
    outline: 'none',
  },
  chip: {
    fontSize: 12,
    padding: '6px 12px',
    borderRadius: 16,
    border: '1px solid #d8d5cb',
    background: '#fafaf8',
    color: '#57544c',
    cursor: 'pointer',
    transition: 'all 0.15s ease'
  },
  chipActive: {
    background: '#fde4d3',
    borderColor: '#e8590c',
    color: '#a8380d',
    fontWeight: 600,
  },
  removeBtn: {
    fontSize: 11,
    color: '#c92a2a',
    background: 'none',
    border: '1px solid #ffc9c9',
    borderRadius: 4,
    padding: '4px 8px',
    cursor: 'pointer'
  },
  primaryBtn: {
    background: '#e8590c',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 20,
    textAlign: 'center'
  },
  disabledBtn: {
    background: '#e2ded2',
    color: '#a8a498',
    cursor: 'not-allowed'
  },
  secondaryBtn: {
    background: '#fff',
    color: '#57544c',
    border: '1px solid #d8d5cb',
    borderRadius: 6,
    padding: '10px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  stepButtons: {
    display: 'flex',
    gap: 12,
    marginTop: 24
  },
  divider: {
    borderTop: '1px solid #e2ded2',
    margin: '22px 0 18px'
  },
  summaryCard: {
    background: '#fff',
    border: '1px solid #e2ded2',
    borderRadius: 8,
    padding: '14px 16px',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#8a8578',
    fontWeight: 700,
    marginBottom: 6,
  },
  summaryRow: {
    fontSize: 14,
    padding: '3px 0',
    color: '#1c1c1a'
  },
  summaryRowMuted: {
    fontSize: 13,
    color: '#6e6e66',
    padding: '2px 0'
  },
  errorBanner: {
    background: '#ffe3e3',
    border: '1px solid #ffa8a8',
    color: '#c92a2a',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 16
  }
}
