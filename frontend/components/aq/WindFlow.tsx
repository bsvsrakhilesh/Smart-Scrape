import { useId } from "react";
import { motion } from "framer-motion";

export default function WindFlow({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 600 200" aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(99,102,241,0.25)" />
          <stop offset="100%" stopColor="rgba(147,51,234,0.25)" />
        </linearGradient>
      </defs>
      {[0, 40, 80, 120, 160].map((y, i) => (
        <motion.path
          key={y}
          d={`M -50 ${y+30} C 150 ${y-20}, 300 ${y+80}, 650 ${y+20}`}
          fill="none" stroke={`url(#${id}-g)`} strokeWidth="2" strokeLinecap="round" strokeDasharray="14 10"
          initial={{ strokeDashoffset: 0 }} animate={{ strokeDashoffset: -48 }}
          transition={{ duration: 3 + i * 0.5, repeat: Infinity, ease: "linear" }}
        />
      ))}
    </svg>
  );
}
