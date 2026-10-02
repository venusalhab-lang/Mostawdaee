import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import Logo from './Logo';

interface TechSplashScreenProps {
  onComplete: () => void;
  language: 'ar' | 'en';
}

export default function TechSplashScreen({ onComplete, language }: TechSplashScreenProps) {
  const [progress, setProgress] = useState(0);
  const isRtl = language === 'ar';

  useEffect(() => {
    const duration = 2200; // 2.2 seconds total boot time
    const intervalTime = 20; // update every 20ms
    const step = (100 / (duration / intervalTime));

    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev + step;
        if (next >= 100) {
          clearInterval(timer);
          // Allow slightly delayed completion so progress stays at 100% briefly before fading out
          setTimeout(() => {
            onComplete();
          }, 300);
          return 100;
        }
        return next;
      });
    }, intervalTime);

    return () => clearInterval(timer);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5, ease: "easeInOut" } }}
      className="fixed inset-0 z-[99999] bg-gradient-to-br from-[#0F2027] via-[#203A43] to-[#2C5364] flex flex-col items-center justify-center select-none"
    >
      <div className="flex flex-col items-center justify-center">
        {/* Technological 3D active spinning and floating logo asset */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 100, damping: 15 }}
          className="relative w-[200px] h-[200px] flex items-center justify-center"
        >
          {/* Subtle glow sphere behind the 3D rotating box */}
          <div className="absolute inset-4 rounded-full bg-cyan-400/10 blur-[50px] pointer-events-none animate-pulse" />
          
          <Logo size={150} animate3d={true} />
        </motion.div>

        {/* Welcoming tech title with elegant spacing */}
        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.7 }}
          className="text-white text-[26px] font-black tracking-widest mt-[30px] font-arabic leading-snug drop-shadow-md text-center"
        >
          {isRtl ? 'مُسْتَوْدَعِي' : "MOSTAWDA'I"}
        </motion.h1>

        {/* Loading progress descriptor or subtext */}
        <motion.p
          initial={{ y: 15, opacity: 0 }}
          animate={{ y: 0, opacity: 0.7 }}
          transition={{ delay: 0.4, duration: 0.7 }}
          className="text-cyan-200/60 text-[10px] font-mono uppercase tracking-[0.2em] mt-[6px] mb-5 text-center"
        >
          {isRtl ? 'جاري تهيئة منظومة المخازن...' : 'INITIALIZING WORKSPACE...'}
        </motion.p>

        {/* Dynamic, thin load indicator resembling the LinearProgressIndicator */}
        <motion.div
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="w-[100px] h-[2px] bg-white/10 rounded-full overflow-hidden relative"
        >
          <div
            className="absolute top-0 bottom-0 left-0 bg-[#00D2FF] shadow-[0_0_8px_#00D2FF] rounded-full transition-all duration-75 ease-out"
            style={{ width: `${progress}%` }}
          />
        </motion.div>
      </div>

      {/* Modern thin security status line */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[9px] text-white/30 font-mono tracking-widest uppercase">
         SECURE BOOT INTERFACE OK // {Math.round(progress)}%
      </div>
    </motion.div>
  );
}
