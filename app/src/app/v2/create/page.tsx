'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { V2Layout } from '@/components/v2/layout/V2Layout';
import { SearchBar } from '@/components/v2/ui/SearchBar';
import { ArrowRight, ArrowLeft, Sparkles, Calendar, Users, Wallet, MapPin, Plane, Check, AlertCircle, Home } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TripPreferences, ActivityType, BudgetLevel } from '@/lib/types';

const popularDestinations = [
  { name: 'Tokyo', country: 'Japon', emoji: '🇯🇵', image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=300&h=200&fit=crop' },
  { name: 'Paris', country: 'France', emoji: '🇫🇷', image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=300&h=200&fit=crop' },
  { name: 'Barcelone', country: 'Espagne', emoji: '🇪🇸', image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=300&h=200&fit=crop' },
  { name: 'New York', country: 'USA', emoji: '🇺🇸', image: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=300&h=200&fit=crop' },
  { name: 'Rome', country: 'Italie', emoji: '🇮🇹', image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=300&h=200&fit=crop' },
  { name: 'Londres', country: 'Royaume-Uni', emoji: '🇬🇧', image: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=300&h=200&fit=crop' },
  { name: 'Amsterdam', country: 'Pays-Bas', emoji: '🇳🇱', image: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=300&h=200&fit=crop' },
  { name: 'Lisbonne', country: 'Portugal', emoji: '🇵🇹', image: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=300&h=200&fit=crop' },
];

const budgetOptions: { id: BudgetLevel; label: string; emoji: string; description: string }[] = [
  { id: 'economic', label: 'Économique', emoji: '💰', description: 'Hostels, transports locaux' },
  { id: 'moderate', label: 'Modéré', emoji: '💎', description: 'Hôtels 3-4★, confort' },
  { id: 'luxury', label: 'Luxe', emoji: '👑', description: 'Hôtels 5★, premium' },
];

const travelStyles: { id: ActivityType; label: string; emoji: string }[] = [
  { id: 'culture', label: 'Culture', emoji: '🏛️' },
  { id: 'adventure', label: 'Aventure', emoji: '🏔️' },
  { id: 'beach', label: 'Détente', emoji: '🏖️' },
  { id: 'gastronomy', label: 'Gastronomie', emoji: '🍽️' },
  { id: 'nightlife', label: 'Vie nocturne', emoji: '🎉' },
  { id: 'nature', label: 'Nature', emoji: '🌿' },
];

// Mapping des villes vers les villes de départ courantes
const ORIGIN_CITIES = [
  'Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg', 'Lille'
];

export default function CreatePage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [origin, setOrigin] = useState('Paris');
  const [destination, setDestination] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [dates, setDates] = useState({ start: '', end: '' });
  const [travelers, setTravelers] = useState(2);
  const [budget, setBudget] = useState<BudgetLevel>('moderate');
  const [styles, setStyles] = useState<ActivityType[]>(['culture']);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDestinationSelect = (dest: string) => {
    setDestination(dest);
    setStep(2);
  };

  const handleStyleToggle = (styleId: ActivityType) => {
    setStyles(prev =>
      prev.includes(styleId)
        ? prev.filter(s => s !== styleId)
        : [...prev, styleId]
    );
  };

  // Calculer la durée en jours
  const getDurationDays = () => {
    if (!dates.start || !dates.end) return 4; // Default
    const start = new Date(dates.start);
    const end = new Date(dates.end);
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      // Construire les préférences pour l'API
      const preferences: Partial<TripPreferences> = {
        origin: origin,
        destination: destination,
        startDate: dates.start ? new Date(dates.start) : new Date(),
        durationDays: getDurationDays(),
        transport: 'plane',
        carRental: false,
        groupSize: travelers,
        groupType: travelers === 1 ? 'solo' : travelers === 2 ? 'couple' : 'friends',
        budgetLevel: budget,
        activities: styles,
        dietary: ['none'],
        mustSee: '',
      };

      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Erreur de génération');
      }

      const data = await response.json();

      // Stocker dans localStorage
      localStorage.setItem('currentTrip', JSON.stringify(data));

      // Rediriger vers la page de résultat v2
      router.push(`/v2/trip/${data.id}`);
    } catch (err) {
      console.error('Erreur:', err);
      setError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setIsGenerating(false);
    }
  };

  const filteredDestinations = popularDestinations.filter(d =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.country.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const canGenerate = destination && dates.start && styles.length > 0;

  return (
    <V2Layout>
      <div className="min-h-screen pb-32">
        {/* Header */}
        <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 pt-12 pb-8 px-4">
          <div className="flex items-center gap-3 mb-4">
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="p-2 rounded-full bg-white/20 backdrop-blur-sm"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
            )}
            <div>
              <h1 className="text-2xl font-bold text-white">Créer un voyage</h1>
              <p className="text-white/70 text-sm">
                {step === 1 && "Choisis ta destination"}
                {step === 2 && "Configure ton voyage"}
                {step === 3 && "Personnalise ton expérience"}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex gap-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`flex-1 h-1 rounded-full transition-all ${
                  s <= step ? 'bg-white' : 'bg-white/30'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="px-4 -mt-4 relative z-10">
          <AnimatePresence mode="wait">
            {/* Step 1: Destination */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                {/* Origin */}
                <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4 mb-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Home className="w-5 h-5 text-indigo-400" />
                    <span className="text-white font-medium">D'où pars-tu ?</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {ORIGIN_CITIES.map((city) => (
                      <button
                        key={city}
                        onClick={() => setOrigin(city)}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                          origin === city
                            ? 'bg-indigo-500 text-white'
                            : 'bg-[#1a1a24] text-gray-400 hover:text-white'
                        }`}
                      >
                        {city}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Search */}
                <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4 mb-6">
                  <div className="flex items-center gap-3 mb-3">
                    <MapPin className="w-5 h-5 text-indigo-400" />
                    <span className="text-white font-medium">Où veux-tu aller ?</span>
                  </div>
                  <SearchBar
                    placeholder="Rechercher une destination..."
                    onSearch={setSearchQuery}
                  />
                </div>

                {/* Popular destinations */}
                <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
                  <Plane className="w-4 h-4" />
                  Destinations populaires
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {filteredDestinations.map((dest) => (
                    <motion.button
                      key={dest.name}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleDestinationSelect(dest.name)}
                      className="relative aspect-[4/3] rounded-2xl overflow-hidden group"
                    >
                      <img
                        src={dest.image}
                        alt={dest.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                      <div className="absolute bottom-3 left-3 right-3">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-lg">{dest.emoji}</span>
                          <p className="text-white font-semibold">{dest.name}</p>
                        </div>
                        <p className="text-gray-300 text-xs">{dest.country}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Step 2: Configuration */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* Selected destination */}
                <div className="bg-gradient-to-r from-indigo-500/20 to-violet-500/20 rounded-2xl border border-indigo-500/30 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center">
                        <MapPin className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-xs text-indigo-300">De {origin} vers</p>
                        <p className="text-lg font-semibold text-white">{destination}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setStep(1)}
                      className="text-indigo-400 text-sm"
                    >
                      Modifier
                    </button>
                  </div>
                </div>

                {/* Dates */}
                <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Calendar className="w-5 h-5 text-indigo-400" />
                    <p className="font-medium text-white">Dates du voyage</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Départ</label>
                      <input
                        type="date"
                        value={dates.start}
                        onChange={(e) => setDates(d => ({ ...d, start: e.target.value }))}
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full bg-[#1a1a24] border border-[#2a2a38] rounded-xl px-3 py-3 text-white focus:border-indigo-500 focus:outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Retour</label>
                      <input
                        type="date"
                        value={dates.end}
                        onChange={(e) => setDates(d => ({ ...d, end: e.target.value }))}
                        min={dates.start || new Date().toISOString().split('T')[0]}
                        className="w-full bg-[#1a1a24] border border-[#2a2a38] rounded-xl px-3 py-3 text-white focus:border-indigo-500 focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                  {dates.start && dates.end && (
                    <p className="text-sm text-indigo-400 mt-2">
                      {getDurationDays()} jour{getDurationDays() > 1 ? 's' : ''} de voyage
                    </p>
                  )}
                </div>

                {/* Travelers */}
                <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Users className="w-5 h-5 text-indigo-400" />
                    <p className="font-medium text-white">Nombre de voyageurs</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((num) => (
                        <button
                          key={num}
                          onClick={() => setTravelers(num)}
                          className={`w-12 h-12 rounded-xl font-semibold transition-all ${
                            travelers === num
                              ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25'
                              : 'bg-[#1a1a24] border border-[#2a2a38] text-gray-400 hover:border-indigo-500'
                          }`}
                        >
                          {num}
                        </button>
                      ))}
                      <button
                        onClick={() => setTravelers(6)}
                        className={`w-12 h-12 rounded-xl font-semibold transition-all ${
                          travelers >= 6
                            ? 'bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/25'
                            : 'bg-[#1a1a24] border border-[#2a2a38] text-gray-400 hover:border-indigo-500'
                        }`}
                      >
                        6+
                      </button>
                    </div>
                  </div>
                </div>

                {/* Budget */}
                <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Wallet className="w-5 h-5 text-indigo-400" />
                    <p className="font-medium text-white">Budget</p>
                  </div>
                  <div className="space-y-2">
                    {budgetOptions.map((option) => (
                      <button
                        key={option.id}
                        onClick={() => setBudget(option.id)}
                        className={`w-full flex items-center gap-4 p-4 rounded-xl transition-all ${
                          budget === option.id
                            ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/20 border border-indigo-500/50'
                            : 'bg-[#1a1a24] border border-[#2a2a38] hover:border-[#3a3a4a]'
                        }`}
                      >
                        <span className="text-2xl">{option.emoji}</span>
                        <div className="text-left flex-1">
                          <p className={`font-medium ${budget === option.id ? 'text-white' : 'text-gray-300'}`}>
                            {option.label}
                          </p>
                          <p className="text-xs text-gray-500">{option.description}</p>
                        </div>
                        {budget === option.id && (
                          <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center">
                            <Check className="w-4 h-4 text-white" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 3: Personalization */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* Summary */}
                <div className="bg-gradient-to-r from-indigo-500/20 to-violet-500/20 rounded-2xl border border-indigo-500/30 p-4">
                  <h3 className="text-sm font-medium text-indigo-300 mb-3">Récapitulatif</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-indigo-400" />
                      <span className="text-white text-sm">{origin} → {destination}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-400" />
                      <span className="text-white text-sm">{travelers} voyageur{travelers > 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-400" />
                      <span className="text-white text-sm">{getDurationDays()} jours</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-indigo-400" />
                      <span className="text-white text-sm capitalize">{budgetOptions.find(b => b.id === budget)?.label}</span>
                    </div>
                  </div>
                </div>

                {/* Travel style */}
                <div className="bg-[#12121a] rounded-2xl border border-[#2a2a38] p-4">
                  <div className="flex items-center gap-3 mb-4">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    <div>
                      <p className="font-medium text-white">Style de voyage</p>
                      <p className="text-xs text-gray-500">Sélectionne un ou plusieurs styles</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {travelStyles.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => handleStyleToggle(style.id)}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${
                          styles.includes(style.id)
                            ? 'bg-gradient-to-br from-indigo-500/30 to-violet-500/30 border border-indigo-500/50'
                            : 'bg-[#1a1a24] border border-[#2a2a38] hover:border-[#3a3a4a]'
                        }`}
                      >
                        <span className="text-2xl">{style.emoji}</span>
                        <span className={`text-xs font-medium ${
                          styles.includes(style.id) ? 'text-white' : 'text-gray-400'
                        }`}>
                          {style.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error message */}
                {error && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-red-400 font-medium">Erreur</p>
                      <p className="text-red-300 text-sm">{error}</p>
                    </div>
                  </div>
                )}

                {/* AI info */}
                <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 rounded-2xl border border-violet-500/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="text-white font-medium mb-1">Génération intelligente</p>
                      <p className="text-gray-400 text-sm">
                        Notre IA va créer un itinéraire personnalisé avec les meilleures activités,
                        restaurants et hébergements adaptés à ton style.
                      </p>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom action */}
        <div className="fixed bottom-20 left-0 right-0 p-4 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f] to-transparent">
          <AnimatePresence mode="wait">
            {step < 3 ? (
              <motion.button
                key="next"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setStep(step + 1)}
                disabled={(step === 1 && !destination) || (step === 2 && !dates.start)}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continuer
                <ArrowRight className="w-5 h-5" />
              </motion.button>
            ) : (
              <motion.button
                key="generate"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                disabled={isGenerating || !canGenerate}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold shadow-lg shadow-violet-500/30 disabled:opacity-80"
              >
                {isGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Génération en cours...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Générer mon itinéraire
                  </>
                )}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </V2Layout>
  );
}
