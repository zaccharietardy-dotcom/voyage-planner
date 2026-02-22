'use client';

import { useState } from 'react';
import type { Trip } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { CalendarPlus, Calendar, Download } from 'lucide-react';
import { toast } from 'sonner';

interface AddToCalendarDropdownProps {
  savedTripId?: string;
  shareCode?: string;
  trip: Trip;
}

// Helper: generate ICS from Trip object (client-side fallback for unsaved trips)
function generateIcsFromTrip(trip: Trip): string {
  const destination = trip.preferences.destination || 'Voyage';
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const escapeIcal = (str: string): string => {
    return (str || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  };

  const toIcalDate = (date: Date | string, time: string): string => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const [h, m] = (time || '09:00').split(':');
    return `${year}${month}${day}T${h.padStart(2, '0')}${m.padStart(2, '0')}00`;
  };

  const formatEndTime = (startTime: string, duration: number): string => {
    const [h, m] = startTime.split(':').map(Number);
    const totalMin = h * 60 + m + duration;
    const eh = Math.floor(totalMin / 60) % 24;
    const em = totalMin % 60;
    return `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`;
  };

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Narae Voyage//Trip//FR',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:Voyage - ${escapeIcal(destination)}`,
    'METHOD:PUBLISH',
  ].join('\r\n');

  for (const day of trip.days) {
    if (!day.date) continue;

    for (const item of day.items) {
      const startTime = item.startTime || '09:00';
      const endTime =
        item.endTime ||
        (item.duration ? formatEndTime(startTime, item.duration) : '10:00');

      const uid = `${item.id}@voyage-planner`;
      const dtstart = toIcalDate(day.date, startTime);
      const dtend = toIcalDate(day.date, endTime);

      ics += '\r\n';
      ics += 'BEGIN:VEVENT\r\n';
      ics += `UID:${uid}\r\n`;
      ics += `DTSTART:${dtstart}\r\n`;
      ics += `DTEND:${dtend}\r\n`;
      ics += `SUMMARY:${escapeIcal(item.title)}\r\n`;
      ics += `DTSTAMP:${now}\r\n`;

      if (item.description) {
        ics += `DESCRIPTION:${escapeIcal(item.description)}\r\n`;
      }
      if (item.locationName) {
        ics += `LOCATION:${escapeIcal(item.locationName)}\r\n`;
      }
      if (item.latitude && item.longitude) {
        ics += `GEO:${item.latitude};${item.longitude}\r\n`;
      }

      ics += 'END:VEVENT\r\n';
    }
  }

  ics += 'END:VCALENDAR';
  return ics;
}

// Helper to download ICS blob
function downloadIcsBlob(icsContent: string, destination: string) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voyage-${destination.replace(/\s+/g, '-').toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function AddToCalendarDropdown({
  savedTripId,
  shareCode,
  trip,
}: AddToCalendarDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const destination = trip.preferences.destination || 'Voyage';

  const isPublicUrl =
    typeof window !== 'undefined' &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1');

  const icsUrl = savedTripId
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/trips/${savedTripId}/calendar.ics${shareCode ? `?token=${shareCode}` : ''}`
    : null;

  const handleAppleCalendar = () => {
    if (!savedTripId || !icsUrl) {
      const icsContent = generateIcsFromTrip(trip);
      downloadIcsBlob(icsContent, destination);
      toast.success('Fichier .ics t\u00e9l\u00e9charg\u00e9 pour Apple Calendar');
      setIsOpen(false);
      return;
    }

    if (isPublicUrl) {
      const webcalUrl = icsUrl.replace(/^https?:\/\//, 'webcal://');
      window.location.href = webcalUrl;
      toast.success('Ouverture dans Apple Calendar...');
    } else {
      window.open(`${icsUrl}${icsUrl.includes('?') ? '&' : '?'}download=1`, '_blank');
      toast.success('Fichier .ics t\u00e9l\u00e9charg\u00e9');
    }
    setIsOpen(false);
  };

  const handleGoogleCalendar = () => {
    if (!savedTripId || !icsUrl) {
      const icsContent = generateIcsFromTrip(trip);
      downloadIcsBlob(icsContent, destination);
      setTimeout(() => {
        toast.info(
          'Fichier t\u00e9l\u00e9charg\u00e9 ! Pour importer : ouvrez calendar.google.com > Param\u00e8tres > Importer'
        );
      }, 500);
      setIsOpen(false);
      return;
    }

    if (isPublicUrl) {
      const gcalUrl = `https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(icsUrl)}`;
      window.open(gcalUrl, '_blank');
      toast.success('Redirection vers Google Calendar...');
    } else {
      window.open(`${icsUrl}${icsUrl.includes('?') ? '&' : '?'}download=1`, '_blank');
      setTimeout(() => {
        toast.info(
          'Fichier t\u00e9l\u00e9charg\u00e9 ! Pour importer : ouvrez calendar.google.com > Param\u00e8tres > Importer'
        );
      }, 500);
    }
    setIsOpen(false);
  };

  const handleOutlook = () => {
    if (!savedTripId || !icsUrl) {
      const icsContent = generateIcsFromTrip(trip);
      downloadIcsBlob(icsContent, destination);
      toast.success('Fichier .ics t\u00e9l\u00e9charg\u00e9 pour Outlook');
      setIsOpen(false);
      return;
    }

    window.open(`${icsUrl}${icsUrl.includes('?') ? '&' : '?'}download=1`, '_blank');
    toast.success('Fichier .ics t\u00e9l\u00e9charg\u00e9 - Ouvrez-le avec Outlook');
    setIsOpen(false);
  };

  const handleDownload = () => {
    if (!savedTripId || !icsUrl) {
      const icsContent = generateIcsFromTrip(trip);
      downloadIcsBlob(icsContent, destination);
      toast.success('Fichier .ics t\u00e9l\u00e9charg\u00e9');
      setIsOpen(false);
      return;
    }

    window.open(`${icsUrl}${icsUrl.includes('?') ? '&' : '?'}download=1`, '_blank');
    toast.success('Fichier .ics t\u00e9l\u00e9charg\u00e9');
    setIsOpen(false);
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 shrink-0 hidden sm:inline-flex"
          title="Ajouter au calendrier"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline text-xs">Calendrier</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={handleAppleCalendar}>
          <Calendar className="h-4 w-4 text-gray-700 dark:text-gray-300" />
          <span>Apple Calendar</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleGoogleCalendar}>
          <Calendar className="h-4 w-4 text-blue-500" />
          <span>Google Calendar</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleOutlook}>
          <Calendar className="h-4 w-4 text-blue-600" />
          <span>Outlook</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleDownload}>
          <Download className="h-4 w-4" />
          <span>T\u00e9l\u00e9charger .ics</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
