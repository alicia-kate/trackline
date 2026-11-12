import { clearItems, loadItems } from './items'
import { clearMasters, loadMasters } from './masters'
import { clearRequests, loadRequests } from './requests'

export const loadAll = () => Promise.all([loadItems(), loadMasters(), loadRequests()]).then(() => undefined)
export const clearAll = () => { clearItems(); clearMasters(); clearRequests() }
