import React, { useState, useRef, useEffect } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { sounds } from '../../lib/sounds';

interface TiltEffectProps {
  children: React.ReactNode;
  maxTilt?: number; // Maximum tilt rotation angle in degrees
  perspective?: number; // Perspective distance in pixels
  scale?: number; // Scale factors when active
  className?: string;
  enableGlare?: boolean; // Glass-like cursor reflective overlay
  glareMaxOpacity?: number;
  playSoundOnHover?: boolean;
}

export default function TiltEffect({
  children,
  maxTilt = 15,
  perspective = 800,
  scale = 1.05,
  className = "",
  enableGlare = true,
  glareMaxOpacity = 0.35,
  playSoundOnHover = true
}: TiltEffectProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  // High precision Framer Motion spring values to ensure hardware accelerated butter-smooth transitions
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);

  const springConfig = { damping: 25, stiffness: 220, mass: 0.6 };

  const rotateX = useSpring(useTransform(y, [0, 1], [maxTilt, -maxTilt]), springConfig);
  const rotateY = useSpring(useTransform(x, [0, 1], [-maxTilt, maxTilt]), springConfig);
  const activeScale = useSpring(1, springConfig);

  // Reflection/Glare effects coordinate transformations
  const glareX = useTransform(x, [0, 1], ["0%", "100%"]);
  const glareY = useTransform(y, [0, 1], ["0%", "100%"]);
  const glareOpacity = useSpring(0, springConfig);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Calculate normalized point location relative to component bounds (-0.5 to 0.5)
    const mouseX = (e.clientX - rect.left) / width;
    const mouseY = (e.clientY - rect.top) / height;

    x.set(mouseX);
    y.set(mouseY);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    activeScale.set(scale);
    glareOpacity.set(glareMaxOpacity);
    if (playSoundOnHover) {
      sounds.playHover();
    }
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    activeScale.set(1);
    // Smoothly reset tilt angles back to standard center
    x.set(0.5);
    y.set(0.5);
    glareOpacity.set(0);
  };

  return (
    <motion.div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        transformStyle: 'preserve-3d',
        perspective: perspective,
        rotateX: rotateX,
        rotateY: rotateY,
        scale: activeScale,
      }}
      className={`relative inline-block transition-shadow duration-300 rounded-xl ${
        isHovered ? 'shadow-2xl shadow-indigo-500/10' : ''
      } ${className}`}
    >
      {/* 3D preserve element wrapper */}
      <div 
        style={{ transform: 'translateZ(10px)', transformStyle: 'preserve-3d' }}
        className="w-full h-full relative z-10"
      >
        {children}
      </div>

      {/* Dynamic Glare Reflection Overlay */}
      {enableGlare && (
        <motion.div
          style={{
            opacity: glareOpacity,
            background: `radial-gradient(circle at ${glareX.get()} ${glareY.get()}, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 80%)`,
            mixBlendMode: 'overlay',
          }}
          className="absolute inset-0 z-20 pointer-events-none rounded-xl transition-opacity duration-350 overflow-hidden"
        />
      )}
    </motion.div>
  );
}
