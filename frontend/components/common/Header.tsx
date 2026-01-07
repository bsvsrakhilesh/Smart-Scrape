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
   <div className="app-header w-full z-[100] bg-background/80 backdrop-blur-xl border-b border-border/60 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
      <div
        className="app-header__inner h-24 lg:h-[72px] flex items-center justify-between gap-2 max-w-screen-2xl mx-auto w-full transition-[height] duration-200"
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
            className="group rounded-lg px-2 py-1 flex items-center gap-2 hover:bg-muted/70 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-primary/60"
            title="Home"
            aria-label="Smart Scrape Home"
          >
            <span className="flex items-center gap-2">
              <span className="relative inline-flex">
              <img src="/assets/logo.png" alt="Smart Scrape" className="w-6 h-6 rounded shadow-sm transition-transform duration-200 group-hover:scale-[1.04]" />
              <span className="pointer-events-none absolute inset-0 rounded-full ring-0 ring-brand-primary/40 opacity-0 group-hover:opacity-100 group-hover:ring-2 transition-all duration-200" />
              </span>
              <span className="hidden sm:inline text-sm font-semibold tracking-wide">
                Smart Scrape
              <span className="block h-[2px] w-0 bg-gradient-to-r from-brand-primary/80 to-brand-secondary/80 rounded-full mt-[2px] group-hover:w-full transition-all duration-200 ease-out" />
              </span>
            </span>
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1">
          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ y: 0 }}
            className="icon-button hover-lift rounded-xl border border-transparent bg-background/70 shadow-sm ring-offset-background ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 transition-all duration-200 hover:bg-foreground/5 hover:border-border/70"
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={18} />
          </motion.button>

          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ y: 0 }}
            className="icon-button hover-lift rounded-xl border border-transparent bg-background/70 shadow-sm ring-offset-background ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 transition-all duration-200 hover:bg-foreground/5 hover:border-border/70"
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={18} />
          </motion.button>

          <motion.button
            whileHover={{ y: -1 }}
            whileTap={{ y: 0 }}
            className="icon-button hover-lift rounded-xl border border-transparent bg-background/70 shadow-sm ring-offset-background ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 transition-all duration-200 hover:bg-foreground/5 hover:border-border/70"
            title="Account"
            aria-label="Account"
          >
            <User size={18} />
          </motion.button>
        </div>
      </div>

      {/* Thin brand accent (optional) */}
      <div className="h-[2px] bg-gradient-to-r from-brand-primary/80 via-brand-secondary/80 to-brand-primary/40" />
    </div>
  );
};

export default Header;
