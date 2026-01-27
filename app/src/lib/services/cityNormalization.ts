/**
 * Service unifié de normalisation des noms de villes
 * Supporte toutes les langues (chinois, arabe, japonais, russe, etc.)
 *
 * Stratégie:
 * 1. Recherche dans le dictionnaire local (rapide)
 * 2. Fallback vers API Nominatim pour villes inconnues (avec cache)
 */

export interface NormalizedCity {
  normalized: string;      // Nom anglais normalisé (ex: "london")
  displayName: string;     // Nom d'affichage (ex: "London")
  original: string;        // Input original
  coords?: { lat: number; lng: number };
  confidence: 'high' | 'medium' | 'low';
}

// Index inversé: toutes les variantes pointent vers la clé anglaise
const CITY_INDEX: Record<string, string> = {};

// Dictionnaire principal: ~100 villes avec traductions multilingues
const CITY_DATA: Record<string, {
  displayName: string;
  coords: { lat: number; lng: number };
  translations: Record<string, string[]>;
}> = {
  // Europe de l'Ouest
  london: {
    displayName: 'London',
    coords: { lat: 51.5074, lng: -0.1278 },
    translations: {
      en: ['london'],
      fr: ['londres'],
      es: ['londres'],
      de: ['london'],
      it: ['londra'],
      pt: ['londres'],
      zh: ['伦敦', '倫敦'],
      ja: ['ロンドン'],
      ko: ['런던'],
      ar: ['لندن'],
      ru: ['лондон'],
      hi: ['लंदन'],
    },
  },
  paris: {
    displayName: 'Paris',
    coords: { lat: 48.8566, lng: 2.3522 },
    translations: {
      en: ['paris'],
      fr: ['paris'],
      es: ['paris', 'parís'],
      de: ['paris'],
      it: ['parigi'],
      pt: ['paris'],
      zh: ['巴黎'],
      ja: ['パリ'],
      ko: ['파리'],
      ar: ['باريس'],
      ru: ['париж'],
      hi: ['पेरिस'],
    },
  },
  barcelona: {
    displayName: 'Barcelona',
    coords: { lat: 41.3851, lng: 2.1734 },
    translations: {
      en: ['barcelona'],
      fr: ['barcelone'],
      es: ['barcelona'],
      ca: ['barcelona'],
      de: ['barcelona'],
      it: ['barcellona'],
      zh: ['巴塞罗那', '巴塞隆納'],
      ja: ['バルセロナ'],
      ko: ['바르셀로나'],
      ar: ['برشلونة'],
      ru: ['барселона'],
    },
  },
  rome: {
    displayName: 'Rome',
    coords: { lat: 41.9028, lng: 12.4964 },
    translations: {
      en: ['rome'],
      fr: ['rome'],
      es: ['roma'],
      de: ['rom'],
      it: ['roma'],
      pt: ['roma'],
      zh: ['罗马', '羅馬'],
      ja: ['ローマ'],
      ko: ['로마'],
      ar: ['روما'],
      ru: ['рим'],
    },
  },
  amsterdam: {
    displayName: 'Amsterdam',
    coords: { lat: 52.3676, lng: 4.9041 },
    translations: {
      en: ['amsterdam'],
      fr: ['amsterdam'],
      es: ['amsterdam', 'ámsterdam'],
      de: ['amsterdam'],
      nl: ['amsterdam'],
      zh: ['阿姆斯特丹'],
      ja: ['アムステルダム'],
      ko: ['암스테르담'],
      ar: ['أمستردام'],
      ru: ['амстердам'],
    },
  },
  berlin: {
    displayName: 'Berlin',
    coords: { lat: 52.5200, lng: 13.4050 },
    translations: {
      en: ['berlin'],
      fr: ['berlin'],
      es: ['berlín', 'berlin'],
      de: ['berlin'],
      it: ['berlino'],
      zh: ['柏林'],
      ja: ['ベルリン'],
      ko: ['베를린'],
      ar: ['برلين'],
      ru: ['берлин'],
    },
  },
  madrid: {
    displayName: 'Madrid',
    coords: { lat: 40.4168, lng: -3.7038 },
    translations: {
      en: ['madrid'],
      fr: ['madrid'],
      es: ['madrid'],
      de: ['madrid'],
      zh: ['马德里', '馬德里'],
      ja: ['マドリード'],
      ko: ['마드리드'],
      ar: ['مدريد'],
      ru: ['мадрид'],
    },
  },
  lisbon: {
    displayName: 'Lisbon',
    coords: { lat: 38.7223, lng: -9.1393 },
    translations: {
      en: ['lisbon'],
      fr: ['lisbonne'],
      es: ['lisboa'],
      de: ['lissabon'],
      pt: ['lisboa'],
      zh: ['里斯本'],
      ja: ['リスボン'],
      ko: ['리스본'],
      ar: ['لشبونة'],
      ru: ['лиссабон'],
    },
  },
  prague: {
    displayName: 'Prague',
    coords: { lat: 50.0755, lng: 14.4378 },
    translations: {
      en: ['prague'],
      fr: ['prague'],
      es: ['praga'],
      de: ['prag'],
      cs: ['praha'],
      zh: ['布拉格'],
      ja: ['プラハ'],
      ko: ['프라하'],
      ar: ['براغ'],
      ru: ['прага'],
    },
  },
  vienna: {
    displayName: 'Vienna',
    coords: { lat: 48.2082, lng: 16.3738 },
    translations: {
      en: ['vienna'],
      fr: ['vienne'],
      es: ['viena'],
      de: ['wien'],
      it: ['vienna'],
      zh: ['维也纳', '維也納'],
      ja: ['ウィーン'],
      ko: ['비엔나'],
      ar: ['فيينا'],
      ru: ['вена'],
    },
  },
  brussels: {
    displayName: 'Brussels',
    coords: { lat: 50.8503, lng: 4.3517 },
    translations: {
      en: ['brussels'],
      fr: ['bruxelles'],
      es: ['bruselas'],
      de: ['brüssel', 'brussel'],
      nl: ['brussel'],
      zh: ['布鲁塞尔', '布魯塞爾'],
      ja: ['ブリュッセル'],
      ko: ['브뤼셀'],
      ar: ['بروكسل'],
      ru: ['брюссель'],
    },
  },

  // Europe du Sud
  milan: {
    displayName: 'Milan',
    coords: { lat: 45.4642, lng: 9.1900 },
    translations: {
      en: ['milan'],
      fr: ['milan'],
      es: ['milán', 'milan'],
      de: ['mailand'],
      it: ['milano'],
      zh: ['米兰', '米蘭'],
      ja: ['ミラノ'],
      ko: ['밀라노'],
      ar: ['ميلان'],
      ru: ['милан'],
    },
  },
  florence: {
    displayName: 'Florence',
    coords: { lat: 43.7696, lng: 11.2558 },
    translations: {
      en: ['florence'],
      fr: ['florence'],
      es: ['florencia'],
      de: ['florenz'],
      it: ['firenze'],
      zh: ['佛罗伦萨', '佛羅倫斯'],
      ja: ['フィレンツェ'],
      ko: ['피렌체'],
      ar: ['فلورنسا'],
      ru: ['флоренция'],
    },
  },
  venice: {
    displayName: 'Venice',
    coords: { lat: 45.4408, lng: 12.3155 },
    translations: {
      en: ['venice'],
      fr: ['venise'],
      es: ['venecia'],
      de: ['venedig'],
      it: ['venezia'],
      zh: ['威尼斯'],
      ja: ['ヴェネツィア', 'ベネチア'],
      ko: ['베니스', '베네치아'],
      ar: ['البندقية', 'فينيسيا'],
      ru: ['венеция'],
    },
  },
  malaga: {
    displayName: 'Malaga',
    coords: { lat: 36.7213, lng: -4.4214 },
    translations: {
      en: ['malaga'],
      fr: ['malaga'],
      es: ['málaga', 'malaga'],
      de: ['malaga'],
      zh: ['马拉加', '馬拉加'],
      ja: ['マラガ'],
      ko: ['말라가'],
      ar: ['مالقة'],
      ru: ['малага'],
    },
  },

  // Asie
  tokyo: {
    displayName: 'Tokyo',
    coords: { lat: 35.6762, lng: 139.6503 },
    translations: {
      en: ['tokyo'],
      fr: ['tokyo'],
      es: ['tokio'],
      de: ['tokio'],
      ja: ['東京', 'とうきょう'],
      zh: ['东京', '東京'],
      ko: ['도쿄'],
      ar: ['طوكيو'],
      ru: ['токио'],
    },
  },
  kyoto: {
    displayName: 'Kyoto',
    coords: { lat: 35.0116, lng: 135.7681 },
    translations: {
      en: ['kyoto'],
      fr: ['kyoto'],
      es: ['kioto'],
      de: ['kyoto'],
      ja: ['京都', 'きょうと'],
      zh: ['京都'],
      ko: ['교토'],
      ar: ['كيوتو'],
      ru: ['киото'],
    },
  },
  osaka: {
    displayName: 'Osaka',
    coords: { lat: 34.6937, lng: 135.5023 },
    translations: {
      en: ['osaka'],
      fr: ['osaka'],
      es: ['osaka'],
      de: ['osaka'],
      ja: ['大阪', 'おおさか'],
      zh: ['大阪'],
      ko: ['오사카'],
      ar: ['أوساكا'],
      ru: ['осака'],
    },
  },
  seoul: {
    displayName: 'Seoul',
    coords: { lat: 37.5665, lng: 126.9780 },
    translations: {
      en: ['seoul'],
      fr: ['séoul', 'seoul'],
      es: ['seúl', 'seoul'],
      de: ['seoul'],
      ko: ['서울'],
      ja: ['ソウル'],
      zh: ['首尔', '首爾'],
      ar: ['سيول'],
      ru: ['сеул'],
    },
  },
  beijing: {
    displayName: 'Beijing',
    coords: { lat: 39.9042, lng: 116.4074 },
    translations: {
      en: ['beijing', 'peking'],
      fr: ['pékin', 'pekin', 'beijing'],
      es: ['pekín', 'pekin', 'beijing'],
      de: ['peking', 'beijing'],
      zh: ['北京'],
      ja: ['北京', 'ペキン'],
      ko: ['베이징', '북경'],
      ar: ['بكين'],
      ru: ['пекин'],
    },
  },
  shanghai: {
    displayName: 'Shanghai',
    coords: { lat: 31.2304, lng: 121.4737 },
    translations: {
      en: ['shanghai'],
      fr: ['shanghai', 'shanghaï'],
      es: ['shanghái', 'shanghai'],
      de: ['shanghai'],
      zh: ['上海'],
      ja: ['上海', 'シャンハイ'],
      ko: ['상하이'],
      ar: ['شنغهاي'],
      ru: ['шанхай'],
    },
  },
  hongkong: {
    displayName: 'Hong Kong',
    coords: { lat: 22.3193, lng: 114.1694 },
    translations: {
      en: ['hong kong', 'hongkong'],
      fr: ['hong kong'],
      es: ['hong kong'],
      de: ['hongkong'],
      zh: ['香港'],
      ja: ['香港', 'ホンコン'],
      ko: ['홍콩'],
      ar: ['هونغ كونغ'],
      ru: ['гонконг'],
    },
  },
  singapore: {
    displayName: 'Singapore',
    coords: { lat: 1.3521, lng: 103.8198 },
    translations: {
      en: ['singapore'],
      fr: ['singapour'],
      es: ['singapur'],
      de: ['singapur'],
      zh: ['新加坡'],
      ja: ['シンガポール'],
      ko: ['싱가포르'],
      ar: ['سنغافورة'],
      ru: ['сингапур'],
    },
  },
  bangkok: {
    displayName: 'Bangkok',
    coords: { lat: 13.7563, lng: 100.5018 },
    translations: {
      en: ['bangkok'],
      fr: ['bangkok'],
      es: ['bangkok'],
      de: ['bangkok'],
      th: ['กรุงเทพ'],
      zh: ['曼谷'],
      ja: ['バンコク'],
      ko: ['방콕'],
      ar: ['بانكوك'],
      ru: ['бангкок'],
    },
  },
  dubai: {
    displayName: 'Dubai',
    coords: { lat: 25.2048, lng: 55.2708 },
    translations: {
      en: ['dubai'],
      fr: ['dubaï', 'dubai'],
      es: ['dubái', 'dubai'],
      de: ['dubai'],
      ar: ['دبي'],
      zh: ['迪拜'],
      ja: ['ドバイ'],
      ko: ['두바이'],
      ru: ['дубай'],
    },
  },

  // Amérique du Nord
  newyork: {
    displayName: 'New York',
    coords: { lat: 40.7128, lng: -74.0060 },
    translations: {
      en: ['new york', 'nyc', 'new york city'],
      fr: ['new york'],
      es: ['nueva york'],
      de: ['new york'],
      zh: ['纽约', '紐約'],
      ja: ['ニューヨーク'],
      ko: ['뉴욕'],
      ar: ['نيويورك'],
      ru: ['нью-йорк'],
    },
  },
  losangeles: {
    displayName: 'Los Angeles',
    coords: { lat: 34.0522, lng: -118.2437 },
    translations: {
      en: ['los angeles', 'la'],
      fr: ['los angeles'],
      es: ['los ángeles', 'los angeles'],
      de: ['los angeles'],
      zh: ['洛杉矶', '洛杉磯'],
      ja: ['ロサンゼルス'],
      ko: ['로스앤젤레스'],
      ar: ['لوس أنجلوس'],
      ru: ['лос-анджелес'],
    },
  },
  sanfrancisco: {
    displayName: 'San Francisco',
    coords: { lat: 37.7749, lng: -122.4194 },
    translations: {
      en: ['san francisco', 'sf'],
      fr: ['san francisco'],
      es: ['san francisco'],
      de: ['san francisco'],
      zh: ['旧金山', '舊金山', '三藩市'],
      ja: ['サンフランシスコ'],
      ko: ['샌프란시스코'],
      ar: ['سان فرانسيسكو'],
      ru: ['сан-франциско'],
    },
  },
  miami: {
    displayName: 'Miami',
    coords: { lat: 25.7617, lng: -80.1918 },
    translations: {
      en: ['miami'],
      fr: ['miami'],
      es: ['miami'],
      de: ['miami'],
      zh: ['迈阿密', '邁阿密'],
      ja: ['マイアミ'],
      ko: ['마이애미'],
      ar: ['ميامي'],
      ru: ['майами'],
    },
  },
  montreal: {
    displayName: 'Montreal',
    coords: { lat: 45.5017, lng: -73.5673 },
    translations: {
      en: ['montreal'],
      fr: ['montréal', 'montreal'],
      es: ['montreal'],
      de: ['montreal'],
      zh: ['蒙特利尔', '蒙特婁'],
      ja: ['モントリオール'],
      ko: ['몬트리올'],
      ar: ['مونتريال'],
      ru: ['монреаль'],
    },
  },

  // Océanie
  sydney: {
    displayName: 'Sydney',
    coords: { lat: -33.8688, lng: 151.2093 },
    translations: {
      en: ['sydney'],
      fr: ['sydney'],
      es: ['sídney', 'sydney'],
      de: ['sydney'],
      zh: ['悉尼'],
      ja: ['シドニー'],
      ko: ['시드니'],
      ar: ['سيدني'],
      ru: ['сидней'],
    },
  },

  // Amérique du Sud
  rio: {
    displayName: 'Rio de Janeiro',
    coords: { lat: -22.9068, lng: -43.1729 },
    translations: {
      en: ['rio de janeiro', 'rio'],
      fr: ['rio de janeiro', 'rio'],
      es: ['río de janeiro', 'rio de janeiro'],
      de: ['rio de janeiro'],
      pt: ['rio de janeiro', 'rio'],
      zh: ['里约热内卢', '里約熱內盧'],
      ja: ['リオデジャネイロ'],
      ko: ['리우데자네이루'],
      ar: ['ريو دي جانيرو'],
      ru: ['рио-де-жанейро'],
    },
  },
  buenosaires: {
    displayName: 'Buenos Aires',
    coords: { lat: -34.6037, lng: -58.3816 },
    translations: {
      en: ['buenos aires'],
      fr: ['buenos aires'],
      es: ['buenos aires'],
      de: ['buenos aires'],
      zh: ['布宜诺斯艾利斯'],
      ja: ['ブエノスアイレス'],
      ko: ['부에노스아이레스'],
      ar: ['بوينس آيرس'],
      ru: ['буэнос-айрес'],
    },
  },

  // Afrique
  marrakech: {
    displayName: 'Marrakech',
    coords: { lat: 31.6295, lng: -7.9811 },
    translations: {
      en: ['marrakech', 'marrakesh'],
      fr: ['marrakech'],
      es: ['marrakech', 'marraquech'],
      de: ['marrakesch'],
      ar: ['مراكش'],
      zh: ['马拉喀什'],
      ja: ['マラケシュ'],
      ko: ['마라케시'],
      ru: ['марракеш'],
    },
  },
  cairo: {
    displayName: 'Cairo',
    coords: { lat: 30.0444, lng: 31.2357 },
    translations: {
      en: ['cairo'],
      fr: ['le caire', 'caire'],
      es: ['el cairo'],
      de: ['kairo'],
      ar: ['القاهرة'],
      zh: ['开罗', '開羅'],
      ja: ['カイロ'],
      ko: ['카이로'],
      ru: ['каир'],
    },
  },
  capetown: {
    displayName: 'Cape Town',
    coords: { lat: -33.9249, lng: 18.4241 },
    translations: {
      en: ['cape town', 'capetown'],
      fr: ['le cap', 'cape town'],
      es: ['ciudad del cabo'],
      de: ['kapstadt'],
      af: ['kaapstad'],
      zh: ['开普敦', '開普敦'],
      ja: ['ケープタウン'],
      ko: ['케이프타운'],
      ar: ['كيب تاون'],
      ru: ['кейптаун'],
    },
  },

  // France (villes d'origine courantes)
  caen: {
    displayName: 'Caen',
    coords: { lat: 49.1829, lng: -0.3707 },
    translations: {
      en: ['caen'],
      fr: ['caen'],
    },
  },
  lyon: {
    displayName: 'Lyon',
    coords: { lat: 45.7640, lng: 4.8357 },
    translations: {
      en: ['lyon', 'lyons'],
      fr: ['lyon'],
      es: ['lyon'],
      de: ['lyon'],
      zh: ['里昂'],
      ja: ['リヨン'],
      ru: ['лион'],
    },
  },
  marseille: {
    displayName: 'Marseille',
    coords: { lat: 43.2965, lng: 5.3698 },
    translations: {
      en: ['marseille', 'marseilles'],
      fr: ['marseille'],
      es: ['marsella'],
      de: ['marseille'],
      zh: ['马赛', '馬賽'],
      ja: ['マルセイユ'],
      ru: ['марсель'],
    },
  },
  nice: {
    displayName: 'Nice',
    coords: { lat: 43.7102, lng: 7.2620 },
    translations: {
      en: ['nice'],
      fr: ['nice'],
      es: ['niza'],
      de: ['nizza'],
      it: ['nizza'],
      zh: ['尼斯'],
      ja: ['ニース'],
      ru: ['ницца'],
    },
  },
  bordeaux: {
    displayName: 'Bordeaux',
    coords: { lat: 44.8378, lng: -0.5792 },
    translations: {
      en: ['bordeaux'],
      fr: ['bordeaux'],
      es: ['burdeos'],
      de: ['bordeaux'],
      zh: ['波尔多', '波爾多'],
      ja: ['ボルドー'],
      ru: ['бордо'],
    },
  },
  toulouse: {
    displayName: 'Toulouse',
    coords: { lat: 43.6047, lng: 1.4442 },
    translations: {
      en: ['toulouse'],
      fr: ['toulouse'],
      es: ['tolosa'],
      de: ['toulouse'],
      zh: ['图卢兹'],
      ja: ['トゥールーズ'],
      ru: ['тулуза'],
    },
  },
  lille: {
    displayName: 'Lille',
    coords: { lat: 50.6292, lng: 3.0573 },
    translations: {
      en: ['lille'],
      fr: ['lille'],
      nl: ['rijsel'],
      de: ['lille'],
      zh: ['里尔', '里爾'],
      ja: ['リール'],
    },
  },
  strasbourg: {
    displayName: 'Strasbourg',
    coords: { lat: 48.5734, lng: 7.7521 },
    translations: {
      en: ['strasbourg'],
      fr: ['strasbourg'],
      de: ['straßburg', 'strassburg'],
      zh: ['斯特拉斯堡'],
      ja: ['ストラスブール'],
    },
  },
  nantes: {
    displayName: 'Nantes',
    coords: { lat: 47.2184, lng: -1.5536 },
    translations: {
      en: ['nantes'],
      fr: ['nantes'],
      br: ['naoned'],
      zh: ['南特'],
      ja: ['ナント'],
    },
  },
};

// Construire l'index inversé au démarrage
function buildIndex(): void {
  for (const [key, data] of Object.entries(CITY_DATA)) {
    // Indexer toutes les traductions
    for (const variants of Object.values(data.translations)) {
      for (const variant of variants) {
        const normalized = variant.toLowerCase().trim();
        CITY_INDEX[normalized] = key;
      }
    }
  }
}

// Construire l'index au chargement du module
buildIndex();

/**
 * Normalise un nom de ville en utilisant le dictionnaire local
 * Retourne le nom anglais standardisé
 */
export function normalizeCitySync(input: string): NormalizedCity {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      normalized: '',
      displayName: '',
      original: input,
      confidence: 'low',
    };
  }

  // Normaliser l'input (lowercase, trim, remove diacritics for Latin scripts)
  const normalized = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Enlever les accents

  // Chercher dans l'index
  const key = CITY_INDEX[normalized] || CITY_INDEX[trimmed.toLowerCase()];

  if (key && CITY_DATA[key]) {
    return {
      normalized: key,
      displayName: CITY_DATA[key].displayName,
      original: input,
      coords: CITY_DATA[key].coords,
      confidence: 'high',
    };
  }

  // Pas trouvé - retourner l'input normalisé basiquement
  return {
    normalized: normalized.replace(/\s+/g, ''),
    displayName: trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase(),
    original: input,
    confidence: 'low',
  };
}

/**
 * Normalise un nom de ville avec fallback vers Nominatim pour villes inconnues
 * Utilise un cache en mémoire pour éviter les appels répétés
 */
const nominatimCache: Record<string, NormalizedCity> = {};

export async function normalizeCity(input: string): Promise<NormalizedCity> {
  // D'abord essayer le dictionnaire local
  const localResult = normalizeCitySync(input);
  if (localResult.confidence === 'high') {
    return localResult;
  }

  // Vérifier le cache Nominatim
  const cacheKey = input.toLowerCase().trim();
  if (nominatimCache[cacheKey]) {
    return nominatimCache[cacheKey];
  }

  // Fallback: appeler Nominatim
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&limit=1&accept-language=en`,
      {
        headers: {
          'User-Agent': 'VoyagePlanner/1.0',
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0) {
        const result = data[0];
        // Extraire le nom de la ville depuis display_name
        const displayParts = result.display_name.split(',');
        const cityName = displayParts[0].trim();

        const normalizedResult: NormalizedCity = {
          normalized: cityName.toLowerCase().replace(/\s+/g, ''),
          displayName: cityName,
          original: input,
          coords: {
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon),
          },
          confidence: 'medium',
        };

        // Mettre en cache
        nominatimCache[cacheKey] = normalizedResult;
        return normalizedResult;
      }
    }
  } catch (error) {
    console.error('[CityNormalization] Nominatim error:', error);
  }

  // Rien trouvé - retourner le résultat local
  nominatimCache[cacheKey] = localResult;
  return localResult;
}

/**
 * Vérifie si une ville est dans notre base de données
 */
export function isCityKnown(city: string): boolean {
  const result = normalizeCitySync(city);
  return result.confidence === 'high';
}

/**
 * Récupère les coordonnées d'une ville (sync)
 */
export function getCityCoords(city: string): { lat: number; lng: number } | null {
  const result = normalizeCitySync(city);
  return result.coords || null;
}

/**
 * Liste toutes les villes supportées
 */
export function getSupportedCities(): string[] {
  return Object.keys(CITY_DATA);
}

/**
 * Récupère toutes les traductions d'une ville
 */
export function getCityTranslations(city: string): Record<string, string[]> | null {
  const result = normalizeCitySync(city);
  if (result.confidence === 'high' && CITY_DATA[result.normalized]) {
    return CITY_DATA[result.normalized].translations;
  }
  return null;
}
