import { useState, useEffect } from 'react';

export type DeviceType = 'desktop' | 'tablet' | 'mobile';

interface DeviceInfo {
  device: DeviceType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  hasTouch: boolean;
  width: number;
  height: number;
}

/**
 * Custom React hook for dynamic device detection (Desktop, Tablet, Mobile)
 * Blends JS capability detection (Touch + UserAgent parsing) with window media query widths 
 * to handle fluid layouts dynamically with 0% layout flickering.
 */
export function useDeviceType(): DeviceInfo {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>(() => {
    // SSR / Initial Render Safe Default Values consistent with standard desktop layout
    const isClient = typeof window !== 'undefined';
    const initialWidth = isClient ? window.innerWidth : 1200;
    const initialHeight = isClient ? window.innerHeight : 800;
    
    return {
      device: 'desktop',
      isMobile: false,
      isTablet: false,
      isDesktop: true,
      hasTouch: false,
      width: initialWidth,
      height: initialHeight,
    };
  });

  useEffect(() => {
    const handleDeviceCheck = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      // 1. Touch Capability Check
      const hasTouch = 
        'ontouchstart' in window || 
        navigator.maxTouchPoints > 0 || 
        (navigator as any).msMaxTouchPoints > 0;
      
      // 2. UserAgent Parsing heuristics
      const ua = navigator.userAgent.toLowerCase();
      const isMobileUA = /android|iphone|ipod|blackberry|iemobile|opera mini/i.test(ua);
      const isTabletUA = /(ipad|tablet|(android(?!.*mobile))|xoom|macintosh)/i.test(ua) && hasTouch;

      // 3. Combined Decision Logic mapping to actual app viewport layout rules
      let device: DeviceType = 'desktop';

      if (width < 768) {
        device = 'mobile';
      } else if (width >= 768 && width <= 1024) {
        // Standard vertical/horizontal tablets
        device = 'tablet';
      } else {
        // High-resolution tablets (e.g., iPad Pro portrait or land)
        if (isTabletUA || (hasTouch && isMobileUA)) {
          device = 'tablet';
        } else {
          device = 'desktop';
        }
      }

      setDeviceInfo({
        device,
        isMobile: device === 'mobile',
        isTablet: device === 'tablet',
        isDesktop: device === 'desktop',
        hasTouch,
        width,
        height,
      });
    };

    // Run lookup immediately on client mount
    handleDeviceCheck();

    // Attach passive resize event listener for real-time update support (rotation/window resizing)
    window.addEventListener('resize', handleDeviceCheck, { passive: true });
    
    return () => {
      window.removeEventListener('resize', handleDeviceCheck);
    };
  }, []);

  return deviceInfo;
}
