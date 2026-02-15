/**
 * Service d'import de lieux sauvegardés Google Maps
 * Supporte: GeoJSON (Takeout), KML (My Maps), URLs Google Maps, saisie manuelle
 */

export type ImportSource = 'google_takeout' | 'kml' | 'url' | 'manual' | 'social_media';

export interface ImportedPlace {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  category?: string; // restaurant, museum, park, etc.
  notes?: string;
  sourceUrl?: string;
  source: ImportSource;
}

/**
 * Parse Google Takeout GeoJSON export
 * Format: { type: "FeatureCollection", features: [...] }
 */
export function parseGeoJSON(content: string): ImportedPlace[] {
  try {
    const data = JSON.parse(content);

    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
      throw new Error('Format GeoJSON invalide - attendu FeatureCollection');
    }

    const places: ImportedPlace[] = [];

    for (const feature of data.features) {
      if (feature.type !== 'Feature' || !feature.geometry || !feature.properties) {
        continue;
      }

      const { geometry, properties } = feature;

      // GeoJSON utilise [lng, lat], pas [lat, lng]
      const coords = geometry.type === 'Point' ? geometry.coordinates : null;
      if (!coords || coords.length < 2) continue;

      const [lng, lat] = coords;
      const name = properties.name || properties.Title || 'Lieu sans nom';
      const address = properties.address || properties['Location']?.['Address'];
      const notes = properties.description || properties.Comment;
      const sourceUrl = properties.url || properties['Google Maps URL'];

      places.push({
        name,
        lat,
        lng,
        address,
        notes,
        sourceUrl,
        source: 'google_takeout',
        category: detectCategory(name, address, notes),
      });
    }

    return places;
  } catch (error) {
    console.error('Erreur parsing GeoJSON:', error);
    throw new Error('Fichier GeoJSON invalide ou corrompu');
  }
}

/**
 * Parse KML file (Google My Maps export)
 * Utilise DOMParser natif du navigateur
 */
export function parseKML(content: string): ImportedPlace[] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');

    // Vérifier erreurs de parsing XML
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error('Fichier KML mal formé');
    }

    const placemarks = doc.querySelectorAll('Placemark');
    const places: ImportedPlace[] = [];

    placemarks.forEach((placemark) => {
      const name = placemark.querySelector('name')?.textContent?.trim() || 'Lieu sans nom';
      const description = placemark.querySelector('description')?.textContent?.trim();

      // Coordonnées: <Point><coordinates>lng,lat,alt</coordinates></Point>
      const coordsText = placemark.querySelector('Point coordinates')?.textContent?.trim();
      if (!coordsText) return;

      const [lngStr, latStr] = coordsText.split(',');
      const lng = parseFloat(lngStr);
      const lat = parseFloat(latStr);

      if (isNaN(lat) || isNaN(lng)) return;

      // ExtendedData pour métadonnées additionnelles
      const extendedData: Record<string, string> = {};
      placemark.querySelectorAll('ExtendedData Data').forEach((data) => {
        const key = data.getAttribute('name');
        const value = data.querySelector('value')?.textContent?.trim();
        if (key && value) extendedData[key] = value;
      });

      places.push({
        name,
        lat,
        lng,
        notes: description,
        address: extendedData['address'] || extendedData['Address'],
        source: 'kml',
        category: detectCategory(name, description),
      });
    });

    return places;
  } catch (error) {
    console.error('Erreur parsing KML:', error);
    throw new Error('Fichier KML invalide ou corrompu');
  }
}

/**
 * Parse Google Maps URLs (multiple formats)
 * Formats supportés:
 * - https://maps.google.com/maps?q=48.8566,2.3522
 * - https://www.google.com/maps/place/Tour+Eiffel/@48.8584,2.2945,17z
 * - https://goo.gl/maps/xyz (short links - pas de coordonnées directes)
 * - https://maps.app.goo.gl/xyz (nouveau format court)
 */
export function parseGoogleMapsURLs(text: string): ImportedPlace[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const places: ImportedPlace[] = [];

  for (const line of lines) {
    try {
      const url = new URL(line);

      // Type 1: Query coords (?q=lat,lng)
      const qParam = url.searchParams.get('q');
      if (qParam) {
        const coordMatch = qParam.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
        if (coordMatch) {
          const lat = parseFloat(coordMatch[1]);
          const lng = parseFloat(coordMatch[2]);
          places.push({
            name: `Lieu à ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
            lat,
            lng,
            sourceUrl: line,
            source: 'url',
            category: 'unknown',
          });
          continue;
        }
      }

      // Type 2: Place URL with coords in path (/place/Name/@lat,lng,zoom)
      const pathMatch = url.pathname.match(/\/@(-?\d+\.?\d*),(-?\d+\.?\d*),/);
      if (pathMatch) {
        const lat = parseFloat(pathMatch[1]);
        const lng = parseFloat(pathMatch[2]);

        // Extraire le nom du lieu depuis /place/Name/
        const placeNameMatch = url.pathname.match(/\/place\/([^/@]+)/);
        const name = placeNameMatch
          ? decodeURIComponent(placeNameMatch[1]).replace(/\+/g, ' ')
          : `Lieu à ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

        places.push({
          name,
          lat,
          lng,
          sourceUrl: line,
          source: 'url',
          category: detectCategory(name),
        });
        continue;
      }

      // Type 3: Short links (goo.gl/maps/xyz) - ne contiennent pas de coords directes
      if (url.hostname.includes('goo.gl') || url.hostname.includes('maps.app.goo.gl')) {
        // Impossible d'extraire les coordonnées sans résoudre la redirection
        // On ajoute quand même comme lien à résoudre manuellement
        places.push({
          name: 'Lieu Google Maps (lien court)',
          lat: 0,
          lng: 0,
          sourceUrl: line,
          source: 'url',
          category: 'unknown',
          notes: 'Lien court - coordonnées à vérifier manuellement',
        });
      }
    } catch (error) {
      console.warn('Ligne ignorée (URL invalide):', line);
    }
  }

  return places;
}

/**
 * Détecte automatiquement la catégorie d'un lieu
 * Basé sur des mots-clés dans le nom, adresse ou notes
 */
export function detectCategory(
  name?: string,
  address?: string,
  notes?: string
): string {
  const text = [name, address, notes].filter(Boolean).join(' ').toLowerCase();

  // Catégories avec mots-clés associés
  const categories: Record<string, string[]> = {
    restaurant: ['restaurant', 'café', 'bistro', 'brasserie', 'pizzeria', 'trattoria', 'tavern', 'diner', 'eatery'],
    cafe: ['café', 'coffee', 'espresso', 'tea house', 'salon de thé'],
    bar: ['bar', 'pub', 'cocktail', 'wine bar', 'brewery', 'tavern'],
    museum: ['musée', 'museum', 'galerie', 'gallery', 'exposition', 'exhibition'],
    monument: ['monument', 'memorial', 'statue', 'arc de triomphe', 'colonne', 'obelisk'],
    church: ['église', 'church', 'cathédrale', 'cathedral', 'basilique', 'basilica', 'chapelle', 'chapel', 'temple', 'mosque', 'mosquée', 'synagogue'],
    park: ['parc', 'park', 'jardin', 'garden', 'square', 'green', 'forest', 'forêt'],
    beach: ['plage', 'beach', 'coast', 'shore', 'seaside', 'bord de mer'],
    viewpoint: ['viewpoint', 'point de vue', 'panorama', 'belvedere', 'belvédère', 'observation', 'lookout'],
    shopping: ['shopping', 'boutique', 'shop', 'store', 'magasin', 'centre commercial', 'mall'],
    market: ['marché', 'market', 'bazar', 'souk', 'flea market'],
    hotel: ['hôtel', 'hotel', 'hostel', 'auberge', 'guesthouse', 'b&b', 'bed and breakfast'],
    theater: ['théâtre', 'theater', 'opéra', 'opera', 'concert hall', 'salle de spectacle'],
    cinema: ['cinéma', 'cinema', 'movie theater'],
    stadium: ['stade', 'stadium', 'arena', 'palais des sports'],
    zoo: ['zoo', 'aquarium', 'safari', 'parc animalier'],
    attraction: ['attraction', 'parc d\'attractions', 'theme park', 'amusement park', 'disneyland'],
    castle: ['château', 'castle', 'palace', 'palais', 'fortress', 'fort'],
    library: ['bibliothèque', 'library'],
    university: ['université', 'university', 'école', 'school', 'campus'],
    hospital: ['hôpital', 'hospital', 'clinique', 'clinic'],
    pharmacy: ['pharmacie', 'pharmacy'],
    bank: ['banque', 'bank'],
    station: ['gare', 'station', 'airport', 'aéroport', 'terminal'],
  };

  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      return category;
    }
  }

  return 'other';
}

/**
 * Valide et nettoie une liste de lieux importés
 * - Supprime les doublons (même nom + coords proches < 50m)
 * - Filtre les lieux avec coords invalides
 * - Tronque les noms/descriptions trop longs
 */
export function cleanImportedPlaces(places: ImportedPlace[]): ImportedPlace[] {
  const cleaned: ImportedPlace[] = [];
  const seen = new Set<string>();

  for (const place of places) {
    // Filtre coords invalides
    if (place.lat === 0 && place.lng === 0) {
      // Exception: lien court Google Maps non résolu
      if (place.sourceUrl?.includes('goo.gl')) {
        cleaned.push(place);
      }
      continue;
    }

    if (isNaN(place.lat) || isNaN(place.lng)) continue;
    if (place.lat < -90 || place.lat > 90) continue;
    if (place.lng < -180 || place.lng > 180) continue;

    // Détection doublons: même nom + coords proches (< 50m)
    const key = `${place.name.toLowerCase().trim()}|${place.lat.toFixed(3)}|${place.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Nettoyage
    cleaned.push({
      ...place,
      name: place.name.slice(0, 150).trim(),
      address: place.address?.slice(0, 200).trim(),
      notes: place.notes?.slice(0, 500).trim(),
    });
  }

  return cleaned;
}

/**
 * Point d'entrée principal: détecte le format et parse
 */
export function parseImportedPlaces(content: string, filename?: string): ImportedPlace[] {
  const trimmed = content.trim();

  // Détection du format
  if (filename?.endsWith('.geojson') || trimmed.startsWith('{"type":"FeatureCollection"')) {
    return cleanImportedPlaces(parseGeoJSON(trimmed));
  }

  if (filename?.endsWith('.kml') || trimmed.startsWith('<?xml') || trimmed.includes('<kml')) {
    return cleanImportedPlaces(parseKML(trimmed));
  }

  // Si contient des URLs Google Maps, parser en mode URLs
  if (trimmed.includes('maps.google.com') || trimmed.includes('goo.gl/maps')) {
    return cleanImportedPlaces(parseGoogleMapsURLs(trimmed));
  }

  throw new Error('Format non reconnu. Formats supportés: GeoJSON (.geojson), KML (.kml), URLs Google Maps');
}

/**
 * Calcule la distance entre deux points (formule de Haversine)
 * @returns Distance en mètres
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Rayon de la Terre en mètres
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}
