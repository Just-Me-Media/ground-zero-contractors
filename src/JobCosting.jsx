import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './supabase'
import { useAuth } from './AuthContext'

// Local calendar date (YYYY-MM-DD). Never use toISOString() for day logic —
// it runs in UTC and shifts the day during Ontario evenings.
function fmtLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function todayLocal() { return fmtLocal(new Date()) }

// Lines seeded from a charge-out sheet carry this marker until someone who
// knows the true internal cost replaces it (see 1d true-cost-missing state).
const TRUE_COST_NEEDLE = 'TRUE GZC COST STILL NEEDED'

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
  const location = useLocation()
  const { userRole } = useAuth()
  // Roles: full/admin (Peter, Hanna) can do everything including delete.
  // limited (Mike, the PM) can do everything EXCEPT delete — he edits the bid
  // he wrote, moves %s, logs and imports daily entries. client sees a
  // redacted $-free view (rendered below).
  const canManage = userRole === 'admin' || userRole === 'full'
  const isClient = userRole === 'client'
  const canEdit = !isClient
  const [project, setProject] = useState(null)
  // Deep-linkable tabs: ?tab=bid lands straight on the bid sheet (badges link here).
  const initialTab = new URLSearchParams(location.search).get('tab')
  const [tab, setTab] = useState(['where', 'bid', 'daily', 'papers'].includes(initialTab) ? initialTab : 'where') // Peter opens here. Always.
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
  const today = todayLocal()
  const [dForm, setDForm] = useState({ date: today, bid_item_id: '', description: '', qty: '', unit: 'loads', rate: '', total: '', hours: '', ot: '', worker: '', receipt_notes: '' })
  const [lastLogged, setLastLogged] = useState(null)
  // True once supabase/costing_step2_exports.sql has been run (worker + hours_ot cols)
  const [hasPayCols, setHasPayCols] = useState(true)
  // Export date range — defaults to the current Mon–Fri pay week
  const [expFrom, setExpFrom] = useState('')
  const [expTo, setExpTo] = useState('')

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
      // Probe Step-2 payroll columns; export buttons adapt if missing
      const probe = await supabase.from('cost_entries').select('worker,hours_ot').limit(1)
      setHasPayCols(!probe.error)
    } catch {
      setBidItems(lsLoad(id, 'bid_items'))
      setCosts(lsLoad(id, 'cost_entries'))
      setUseLocal(true)
    }
    // Default export range = current Mon–Fri
    const now = new Date()
    const dow = (now.getDay() + 6) % 7
    const mon = new Date(now); mon.setDate(now.getDate() - dow)
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4)
    setExpFrom(f => f || fmtLocal(mon))
    setExpTo(f => f || fmtLocal(fri))
    setLoading(false)
  }

  async function persistBid(rows) { setBidItems(rows); if (useLocal) lsSave(id, 'bid_items', rows) }
  async function persistCosts(rows) { setCosts(rows); if (useLocal) lsSave(id, 'cost_entries', rows) }

  // Insert cost rows. If the Step-2 payroll columns don't exist yet (migration
  // not run), retry without them so logging never breaks.
  const stripPayCols = r => {
    const { worker, hours_ot, ...rest } = r
    void worker; void hours_ot
    return rest
  }
  async function insertCosts(rows) {
    if (useLocal) {
      persistCosts([...rows.map(r => ({ ...r, id: uid(), worker: r.worker || '', hours_ot: r.hours_ot || 0 })), ...costs])
      return { data: rows }
    }
    let res = await supabase.from('cost_entries').insert(rows).select()
    if (res.error) {
      res = await supabase.from('cost_entries').insert(rows.map(stripPayCols)).select()
      if (!res.error) setHasPayCols(false)
    }
    if (!res.error && res.data) setCosts(prev => [...res.data, ...prev])
    return res
  }

  // ---------- MATH (same as before, just hidden from Peter) ----------
  // Contingency IS counted (1c): each line holds back bid-cost × contingency %
  // as a safety buffer. Margin and forecast are net of it.
  const bidTotals = useMemo(() => {
    let cost = 0, bill = 0, reserve = 0
    bidItems.forEach(b => {
      const c = num(b.qty) * num(b.unit_cost)
      cost += c
      bill += num(b.qty) * num(b.unit_billable)
      reserve += c * (num(b.contingency_pct) / 100)
    })
    return { cost, bill, reserve, margin: bill - cost - reserve }
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
  const forecastProfit = bidTotals.bill - forecastCost - bidTotals.reserve
  const daysWithCosts = useMemo(() => new Set(costs.map(c => c.date)).size, [costs])

  // Lines whose true internal cost is still unknown (seeded from charge-out
  // rates). Until cleared, every dollar figure on screen is an estimate (1d).
  const missingTrueCost = useMemo(
    () => bidItems.filter(b => (b.notes || '').includes(TRUE_COST_NEEDLE)),
    [bidItems]
  )

  const weekDays = useMemo(() => {
    const base = new Date()
    base.setDate(base.getDate() + weekOffset * 7)
    const dow = (base.getDay() + 6) % 7
    const mon = new Date(base); mon.setDate(base.getDate() - dow)
    return [0, 1, 2, 3, 4].map(i => {
      const d = new Date(mon); d.setDate(mon.getDate() + i)
      const iso = fmtLocal(d)
      const dayCosts = costs.filter(c => c.date === iso)
      const dayTotal = dayCosts.reduce((s, c) => s + num(c.qty) * num(c.unit_actual), 0)
      const isToday = iso === today
      return {
        iso, isToday,
        label: d.toLocaleDateString('en-CA', { weekday: 'long' }),
        short: d.toLocaleDateString('en-CA', { weekday: 'short' }),
        day: d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }),
        total: dayTotal,
        hasEntries: dayCosts.length > 0,
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
      hours_ot: num(dForm.ot),
      worker: (dForm.worker || '').trim(),
      receipt_notes: dForm.receipt_notes || '',
    }
    await insertCosts([row])
    setLastLogged({ when: new Date(), text: `${dForm.description.trim()} — ${money(lineTotal)} on ${dForm.date}` })
    // Keep day + bid line + worker for fast multi-line entry, clear the rest
    setDForm(f => ({ ...f, description: '', qty: '', rate: '', total: '', hours: '', ot: '', receipt_notes: '' }))
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
    lines.push(`Bid: ${money(bidTotals.bill)} | Spent so far: ${money(totalActual)} | Safety buffer: ${money(bidTotals.reserve)} | Job ${Math.round(overallPct)}% done`)
    if (missingTrueCost.length > 0) lines.push(`Note: ${missingTrueCost.length} lines still need true costs — figures are estimates.`)
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
    out.push(['Date', 'Worker', 'Bid line', 'Description', 'Qty', 'Unit', 'Rate', 'Total', 'Reg hours', 'OT hours', 'Receipt/note'].map(esc).join(','))
    costs.forEach(c => {
      const linked = bidItems.find(b => String(b.id) === String(c.bid_item_id))
      out.push([c.date, c.worker || '', linked ? linked.item : '', c.description, c.qty, c.unit || '', c.unit_actual, num(c.qty) * num(c.unit_actual), c.hours || '', c.hours_ot || '', c.receipt_notes || ''].map(esc).join(','))
    })
    out.push('')
    out.push(['Bid total', money(bidTotals.bill), 'Bid cost', money(bidTotals.cost), 'Safety buffer', money(bidTotals.reserve), 'Left', money(bidTotals.margin), 'Spent', money(totalActual), 'Job %', Math.round(overallPct), winning ? 'WINNING' : 'LOSING', money(forecastProfit)].map(esc).join(','))
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

  // Blank daily sheet for the field: one row per bid line, opens in Excel.
  // Offline backup only — same-day phone entry is the primary method.
  function handleBlankSheet() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out = [
      `${project?.name || 'Job'} — DAILY FIELD SHEET (fill one per day, or enter straight in the app)`,
      ['Date (YYYY-MM-DD)', 'Worker (name)', 'Bid line (do not rename)', 'What happened today', 'How many', 'Counted in', 'Price each $', 'OR receipt total $', 'Hours (reg)', 'OT hours', 'Receipt / note'].map(esc).join(','),
    ]
    bidItems.forEach(b => out.push(['', '', b.item, '', '', b.unit || '', '', '', '', '', ''].map(esc).join(',')))
    const blob = new Blob([out.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(project?.name || 'job').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-daily-sheet.csv`
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }

  // ---------- CSV IMPORT (Mike drops his filled daily sheet) ----------
  // Parses the blank-sheet format, matches bid lines by name, previews every
  // row for confirmation. Nothing enters the books sight-unseen.
  const [importRows, setImportRows] = useState(null)
  const [importError, setImportError] = useState(null)
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  function parseCSV(text) {
    const rows = []
    let field = '', row = [], inQuotes = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++ }
          else inQuotes = false
        } else field += ch
      } else if (ch === '"') inQuotes = true
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        row.push(field); field = ''
        if (row.some(c => c.trim() !== '')) rows.push(row)
        row = []
      } else field += ch
    }
    row.push(field)
    if (row.some(c => c.trim() !== '')) rows.push(row)
    return rows
  }

  const normHeader = h => (h || '').toLowerCase().replace(/[^a-z]/g, '')

  function handleSheetFile(file) {
    setImportError(null)
    setImportRows(null)
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result || ''))
        if (rows.length < 2) throw new Error('no data rows')
        // Find the header row (the one mentioning date + bid line)
        let hi = rows.findIndex(r => {
          const h = r.map(normHeader).join('|')
          return h.includes('date') && (h.includes('bidline') || h.includes('bid'))
        })
        if (hi < 0) hi = 1 // blank-sheet layout: title row, then header
        const headers = rows[hi].map(normHeader)
        const col = want => headers.findIndex(h => want.some(w => h.includes(w)))
        const cDate = col(['date']), cLine = col(['bidline', 'bid']), cDesc = col(['whathappened', 'what', 'description'])
        const cQty = col(['howmany', 'qty', 'quantity']), cUnit = col(['countedin', 'unit'])
        const cRate = col(['priceeach', 'rate', 'price']), cTotal = col(['receipttotal', 'total'])
        // Robust hour matching: OT column first, then reg-hours = first 'hours' header that isn't OT
        const cOT = col(['overtime', 'othours', 'oth'])
        let cHours = col(['reghours', 'regularhours'])
        if (cHours < 0) cHours = headers.findIndex((h, i) => i !== cOT && h.includes('hours'))
        // NOTE: match 'worker'/'employee' only — 'name' would false-match "Bid line (do not rename)"
        const cWorker = col(['worker', 'employee'])
        const cNote = col(['receipt', 'note'])
        if (cDate < 0) throw new Error('no Date column found')
        const parsed = []
        for (let i = hi + 1; i < rows.length; i++) {
          const r = rows[i]
          const date = (r[cDate] || '').trim()
          const lineName = cLine >= 0 ? (r[cLine] || '').trim() : ''
          const desc = cDesc >= 0 ? (r[cDesc] || '').trim() : ''
          const qty = cQty >= 0 ? num(r[cQty]) : 0
          const unit = cUnit >= 0 ? (r[cUnit] || '').trim() : ''
          const rate = cRate >= 0 ? num(r[cRate]) : 0
          const total = cTotal >= 0 ? num(r[cTotal]) : 0
          const hours = cHours >= 0 ? num(r[cHours]) : 0
          const ot = cOT >= 0 ? num(r[cOT]) : 0
          const worker = cWorker >= 0 ? (r[cWorker] || '').trim().slice(0, 80) : ''
          const note = cNote >= 0 ? (r[cNote] || '').trim() : ''
          const lineTotal = (qty && rate) ? qty * rate : total
          if (!date && !lineName && !desc && !lineTotal) continue // blank row
          const okDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(new Date(date + 'T12:00:00').getTime())
          const linked = lineName ? bidItems.find(b => b.item.toLowerCase() === lineName.toLowerCase()) : null
          parsed.push({
            key: i, date, lineName, bidId: linked ? linked.id : (lineName ? null : (bidItems[0]?.id || null)),
            desc: desc || lineName, qty, unit, rate, total, hours, ot, worker, note, lineTotal,
            ok: okDate && lineTotal > 0 && (linked || !lineName),
          })
        }
        if (!parsed.length) throw new Error('no filled rows found')
        setImportRows(parsed)
      } catch (e) {
        setImportError('Could not read that sheet (' + (e.message || 'unknown format') + '). Use the downloaded blank daily sheet so columns match.')
      }
    }
    reader.readAsText(file)
  }

  async function confirmImport() {
    const good = (importRows || []).filter(r => r.ok && r.bidId)
    if (!good.length) return
    setImporting(true)
    const rows = good.map(r => {
      const linked = bidItems.find(b => String(b.id) === String(r.bidId))
      const useRate = r.qty && r.rate
      return {
        project_id: id,
        date: r.date,
        bid_item_id: r.bidId,
        category: linked ? linked.category : 'Other',
        description: (r.desc || linked?.item || 'Imported entry').slice(0, 200),
        qty: useRate ? r.qty : 1,
        unit: useRate ? (r.unit || '') : '',
        unit_actual: useRate ? r.rate : r.lineTotal,
        hours: r.hours || 0,
        hours_ot: r.ot || 0,
        worker: (r.worker || '').slice(0, 80),
        receipt_notes: ((r.note || 'imported sheet') + '').slice(0, 200),
      }
    })
    const res = await insertCosts(rows)
    if (res.error) { setImportError('Import failed: ' + (res.error.message || 'try again')); setImporting(false); return }
    const sum = good.reduce((s, r) => s + r.lineTotal, 0)
    const days = [...new Set(good.map(r => r.date))].join(', ')
    setLastLogged({ when: new Date(), text: `Sheet import: ${good.length} entries, ${money(sum)} (${days})` })
    setImportRows(null)
    setImporting(false)
  }

  // ---------- PAYROLL & BOOKS EXPORTS (Hanna) ----------
  // Sage 50 Canada timesheet import: required headers Name, Date, Income;
  // optional Hours, Project, Comment. Dates YYYY-MM-DD, hours decimal.
  // Reg and OT go as separate Income rows. Income names MUST match the Income
  // records in their Sage company — confirm "Regular"/"Overtime" with payroll.
  const SAGE_REG = 'Regular'
  const SAGE_OT = 'Overtime'

  function exportRange() {
    return costs.filter(c => (!expFrom || c.date >= expFrom) && (!expTo || c.date <= expTo))
  }

  function downloadCSV(filename, text) {
    const blob = new Blob([text], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    document.body.appendChild(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }

  function handleSageExport() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out = [['Name', 'Date', 'Income', 'Hours', 'Project', 'Comment'].map(esc).join(',')]
    exportRange().forEach(c => {
      const worker = (c.worker || '').trim()
      if (num(c.hours) > 0) out.push([worker, c.date, SAGE_REG, c.hours, project?.name || '', c.description].map(esc).join(','))
      if (num(c.hours_ot) > 0) out.push([worker, c.date, SAGE_OT, c.hours_ot, project?.name || '', c.description].map(esc).join(','))
    })
    downloadCSV(`${(project?.name || 'job').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-sage-timesheet.csv`, out.join('\n'))
  }

  // QuickBooks time: Employee, Date, Pay Type, Hours, Job, Notes. Fits QBO
  // weekly timesheets (copy/paste or Transaction Pro), QB Time manual import,
  // and gives the accountant clean pay-type splits either way.
  function handleQBTimeExport() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out = [['Employee', 'Date', 'Pay Type', 'Hours', 'Job', 'Notes'].map(esc).join(',')]
    exportRange().forEach(c => {
      const worker = (c.worker || '').trim()
      if (num(c.hours) > 0) out.push([worker, c.date, 'Regular', c.hours, project?.name || '', c.description].map(esc).join(','))
      if (num(c.hours_ot) > 0) out.push([worker, c.date, 'Overtime', c.hours_ot, project?.name || '', c.description].map(esc).join(','))
    })
    downloadCSV(`${(project?.name || 'job').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qb-time.csv`, out.join('\n'))
  }

  // QuickBooks bookkeeping: every dated cost line with category + receipt ref.
  // Upload via Banking → Upload from file, or hand to the accountant as-is.
  function handleQBExpensesExport() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const out = [['Date', 'Description', 'Category', 'Bid Line', 'Amount', 'Job', 'Receipt', 'Worker'].map(esc).join(',')]
    exportRange().forEach(c => {
      const linked = bidItems.find(b => String(b.id) === String(c.bid_item_id))
      out.push([c.date, c.description, c.category, linked ? linked.item : '', (num(c.qty) * num(c.unit_actual)).toFixed(2), project?.name || '', c.receipt_notes || '', c.worker || ''].map(esc).join(','))
    })
    downloadCSV(`${(project?.name || 'job').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qb-expenses.csv`, out.join('\n'))
  }

  const exportUnnamed = exportRange().filter(c => (num(c.hours) > 0 || num(c.hours_ot) > 0) && !(c.worker || '').trim()).length

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

  // ---------- 1a CLIENT VIEW: progress only, never dollars ----------
  // Clients see how far along their job is and nothing financial. (UI-level
  // redaction; API-level RLS scoping is Step 4 hardening.)
  if (isClient) {
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
          <div style={S.card}>
            <div style={{ fontSize: 48 }}>🏗️</div>
            <h2 style={{ fontSize: 24, margin: '8px 0' }}>{project?.name || 'Your project'} — how far along it is</h2>
            <div style={{ fontSize: 52, fontWeight: 900, color: '#14202b' }}>{Math.round(overallPct)}%</div>
            <div style={S.progressTrack}>
              <div style={{ width: `${Math.min(100, overallPct)}%`, height: '100%', background: '#2b8a3e', borderRadius: 8 }} />
            </div>
            <p style={{ ...S.small, marginTop: 10 }}>Your crew's progress this week:</p>
            {weekDays.map(d => (
              <div key={d.iso} style={S.dayRow}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{d.label}{d.isToday ? ' (today)' : ''}</div>
                <div style={{ fontSize: 22 }}>{d.hasEntries ? '✅ Crew on site' : '—'}</div>
              </div>
            ))}
            <p style={S.small}>Questions about schedule? Call Peter.</p>
          </div>
        </div>
      </div>
    )
  }

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
                {canManage ? (
                  <>
                    <button onClick={seedTemplate} style={S.bigOrange}>Start with the normal job list →</button>
                    <p style={S.small}>You can change every number after. Takes about 2 minutes.</p>
                  </>
                ) : (
                  <p style={S.p}>The bid isn't set up yet — ask Peter or Hanna to add it.</p>
                )}
              </div>
            ) : (
              <>
                {/* 1d TRUE-COST-MISSING: every figure below is an estimate until cleared */}
                {missingTrueCost.length > 0 && (
                  <div style={S.warnBanner}>
                    ⚠️ {missingTrueCost.length} line{missingTrueCost.length === 1 ? '' : 's'} still {missingTrueCost.length === 1 ? 'needs its' : 'need their'} true cost — every dollar figure below is an estimate.
                    {canEdit ? (
                      <button onClick={() => { const first = missingTrueCost[0]; if (first) startEdit(first) }} style={S.warnBtn}>
                        Fix the first one now →
                      </button>
                    ) : (
                      ' Ask Peter, Hanna or Mike to fill them in.'
                    )}
                  </div>
                )}
                {/* THE VERDICT — one glance, no reading required.
                    Never flash WINNING/LOSING on placeholder costs: estimates
                    get a calm amber banner until true costs are in. */}
                {(() => {
                  const state = totalActual === 0 ? 'setup'
                    : missingTrueCost.length > 0 ? 'estimate'
                    : winning ? 'win' : 'lose'
                  const bg = state === 'win' ? '#2b8a3e' : state === 'lose' ? '#c92a2a' : state === 'estimate' ? '#b26a00' : '#14202b'
                  return (
                    <div style={{ ...S.verdict, background: bg }}>
                      <div style={{ fontSize: 20, fontWeight: 600, opacity: 0.95 }}>
                        {state === 'setup' && 'Job is set up — no spending logged yet'}
                        {state === 'estimate' && '⏳ ESTIMATE — true costs still missing'}
                        {state === 'win' && '✅ YOU’RE WINNING'}
                        {state === 'lose' && '🚨 YOU’RE LOSING'}
                      </div>
                      {totalActual > 0 && (
                        <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1.1 }}>
                          {state === 'estimate' ? '≈ ' : ''}{money(Math.abs(forecastProfit))}
                        </div>
                      )}
                      <div style={{ fontSize: 17, marginTop: 4 }}>
                        {state === 'setup' && `You bid ${money(bidTotals.bill)}. No spending logged yet — you're good.`}
                        {state === 'estimate' && (winning
                          ? `Looks like keeping ≈ ${money(forecastProfit)} — firms up once true costs are in.`
                          : `Looks like losing ≈ ${money(Math.abs(forecastProfit))} — firms up once true costs are in.`)}
                        {state === 'win' && `On track to keep ${money(forecastProfit)} on this job.`}
                        {state === 'lose' && `On track to lose ${money(Math.abs(forecastProfit))} unless something changes.`}
                      </div>
                    </div>
                  )
                })()}

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
                    <div style={S.bigLabel}>🛟 Safety buffer (just in case)</div>
                    <div style={S.bigNum}>{money(bidTotals.reserve)}</div>
                    <div style={S.bigSub}>Held back from the bid for surprises</div>
                  </div>
                  <div style={S.bigCard}>
                    <div style={S.bigLabel}>📊 Job is this far along</div>
                    <div style={S.bigNum}>{Math.round(overallPct)}%</div>
                    <div style={S.bigSub}>Earned {money(earned)} of {money(bidTotals.bill)}</div>
                  </div>
                </div>

                {/* Send / share this update — Peter & Hanna only */}
                {canManage && (
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
                )}

                {/* Payroll & books exports — Hanna (Peter too). Pick the pay week, download, import. */}
                {canManage && (
                <div style={S.card}>
                  <h3 style={S.h3}>📤 Payroll & books — ready-made files</h3>
                  <p style={S.small}>Pick the week (defaults to this Mon–Fri), download, and import straight into Sage or QuickBooks. No retyping.</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <label style={S.flabel}>From
                      <input type="date" value={expFrom} onChange={e => setExpFrom(e.target.value)} style={S.finput} />
                    </label>
                    <label style={S.flabel}>To
                      <input type="date" value={expTo} onChange={e => setExpTo(e.target.value)} style={S.finput} />
                    </label>
                  </div>
                  {!hasPayCols && (
                    <p style={{ fontSize: 15, color: '#a8380d', background: '#fff4e6', borderRadius: 8, padding: '10px 14px' }}>
                      ⚠️ Worker names + OT need one database update first — run <strong>supabase/costing_step2_exports.sql</strong> in the SQL editor, then reload. Exports still work, but names/OT won't be saved until then.
                    </p>
                  )}
                  {exportUnnamed > 0 && (
                    <p style={{ fontSize: 15, color: '#a8380d' }}>⚠️ {exportUnnamed} hour {exportUnnamed === 1 ? 'entry' : 'entries'} in this range {exportUnnamed === 1 ? 'has' : 'have'} no worker name — Sage will reject {exportUnnamed === 1 ? 'it' : 'them'}. Add names on the Log tab first.</p>
                  )}
                  <div style={S.shareBtns}>
                    <button onClick={handleSageExport} style={S.shareBtn}>🟢 Sage 50 timesheet</button>
                    <button onClick={handleQBTimeExport} style={S.shareBtn}>🔵 QB hours</button>
                    <button onClick={handleQBExpensesExport} style={S.shareBtn}>🧾 QB expenses</button>
                  </div>
                  <div style={{ fontSize: 14, color: '#6e6e66', lineHeight: 1.5 }}>
                    <div><strong>Sage file →</strong> Sage 50 → File → Import/Export → Import Records → Timesheets. Names must already exist in Sage; Income columns use Regular / Overtime — confirm those exact Income names with payroll first.</div>
                    <div style={{ marginTop: 4 }}><strong>QB hours →</strong> paste into a QBO weekly timesheet (or Transaction Pro / QB Time manual import): Employee, Date, Pay Type, Hours, Job.</div>
                    <div style={{ marginTop: 4 }}><strong>QB expenses →</strong> Banking → Upload from file, or hand to the accountant as-is.</div>
                  </div>
                </div>
                )}

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
                  const needsTrueCost = (b.notes || '').includes(TRUE_COST_NEEDLE)
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
                      {needsTrueCost && (
                        canEdit ? (
                          <button onClick={() => startEdit(b)} style={{ ...S.trueCostBadge, cursor: 'pointer' }} title="Tap to enter the true cost">
                            ⚠️ True cost needed — tap to fix →
                          </button>
                        ) : (
                          <div style={S.trueCostBadge}>⚠️ True cost needed — bid rate shown for now</div>
                        )
                      )}
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
              <div>Safety buffer held back <strong>{money(bidTotals.reserve)}</strong></div>
              <div style={{ color: bidTotals.margin >= 0 ? '#2b8a3e' : '#c92a2a' }}>Left for you: <strong>{money(bidTotals.margin)}</strong>{missingTrueCost.length > 0 ? ' (estimate)' : ''}</div>
            </div>

            {!canEdit && (
              <p style={S.p}>👀 You're looking at the bid — only the GZ team can change it.</p>
            )}

            {canEdit && bidItems.length === 0 && (
              <button onClick={seedTemplate} style={S.bigOrange}>Start with the normal job list →</button>
            )}

            {canEdit && !showBidForm ? (
              <button onClick={() => { setEditingBid(null); setShowBidForm(true) }} style={S.bigWhite}>＋ Add something we bid</button>
            ) : canEdit ? (
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
            ) : null}

            {bidItems.map(b => (
              <div key={b.id} style={S.bidRow}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{catEmoji(b.category)} {b.item}</div>
                {(b.notes || '').includes(TRUE_COST_NEEDLE) && (
                  canEdit ? (
                    <button onClick={() => startEdit(b)} style={{ ...S.trueCostBadge, cursor: 'pointer' }} title="Tap to enter the true cost">
                      ⚠️ True cost needed — tap to fix →
                    </button>
                  ) : (
                    <div style={S.trueCostBadge}>⚠️ True cost needed</div>
                  )
                )}
                <div style={{ fontSize: 15, color: '#57544c', marginTop: 2 }}>
                  {b.qty} {b.unit} · costs us <strong>{money(num(b.qty) * num(b.unit_cost))}</strong> · we charge <strong>{money(num(b.qty) * num(b.unit_billable))}</strong>
                  {num(b.contingency_pct) > 0 && <span> · holds back {b.contingency_pct}%</span>}
                </div>
                {b.notes ? <div style={{ fontSize: 14, color: '#8a8578', fontStyle: 'italic' }}>📝 {b.notes}</div> : null}
                {canEdit && (
                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <button onClick={() => startEdit(b)} style={S.navBtn}>✏️ Change</button>
                    {canManage && <button onClick={() => deleteBid(b.id)} style={S.navBtn}>🗑 Remove</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ================= LOG SPENDING (proper daily entry) ================= */}
        {tab === 'daily' && (
          <div style={S.card}>
            <div style={S.crewNote}>👷 <strong>Peter — skip this tab.</strong> Mike / Hanna: log every day Mon–Fri — guys & hours, fuel litres + price that day, dirt in/out, meals with receipts, subs.</div>
            {/* 1e: this log is DOLLARS. Amounts of work (m³, loads, days) go on the project page log. */}
            <button onClick={() => navigate(`/project/${id}`)} style={{ ...S.bigWhite, fontSize: 16 }}>
              📏 Logging amounts of work (not dollars)? That's on the project page →
            </button>
            <h2 style={{ fontSize: 24, margin: '12px 0 6px' }}>🧾 Log what got spent</h2>
            <p style={S.p}>Fill what you know. <strong>Either</strong> quantity + price each (e.g. 400 litres at $1.72) <strong>or</strong> just the total dollars off the receipt (e.g. $84 lunch). The Final screen updates by itself.</p>
            <button onClick={handleBlankSheet} style={S.bigWhite}>📥 Download blank daily sheet (for Excel / no-signal days)</button>

            {/* Drag-drop import: Mike drops the filled sheet, checks the preview, confirms */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleSheetFile(f) }}
              style={{ ...S.dropZone, borderColor: dragOver ? '#e8590c' : '#c8c4b7', background: dragOver ? '#fff4eb' : '#fafaf8' }}
            >
              <div style={{ fontSize: 17, fontWeight: 800 }}>📥 Drop the filled daily sheet here (.csv)</div>
              <div style={{ fontSize: 14, color: '#6e6e66', marginTop: 4 }}>or <label style={{ color: '#e8590c', fontWeight: 800, cursor: 'pointer' }}>pick the file<input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => { handleSheetFile(e.target.files?.[0]); e.target.value = '' }} /></label> — you'll check every line before anything is logged</div>
            </div>
            {importError && <p style={{ fontSize: 15, color: '#c92a2a' }}>⚠️ {importError}</p>}

            {importRows && (
              <div style={S.importBox}>
                <h3 style={S.h3}>Check these {importRows.length} lines, then confirm 👇</h3>
                <p style={S.small}>Green rows will be logged. Red rows need attention first — pick the right bid line or fix the sheet.</p>
                {importRows.map(r => (
                  <div key={r.key} style={{ ...S.importRow, borderColor: r.ok && r.bidId ? '#2b8a3e' : '#c92a2a' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{r.worker ? `${r.worker} — ` : ''}{r.desc || '(no description)'}</div>
                      <div style={{ fontSize: 14, color: '#6e6e66' }}>
                        {r.date || 'no date'} · {r.qty && r.rate ? `${r.qty} ${r.unit || ''} × $${r.rate}` : 'receipt total'} · <strong>{money(r.lineTotal)}</strong>
                        {r.hours ? ` · ${r.hours} reg` : ''}{r.ot ? ` · ${r.ot} OT` : ''}
                      </div>
                      {!r.ok && <div style={{ fontSize: 14, color: '#c92a2a', fontWeight: 700 }}>⚠️ {!/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? 'bad date (use YYYY-MM-DD)' : r.lineTotal <= 0 ? 'no amount' : ''}</div>}
                      {r.ok && !r.bidId && (
                        <select value="" onChange={e => setImportRows(prev => prev.map(x => x.key === r.key ? { ...x, bidId: e.target.value || null, ok: !!e.target.value } : x))} style={{ ...S.finput, marginTop: 6, padding: 10, fontSize: 15 }}>
                          <option value="">⚠️ "{r.lineName}" didn't match — pick the bid line…</option>
                          {bidItems.map(b => <option key={b.id} value={b.id}>{catEmoji(b.category)} {b.item}</option>)}
                        </select>
                      )}
                      {r.ok && r.bidId && r.lineName !== (bidItems.find(b => String(b.id) === String(r.bidId))?.item || '') && (
                        <div style={{ fontSize: 13, color: '#6e6e66' }}>→ {bidItems.find(b => String(b.id) === String(r.bidId))?.item}</div>
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={confirmImport} disabled={importing || !importRows.some(r => r.ok && r.bidId)} style={S.bigOrange}>
                    {importing ? 'Logging…' : `✓ Log ${importRows.filter(r => r.ok && r.bidId).length} lines (${money(importRows.filter(r => r.ok && r.bidId).reduce((s, r) => s + r.lineTotal, 0))})`}
                  </button>
                  <button onClick={() => setImportRows(null)} style={S.navBtn}>Cancel</button>
                </div>
              </div>
            )}

            {lastLogged && (
              <div style={S.loggedOk}>✓ Logged: {lastLogged.text}</div>
            )}

            <form onSubmit={saveDaily} style={S.stackForm}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={S.flabel}>Which day?
                  <input type="date" value={dForm.date} onChange={e => { setDForm({ ...dForm, date: e.target.value }); setLastLogged(null) }} style={{ ...S.finput, fontSize: 20 }} />
                </label>
                <label style={S.flabel}>Who did it? (name — for payroll)
                  <input list="gz-workers" placeholder="e.g. Mike" value={dForm.worker} onChange={e => setDForm({ ...dForm, worker: e.target.value })} style={S.finput} />
                  <datalist id="gz-workers">
                    {[...new Set(costs.map(c => c.worker).filter(Boolean))].map(w => <option key={w} value={w} />)}
                  </datalist>
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={S.flabel}>Regular hours
                  <input type="number" step="any" placeholder="e.g. 8" value={dForm.hours} onChange={e => setDForm({ ...dForm, hours: e.target.value })} style={S.finput} />
                </label>
                <label style={S.flabel}>OT hours
                  <input type="number" step="any" placeholder="e.g. 2" value={dForm.ot} onChange={e => setDForm({ ...dForm, ot: e.target.value })} style={S.finput} />
                </label>
              </div>
              <label style={S.flabel}>Which part of the bid is this for?
                <select value={dForm.bid_item_id} onChange={e => {
                  const nb = bidItems.find(b => String(b.id) === String(e.target.value))
                  setDForm(f => ({
                    ...f,
                    bid_item_id: e.target.value,
                    // Pre-fill the usual unit + rate from the bid line (setup-once
                    // data). Mike only changes them when today was different.
                    unit: nb?.unit || f.unit,
                    rate: nb ? String(nb.unit_cost ?? '') : f.rate,
                  }))
                }} style={S.finput}>
                  <option value="">Not sure / general</option>
                  {bidItems.map(b => <option key={b.id} value={b.id}>{catEmoji(b.category)} {b.item}</option>)}
                </select>
              </label>
              {(() => {
                const linked = bidItems.find(b => String(b.id) === String(dForm.bid_item_id))
                return linked ? (
                  <p style={S.small}>Usual: {linked.qty} {linked.unit} @ {moneyExact(num(linked.unit_cost))} each (from the bid — only change it below if today was different).</p>
                ) : null
              })()}
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
                  {dForm.worker ? ` · ${dForm.worker}` : ''}{num(dForm.hours) ? ` · ${dForm.hours} reg` : ''}{num(dForm.ot) ? ` · ${dForm.ot} OT` : ''} on {dForm.date ? dayName(dForm.date) : '…'}
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
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{c.worker ? `${c.worker} — ` : ''}{c.description}</div>
                  <div style={{ fontSize: 14, color: '#6e6e66' }}>
                    {c.qty && c.unit && c.unit_actual ? `${c.qty} ${c.unit} × $${c.unit_actual}` : 'Receipt total'}
                    {c.hours ? ` · ${c.hours} reg` : ''}{c.hours_ot ? ` · ${c.hours_ot} OT` : ''}{c.receipt_notes ? ` · 🧾 ${c.receipt_notes}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 19, fontWeight: 800 }}>{money(num(c.qty) * num(c.unit_actual))}</div>
                  {canManage && <button onClick={() => deleteCost(c.id)} style={S.navBtn}>🗑</button>}
                </div>
              </div>
            ))}
            {costs.filter(c => c.date === dForm.date).length === 0 && <p style={S.p}>Nothing logged for this day yet.</p>}

            <h3 style={{ ...S.h3, marginTop: 20 }}>Latest spending (newest first)</h3>
            {costs.filter(c => c.date !== dForm.date).slice(0, 20).map(c => (
              <div key={c.id} style={S.spendRow}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>{c.worker ? `${c.worker} — ` : ''}{c.description}</div>
                  <div style={{ fontSize: 14, color: '#6e6e66' }}>{c.date}{c.hours ? ` · ${c.hours} reg` : ''}{c.hours_ot ? ` · ${c.hours_ot} OT` : ''}{c.receipt_notes ? ` · 🧾 ${c.receipt_notes}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 19, fontWeight: 800 }}>{money(num(c.qty) * num(c.unit_actual))}</div>
                  {canManage && <button onClick={() => deleteCost(c.id)} style={S.navBtn}>🗑</button>}
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
                    {canManage && <button onClick={() => deleteDoc(f)} style={S.navBtn}>🗑</button>}
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
  warnBanner: { background: '#fff4e6', border: '2px solid #e8590c', borderRadius: 12, padding: '14px 16px', fontSize: 17, fontWeight: 700, color: '#7c4a12', marginBottom: 14 },
  warnBtn: { display: 'block', marginTop: 10, background: '#e8590c', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 18px', fontSize: 17, fontWeight: 800, cursor: 'pointer', width: '100%' },
  trueCostBadge: { display: 'inline-block', fontSize: 14, fontWeight: 800, background: '#fff4e6', color: '#a8380d', border: '2px solid #f0a35e', padding: '4px 12px', borderRadius: 20, marginTop: 8 },
  shareBtns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 8, marginBottom: 10 },
  shareBtn: { background: '#14202b', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 10px', fontSize: 16, fontWeight: 800, cursor: 'pointer' },
  summaryPreview: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, background: '#fafaf8', border: '2px solid #e8e6df', borderRadius: 10, padding: '12px 14px', color: '#333', maxHeight: 260, overflowY: 'auto', margin: 0 },
  loggedOk: { background: '#d3f9d6', border: '2px solid #2b8a3e', color: '#2b8a3e', borderRadius: 10, padding: '12px 16px', fontSize: 16, fontWeight: 700, marginBottom: 12 },
  detailBox: { background: '#fff', border: '2px dashed #d4d0c8', borderRadius: 10, padding: 14 },
  dropZone: { border: '2px dashed #c8c4b7', borderRadius: 10, padding: '16px', textAlign: 'center', marginTop: 10, marginBottom: 6 },
  importBox: { background: '#fff', border: '2px solid #14202b', borderRadius: 10, padding: 14, marginTop: 10, marginBottom: 12 },
  importRow: { border: '2px solid #e8e6df', borderRadius: 8, padding: '10px 12px', marginBottom: 8, display: 'flex', gap: 8 },
}
