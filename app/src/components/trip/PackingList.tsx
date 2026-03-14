'use client';

import { useState, useEffect } from 'react';
import { Trip } from '@/lib/types';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Backpack,
  Shirt,
  Droplet,
  Zap,
  Heart,
  Mountain,
  Plus,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { generatePackingList } from '@/lib/services/packingListGenerator';

interface PackingListProps {
  trip: Trip;
  onUpdate?: (packingList: Trip['packingList']) => Promise<void>;
  className?: string;
}

interface PackingItem {
  id: string;
  label: string;
  category: string;
  checked: boolean;
  isCustom?: boolean;
}

const CATEGORY_CONFIG = [
  { id: 'essentials', label: 'Essentiels', icon: Backpack, color: 'text-blue-500' },
  { id: 'clothes', label: 'Vêtements', icon: Shirt, color: 'text-purple-500' },
  { id: 'toiletries', label: 'Toilette', icon: Droplet, color: 'text-cyan-500' },
  { id: 'electronics', label: 'Électronique', icon: Zap, color: 'text-yellow-500' },
  { id: 'health', label: 'Santé', icon: Heart, color: 'text-red-500' },
  { id: 'activities', label: 'Activités', icon: Mountain, color: 'text-green-500' },
];

export function PackingList({ trip, onUpdate, className }: PackingListProps) {
  const [items, setItems] = useState<PackingItem[]>(() => {
    if (trip.packingList?.items && trip.packingList.items.length > 0) {
      return trip.packingList.items;
    }
    return generatePackingList(trip);
  });

  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('essentials');

  const handleToggleItem = async (itemId: string) => {
    const updatedItems = items.map((item) =>
      item.id === itemId ? { ...item, checked: !item.checked } : item
    );
    setItems(updatedItems);
    if (onUpdate) {
      await onUpdate({ items: updatedItems });
    }
  };

  const handleAddItem = async () => {
    if (!newItemLabel.trim()) return;

    const newItem: PackingItem = {
      id: `custom-${Date.now()}`,
      label: newItemLabel.trim(),
      category: newItemCategory,
      checked: false,
      isCustom: true,
    };

    const updatedItems = [...items, newItem];
    setItems(updatedItems);
    setNewItemLabel('');

    if (onUpdate) {
      await onUpdate({ items: updatedItems });
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const updatedItems = items.filter((item) => item.id !== itemId);
    setItems(updatedItems);
    if (onUpdate) {
      await onUpdate({ items: updatedItems });
    }
  };

  const totalItems = items.length;
  const checkedItems = items.filter((item) => item.checked).length;
  const progress = totalItems > 0 ? (checkedItems / totalItems) * 100 : 0;

  const itemsByCategory = CATEGORY_CONFIG.map(({ id, label, icon: Icon, color }) => {
    const categoryItems = items.filter((item) => item.category === id);
    const categoryChecked = categoryItems.filter((item) => item.checked).length;
    return {
      id,
      label,
      icon: Icon,
      color,
      items: categoryItems,
      checked: categoryChecked,
      total: categoryItems.length,
    };
  });

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header avec progression */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-full bg-orange-100">
              <Backpack className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h3 className="font-semibold">Liste de bagages</h3>
              <p className="text-xs text-muted-foreground">
                {checkedItems}/{totalItems} préparés
              </p>
            </div>
          </div>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Accordion par catégorie */}
      <Accordion type="multiple" defaultValue={['essentials', 'clothes']} className="space-y-2">
        {itemsByCategory.map((category) => (
          <AccordionItem
            key={category.id}
            value={category.id}
            className="bg-card border border-border rounded-xl px-4 overflow-hidden"
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3 flex-1">
                <category.icon className={cn('h-4 w-4', category.color)} />
                <span className="font-medium text-sm">{category.label}</span>
                <span className="text-xs text-muted-foreground ml-auto mr-2">
                  {category.checked}/{category.total}
                </span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 pt-2">
                <AnimatePresence mode="popLayout">
                  {category.items.map((item) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={item.checked}
                        onCheckedChange={() => handleToggleItem(item.id)}
                      />
                      <span
                        className={cn(
                          'flex-1 text-sm transition-all',
                          item.checked && 'line-through text-muted-foreground'
                        )}
                      >
                        {item.label}
                      </span>
                      {item.isCustom && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => handleDeleteItem(item.id)}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Ajouter un item custom */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-2">
          <select
            value={newItemCategory}
            onChange={(e) => setNewItemCategory(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {CATEGORY_CONFIG.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
          <Input
            placeholder="Ajouter un item..."
            value={newItemLabel}
            onChange={(e) => setNewItemLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
            className="flex-1"
          />
          <Button onClick={handleAddItem} size="icon" disabled={!newItemLabel.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
