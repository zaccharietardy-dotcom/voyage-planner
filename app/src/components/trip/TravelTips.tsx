'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import {
  Languages,
  Backpack,
  Scale,
  Phone,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Plug,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface TravelTipsProps {
  data: {
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
  };
  className?: string;
}

function Section({
  icon: Icon,
  title,
  children,
  defaultOpen = false,
  iconColor = 'text-primary',
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  iconColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 px-1 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', iconColor)} />
          <span className="font-medium text-sm">{title}</span>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="pb-3 px-1">{children}</div>}
    </div>
  );
}

export function TravelTips({ data, className }: TravelTipsProps) {
  return (
    <Card className={cn('p-4', className)}>
      <h3 className="font-semibold mb-2">Infos pratiques</h3>

      {/* Vocabulaire */}
      <Section icon={Languages} title={`Vocabulaire (${data.vocabulary.language})`} defaultOpen iconColor="text-blue-500">
        <div className="space-y-2">
          {data.vocabulary.phrases.map((phrase, idx) => (
            <div key={idx} className="bg-muted/50 rounded-lg p-2">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{phrase.translation}</p>
                  <p className="text-xs text-muted-foreground">{phrase.original}</p>
                  {phrase.phonetic && (
                    <p className="text-xs text-blue-500 italic">{phrase.phonetic}</p>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                  {phrase.context}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Bagages */}
      <Section icon={Backpack} title="Quoi emporter" iconColor="text-orange-500">
        {(data.packing.plugType || data.packing.voltage) && (
          <div className="flex gap-3 mb-3 p-2 bg-amber-50 rounded-lg">
            {data.packing.plugType && (
              <div className="flex items-center gap-1.5">
                <Plug className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs font-medium">Prise : {data.packing.plugType}</span>
              </div>
            )}
            {data.packing.voltage && (
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs font-medium">{data.packing.voltage}</span>
              </div>
            )}
          </div>
        )}
        <ul className="space-y-1.5">
          {data.packing.essentials.map((item, idx) => (
            <li key={idx} className="flex items-start gap-2 text-sm">
              <span className="text-orange-500 mt-0.5">•</span>
              <div>
                <span className="font-medium">{item.item}</span>
                <span className="text-muted-foreground"> — {item.reason}</span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* Légal */}
      <Section icon={Scale} title="Législation & Visa" iconColor="text-purple-500">
        <div className="space-y-3">
          {data.legal.visaInfo.map((info, idx) => (
            <div key={idx} className="text-sm">
              <span className="font-medium">Depuis {info.originCountry} :</span>{' '}
              <span className="text-muted-foreground">{info.requirement}</span>
            </div>
          ))}
          {data.legal.importantLaws.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-1">Lois locales importantes :</p>
              <ul className="space-y-1">
                {data.legal.importantLaws.map((law, idx) => (
                  <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-purple-500">•</span>
                    {law}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-start gap-1.5 p-2 bg-amber-50 rounded text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            {data.legal.disclaimer}
          </div>
        </div>
      </Section>

      {/* Urgences */}
      <Section icon={Phone} title="Numéros d'urgence" iconColor="text-red-500">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-red-50 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-red-600">{data.emergency.generalEmergency}</p>
            <p className="text-[10px] text-muted-foreground">Urgence générale</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-blue-600">{data.emergency.police}</p>
            <p className="text-[10px] text-muted-foreground">Police</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-orange-600">{data.emergency.ambulance}</p>
            <p className="text-[10px] text-muted-foreground">Ambulance</p>
          </div>
          <div className="bg-yellow-50 rounded-lg p-2 text-center">
            <p className="text-lg font-bold text-yellow-600">{data.emergency.fire}</p>
            <p className="text-[10px] text-muted-foreground">Pompiers</p>
          </div>
        </div>
        {data.emergency.otherNumbers && data.emergency.otherNumbers.length > 0 && (
          <div className="mt-2 space-y-1">
            {data.emergency.otherNumbers.map((n, idx) => (
              <div key={idx} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{n.label}</span>
                <span className="font-medium">{n.number}</span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </Card>
  );
}
