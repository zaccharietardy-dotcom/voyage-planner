/**
 * Génère les infos pratiques de voyage (vocabulaire, bagages, légal, urgences)
 * via Claude API
 */

import Anthropic from '@anthropic-ai/sdk';

interface TravelTipsResult {
  vocabulary: {
    language: string;
    phrases: { original: string; translation: string; phonetic?: string; context: string }[];
  };
  packing: {
    essentials: { item: string; reason: string }[];
    plugType?: string;
    voltage?: string;
  };
  legal: {
    visaInfo: { originCountry: string; requirement: string }[];
    importantLaws: string[];
    disclaimer: string;
  };
  emergency: {
    police: string;
    ambulance: string;
    fire: string;
    generalEmergency: string;
    embassy?: string;
    otherNumbers?: { label: string; number: string }[];
  };
}

function cleanJsonPayload(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

function extractJsonCandidate(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const object = text.match(/\{[\s\S]*\}/);
  if (object?.[0]) return object[0].trim();
  return null;
}

export async function generateTravelTips(
  origin: string,
  destination: string,
  startDate: Date,
  durationDays: number,
): Promise<TravelTipsResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[TravelTips] No ANTHROPIC_API_KEY, skipping');
    return null;
  }

  const client = new Anthropic({ apiKey });

  const month = startDate.toLocaleString('fr-FR', { month: 'long' });

  const prompt = `Tu es un expert en voyages. Génère des informations pratiques pour un voyage de "${origin}" vers "${destination}" en ${month} (${durationDays} jours).

Réponds UNIQUEMENT en JSON valide avec cette structure exacte :
{
  "vocabulary": {
    "language": "nom de la langue locale du pays de destination",
    "phrases": [
      { "original": "phrase en français", "translation": "traduction dans la langue locale", "phonetic": "prononciation approximative", "context": "situation d'usage" }
    ]
  },
  "packing": {
    "essentials": [
      { "item": "nom de l'objet", "reason": "pourquoi c'est nécessaire" }
    ],
    "plugType": "type de prise électrique (ex: C/E, G, A/B...)",
    "voltage": "voltage du pays (ex: 230V 50Hz)"
  },
  "legal": {
    "visaInfo": [
      { "originCountry": "France", "requirement": "résumé des conditions de visa/entrée" }
    ],
    "importantLaws": ["loi locale importante à connaître pour les touristes"],
    "disclaimer": "Les informations légales sont fournies à titre indicatif. Vérifiez toujours auprès des autorités officielles avant votre départ."
  },
  "emergency": {
    "police": "numéro",
    "ambulance": "numéro",
    "fire": "numéro",
    "generalEmergency": "numéro d'urgence général",
    "otherNumbers": [{ "label": "description", "number": "numéro" }]
  }
}

Pour le vocabulaire : inclure 12-15 phrases essentielles (salutations, commander au restaurant, demander de l'aide, directions, chiffres, politesse, urgences).
Pour les objets : 6-10 objets spécifiques à cette destination et saison (adaptateur prise, anti-moustiques, vêtements chauds, crème solaire, etc.).
Pour le légal : infos visa depuis ${origin}, 3-5 lois locales importantes.
Pour les urgences : numéros réels du pays de destination.

Si l'origine ET la destination sont dans le même pays (ex: France→France), génère des conseils pratiques locaux (spécialités culinaires régionales à goûter, expressions régionales polies, usages et coutumes locales) au lieu de vocabulaire de langue. Ne mets JAMAIS d'argot vulgaire ou familier (pas de "chiottes", "j'pige pas", etc.).
Si la destination est dans un pays francophone ÉTRANGER (ex: France→Belgique, France→Suisse), mets les expressions locales polies et différences de vocabulaire utiles.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .filter((value) => value.length > 0)
      .join('\n')
      .trim();
    const jsonCandidate = extractJsonCandidate(text);
    if (!jsonCandidate) {
      console.warn('[TravelTips] No JSON found in response');
      return null;
    }

    const candidates = [jsonCandidate, cleanJsonPayload(jsonCandidate)];
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as TravelTipsResult;
      } catch {
        // try next candidate
      }
    }

    console.warn('[TravelTips] Invalid JSON response, skipping tips');
    return null;
  } catch (error) {
    console.error('[TravelTips] Error:', error instanceof Error ? error.message : String(error));
    return null;
  }
}
