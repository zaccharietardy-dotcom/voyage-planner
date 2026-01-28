/**
 * Script de test: Pool SerpAPI + Claude Curation
 *
 * Teste plusieurs destinations et affiche:
 * - Les attractions trouvées par SerpAPI (pool complet)
 * - La réponse de Claude (itinéraire curé)
 *
 * Usage: npx tsx scripts/test-attractions-pool.ts
 */

// Charger les variables d'environnement AVANT tout import
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// Vérification immédiate
console.log('ENV check:', {
  SERPAPI: process.env.SERPAPI_KEY ? `✅ (${process.env.SERPAPI_KEY.substring(0, 8)}...)` : '❌',
  ANTHROPIC: process.env.ANTHROPIC_API_KEY ? `✅ (${process.env.ANTHROPIC_API_KEY.substring(0, 8)}...)` : '❌',
});

// Imports APRÈS dotenv
const { searchAttractionsMultiQuery, searchMustSeeAttractions } = require('../src/lib/services/serpApiPlaces');
const { generateClaudeItinerary, summarizeAttractions } = require('../src/lib/services/claudeItinerary');

// ============================================
// Destinations de test
// ============================================

interface TestDestination {
  name: string;
  cityCenter: { lat: number; lng: number };
  durationDays: number;
  activities: string[];
  mustSee?: string;
  budgetLevel: string;
  groupType: string;
}

const TEST_DESTINATIONS: TestDestination[] = [
  {
    name: 'Tokyo, Japon',
    cityCenter: { lat: 35.6762, lng: 139.6503 },
    durationDays: 7,
    activities: ['culture', 'gastronomy', 'nature'],
    mustSee: 'La Tour de Tokyo, Sanctuaire Asakusa, Tokyo Skytree',
    budgetLevel: 'moderate',
    groupType: 'couple',
  },
  {
    name: 'Naples, Italie',
    cityCenter: { lat: 40.8518, lng: 14.2681 },
    durationDays: 5,
    activities: ['culture', 'gastronomy', 'nature'],
    mustSee: 'Pompéi, Vésuve',
    budgetLevel: 'moderate',
    groupType: 'couple',
  },
  {
    name: 'Paris, France',
    cityCenter: { lat: 48.8566, lng: 2.3522 },
    durationDays: 4,
    activities: ['culture', 'gastronomy', 'shopping'],
    mustSee: 'Tour Eiffel, Louvre, Sacré-Cœur',
    budgetLevel: 'comfort',
    groupType: 'couple',
  },
];

// ============================================
// Main
// ============================================

async function testDestination(dest: TestDestination) {
  console.log('\n' + '='.repeat(80));
  console.log(`📍 ${dest.name} (${dest.durationDays} jours)`);
  console.log('='.repeat(80));

  // 1. Pool SerpAPI
  console.log('\n--- ÉTAPE 1: Pool SerpAPI ---\n');
  const pool = await searchAttractionsMultiQuery(dest.name, dest.cityCenter, {
    types: dest.activities as any[],
    limit: 50,
  });

  console.log(`\n📊 ${pool.length} attractions trouvées:\n`);
  const poolTable = pool.map((a: any, i: number) => ({
    '#': i + 1,
    Nom: a.name.substring(0, 40),
    Type: a.type,
    Rating: a.rating?.toFixed(1) || 'N/A',
    Durée: `${a.duration}min`,
    Coût: `${a.estimatedCost}€`,
    MustSee: a.mustSee ? '⭐' : '',
    Fiabilité: a.dataReliability,
  }));
  console.table(poolTable);

  // 2. MustSee spécifiques
  let fullPool = [...pool];
  if (dest.mustSee) {
    console.log('\n--- ÉTAPE 1b: MustSee spécifiques ---\n');
    const mustSeeResults = await searchMustSeeAttractions(dest.mustSee, dest.name, dest.cityCenter);

    if (mustSeeResults.length > 0) {
      console.log(`\n✅ MustSee trouvés:`);
      for (const ms of mustSeeResults) {
        console.log(`  - ${ms.name} (${ms.latitude.toFixed(4)}, ${ms.longitude.toFixed(4)})`);
        // Ajouter au pool si pas déjà présent
        const poolNames = new Set(fullPool.map(a => a.name.toLowerCase()));
        if (!poolNames.has(ms.name.toLowerCase())) {
          fullPool.unshift(ms);
        }
      }
    }
    console.log(`\nPool total après mustSee: ${fullPool.length} attractions`);
  }

  // 3. Claude Curation
  console.log('\n--- ÉTAPE 2: Claude Sonnet Curation ---\n');
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 30); // Dans 30 jours

  const itinerary = await generateClaudeItinerary({
    destination: dest.name,
    durationDays: dest.durationDays,
    startDate: startDate.toISOString().split('T')[0],
    activities: dest.activities,
    budgetLevel: dest.budgetLevel,
    mustSee: dest.mustSee,
    groupType: dest.groupType,
    attractionPool: summarizeAttractions(fullPool),
  });

  if (!itinerary) {
    console.log('❌ Claude n\'a pas répondu (fallback activé)');
    return;
  }

  console.log(`\n📋 Itinéraire Claude (${itinerary.days.length} jours):\n`);

  for (const day of itinerary.days) {
    console.log(`\n  🗓️ Jour ${day.dayNumber}: ${day.theme}`);
    if (day.isDayTrip) {
      console.log(`     🚌 DAY TRIP → ${day.dayTripDestination} (${day.dayTripTransport})`);
    }
    console.log(`     📝 ${day.dayNarrative}`);

    // Attractions sélectionnées
    const selectedNames = day.selectedAttractionIds.map((id: string) => {
      const attr = fullPool.find((a: any) => a.id === id);
      return attr ? attr.name : `[inconnu: ${id}]`;
    });
    console.log(`     📌 Attractions: ${selectedNames.join(', ')}`);

    // Suggestions additionnelles
    if (day.additionalSuggestions.length > 0) {
      console.log(`     ➕ Suggestions Claude:`);
      for (const s of day.additionalSuggestions) {
        console.log(`        - ${s.name} (${s.area}) - ${s.whyVisit}`);
      }
    }

    // Booking advice
    if (day.bookingAdvice?.length > 0) {
      console.log(`     🎫 Réservations:`);
      for (const b of day.bookingAdvice) {
        const icon = b.urgency === 'essential' ? '🔴' : b.urgency === 'recommended' ? '🟡' : '🟢';
        console.log(`        ${icon} ${b.attractionName}: ${b.reason}`);
        if (b.bookingSearchQuery) {
          console.log(`           🔗 Rechercher: "${b.bookingSearchQuery}"`);
        }
      }
    }
  }

  // Booking warnings (global)
  if (itinerary.bookingWarnings?.length > 0) {
    console.log(`\n  🎫 RÉSERVATIONS À FAIRE:`);
    for (const b of itinerary.bookingWarnings) {
      const icon = b.urgency === 'essential' ? '🔴 OBLIGATOIRE' : b.urgency === 'recommended' ? '🟡 Recommandé' : '🟢 Optionnel';
      console.log(`     ${icon} - ${b.attractionName}: ${b.reason}`);
      if (b.bookingSearchQuery) {
        console.log(`       🔗 "${b.bookingSearchQuery}"`);
      }
    }
  }

  // Seasonal tips
  if (itinerary.seasonalTips?.length > 0) {
    console.log(`\n  🌸 Conseils saisonniers:`);
    for (const tip of itinerary.seasonalTips) {
      console.log(`     - ${tip}`);
    }
  }

  // Excluded reasons
  if (itinerary.excludedReasons?.length > 0) {
    console.log(`\n  🚫 Exclusions (${itinerary.excludedReasons.length}):`);
    for (const ex of itinerary.excludedReasons.slice(0, 5)) {
      const attr = fullPool.find(a => a.id === ex.id);
      console.log(`     - ${attr?.name || ex.id}: ${ex.reason}`);
    }
  }
}

async function main() {
  console.log('🧪 Test Pool SerpAPI + Claude Curation');
  console.log(`   Destinations: ${TEST_DESTINATIONS.map(d => d.name).join(', ')}`);
  console.log(`   SERPAPI_KEY: ${process.env.SERPAPI_KEY ? '✅' : '❌'}`);
  console.log(`   ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌'}`);

  // Test une seule destination pour économiser les crédits (changer l'index pour tester)
  const testIndex = parseInt(process.env.TEST_INDEX || '2'); // 0=Tokyo, 1=Naples, 2=Paris
  if (testIndex >= 0 && testIndex < TEST_DESTINATIONS.length) {
    await testDestination(TEST_DESTINATIONS[testIndex]);
  } else {
    for (const dest of TEST_DESTINATIONS) {
      await testDestination(dest);
    }
  }

  console.log('\n\n✅ Tests terminés!');
}

main().catch(console.error);
