'use client';

import { useState, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { TripPreferences } from '@/lib/types';
import { cn } from '@/lib/utils';

interface StepOriginProps {
  data: Partial<TripPreferences>;
  onChange: (data: Partial<TripPreferences>) => void;
}

export function StepOrigin({ data, onChange }: StepOriginProps) {
  const [query, setQuery] = useState(data.origin || '');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLocating, setIsLocating] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Autocomplete
  useEffect(() => {
    if (query.length < 2) { setSuggestions([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode/autocomplete?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.suggestions?.map((s: any) => s.description || s.name) || []);
          setShowSuggestions(true);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const handleSelect = useCallback((city: string) => {
    setQuery(city);
    setShowSuggestions(false);
    onChange({ origin: city });
  }, [onChange]);

  const [geoError, setGeoError] = useState<string | null>(null);

  const handleGeolocation = useCallback(async () => {
    setGeoError(null);

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setGeoError('La géolocalisation nécessite une connexion HTTPS sécurisée.');
      return;
    }

    if (!navigator.geolocation) {
      setGeoError('La géolocalisation n\'est pas disponible sur votre navigateur.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(`/api/geocode/reverse?lat=${latitude}&lng=${longitude}`);
          if (res.ok) {
            const data = await res.json();
            const city = data.city || data.address || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            setQuery(city);
            onChange({
              origin: city,
              homeCoords: { lat: latitude, lng: longitude },
              homeAddress: data.address,
            });
          } else {
            setGeoError('Impossible de déterminer votre ville.');
          }
        } catch {
          setGeoError('Erreur lors de la récupération de votre position.');
        }
        setIsLocating(false);
      },
      (error) => {
        setIsLocating(false);
        if (error.code === error.PERMISSION_DENIED) {
          setGeoError('Autorisez la géolocalisation dans les réglages de votre navigateur (Safari : Réglages du site > Localisation), puis réessayez.');
        } else if (error.code === error.TIMEOUT) {
          setGeoError('La localisation a pris trop de temps. Réessayez.');
        } else {
          setGeoError('Impossible de récupérer votre position.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [onChange]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-12 max-w-[600px] mx-auto w-full"
    >
      <div className="text-center space-y-4">
        <h2 className="text-4xl md:text-[3.5rem] leading-none font-serif font-bold tracking-tight text-[#f8fafc]">
          D&apos;où partez-vous ?
        </h2>
        <p className="text-[17px] text-[#94a3b8] font-light">
          Pour calculer vos temps de trajet et options de transport.
        </p>
      </div>

      <div className="space-y-6">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gold/20 rounded-[1.2rem] blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
          <div className="relative">
            <MapPin className="absolute left-6 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-white/50 group-focus-within:text-white transition-colors z-10" strokeWidth={2} />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onChange({ origin: e.target.value });
              }}
              placeholder="Ex: Paris, Lyon, Bordeaux..."
              className="pl-[3.25rem] pr-6 h-[56px] text-[15px] rounded-[1.2rem] bg-[#0e1220]/50 border-white/[0.08] text-white placeholder:text-white/40 focus:border-white/20 focus:bg-[#0f1429] focus-visible:ring-0 shadow-inner transition-all"
            />
          </div>

          {/* Autocomplete suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-2 bg-card border border-border/50 rounded-2xl shadow-xl overflow-hidden">
              {suggestions.slice(0, 5).map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSelect(s)}
                  className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors text-sm flex items-center gap-3"
                >
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span>{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Geolocation button */}
        <Button
          variant="outline"
          onClick={handleGeolocation}
          disabled={isLocating}
          className="w-full h-[52px] rounded-[1.2rem] border border-dashed border-white/[0.15] bg-transparent text-white/90 hover:text-white hover:border-white/30 hover:bg-white/[0.03] transition-all gap-3"
        >
          {isLocating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="h-4 w-4" strokeWidth={1.5} />
          )}
          <span className="font-medium tracking-wide">
            {isLocating ? 'Localisation...' : 'Utiliser ma position actuelle'}
          </span>
        </Button>

        {geoError && (
          <p className="text-sm text-red-400 text-center mt-2">{geoError}</p>
        )}
      </div>
    </motion.div>
  );
}
