'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, Mail, MessageSquare, HelpCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const contactReasons = [
  { value: 'general', label: 'Question générale' },
  { value: 'bug', label: 'Signaler un bug' },
  { value: 'feature', label: 'Suggestion de fonctionnalité' },
  { value: 'partnership', label: 'Partenariat' },
  { value: 'press', label: 'Presse / Médias' },
  { value: 'other', label: 'Autre' },
];

const quickLinks = [
  {
    icon: HelpCircle,
    title: 'FAQ',
    description: 'Consultez les questions fréquentes',
    href: '/faq',
  },
  {
    icon: Mail,
    title: 'Email',
    description: 'contact@naraevoyage.com',
    href: 'mailto:contact@naraevoyage.com',
  },
  {
    icon: MessageSquare,
    title: 'Réseaux sociaux',
    description: '@naraevoyage',
    href: '#',
  },
];

export default function ContactPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate form submission
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setIsSubmitting(false);
    setIsSubmitted(true);
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

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
          <h1 className="text-4xl font-bold mb-4">Contactez-nous</h1>
          <p className="text-xl text-muted-foreground">
            Une question, une suggestion ? Nous sommes là pour vous aider.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 mb-12">
          {quickLinks.map((link) => (
            <Card key={link.title} className="border-border/50 hover:border-primary/50 transition-colors">
              <CardContent className="p-6">
                <a href={link.href} className="block">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <link.icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-semibold">{link.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{link.description}</p>
                </a>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle>Envoyez-nous un message</CardTitle>
            <CardDescription>
              Remplissez le formulaire ci-dessous et nous vous répondrons dans les plus brefs délais.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSubmitted ? (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
                  <Send className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Message envoyé !</h3>
                <p className="text-muted-foreground mb-6">
                  Merci de nous avoir contacté. Nous vous répondrons sous 48h.
                </p>
                <Button variant="outline" onClick={() => setIsSubmitted(false)}>
                  Envoyer un autre message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Nom complet</Label>
                    <Input
                      id="name"
                      placeholder="Jean Dupont"
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="jean@exemple.com"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Sujet</Label>
                  <Select
                    value={formData.subject}
                    onValueChange={(value) => handleChange('subject', value)}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choisissez un sujet" />
                    </SelectTrigger>
                    <SelectContent>
                      {contactReasons.map((reason) => (
                        <SelectItem key={reason.value} value={reason.value}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Message</Label>
                  <Textarea
                    id="message"
                    placeholder="Décrivez votre demande en détail..."
                    className="min-h-[150px] resize-none"
                    value={formData.message}
                    onChange={(e) => handleChange('message', e.target.value)}
                    required
                  />
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={isSubmitting} size="lg">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Envoi en cours...
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Envoyer
                      </>
                    )}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-8">
          En nous contactant, vous acceptez notre{' '}
          <Link href="/privacy" className="text-primary hover:underline">
            politique de confidentialité
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
