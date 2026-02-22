'use client';

import { type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className ?? ''}`}>
      <div className="mb-4 rounded-2xl bg-muted/50 p-4">
        <Icon className="h-10 w-10 text-muted-foreground/50" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && (
        action.href ? (
          <Button asChild className="mt-6" size="sm">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : (
          <Button className="mt-6" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        )
      )}
    </div>
  );
}
