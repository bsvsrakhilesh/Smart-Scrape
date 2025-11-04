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
    <div className="bg-background/80 backdrop-blur border-b border-border">
      {/* Use same left gutter as sidebar items for crisp alignment */}
      <div
        className="h-16 lg:h-[72px] flex items-center justify-between gap-2"
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
            className="rounded-lg hover:bg-muted px-2 py-1"
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
        <motion.button whileHover={{ y: -1 }} whileTap={{ y: 0 }} className="icon-button" title="Notifications"><Bell size={18}/></motion.button>
        <motion.button whileHover={{ y: -1 }} whileTap={{ y: 0 }} className="icon-button" title="Settings"><Settings size={18}/></motion.button>
        <motion.button whileHover={{ y: -1 }} whileTap={{ y: 0 }} className="icon-button" title="Account"><User size={18}/></motion.button>
        </div>
      </div>

      {/* Thin brand accent (optional) */}
      <div className="h-1 bg-gradient-to-r from-brand-primary to-brand-secondary" />
    </div>
  );
};

export default Header;
