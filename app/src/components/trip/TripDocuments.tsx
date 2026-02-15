'use client';

import { useState, useRef } from 'react';
import { Trip } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Upload,
  Plane,
  Hotel,
  Ticket,
  ShieldCheck,
  FileText,
  FileImage,
  Trash2,
  Download,
  Eye,
  FileIcon,
  AlertCircle,
  X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface TripDocumentsProps {
  trip: Trip;
  isOwner: boolean;
  onUpdate?: (documents: Trip['documents']) => void;
}

type DocumentType = 'flight_ticket' | 'hotel_booking' | 'activity_ticket' | 'insurance' | 'visa' | 'passport' | 'other';

const DOCUMENT_TYPE_CONFIG: Record<DocumentType, { label: string; icon: typeof Plane; color: string }> = {
  flight_ticket: { label: 'Billet d\'avion', icon: Plane, color: '#EC4899' },
  hotel_booking: { label: 'Réservation hôtel', icon: Hotel, color: '#8B5CF6' },
  activity_ticket: { label: 'Billet activité', icon: Ticket, color: '#3B82F6' },
  insurance: { label: 'Assurance', icon: ShieldCheck, color: '#10B981' },
  visa: { label: 'Visa', icon: FileText, color: '#F59E0B' },
  passport: { label: 'Passeport', icon: FileText, color: '#6366F1' },
  other: { label: 'Autre', icon: FileIcon, color: '#6B7280' },
};

export function TripDocuments({ trip, isOwner, onUpdate }: TripDocumentsProps) {
  const [documents, setDocuments] = useState(trip.documents?.items || []);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<DocumentType>('other');
  const [notes, setNotes] = useState('');
  const [linkedActivityId, setLinkedActivityId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canEdit = isOwner; // Can extend to include editors later

  // Group documents by type and sort by date
  const documentsByType = documents.reduce((acc, doc) => {
    const type = doc.type as DocumentType;
    if (!acc[type]) acc[type] = [];
    acc[type].push(doc);
    return acc;
  }, {} as Record<DocumentType, typeof documents>);

  // Sort each group by upload date (newest first)
  Object.keys(documentsByType).forEach(type => {
    documentsByType[type as DocumentType].sort((a, b) =>
      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
    );
  });

  // Count by type
  const countByType = Object.entries(documentsByType).reduce((acc, [type, docs]) => {
    acc[type as DocumentType] = docs.length;
    return acc;
  }, {} as Record<DocumentType, number>);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (!canEdit) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndSetFile(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;

    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      validateAndSetFile(file);
    }
  };

  const validateAndSetFile = (file: File) => {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'text/plain'];

    if (file.size > maxSize) {
      toast.error('Fichier trop volumineux (max 10MB)');
      return;
    }

    if (!allowedTypes.includes(file.type)) {
      toast.error('Type de fichier non autorisé (PDF, JPG, PNG, TXT uniquement)');
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !canEdit) return;

    setUploading(true);
    setUploadProgress(10);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('type', documentType);
      if (notes) formData.append('notes', notes);
      if (linkedActivityId) formData.append('linkedActivityId', linkedActivityId);

      setUploadProgress(30);

      const response = await fetch(`/api/trips/${trip.id}/documents`, {
        method: 'POST',
        body: formData,
      });

      setUploadProgress(80);

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erreur lors de l\'upload');
      }

      const { document: newDoc, warning } = await response.json();

      setUploadProgress(100);

      // Update local state
      const updatedDocuments = [...documents, newDoc];
      setDocuments(updatedDocuments);

      // Notify parent
      if (onUpdate) {
        onUpdate({ items: updatedDocuments });
      }

      toast.success(warning || 'Document ajouté avec succès');

      // Reset form
      setSelectedFile(null);
      setNotes('');
      setLinkedActivityId('');
      setDocumentType('other');
      setUploadDialogOpen(false);
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(error.message || 'Erreur lors de l\'upload');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!canEdit) return;

    if (!confirm('Êtes-vous sûr de vouloir supprimer ce document ?')) return;

    try {
      const response = await fetch(`/api/trips/${trip.id}/documents?documentId=${docId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erreur lors de la suppression');
      }

      // Update local state
      const updatedDocuments = documents.filter(d => d.id !== docId);
      setDocuments(updatedDocuments);

      // Notify parent
      if (onUpdate) {
        onUpdate({ items: updatedDocuments });
      }

      toast.success('Document supprimé');
    } catch (error: any) {
      console.error('Delete error:', error);
      toast.error(error.message || 'Erreur lors de la suppression');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Get all activities for linking dropdown
  const allActivities = trip.days.flatMap(day =>
    day.items
      .filter(item => item.type === 'activity' || item.type === 'restaurant')
      .map(item => ({
        id: item.id,
        title: item.title,
        dayNumber: day.dayNumber,
      }))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Documents et billets</h3>
          <p className="text-sm text-muted-foreground">
            Centralisez vos réservations et documents importants
          </p>
        </div>
        {canEdit && (
          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Upload className="h-4 w-4 mr-2" />
                Ajouter un document
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ajouter un document</DialogTitle>
                <DialogDescription>
                  Téléchargez un billet, une réservation ou tout autre document important.
                  Formats acceptés: PDF, JPG, PNG, TXT (max 10MB)
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* File upload zone */}
                <div
                  className={cn(
                    "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
                    dragActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
                    !canEdit && "opacity-50 cursor-not-allowed"
                  )}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  onClick={() => canEdit && fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept=".pdf,.jpg,.jpeg,.png,.txt"
                    disabled={!canEdit}
                  />
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileIcon className="h-5 w-5 text-primary" />
                      <span className="font-medium">{selectedFile.name}</span>
                      <span className="text-sm text-muted-foreground">
                        ({formatFileSize(selectedFile.size)})
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                        }}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Glissez-déposez un fichier ou cliquez pour sélectionner
                      </p>
                    </>
                  )}
                </div>

                {/* Document type */}
                <div>
                  <Label htmlFor="doc-type">Type de document</Label>
                  <Select value={documentType} onValueChange={(v) => setDocumentType(v as DocumentType)}>
                    <SelectTrigger id="doc-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DOCUMENT_TYPE_CONFIG).map(([type, config]) => (
                        <SelectItem key={type} value={type}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Link to activity (optional) */}
                {allActivities.length > 0 && (
                  <div>
                    <Label htmlFor="linked-activity">Lié à une activité (optionnel)</Label>
                    <Select value={linkedActivityId} onValueChange={setLinkedActivityId}>
                      <SelectTrigger id="linked-activity">
                        <SelectValue placeholder="Aucune" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Aucune</SelectItem>
                        {allActivities.map((activity) => (
                          <SelectItem key={activity.id} value={activity.id}>
                            Jour {activity.dayNumber} - {activity.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <Label htmlFor="notes">Notes (optionnel)</Label>
                  <Input
                    id="notes"
                    placeholder="Ex: Numéro de confirmation, heure de check-in..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                {/* Upload progress */}
                {uploading && (
                  <div>
                    <Progress value={uploadProgress} className="h-2" />
                    <p className="text-xs text-center text-muted-foreground mt-1">
                      Upload en cours... {uploadProgress}%
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUploadDialogOpen(false);
                      setSelectedFile(null);
                      setNotes('');
                      setLinkedActivityId('');
                    }}
                    disabled={uploading}
                  >
                    Annuler
                  </Button>
                  <Button
                    onClick={handleUpload}
                    disabled={!selectedFile || uploading}
                  >
                    {uploading ? 'Upload...' : 'Ajouter'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Type count badges */}
      {Object.keys(countByType).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {Object.entries(countByType).map(([type, count]) => {
            const config = DOCUMENT_TYPE_CONFIG[type as DocumentType];
            const Icon = config.icon;
            return (
              <Badge
                key={type}
                variant="outline"
                className="gap-1.5"
                style={{ borderColor: config.color + '40', color: config.color }}
              >
                <Icon className="h-3 w-3" />
                {config.label}
                <span className="font-semibold ml-0.5">{count}</span>
              </Badge>
            );
          })}
        </div>
      )}

      {/* Documents list */}
      {documents.length === 0 ? (
        <Card className="p-12 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
          <h4 className="font-medium text-lg mb-2">Aucun document ajouté</h4>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Centralisez vos billets, réservations et documents importants ici.
            {canEdit && ' Cliquez sur "Ajouter un document" pour commencer.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {Object.entries(documentsByType).map(([type, docs]) => {
              const config = DOCUMENT_TYPE_CONFIG[type as DocumentType];
              const TypeIcon = config.icon;

              return (
                <motion.div
                  key={type}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-2"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="p-1.5 rounded-lg"
                      style={{ backgroundColor: config.color + '20', color: config.color }}
                    >
                      <TypeIcon className="h-4 w-4" />
                    </div>
                    <h4 className="font-semibold text-sm">{config.label}</h4>
                    <Badge variant="secondary" className="text-xs">
                      {docs.length}
                    </Badge>
                  </div>

                  {docs.map((doc) => {
                    const linkedActivity = doc.linkedActivityId
                      ? allActivities.find(a => a.id === doc.linkedActivityId)
                      : null;

                    const isImage = doc.mimeType?.startsWith('image/');
                    const isPDF = doc.mimeType === 'application/pdf';

                    return (
                      <motion.div
                        key={doc.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                      >
                        <Card className="p-4 hover:shadow-md transition-shadow">
                          <div className="flex items-start gap-4">
                            {/* File icon/preview */}
                            <div className="flex-shrink-0">
                              {isImage && doc.fileUrl ? (
                                <img
                                  src={doc.fileUrl}
                                  alt={doc.name}
                                  className="w-12 h-12 rounded-lg object-cover"
                                />
                              ) : (
                                <div
                                  className="w-12 h-12 rounded-lg flex items-center justify-center"
                                  style={{ backgroundColor: config.color + '20' }}
                                >
                                  {isPDF ? (
                                    <FileText className="h-6 w-6" style={{ color: config.color }} />
                                  ) : (
                                    <TypeIcon className="h-6 w-6" style={{ color: config.color }} />
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <h5 className="font-medium text-sm truncate">{doc.name}</h5>
                              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                {doc.fileSize && (
                                  <span>{formatFileSize(doc.fileSize)}</span>
                                )}
                                <span>•</span>
                                <span>
                                  {new Date(doc.uploadedAt).toLocaleDateString('fr-FR', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                              {doc.notes && (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                  {doc.notes}
                                </p>
                              )}
                              {linkedActivity && (
                                <Badge variant="outline" className="mt-2 text-xs">
                                  Jour {linkedActivity.dayNumber} - {linkedActivity.title}
                                </Badge>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex-shrink-0 flex gap-1">
                              {doc.fileUrl && (
                                <>
                                  {/* Preview (images only) */}
                                  {isImage && (
                                    <a
                                      href={doc.fileUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Voir"
                                    >
                                      <Button variant="ghost" size="sm">
                                        <Eye className="h-4 w-4" />
                                      </Button>
                                    </a>
                                  )}
                                  {/* Download */}
                                  <a
                                    href={doc.fileUrl}
                                    download={doc.name}
                                    title="Télécharger"
                                  >
                                    <Button variant="ghost" size="sm">
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  </a>
                                </>
                              )}
                              {/* Delete */}
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(doc.id)}
                                  className="text-destructive hover:text-destructive"
                                  title="Supprimer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </Card>
                      </motion.div>
                    );
                  })}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
