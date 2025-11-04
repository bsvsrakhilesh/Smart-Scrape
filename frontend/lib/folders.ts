import { listFolders } from './api'
import type { FolderNode } from '../types/file'

const toNode = (x: { id: string; name: string }): FolderNode =>
  ({ id: x.id, name: x.name ?? 'Folder', hasChildren: true })

// Root = "root" (matches your repo)
export async function fetchRootFolders(): Promise<FolderNode[]> {
  const rows = await listFolders('root')
  return rows.map(toNode).sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchChildren(id: string): Promise<FolderNode[]> {
  const rows = await listFolders(id)
  return rows.map(toNode).sort((a, b) => a.name.localeCompare(b.name))
}
