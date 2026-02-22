export interface GlobeWaypoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  type: string;
  dayNumber?: number;
  order?: number;
  imageUrl?: string;
  tripPhotoId?: string;
}

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
  routePoints?: GlobeWaypoint[];
  destination?: string;
  ownerName?: string;
  isOnline?: boolean;
  imageUrl?: string;
}

export type ClusterLevel = 'continent' | 'country' | 'city' | 'trip' | 'monument';

export interface PhotoCluster {
  id: string;
  level: ClusterLevel;
  lat: number;
  lng: number;
  label: string;
  photoUrls: string[];
  tripCount: number;
  activityCount: number;
  children: PhotoCluster[];
  tripIds: string[];
}

export interface GlobePhotoPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  imageUrl: string;
  tripId: string;
  dayNumber?: number;
  type: string;
}

export interface TripArc {
  id: string;
  travelerId: string;
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
  color?: string;
  animated?: boolean;
  distanceKm?: number;
  isLongHaul?: boolean;
}
