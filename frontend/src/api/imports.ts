import { api, apiUpload } from './client'
import type { ImportCheck, ImportResult, ImportRow, NewMasters } from '../types'

export const IMPORT_TEMPLATE_URL = '/api/import/template'

const plain = (rows: ImportRow[]) => rows.map(({ key, c, n, f }) => ({ key, c, n, f }))

/** Reads the Excel file and checks every row. Nothing is saved. */
export function checkImportFile(file: File) {
  const form = new FormData()
  form.append('file', file)
  return apiUpload<ImportCheck>('/import/check', form)
}

/** Checks the rows again after edits on the page. Nothing is saved. */
export const checkImportRows = (rows: ImportRow[], news: NewMasters) => api<{ rows: ImportRow[] }>('/import/check-rows', { method: 'POST', body: { rows: plain(rows), new: news } })

/** Saves the rows. By default every row must be clean; onlyValid is the deliberate "skip the bad rows" option. */
export const commitImport = (rows: ImportRow[], onlyValid: boolean, news: NewMasters) => api<ImportResult>('/import/commit', { method: 'POST', body: { rows: plain(rows), only_valid: onlyValid, new: news } })
