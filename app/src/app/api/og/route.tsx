import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const destination = searchParams.get('destination');
  const days = searchParams.get('days');
  const date = searchParams.get('date');

  // If no params → static default OG image
  const isDefault = !destination;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 50%, #020617 100%)',
          fontFamily: 'system-ui, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative circles */}
        <div
          style={{
            position: 'absolute',
            top: -100,
            right: -100,
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(197,160,89,0.15) 0%, transparent 70%)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -150,
            left: -150,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(197,160,89,0.1) 0%, transparent 70%)',
          }}
        />

        {/* Gold line */}
        <div
          style={{
            width: 80,
            height: 4,
            background: 'linear-gradient(90deg, #c5a059, #e8d5a3)',
            borderRadius: 2,
            marginBottom: 24,
          }}
        />

        {/* Brand */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: isDefault ? 32 : 16,
          }}
        >
          <span style={{ fontSize: 36, fontWeight: 800, color: 'white', letterSpacing: '-0.02em' }}>
            Narae
          </span>
          <span style={{ fontSize: 36, fontWeight: 800, color: '#c5a059', fontStyle: 'italic' }}>
            Voyage
          </span>
        </div>

        {isDefault ? (
          /* Default OG — tagline */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <span
              style={{
                fontSize: 52,
                fontWeight: 800,
                color: 'white',
                lineHeight: 1.2,
                maxWidth: 800,
                textAlign: 'center',
              }}
            >
              Ton agence de voyage personnelle premium
            </span>
            <span
              style={{
                fontSize: 22,
                color: 'rgba(255,255,255,0.5)',
                marginTop: 20,
              }}
            >
              Itinéraire sur-mesure en 2 minutes — Gratuit
            </span>
          </div>
        ) : (
          /* Trip-specific OG */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: 24, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
              Itinéraire de voyage
            </span>
            <span
              style={{
                fontSize: 64,
                fontWeight: 800,
                color: 'white',
                lineHeight: 1.1,
              }}
            >
              {destination}
            </span>
            <div
              style={{
                display: 'flex',
                gap: 24,
                marginTop: 24,
                fontSize: 22,
                color: '#c5a059',
                fontWeight: 600,
              }}
            >
              {days && <span>{days} jours</span>}
              {days && date && <span>•</span>}
              {date && <span>{date}</span>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            position: 'absolute',
            bottom: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'rgba(255,255,255,0.3)',
            fontSize: 16,
          }}
        >
          <span>naraevoyage.com</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}
