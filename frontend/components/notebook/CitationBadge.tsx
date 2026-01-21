export default function CitationBadge({
  index,
  citation,
  onOpenSource,
}: {
  index: number;
  citation: {
    chunkId: string;
    quote: string;
    pageStart?: number | null;
    pageEnd?: number | null;
  };
  onOpenSource?: (c: any) => void;
}) {
  const page =
    citation.pageStart != null
      ? `p.${citation.pageStart}${
          citation.pageEnd != null && citation.pageEnd !== citation.pageStart
            ? `–${citation.pageEnd}`
            : ""
        }`
      : null;

  return (
    <button
      type="button"
      onClick={() => onOpenSource?.(citation)}
      className="inline-flex items-center justify-center ml-0.5 px-2 h-4 rounded-md
                 text-indigo-700 bg-indigo-50 border border-indigo-200 text-[10px] leading-4
                 hover:bg-indigo-100 hover:border-indigo-300 transition gap-1"
      title={citation.quote || "Open evidence"}
      aria-label={`Open evidence ${index}`}
    >
      <span>{index}</span>
      {page ? <span className="text-indigo-500">{page}</span> : null}
    </button>
  );
}

