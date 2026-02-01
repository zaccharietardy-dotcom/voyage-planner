'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Calendar, Users, Wallet, Copy, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CloneTripModalProps {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  tripTitle: string;
  originalDuration: number;
}

export function CloneTripModal({ isOpen, onClose, tripId, tripTitle, originalDuration }: CloneTripModalProps) {
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [groupSize, setGroupSize] = useState(2);
  const [budgetLevel, setBudgetLevel] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleClone = async () => {
    if (!startDate) {
      setError('Date de départ requise');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/trips/${tripId}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate || undefined,
          group_size: groupSize,
          budget_level: budgetLevel || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur lors du clonage');
      }

      const clonedTrip = await response.json();
      onClose();
      router.push(`/v2/trip/${clonedTrip.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-[#12121a] rounded-t-3xl border-t border-[#2a2a38] p-6 pb-10 max-h-[80vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-white">Cloner ce voyage</h2>
                <p className="text-sm text-gray-400 mt-0.5">{tripTitle}</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-full bg-[#1a1a24]">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Dates */}
              <div className="bg-[#1a1a24] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-indigo-400" />
                  <span className="text-white font-medium text-sm">Nouvelles dates</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Départ</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full bg-[#12121a] border border-[#2a2a38] rounded-lg px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">Retour (optionnel)</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate}
                      className="w-full bg-[#12121a] border border-[#2a2a38] rounded-lg px-3 py-2 text-white text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Durée originale : {originalDuration} jours
                </p>
              </div>

              {/* Group size */}
              <div className="bg-[#1a1a24] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-indigo-400" />
                  <span className="text-white font-medium text-sm">Voyageurs</span>
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5, 6].map(n => (
                    <button
                      key={n}
                      onClick={() => setGroupSize(n)}
                      className={`w-10 h-10 rounded-lg font-medium text-sm transition-all ${
                        groupSize === n
                          ? 'bg-indigo-500 text-white'
                          : 'bg-[#12121a] border border-[#2a2a38] text-gray-400'
                      }`}
                    >
                      {n === 6 ? '6+' : n}
                    </button>
                  ))}
                </div>
              </div>

              {/* Budget */}
              <div className="bg-[#1a1a24] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Wallet className="w-4 h-4 text-indigo-400" />
                  <span className="text-white font-medium text-sm">Budget (optionnel)</span>
                </div>
                <div className="flex gap-2">
                  {[
                    { id: 'economic', label: 'Eco' },
                    { id: 'moderate', label: 'Modéré' },
                    { id: 'luxury', label: 'Luxe' },
                  ].map(b => (
                    <button
                      key={b.id}
                      onClick={() => setBudgetLevel(budgetLevel === b.id ? '' : b.id)}
                      className={`px-4 py-2 rounded-lg text-sm transition-all ${
                        budgetLevel === b.id
                          ? 'bg-indigo-500 text-white'
                          : 'bg-[#12121a] border border-[#2a2a38] text-gray-400'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <button
                onClick={handleClone}
                disabled={loading || !startDate}
                className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-semibold shadow-lg shadow-indigo-500/30 disabled:opacity-50"
              >
                {loading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Clonage en cours...</>
                ) : (
                  <><Copy className="w-5 h-5" /> Cloner le voyage</>
                )}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
