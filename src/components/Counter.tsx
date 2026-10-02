import React, { useEffect, useState } from 'react';
import { motion, useSpring, useTransform, animate } from 'motion/react';

interface Props {
  value: number;
  format?: (v: number) => string;
  duration?: number;
}

export default function Counter({ value, format = (v) => v.toString(), duration = 2 }: Props) {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const controls = animate(0, value, {
      duration,
      onUpdate: (latest) => setDisplayValue(latest),
      ease: "easeOut"
    });
    return () => controls.stop();
  }, [value, duration]);

  return <span>{format(displayValue)}</span>;
}
