import { Attraction } from './services/attractions';
import { Flight } from './types';

/**
 * Post-traitement: corrige les durées irréalistes que Claude assigne
 */
export function fixAttractionDuration(attraction: Attraction): Attraction {
  const name = attraction.name.toLowerCase();
  const d = attraction.duration;

  // Major museums: never cap their duration (Vatican, Louvre, etc.)
  if (/\b(vatican|vaticano|musées du vatican|chapelle sixtine|sistine|louvre|uffizi|prado|british museum|hermitage|metropolitan|rijksmuseum)\b/i.test(name)) {
    return attraction;
  }

  // Places et squares: max 30min
  if (/\b(place|square|piazza|platz)\b/.test(name)) {
    if (d > 30) return { ...attraction, duration: 25 };
  }
  // Jardins et parcs: max 60min
  if (/\b(jardin|parc|park|garden)\b/.test(name)) {
    if (d > 60) return { ...attraction, duration: 60 };
  }
  // Petites églises: max 30min (pas les cathédrales/basiliques)
  if (/\b(église|eglise|church|chapelle|chapel)\b/.test(name) && !/\b(cathédrale|cathedrale|cathedral|basilique|basilica|notre-dame|sacré|sacre|sainte-chapelle|vatican|vaticano|sixtine|sistine)\b/.test(name)) {
    if (d > 30) return { ...attraction, duration: 20 };
  }
  // Cathédrales, basiliques: max 60min
  if (/\b(cathédrale|cathedral|basilique|basilica)\b/.test(name)) {
    if (d > 60) return { ...attraction, duration: 50 };
  }
  // Vignes, petits vignobles urbains: max 20min
  if (/\b(vigne|vignoble|vineyard)\b/.test(name) && !/\b(domaine|château|cave|cellar|dégustation|tasting)\b/.test(name)) {
    if (d > 20) return { ...attraction, duration: 15 };
  }
  // Monuments, arcs, statues: max 45min
  if (/\b(arc de|monument|statue|fontaine|fountain|colonne|column|obélisque|obelisk|tower|tour)\b/.test(name) && !/\bmusée\b/.test(name)) {
    if (d > 45) return { ...attraction, duration: 40 };
  }
  // Champ-de-Mars, esplanade: max 30min
  if (/\b(champ|esplanade|promenade|boulevard)\b/.test(name)) {
    if (d > 45) return { ...attraction, duration: 30 };
  }
  // Ancient/old buildings without museum: max 30min (facades, palaces without exhibit)
  if (/\b(ancien|old|palais|palazzo|palace|hôtel de ville|town hall|mairie)\b/.test(name) && !/\b(musée|museum|exposition|exhibit|galerie|gallery)\b/.test(name)) {
    if (d > 45) return { ...attraction, duration: 30 };
  }
  // Quartiers à explorer: 60-90min
  if (/\b(quartier|neighborhood|district|marché|market)\b/.test(name)) {
    if (d > 120) return { ...attraction, duration: 90 };
  }
  // Grands musées: 150-180min OK, ne pas toucher
  // Musées moyens: max 120min si pas un "grand"
  if (/\b(musée|museum)\b/.test(name)) {
    const isGrand = /\b(louvre|orsay|british|prado|hermitage|metropolitan|smithsonian|uffizi)\b/.test(name);
    if (!isGrand && d > 120) return { ...attraction, duration: 120 };
  }

  return attraction;
}

/**
 * Post-traitement: corrige les coûts irréalistes (tout à 30€)
 */
export function fixAttractionCost(attraction: Attraction): Attraction {
  const name = attraction.name.toLowerCase();
  const cost = attraction.estimatedCost;

  // Gratuit: parcs, jardins, places, extérieurs, quartiers, vignes urbaines, plages, portes, escaliers, vieille ville, ports
  if (/\b(jardin|parc|park|garden|place|square|piazza|champ|esplanade|promenade|quartier|neighborhood|district|boulevard|rue|street|vigne|vignoble|beach|plage|playa|spiaggia|gate|porte|porta|puerta|stairs|escalier|old town|vieille ville|centro storico|altstadt|harbour|harbor|port|marina|waterfront|pier|quai|boardwalk)\b/i.test(name)) {
    if (cost > 0) return { ...attraction, estimatedCost: 0 };
  }
  // Major museums: ne pas écraser le coût source (SerpAPI/Viator/pool)
  if (/\b(vatican|vaticano|musées du vatican|musei vaticani|vatican museum|chapelle sixtine|sistine chapel|cappella sistina|louvre|uffizi|prado|british museum|hermitage|metropolitan|rijksmuseum|musée d'orsay|colosseum|colisée|colosseo)\b/i.test(name)) {
    return attraction;
  }
  // Églises et cathédrales: généralement gratuit (sauf tours/cryptes)
  if (/\b(église|eglise|cathédrale|cathedrale|basilique|church|cathedral|basilica|mosquée|mosque|temple|synagogue|chapel|chapelle)\b/i.test(name)) {
    if (cost > 0 && !/\b(tour|tower|crypte|crypt|sainte-chapelle|vatican|vaticano|sixtine|sistine)\b/i.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }
  // Sainte-Chapelle: 13€
  if (/sainte-chapelle/.test(name)) {
    return { ...attraction, estimatedCost: 13 };
  }
  // Grands musées avec prix connus
  if (/\blouvre\b/.test(name) && /\bmusée\b/.test(name)) {
    return { ...attraction, estimatedCost: 22 };
  }
  if (/\borsay\b/.test(name)) {
    return { ...attraction, estimatedCost: 16 };
  }
  // Arc de Triomphe du Carrousel: gratuit (en plein air)
  if (/\barc de triomphe\b/.test(name) && /\bcarrousel\b/i.test(name)) {
    return { ...attraction, estimatedCost: 0 };
  }
  if (/\barc de triomphe\b/.test(name)) {
    return { ...attraction, estimatedCost: 16 };
  }
  if (/\btour eiffel\b/.test(name) || /\beiffel tower\b/.test(name)) {
    return { ...attraction, estimatedCost: 29 };
  }
  if (/\bnotre-dame\b/.test(name) || /\bnotre dame\b/.test(name)) {
    return { ...attraction, estimatedCost: 0 };
  }
  // Versailles: 21€
  if (/\bversailles\b/.test(name)) {
    return { ...attraction, estimatedCost: 21 };
  }
  // Panthéon: 11€
  if (/\bpanthéon\b/.test(name) || /\bpantheon\b/.test(name)) {
    return { ...attraction, estimatedCost: 11 };
  }
  // Conciergerie: 11.50€
  if (/\bconciergerie\b/.test(name)) {
    return { ...attraction, estimatedCost: 12 };
  }

  // Règles génériques pour toutes les villes:
  // Monuments/arcs/statues en plein air → gratuit (Arc de Triomphe Barcelone, etc.)
  if (/\b(arc de|arco|monument|statue|fontaine|fountain|colonne|column|obélisque|obelisk)\b/.test(name)) {
    if (cost > 0 && !/\b(musée|museum|tour|tower|observation|mirador|deck)\b/.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }

  // Miradors/viewpoints/observation points gratuits (sauf si observatoire payant avec "deck"/"tower")
  if (/\b(mirador|viewpoint|lookout|panoramic|observation point|vidikovac|belvedere|belvédère)\b/i.test(name)) {
    if (cost > 0 && !/\b(observatory|deck|tower|tour|ticket)\b/i.test(name)) {
      return { ...attraction, estimatedCost: 0 };
    }
  }

  // Street food / food markets / marchés → cap à 15€/pers max
  if (/\b(street food|food market|marché|mercado|market hall|food hall)\b/i.test(name)) {
    if (cost > 15) return { ...attraction, estimatedCost: 15 };
  }

  // Cap générique: si coût >= 30€/pers et pas bookable → probablement faux, cap à 15€
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

