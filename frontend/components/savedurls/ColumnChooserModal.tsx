import React from 'react';

type Visible = { name: boolean; date: boolean; type: boolean; size: boolean };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  visible: Visible;
  onChange: (next: Visible) => void;
  onResetWidths: () => void;
  onAutoSize: () => void;
};

const ColumnChooserModal: React.FC<Props> = ({
  isOpen, onClose, visible, onChange, onResetWidths, onAutoSize,
}) => {
  if (!isOpen) return null;

  const set = (k: keyof Visible, v: boolean) => onChange({ ...visible, [k]: v });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b dark:border-gray-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Choose columns</h3>
          <button className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onClose}>✕</button>
        </div>

        <div className="p-4 space-y-3">
          {(['name','date','type','size'] as const).map(k => (
            <label key={k} className="flex items-center gap-3 px-2 py-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
              <input type="checkbox" checked={visible[k]} onChange={(e)=>set(k, e.currentTarget.checked)} />
              <span className="capitalize">{k === 'date' ? 'Date modified' : k}</span>
            </label>
          ))}

          <div className="flex gap-2 pt-2">
            <button
              className="px-3 py-1.5 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => onChange({ name: true, date: true, type: true, size: true })}
            >Select all</button>
            <button
              className="px-3 py-1.5 rounded border hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => onChange({ name: false, date: false, type: false, size: false })}
            >None</button>
          </div>

          <div className="border-t dark:border-gray-800 pt-3 flex gap-2">
            <button className="px-3 py-1.5 rounded border hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onResetWidths}>
              Reset widths
            </button>
            <button className="px-3 py-1.5 rounded border hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onAutoSize}>
              Auto-size to fit
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-t dark:border-gray-800 flex justify-end">
          <button className="px-3 py-1.5 rounded border hover:bg-gray-100 dark:hover:bg-gray-800" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default ColumnChooserModal;
