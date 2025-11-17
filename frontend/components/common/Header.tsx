import React from 'react';
import HamburgerButton from './HamburgerButton';
import { Bell, Settings, User } from 'lucide-react';
import { motion } from 'framer-motion';

interface HeaderProps {
  onToggleSidebar: () => void;
  onNavigateHome: () => void;
  isSidebarOpen: boolean;
}

const Header: React.FC<HeaderProps> = ({ onToggleSidebar, onNavigateHome, isSidebarOpen }) => {
  return (
   <div className="app-header w-full z-[100] bg-background border-b border-border/70 shadow-sm">
      <div
        className="h-24 lg:h-[72px] flex items-center justify-between gap-2 max-w-screen-2xl mx-auto w-full"
        style={{ paddingLeft: 'var(--gutter-x,16px)', paddingRight: 'var(--gutter-x,16px)' }}
      >
        {/* Left: hamburger + brand */}
        <div className="flex items-center gap-1">
          <HamburgerButton
            open={isSidebarOpen}
            onClick={onToggleSidebar}
            className="inline-flex"
            label="Main menu"
          />

          <button
            onClick={onNavigateHome}
            className="rounded-lg hover:bg-muted px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 flex items-center gap-2"
            title="Home"
            aria-label="Smart Scrape Home"
          >
            <span className="flex items-center gap-2">
              <img src="/assets/logo.png" alt="Smart Scrape" className="w-6 h-6 rounded" />
              <span className="hidden sm:inline text-sm font-semibold tracking-wide">
                Smart Scrape
              </span>
            </span>
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1">
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ y: 0 }}
            className="icon-button hover-lift ring-offset-1 focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-lg"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={18} />
          </motion.button>

          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ y: 0 }}
            className="icon-button hover-lift ring-offset-1 focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-lg"
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={18} />
          </motion.button>

          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ y: 0 }}
            className="icon-button hover-lift ring-offset-1 focus-visible:ring-2 focus-visible:ring-brand-primary/40 rounded-lg"
            title="Account"
            aria-label="Account"
          >
            <User size={18} />
          </motion.button>
        </div>
      </div>

      {/* Thin brand accent (optional) */}
      <div className="h-[2px] bg-gradient-to-r from-brand-primary/70 to-brand-secondary/70" />
    </div>
  );
};

export default Header;
