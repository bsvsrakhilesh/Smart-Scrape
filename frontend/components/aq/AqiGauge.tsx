import { motion } from "framer-motion";

const bands = [
  { upTo: 50,  color: "#22c55e", label: "Good" },
  { upTo: 100, color: "#84cc16", label: "Satisfactory" },
  { upTo: 200, color: "#f59e0b", label: "Moderate" },
  { upTo: 300, color: "#ef4444", label: "Poor" },
  { upTo: 400, color: "#a855f7", label: "Very Poor" },
  { upTo: 500, color: "#6b21a8", label: "Severe" },
];
const colorForAQI = (aqi: number) => bands.find(b => aqi <= b.upTo)?.color ?? "#6b21a8";
const labelForAQI = (aqi: number) => bands.find(b => aqi <= b.upTo)?.label ?? "Severe";

export default function AqiGauge({ aqi = 118 }: { aqi?: number }) {
  const angle = Math.min(180, Math.max(0, (aqi / 500) * 180));
  const color = colorForAQI(aqi);
  return (
    <div className="flex items-center gap-4">
      <svg width="160" height="100" viewBox="0 0 160 100" className="overflow-visible" aria-hidden>
        <path d="M10 90 A70 70 0 0 1 150 90" fill="none" stroke="rgba(2,6,23,0.08)" strokeWidth="14" />
        <motion.path d="M10 90 A70 70 0 0 1 150 90" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
          style={{ pathLength: (aqi / 500) }} initial={{ pathLength: 0 }} animate={{ pathLength: (aqi / 500) }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
        <circle cx="80" cy="90" r="3" fill="#0f172a" />
        <motion.line x1="80" y1="90" x2="80" y2="24" stroke="#0f172a" strokeWidth="3" strokeLinecap="round"
          style={{ originX: 80, originY: 90 }} initial={{ rotate: 0 }} animate={{ rotate: angle }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
      </svg>
      <div>
        <div className="text-3xl font-bold leading-none">{aqi}</div>
        <div className="text-sm text-slate-600">{labelForAQI(aqi)}</div>
      </div>
    </div>
  );
}
