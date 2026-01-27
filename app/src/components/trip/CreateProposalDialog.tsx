'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { ProposedChange } from '@/lib/types/collaboration';

interface CreateProposalDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (title: string, description: string, changes: ProposedChange[]) => Promise<void>;
  pendingChanges: ProposedChange[];
}

export function CreateProposalDialog({
  open,
  onClose,
  onSubmit,
  pendingChanges,
}: CreateProposalDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim() || pendingChanges.length === 0) return;

    setIsSubmitting(true);
    try {
      await onSubmit(title, description, pendingChanges);
      setTitle('');
      setDescription('');
      onClose();
    } catch (error) {
      console.error('Error creating proposal:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Générer un titre par défaut basé sur les changements
  const generateDefaultTitle = () => {
    if (pendingChanges.length === 1) {
      return pendingChanges[0].description;
    }
    return `${pendingChanges.length} modifications proposées`;
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Créer une proposition</DialogTitle>
          <DialogDescription>
            Les autres membres pourront voter pour ou contre ces modifications.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titre</Label>
            <Input
              id="title"
              placeholder={generateDefaultTitle()}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optionnel)</Label>
            <Textarea
              id="description"
              placeholder="Expliquez pourquoi vous proposez ces changements..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Changements proposés</Label>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {pendingChanges.map((change, i) => (
                <div
                  key={i}
                  className="text-sm px-3 py-2 bg-muted rounded-md"
                >
                  {change.description}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || pendingChanges.length === 0 || isSubmitting}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Soumettre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
