export interface GenerationTip {
  category: 'visa' | 'vocabulary' | 'anecdote' | 'packing' | 'food' | 'culture' | 'weather' | 'transport';
  icon: string;
  title: string;
  text: string;
  destinations?: string[];
  season?: 'summer' | 'winter' | 'spring' | 'autumn';
  countries?: string[];
}

function getSeason(dateStr: string): 'summer' | 'winter' | 'spring' | 'autumn' {
  const month = new Date(dateStr).getMonth();
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

export function getFilteredTips(destination: string, startDate: string): GenerationTip[] {
  const season = getSeason(startDate);
  const destLower = destination.toLowerCase();

  const matched = GENERATION_TIPS.filter(tip => {
    // Season filter
    if (tip.season && tip.season !== season) return false;
    // Destination filter: if specified, must match
    if (tip.destinations && tip.destinations.length > 0) {
      return tip.destinations.some(d => destLower.includes(d.toLowerCase()));
    }
    // Country filter
    if (tip.countries && tip.countries.length > 0) {
      return tip.countries.some(c => destLower.includes(c.toLowerCase()));
    }
    return true; // universal tip
  });

  // Shuffle
  for (let i = matched.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matched[i], matched[j]] = [matched[j], matched[i]];
  }

  return matched;
}

export const PROGRESS_STEPS = [
  { delay: 0, text: 'Recherche des meilleures options de transport...', icon: '🔍' },
  { delay: 5000, text: 'Sélection des hébergements adaptés à votre budget...', icon: '🏨' },
  { delay: 15000, text: 'Curation des activités et attractions...', icon: '🎯' },
  { delay: 25000, text: 'Optimisation de l\'itinéraire jour par jour...', icon: '🗺️' },
  { delay: 40000, text: 'Recherche des meilleurs restaurants à proximité...', icon: '🍽️' },
  { delay: 60000, text: 'Dernières vérifications et finalisation...', icon: '✨' },
  { delay: 80000, text: 'Encore quelques instants...', icon: '⏳' },
];

const GENERATION_TIPS: GenerationTip[] = [
  // ===== PARIS =====
  {
    category: 'transport',
    icon: '🚇',
    title: 'Bon plan transport',
    text: 'À Paris, le pass Navigo Découverte (semaine) est bien plus économique que les tickets à l\'unité si vous restez plus de 3 jours.',
    destinations: ['paris'],
  },
  {
    category: 'food',
    icon: '🥐',
    title: 'Le saviez-vous ?',
    text: 'Le croissant n\'est pas français ! Il vient de Vienne en Autriche, inspiré du "Kipferl". Marie-Antoinette l\'aurait introduit en France.',
    destinations: ['paris'],
  },
  {
    category: 'culture',
    icon: '🎨',
    title: 'Astuce culture',
    text: 'Les musées nationaux de Paris (Louvre, Orsay...) sont gratuits le premier dimanche du mois, de novembre à mars.',
    destinations: ['paris'],
    season: 'winter',
  },
  {
    category: 'anecdote',
    icon: '🗼',
    title: 'Le saviez-vous ?',
    text: 'La Tour Eiffel devait être démontée après 20 ans. Elle a été sauvée car elle servait d\'antenne radio !',
    destinations: ['paris'],
  },
  {
    category: 'food',
    icon: '🧀',
    title: 'Gastronomie',
    text: 'La France produit plus de 1 200 variétés de fromages. Essayez d\'en goûter un nouveau chaque jour de votre séjour !',
    destinations: ['paris'],
  },

  // ===== BARCELONE =====
  {
    category: 'food',
    icon: '🍽️',
    title: 'Conseil local',
    text: 'À Barcelone, ne dînez pas avant 21h — les restaurants sont vides avant ça et l\'ambiance n\'est pas la même !',
    destinations: ['barcelona', 'barcelone'],
  },
  {
    category: 'anecdote',
    icon: '⛪',
    title: 'Le saviez-vous ?',
    text: 'La Sagrada Família est en construction depuis 1882 — plus de 140 ans ! Elle devrait être achevée en 2026.',
    destinations: ['barcelona', 'barcelone'],
  },
  {
    category: 'transport',
    icon: '🚌',
    title: 'Bon plan',
    text: 'La T-Casual (10 trajets) est le pass transport le plus rentable à Barcelone. Valable dans le métro, bus et tram.',
    destinations: ['barcelona', 'barcelone'],
  },
  {
    category: 'culture',
    icon: '🏖️',
    title: 'Conseil',
    text: 'La Barceloneta est la plage la plus touristique. Préférez Bogatell ou Nova Icària pour plus de tranquillité.',
    destinations: ['barcelona', 'barcelone'],
  },

  // ===== ROME =====
  {
    category: 'anecdote',
    icon: '⛲',
    title: 'Tradition',
    text: 'On jette environ 3 000 € par jour dans la Fontaine de Trevi ! L\'argent est reversé à des associations caritatives.',
    destinations: ['rome', 'roma'],
  },
  {
    category: 'food',
    icon: '🍝',
    title: 'Gastronomie',
    text: 'À Rome, ne commandez jamais un cappuccino après 11h du matin — les Italiens considèrent que le lait est réservé au petit-déjeuner !',
    destinations: ['rome', 'roma'],
  },
  {
    category: 'transport',
    icon: '🚶',
    title: 'Conseil',
    text: 'Le centre historique de Rome se visite facilement à pied. Les principales attractions sont à 20-30 minutes les unes des autres.',
    destinations: ['rome', 'roma'],
  },
  {
    category: 'culture',
    icon: '🏛️',
    title: 'Astuce',
    text: 'Réservez vos billets pour le Vatican et le Colisée en ligne à l\'avance — les files d\'attente peuvent dépasser 2h !',
    destinations: ['rome', 'roma'],
  },

  // ===== LONDRES =====
  {
    category: 'transport',
    icon: '🚇',
    title: 'Bon plan',
    text: 'À Londres, utilisez simplement votre carte bancaire sans contact dans le métro — c\'est automatiquement plafonné au prix d\'un day pass.',
    destinations: ['london', 'londres'],
  },
  {
    category: 'anecdote',
    icon: '👑',
    title: 'Le saviez-vous ?',
    text: 'Les corbeaux de la Tour de Londres sont protégés par décret royal. La légende dit que si les corbeaux partent, le royaume s\'effondrera.',
    destinations: ['london', 'londres'],
  },
  {
    category: 'culture',
    icon: '🏛️',
    title: 'Bon plan',
    text: 'La plupart des grands musées de Londres sont gratuits : British Museum, National Gallery, Tate Modern, V&A...',
    destinations: ['london', 'londres'],
  },
  {
    category: 'packing',
    icon: '☂️',
    title: 'Bagage',
    text: 'À Londres, emportez toujours un parapluie pliant — la pluie peut arriver à n\'importe quel moment, même en été !',
    destinations: ['london', 'londres'],
  },

  // ===== TOKYO =====
  {
    category: 'vocabulary',
    icon: '🗣️',
    title: 'Le saviez-vous ?',
    text: 'Au Japon, on dit "Itadakimasu" avant de manger — ça signifie littéralement "je reçois humblement". C\'est considéré comme impoli de ne pas le dire.',
    destinations: ['tokyo'],
  },
  {
    category: 'culture',
    icon: '🚃',
    title: 'Savoir-vivre',
    text: 'Dans le métro de Tokyo, il est mal vu de parler au téléphone ou de faire du bruit. Le silence est la norme !',
    destinations: ['tokyo'],
  },
  {
    category: 'transport',
    icon: '🚅',
    title: 'Bon plan',
    text: 'Le Japan Rail Pass est très rentable si vous visitez plusieurs villes. Achetez-le avant de partir, c\'est moins cher !',
    destinations: ['tokyo', 'kyoto', 'osaka'],
  },
  {
    category: 'food',
    icon: '🍱',
    title: 'Gastronomie',
    text: 'Les konbini (7-Eleven, Lawson, FamilyMart) au Japon sont incroyables — onigiri, bento, desserts de qualité pour 3-5€ !',
    destinations: ['tokyo', 'kyoto', 'osaka'],
  },

  // ===== MARRAKECH =====
  {
    category: 'weather',
    icon: '🌡️',
    title: 'Météo',
    text: 'À Marrakech en été, les températures dépassent souvent 40°C. Pensez à la crème solaire, un chapeau et à vous hydrater régulièrement !',
    destinations: ['marrakech'],
    season: 'summer',
  },
  {
    category: 'food',
    icon: '🫖',
    title: 'Tradition',
    text: 'Le thé à la menthe au Maroc est un symbole d\'hospitalité. Refuser un verre est considéré comme impoli — acceptez toujours avec le sourire !',
    destinations: ['marrakech', 'fes', 'fez', 'casablanca'],
  },
  {
    category: 'culture',
    icon: '🛍️',
    title: 'Conseil',
    text: 'Dans les souks de Marrakech, marchandez toujours ! Le premier prix demandé est souvent 3 à 5 fois le prix réel.',
    destinations: ['marrakech'],
  },
  {
    category: 'vocabulary',
    icon: '🗣️',
    title: 'Vocabulaire',
    text: '"Shukran" signifie merci en arabe marocain. Un petit mot en langue locale fait toujours plaisir aux commerçants !',
    destinations: ['marrakech', 'fes', 'fez', 'casablanca'],
  },

  // ===== AMSTERDAM =====
  {
    category: 'transport',
    icon: '🚲',
    title: 'Conseil',
    text: 'Amsterdam est la ville du vélo ! Louez-en un dès le premier jour — c\'est le moyen le plus rapide et agréable pour se déplacer.',
    destinations: ['amsterdam'],
  },
  {
    category: 'anecdote',
    icon: '🏠',
    title: 'Le saviez-vous ?',
    text: 'Les maisons étroites d\'Amsterdam ont des crochets au sommet pour hisser les meubles — les escaliers sont trop étroits !',
    destinations: ['amsterdam'],
  },

  // ===== LISBONNE =====
  {
    category: 'food',
    icon: '🥚',
    title: 'Gastronomie',
    text: 'Les pastéis de nata de Belém sont les meilleurs de Lisbonne. La recette originale de 1837 est toujours secrète !',
    destinations: ['lisbon', 'lisbonne', 'lisboa'],
  },
  {
    category: 'transport',
    icon: '🚋',
    title: 'Conseil',
    text: 'Le tram 28 de Lisbonne est iconique mais bondé. Prenez-le tôt le matin ou optez pour le bus 737 qui suit le même parcours.',
    destinations: ['lisbon', 'lisbonne', 'lisboa'],
  },

  // ===== ISTANBUL =====
  {
    category: 'culture',
    icon: '🕌',
    title: 'Savoir-vivre',
    text: 'Pour visiter les mosquées à Istanbul, couvrez vos épaules et genoux. Des foulards sont souvent prêtés gratuitement à l\'entrée.',
    destinations: ['istanbul'],
  },
  {
    category: 'food',
    icon: '🍢',
    title: 'Gastronomie',
    text: 'Le petit-déjeuner turc traditionnel est un festin : fromages, olives, miel, tomates, concombres, oeufs, pain frais. Un incontournable !',
    destinations: ['istanbul'],
  },

  // ===== PRAGUE =====
  {
    category: 'anecdote',
    icon: '⏰',
    title: 'Le saviez-vous ?',
    text: 'L\'horloge astronomique de Prague fonctionne depuis 1410 — c\'est la plus ancienne horloge astronomique encore en service au monde !',
    destinations: ['prague', 'praha'],
  },
  {
    category: 'food',
    icon: '🍺',
    title: 'Le saviez-vous ?',
    text: 'Les Tchèques sont les plus grands consommateurs de bière au monde — et elle coûte souvent moins cher que l\'eau au restaurant !',
    destinations: ['prague', 'praha'],
  },

  // ===== NEW YORK =====
  {
    category: 'transport',
    icon: '🚕',
    title: 'Bon plan',
    text: 'À New York, le métro fonctionne 24h/24. Prenez une MetroCard illimitée 7 jours — rentable dès 12 trajets !',
    destinations: ['new york', 'nyc'],
  },
  {
    category: 'food',
    icon: '🍕',
    title: 'Conseil local',
    text: 'La "dollar slice" new-yorkaise : des pizzerias vendent des parts géantes pour 1-2$. Un classique pour manger sur le pouce !',
    destinations: ['new york', 'nyc'],
  },
  {
    category: 'culture',
    icon: '🗽',
    title: 'Astuce',
    text: 'Le ferry de Staten Island est gratuit et offre une vue magnifique sur la Statue de la Liberté et Manhattan.',
    destinations: ['new york', 'nyc'],
  },

  // ===== BERLIN =====
  {
    category: 'anecdote',
    icon: '🧱',
    title: 'Le saviez-vous ?',
    text: 'Une double rangée de pavés dans les rues de Berlin marque l\'ancien tracé du Mur. Regardez par terre en vous promenant !',
    destinations: ['berlin'],
  },

  // ===== BUDAPEST =====
  {
    category: 'culture',
    icon: '♨️',
    title: 'Incontournable',
    text: 'Budapest compte plus de 120 sources thermales. Les bains Széchenyi sont les plus grands bains thermaux d\'Europe !',
    destinations: ['budapest'],
  },

  // ===== TIPS UNIVERSELS =====
  {
    category: 'packing',
    icon: '🧳',
    title: 'Astuce bagage',
    text: 'Roulez vos vêtements au lieu de les plier — ça prend 30% moins de place dans la valise et évite les plis !',
  },
  {
    category: 'packing',
    icon: '🔌',
    title: 'Rappel',
    text: 'Vérifiez toujours le type de prise électrique de votre destination. Un adaptateur universel est le meilleur investissement voyage !',
  },
  {
    category: 'packing',
    icon: '📱',
    title: 'Conseil',
    text: 'Téléchargez les cartes Google Maps en mode hors-ligne avant de partir. Indispensable quand le réseau est faible !',
  },
  {
    category: 'visa',
    icon: '🛂',
    title: 'Visa',
    text: 'Les citoyens français peuvent voyager dans 190 pays sans visa ou avec un visa à l\'arrivée — le 4e passeport le plus puissant au monde !',
  },
  {
    category: 'visa',
    icon: '📋',
    title: 'Rappel',
    text: 'Vérifiez que votre passeport est valide au moins 6 mois après la date de retour — c\'est obligatoire pour de nombreux pays.',
  },
  {
    category: 'transport',
    icon: '✈️',
    title: 'Astuce vol',
    text: 'Les mardis et mercredis sont généralement les jours les moins chers pour prendre l\'avion. Évitez les vendredis et dimanches !',
  },
  {
    category: 'food',
    icon: '💧',
    title: 'Conseil santé',
    text: 'En voyage, buvez au moins 2 litres d\'eau par jour. En cas de doute sur l\'eau du robinet, optez pour des bouteilles scellées.',
  },
  {
    category: 'culture',
    icon: '📸',
    title: 'Savoir-vivre',
    text: 'Demandez toujours la permission avant de photographier quelqu\'un, surtout dans les marchés et lieux de culte.',
  },
  {
    category: 'packing',
    icon: '💊',
    title: 'Santé',
    text: 'Emportez toujours une petite trousse de pharmacie : paracétamol, pansements, anti-diarrhéique et désinfectant.',
  },
  {
    category: 'transport',
    icon: '🗺️',
    title: 'Astuce',
    text: 'Notez l\'adresse de votre hébergement dans la langue locale sur votre téléphone — utile si un taxi ne parle pas anglais !',
  },
  {
    category: 'anecdote',
    icon: '🌍',
    title: 'Le saviez-vous ?',
    text: 'Le tourisme représente 10% du PIB mondial et emploie 1 personne sur 10 sur la planète. Votre voyage fait tourner l\'économie locale !',
  },
  {
    category: 'packing',
    icon: '👟',
    title: 'Conseil',
    text: 'Emportez des chaussures déjà rodées ! Rien de pire que des ampoules le premier jour de vacances.',
  },
  {
    category: 'food',
    icon: '🍽️',
    title: 'Astuce budget',
    text: 'Pour manger local à petit prix, éloignez-vous des zones touristiques. Les restaurants fréquentés par les locaux sont souvent meilleurs et moins chers.',
  },
  {
    category: 'culture',
    icon: '🕐',
    title: 'Conseil',
    text: 'Visitez les attractions les plus populaires tôt le matin ou en fin de journée pour éviter les foules et profiter d\'une meilleure lumière photo.',
  },
  {
    category: 'packing',
    icon: '🎒',
    title: 'Astuce',
    text: 'Gardez toujours une copie de votre passeport et vos documents importants dans votre boîte mail — accessible de partout en cas de perte.',
  },
  {
    category: 'weather',
    icon: '🌧️',
    title: 'Conseil',
    text: 'Consultez la météo 3-5 jours avant le départ pour adapter votre valise, mais gardez toujours un vêtement de pluie léger !',
  },
  {
    category: 'transport',
    icon: '💰',
    title: 'Astuce',
    text: 'Dans de nombreux pays, les cartes bancaires prélèvent des frais à l\'étranger. Renseignez-vous sur les banques en ligne sans frais (Revolut, N26...).',
  },

  // ===== TIPS SAISONNIERS =====
  {
    category: 'weather',
    icon: '☀️',
    title: 'Été',
    text: 'En été, pensez à la crème solaire (indice 50), un chapeau et des lunettes de soleil. Hydratez-vous régulièrement !',
    season: 'summer',
  },
  {
    category: 'packing',
    icon: '🧤',
    title: 'Hiver',
    text: 'En hiver, superposez les couches : un sous-vêtement thermique, un pull, et un manteau coupe-vent. Plus efficace qu\'un gros manteau seul !',
    season: 'winter',
  },
  {
    category: 'weather',
    icon: '🌸',
    title: 'Printemps',
    text: 'Le printemps est souvent la meilleure saison pour voyager : températures douces, moins de touristes, et nature en fleurs !',
    season: 'spring',
  },
  {
    category: 'weather',
    icon: '🍂',
    title: 'Automne',
    text: 'L\'automne offre des couleurs magnifiques et des prix plus bas. Prévoyez des couches car les températures peuvent varier beaucoup dans la journée.',
    season: 'autumn',
  },

  // ===== ESPAGNE =====
  {
    category: 'culture',
    icon: '😴',
    title: 'Conseil',
    text: 'En Espagne, beaucoup de commerces ferment entre 14h et 17h pour la sieste. Planifiez vos achats en conséquence !',
    destinations: ['madrid', 'barcelona', 'barcelone', 'seville', 'séville', 'valencia', 'valence', 'malaga'],
  },

  // ===== ITALIE =====
  {
    category: 'food',
    icon: '☕',
    title: 'Astuce',
    text: 'En Italie, le café au comptoir coûte souvent 2 fois moins cher qu\'en terrasse. Les locaux le boivent debout en 30 secondes !',
    destinations: ['rome', 'roma', 'florence', 'firenze', 'venise', 'venezia', 'milan', 'milano', 'naples', 'napoli'],
  },

  // ===== GRÈCE =====
  {
    category: 'anecdote',
    icon: '🏛️',
    title: 'Le saviez-vous ?',
    text: 'Le Parthénon à Athènes n\'a aucune ligne droite — toutes ses colonnes sont légèrement inclinées vers l\'intérieur pour créer une illusion de perfection !',
    destinations: ['athenes', 'athens', 'athènes', 'santorini', 'santorin', 'mykonos'],
  },

  // ===== CORSE =====
  {
    category: 'food',
    icon: '🧀',
    title: 'Spécialité',
    text: 'En Corse, goûtez le brocciu — un fromage frais de brebis ou chèvre qu\'on retrouve dans de nombreux plats locaux, du salé au sucré !',
    destinations: ['ajaccio', 'bastia', 'porto-vecchio', 'bonifacio', 'calvi', 'corse', 'corsica'],
  },
  {
    category: 'transport',
    icon: '🚗',
    title: 'Conseil',
    text: 'En Corse, une voiture de location est quasi indispensable. Les routes sont sinueuses mais les paysages sont à couper le souffle !',
    destinations: ['ajaccio', 'bastia', 'porto-vecchio', 'bonifacio', 'calvi', 'corse', 'corsica'],
  },
];
