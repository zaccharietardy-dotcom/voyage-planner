export interface ParsedBooking {
  type: 'flight' | 'hotel' | 'activity' | 'transport';
  name: string;
  confirmationCode?: string;
  date?: string; // ISO date
  startTime?: string; // HH:MM
  endTime?: string;
  address?: string;
  price?: number;
  currency?: string;
  notes?: string;
  // Flight-specific
  airline?: string;
  flightNumber?: string;
  departureAirport?: string;
  arrivalAirport?: string;
  // Hotel-specific
  checkInDate?: string;
  checkOutDate?: string;
  hotelName?: string;
}

/**
 * Parse booking confirmation text via API
 */
export async function parseBookingText(text: string): Promise<ParsedBooking | null> {
  try {
    const res = await fetch('/api/import/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.booking || null;
  } catch {
    return null;
  }
}
