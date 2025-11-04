// Basic ids
export type NodeId = string;

// Tree node used by the left sidebar tree
export type FolderNode = {
  id: NodeId;
  name: string;
  path?: string;
  hasChildren: boolean;   // set true or based on childCount if you have it
  isLoading?: boolean;
};

// Your general file/folder item (align with your existing shapes if needed)
export type FileItem = {
  id: string;
  name: string;
  isFolder: boolean;
  mimeType?: string;
  size?: number;
  parentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};
