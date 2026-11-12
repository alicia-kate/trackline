import type { Item } from '../types'
import { CURRENCY, expiryOf } from './rules'

const stamp = () => new Date().toISOString().slice(0, 10)

function save(blob: Blob, file: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = file
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Plain CSV, kept for anything that needs it. */
export function exportCsv(name: string, head: string[], rows: (string | number)[][]) {
  const q = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const text = [head, ...rows].map((r) => r.map(q).join(',')).join('\r\n')
  save(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }), `${name}-${stamp()}.csv`)
}

export interface Sheet { name: string; head: string[]; rows: (string | number)[][] }

/** A real Excel workbook (.xlsx): bold header, frozen first row, filter buttons, sensible column widths. One or more sheets. */
export async function exportWorkbook(name: string, sheets: Sheet[]) {
  const { default: ExcelJS } = await import('exceljs') // loaded only when someone exports
  const wb = new ExcelJS.Workbook()
  for (const { name: sheet, head, rows } of sheets) {
    const ws = wb.addWorksheet(sheet.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report')
    ws.addRow(head)
    rows.forEach((r) => ws.addRow(r.map((v) => (v === '' || v == null ? null : v))))
    const h = ws.getRow(1)
    h.font = { bold: true }
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEFC' } }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    if (head.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: head.length } }
    head.forEach((t, c) => {
      const longest = Math.max(t.length, ...rows.slice(0, 500).map((r) => String(r[c] ?? '').length))
      ws.getColumn(c + 1).width = Math.min(Math.max(longest + 2, 10), 50)
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  save(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}-${stamp()}.xlsx`)
}

export const exportXlsx = (name: string, head: string[], rows: (string | number)[][]) => exportWorkbook(name, [{ name, head, rows }])

export const exportPdf = () => window.print()

export const ITEM_HEAD = ['Item ID', 'Category', 'Item name', 'Description', 'Make', 'Model', 'Serial / key', 'MG No', 'Quantity', 'Purchase date', `Cost (${CURRENCY})`, 'Project', 'Vendor', 'Warranty / renewal expiry', 'Warranty / support terms', 'Status', 'Location', 'OIC', 'Current user', 'Department', 'Active']
export const itemRow = (i: Item): (string | number)[] => [i.id, i.c, i.desc, i.use, i.make, i.model, i.c === 'License' ? '' : i.sn, i.mg, i.qty, i.date, i.cost, i.project, i.vendor, expiryOf(i), i.winfo, i.status, i.loc, i.oic, i.user, i.dept, i.active ? 'Yes' : 'No']
