'use client';

import { useState } from 'react';
import { Globe, Users, Lock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Visibility = 'public' | 'friends' | 'private';

interface TripVisibilitySelectorProps {
  tripId: string;
  currentVisibility: Visibility;
  disabled?: boolean;
  onVisibilityChange?: (v: Visibility) => void;
}

const options: { value: Visibility; label: string; icon: typeof Globe; description: string }[] = [
  { value: 'public', label: 'Public', icon: Globe, description: 'Visible par tous' },
  { value: 'friends', label: 'Abonn\u00e9s', icon: Users, description: 'Visible par vos abonn\u00e9s' },
  { value: 'private', label: 'Priv\u00e9', icon: Lock, description: 'Visible par vous seul' },
];

export function TripVisibilitySelector({
  tripId,
  currentVisibility,
  disabled = false,
  onVisibilityChange,
}: TripVisibilitySelectorProps) {
  const [visibility, setVisibility] = useState<Visibility>(currentVisibility);
  const [saving, setSaving] = useState(false);

  const handleChange = async (newVisibility: Visibility) => {
    if (newVisibility === visibility || disabled || saving) return;

    const prev = visibility;
    setVisibility(newVisibility);
    setSaving(true);

    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });

      if (!res.ok) {
        setVisibility(prev);
        return;
      }

      onVisibilityChange?.(newVisibility);
    } catch {
      setVisibility(prev);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = visibility === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => handleChange(opt.value)}
            disabled={disabled || saving}
            title={opt.description}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
              (disabled || saving) && 'opacity-50 cursor-not-allowed'
            )}
          >
            {saving && isActive ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Icon className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const opt = options.find((o) => o.value === visibility) || options[2];
  const Icon = opt.icon;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="w-3 h-3" />
      {opt.label}
    </span>
  );
}
