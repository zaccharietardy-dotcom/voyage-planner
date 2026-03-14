'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getAllCategories } from '@/lib/utils/activityClassifier';

interface CategoryChipsProps {
  onFilterChange: (selectedCategories: string[]) => void;
  className?: string;
}

export function CategoryChips({ onFilterChange, className }: CategoryChipsProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const categories = getAllCategories();

  const toggleCategory = (categoryId: string) => {
    const newSelected = selected.includes(categoryId)
      ? selected.filter(c => c !== categoryId)
      : [...selected, categoryId];
    setSelected(newSelected);
    onFilterChange(newSelected);
  };

  const clearAll = () => {
    setSelected([]);
    onFilterChange([]);
  };

  return (
    <div className={cn('flex items-center gap-2 overflow-x-auto scrollbar-hide py-1', className)}>
      {selected.length > 0 && (
        <button
          onClick={clearAll}
          className="shrink-0 rounded-full border border-border/60 bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          Tout ✕
        </button>
      )}
      {categories.map((cat) => {
        const isActive = selected.includes(cat.id);
        return (
          <button
            key={cat.id}
            onClick={() => toggleCategory(cat.id)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200',
              isActive
                ? 'bg-primary text-primary-foreground shadow-sm scale-105'
                : 'border border-border/60 bg-background hover:bg-muted/60 text-foreground'
            )}
          >
            {cat.emoji} {cat.label}
          </button>
        );
      })}
    </div>
  );
}
