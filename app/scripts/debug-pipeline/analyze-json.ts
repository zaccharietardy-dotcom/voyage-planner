#!/usr/bin/env npx tsx
/**
 * Analyze generated trip JSON to verify pipeline fixes
 */
import * as fs from 'fs';
import * as path from 'path';

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: npx tsx analyze-json.ts <path-to-json>');
  process.exit(1);
}

const raw = fs.readFileSync(jsonPath, 'utf-8');
const data = JSON.parse(raw);
const trip = data.trip || data;

console.log('='.repeat(80));
console.log('PIPELINE FIX VERIFICATION');
console.log('='.repeat(80));
console.log(`Trip: ${trip.destination} (${trip.days?.length} days)`);
console.log();

// ============================================================
// FIX 1: Transport Google Maps URLs should point to real stations
// ============================================================
console.log('--- FIX 1: Transport Google Maps URLs ---');
let fix1Pass = true;
for (const day of trip.days || []) {
  for (const item of day.items || []) {
    if (item.type === 'transport') {
      const url = item.googleMapsUrl || '';
      const hasEmoji = url.includes('%F0%9F') || url.includes('🚄') || url.includes('🚌') || url.includes('🧭');
      const hasArrow = url.includes('%E2%86%92') || url.includes('→');
      if (hasEmoji || hasArrow) {
        console.log(`  FAIL J${day.dayNumber}: "${item.title}" => URL contains emoji/arrow`);
        console.log(`    URL: ${url.substring(0, 120)}...`);
        fix1Pass = false;
      } else if (url) {
        // Extract the query part
        const match = url.match(/[?&]q=([^&]+)/);
        const query = match ? decodeURIComponent(match[1]) : '(no query param)';
        console.log(`  OK   J${day.dayNumber}: "${item.title}" => q=${query}`);
      } else {
        console.log(`  WARN J${day.dayNumber}: "${item.title}" => no googleMapsUrl`);
      }
    }
  }
}
console.log(`  Result: ${fix1Pass ? 'PASS' : 'FAIL'}`);
console.log();

// ============================================================
// FIX 2: Hotel booking URL should contain hotel name + dates
// ============================================================
console.log('--- FIX 2: Hotel Booking URL ---');
let fix2Pass = true;
for (const day of trip.days || []) {
  for (const item of day.items || []) {
    if (item.type === 'checkin' || item.type === 'checkout') {
      const url = item.bookingUrl || item.link || '';
      const hasName = url.includes('ss=') && !url.match(/ss=[A-Z][a-z]+&/); // not just city name
      const hasDates = url.includes('checkin=') && url.includes('checkout=');
      console.log(`  J${day.dayNumber} ${item.type}: ${item.title}`);
      console.log(`    URL snippet: ${url.substring(0, 150)}...`);
      console.log(`    Has specific name: ${hasName}, Has dates: ${hasDates}`);
      if (!hasDates) {
        fix2Pass = false;
      }
    }
  }
}
// Also check trip.hotel
if (trip.hotel) {
  const hUrl = trip.hotel.bookingUrl || '';
  console.log(`  Hotel object: ${trip.hotel.name}`);
  console.log(`    URL: ${hUrl.substring(0, 150)}...`);
  const hasDates = hUrl.includes('checkin=') && hUrl.includes('checkout=');
  console.log(`    Has dates: ${hasDates}`);
  if (!hasDates) fix2Pass = false;
}
console.log(`  Result: ${fix2Pass ? 'PASS' : 'FAIL'}`);
console.log();

// ============================================================
// FIX 3: Times should be rounded to :00/:15/:30/:45
// ============================================================
console.log('--- FIX 3: Time Rounding (:00/:15/:30/:45) ---');
let fix3Pass = true;
const badTimes: string[] = [];
for (const day of trip.days || []) {
  for (const item of day.items || []) {
    if (item.type === 'flight' || item.type === 'transport') continue;
    const startTime = item.startTime || item.time || '';
    if (!startTime) continue;
    const match = startTime.match(/:(\d{2})$/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      if (minutes % 15 !== 0) {
        badTimes.push(`J${day.dayNumber} ${item.type} "${item.title}": ${startTime}`);
        fix3Pass = false;
      }
    }
  }
}
if (badTimes.length > 0) {
  for (const bt of badTimes) {
    console.log(`  FAIL ${bt}`);
  }
} else {
  console.log('  All non-transport times are on 15-min boundaries');
}
console.log(`  Result: ${fix3Pass ? 'PASS' : 'FAIL'}`);
console.log();

// ============================================================
// FIX 4: Gaps between activities
// ============================================================
console.log('--- FIX 4: Gaps Between Activities ---');
let maxGap = 0;
let gapDetails: string[] = [];
for (const day of trip.days || []) {
  const items = day.items || [];
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    // Parse times
    const prevEnd = prev.endTime || '';
    const currStart = curr.startTime || curr.time || '';
    if (!prevEnd || !currStart) continue;

    const prevMatch = prevEnd.match(/(\d{1,2}):(\d{2})$/);
    const currMatch = currStart.match(/(\d{1,2}):(\d{2})$/);
    if (!prevMatch || !currMatch) continue;

    const prevMinutes = parseInt(prevMatch[1], 10) * 60 + parseInt(prevMatch[2], 10);
    const currMinutes = parseInt(currMatch[1], 10) * 60 + parseInt(currMatch[2], 10);
    const gap = currMinutes - prevMinutes;

    if (gap > 45) {
      gapDetails.push(`  J${day.dayNumber}: ${prev.title} (end ${prevEnd}) -> ${curr.title} (start ${currStart}) = ${gap}min gap`);
    }
    if (gap > maxGap) maxGap = gap;
  }
}
if (gapDetails.length > 0) {
  console.log(`  Gaps > 45min found:`);
  for (const g of gapDetails) console.log(g);
} else {
  console.log('  No gaps > 45min found');
}
console.log(`  Max gap: ${maxGap}min`);
console.log(`  Result: ${gapDetails.length === 0 ? 'PASS' : 'WARN - large gaps exist'}`);
console.log();

// ============================================================
// FIX 5: Cross-day duplicate activities
// ============================================================
console.log('--- FIX 5: Cross-Day Duplicates ---');
let fix5Pass = true;
const allActivities: Array<{name: string; day: number; lat: number; lng: number}> = [];
const duplicates: string[] = [];

function normalize(name: string): string {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

for (const day of trip.days || []) {
  for (const item of day.items || []) {
    if (item.type !== 'activity') continue;
    const norm = normalize(item.title);
    const lat = item.latitude || 0;
    const lng = item.longitude || 0;

    for (const existing of allActivities) {
      if (existing.day === day.dayNumber) continue; // same day is ok
      const nameMatch = norm === normalize(existing.name);
      const dist = haversine(lat, lng, existing.lat, existing.lng);
      const gpsClose = dist < 100;

      if (nameMatch || gpsClose) {
        duplicates.push(`  "${item.title}" (J${day.dayNumber}) <-> "${existing.name}" (J${existing.day}) [dist=${Math.round(dist)}m, nameMatch=${nameMatch}]`);
        fix5Pass = false;
      }
    }
    allActivities.push({name: item.title, day: day.dayNumber, lat, lng});
  }
}

if (duplicates.length > 0) {
  for (const d of duplicates) console.log(d);
} else {
  console.log('  No cross-day duplicates found');
}
console.log(`  Result: ${fix5Pass ? 'PASS' : 'FAIL'}`);
console.log();

// ============================================================
// Summary
// ============================================================
console.log('='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`Fix 1 (Transport URLs):    ${fix1Pass ? 'PASS' : 'FAIL'}`);
console.log(`Fix 2 (Hotel Booking URL): ${fix2Pass ? 'PASS' : 'FAIL'}`);
console.log(`Fix 3 (Time Rounding):     ${fix3Pass ? 'PASS' : 'FAIL'}`);
console.log(`Fix 4 (Gaps):              ${gapDetails.length === 0 ? 'PASS' : 'WARN (' + gapDetails.length + ' gaps > 45min)'}`);
console.log(`Fix 5 (Duplicates):        ${fix5Pass ? 'PASS' : 'FAIL'}`);
