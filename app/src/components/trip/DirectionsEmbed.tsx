'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { X, Maximize2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DirectionsEmbedProps {
  from: { lat: number; lng: number; name?: string };
  to: { lat: number; lng: number; name?: string };
  mode?: 'transit' | 'walking' | 'driving';
  className?: string;
  compact?: boolean;
}

/**
 * Composant pour afficher une carte embarquée avec l'itinéraire
 * Utilise Google Maps Embed API (gratuit) ou affiche un placeholder
 */
export function DirectionsEmbed({
  from,
  to,
  mode = 'transit',
  className,
  compact = false,
}: DirectionsEmbedProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // URL pour Google Maps Embed API (gratuit, pas besoin de billing)
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const embedUrl = apiKey
    ? `https://www.google.com/maps/embed/v1/directions?key=${apiKey}&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&mode=${mode}&language=fr`
    : null;

  // URL pour ouvrir dans Google Maps
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode}`;

  // Si pas d'API key ou erreur, afficher un fallback
  if (!embedUrl || hasError) {
    return (
      <Card className={cn('overflow-hidden', className)}>
        <div className="relative bg-muted/50 flex items-center justify-center" style={{ height: compact ? '120px' : '200px' }}>
          <div className="text-center p-4">
            <p className="text-sm text-muted-foreground mb-2">
              {from.name || 'Départ'} → {to.name || 'Arrivée'}
            </p>
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Ouvrir dans Google Maps
            </a>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Carte normale */}
      <Card className={cn('overflow-hidden relative group', className)}>
        <iframe
          src={embedUrl}
          width="100%"
          height={compact ? '120' : '200'}
          style={{ border: 0 }}
          allowFullScreen={false}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          onError={() => setHasError(true)}
          className="w-full"
        />

        {/* Boutons overlay */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            size="icon"
            variant="secondary"
            className="h-7 w-7 bg-white/90 hover:bg-white"
            onClick={() => setIsExpanded(true)}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              size="icon"
              variant="secondary"
              className="h-7 w-7 bg-white/90 hover:bg-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </a>
        </div>
      </Card>

      {/* Modal plein écran */}
      {isExpanded && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="relative w-full max-w-4xl h-[80vh] bg-white rounded-lg overflow-hidden">
            <Button
              size="icon"
              variant="ghost"
              className="absolute top-2 right-2 z-10 bg-white/90 hover:bg-white"
              onClick={() => setIsExpanded(false)}
            >
              <X className="h-5 w-5" />
            </Button>

            <iframe
              src={embedUrl}
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />

            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center">
              <div className="bg-white/90 rounded-lg px-3 py-1.5 text-sm">
                {from.name || 'Départ'} → {to.name || 'Arrivée'}
              </div>
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                <ExternalLink className="h-4 w-4" />
                Ouvrir dans l'app
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Composant pour afficher une mini-carte dans la liste des activités
 */
export function DirectionsMiniMap({
  from,
  to,
  mode = 'transit',
}: {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  mode?: 'transit' | 'walking' | 'driving';
}) {
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode}`;

  // Image statique de la carte (gratuit jusqu'à certaines limites)
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const staticMapUrl = apiKey
    ? `https://maps.googleapis.com/maps/api/staticmap?size=300x100&markers=color:green|${from.lat},${from.lng}&markers=color:red|${to.lat},${to.lng}&path=color:0x0000ff|weight:3|${from.lat},${from.lng}|${to.lat},${to.lng}&key=${apiKey}`
    : null;

  return (
    <a
      href={googleMapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg overflow-hidden hover:opacity-90 transition-opacity"
    >
      {staticMapUrl ? (
        <img
          src={staticMapUrl}
          alt="Itinéraire"
          className="w-full h-16 object-cover"
        />
      ) : (
        <div className="w-full h-16 bg-blue-50 flex items-center justify-center text-xs text-blue-600">
          Voir l'itinéraire →
        </div>
      )}
    </a>
  );
}
