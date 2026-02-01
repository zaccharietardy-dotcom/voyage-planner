/**
 * API Route pour rechercher des lieux à ajouter comme activité
 * Utilise SerpAPI si disponible, sinon la base locale d'attractions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAttractions } from '@/lib/services/attractions';
import { searchAttractionsWithSerpApi, isSerpApiPlacesConfigured } from '@/lib/services/serpApiPlaces';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const destination = searchParams.get('destination') || '';
    const type = searchParams.get('type') || 'all'; // activity, restaurant, all

    if (!destination) {
      return NextResponse.json({ error: 'destination required' }, { status: 400 });
    }

    const results: any[] = [];

    // 1. Search local attractions database
    const localAttractions = getAttractions(destination);
    if (localAttractions.length > 0) {
      const filtered = query
        ? localAttractions.filter((a) =>
            a.name.toLowerCase().includes(query.toLowerCase()) ||
            a.type.toLowerCase().includes(query.toLowerCase())
          )
        : localAttractions;

      results.push(
        ...filtered.slice(0, 15).map((a) => ({
          id: `local-${a.name.replace(/\s/g, '-').toLowerCase()}`,
          title: a.name,
          type: (a.type as string) === 'restaurant' ? 'restaurant' : 'activity',
          description: a.description || '',
          locationName: destination,
          latitude: a.latitude,
          longitude: a.longitude,
          estimatedCost: a.estimatedCost || 0,
          duration: a.duration || 60,
          rating: a.rating,
          imageUrl: a.imageUrl,
          googleMapsUrl: a.googleMapsUrl,
          source: 'local',
        }))
      );
    }

    // 2. Try SerpAPI if configured and we need more results
    if (isSerpApiPlacesConfigured() && results.length < 10) {
      try {
        const serpResults = await searchAttractionsWithSerpApi(
            query || destination,
            { limit: 10 }
          );
        if (serpResults.length > 0) {
          results.push(
            ...serpResults.map((a) => ({
              id: `serp-${a.name.replace(/\s/g, '-').toLowerCase()}`,
              title: a.name,
              type: (a.type as string) === 'restaurant' ? 'restaurant' : 'activity',
              description: a.description || '',
              locationName: destination,
              latitude: a.latitude,
              longitude: a.longitude,
              estimatedCost: a.estimatedCost || 0,
              duration: a.duration || 60,
              rating: a.rating,
              imageUrl: a.imageUrl,
              googleMapsUrl: a.googleMapsUrl,
              source: 'serpapi',
            }))
          );
        }
      } catch (err) {
        console.warn('SerpAPI search failed:', err);
      }
    }

    // Filter by type if specified
    const filteredResults = type === 'all'
      ? results
      : results.filter((r) => r.type === type);

    // Deduplicate by title
    const seen = new Set<string>();
    const unique = filteredResults.filter((r) => {
      const key = r.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return NextResponse.json({ results: unique.slice(0, 20) });
  } catch (error) {
    console.error('Places search error:', error);
    return NextResponse.json({ error: 'Erreur de recherche' }, { status: 500 });
  }
}
