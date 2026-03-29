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

  const handleGeolocation = useCallback(async () => {
    if (!navigator.geolocation) return;
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
          }
        } catch { /* ignore */ }
        setIsLocating(false);
      },
      () => setIsLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [onChange]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      <div className="text-center space-y-3">
        <h2 className="text-4xl md:text-5xl font-serif font-bold tracking-tight bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
          D&apos;où partez-vous ?
        </h2>
        <p className="text-lg text-muted-foreground/80 max-w-md mx-auto">
          Pour calculer vos temps de trajet et options de transport.
        </p>
      </div>

      <div className="space-y-6 max-w-xl mx-auto">
        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gold/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
          <div className="relative">
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gold/50 group-focus-within:text-gold transition-colors" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                onChange({ origin: e.target.value });
              }}
              placeholder="Ex: Paris, Lyon, Bordeaux..."
              className="pl-12 h-16 text-xl rounded-2xl bg-white/[0.03] border-white/10 focus:border-gold/50 focus:bg-white/[0.05] transition-all"
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
          className="w-full h-12 rounded-xl gap-2"
        >
          {isLocating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Navigation className="h-4 w-4" />
          )}
          {isLocating ? 'Localisation...' : 'Utiliser ma position actuelle'}
        </Button>
      </div>
    </motion.div>
  );
}
