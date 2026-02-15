// ============================================
// Types for Community Reviews
// ============================================

export interface PlaceReview {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  placeId: string;
  tripId?: string;
  activityTitle: string;
  city: string;
  rating: number; // 1-5
  title: string;
  content: string;
  tips?: string;
  photos?: string[];
  visitDate?: string;
  helpfulCount: number;
  createdAt: string;
  isVerifiedVisit?: boolean; // true if linked to a trip
}

export interface ReviewsAggregate {
  placeId: string;
  averageRating: number;
  totalReviews: number;
  ratingDistribution: { [key: number]: number }; // {1: 2, 2: 5, 3: 10, 4: 15, 5: 20}
  topReview?: {
    title: string;
    content: string;
    rating: number;
    helpfulCount: number;
  };
}
