export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 rounded-md bg-gray-200/70 animate-pulse" />
      ))}
    </div>
  );
}

export function BlockSkeleton() {
  return <div className="h-24 rounded-md bg-gray-200/70 animate-pulse" />;
}
