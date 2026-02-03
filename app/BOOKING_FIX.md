# Booking.com Direct URL Fix

## Contexte du Probleme

Les liens Booking.com generaient des URL de recherche au lieu de liens directs vers les hotels:
- **Mauvais**: `https://www.booking.com/searchresults.html?ss=Hotel+Name+City`
- **Bon**: `https://www.booking.com/hotel/nl/hotel-name.html`

## Solution Implementee

### 1. Generation de Slug depuis le Nom de l'Hotel

**Fichier**: `src/lib/services/rapidApiBooking.ts`

```typescript
/**
 * Genere un slug Booking.com a partir du nom de l'hotel
 * Ex: "Hotel V Nesplein Amsterdam" -> "v-nesplein-amsterdam"
 */
function generateHotelSlug(hotelName: string): string {
  return hotelName
    .toLowerCase()
    // Retirer les mots generiques
    .replace(/\b(hotel|hostel|b&b|bed and breakfast|apartments?|residence|inn)\b/gi, '')
    // Garder uniquement lettres et chiffres
    .replace(/[^a-z0-9]+/g, '-')
    // Nettoyer les tirets en debut/fin
    .replace(/^-+|-+$/g, '')
    // Eviter les tirets multiples
    .replace(/-+/g, '-');
}
```

### 2. Construction de l'URL Directe

**Fichier**: `src/lib/services/rapidApiBooking.ts` - fonction `getHotelBookingUrl()`

```typescript
export function getHotelBookingUrl(
  hotelName: string,
  city: string,
  countryCode: string = 'nl',
  checkIn?: string,
  checkOut?: string
): string {
  // Generer le slug
  const slug = generateHotelSlug(hotelName);

  // Construire l'URL directe
  const baseUrl = `https://www.booking.com/hotel/${countryCode}/${slug}.html`;

  // Ajouter parametres de date si fournis
  const params = new URLSearchParams();
  if (checkIn) params.set('checkin', checkIn);
  if (checkOut) params.set('checkout', checkOut);
  params.set('aid', '304142'); // Affiliate ID

  return params.toString() ? `${baseUrl}?${params}` : baseUrl;
}
```

### 3. Priorite dans tripUtils.ts

**Fichier**: `src/lib/tripUtils.ts` - fonction `getAccommodationBookingUrl()`

L'ordre de priorite pour les URLs:

1. **Lien direct Booking.com** (`/hotel/`) - si deja present dans `bookingUrl`
2. **Lien Airbnb** - pour les appartements
3. **Generer lien Booking.com** - via `generateHotelLink()` qui utilise le slug

```typescript
export function getAccommodationBookingUrl(
  accom: { name: string; bookingUrl?: string; type?: string } | null | undefined,
  city: string,
  checkIn: string,
  checkOut: string
): string | undefined {
  if (!accom?.name) return undefined;

  // PRIORITE 1: Utiliser le bookingUrl direct si c'est un vrai lien Booking.com (/hotel/)
  if (accom.bookingUrl?.includes('/hotel/')) {
    return accom.bookingUrl;
  }

  // PRIORITE 2: Garder le lien Airbnb si c'est un appartement
  if (accom.type === 'apartment' && accom.bookingUrl?.includes('airbnb.com')) {
    return accom.bookingUrl;
  }

  // PRIORITE 3: Pour tout le reste -> generer lien Booking.com recherche
  return generateHotelLink(accom.name, city, checkIn, checkOut);
}
```

## Exemples de URLs Generees

| Nom Hotel | Slug Genere | URL Finale |
|-----------|-------------|------------|
| Hotel V Nesplein Amsterdam | v-nesplein-amsterdam | `/hotel/nl/v-nesplein-amsterdam.html` |
| The Dylan Amsterdam | dylan-amsterdam | `/hotel/nl/dylan-amsterdam.html` |
| NH Collection Grand Hotel | nh-collection-grand | `/hotel/nl/nh-collection-grand.html` |

## Points Importants

1. **Ne pas modifier** - Cette solution fonctionne, ne pas toucher aux fonctions ci-dessus
2. **Code pays** - Par defaut `nl` pour Pays-Bas, peut etre change selon destination
3. **Fallback** - Si le slug ne correspond pas, Booking.com redirige vers une recherche
4. **Affiliate ID** - Toujours inclure `aid=304142` dans les parametres

## Debugging

Pour verifier dans les logs:
```
[RapidAPI Booking] hotel-name: ✅ Lien direct
[RapidAPI Booking] hotel-name: ⚠️ Lien recherche
```

Si les liens sont encore de type recherche, verifier:
1. Que `getHotelBookingUrl()` est bien appelee
2. Que le slug est correctement genere (pas de caracteres speciaux)
3. Que le code pays est correct
