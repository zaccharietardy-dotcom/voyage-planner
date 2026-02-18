type OfficialTicketingEntry = {
  key: string;
  officialUrl: string;
  aliases: string[];
};

export type OfficialTicketingMatch = {
  key: string;
  officialUrl: string;
};

const OFFICIAL_TICKETING_ENTRIES: OfficialTicketingEntry[] = [
  {
    key: 'louvre',
    officialUrl: 'https://www.ticketlouvre.fr/louvre/b2c/index.cfm/home',
    aliases: ['louvre', 'musée du louvre', 'musee du louvre'],
  },
  {
    key: 'eiffel_tower',
    officialUrl: 'https://www.toureiffel.paris/fr/tarifs-horaires',
    aliases: ['tour eiffel', 'eiffel tower'],
  },
  {
    key: 'arc_de_triomphe',
    officialUrl: 'https://www.paris-arc-de-triomphe.fr/visiter/informations-pratiques',
    aliases: ['arc de triomphe'],
  },
  {
    key: 'musee_orsay',
    officialUrl: 'https://billetterie.musee-orsay.fr/fr-FR/produits/selections',
    aliases: ["musee d'orsay", "musée d'orsay", 'orsay museum'],
  },
  {
    key: 'versailles',
    officialUrl: 'https://billetterie.chateauversailles.fr/',
    aliases: ['versailles', 'chateau de versailles', 'château de versailles'],
  },
  {
    key: 'sacre_coeur',
    officialUrl: 'https://www.sacre-coeur-montmartre.com/',
    aliases: ['sacre-coeur', 'sacre coeur', 'sacré-cœur', 'sacré coeur', 'montmartre'],
  },
  {
    key: 'notre_dame',
    officialUrl: 'https://www.notredamedeparis.fr/',
    aliases: ['notre-dame', 'notre dame'],
  },

  // --- Milan ---
  {
    key: 'teatro_scala',
    officialUrl: 'https://www.teatroallascala.org/en/box-office/index.html',
    aliases: ['teatro alla scala', 'la scala', 'scala di milano', 'scala milan'],
  },
  {
    key: 'pinacoteca_brera',
    officialUrl: 'https://pinacotecabrera.org/en/visit/tickets/',
    aliases: ['pinacoteca di brera', 'brera', 'pinacoteca brera'],
  },
  {
    key: 'duomo_milano',
    officialUrl: 'https://www.duomomilano.it/en/buy-tickets/',
    aliases: ['duomo di milano', 'duomo milano', 'cathedral of milan', 'milan cathedral'],
  },
  {
    key: 'castello_sforzesco',
    officialUrl: 'https://www.milanocastello.it/en/content/tickets',
    aliases: ['castello sforzesco', 'chateau des sforza', 'sforza castle', 'castello milano'],
  },
  {
    key: 'cenacolo_vinciano',
    officialUrl: 'https://www.cenacolovinciano.org/en/visit/tickets',
    aliases: ['cenacolo vinciano', 'last supper', 'ultima cena', 'cene de vinci'],
  },
  {
    key: 'pinacoteca_ambrosiana',
    officialUrl: 'https://www.ambrosiana.it/en/tickets/',
    aliases: ['pinacoteca ambrosiana', 'ambrosiana', 'biblioteca ambrosiana'],
  },

  // --- Rome ---
  {
    key: 'colosseum',
    officialUrl: 'https://www.coopculture.it/en/colosseo-e-shop.cfm',
    aliases: ['colosseum', 'colosseo', 'colisee', 'colisée'],
  },
  {
    key: 'vatican_museums',
    officialUrl: 'https://tickets.museivaticani.va/home',
    aliases: ['vatican museum', 'musee du vatican', 'musees du vatican', 'musei vaticani', 'sistine chapel', 'chapelle sixtine'],
  },
  {
    key: 'galleria_borghese',
    officialUrl: 'https://galleriaborghese.beniculturali.it/en/visits/',
    aliases: ['galleria borghese', 'borghese gallery', 'galerie borghese', 'villa borghese museum'],
  },
  {
    key: 'pantheon_rome',
    officialUrl: 'https://www.pantheonroma.com/en/tickets',
    aliases: ['pantheon', 'panthéon rome'],
  },

  // --- Barcelona ---
  {
    key: 'sagrada_familia',
    officialUrl: 'https://sagradafamilia.org/en/tickets',
    aliases: ['sagrada familia', 'sagrada família'],
  },
  {
    key: 'park_guell',
    officialUrl: 'https://parkguell.barcelona/en/buy-tickets',
    aliases: ['park guell', 'parc guell', 'park güell', 'parc güell'],
  },
  {
    key: 'casa_batllo',
    officialUrl: 'https://www.casabatllo.es/en/buy-tickets/',
    aliases: ['casa batllo', 'casa batlló'],
  },
  {
    key: 'casa_mila',
    officialUrl: 'https://www.lapedrera.com/en/buy-tickets',
    aliases: ['casa mila', 'casa milà', 'la pedrera'],
  },

  // --- Amsterdam ---
  {
    key: 'rijksmuseum',
    officialUrl: 'https://www.rijksmuseum.nl/en/tickets',
    aliases: ['rijksmuseum'],
  },
  {
    key: 'van_gogh_museum',
    officialUrl: 'https://www.vangoghmuseum.nl/en/tickets',
    aliases: ['van gogh museum', 'musee van gogh', 'musée van gogh'],
  },
  {
    key: 'anne_frank',
    officialUrl: 'https://www.annefrank.org/en/tickets/',
    aliases: ['anne frank', 'maison anne frank', 'anne frank house', 'anne frank huis'],
  },
];

const MONUMENT_KEYWORDS = [
  'museum', 'musée', 'musee', 'cathedral', 'cathédrale', 'cathedrale',
  'basilica', 'basilique', 'palace', 'palais', 'castle', 'chateau', 'château',
  'tower', 'tour', 'arc', 'monument', 'abbey', 'temple',
  'opera', 'teatro', 'theatre', 'pinacoteca', 'galleria',
];

function normalize(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsAlias(text: string, alias: string): boolean {
  if (!text || !alias) return false;
  return text.includes(alias);
}

export function isMonumentLikeActivityName(name?: string): boolean {
  const normalized = normalize(name);
  if (!normalized) return false;
  return MONUMENT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function resolveOfficialTicketing(activity: {
  name?: string;
  title?: string;
  description?: string;
  bookingUrl?: string;
}): OfficialTicketingMatch | null {
  const nameText = normalize(activity.name || activity.title);
  const descText = normalize(activity.description);
  const merged = `${nameText} ${descText}`.trim();

  for (const entry of OFFICIAL_TICKETING_ENTRIES) {
    for (const aliasRaw of entry.aliases) {
      const alias = normalize(aliasRaw);
      if (!alias) continue;
      if (containsAlias(merged, alias)) {
        return { key: entry.key, officialUrl: entry.officialUrl };
      }
    }
  }

  return null;
}

