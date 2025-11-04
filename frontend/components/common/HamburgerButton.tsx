// frontend/components/HamburgerButton.tsx
import { motion, type Transition } from 'framer-motion';

type Props = {
  open: boolean;
  onClick: () => void;
  className?: string;
  label?: string;
};

// Strongly-typed spring for all three lines
const LINE_TRANSITION: Transition = { type: 'spring', stiffness: 500, damping: 30 };

export default function HamburgerButton({
  open,
  onClick,
  className = '',
  label = 'Toggle navigation',
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      onClick={onClick}
      className={`relative h-10 w-10 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-primary/40 ${className}`}
    >
      {/* Top line */}
      <motion.span
        className="absolute left-2 right-2 top-[11px] h-[2px] bg-gray-800 dark:bg-gray-100"
        animate={open ? { y: 8, rotate: 45 } : { y: 0, rotate: 0 }}
        transition={LINE_TRANSITION}
      />
      {/* Middle line */}
      <motion.span
        className="absolute left-2 right-2 top-[18px] h-[2px] bg-gray-800 dark:bg-gray-100"
        animate={open ? { opacity: 0, scaleX: 0.3 } : { opacity: 1, scaleX: 1 }}
        transition={LINE_TRANSITION}
        style={{ transformOrigin: 'center' }}
      />
      {/* Bottom line */}
      <motion.span
        className="absolute left-2 right-2 top-[25px] h-[2px] bg-gray-800 dark:bg-gray-100"
        animate={open ? { y: -8, rotate: -45 } : { y: 0, rotate: 0 }}
        transition={LINE_TRANSITION}
      />
    </button>
  );
}
