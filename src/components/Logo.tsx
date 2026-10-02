import React from 'react';
import { motion } from 'motion/react';

interface LogoProps {
  className?: string;
  size?: number;
  animate?: boolean;
  animate3d?: boolean;
}

export default function Logo({ className = "", size = 40, animate = false, animate3d = false }: LogoProps) {
  const containerVariants: any = {
    float: {
      y: [0, -6, 0],
      transition: {
        duration: 3.5,
        repeat: Infinity,
        ease: "easeInOut"
      }
    },
    rotate3d: {
      rotateY: [0, 360],
      y: [0, -4, 0],
      transition: {
        rotateY: {
          duration: 10, // continuous slow rotation
          repeat: Infinity,
          ease: "linear"
        },
        y: {
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut"
        }
      }
    }
  };

  const LogoContent = (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 100 100" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Premium Squircle Background with a transition from Vibrant Cyan to Rich Violet-Purple */}
      {/* A squircle is mathematically represented with smooth cubic bezier corners */}
      <path
        d="M 50,5
           C 80,5 95,20 95,50
           C 95,80 80,95 50,95
           C 20,95 5,80 5,50
           C 5,20 20,5 50,5 Z"
        fill="url(#squircle-gradient)"
        className="drop-shadow-lg"
      />

      {/* Subtle interior glow for depth and luxury feel */}
      <path
        d="M 50,8
           C 77,8 92,23 92,50
           C 92,77 77,92 50,92
           C 23,92 8,77 8,50
           C 8,23 23,8 50,8 Z"
        fill="url(#inner-glow-gradient)"
        opacity="0.15"
      />

      {/* 3D Isometric Wireframe Box (Shipping Crate) precisely aligned with the official design */}
      <g stroke="#FFFFFF" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" filter="url(#subtle-glow)">
        {/* Core Vertical Corners (Pillars) */}
        <path d="M 32,44 L 32,58.5 M 50,52.5 L 50,67 M 68,44 L 68,58.5" />
        {/* Bottom Silhouette edges */}
        <path d="M 32,58.5 L 50,67 L 68,58.5" />
        {/* Front Top rim edges */}
        <path d="M 32,44 L 50,52.5 L 68,44" />
        {/* Back Top rim edges */}
        <path d="M 32,44 L 50,35.5 L 68,44" />
        {/* Divider/Tape lines on the top face for the courier box seal */}
        <path d="M 41,39.5 L 59,48.5" strokeWidth="4.5" />
        <path d="M 44.5,41 L 62.5,50" strokeWidth="4.5" />
      </g>
      
      <defs>
        {/* Smooth premium transition matching the uploaded branding exactly */}
        <linearGradient id="squircle-gradient" x1="5" y1="95" x2="95" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00E5FF" />
          <stop offset="42%" stopColor="#2b66f5" />
          <stop offset="78%" stopColor="#4f46e5" />
          <stop offset="100%" stopColor="#6A1B9A" />
        </linearGradient>

        <radialGradient id="inner-glow-gradient" cx="50%" cy="30%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>

        {/* Gentle crisp drop shadow to make the white 3D bars pop with high depth */}
        <filter id="subtle-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.5" floodColor="#0f172a" floodOpacity="0.25" />
        </filter>
      </defs>
    </svg>
  );

  if (animate3d) {
    return (
      <motion.div 
        variants={containerVariants} 
        animate="rotate3d" 
        className="inline-block"
        style={{ perspective: 1000, transformStyle: "preserve-3d" }}
      >
        {LogoContent}
      </motion.div>
    );
  }

  if (animate) {
    return (
      <motion.div variants={containerVariants} animate="float" className="inline-block">
        {LogoContent}
      </motion.div>
    );
  }

  return LogoContent;
}

