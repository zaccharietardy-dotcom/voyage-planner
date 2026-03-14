import { NextRequest, NextResponse } from 'next/server';
import { fetchGeminiWithRetry } from '@/lib/services/geminiSearch';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }

    // Limit text length
    const truncated = text.slice(0, 5000);

    const prompt = `Extract booking information from this confirmation text. Return a JSON object with these fields (use null for missing data):

{
  "type": "flight" | "hotel" | "activity" | "transport",
  "name": "main name/title",
  "confirmationCode": "booking reference",
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "endTime": "HH:MM",
  "address": "full address",
  "price": number (in original currency),
  "currency": "EUR/USD/etc",
  "notes": "any important details",
  "airline": "airline name (flights only)",
  "flightNumber": "flight number",
  "departureAirport": "departure airport code",
  "arrivalAirport": "arrival airport code",
  "checkInDate": "YYYY-MM-DD (hotels only)",
  "checkOutDate": "YYYY-MM-DD (hotels only)",
  "hotelName": "hotel name (hotels only)"
}

Only return the JSON object, no other text.

Confirmation text:
${truncated}`;

    const response = await fetchGeminiWithRetry({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Gemini API error' }, { status: 500 });
    }

    const data = await response.json();
    const text_response = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text_response) {
      return NextResponse.json({ error: 'Unexpected response' }, { status: 500 });
    }

    // Parse JSON from response
    const jsonMatch = text_response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse response' }, { status: 500 });
    }

    const booking = JSON.parse(jsonMatch[0]);
    return NextResponse.json({ booking });
  } catch (error) {
    console.error('Booking parse error:', error);
    return NextResponse.json({ error: 'Parse failed' }, { status: 500 });
  }
}
