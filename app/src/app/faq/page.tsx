'use client';

import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { faqCategories } from './faqData';

export default function FAQPage() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCategories = faqCategories
    .map((category) => ({
      ...category,
      questions: category.questions.filter(
        (q) =>
          q.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          q.answer.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((category) => category.questions.length > 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto px-4 py-12">
        <Button variant="ghost" asChild className="mb-8">
          <Link href="/">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Retour
          </Link>
        </Button>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Foire Aux Questions</h1>
          <p className="text-xl text-muted-foreground mb-8">
            Trouvez rapidement des réponses à vos questions
          </p>

          <div className="relative max-w-md mx-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher une question..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              Aucune question ne correspond à votre recherche.
            </p>
            <Button variant="outline" onClick={() => setSearchQuery('')}>
              Effacer la recherche
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {filteredCategories.map((category) => (
              <div key={category.category}>
                <h2 className="text-xl font-semibold mb-4 text-primary">
                  {category.category}
                </h2>
                <Accordion type="single" collapsible className="space-y-2">
                  {category.questions.map((item, index) => (
                    <AccordionItem
                      key={index}
                      value={`${category.category}-${index}`}
                      className="border rounded-lg px-4 data-[state=open]:bg-muted/50"
                    >
                      <AccordionTrigger className="text-left hover:no-underline">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}
          </div>
        )}

        <div className="mt-16 text-center py-12 px-6 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
          <h2 className="text-xl font-semibold mb-4">Vous n&apos;avez pas trouvé votre réponse ?</h2>
          <p className="text-muted-foreground mb-6">
            Notre équipe est là pour vous aider
          </p>
          <Button asChild>
            <Link href="/contact">Contactez-nous</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
