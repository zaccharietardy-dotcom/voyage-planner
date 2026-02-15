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
];

const MONUMENT_KEYWORDS = [
  'museum', 'musée', 'musee', 'cathedral', 'cathédrale', 'cathedrale',
  'basilica', 'basilique', 'palace', 'palais', 'castle', 'chateau', 'château',
  'tower', 'tour', 'arc', 'monument', 'abbey', 'temple',
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

