/**
 * Script to fix dayTripSuggestions.ts - add commas and format properly
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../src/lib/services/dayTripSuggestions.ts');
const content = fs.readFileSync(filePath, 'utf8');

// Fix missing commas before new fields
let fixed = content.replace(/(\s+notes: "[^"]*")\s+minDays:/g, '$1,\n    minDays:');
fixed = fixed.replace(/(\s+notes: '[^']*')\s+minDays:/g, '$1,\n    minDays:');
fixed = fixed.replace(/(\s+bookingRequired: (?:true|false))\s+minDays:/g, '$1,\n    minDays:');
fixed = fixed.replace(/(\s+bestSeason: "[^"]*")\s+minDays:/g, '$1,\n    minDays:');
fixed = fixed.replace(/(\s+bestSeason: '[^']*')\s+minDays:/g, '$1,\n    minDays:');
fixed = fixed.replace(/(\s+minBudgetLevel: '[^']*')\s+minDays:/g, '$1,\n    minDays:');

fs.writeFileSync(filePath, fixed, 'utf8');
console.log('Fixed missing commas in dayTripSuggestions.ts');
