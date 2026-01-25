'use client';

import { Navigation, Clock, MapPin } from 'lucide-react';

interface ItineraryConnectorProps {
  from: {
    name: string;
    latitude: number;
    longitude: number;
  };
  to: {
    name: string;
    latitude: number;
    longitude: number;
  };
  duration?: number; // minutes estimées
  distance?: number; // km
  mode?: 'walk' | 'transit' | 'driving' | 'car' | 'public' | 'taxi';
}

/**
 * Composant compact pour afficher un lien d'itinéraire cliquable
 * entre deux activités dans la timeline
 */
export function ItineraryConnector({
  from,
  to,
  duration,
  distance,
  mode = 'walk',
}: ItineraryConnectorProps) {
  // Mapper les modes vers les travelmode Google Maps
  const googleMapsMode = mode === 'walk' ? 'walking'
    : mode === 'transit' || mode === 'public' ? 'transit'
    : 'driving';

  // Générer l'URL Google Maps avec itinéraire
  // Utiliser les noms pour une meilleure précision que les coordonnées GPS
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from.name)}&destination=${encodeURIComponent(to.name)}&travelmode=${googleMapsMode}`;

  // Icône selon le mode de transport
  const getModeIcon = () => {
    switch (mode) {
      case 'walk':
        return '🚶';
      case 'transit':
      case 'public':
        return '🚇';
      case 'car':
      case 'driving':
        return '🚗';
      case 'taxi':
        return '🚕';
      default:
        return '🚶';
    }
  };

  // Formater la durée
  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return remainingMins > 0 ? `${hours}h${remainingMins}` : `${hours}h`;
  };

  // Formater la distance
  const formatDistance = (km: number) => {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
  };

  return (
    <a
      href={googleMapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 py-2 px-3 my-2 ml-1 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40 rounded-lg border border-blue-200 dark:border-blue-800 transition-colors cursor-pointer group"
    >
      <Navigation className="h-4 w-4 text-blue-600 dark:text-blue-400 group-hover:scale-110 transition-transform" />

      <div className="flex-1 min-w-0">
        <span className="text-sm text-blue-800 dark:text-blue-200 truncate block">
          {getModeIcon()} Itinéraire vers <span className="font-medium">{to.name}</span>
        </span>

        {(duration || distance) && (
          <div className="flex items-center gap-3 text-xs text-blue-600 dark:text-blue-400 mt-0.5">
            {duration && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDuration(duration)}
              </span>
            )}
            {distance && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {formatDistance(distance)}
              </span>
            )}
          </div>
        )}
      </div>

      <span className="text-blue-400 dark:text-blue-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
        Ouvrir →
      </span>
    </a>
  );
}
