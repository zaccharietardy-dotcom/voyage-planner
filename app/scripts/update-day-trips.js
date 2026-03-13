/**
 * Script to update dayTripSuggestions.ts with new fields
 *
 * Adds minDays, fullDayRequired, and fromCity to all entries
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/lib/services/dayTripSuggestions.ts');
const content = fs.readFileSync(filePath, 'utf8');

// City mapping for fromCity field
const cityMap = {
  'PARIS': 'paris',
  'ROME': 'rome',
  'TOKYO': 'tokyo',
  'LONDON': 'london',
  'BARCELONA': 'barcelona',
  'MADRID': 'madrid',
  'AMSTERDAM': 'amsterdam',
  'FLORENCE': 'florence',
  'NAPLES': 'naples',
  'ISTANBUL': 'istanbul',
  'ATHENS': 'athens',
  'MARRAKECH': 'marrakech',
  'BALI': 'bali',
  'REYKJAVIK': 'reykjavik',
  'PRAGUE': 'prague',
  'LISBON': 'lisbon',
  'VIENNA': 'vienna',
  'BUDAPEST': 'budapest',
  'BANGKOK': 'bangkok',
  'SEOUL': 'seoul'
};

// Rules for minDays and fullDayRequired per trip
const tripRules = {
  // PARIS
  'Château de Versailles': { minDays: 3, fullDayRequired: true },
  'Jardins de Monet à Giverny': { minDays: 4, fullDayRequired: true },
  'Mont-Saint-Michel': { minDays: 6, fullDayRequired: true },
  'Disneyland Paris': { minDays: 4, fullDayRequired: true },
  'Château de Fontainebleau': { minDays: 4, fullDayRequired: true },
  'Cathédrale de Reims': { minDays: 4, fullDayRequired: true },
  'Provins': { minDays: 5, fullDayRequired: true },

  // ROME
  'Pompéi et Herculanum': { minDays: 4, fullDayRequired: true },
  'Florence': { minDays: 5, fullDayRequired: true },
  'Tivoli (Villa d\'Este et Villa Adriana)': { minDays: 4, fullDayRequired: true },
  'Ostie Antique': { minDays: 4, fullDayRequired: true },
  'Orvieto': { minDays: 5, fullDayRequired: true },

  // TOKYO
  'Mont Fuji et Hakone': { minDays: 4, fullDayRequired: true },
  'Kamakura': { minDays: 3, fullDayRequired: true },
  'Nikko': { minDays: 4, fullDayRequired: true },
  'Yokohama': { minDays: 3, fullDayRequired: false },
  'Kawagoe': { minDays: 4, fullDayRequired: true },

  // LONDON
  'Stonehenge et Bath': { minDays: 4, fullDayRequired: true },
  'Oxford': { minDays: 4, fullDayRequired: true },
  'Cambridge': { minDays: 4, fullDayRequired: true },
  'Windsor Castle': { minDays: 3, fullDayRequired: false },
  'Canterbury': { minDays: 4, fullDayRequired: true },
  'Brighton': { minDays: 4, fullDayRequired: true },
  'Stratford-upon-Avon': { minDays: 5, fullDayRequired: true },

  // BARCELONA
  'Montserrat': { minDays: 3, fullDayRequired: true },
  'Gérone et Figueres (Musée Dalí)': { minDays: 4, fullDayRequired: true },
  'Sitges': { minDays: 3, fullDayRequired: true },
  'Tarragone': { minDays: 4, fullDayRequired: true },
  'Monastère de Poblet': { minDays: 5, fullDayRequired: true },

  // MADRID
  'Tolède': { minDays: 3, fullDayRequired: true },
  'Ségovie': { minDays: 4, fullDayRequired: true },
  'El Escorial et Valle de los Caídos': { minDays: 4, fullDayRequired: true },
  'Ávila': { minDays: 4, fullDayRequired: true },
  'Aranjuez': { minDays: 4, fullDayRequired: true },

  // AMSTERDAM
  'Haarlem': { minDays: 3, fullDayRequired: false },
  'Keukenhof (Jardins de tulipes)': { minDays: 3, fullDayRequired: true },
  'Zaanse Schans': { minDays: 3, fullDayRequired: false },
  'La Haye et Delft': { minDays: 4, fullDayRequired: true },
  'Giethoorn': { minDays: 5, fullDayRequired: true },

  // FLORENCE
  'Pise': { minDays: 3, fullDayRequired: true },
  'Sienne': { minDays: 4, fullDayRequired: true },
  'San Gimignano': { minDays: 4, fullDayRequired: true },
  'Cinque Terre': { minDays: 5, fullDayRequired: true },
  'Lucques': { minDays: 4, fullDayRequired: true },

  // NAPLES
  'Pompéi': { minDays: 3, fullDayRequired: true },
  'Côte Amalfitaine (Positano, Amalfi)': { minDays: 4, fullDayRequired: true },
  'Capri': { minDays: 4, fullDayRequired: true },
  'Herculanum': { minDays: 4, fullDayRequired: true },
  'Caserte (Palais Royal)': { minDays: 4, fullDayRequired: true },

  // ISTANBUL
  'Princes\' Islands': { minDays: 4, fullDayRequired: true },
  'Bursa': { minDays: 5, fullDayRequired: true },

  // ATHENS
  'Delphes': { minDays: 4, fullDayRequired: true },
  'Météores': { minDays: 5, fullDayRequired: true },
  'Cap Sounion': { minDays: 3, fullDayRequired: false },
  'Épidaure et Nauplie': { minDays: 4, fullDayRequired: true },
  'Mycènes': { minDays: 4, fullDayRequired: true },

  // MARRAKECH
  'Vallée de l\'Ourika': { minDays: 4, fullDayRequired: true },
  'Essaouira': { minDays: 5, fullDayRequired: true },
  'Cascades d\'Ouzoud': { minDays: 5, fullDayRequired: true },
  'Aït-Ben-Haddou': { minDays: 6, fullDayRequired: true },

  // BALI
  'Ubud': { minDays: 4, fullDayRequired: true },
  'Temples de Tanah Lot et Uluwatu': { minDays: 3, fullDayRequired: true },
  'Mont Batur (lever de soleil)': { minDays: 4, fullDayRequired: true },
  'Nusa Penida': { minDays: 5, fullDayRequired: true },

  // REYKJAVIK
  'Cercle d\'Or (Golden Circle)': { minDays: 3, fullDayRequired: true },
  'Lagune Bleue': { minDays: 3, fullDayRequired: false },
  'Côte Sud (Seljalandsfoss, Skógafoss)': { minDays: 4, fullDayRequired: true },
  'Péninsule de Snæfellsnes': { minDays: 5, fullDayRequired: true },

  // PRAGUE
  'Château de Karlštejn': { minDays: 3, fullDayRequired: false },
  'Kutná Hora': { minDays: 4, fullDayRequired: true },
  'Český Krumlov': { minDays: 5, fullDayRequired: true },

  // LISBON
  'Sintra': { minDays: 3, fullDayRequired: true },
  'Cascais et Cabo da Roca': { minDays: 3, fullDayRequired: true },
  'Óbidos': { minDays: 4, fullDayRequired: true },
  'Évora': { minDays: 5, fullDayRequired: true },

  // VIENNA
  'Palais de Schönbrunn': { minDays: 3, fullDayRequired: false },
  'Wachau Valley': { minDays: 4, fullDayRequired: true },

  // BUDAPEST
  'Szentendre': { minDays: 3, fullDayRequired: false },
  'Eger': { minDays: 4, fullDayRequired: true },
  'Lac Balaton': { minDays: 5, fullDayRequired: true },

  // BANGKOK
  'Ayutthaya': { minDays: 3, fullDayRequired: true },
  'Marché flottant de Damnoen Saduak': { minDays: 3, fullDayRequired: true },
  'Kanchanaburi (Pont de la rivière Kwaï)': { minDays: 4, fullDayRequired: true },

  // SEOUL
  'DMZ (Zone démilitarisée)': { minDays: 4, fullDayRequired: true },
  'Suwon (Forteresse Hwaseong)': { minDays: 3, fullDayRequired: true },
  'Temple Haeinsa': { minDays: 5, fullDayRequired: true }
};

// Extract entries and add fields
let currentCity = '';
const lines = content.split('\n');
let output = [];
let inDatabase = false;
let inEntry = false;
let entryLines = [];
let entryName = '';

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Detect city section
  const cityMatch = line.match(/\/\/ ([A-Z]+) \(/);
  if (cityMatch && cityMap[cityMatch[1]]) {
    currentCity = cityMap[cityMatch[1]];
  }

  // Detect database start
  if (line.includes('export const DAY_TRIP_DATABASE')) {
    inDatabase = true;
  }

  // Detect entry start
  if (inDatabase && line.trim() === '{') {
    inEntry = true;
    entryLines = [line];
    continue;
  }

  // Collect entry lines
  if (inEntry) {
    entryLines.push(line);

    // Extract name
    const nameMatch = line.match(/name: ['"](.+)['"]/);
    if (nameMatch) {
      entryName = nameMatch[1];
    }

    // Detect entry end
    if (line.trim().startsWith('},') || line.trim() === '}') {
      // Process entry: add new fields before closing brace
      const lastLineIdx = entryLines.length - 1;
      const closingLine = entryLines[lastLineIdx];

      // Get rules for this trip
      const rules = tripRules[entryName] || { minDays: 4, fullDayRequired: true };

      // Insert new fields before closing brace
      const indent = '    ';
      const newFields = [
        `${indent}minDays: ${rules.minDays},`,
        `${indent}fullDayRequired: ${rules.fullDayRequired},`,
        `${indent}fromCity: '${currentCity}'`
      ];

      // Add fields before last line, ensuring last field has comma
      for (let j = 0; j < entryLines.length - 1; j++) {
        let outputLine = entryLines[j];
        // If this is the second-to-last line and doesn't end with comma, add one
        if (j === entryLines.length - 2 && !outputLine.trim().endsWith(',')) {
          outputLine = outputLine.replace(/\s*$/, ',');
        }
        output.push(outputLine);
      }
      output.push(...newFields);
      output.push(closingLine);

      inEntry = false;
      entryLines = [];
      entryName = '';
      continue;
    }
  }

  // Detect end of database
  if (inDatabase && line.includes('];')) {
    inDatabase = false;
  }

  // Pass through non-entry lines
  if (!inEntry) {
    output.push(line);
  }
}

console.log('Processed file, writing output...');
fs.writeFileSync(filePath, output.join('\n'), 'utf8');
console.log('Done! Updated dayTripSuggestions.ts');
