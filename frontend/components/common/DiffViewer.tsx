import { useMemo } from "react";

type Op =
  | { type: "equal"; line: string }
  | { type: "add"; line: string }
  | { type: "del"; line: string };

function clampLines(lines: string[], maxLines: number) {
  if (lines.length <= maxLines) return { lines, clipped: false };
  return { lines: lines.slice(0, maxLines), clipped: true };
}

// Myers diff (line-based), dependency-free
function diffLines(a: string[], b: string[]): Op[] {
  const N = a.length;
  const M = b.length;
  const max = N + M;

  let v = new Map<number, number>();
  v.set(1, 0);
  const trace: Array<Map<number, number>> = [];

  for (let d = 0; d <= max; d++) {
    const v2 = new Map<number, number>();

    for (let k = -d; k <= d; k += 2) {
      let x: number;

      const vKMinus = v.get(k - 1) ?? -Infinity;
      const vKPlus = v.get(k + 1) ?? -Infinity;

      if (k === -d || (k !== d && vKMinus < vKPlus)) {
        x = vKPlus; // insertion
      } else {
        x = vKMinus + 1; // deletion
      }

      let y = x - k;

      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }

      v2.set(k, x);

      if (x >= N && y >= M) {
        trace.push(v2);
        // backtrack
        const ops: Op[] = [];
        let bx = N;
        let by = M;

        for (let bd = trace.length - 1; bd >= 0; bd--) {
          const vv = trace[bd];
          const kk = bx - by;

          const vvKMinus2 = vv.get(kk - 1) ?? -Infinity;
          const vvKPlus2 = vv.get(kk + 1) ?? -Infinity;

          let prevK: number;
          if (kk === -bd || (kk !== bd && vvKMinus2 < vvKPlus2)) prevK = kk + 1;
          else prevK = kk - 1;

          const prevX = vv.get(prevK) ?? 0;
          const prevY = prevX - prevK;

          while (bx > prevX && by > prevY) {
            ops.push({ type: "equal", line: a[bx - 1] });
            bx--;
            by--;
          }

          if (bd === 0) break;

          if (bx === prevX) {
            ops.push({ type: "add", line: b[by - 1] });
            by--;
          } else {
            ops.push({ type: "del", line: a[bx - 1] });
            bx--;
          }
        }

        ops.reverse();
        return ops;
      }
    }

    trace.push(v2);
    v = v2;
  }

  // fallback
  return [
    ...a.map((line) => ({ type: "del" as const, line })),
    ...b.map((line) => ({ type: "add" as const, line })),
  ];
}

export default function DiffViewer(props: {
  leftTitle: string;
  rightTitle: string;
  leftText: string;
  rightText: string;
}) {
  const { leftTitle, rightTitle, leftText, rightText } = props;

  const { ops, clipped } = useMemo(() => {
    const a = leftText.split("\n");
    const b = rightText.split("\n");

    // protect the UI from huge docs
    const A = clampLines(a, 3000);
    const B = clampLines(b, 3000);

    return {
      ops: diffLines(A.lines, B.lines),
      clipped: A.clipped || B.clipped,
    };
  }, [leftText, rightText]);

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="px-3 py-2 border-b text-xs flex items-center justify-between bg-gray-50">
        <div className="font-medium">
          {leftTitle} ↔ {rightTitle}
        </div>
        {clipped && (
          <div className="text-gray-500">
            Diff truncated (first 3000 lines).
          </div>
        )}
      </div>

      <pre className="text-xs leading-5 p-3 overflow-auto max-h-[420px] bg-white">
        {ops.map((op, idx) => {
          const prefix = op.type === "add" ? "+" : op.type === "del" ? "-" : " ";
          const cls =
            op.type === "add"
              ? "bg-green-50"
              : op.type === "del"
              ? "bg-red-50"
              : "";

          return (
            <div key={idx} className={cls}>
              <span className="select-none text-gray-400 mr-2">{prefix}</span>
              <span>{op.line}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
