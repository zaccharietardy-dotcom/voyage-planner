'use client';

import { motion } from 'framer-motion';
import { Star, Quote } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const testimonials = [
  {
    name: 'Marie L.',
    avatar: 'https://i.pravatar.cc/100?img=1',
    location: 'Paris',
    rating: 5,
    text: 'J\'ai planifié mon voyage au Japon en 10 minutes ! L\'itinéraire était parfait, avec des restaurants que je n\'aurais jamais trouvés seule.',
    trip: 'Tokyo, 10 jours',
  },
  {
    name: 'Thomas B.',
    avatar: 'https://i.pravatar.cc/100?img=3',
    location: 'Lyon',
    rating: 5,
    text: 'La collaboration avec mes amis était super fluide. On a pu voter sur les activités et tout organiser ensemble sans prise de tête.',
    trip: 'Barcelone, 4 jours',
  },
  {
    name: 'Sophie M.',
    avatar: 'https://i.pravatar.cc/100?img=5',
    location: 'Bordeaux',
    rating: 5,
    text: 'Enfin une app qui comprend mes préférences ! Végétarienne et fan de culture, j\'ai eu des recommandations parfaites.',
    trip: 'Lisbonne, 5 jours',
  },
];

export function Testimonials() {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ce que disent nos voyageurs</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Rejoignez des milliers de voyageurs satisfaits
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card className="h-full border-border/50">
                <CardContent className="p-6">
                  <Quote className="h-8 w-8 text-primary/20 mb-4" />

                  {/* Rating */}
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: testimonial.rating }).map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                    ))}
                  </div>

                  {/* Text */}
                  <p className="text-muted-foreground mb-6">&ldquo;{testimonial.text}&rdquo;</p>

                  {/* Author */}
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={testimonial.avatar} alt={testimonial.name} />
                      <AvatarFallback>{testimonial.name[0]}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{testimonial.name}</p>
                      <p className="text-sm text-muted-foreground">{testimonial.trip}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
