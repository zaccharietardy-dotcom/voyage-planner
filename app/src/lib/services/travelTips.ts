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

Si la destination est dans un pays francophone, mets quand même le vocabulaire avec les expressions locales/argot utiles.`;

  try {
    const response = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn('[TravelTips] No JSON found in response');
      return null;
    }

    const result = JSON.parse(jsonMatch[0]) as TravelTipsResult;
    console.log(`[TravelTips] Generated for ${destination}: ${result.vocabulary.phrases.length} phrases, ${result.packing.essentials.length} items`);
    return result;
  } catch (error) {
    console.error('[TravelTips] Error:', error);
    return null;
  }
}
