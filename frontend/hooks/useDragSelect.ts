import { useRef, useState, useCallback, useEffect } from 'react';

interface UseDragSelectResult {
  // allow null in the RefObject:
  containerRef: React.RefObject<HTMLElement | null>;
  selectedIds: Set<string>;
  clearSelection: () => void;
  isDragging: boolean;
}

export function useDragSelect(): UseDragSelectResult {
  // useRef<HTMLElement | null>(null) now matches the interface
  const containerRef = useRef<HTMLElement | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      startRef.current = { x: e.pageX, y: e.pageY };
      const marquee = document.createElement('div');
      marquee.style.position = 'absolute';
      marquee.style.border = '1px dashed #2563eb';
      marquee.style.background = 'rgba(37,99,235,0.1)';
      marquee.style.pointerEvents = 'none';
      marquee.style.zIndex = '999';
      marqueeRef.current = marquee;
      document.body.appendChild(marquee);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !startRef.current || !marqueeRef.current) return;
      const { x: sx, y: sy } = startRef.current;
      const cx = e.pageX, cy = e.pageY;
      const left = Math.min(sx, cx), top = Math.min(sy, cy);
      const width = Math.abs(cx - sx), height = Math.abs(cy - sy);
      Object.assign(marqueeRef.current.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });

      const newSel = new Set<string>();
      const items = container.querySelectorAll<HTMLElement>('[data-id]');
      const mRect = { left, top, right: left + width, bottom: top + height };
      items.forEach((it) => {
        const r = it.getBoundingClientRect();
        const iRect = {
          left: r.left + window.scrollX,
          top: r.top + window.scrollY,
          right: r.left + window.scrollX + r.width,
          bottom: r.top + window.scrollY + r.height,
        };
        if (
          mRect.left < iRect.right &&
          mRect.right > iRect.left &&
          mRect.top < iRect.bottom &&
          mRect.bottom > iRect.top
        ) {
          const id = it.dataset.id;
          if (id) newSel.add(id);
        }
      });
      setSelectedIds(newSel);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      startRef.current = null;
      if (marqueeRef.current) {
        document.body.removeChild(marqueeRef.current);
        marqueeRef.current = null;
      }
    };

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (marqueeRef.current) {
        document.body.removeChild(marqueeRef.current);
        marqueeRef.current = null;
      }
    };
  }, [isDragging]);

  return { containerRef, selectedIds, clearSelection, isDragging };
}
