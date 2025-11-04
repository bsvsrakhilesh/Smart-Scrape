import { motion } from "framer-motion";

export default function Co2Wave({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 80" className={className} aria-hidden>
      <defs>
        <linearGradient id="co2g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(99,102,241,0.6)" />
          <stop offset="100%" stopColor="rgba(147,51,234,0.6)" />
        </linearGradient>
      </defs>
      <motion.path
        d="M 0 40 C 60 10, 120 70, 180 40 S 300 10, 360 40  480 70, 540 40  600 10, 660 40"
        fill="none" stroke="url(#co2g)" strokeWidth="3" strokeLinecap="round"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
      />
    </svg>
  );
}
