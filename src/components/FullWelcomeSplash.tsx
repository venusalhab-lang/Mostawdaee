import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Space, Sparkles, ChevronRight, Check } from 'lucide-react';
import Logo from './Logo';

interface FullWelcomeSplashProps {
  onProceed: () => void;
  language: 'ar' | 'en';
}

export default function FullWelcomeSplash({ onProceed, language }: FullWelcomeSplashProps) {
  const isRtl = language === 'ar';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameId = useRef<number | null>(null);
  const [showButton, setShowButton] = useState(false);

  // rotation angles and breathing controllers
  const rotationAngle = useRef<number>(0);
  const pulseTime = useRef<number>(0);

  useEffect(() => {
    // Show premium proceed button after 1500ms delay for visual dramatic effect
    const btnTimer = setTimeout(() => {
      setShowButton(true);
    }, 1500);

    return () => clearTimeout(btnTimer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high-performance resize constraints
    const resizeCanvas = () => {
      canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
      canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let localAngle = 0;
    let localPulse = 0;

    interface Point3D {
      x: number;
      y: number;
      z: number;
    }

    // High fidelity Octahedron corporate structure 
    const vertices: Point3D[] = [
      { x: 0, y: -105, z: 0 },   // Top apex
      { x: 105, y: 0, z: 0 },    // Right lateral
      { x: 0, y: 0, z: 105 },    // Front lateral
      { x: -105, y: 0, z: 0 },   // Left lateral
      { x: 0, y: 0, z: -105 },   // Back lateral
      { x: 0, y: 105, z: 0 }     // Bottom apex
    ];

    const faces = [
      { indexes: [0, 1, 2] }, { indexes: [0, 2, 3] },
      { indexes: [0, 3, 4] }, { indexes: [0, 4, 1] },
      { indexes: [5, 2, 1] }, { indexes: [5, 3, 2] },
      { indexes: [5, 4, 3] }, { indexes: [5, 1, 4] }
    ];

    const rotateX = (p: Point3D, angle: number): Point3D => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: p.x, y: p.y * cos - p.z * sin, z: p.y * sin + p.z * cos };
    };

    const rotateY = (p: Point3D, angle: number): Point3D => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return { x: p.x * cos + p.z * sin, y: p.y, z: -p.x * sin + p.z * cos };
    };

    const render = () => {
      if (!ctx || !canvas) return;

      const width = canvas.width;
      const height = canvas.height;
      const originX = width / 2;
      const originY = height / 2 - 35; // slightly higher vertically

      // Slate Navy High-End Space backdrop
      const backGrad = ctx.createRadialGradient(originX, originY, 40, originX, originY, width * 0.7);
      backGrad.addColorStop(0, '#1e1e38');
      backGrad.addColorStop(0.5, '#0f172a');
      backGrad.addColorStop(1, '#020617');
      ctx.fillStyle = backGrad;
      ctx.fillRect(0, 0, width, height);

      // Render perspective grid lines
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.08)';
      const gridY = height * 0.72;
      
      // Horizontal forward moving segments
      for (let i = 0; i < 8; i++) {
        const ratio = i / 7;
        const currY = gridY + ratio * (height - gridY);
        ctx.beginPath();
        ctx.moveTo(0, currY);
        ctx.lineTo(width, currY);
        ctx.lineWidth = 1 + ratio * 1.5;
        ctx.strokeStyle = `rgba(99, 102, 241, ${0.04 + ratio * 0.1})`;
        ctx.stroke();
      }

      // Linear convergent rays
      const totalRays = 32;
      for (let i = 0; i <= totalRays; i++) {
        const startX = (i / totalRays) * width;
        const endX = originX + (i / totalRays - 0.5) * width * 3.5;
        ctx.beginPath();
        ctx.moveTo(startX, gridY);
        ctx.lineTo(endX, height);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.06)';
        ctx.stroke();
      }

      // Continuous 360-degree rotation coefficients 
      localAngle += 0.01;
      rotationAngle.current = localAngle;

      localPulse += 0.012;
      pulseTime.current = localPulse;
      const scaleMultiplier = 1.0 + Math.sin(localPulse) * 0.04;

      const transformed = vertices.map(v => {
        let scaled = { x: v.x * scaleMultiplier, y: v.y * scaleMultiplier, z: v.z * scaleMultiplier };
        // Yaw & Roll mix
        let r = rotateY(scaled, localAngle * 1.2);
        r = rotateX(r, localAngle * 0.55);
        return r;
      });

      // Painter depth layout calculation
      const depthOrder = faces.map((face, index) => {
        let avgZ = 0;
        face.indexes.forEach(idx => { avgZ += transformed[idx].z; });
        return { index, score: avgZ / 3 };
      });
      depthOrder.sort((a, b) => b.score - a.score);

      // Light source position vector
      const lightSource = { x: -0.4, y: -0.8, z: 1.0 };
      const lightLength = Math.sqrt(lightSource.x*lightSource.x + lightSource.y*lightSource.y + lightSource.z*lightSource.z);
      const lightNorm = { x: lightSource.x/lightLength, y: lightSource.y/lightLength, z: lightSource.z/lightLength };

      depthOrder.forEach(fd => {
        const face = faces[fd.index];
        const v = face.indexes.map(idx => transformed[idx]);

        // Direct normal calculus
        const edgeA = { x: v[1].x - v[0].x, y: v[1].y - v[0].y, z: v[1].z - v[0].z };
        const edgeB = { x: v[2].x - v[0].x, y: v[2].y - v[0].y, z: v[2].z - v[0].z };

        const normal = {
          x: edgeA.y * edgeB.z - edgeA.z * edgeB.y,
          y: edgeA.z * edgeB.x - edgeA.x * edgeB.z,
          z: edgeA.x * edgeB.y - edgeA.y * edgeB.x
        };

        const lenNormal = Math.sqrt(normal.x*normal.x + normal.y*normal.y + normal.z*normal.z);
        if (lenNormal === 0) return;

        const normNorm = { x: normal.x/lenNormal, y: normal.y/lenNormal, z: normal.z/lenNormal };

        // Back-face cull trigger
        if (normNorm.z < -0.15) return;

        // Diffuse Lambert shader 
        const dot = normNorm.x * lightNorm.x + normNorm.y * lightNorm.y + normNorm.z * lightNorm.z;
        const diff = Math.max(0, dot);

        // Glossy specular highlight
        const ref = {
          x: 2 * diff * normNorm.x - lightNorm.x,
          y: 2 * diff * normNorm.y - lightNorm.y,
          z: 2 * diff * normNorm.z - lightNorm.z
        };
        const specular = Math.pow(Math.max(0, ref.z), 18);

        // Core corporate color combination (Deep royal indigo with glow accents)
        const baseColor = { r: 79, g: 70, b: 229 }; // Indigo-600
        const rVal = Math.min(255, Math.round(baseColor.r * 0.4 + baseColor.r * 0.45 * diff + 255 * 0.5 * specular));
        const gVal = Math.min(255, Math.round(baseColor.g * 0.4 + baseColor.g * 0.45 * diff + 255 * 0.5 * specular));
        const bVal = Math.min(255, Math.round(baseColor.b * 0.4 + baseColor.b * 0.45 * diff + 255 * 0.5 * specular));

        ctx.beginPath();
        ctx.moveTo(originX + v[0].x, originY + v[0].y);
        ctx.lineTo(originX + v[1].x, originY + v[1].y);
        ctx.lineTo(originX + v[2].x, originY + v[2].y);
        ctx.closePath();

        ctx.fillStyle = `rgb(${rVal}, ${gVal}, ${bVal})`;
        ctx.fill();

        // Rigid wire highlights
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = `rgba(129, 140, 248, 0.65)`;
        ctx.stroke();
      });

      animFrameId.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[99999] bg-[#020617] flex flex-col justify-between p-8 overflow-hidden font-sans select-none">
      
      {/* Upper subtle info metadata */}
      <div className="w-full max-w-7xl mx-auto flex items-center justify-between opacity-75 text-[10px] text-slate-400 font-mono uppercase tracking-widest pt-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span>Mostawdaee Enterprise OS</span>
        </div>
        <span>SECURE BOOT // v4.0.1</span>
      </div>

      {/* Center continuous rotating geometric mesh */}
      <div className="flex-1 w-full relative flex items-center justify-center">
        <canvas 
          ref={canvasRef}
          className="w-full h-full max-h-[70vh] max-w-4xl opacity-35"
        />

        {/* Ambient background glow ring */}
        <div className="absolute top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-indigo-650/15 rounded-full blur-[100px] pointer-events-none" />
        
        {/* Floating Glowing Brand Logo (Slide 5 representation) */}
        <div className="absolute top-[38%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10">
          <motion.div 
            initial={{ scale: 0, rotate: -35, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 22, delay: 0.2 }}
            className="splash-logo-container w-28 h-28"
          >
            {/* White 3D perspective svg logo */}
            <Logo size={75} className="splash-logo-icon" />
          </motion.div>
          
          <motion.h2
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.8 }}
            className="text-3xl font-black mt-6 tracking-tight text-white font-arabic text-center text-glow-soft"
          >
            {isRtl ? 'مُسْتَوْدَعِي' : "MOSTAWDA'I"}
          </motion.h2>
          
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.8 }}
            className="text-xs text-indigo-300 mt-2 font-mono uppercase tracking-widest text-center opacity-85"
          >
            {isRtl ? 'منظومة إدارة المخازن اللوجستية الذكية' : 'Intelligent Logistics & Inventory OS'}
          </motion.p>
        </div>
        
        {/* Animated proceed CTA fading in gracefully */}
        <AnimatePresence>
          {showButton && (
            <motion.div
              initial={{ opacity: 0, y: 35, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 15 }}
              transition={{ type: "spring", stiffness: 260, damping: 25 }}
              className="absolute bottom-[8%] left-1/2 -translate-x-1/2 z-20"
            >
              <button
                type="button"
                onClick={onProceed}
                className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-2xl shadow-indigo-600/30 font-sans tracking-wide active:scale-95 transition-all text-xs flex items-center gap-2.5 whitespace-nowrap cursor-pointer hover:shadow-cyan-500/10 hover:border-cyan-500/20 border border-slate-800"
              >
                <Sparkles size={14} className="animate-spin text-cyan-300" />
                <span>{isRtl ? 'تأكيد الهوية والدخول لنظام مستودعي' : 'VERIFY IDENTITY & ACTIVATE'}</span>
                <ChevronRight size={14} className={isRtl ? 'rotate-180' : ''} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Strict Legal Footer (Exactly 11px and matches required literal text strictly) */}
      <div className="w-full text-center pb-4 max-w-xl mx-auto z-25">
        <p className="text-[11px] text-slate-500 font-normal leading-relaxed tracking-wide select-text">
          By accessing this application, you agree to our Terms of Service & EULA and Privacy Policy. All Rights Reserved © 2026.
        </p>
      </div>

    </div>
  );
}
