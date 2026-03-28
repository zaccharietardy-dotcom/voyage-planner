import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import Link from 'next/link';
import { DESTINATIONS, getDestination } from '@/lib/destinations';
import { SITE_NAME, SITE_URL } from '@/lib/seo';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { MapPin, Calendar, Sun, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

export async function generateStaticParams() {
  return DESTINATIONS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const dest = getDestination(slug);
  if (!dest) return { title: 'Destination introuvable' };

  const title = `Voyage à ${dest.name} — Itinéraire sur-mesure | ${SITE_NAME}`;
  const description = `Planifiez votre voyage à ${dest.name} (${dest.country}) en 2 minutes. ${dest.idealDuration} recommandés. Activités, restaurants et hôtels sélectionnés par notre algorithme.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/destination/${slug}`,
      images: [`${SITE_URL}/api/og?destination=${encodeURIComponent(dest.name)}`],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
    alternates: { canonical: `${SITE_URL}/destination/${slug}` },
  };
}

export default async function DestinationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const dest = getDestination(slug);
  if (!dest) notFound();

  // Fetch public trips for this destination
  const supabase = await createServerSupabaseClient();
  const { data: trips } = await supabase
    .from('trips')
    .select('id, title, destination, duration_days, start_date')
    .eq('visibility', 'public')
    .ilike('destination', `%${dest.name}%`)
    .order('created_at', { ascending: false })
    .limit(6);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative h-[50vh] min-h-[400px] overflow-hidden">
        <img
          src={dest.image}
          alt={dest.name}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-16">
          <div className="container max-w-5xl mx-auto">
            <span className="text-5xl mb-4 block">{dest.emoji}</span>
            <h1 className="text-5xl md:text-7xl font-display font-bold text-white mb-2">
              {dest.name}
            </h1>
            <p className="text-xl text-white/70">{dest.country}</p>
          </div>
        </div>
      </div>

      <div className="container max-w-5xl mx-auto px-4 py-16">
        {/* Quick facts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
          {[
            { icon: <Calendar className="h-5 w-5" />, label: 'Durée idéale', value: dest.idealDuration },
            { icon: <Sun className="h-5 w-5" />, label: 'Meilleure saison', value: dest.bestSeason },
            { icon: <MapPin className="h-5 w-5" />, label: 'Incontournables', value: dest.highlights.slice(0, 3).join(', ') },
          ].map((fact, i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-center gap-2 text-gold mb-2">
                {fact.icon}
                <span className="text-xs font-bold uppercase tracking-widest">{fact.label}</span>
              </div>
              <p className="text-sm font-medium">{fact.value}</p>
            </div>
          ))}
        </div>

        {/* Description */}
        <div className="mb-16">
          <h2 className="text-2xl font-display font-bold mb-4">
            Pourquoi visiter {dest.name} ?
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">{dest.description}</p>
        </div>

        {/* Highlights */}
        <div className="mb-16">
          <h2 className="text-2xl font-display font-bold mb-6">
            Les incontournables
          </h2>
          <div className="flex flex-wrap gap-3">
            {dest.highlights.map((h) => (
              <span
                key={h}
                className="px-4 py-2 rounded-full border border-gold/20 bg-gold/5 text-sm font-medium text-gold"
              >
                {h}
              </span>
            ))}
          </div>
        </div>

        {/* Public trips */}
        {trips && trips.length > 0 && (
          <div className="mb-16">
            <h2 className="text-2xl font-display font-bold mb-6">
              Itinéraires à {dest.name} par la communauté
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {trips.map((trip) => (
                <Link
                  key={trip.id}
                  href={`/trip/${trip.id}`}
                  className="group rounded-2xl border border-white/10 bg-white/[0.02] p-5 hover:border-gold/30 transition-all"
                >
                  <p className="font-bold group-hover:text-gold transition-colors">
                    {trip.title || trip.destination}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {trip.duration_days} jours
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="text-center py-16 rounded-[2.5rem] border border-gold/20 bg-gold/5">
          <Sparkles className="h-8 w-8 text-gold mx-auto mb-4" />
          <h2 className="text-3xl font-display font-bold mb-3">
            Planifiez votre voyage à {dest.name}
          </h2>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
            Notre algorithme génère un itinéraire personnalisé de {dest.idealDuration} en 2 minutes.
          </p>
          <Button
            size="lg"
            className="h-16 px-12 rounded-2xl bg-gold-gradient text-[#020617] text-lg font-bold shadow-xl shadow-gold/20"
            asChild
          >
            <Link href={`/plan?destination=${encodeURIComponent(dest.name)}`}>
              Planifier mon voyage
              <ArrowRight className="h-5 w-5 ml-2" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
