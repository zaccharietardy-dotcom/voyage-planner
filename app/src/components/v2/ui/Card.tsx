'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'glass' | 'elevated' | 'gold';
  onClick?: () => void;
  animate?: boolean;
  glow?: boolean;
}

export function Card({
  children,
  className = '',
  variant = 'default',
  onClick,
  animate = false,
  glow = false,
}: CardProps) {
  const variantClasses = {
    default: 'bg-[#0d1f35] border-[#1e3a5f]',
    glass: 'bg-[#0d1f35]/70 backdrop-blur-xl border-[#1e3a5f]/50',
    elevated: 'bg-[#122a45] border-[#2a4a70]',
    gold: 'bg-[#0d1f35] border-[#d4a853]/30 shadow-[0_0_20px_rgba(212,168,83,0.1)]',
  };

  const Component = animate ? motion.div : 'div';

  return (
    <Component
      className={`
        rounded-xl border transition-all duration-300
        ${variantClasses[variant]}
        ${glow ? 'shadow-[0_0_20px_rgba(212,168,83,0.15)]' : ''}
        ${onClick ? 'cursor-pointer hover:border-[#d4a853]/40 hover:shadow-[0_0_25px_rgba(212,168,83,0.2)]' : ''}
        ${className}
      `}
      onClick={onClick}
      {...(animate && {
        whileHover: { scale: 1.02, y: -2 },
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
    <div className={`p-4 border-b border-[#1e3a5f] ${className}`}>
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

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={`text-lg font-semibold text-white ${className}`}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-sm text-[#a8c0d8] ${className}`}>
      {children}
    </p>
  );
}
