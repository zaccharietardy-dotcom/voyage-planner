export interface Destination {
  slug: string;
  name: string;
  country: string;
  emoji: string;
  image: string;
  description: string;
  highlights: string[];
  idealDuration: string;
  bestSeason: string;
}

export const DESTINATIONS: Destination[] = [
  {
    slug: 'paris',
    name: 'Paris',
    country: 'France',
    emoji: '🗼',
    image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1200&q=80',
    description: 'La Ville Lumière offre une combinaison unique de culture, gastronomie et romantisme. Des musées de renommée mondiale aux bistrots de quartier, chaque arrondissement raconte une histoire différente.',
    highlights: ['Tour Eiffel', 'Louvre', 'Montmartre', 'Notre-Dame', 'Marais'],
    idealDuration: '3-5 jours',
    bestSeason: 'Avril-Juin, Septembre-Octobre',
  },
  {
    slug: 'rome',
    name: 'Rome',
    country: 'Italie',
    emoji: '🏛️',
    image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200&q=80',
    description: 'La Ville Éternelle mêle vestiges antiques, art de la Renaissance et dolce vita italienne. Chaque rue révèle des siècles d\'histoire entre les trattorias et les piazzas animées.',
    highlights: ['Colisée', 'Vatican', 'Fontaine de Trevi', 'Panthéon', 'Trastevere'],
    idealDuration: '3-5 jours',
    bestSeason: 'Mars-Mai, Septembre-Novembre',
  },
  {
    slug: 'barcelone',
    name: 'Barcelone',
    country: 'Espagne',
    emoji: '🏖️',
    image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=1200&q=80',
    description: 'Entre plages méditerranéennes et architecture de Gaudí, Barcelone combine vie nocturne, cuisine catalane et art contemporain dans un cadre ensoleillé toute l\'année.',
    highlights: ['Sagrada Familia', 'Park Güell', 'La Rambla', 'Barrio Gótico', 'Barceloneta'],
    idealDuration: '4-6 jours',
    bestSeason: 'Mai-Juin, Septembre-Octobre',
  },
  {
    slug: 'tokyo',
    name: 'Tokyo',
    country: 'Japon',
    emoji: '🏯',
    image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200&q=80',
    description: 'Mégalopole futuriste et traditionnelle à la fois, Tokyo fascine par ses temples zen, sa street food exceptionnelle, ses quartiers geek et ses jardins impériaux.',
    highlights: ['Shibuya', 'Senso-ji', 'Shinjuku', 'Akihabara', 'Meiji Jingu'],
    idealDuration: '5-7 jours',
    bestSeason: 'Mars-Mai (cerisiers), Octobre-Novembre',
  },
  {
    slug: 'lisbonne',
    name: 'Lisbonne',
    country: 'Portugal',
    emoji: '🌞',
    image: 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=1200&q=80',
    description: 'Perchée sur sept collines face à l\'Atlantique, Lisbonne séduit par ses azulejos, ses pastéis de nata, sa scène musicale fado et ses quartiers colorés accessibles à tous les budgets.',
    highlights: ['Belém', 'Alfama', 'LX Factory', 'Praça do Comércio', 'Sintra'],
    idealDuration: '3-5 jours',
    bestSeason: 'Avril-Juin, Septembre-Octobre',
  },
  {
    slug: 'amsterdam',
    name: 'Amsterdam',
    country: 'Pays-Bas',
    emoji: '🚲',
    image: 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=1200&q=80',
    description: 'Ville de canaux et de musées, Amsterdam combine culture, tolérance et convivialité. À vélo entre les maisons à pignons, découvrez Rembrandt, Van Gogh et la scène culinaire émergente.',
    highlights: ['Rijksmuseum', 'Anne Frank', 'Vondelpark', 'Jordaan', 'Quartier Rouge'],
    idealDuration: '3-4 jours',
    bestSeason: 'Avril-Mai (tulipes), Juin-Septembre',
  },
  {
    slug: 'marrakech',
    name: 'Marrakech',
    country: 'Maroc',
    emoji: '🕌',
    image: 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=1200&q=80',
    description: 'Entre souks parfumés, riads secrets et jardins luxuriants, Marrakech est une explosion sensorielle. La place Jemaa el-Fna s\'anime chaque soir d\'une énergie unique au monde.',
    highlights: ['Jemaa el-Fna', 'Jardin Majorelle', 'Médina', 'Palais Bahia', 'Souks'],
    idealDuration: '3-5 jours',
    bestSeason: 'Mars-Mai, Octobre-Novembre',
  },
  {
    slug: 'londres',
    name: 'Londres',
    country: 'Royaume-Uni',
    emoji: '🎡',
    image: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&q=80',
    description: 'Cosmopolite et royale, Londres offre des musées gratuits, une scène théâtrale inégalée, des pubs historiques et une diversité culinaire qui rivalise avec n\'importe quelle capitale.',
    highlights: ['British Museum', 'Tower Bridge', 'Camden Market', 'Westminster', 'Soho'],
    idealDuration: '4-6 jours',
    bestSeason: 'Mai-Septembre',
  },
  {
    slug: 'new-york',
    name: 'New York',
    country: 'États-Unis',
    emoji: '🗽',
    image: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200&q=80',
    description: 'La ville qui ne dort jamais : Broadway, Central Park, pizza à chaque coin de rue, et une énergie qui vous porte du lever au coucher. Chaque quartier est un monde à part.',
    highlights: ['Central Park', 'Times Square', 'Brooklyn Bridge', 'MoMA', 'Statue de la Liberté'],
    idealDuration: '5-7 jours',
    bestSeason: 'Avril-Juin, Septembre-Novembre',
  },
  {
    slug: 'istanbul',
    name: 'Istanbul',
    country: 'Turquie',
    emoji: '🕍',
    image: 'https://images.unsplash.com/photo-1524231757912-21f4fe3a7200?w=1200&q=80',
    description: 'À cheval entre Europe et Asie, Istanbul fascine par ses mosquées, son Grand Bazar, ses terrasses sur le Bosphore et sa cuisine qui fusionne Orient et Occident.',
    highlights: ['Sainte-Sophie', 'Grand Bazar', 'Mosquée Bleue', 'Bosphore', 'Galata'],
    idealDuration: '4-5 jours',
    bestSeason: 'Avril-Juin, Septembre-Novembre',
  },
];

export function getDestination(slug: string): Destination | undefined {
  return DESTINATIONS.find(d => d.slug === slug);
}
