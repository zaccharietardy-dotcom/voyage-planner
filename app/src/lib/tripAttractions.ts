import { Attraction } from './services/attractions';
import { Flight } from './types';
import { findKnownViatorProduct } from './services/viatorKnownProducts';
import { applyDurationRules } from './services/claudeItinerary';

/**
 * Post-traitement: corrige les durées irréalistes
 * Si l'attraction a dataReliability 'verified' → skip (données fiables Viator/API)
 * Sinon → déléguer à applyDurationRules() (caps/floors partagés)
 */
export function fixAttractionDuration(attraction: Attraction): Attraction {
  // Données vérifiées (Viator API, viatorKnownProducts) → ne pas toucher
  if (attraction.dataReliability === 'verified') {
    return attraction;
  }

  // Déléguer à applyDurationRules (DURATION_CAPS, DURATION_FLOORS, MINIMUM_DURATION_OVERRIDES)
  const fixedDuration = applyDurationRules(attraction.name, attraction.duration);
  if (fixedDuration !== attraction.duration) {
    return { ...attraction, duration: fixedDuration };
  }

  return attraction;
}

/**
 * Post-traitement: corrige les coûts irréalistes
 * Si l'attraction a dataReliability 'verified' → skip (prix Viator fiable)
 * Sinon → appliquer les règles de prix (gratuit/prix plancher/cap)
 */
export function fixAttractionCost(attraction: Attraction): Attraction {
  // Données vérifiées (Viator API, viatorKnownProducts) → ne pas toucher
  if (attraction.dataReliability === 'verified') {
    return attraction;
  }

  const name = attraction.name.toLowerCase();
  const cost = attraction.estimatedCost;

  // Supermarchés / grocery: coût 0 (filet de sécurité)
  if (/\b(supermarket|supermarché|supermercato|conad|carrefour|lidl|aldi|esselunga|grocery|épicerie)\b/i.test(name)) {
    return { ...attraction, estimatedCost: 0 };
  }

  // Lieux gratuits: parcs, jardins, places, quartiers, plages, portes, vieille ville, ports
  if (/\b(jardin|parc|park|garden|place|square|piazza|champ|esplanade|promenade|quartier|neighborhood|district|boulevard|rue|street|vigne|vignoble|beach|plage|playa|spiaggia|gate|porte|porta|puerta|stairs|escalier|old town|vieille ville|centro storico|altstadt|harbour|harbor|port|marina|waterfront|pier|quai|boardwalk)\b/i.test(name)) {
    if (cost > 0) return { ...attraction, estimatedCost: 0 };
  }

  // Églises et cathédrales: généralement gratuit (sauf tours/cryptes/chapelles payantes)
  if (/\b(église|eglise|cathédrale|cathedrale|basilique|church|cathedral|basilica|mosquée|mosque|temple|synagogue|chapel|chapelle)\b/i.test(name)) {
    if (cost > 0 && !/\b(tour|tower|crypte|crypt|sainte-chapelle|vatican|vaticano|sixtine|sistine)\b/i.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }

  // Monuments/arcs/statues en plein air → gratuit
  if (/\b(arc de|arco|monument|statue|fontaine|fountain|colonne|column|obélisque|obelisk)\b/.test(name)) {
    if (cost > 0 && !/\b(musée|museum|tour|tower|observation|mirador|deck)\b/.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }

  // Viewpoints/miradors gratuits (sauf observatoire payant)
  if (/\b(mirador|viewpoint|lookout|panoramic|observation point|vidikovac|belvedere|belvédère)\b/i.test(name)) {
    if (cost > 0 && !/\b(observatory|deck|tower|tour|ticket)\b/i.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }

  // Prix plancher depuis viatorKnownProducts (musées majeurs dont le prix est sous-estimé)
  const viatorData = findKnownViatorProduct(attraction.name);
  if (viatorData && viatorData.price > 0 && cost < viatorData.price * 0.5) {
    console.log(`[Cost] Floor: "${attraction.name}" ${cost}€ → ${viatorData.price}€ (Viator known price)`);
    return { ...attraction, estimatedCost: viatorData.price };
  }

  // Street food / marchés → cap à 15€/pers
  if (/\b(street food|food market|marché|mercado|market hall|food hall)\b/i.test(name)) {
    if (cost > 15) return { ...attraction, estimatedCost: 15 };
  }

  // Cap générique: si coût >= 30€/pers et pas bookable → probablement faux
  if (cost >= 30 && !attraction.bookingUrl) {
    return { ...attraction, estimatedCost: 15 };
  }

  return attraction;
}

/**
 * Estime le temps total disponible pour les activités
 */
export function estimateTotalAvailableTime(
  durationDays: number,
  outboundFlight: Flight | null,
  returnFlight: Flight | null
): number {
  // Base: 10h par jour complet
  let totalMinutes = durationDays * 10 * 60;

  // Soustraire temps perdu le premier jour (arrivée + transfert)
  if (outboundFlight) {
    const arrivalHour = new Date(outboundFlight.arrivalTime).getHours();
    // Si on arrive après 14h, on perd la matinée
    if (arrivalHour >= 14) {
      totalMinutes -= 4 * 60;
    } else if (arrivalHour >= 12) {
      totalMinutes -= 2 * 60;
    }
  }

  // Soustraire temps perdu le dernier jour (départ)
  if (returnFlight) {
    const departureHour = new Date(returnFlight.departureTime).getHours();
    // Si on part avant 14h, on perd l'après-midi
    if (departureHour <= 12) {
      totalMinutes -= 6 * 60;
    } else if (departureHour <= 16) {
      totalMinutes -= 3 * 60;
    }
  }

  return Math.max(totalMinutes, 120); // Minimum 2h
}

/**
 * Pré-alloue les attractions à tous les jours du voyage
 * GARANTIT qu'aucune attraction ne sera répétée
 * Retourne un tableau indexé par jour (0-indexed)
 */
export function preAllocateAttractions(
  allAttractions: Attraction[],
  totalDays: number,
  cityCenter: { lat: number; lng: number }
): Attraction[][] {
  const minPerDay = 4; // Minimum 4 attractions par jour (2 matin + 2 après-midi) pour éviter les trous
  const maxPerDay = 5; // Maximum 5 attractions par jour
  const result: Attraction[][] = [];

  // Initialiser le tableau pour chaque jour
  for (let d = 0; d < totalDays; d++) {
    result.push([]);
  }

  if (allAttractions.length === 0) {
    return result;
  }

  // Créer une copie pour ne pas modifier l'original
  const availableAttractions = [...allAttractions];
  const usedIds = new Set<string>();

  // PHASE 1: Assurer le minimum (2 attractions par jour)
  // Distribution en round-robin pour équilibrer
  let currentDayIndex = 0;

  // Premier passage: 1 attraction par jour
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;
    if (result[currentDayIndex].length >= 1) {
      // Passer au jour suivant qui n'a pas encore 1 attraction
      let found = false;
      for (let i = 0; i < totalDays; i++) {
        const idx = (currentDayIndex + i) % totalDays;
        if (result[idx].length < 1) {
          currentDayIndex = idx;
          found = true;
          break;
        }
      }
      if (!found) break; // Tous les jours ont au moins 1
    }

    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  // Deuxième passage: 2ème attraction par jour (si disponible)
  currentDayIndex = 0;
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;
    if (result[currentDayIndex].length >= 2) {
      // Trouver un jour avec moins de 2 attractions
      let found = false;
      for (let i = 0; i < totalDays; i++) {
        const idx = (currentDayIndex + i) % totalDays;
        if (result[idx].length < 2) {
          currentDayIndex = idx;
          found = true;
          break;
        }
      }
      if (!found) break; // Tous les jours ont au moins 2
    }

    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  // Troisième passage: 3ème attraction par jour (pour éviter les trous)
  currentDayIndex = 0;
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;
    if (result[currentDayIndex].length >= 3) {
      let found = false;
      for (let i = 0; i < totalDays; i++) {
        const idx = (currentDayIndex + i) % totalDays;
        if (result[idx].length < 3) {
          currentDayIndex = idx;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  // Quatrième passage: 4ème attraction par jour (minimum souhaité)
  currentDayIndex = 0;
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;
    if (result[currentDayIndex].length >= 4) {
      let found = false;
      for (let i = 0; i < totalDays; i++) {
        const idx = (currentDayIndex + i) % totalDays;
        if (result[idx].length < 4) {
          currentDayIndex = idx;
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    result[currentDayIndex].push(attraction);
    usedIds.add(attraction.id);
    currentDayIndex = (currentDayIndex + 1) % totalDays;
  }

  // PHASE 2: Distribuer le reste (jusqu'à maxPerDay)
  for (const attraction of availableAttractions) {
    if (usedIds.has(attraction.id)) continue;

    // Trouver le jour avec le moins d'attractions (qui n'a pas atteint le max)
    let minCount = maxPerDay + 1;
    let bestDay = -1;
    for (let d = 0; d < totalDays; d++) {
      if (result[d].length < maxPerDay && result[d].length < minCount) {
        minCount = result[d].length;
        bestDay = d;
      }
    }

    if (bestDay === -1) break; // Tous les jours sont pleins

    result[bestDay].push(attraction);
    usedIds.add(attraction.id);
  }

  console.log(`[Pre-allocation] ${usedIds.size} attractions uniques réparties sur ${totalDays} jours`);
  for (let d = 0; d < totalDays; d++) {
    const count = result[d].length;
    const status = count < minPerDay ? '⚠️ SOUS-MINIMUM' : count >= minPerDay ? '✓' : '';
    console.log(`  Jour ${d + 1}: ${result[d].map(a => a.name).join(', ') || 'aucune'} ${status}`);
  }

  return result;
}

