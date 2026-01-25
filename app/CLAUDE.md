# Voyage Travel Planner - Project Guidelines

## Quick Commands

```bash
npm run dev          # Start development server
npm test             # Run all tests
npm run test:watch   # TDD watch mode
npm run test:e2e     # E2E validation tests
npm run lint         # Check code style
npm run db:push      # Push Prisma schema to SQLite
npm run db:studio    # Open Prisma Studio GUI
npm run db:generate  # Generate Prisma client
```

## Critical Constraints

| Constraint | Value | Notes |
|------------|-------|-------|
| SerpAPI quota | 250 req/month | ~213 remaining, use sparingly |
| Cache TTL | 30 days | SQLite via Prisma |
| Min restaurant rating | 3.7 | Filter out low quality |
| Min hotel rating | 4.0 | Quality threshold |
| Geographic validation | MANDATORY | No activities outside current city |

## Architecture

```
src/
├── app/                    # Next.js App Router
│   ├── api/               # API routes (generate, attractions, stats)
│   ├── plan/              # Trip planning wizard
│   └── trip/[id]/         # Trip display page
├── components/
│   ├── forms/             # Step wizard components (StepDestination, etc.)
│   ├── trip/              # Trip display (ActivityCard, DayTimeline, etc.)
│   └── ui/                # Radix UI primitives (shadcn/ui)
├── lib/
│   ├── services/          # 35+ business logic services
│   ├── __tests__/         # Backend tests
│   ├── types.ts           # Centralized TypeScript types
│   └── db.ts              # Prisma client
└── hooks/                 # Custom React hooks
```

## Key Services

| Service | Purpose |
|---------|---------|
| `placeDatabase.ts` | SQLite CRUD for cached places |
| `restaurants.ts` | Restaurant search (DB → SerpAPI → Claude) |
| `hotels.ts` | Hotel search with booking URLs |
| `serpApiSearch.ts` | SerpAPI integration for flights |
| `coherenceValidator.ts` | Trip logic validation |
| `scheduler.ts` | DayScheduler for timeline management |

## Data Flow Priority

For all place searches (restaurants, hotels, attractions):

1. **Database first** (SQLite, < 30 days old)
2. **SerpAPI** (if not in DB or stale)
3. **Claude AI** (fallback, synthetic data)
4. **Generic fallback** (last resort)

## Testing (TDD)

### Workflow
1. **EXPLORE** - Read existing code
2. **PLAN** - Define test cases
3. **RED** - Write failing tests
4. **GREEN** - Implement to pass
5. **REFACTOR** - Improve code quality
6. **COMMIT** - Conventional commits

### Test Organization
- Backend tests: `src/lib/__tests__/*.test.ts`
- Component tests: `src/components/**/*.test.tsx`
- Use Jest + React Testing Library

### Running Tests
```bash
npm test                           # All tests
npm test -- --watch               # Watch mode
npm test -- --coverage            # Coverage report
npm run test:e2e                  # E2E validation only
```

## Code Standards

### TypeScript
- `strict: true` - No shortcuts
- NO `any` type - Ever
- Explicit return types for public functions
- Interfaces for data shapes

### Functions
- Max 50 lines per function
- Single responsibility
- Guard clauses first
- Clear naming (no `x`, `temp`, `data`)

### Components
- Max 200 lines per component
- Functional components only (hooks)
- Props interfaces defined
- `'use client'` when needed

### Comments
- French for business logic explanations
- English for technical comments
- "WHY" not "WHAT"

## API Keys (.env.local)

```env
ANTHROPIC_API_KEY=      # Claude AI
SERPAPI_API_KEY=        # SerpAPI (limited!)
GOOGLE_AI_API_KEY=      # Gemini (optional)
AMADEUS_API_KEY=        # Flights (sandbox)
FOURSQUARE_API_KEY=     # Places (optional)
DATABASE_URL=           # SQLite path
```

## Common Patterns

### Service with DB Priority
```typescript
export async function searchX(params) {
  // 1. Check database first
  const cached = await searchPlacesFromDB({ ... });
  if (cached.length >= MIN_RESULTS) return cached;

  // 2. Call external API
  const fresh = await externalApiCall();

  // 3. Save to database for next time
  await savePlacesToDB(fresh, 'serpapi');

  return fresh;
}
```

### Component Test Pattern
```typescript
import { render, screen } from '@testing-library/react';
import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent prop="value" />);
    expect(screen.getByText('expected')).toBeInTheDocument();
  });
});
```

## Validation Rules (from tests)

- Flight numbers: 2-letter code + 1-4 digits (e.g., "VY8012")
- Airport codes: 3 uppercase letters (e.g., "CDG", "BCN")
- Check-in: Never before 14:00
- Check-out: Never after 12:00
- No Chinese/Asian restaurants in Spain destinations
- GPS coordinates must be within 20km of city center
- Return date must be after departure date

## Git Workflow

```bash
# Feature branch
git checkout -b feat/feature-name

# Conventional commits
git commit -m "feat: add feature description"
git commit -m "fix: resolve bug description"
git commit -m "test: add tests for X"
git commit -m "refactor: improve Y"

# Before PR
npm test && npm run lint
```
