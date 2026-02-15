import { parseGeoJSON, parseKML, parseGoogleMapsURLs, detectCategory, cleanImportedPlaces } from '../services/googleMapsImport';

describe('googleMapsImport', () => {
  describe('parseGeoJSON', () => {
    it('should parse valid GeoJSON FeatureCollection', () => {
      const geojson = JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [2.2945, 48.8584], // lng, lat
            },
            properties: {
              name: 'Tour Eiffel',
              address: 'Champ de Mars, Paris',
              description: 'Monument emblématique',
            },
          },
        ],
      });

      const result = parseGeoJSON(geojson);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'Tour Eiffel',
        lat: 48.8584,
        lng: 2.2945,
        address: 'Champ de Mars, Paris',
        notes: 'Monument emblématique',
        source: 'google_takeout',
      });
    });

    it('should throw on invalid JSON', () => {
      expect(() => parseGeoJSON('invalid json')).toThrow();
    });
  });

  describe('parseKML', () => {
    // DOMParser is not available in Node.js test environment
    it.skip('should parse valid KML with Placemarks', () => {
      const kml = `<?xml version="1.0" encoding="UTF-8"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
          <Document>
            <Placemark>
              <name>Louvre Museum</name>
              <description>World famous museum</description>
              <Point>
                <coordinates>2.3376,48.8606,0</coordinates>
              </Point>
            </Placemark>
          </Document>
        </kml>`;

      const result = parseKML(kml);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'Louvre Museum',
        lat: 48.8606,
        lng: 2.3376,
        notes: 'World famous museum',
        source: 'kml',
      });
    });
  });

  describe('parseGoogleMapsURLs', () => {
    it('should parse coords from ?q= parameter', () => {
      const urls = 'https://maps.google.com/maps?q=48.8566,2.3522';
      const result = parseGoogleMapsURLs(urls);
      expect(result).toHaveLength(1);
      expect(result[0].lat).toBe(48.8566);
      expect(result[0].lng).toBe(2.3522);
    });

    it('should parse coords from /place/ path', () => {
      const urls = 'https://www.google.com/maps/place/Tour+Eiffel/@48.8584,2.2945,17z';
      const result = parseGoogleMapsURLs(urls);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        name: 'Tour Eiffel',
        lat: 48.8584,
        lng: 2.2945,
        source: 'url',
      });
    });

    it('should handle multiple URLs (one per line)', () => {
      const urls = `https://maps.google.com/maps?q=48.8566,2.3522
https://www.google.com/maps/place/Louvre/@48.8606,2.3376,15z`;
      const result = parseGoogleMapsURLs(urls);
      expect(result).toHaveLength(2);
    });
  });

  describe('detectCategory', () => {
    it('should detect restaurant category', () => {
      expect(detectCategory('Le Petit Bistro')).toBe('restaurant');
      expect(detectCategory('Pizzeria Roma')).toBe('restaurant');
    });

    it('should detect museum category', () => {
      expect(detectCategory('Louvre Museum')).toBe('museum');
      expect(detectCategory('Musée d\'Orsay')).toBe('museum');
    });

    it('should detect church category', () => {
      expect(detectCategory('Notre-Dame Cathedral')).toBe('church');
      expect(detectCategory('Sacré-Cœur Basilique')).toBe('church');
    });

    it('should return other for unknown categories', () => {
      expect(detectCategory('Random Place 123')).toBe('other');
    });
  });

  describe('cleanImportedPlaces', () => {
    it('should remove duplicates with same name and close coords', () => {
      const places = [
        { name: 'Tour Eiffel', lat: 48.8584, lng: 2.2945, source: 'url' as const },
        { name: 'Tour Eiffel', lat: 48.8585, lng: 2.2946, source: 'url' as const }, // Very close
        { name: 'Louvre', lat: 48.8606, lng: 2.3376, source: 'url' as const },
      ];

      const result = cleanImportedPlaces(places);
      expect(result).toHaveLength(2);
      expect(result.map(p => p.name)).toContain('Tour Eiffel');
      expect(result.map(p => p.name)).toContain('Louvre');
    });

    it('should filter out invalid coordinates', () => {
      const places = [
        { name: 'Valid', lat: 48.8584, lng: 2.2945, source: 'url' as const },
        { name: 'Invalid Lat', lat: 999, lng: 2.2945, source: 'url' as const },
        { name: 'Invalid Lng', lat: 48.8584, lng: 999, source: 'url' as const },
        { name: 'NaN', lat: NaN, lng: NaN, source: 'url' as const },
      ];

      const result = cleanImportedPlaces(places);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Valid');
    });
  });
});
