import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from './supabase'

// Plain-English categories with emoji so Peter can scan, not read
const CATEGORIES = [
  { name: 'Labour', emoji: '👷' },
  { name: 'Subs', emoji: '🤝' },
  { name: 'Machines', emoji: '🚜' },
  { name: 'Fuel', emoji: '⛽' },
  { name: 'Materials In', emoji: '📦' },
  { name: 'Materials Out / Disposal', emoji: '🚛' },
  { name: 'Consumables', emoji: '🧰' },
  { name: 'Accommodations / Meals', emoji: '🍔' },
  { name: 'Meetings', emoji: '📋' },
  { name: 'Overhead', emoji: '🏢' },
  { name: 'Contingency', emoji: '🛟' },
  { name: 'Other', emoji: '📁' },
]
const catEmoji = name => (CATEGORIES.find(c => c.name === name) || {}).emoji || '📁'

const money = n =>
  (Number(n) || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
const moneyExact = n =>
  (Number(n) || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 })
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n }

function uid() { return 'local-' + Math.random().toString(36).slice(2, 10) }
function lsKey(pid, table) { return `gz-costing-${table}-${pid}` }
function lsLoad(pid, table) {
  try { return JSON.parse(localStorage.getItem(lsKey(pid, table)) || '[]') } catch { return [] }
}
function lsSave(pid, table, rows) {
  try { localStorage.setItem(lsKey(pid, table), JSON.stringify(rows)) } catch {}
}

const SEED = [
  { category: 'Labour', item: 'Crew — foreman + operators', qty: 10, unit: 'days', unit_cost: 2400, unit_billable: 3200, contingency_pct: 5, notes: '' },
  { category: 'Subs', item: 'Sub — trucking / hydrovac', qty: 1, unit: 'lump', unit_cost: 8000, unit_billable: 10000, contingency_pct: 5, notes: '' },
  { category: 'Machines', item: 'Excavator + rolloff truck', qty: 10, unit: 'days', unit_cost: 950, unit_billable: 1400, contingency_pct: 5, notes: 'Truck sitting there anyway + driver billed per hour' },
  { category: 'Fuel', item: 'Diesel — machines + trucks', qty: 1000, unit: 'L', unit_cost: 1.65, unit_billable: 1.95, contingency_pct: 10, notes: 'Price changes daily — crew logs it each day' },
  { category: 'Materials In', item: 'Gravel / bedding coming in', qty: 200, unit: 'tonnes', unit_cost: 28, unit_billable: 38, contingency_pct: 5, notes: '' },
  { category: 'Materials Out / Disposal', item: 'Dirt out / water disposal', qty: 300, unit: 'tonnes', unit_cost: 45, unit_billable: 65, contingency_pct: 10, notes: '' },
  { category: 'Consumables', item: 'Parts, filters, small stuff', qty: 1, unit: 'lump', unit_cost: 1500, unit_billable: 1800, contingency_pct: 10, notes: '' },
  { category: 'Accommodations / Meals', item: 'Hotel + food for crew', qty: 10, unit: 'days', unit_cost: 400, unit_billable: 400, contingency_pct: 0, notes: 'Just tracked, not marked up — keep receipts' },
  { category: 'Meetings', item: 'Meetings / supervision', qty: 8, unit: 'hrs', unit_cost: 125, unit_billable: 150, contingency_pct: 0, notes: '' },
  { category: 'Overhead', item: 'Office, insurance, safety', qty: 1, unit: 'lump', unit_cost: 2500, unit_billable: 3000, contingency_pct: 0, notes: '' },
]

const PCT_STEPS = [
  { label: 'Not started', value: 0 },
  { label: '¼ done', value: 25 },
  { label: '½ done', value: 50 },
  { label: '¾ done', value: 75 },
  { label: 'Done ✅', value: 100 },
]

export default function JobCosting() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [project, setProject] = useState(null)
  const [tab, setTab] = useState('where') // Peter opens here. Always.
  const [bidItems, setBidItems] = useState([])
  const [costs, setCosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [useLocal, setUseLocal] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)

  // Bid form — plain English, one thing per line
  const [bForm, setBForm] = useState({ category: 'Labour', item: '', qty: '', unit: 'days', unit_cost: '', unit_billable: '', notes: '' })
  const [editingBid, setEditingBid] = useState(null)
  const [showBidForm, setShowBidForm] = useState(false)

  // Daily form — crew uses this, not Peter (proper qty/rate/hours entry)
  const today = new Date().toISOString().slice(0, 10)
  const [dForm, setDForm] = useState({ date: today, bid_item_id: '', description: '', qty: '', unit: 'loads', rate: '', total: '', hours: '', receipt_notes: '' })
  const [lastLogged, setLastLogged] = useState(null)

  // Share outputs (Peter)
  const [copied, setCopied] = useState(false)

  // Papers (bid docs, contract, invoices) — same storage bucket as the file vault
  const DOC_FOLDERS = ['Bid documents', 'Contract', 'Invoices & receipts']
  const [docFolder, setDocFolder] = useState(DOC_FOLDERS[0])
  const [docFiles, setDocFiles] = useState([])
  const [docLoading, setDocLoading] = useState(false)
  const [docUploading, setDocUploading] = useState(false)
  const [docError, setDocError] = useState(null)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const { data: proj } = await supabase.from('projects').select('*').eq('id', id).single()
    if (proj) setProject(proj)
    try {
      const { data: bids, error: e1 } = await supabase.from('bid_items').select('*').eq('project_id', id).order('sort_order')
      const { data: ents, error: e2 } = await supabase.from('cost_entries').select('*').eq('project_id', id).order('date', { ascending: false })
      if (e1 || e2) throw e1 || e2
      setBidItems(bids || [])
      setCosts(ents || [])
      setUseLocal(false)
    } catch {
      setBidItems(lsLoad(id, 'bid_items'))
      setCosts(lsLoad(id, 'cost_entries'))
      setUseLocal(true)
    }
    setLoading(false)
  }

  async function persistBid(rows) { setBidItems(rows); if (useLocal) lsSave(id, 'bid_items', rows) }
  async function persistCosts(rows) { setCosts(rows); if (useLocal) lsSave(id, 'cost_entries', rows) }

  // ---------- MATH (same as before, just hidden from Peter) ----------
  const bidTotals = useMemo(() => {
    let cost = 0, bill = 0
    bidItems.forEach(b => { cost += num(b.qty) * num(b.unit_cost); bill += num(b.qty) * num(b.unit_billable) })
    return { cost, bill, margin: bill - cost }
  }, [bidItems])

  const actualByBid = useMemo(() => {
    const m = {}
    costs.forEach(c => {
      const key = c.bid_item_id || 'unlinked'
      if (!m[key]) m[key] = 0
      m[key] += num(c.qty) * num(c.unit_actual)
    })
    return m
  }, [costs])

  const totalActual = useMemo(() => costs.reduce((s, c) => s + num(c.qty) * num(c.unit_actual), 0), [costs])
  const earned = useMemo(() => bidItems.reduce((s, b) =>
    s + num(b.qty) * num(b.unit_billable) * (num(b.pct_complete) / 100), 0), [bidItems])
  const overallPct = bidTotals.bill > 0 ? (earned / bidTotals.bill) * 100 : 0
  const remaining = useMemo(() => bidItems.reduce((s, b) =>
    s + num(b.qty) * num(b.unit_cost) * (1 - num(b.pct_complete) / 100), 0), [bidItems])
  const forecastCost = totalActual + remaining
  const forecastProfit = bidTotals.bill - forecastCost
  const daysWithCosts = useMemo(() => new Set(costs.map(c => c.date)).size, [costs])

  const weekDays = useMemo(() => {
    const base = new Date()
    base.setDate(base.getDate() + weekOffset * 7)
    const dow = (base.getDay() + 6) % 7
    const mon = new Date(base); mon.setDate(base.getDate() - dow)
    return [0, 1, 2, 3, 4].map(i => {
      const d = new Date(mon); d.setDate(mon.getDate() + i)
      const iso = d.toISOString().slice(0, 10)
      const dayTotal = costs.filter(c => c.date === iso).reduce((s, c) => s + num(c.qty) * num(c.unit_actual), 0)
      const isToday = iso === today
      return {
        iso, isToday,
        label: d.toLocaleDateString('en-CA', { weekday: 'long' }),
        short: d.toLocaleDateString('en-CA', { weekday: 'short' }),
        day: d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
        total: dayTotal,
      }
    })
  }, [costs, weekOffset, today])
  const weekTotal = weekDays.reduce((s, d) => s + d.total, 0)

  // ---------- ACTIONS ----------
  async function saveBid(e) {
    e.preventDefault()
    if (!bForm.item.trim()) return
    const row = {
      project_id: id,
      category: bForm.category,
      item: bForm.item.trim(),
      qty: num(bForm.qty) || 1,
      unit: bForm.unit || '',
      unit_cost: num(bForm.unit_cost),
      unit_billable: num(bForm.unit_billable) || num(bForm.unit_cost),
      contingency_pct: 5,
      notes: bForm.notes || '',
      sort_order: editingBid ? editingBid.sort_order : bidItems.length,
      pct_complete: editingBid ? (editingBid.pct_complete || 0) : 0,
    }
    if (useLocal) {
      if (editingBid) persistBid(bidItems.map(b => b.id === editingBid.id ? { ...b, ...row } : b))
      else persistBid([...bidItems, { ...row, id: uid() }])
    } else {
      if (editingBid) {
        const { data } = await supabase.from('bid_items').update(row).eq('id', editingBid.id).select().single()
        if (data) setBidItems(prev => prev.map(b => b.id === editingBid.id ? data : b))
      } else {
        const { data } = await supabase.from('bid_items').insert(row).select().single()
        if (data) setBidItems(prev => [...prev, data])
      }
    }
    setBForm({ category: 'Labour', item: '', qty: '', unit: 'days', unit_cost: '', unit_billable: '', notes: '' })
    setEditingBid(null)
    setShowBidForm(false)
  }

  async function deleteBid(bidId) {
    if (!window.confirm('Remove this line from the bid?')) return
    if (useLocal) persistBid(bidItems.filter(b => b.id !== bidId))
    else {
      await supabase.from('bid_items').delete().eq('id', bidId)
      setBidItems(prev => prev.filter(b => b.id !== bidId))
    }
  }

  function startEdit(b) {
    setEditingBid(b)
    setBForm({
      category: b.category, item: b.item,
      qty: String(b.qty ?? ''), unit: b.unit || 'days',
      unit_cost: String(b.unit_cost ?? ''), unit_billable: String(b.unit_billable ?? ''),
      notes: b.notes || ''
    })
    setShowBidForm(true)
    setTab('bid')
  }

  async function setPct(bidId, pct) {
    if (useLocal) persistBid(bidItems.map(b => b.id === bidId ? { ...b, pct_complete: pct } : b))
    else {
      await supabase.from('bid_items').update({ pct_complete: pct }).eq('id', bidId)
      setBidItems(prev => prev.map(b => b.id === bidId ? { ...b, pct_complete: pct } : b))
    }
  }

  async function seedTemplate() {
    if (bidItems.length > 0 && !window.confirm('Add the normal job list to what you already have?')) return
    const rows = SEED.map((s, i) => ({ ...s, project_id: id, sort_order: bidItems.length + i, pct_complete: 0 }))
    if (useLocal) persistBid([...bidItems, ...rows.map(r => ({ ...r, id: uid() }))])
    else {
      const { data } = await supabase.from('bid_items').insert(rows).select()
      if (data) setBidItems(prev => [...prev, ...data])
    }
  }

  // Crew daily entry: qty × rate, or a flat receipt total — whichever they know
  function dailyLineTotal() {
    if (num(dForm.qty) && num(dForm.rate)) return num(dForm.qty) * num(dForm.rate)
    return num(dForm.total)
  }

  async function saveDaily(e) {
    e.preventDefault()
    const lineTotal = dailyLineTotal()
    if (!dForm.date || !dForm.description.trim() || !lineTotal) return
    const linked = bidItems.find(b => String(b.id) === String(dForm.bid_item_id))
    const useRate = num(dForm.qty) && num(dForm.rate)
    const row = {
      project_id: id,
      date: dForm.date,
      bid_item_id: dForm.bid_item_id || null,
      category: linked ? linked.category : 'Other',
      description: dForm.description.trim(),
      qty: useRate ? num(dForm.qty) : 1,
      unit: useRate ? (dForm.unit || '') : '',
      unit_actual: useRate ? num(dForm.rate) : lineTotal,
      hours: num(dForm.hours),
      receipt_notes: dForm.receipt_notes || '',
    }
    if (useLocal) persistCosts([{ ...row, id: uid() }, ...costs])
    else {
      const { data } = await supabase.from('cost_entries').insert(row).select().single()
      if (data) setCosts(prev => [data, ...prev])
    }
    setLastLogged({ when: new Date(), text: `${dForm.description.trim()} — ${money(lineTotal)} on ${dForm.date}` })
    // Keep day + bid line for fast multi-line entry, clear the rest
    setDForm(f => ({ ...f, description: '', qty: '', rate: '', total: '', hours: '', receipt_notes: '' }))
  }

  async function deleteCost(costId) {
    if (!window.confirm('Delete this spending entry?')) return
    if (useLocal) persistCosts(costs.filter(c => c.id !== costId))
    else {
      await supabase.from('cost_entries').delete().eq('id', costId)
      setCosts(prev => prev.filter(c => c.id !== costId))
    }
  }

  // ---------- SHARE OUTPUTS (Peter: copy / email / text / print / CSV) ----------
  const dayName = iso => {
    try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' }) } catch { return iso }
  }

  function buildSummary() {
    const name = project?.name || 'Job'
    const lines = []
    lines.push(`${name} — job update (${new Date().toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' })})`)
    lines.push(`Bid: ${money(bidTotals.bill)} | Spent so far: ${money(totalActual)} | Job ${Math.round(overallPct)}% done`)
    lines.push(totalActual === 0
      ? 'No spending logged yet.'
      : winning ? `✅ WINNING — on track to keep ${money(forecastProfit)}.` : `🚨 LOSING — on track to lose ${money(Math.abs(forecastProfit))}.`)
    lines.push('')
    lines.push('This week (Mon–Fri):')
    weekDays.forEach(d => lines.push(`  ${d.label}: ${d.total > 0 ? money(d.total) : '—'}`))
    lines.push(`  Week total: ${money(weekTotal)}`)
    const over = [], under = []
    bidItems.forEach(b => {
      const bidCost = num(b.qty) * num(b.unit_cost)
      const spent = actualByBid[String(b.id)] || 0
      if (spent <= 0) return
      const diff = bidCost - spent
      if (diff < 0) over.push(`${b.item}: over by ${money(Math.abs(diff))} (bid ${money(bidCost)}, spent ${money(spent)}, ${num(b.pct_complete)}% done)`)
      else under.push(`${b.item}: under by ${money(diff)} (bid ${money(bidCost)}, spent ${money(spent)}, ${num(b.pct_complete)}% done)`)
    })
    if (over.length) { lines.push(''); lines.push('Over budget:'); over.forEach(o => lines.push('  ⚠️ ' + o)) }
    if (under.length) { lines.push(''); lines.push('Under budget:'); under.forEach(u => lines.push('  👍 ' + u)) }
    return lines.join('\n')
  }

  function buildCSV() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out = []
    out.push('BID LINES')
    out.push(['Item', 'Category', 'Qty', 'Unit', 'Unit cost', 'Unit billable', 'Bid cost', 'Bid price', '% done'].map(esc).join(','))
    bidItems.forEach(b => out.push([
      b.item, b.category, b.qty, b.unit || '', b.unit_cost, b.unit_billable,
      num(b.qty) * num(b.unit_cost), num(b.qty) * num(b.unit_billable), b.pct_complete || 0
    ].map(esc).join(',')))
    out.push('')
    out.push('DAILY SPENDING')
    out.push(['Date', 'Bid line', 'Description', 'Qty', 'Unit', 'Rate', 'Total', 'Hours', 'Receipt/note'].map(esc).join(','))
    costs.forEach(c => {
      const linked = bidItems.find(b => String(b.id) === String(c.bid_item_id))
      out.push([c.date, linked ? linked.item : '', c.description, c.qty, c.unit || '', c.unit_actual, num(c.qty) * num(c.unit_actual), c.hours || '', c.receipt_notes || ''].map(esc).join(','))
    })
    out.push('')
    out.push(['Bid total', money(bidTotals.bill), 'Spent', money(totalActual), 'Job %', Math.round(overallPct), winning ? 'WINNING' : 'LOSING', money(forecastProfit)].map(esc).join(','))
    return out.join('\n')
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildSummary())
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Fallback for older browsers: select via prompt-less textarea
      const ta = document.createElement('textarea')
      ta.value = buildSummary()
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2500) } catch {}
      document.body.removeChild(ta)
    }
  }

  function handleEmail() {
    const subject = encodeURIComponent(`${project?.name || 'Job'} — job update ${new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`)
    window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(buildSummary())}`
  }

  function handleText() {
    window.location.href = `sms:?&body=${encodeURIComponent(buildSummary())}`
  }

  function handlePrint() {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<html><head><title>${project?.name || 'Job'} update</title></head><body style="font-family:sans-serif;font-size:15px"><h2>${project?.name || 'Job'} — job update</h2><pre style="white-space:pre-wrap;font-family:inherit">${buildSummary().replace(/</g, '&lt;')}</pre><script>window.onload=()=>window.print()<\/script></body></html>`)
    w.document.close()
  }

  function handleCSV() {
    const blob = new Blob([buildCSV()], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(project?.name || 'job').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-costing.csv`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }

  // ---------- PAPERS (bid docs / contract / invoices & receipts) ----------
  const DOC_BUCKET = 'project-files'
  const docPath = f => `${id}/Costing - ${docFolder}/${f}`

  async function fetchDocs() {
    setDocLoading(true)
    setDocError(null)
    try {
      const { data, error } = await supabase.storage.from(DOC_BUCKET).list(`${id}/Costing - ${docFolder}/`, { limit: 200 })
      if (error) throw error
      setDocFiles((data || []).filter(f => f.name !== '.emptyFolderPlaceholder'))
    } catch (e) {
      setDocError('Could not load papers. They need internet — try again, or use the file vault on the project page.')
      setDocFiles([])
    }
    setDocLoading(false)
  }

  useEffect(() => { if (tab === 'papers') fetchDocs() }, [tab, docFolder])

  async function uploadDocs(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    setDocUploading(true)
    setDocError(null)
    try {
      for (const f of files) {
        const safe = f.name.replace(/[^a-zA-Z0-9._\-() ]/g, '_')
        const { error } = await supabase.storage.from(DOC_BUCKET).upload(docPath(`${Date.now()}_${safe}`), f, { upsert: false })
        if (error) throw error
      }
      await fetchDocs()
    } catch (e) {
      setDocError('Upload failed: ' + (e.message || 'try again'))
    }
    setDocUploading(false)
  }

  async function downloadDoc(file) {
    const { data } = await supabase.storage.from(DOC_BUCKET).createSignedUrl(docPath(file.name), 180)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteDoc(file) {
    if (!window.confirm(`Remove "${file.name.replace(/^\d+_/, '')}"?`)) return
    await supabase.storage.from(DOC_BUCKET).remove([docPath(file.name)])
    fetchDocs()
  }

  if (loading) return <div style={S.page}><p style={{ padding: 24, fontSize: 18 }}>Loading…</p></div>

  const hasBid = bidItems.length > 0
  const winning = forecastProfit >= 0

  return (
    <div style={S.page}>
      <div style={S.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div style={S.gz}>GZ</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{project?.name || 'Job'}</div>
        </div>
        <button onClick={() => navigate(`/project/${id}`)} style={S.topBtn}>← Back</button>
      </div>

      <div style={S.body}>
        {/* Big plain-English tabs — 4 choices, huge touch targets */}
        <div style={{ ...S.tabs, gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
          <button onClick={() => setTab('where')} style={{ ...S.tab, ...(tab === 'where' ? S.tabActive : {}) }}>
            <span style={{ fontSize: 22 }}>👀</span><span>Where am I?</span>
          </button>
          <button onClick={() => setTab('bid')} style={{ ...S.tab, ...(tab === 'bid' ? S.tabActive : {}) }}>
            <span style={{ fontSize: 22 }}>📝</span><span>What we bid</span>
          </button>
          <button onClick={() => setTab('daily')} style={{ ...S.tab, ...(tab === 'daily' ? S.tabActive : {}) }}>
            <span style={{ fontSize: 22 }}>🧾</span><span>Log spending</span>
          </button>
          <button onClick={() => setTab('papers')} style={{ ...S.tab, ...(tab === 'papers' ? S.tabActive : {}) }}>
            <span style={{ fontSize: 22 }}>📂</span><span>Papers</span>
          </button>
        </div>

        {/* ================= WHERE AM I? (Peter's screen) ================= */}
        {tab === 'where' && (
          <>
            {!hasBid ? (
              <div style={S.card}>
                <div style={{ fontSize: 48 }}>👋</div>
                <h2 style={{ fontSize: 24, margin: '8px 0' }}>Let's set up this job, Peter.</h2>
                <p style={S.p}>Tell us what you bid and the crew logs what they spend. This screen will then tell you every day if you're winning or losing.</p>
                <button onClick={seedTemplate} style={S.bigOrange}>Start with the normal job list →</button>
                <p style={S.small}>You can change every number after. Takes about 2 minutes.</p>
              </div>
            ) : (
              <>
                {/* THE VERDICT — one glance, no reading required */}
                <div style={{ ...S.verdict, background: winning ? '#2b8a3e' : '#c92a2a' }}>
                  <div style={{ fontSize: 20, fontWeight: 600, opacity: 0.95 }}>
                    {totalActual === 0 ? 'Job is set up — no spending logged yet' : winning ? '✅ YOU’RE WINNING' : '🚨 YOU’RE LOSING'}
                  </div>
                  {totalActual > 0 && (
                    <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1.1 }}>
                      {money(Math.abs(forecastProfit))}
                    </div>
                  )}
                  <div style={{ fontSize: 17, marginTop: 4 }}>
                    {totalActual === 0
                      ? `You bid ${money(bidTotals.bill)}. No spending logged yet — you're good.`
                      : winning
                        ? `On track to keep ${money(forecastProfit)} on this job.`
                        : `On track to lose ${money(Math.abs(forecastProfit))} unless something changes.`}
                  </div>
                </div>

                {/* 3 numbers in plain English */}
                <div style={S.threeCards}>
                  <div style={S.bigCard}>
                    <div style={S.bigLabel}>💰 You bid the customer</div>
                    <div style={S.bigNum}>{money(bidTotals.bill)}</div>
                  </div>
                  <div style={S.bigCard}>
                    <div style={S.bigLabel}>💸 Spent so far</div>
                    <div style={S.bigNum}>{money(totalActual)}</div>
                    <div style={S.bigSub}>{daysWithCosts} work day{daysWithCosts === 1 ? '' : 's'} logged</div>
                  </div>
                  <div style={S.bigCard}>
                    <div style={S.bigLabel}>📊 Job is this far along</div>
                    <div style={S.bigNum}>{Math.round(overallPct)}%</div>
                    <div style={S.bigSub}>Earned {money(earned)} of {money(bidTotals.bill)}</div>
                  </div>
                </div>

                {/* Send / share this update — one tap, plain words */}
                <div style={S.card}>
                  <h3 style={S.h3}>📤 Send this update to someone</h3>
                  <p style={S.small}>Writes it up in plain words for you — Friday numbers, week totals, what's over and under. Then pick where it goes.</p>
                  <div style={S.shareBtns}>
                    <button onClick={handleCopy} style={S.shareBtn}>{copied ? '✓ Copied!' : '📋 Copy the words'}</button>
                    <button onClick={handleEmail} style={S.shareBtn}>✉️ Email it</button>
                    <button onClick={handleText} style={S.shareBtn}>💬 Text it</button>
                    <button onClick={handlePrint} style={S.shareBtn}>🖨️ Print it</button>
                    <button onClick={handleCSV} style={S.shareBtn}>📊 Save the spreadsheet (CSV)</button>
                  </div>
                  <pre style={S.summaryPreview}>{buildSummary()}</pre>
                </div>

                {/* This week — plain list, not a grid of math */}
                <div style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <h3 style={S.h3}>This week, day by day</h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setWeekOffset(o => o - 1)} style={S.navBtn}>← Last week</button>
                      <button onClick={() => setWeekOffset(0)} style={S.navBtn}>This week</button>
                    </div>
                  </div>
                  {weekDays.map(d => (
                    <div key={d.iso} style={{ ...S.dayRow, background: d.isToday ? '#fff4e6' : '#fafaf8', borderColor: d.isToday ? '#e8590c' : '#e8e6df' }}>
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 800 }}>{d.label}{d.isToday ? ' (today)' : ''}</div>
                        <div style={{ fontSize: 14, color: '#6e6e66' }}>{d.day}</div>
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: d.total > 0 ? '#14202b' : '#b8b4a8' }}>
                        {d.total > 0 ? money(d.total) : '—'}
                      </div>
                    </div>
                  ))}
                  <p style={S.small}>Week total: <strong>{money(weekTotal)}</strong> · Friday night, this list tells you exactly where Monday-to-Friday landed.</p>
                </div>

                {/* Each part of the job — cards, not a table */}
                <h3 style={{ ...S.h3, marginTop: 20 }}>Each part of the job — tap how far along it is 👇</h3>
                <p style={S.small}>Green = spending less than you bid &nbsp;·&nbsp; Red = spending more. The buttons update your winning/losing number above instantly.</p>
                {bidItems.map(b => {
                  const bidCost = num(b.qty) * num(b.unit_cost)
                  const spent = actualByBid[String(b.id)] || 0
                  const diff = bidCost - spent
                  const hasSpend = spent > 0
                  const status = !hasSpend
                    ? { text: 'Nothing spent yet', bg: '#f1f0eb', fg: '#6e6e66' }
                    : diff >= 0
                      ? { text: `Under budget by ${money(diff)} 👍`, bg: '#d3f9d6', fg: '#2b8a3e' }
                      : { text: `Over budget by ${money(Math.abs(diff))} ⚠️`, bg: '#ffe3e3', fg: '#c92a2a' }
                  return (
                    <div key={b.id} style={S.jobCard}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 19, fontWeight: 800 }}>{catEmoji(b.category)} {b.item}</div>
                      </div>
                      <div style={{ fontSize: 16, marginTop: 4 }}>
                        Bid <strong>{money(bidCost)}</strong> &nbsp;→&nbsp; Spent <strong>{money(spent)}</strong>
                      </div>
                      <div style={{ ...S.statusPill, background: status.bg, color: status.fg }}>{status.text}</div>
                      <div style={S.progressTrack}>
                        <div style={{ width: `${Math.min(100, num(b.pct_complete))}%`, height: '100%', background: '#2b8a3e', borderRadius: 8 }} />
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 700, margin: '6px 0' }}>{num(b.pct_complete)}% finished</div>
                      <div style={S.pctBtns}>
                        {PCT_STEPS.map(s => (
                          <button
                            key={s.value}
                            onClick={() => setPct(b.id, s.value)}
                            style={{ ...S.pctBtn, ...(num(b.pct_complete) === s.value ? S.pctBtnActive : {}) }}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}

        {/* ================= WHAT WE BID ================= */}
        {tab === 'bid' && (
          <div style={S.card}>
            <h2 style={{ fontSize: 24, margin: '0 0 6px' }}>📝 What did we bid?</h2>
            <p style={S.p}>One line per thing — crew, trucks, fuel, dirt in/out. The two numbers that matter: <strong>what 1 costs us</strong> and <strong>what we charge the customer for 1</strong>.</p>
            <div style={S.totalsBar}>
              <div>You bid <strong>{money(bidTotals.bill)}</strong></div>
              <div>It should cost <strong>{money(bidTotals.cost)}</strong></div>
              <div style={{ color: bidTotals.margin >= 0 ? '#2b8a3e' : '#c92a2a' }}>Left for you: <strong>{money(bidTotals.margin)}</strong></div>
            </div>

            {bidItems.length === 0 && (
              <button onClick={seedTemplate} style={S.bigOrange}>Start with the normal job list →</button>
            )}

            {!showBidForm ? (
              <button onClick={() => { setEditingBid(null); setShowBidForm(true) }} style={S.bigWhite}>＋ Add something we bid</button>
            ) : (
              <form onSubmit={saveBid} style={S.stackForm}>
                <label style={S.flabel}>What kind of thing is it?
                  <select value={bForm.category} onChange={e => setBForm({ ...bForm, category: e.target.value })} style={S.finput}>
                    {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
                  </select>
                </label>
                <label style={S.flabel}>What is it? (plain words)
                  <input placeholder="e.g. Diesel for the machines" value={bForm.item} onChange={e => setBForm({ ...bForm, item: e.target.value })} style={S.finput} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={S.flabel}>How many?
                    <input type="number" step="any" placeholder="e.g. 10" value={bForm.qty} onChange={e => setBForm({ ...bForm, qty: e.target.value })} style={S.finput} />
                  </label>
                  <label style={S.flabel}>Counted in…
                    <select value={bForm.unit} onChange={e => setBForm({ ...bForm, unit: e.target.value })} style={S.finput}>
                      {['days', 'hrs', 'L', 'tonnes', 'loads', 'lump', 'each'].map(u => <option key={u}>{u}</option>)}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <label style={S.flabel}>What does 1 cost US? ($)
                    <input type="number" step="any" placeholder="e.g. 2400" value={bForm.unit_cost} onChange={e => setBForm({ ...bForm, unit_cost: e.target.value })} style={S.finput} />
                  </label>
                  <label style={S.flabel}>What do we CHARGE for 1? ($)
                    <input type="number" step="any" placeholder="e.g. 3200" value={bForm.unit_billable} onChange={e => setBForm({ ...bForm, unit_billable: e.target.value })} style={S.finput} />
                  </label>
                </div>
                {(bForm.qty && (bForm.unit_cost || bForm.unit_billable)) && (
                  <div style={S.preview}>
                    That's {bForm.qty || '?'} × {moneyExact(num(bForm.unit_cost))} = <strong>{money(num(bForm.qty) * num(bForm.unit_cost))} cost</strong>
                    , charged <strong>{money(num(bForm.qty) * num(bForm.unit_billable))}</strong>.
                  </div>
                )}
                <label style={S.flabel}>Note to yourself (optional)
                  <input placeholder="e.g. what if we need extra loads?" value={bForm.notes} onChange={e => setBForm({ ...bForm, notes: e.target.value })} style={S.finput} />
                </label>
                <button type="submit" style={S.bigOrange}>{editingBid ? 'Save changes ✓' : 'Add it to the bid ✓'}</button>
                <button type="button" onClick={() => { setShowBidForm(false); setEditingBid(null) }} style={S.linkBtn}>Cancel</button>
              </form>
            )}

            {bidItems.map(b => (
              <div key={b.id} style={S.bidRow}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{catEmoji(b.category)} {b.item}</div>
                <div style={{ fontSize: 15, color: '#57544c', marginTop: 2 }}>
                  {b.qty} {b.unit} · costs us <strong>{money(num(b.qty) * num(b.unit_cost))}</strong> · we charge <strong>{money(num(b.qty) * num(b.unit_billable))}</strong>
                </div>
                {b.notes ? <div style={{ fontSize: 14, color: '#8a8578', fontStyle: 'italic' }}>📝 {b.notes}</div> : null}
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button onClick={() => startEdit(b)} style={S.navBtn}>✏️ Change</button>
                  <button onClick={() => deleteBid(b.id)} style={S.navBtn}>🗑 Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ================= LOG SPENDING (proper daily entry) ================= */}
        {tab === 'daily' && (
          <div style={S.card}>
            <div style={S.crewNote}>👷 <strong>Peter — skip this tab.</strong> Mike / Hanna: log every day Mon–Fri — guys & hours, fuel litres + price that day, dirt in/out, meals with receipts, subs.</div>
            <h2 style={{ fontSize: 24, margin: '12px 0 6px' }}>🧾 Log what got spent</h2>
            <p style={S.p}>Fill what you know. <strong>Either</strong> quantity + price each (e.g. 400 litres at $1.72) <strong>or</strong> just the total dollars off the receipt (e.g. $84 lunch). The Final screen updates by itself.</p>

            {lastLogged && (
              <div style={S.loggedOk}>✓ Logged: {lastLogged.text}</div>
            )}

            <form onSubmit={saveDaily} style={S.stackForm}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={S.flabel}>Which day?
                  <input type="date" value={dForm.date} onChange={e => { setDForm({ ...dForm, date: e.target.value }); setLastLogged(null) }} style={{ ...S.finput, fontSize: 20 }} />
                </label>
                <label style={S.flabel}>Hours (if labour)
                  <input type="number" step="any" placeholder="e.g. 8" value={dForm.hours} onChange={e => setDForm({ ...dForm, hours: e.target.value })} style={S.finput} />
                </label>
              </div>
              <label style={S.flabel}>Which part of the bid is this for?
                <select value={dForm.bid_item_id} onChange={e => setDForm({ ...dForm, bid_item_id: e.target.value })} style={S.finput}>
                  <option value="">Not sure / general</option>
                  {bidItems.map(b => <option key={b.id} value={b.id}>{catEmoji(b.category)} {b.item}</option>)}
                </select>
              </label>
              <label style={S.flabel}>What was it? (plain words)
                <input placeholder="e.g. Diesel fill-up, 2 crew days, 6 loads out, crew lunches" value={dForm.description} onChange={e => setDForm({ ...dForm, description: e.target.value })} style={S.finput} />
              </label>
              <div style={S.detailBox}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>Option A — you know the amount + price each:</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                  <label style={S.flabel}>How many?
                    <input type="number" step="any" placeholder="e.g. 400" value={dForm.qty} onChange={e => setDForm({ ...dForm, qty: e.target.value })} style={S.finput} />
                  </label>
                  <label style={S.flabel}>Counted in…
                    <input list="gz-units" placeholder="loads" value={dForm.unit} onChange={e => setDForm({ ...dForm, unit: e.target.value })} style={S.finput} />
                    <datalist id="gz-units">
                      {['hrs', 'days', 'L', 'tonnes', 'loads', 'each', 'lump'].map(u => <option key={u} value={u} />)}
                    </datalist>
                  </label>
                  <label style={S.flabel}>Price each? ($)
                    <input type="number" step="any" placeholder="e.g. 1.72" value={dForm.rate} onChange={e => setDForm({ ...dForm, rate: e.target.value })} style={S.finput} />
                  </label>
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, margin: '12px 0 8px' }}>Option B — you just have a receipt total:</div>
                <label style={S.flabel}>Total dollars? ($)
                  <input type="number" step="any" placeholder="e.g. 84" value={dForm.total} onChange={e => setDForm({ ...dForm, total: e.target.value })} style={{ ...S.finput, fontSize: 24, fontWeight: 800 }} />
                </label>
              </div>
              {dailyLineTotal() > 0 && (
                <div style={S.preview}>
                  This entry = <strong>{money(dailyLineTotal())}</strong>
                  {num(dForm.qty) && num(dForm.rate) ? ` (${dForm.qty} ${dForm.unit || ''} × $${dForm.rate})` : ' (receipt total)'}
                  {num(dForm.hours) ? ` · ${dForm.hours} hrs` : ''} on {dForm.date ? dayName(dForm.date) : '…'}
                </div>
              )}
              <label style={S.flabel}>Receipt photo note / where's the receipt? (optional)
                <input placeholder="e.g. photo in Papers → Invoices, glovebox" value={dForm.receipt_notes} onChange={e => setDForm({ ...dForm, receipt_notes: e.target.value })} style={S.finput} />
              </label>
              <button type="submit" style={S.bigOrange}>Log {dailyLineTotal() ? money(dailyLineTotal()) : 'it'} ✓</button>
            </form>

            <h3 style={{ ...S.h3, marginTop: 20 }}>
              {dForm.date ? dayName(dForm.date) : 'This day'} — total <strong>{money(costs.filter(c => c.date === dForm.date).reduce((s, c) => s + num(c.qty) * num(c.unit_actual), 0))}</strong>
            </h3>
            {costs.filter(c => c.date === dForm.date).map(c => (
              <div key={c.id} style={S.spendRow}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{c.description}</div>
                  <div style={{ fontSize: 14, color: '#6e6e66' }}>
                    {c.qty && c.unit && c.unit_actual ? `${c.qty} ${c.unit} × $${c.unit_actual}` : 'Receipt total'}
                    {c.hours ? ` · ${c.hours} hrs` : ''}{c.receipt_notes ? ` · 🧾 ${c.receipt_notes}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 19, fontWeight: 800 }}>{money(num(c.qty) * num(c.unit_actual))}</div>
                  <button onClick={() => deleteCost(c.id)} style={S.navBtn}>🗑</button>
                </div>
              </div>
            ))}
            {costs.filter(c => c.date === dForm.date).length === 0 && <p style={S.p}>Nothing logged for this day yet.</p>}

            <h3 style={{ ...S.h3, marginTop: 20 }}>Latest spending (newest first)</h3>
            {costs.filter(c => c.date !== dForm.date).slice(0, 20).map(c => (
              <div key={c.id} style={S.spendRow}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{c.description}</div>
                  <div style={{ fontSize: 14, color: '#6e6e66' }}>{c.date}{c.receipt_notes ? ` · 🧾 ${c.receipt_notes}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 19, fontWeight: 800 }}>{money(num(c.qty) * num(c.unit_actual))}</div>
                  <button onClick={() => deleteCost(c.id)} style={S.navBtn}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ================= PAPERS (bid docs / contract / invoices) ================= */}
        {tab === 'papers' && (
          <div style={S.card}>
            <h2 style={{ fontSize: 24, margin: '0 0 6px' }}>📂 Job papers</h2>
            <p style={S.p}>The bid papers, the signed contract, and every invoice & receipt — kept with the numbers so nothing gets lost. Take a photo of a receipt and put it here.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {DOC_FOLDERS.map(f => (
                <button key={f} onClick={() => setDocFolder(f)} style={{ ...S.navBtn, ...(docFolder === f ? { background: '#14202b', color: '#fff', borderColor: '#14202b' } : {}) }}>
                  {f === 'Bid documents' ? '📝 ' : f === 'Contract' ? '📑 ' : '🧾 '}{f}
                </button>
              ))}
            </div>
            <label style={S.bigWhite}>
              {docUploading ? 'Putting it away…' : `📸 Put papers in ${docFolder}`}
              <input type="file" multiple style={{ display: 'none' }} onChange={e => { uploadDocs(e.target.files); e.target.value = '' }} disabled={docUploading} />
            </label>
            {docError && <p style={{ fontSize: 15, color: '#c92a2a' }}>⚠️ {docError}</p>}
            {docLoading ? (
              <p style={S.p}>Looking…</p>
            ) : docFiles.length === 0 ? (
              <p style={S.p}>Nothing in {docFolder} yet. Use the button above — PDFs, photos, spreadsheets all fine.</p>
            ) : (
              docFiles.map((f, i) => (
                <div key={i} style={S.spendRow}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>📎 {f.name.replace(/^\d+_/, '')}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => downloadDoc(f)} style={S.navBtn}>👀 Open</button>
                    <button onClick={() => deleteDoc(f)} style={S.navBtn}>🗑</button>
                  </div>
                </div>
              ))
            )}
            <p style={S.small}>Tip: crew — after you log a meal or fuel receipt under Log spending, snap it and drop it in Invoices & receipts.</p>
          </div>
        )}
      </div>
    </div>
  )
}

const S = {
  page: { minHeight: '100vh', background: '#f2f0ea', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  topbar: { background: '#14202b', minHeight: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 1.2rem', position: 'sticky', top: 0, zIndex: 100 },
  gz: { width: 38, height: 38, border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 15 },
  topBtn: { background: 'transparent', color: '#fff', border: '2px solid #777', padding: '12px 20px', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer' },
  body: { maxWidth: 760, margin: '0 auto', padding: '1rem 1rem 3rem' },
  tabs: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 },
  tab: { background: '#fff', border: '2px solid #d8d5cb', padding: '12px 6px', borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: 'pointer', color: '#57544c', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minHeight: 72 },
  tabActive: { background: '#14202b', color: '#fff', borderColor: '#14202b' },
  card: { background: '#fff', borderRadius: 12, padding: '1.2rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 14 },
  verdict: { borderRadius: 14, padding: '1.4rem', color: '#fff', textAlign: 'center', marginBottom: 14, boxShadow: '0 4px 14px rgba(0,0,0,0.15)' },
  threeCards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10, marginBottom: 14 },
  bigCard: { background: '#fff', borderRadius: 12, padding: '1rem 1.2rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  bigLabel: { fontSize: 15, color: '#6e6e66', fontWeight: 600 },
  bigNum: { fontSize: 34, fontWeight: 900, color: '#14202b' },
  bigSub: { fontSize: 14, color: '#8a8578' },
  h3: { fontSize: 19, color: '#14202b', margin: '0 0 8px' },
  p: { fontSize: 16, color: '#57544c', lineHeight: 1.45, margin: '0 0 12px' },
  small: { fontSize: 14, color: '#8a8578', lineHeight: 1.45 },
  dayRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '2px solid #e8e6df', borderRadius: 10, padding: '12px 14px', marginBottom: 8 },
  jobCard: { background: '#fff', borderRadius: 12, padding: '1.1rem 1.2rem', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 12 },
  statusPill: { display: 'inline-block', fontSize: 15, fontWeight: 800, padding: '6px 14px', borderRadius: 20, marginTop: 8 },
  progressTrack: { height: 14, background: '#eee9df', borderRadius: 8, marginTop: 10, overflow: 'hidden' },
  pctBtns: { display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginTop: 8 },
  pctBtn: { background: '#fafaf8', border: '2px solid #d8d5cb', borderRadius: 8, padding: '10px 2px', fontSize: 13, fontWeight: 800, cursor: 'pointer', color: '#57544c' },
  pctBtnActive: { background: '#14202b', color: '#fff', borderColor: '#14202b' },
  navBtn: { background: '#fafaf8', border: '2px solid #d8d5cb', borderRadius: 8, padding: '10px 16px', fontSize: 15, fontWeight: 700, cursor: 'pointer', color: '#333' },
  totalsBar: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 17, color: '#333', background: '#fafaf8', border: '2px solid #e8e6df', borderRadius: 10, padding: '12px 16px', marginBottom: 14 },
  stackForm: { display: 'flex', flexDirection: 'column', gap: 12, background: '#fafaf8', border: '2px solid #e8e6df', borderRadius: 10, padding: 16, marginBottom: 14 },
  flabel: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 16, fontWeight: 700, color: '#333' },
  finput: { padding: '14px', border: '2px solid #d4d0c8', borderRadius: 8, fontSize: 17, background: '#fff', width: '100%', boxSizing: 'border-box' },
  preview: { fontSize: 16, background: '#e7f5ff', borderRadius: 8, padding: '10px 14px', color: '#1864ab' },
  bigOrange: { background: '#e8590c', color: '#fff', border: 'none', padding: '16px 20px', borderRadius: 10, fontSize: 18, fontWeight: 800, cursor: 'pointer', width: '100%', marginTop: 6 },
  bigWhite: { background: '#fff', color: '#14202b', border: '2px solid #14202b', padding: '16px 20px', borderRadius: 10, fontSize: 18, fontWeight: 800, cursor: 'pointer', width: '100%', marginTop: 6 },
  linkBtn: { background: 'none', border: 'none', color: '#8a8578', fontSize: 16, cursor: 'pointer', padding: 8 },
  bidRow: { borderTop: '2px solid #f2f0ea', padding: '14px 4px' },
  spendRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderTop: '2px solid #f2f0ea', padding: '12px 4px' },
  crewNote: { background: '#fff4e6', border: '2px solid #f0a35e', borderRadius: 10, padding: '12px 16px', fontSize: 16, color: '#7c4a12' },
  shareBtns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8, marginBottom: 10 },
  shareBtn: { background: '#14202b', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 10px', fontSize: 16, fontWeight: 800, cursor: 'pointer' },
  summaryPreview: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, background: '#fafaf8', border: '2px solid #e8e6df', borderRadius: 10, padding: '12px 14px', color: '#333', maxHeight: 260, overflowY: 'auto', margin: 0 },
  loggedOk: { background: '#d3f9d6', border: '2px solid #2b8a3e', color: '#2b8a3e', borderRadius: 10, padding: '12px 16px', fontSize: 16, fontWeight: 700, marginBottom: 12 },
  detailBox: { background: '#fff', border: '2px dashed #d4d0c8', borderRadius: 10, padding: 14 },
}
