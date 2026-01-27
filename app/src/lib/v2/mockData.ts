/**
 * Mock data for TravelSphere v2
 */

export interface Traveler {
  id: string;
  name: string;
  avatar: string;
  location: {
    lat: number;
    lng: number;
    name: string;
    country: string;
  };
  tripDates: string;
  rating: number;
  itinerary: string[];
  isOnline?: boolean;
}

export interface TripArc {
  id: string;
  travelerId: string;
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
  color?: string;
  animated?: boolean;
}

export interface Destination {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  travelers: number;
  itineraries: number;
  rating: number;
  image: string;
  tags: string[];
}

export interface Itinerary {
  id: string;
  title: string;
  author: {
    id: string;
    name: string;
    avatar: string;
  };
  destination: string;
  duration: string;
  budget: string;
  bestSeason: string;
  rating: number;
  likes: number;
  image: string;
  days: {
    day: number;
    location: string;
    activities: {
      time: string;
      name: string;
      type: 'culture' | 'food' | 'nature' | 'shopping' | 'transport' | 'hotel';
      description?: string;
    }[];
  }[];
}

// Mock Travelers on the globe
export const mockTravelers: Traveler[] = [
  {
    id: '1',
    name: 'Marie Laurent',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    location: { lat: 48.8566, lng: 2.3522, name: 'Paris', country: 'France' },
    tripDates: 'Mars 2024',
    rating: 4.8,
    itinerary: ['Paris', 'Lyon', 'Nice'],
    isOnline: true,
  },
  {
    id: '2',
    name: 'Thomas Kim',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
    location: { lat: 35.6762, lng: 139.6503, name: 'Tokyo', country: 'Japon' },
    tripDates: 'Janvier 2024',
    rating: 4.9,
    itinerary: ['Tokyo', 'Kyoto', 'Osaka'],
  },
  {
    id: '3',
    name: 'Sofia Rodriguez',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop',
    location: { lat: 41.3851, lng: 2.1734, name: 'Barcelone', country: 'Espagne' },
    tripDates: 'Février 2024',
    rating: 4.7,
    itinerary: ['Barcelone', 'Madrid', 'Séville'],
    isOnline: true,
  },
  {
    id: '4',
    name: 'Lucas Meyer',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop',
    location: { lat: 40.7128, lng: -74.006, name: 'New York', country: 'USA' },
    tripDates: 'Avril 2024',
    rating: 4.6,
    itinerary: ['New York', 'Washington', 'Boston'],
  },
  {
    id: '5',
    name: 'Emma Chen',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
    location: { lat: -33.8688, lng: 151.2093, name: 'Sydney', country: 'Australie' },
    tripDates: 'Décembre 2023',
    rating: 4.9,
    itinerary: ['Sydney', 'Melbourne', 'Brisbane'],
  },
  {
    id: '6',
    name: 'Alex Johnson',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
    location: { lat: 51.5074, lng: -0.1278, name: 'Londres', country: 'UK' },
    tripDates: 'Mai 2024',
    rating: 4.5,
    itinerary: ['Londres', 'Edinburgh', 'Dublin'],
    isOnline: true,
  },
  {
    id: '7',
    name: 'Yuki Tanaka',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop',
    location: { lat: 13.7563, lng: 100.5018, name: 'Bangkok', country: 'Thaïlande' },
    tripDates: 'Juin 2024',
    rating: 4.8,
    itinerary: ['Bangkok', 'Chiang Mai', 'Phuket'],
  },
  {
    id: '8',
    name: 'Marco Rossi',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=100&h=100&fit=crop',
    location: { lat: 41.9028, lng: 12.4964, name: 'Rome', country: 'Italie' },
    tripDates: 'Juillet 2024',
    rating: 4.7,
    itinerary: ['Rome', 'Florence', 'Venise'],
  },
  {
    id: '9',
    name: 'Sarah Williams',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100&h=100&fit=crop',
    location: { lat: -22.9068, lng: -43.1729, name: 'Rio de Janeiro', country: 'Brésil' },
    tripDates: 'Août 2024',
    rating: 4.6,
    itinerary: ['Rio', 'São Paulo', 'Salvador'],
  },
  {
    id: '10',
    name: 'David Park',
    avatar: 'https://images.unsplash.com/photo-1463453091185-61582044d556?w=100&h=100&fit=crop',
    location: { lat: 37.5665, lng: 126.978, name: 'Séoul', country: 'Corée du Sud' },
    tripDates: 'Septembre 2024',
    rating: 4.9,
    itinerary: ['Séoul', 'Busan', 'Jeju'],
    isOnline: true,
  },
];

// Trip arcs for visualization
export const mockTripArcs: TripArc[] = [
  {
    id: 'arc-1',
    travelerId: '2',
    from: { lat: 35.6762, lng: 139.6503, name: 'Tokyo' },
    to: { lat: 35.0116, lng: 135.7681, name: 'Kyoto' },
    animated: true,
  },
  {
    id: 'arc-2',
    travelerId: '3',
    from: { lat: 41.3851, lng: 2.1734, name: 'Barcelone' },
    to: { lat: 40.4168, lng: -3.7038, name: 'Madrid' },
    animated: true,
  },
  {
    id: 'arc-3',
    travelerId: '4',
    from: { lat: 40.7128, lng: -74.006, name: 'New York' },
    to: { lat: 38.9072, lng: -77.0369, name: 'Washington' },
  },
  {
    id: 'arc-4',
    travelerId: '1',
    from: { lat: 48.8566, lng: 2.3522, name: 'Paris' },
    to: { lat: 45.764, lng: 4.8357, name: 'Lyon' },
    animated: true,
  },
  {
    id: 'arc-5',
    travelerId: '8',
    from: { lat: 41.9028, lng: 12.4964, name: 'Rome' },
    to: { lat: 43.7696, lng: 11.2558, name: 'Florence' },
  },
];

// Popular destinations
export const mockDestinations: Destination[] = [
  {
    id: 'dest-1',
    name: 'Tokyo',
    country: 'Japon',
    lat: 35.6762,
    lng: 139.6503,
    travelers: 1247,
    itineraries: 89,
    rating: 4.9,
    image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&h=600&fit=crop',
    tags: ['Culture', 'Gastronomie', 'Technologie'],
  },
  {
    id: 'dest-2',
    name: 'Paris',
    country: 'France',
    lat: 48.8566,
    lng: 2.3522,
    travelers: 2341,
    itineraries: 156,
    rating: 4.8,
    image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&h=600&fit=crop',
    tags: ['Romance', 'Art', 'Gastronomie'],
  },
  {
    id: 'dest-3',
    name: 'Barcelone',
    country: 'Espagne',
    lat: 41.3851,
    lng: 2.1734,
    travelers: 1876,
    itineraries: 112,
    rating: 4.7,
    image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=800&h=600&fit=crop',
    tags: ['Plage', 'Architecture', 'Vie nocturne'],
  },
];

// Sample itinerary
export const mockItinerary: Itinerary = {
  id: 'trip-001',
  title: 'Japon Essentiel - 10 jours',
  author: {
    id: '2',
    name: 'Thomas Kim',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
  },
  destination: 'Japon',
  duration: '10 jours',
  budget: '2500€',
  bestSeason: 'Printemps (Sakura)',
  rating: 4.9,
  likes: 342,
  image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=800&h=600&fit=crop',
  days: [
    {
      day: 1,
      location: 'Tokyo',
      activities: [
        { time: '09:00', name: 'Temple Senso-ji', type: 'culture', description: 'Plus ancien temple de Tokyo' },
        { time: '12:00', name: 'Déjeuner à Asakusa', type: 'food', description: 'Ramen traditionnel' },
        { time: '14:00', name: 'Quartier Akihabara', type: 'shopping', description: 'Culture geek et électronique' },
        { time: '19:00', name: 'Shibuya Crossing', type: 'culture', description: 'Le carrefour le plus fréquenté du monde' },
      ],
    },
    {
      day: 2,
      location: 'Tokyo',
      activities: [
        { time: '08:00', name: 'Marché Tsukiji Outer', type: 'food', description: 'Petit-déjeuner sushi frais' },
        { time: '11:00', name: 'Jardin Hamarikyu', type: 'nature', description: 'Jardin traditionnel' },
        { time: '15:00', name: 'Meiji Shrine', type: 'culture', description: 'Sanctuaire shinto' },
        { time: '18:00', name: 'Harajuku', type: 'shopping', description: 'Mode et street food' },
      ],
    },
    {
      day: 3,
      location: 'Kyoto',
      activities: [
        { time: '07:00', name: 'Shinkansen Tokyo → Kyoto', type: 'transport', description: '2h15 de trajet' },
        { time: '10:00', name: 'Fushimi Inari', type: 'culture', description: '10 000 torii vermillon' },
        { time: '14:00', name: 'Gion', type: 'culture', description: 'Quartier des geishas' },
        { time: '19:00', name: 'Check-in Ryokan', type: 'hotel', description: 'Auberge traditionnelle' },
      ],
    },
  ],
};

// Recent trips for feed
export const mockRecentTrips = [
  {
    id: 'recent-1',
    user: mockTravelers[0],
    destination: 'Paris',
    image: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=400&h=300&fit=crop',
    likes: 127,
    comments: 23,
    timeAgo: 'Il y a 2h',
  },
  {
    id: 'recent-2',
    user: mockTravelers[1],
    destination: 'Tokyo',
    image: 'https://images.unsplash.com/photo-1536098561742-ca998e48cbcc?w=400&h=300&fit=crop',
    likes: 256,
    comments: 45,
    timeAgo: 'Il y a 5h',
  },
  {
    id: 'recent-3',
    user: mockTravelers[2],
    destination: 'Barcelone',
    image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=400&h=300&fit=crop',
    likes: 89,
    comments: 12,
    timeAgo: 'Il y a 1j',
  },
];
