'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: ReactNode;
  className?: string;
  glass?: boolean;
  onClick?: () => void;
  animate?: boolean;
}

export function Card({
  children,
  className = '',
  glass = false,
  onClick,
  animate = false,
}: CardProps) {
  const baseClasses = glass
    ? 'bg-[#12121a]/60 backdrop-blur-xl border-[#2a2a38]'
    : 'bg-[#12121a] border-[#2a2a38]';

  const Component = animate ? motion.div : 'div';

  return (
    <Component
      className={`rounded-xl border ${baseClasses} ${onClick ? 'cursor-pointer' : ''} ${className}`}
      onClick={onClick}
      {...(animate && {
        whileHover: { scale: 1.02 },
        whileTap: { scale: 0.98 },
        transition: { duration: 0.2 },
      })}
    >
      {children}
    </Component>
  );
}

export function CardHeader({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`p-4 border-b border-[#2a2a38] ${className}`}>
      {children}
    </div>
  );
}

export function CardContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`p-4 ${className}`}>
      {children}
    </div>
  );
}
