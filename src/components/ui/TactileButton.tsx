import React from 'react';
import { motion, HTMLMotionProps } from 'motion/react';
import { sounds } from '../../lib/sounds';

interface TactileButtonProps extends HTMLMotionProps<"button"> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
  fullWidth?: boolean;
}

export function TactileButton({ 
  children, 
  className = '', 
  variant = 'primary', 
  fullWidth = false,
  onClick,
  ...props 
}: TactileButtonProps) {
  
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    sounds.playPop();
    if (onClick) {
      // Correctly cast the event for the original onClick handler
      onClick(e as any);
    }
  };

  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100 dark:shadow-indigo-900/30',
    secondary: 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 shadow-sm',
    danger: 'bg-rose-500 text-white hover:bg-rose-600 shadow-rose-100 dark:shadow-rose-900/30',
    success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-100 dark:shadow-emerald-900/30',
    ghost: 'bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-500'
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
      onClick={handleClick}
      className={`
        px-6 py-3 rounded-2xl font-bold transition-colors flex items-center justify-center gap-2 
        ${fullWidth ? 'w-full' : ''} 
        ${variants[variant]} 
        ${className}
      `}
      {...props}
    >
      {children}
    </motion.button>
  );
}
