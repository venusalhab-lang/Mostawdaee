import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { sounds } from '../../lib/sounds';

interface InteractiveButtonProps {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children?: React.ReactNode;
  shortcut?: string;
  tooltipText?: string;
  isRtl?: boolean;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}

export default function InteractiveButton({
  onClick,
  children,
  shortcut = "Ctrl + S",
  tooltipText,
  isRtl = true,
  className = "",
  disabled = false,
  type = "button"
}: InteractiveButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!disabled) {
      sounds.playPop();
      if (onClick) {
        onClick(e);
      }
    }
  };

  const defaultTooltip = isRtl 
    ? `اضغط ${shortcut} للحفظ السريع`
    : `Press ${shortcut} to save`;

  return (
    <div 
      className="relative inline-block font-sans"
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Interactive Button with premium design */}
      <motion.button
        type={type}
        disabled={disabled}
        whileHover={disabled ? {} : { scale: 1.05, y: -2 }}
        whileTap={disabled ? {} : { scale: 0.95 }}
        onClick={handleClick}
        className={`px-6 py-3 bg-gradient-to-r from-indigo-600/90 to-indigo-700/95 dark:from-indigo-600/20 dark:to-indigo-500/10 backdrop-blur-md border border-indigo-500/40 dark:border-indigo-400/20 text-white rounded-xl shadow-lg hover:shadow-indigo-500/20 dark:hover:shadow-indigo-500/5 transition-all duration-300 font-bold tracking-wide flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {children || (isRtl ? "حفظ البيانات" : "Save Changes")}
      </motion.button>

      {/* Floating glassmorphic shortcuts overlay with fluid spring physical motion */}
      <AnimatePresence>
        {isHovered && !disabled && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, y: 6, scale: 0.95, x: '-50%' }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-full left-1/2 mb-2 flex flex-col items-center z-50 pointer-events-none"
          >
            <div className="bg-slate-900/95 dark:bg-[#0c1221]/95 border border-slate-700/50 dark:border-white/10 backdrop-blur-md text-[11px] font-semibold text-gray-100 px-3 py-1.5 rounded-lg shadow-2xl whitespace-nowrap flex items-center gap-2 font-sans">
              <span>{tooltipText || defaultTooltip}</span>
              <kbd className="bg-white/15 dark:bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-sans font-bold border border-white/10 text-white shadow-xs">
                {shortcut}
              </kbd>
            </div>
            {/* Subtle micro arrow pointer at bottom of floating panel */}
            <div className="w-1.5 h-1.5 bg-slate-900/95 dark:bg-[#0c1221]/95 rotate-45 -mt-0.5 border-r border-b border-slate-700/50 dark:border-white/10"></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
