type Props = {
  content: string;
  onRegenerate?: () => void;
  onAddToNotes?: (md: string) => void;
};

export default function MessageActions({ content, onRegenerate, onAddToNotes }: Props) {
  const copy = async () => {
    const tmp = content.replace(/<br\/?>/g, '\n').replace(/<[^>]+>/g, '');
    await navigator.clipboard.writeText(tmp);
  };

  return (
    <div className="mt-2 flex gap-2">
      <button onClick={copy} className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50">
        Copy
      </button>
      {onRegenerate && (
        <button onClick={onRegenerate} className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50">
          Regenerate
        </button>
      )}
      {onAddToNotes && (
        <button onClick={() => onAddToNotes(content)} className="text-[11px] px-2 py-1 border rounded hover:bg-gray-50">
          Add to notes
        </button>
      )}
    </div>
  );
}
