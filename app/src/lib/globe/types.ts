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
  imageUrl?: string;
}

export interface TripArc {
  id: string;
  travelerId: string;
  from: { lat: number; lng: number; name: string };
  to: { lat: number; lng: number; name: string };
  color?: string;
  animated?: boolean;
}
