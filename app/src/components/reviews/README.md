# Community Reviews Feature

## Overview

The Community Reviews feature allows users to:
- Leave star ratings and detailed reviews for places and activities
- Mark reviews as helpful
- View aggregate ratings and review statistics
- Filter and sort reviews
- Link reviews to trips for verified visit badges

## Setup

### 1. Database Migration

Run the SQL migration to create the required tables:

```bash
# In Supabase Dashboard -> SQL Editor
# Paste and run: supabase/migrations/create_reviews_tables.sql
```

This creates:
- `place_reviews` table - Stores all reviews
- `review_helpful` table - Tracks helpful votes
- Indexes for performance
- RLS policies for security

### 2. Verify Tables

Check that the tables were created successfully in your Supabase project:
- Tables -> place_reviews
- Tables -> review_helpful

## Components

### ReviewCard
Displays an individual review with:
- User avatar and name
- Star rating
- Review title and content
- Optional tips section
- Photos (if provided)
- Helpful vote button
- Verified visit badge (if linked to a trip)

```tsx
import { ReviewCard } from '@/components/reviews';

<ReviewCard review={review} />
```

### ReviewsList
Shows a list of reviews with:
- Aggregate rating summary
- Rating distribution bar chart
- Sort options (recent, helpful, rating)
- Filter by rating
- Top review excerpt

```tsx
import { ReviewsList } from '@/components/reviews';

<ReviewsList placeId="louvre-paris" maxReviews={10} />
```

### WriteReview
Form to write a new review:
- Star rating selector with hover preview
- Title and content fields
- Optional tips field
- Optional visit date
- Photo upload (future enhancement)
- Character count validation

```tsx
import { WriteReview } from '@/components/reviews';

<WriteReview
  activityTitle="Musée du Louvre"
  city="Paris"
  placeId="louvre-paris"
  tripId={tripId} // Optional, for verified visits
  onReviewSubmitted={() => console.log('Review submitted!')}
/>
```

### ReviewsSummary
Compact badge showing aggregate stats:
- Average rating with star icon
- Review count
- Top review excerpt (on larger screens)
- Color-coded by rating (green >4, yellow 3-4, orange <3)

```tsx
import { ReviewsSummary } from '@/components/reviews';

<ReviewsSummary
  placeId="louvre-paris"
  activityTitle="Musée du Louvre"
  onViewReviews={() => setShowModal(true)}
/>
```

### ActivityReviews
Integrated component for activity cards:
- Shows ReviewsSummary by default
- Expands to show full ReviewsList
- Includes WriteReview form
- Handles state management

```tsx
import { ActivityReviews } from '@/components/reviews';

<ActivityReviews item={tripItem} tripId={tripId} />
```

## API Routes

### GET /api/reviews
Fetch reviews for a place, city, or user.

**Query Parameters:**
- `placeId` - Normalized place identifier (e.g., "louvre-paris")
- `city` - Filter by city
- `userId` - Filter by user
- `sortBy` - Sort option: recent, helpful, rating_high, rating_low
- `rating` - Filter by rating (1-5)

**Response:**
```json
[
  {
    "id": "uuid",
    "userId": "uuid",
    "userName": "John Doe",
    "userAvatar": "https://...",
    "placeId": "louvre-paris",
    "tripId": "uuid",
    "activityTitle": "Musée du Louvre",
    "city": "Paris",
    "rating": 5,
    "title": "Incontournable !",
    "content": "Une expérience magnifique...",
    "tips": "Réservez vos billets en ligne",
    "photos": ["https://..."],
    "visitDate": "2024-01-15",
    "helpfulCount": 12,
    "createdAt": "2024-01-20T10:00:00Z",
    "isVerifiedVisit": true
  }
]
```

### POST /api/reviews
Create a new review.

**Body:**
```json
{
  "placeId": "louvre-paris", // Optional, auto-generated if not provided
  "tripId": "uuid", // Optional, for verified visits
  "activityTitle": "Musée du Louvre",
  "city": "Paris",
  "rating": 5,
  "title": "Incontournable !",
  "content": "Une expérience magnifique... (min 50 chars)",
  "tips": "Réservez vos billets en ligne", // Optional
  "visitDate": "2024-01-15", // Optional
  "photos": ["https://..."] // Optional
}
```

### POST /api/reviews/[id]/helpful
Mark a review as helpful (toggle on/off).

**Response:**
```json
{
  "helpful": true,
  "count": 13
}
```

### GET /api/reviews/aggregate
Get aggregate statistics for a place.

**Query Parameters:**
- `placeId` - Required

**Response:**
```json
{
  "placeId": "louvre-paris",
  "averageRating": 4.6,
  "totalReviews": 42,
  "ratingDistribution": {
    "1": 1,
    "2": 2,
    "3": 5,
    "4": 12,
    "5": 22
  },
  "topReview": {
    "title": "Incontournable !",
    "content": "Une expérience magnifique...",
    "rating": 5,
    "helpfulCount": 12
  }
}
```

## Integration Examples

### Add to Activity Card

```tsx
import { ActivityReviews } from '@/components/reviews';

// Inside your ActivityCard component
<ActivityCard item={item}>
  {/* Existing content */}

  <ActivityReviews item={item} tripId={tripId} />
</ActivityCard>
```

### Standalone Reviews Page

```tsx
'use client';

import { ReviewsList, WriteReview } from '@/components/reviews';

export default function PlaceReviewsPage({ params }) {
  return (
    <div className="container max-w-4xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Avis - Musée du Louvre</h1>

      <div className="mb-8">
        <WriteReview
          activityTitle="Musée du Louvre"
          city="Paris"
          placeId="louvre-paris"
        />
      </div>

      <ReviewsList placeId="louvre-paris" />
    </div>
  );
}
```

## Types

All TypeScript types are defined in `/src/lib/types.ts`:

```typescript
interface PlaceReview {
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
  isVerifiedVisit?: boolean;
}

interface ReviewsAggregate {
  placeId: string;
  averageRating: number;
  totalReviews: number;
  ratingDistribution: { [key: number]: number };
  topReview?: {
    title: string;
    content: string;
    rating: number;
    helpfulCount: number;
  };
}
```

## Security

- Row Level Security (RLS) enabled on all tables
- Users can only create/edit/delete their own reviews
- Anyone can read reviews
- Authenticated users can mark reviews as helpful
- No spam/duplicate review protection (one review per place per user)

## Future Enhancements

- Photo upload to Supabase Storage
- Report inappropriate reviews
- Admin moderation panel
- Reply to reviews
- Review edit history
- Email notifications for review responses
- Trending places by recent reviews
- User reputation system (helpful reviewer badges)

## Notes

- Place IDs are auto-normalized from activity title + city
- Verified visit badge requires linking review to a trip
- Reviews require minimum 50 characters
- Helpful votes are toggleable (click again to remove)
- Average ratings are rounded to 1 decimal place
