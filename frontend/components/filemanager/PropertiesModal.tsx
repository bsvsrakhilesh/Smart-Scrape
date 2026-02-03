import React from 'react';
import { FileItem } from '../../lib/types';
import { formatBytes } from '../../utils/fileHelpers';

type PropertiesModalProps = {
  file: FileItem | null;
  isOpen: boolean;
  onClose: () => void;
};

const PropertiesModal: React.FC<PropertiesModalProps> = ({ file, isOpen, onClose }) => {
  if (!isOpen || !file) return null;

  const details = [
    { label: 'Name', value: file.title },
    { label: 'Type', value: file.mimeType || 'Unknown' },
    { label: 'Size', value: file.size ? formatBytes(file.size) : 'Unknown' },
    { label: 'Date Modified', value: file.uploadDate ? new Date(file.uploadDate).toLocaleString() : 'Unknown' },
    { label: 'Visibility', value: file.visibility || 'Private' },
    { label: 'Tags', value: file.tags?.join(', ') || 'None' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-surface shadow-2xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-lg font-semibold">Properties</h3>
          <button className="btn-ghost text-sm px-3" onClick={onClose}>Close</button>
        </div>
        <div className="p-5 space-y-4">
          {details.map(({ label, value }) => (
            <div key={label} className="flex justify-between">
              <span className="text-muted">{label}:</span>
              <span className="text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PropertiesModal;
