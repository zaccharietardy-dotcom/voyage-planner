'use client';

import { useState } from 'react';

interface AirbnbResult {
  configured: boolean;
  fallbackUrl?: string;
  message?: string;
  count?: number;
  listings?: Array<{
    name: string;
    pricePerNight: number;
    bookingUrl: string;
    latitude: number;
    longitude: number;
    rating: number;
  }>;
  error?: string;
}

interface ViatorResult {
  configured: boolean;
  message?: string;
  count?: number;
  activities?: Array<{
    name: string;
    type: string;
    duration: number;
    estimatedCost: number;
    bookingUrl: string;
    rating: number;
    reviewCount: number;
    imageUrl?: string;
  }>;
  error?: string;
}

export default function TestLinksPage() {
  const [destination, setDestination] = useState('Bangkok');
  const [checkIn, setCheckIn] = useState('2026-03-15');
  const [checkOut, setCheckOut] = useState('2026-03-27');
  const [guests, setGuests] = useState(6);
  const [airbnbResult, setAirbnbResult] = useState<AirbnbResult | null>(null);
  const [viatorResult, setViatorResult] = useState<ViatorResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const testAirbnb = async () => {
    setLoading('airbnb');
    setAirbnbResult(null);
    try {
      const res = await fetch('/api/test-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'airbnb',
          destination,
          checkIn,
          checkOut,
          guests,
          cityCenter: { lat: 13.7563, lng: 100.5018 },
        }),
      });
      const data = await res.json();
      setAirbnbResult(data);
    } catch (e: any) {
      setAirbnbResult({ configured: false, error: e.message });
    }
    setLoading(null);
  };

  const testViator = async () => {
    setLoading('viator');
    setViatorResult(null);
    try {
      const res = await fetch('/api/test-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'viator',
          destination,
          cityCenter: { lat: 13.7563, lng: 100.5018 },
        }),
      });
      const data = await res.json();
      setViatorResult(data);
    } catch (e: any) {
      setViatorResult({ configured: false, error: e.message });
    }
    setLoading(null);
  };

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Test Liens de Reservation</h1>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Teste les APIs Airbnb (RapidAPI) et Viator pour verifier que les liens de reservation fonctionnent.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Destination</label>
          <input
            value={destination}
            onChange={e => setDestination(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Check-in</label>
          <input
            type="date"
            value={checkIn}
            onChange={e => setCheckIn(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Check-out</label>
          <input
            type="date"
            value={checkOut}
            onChange={e => setCheckOut(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Voyageurs</label>
          <input
            type="number"
            value={guests}
            onChange={e => setGuests(Number(e.target.value))}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 32 }}>
        <button
          onClick={testAirbnb}
          disabled={loading !== null}
          style={{
            padding: '12px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: '#FF5A5F', color: 'white', fontWeight: 700, fontSize: 15,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading === 'airbnb' ? 'Chargement...' : 'Tester Airbnb'}
        </button>
        <button
          onClick={testViator}
          disabled={loading !== null}
          style={{
            padding: '12px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: '#2D9B5D', color: 'white', fontWeight: 700, fontSize: 15,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading === 'viator' ? 'Chargement...' : 'Tester Viator'}
        </button>
      </div>

      {/* Airbnb Results */}
      {airbnbResult && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: '#FF5A5F' }}>
            Airbnb {airbnbResult.configured ? '(API active)' : '(Fallback)'}
          </h2>
          {airbnbResult.error && (
            <div style={{ padding: 12, background: '#FEE', borderRadius: 8, color: '#C00', marginBottom: 12 }}>
              Erreur: {airbnbResult.error}
            </div>
          )}
          {airbnbResult.fallbackUrl && (
            <div style={{ padding: 16, background: '#FFF5F5', borderRadius: 12, marginBottom: 12 }}>
              <p style={{ marginBottom: 8, color: '#666' }}>{airbnbResult.message}</p>
              <a
                href={airbnbResult.fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#FF5A5F', fontWeight: 600, wordBreak: 'break-all' }}
              >
                {airbnbResult.fallbackUrl}
              </a>
            </div>
          )}
          {airbnbResult.listings && airbnbResult.listings.map((l, i) => (
            <div key={i} style={{ padding: 16, background: '#FAFAFA', borderRadius: 12, marginBottom: 8, border: '1px solid #EEE' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{l.name}</div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                {l.pricePerNight}EUR/nuit | {l.rating}/5 | ({l.latitude.toFixed(4)}, {l.longitude.toFixed(4)})
              </div>
              <a
                href={l.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#FF5A5F', fontWeight: 600, fontSize: 14 }}
              >
                Voir sur Airbnb
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Viator Results */}
      {viatorResult && (
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12, color: '#2D9B5D' }}>
            Viator {viatorResult.configured ? '(API active)' : '(Non configure)'}
          </h2>
          {viatorResult.error && (
            <div style={{ padding: 12, background: '#EFE', borderRadius: 8, color: '#060', marginBottom: 12 }}>
              Erreur: {viatorResult.error}
            </div>
          )}
          {viatorResult.message && !viatorResult.error && (
            <div style={{ padding: 16, background: '#F5FFF5', borderRadius: 12 }}>
              <p style={{ color: '#666' }}>{viatorResult.message}</p>
            </div>
          )}
          {viatorResult.activities && viatorResult.activities.map((a, i) => (
            <div key={i} style={{ padding: 16, background: '#FAFAFA', borderRadius: 12, marginBottom: 8, border: '1px solid #EEE', display: 'flex', gap: 16 }}>
              {a.imageUrl && (
                <img src={a.imageUrl} alt={a.name} style={{ width: 120, height: 80, objectFit: 'cover', borderRadius: 8 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{a.name}</div>
                <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                  {a.type} | {a.duration}min | {a.estimatedCost}EUR | {a.rating.toFixed(1)}/5 ({a.reviewCount} avis)
                </div>
                <a
                  href={a.bookingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2D9B5D', fontWeight: 600, fontSize: 14 }}
                >
                  Reserver sur Viator
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
