'use client';

import { useTranslation } from '@/lib/i18n';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Example component showing how to use the i18n system.
 *
 * This is a reference implementation - delete this file once you've
 * migrated the main UI components.
 */
export function I18nExample() {
  const { t, locale, setLocale } = useTranslation();

  return (
    <Card className="max-w-2xl mx-auto mt-8">
      <CardHeader>
        <CardTitle>{t('plan.title')}</CardTitle>
        <CardDescription>{t('plan.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground mb-2">
            Current locale: <strong>{locale}</strong>
          </p>
          <div className="flex gap-2">
            <Button
              variant={locale === 'fr' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLocale('fr')}
            >
              Français
            </Button>
            <Button
              variant={locale === 'en' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLocale('en')}
            >
              English
            </Button>
          </div>
        </div>

        <div className="border-t pt-4">
          <h3 className="font-semibold mb-2">Translation Examples:</h3>
          <ul className="space-y-2 text-sm">
            <li>
              <code className="bg-muted px-2 py-1 rounded text-xs mr-2">
                {`t('common.loading')`}
              </code>
              → {t('common.loading')}
            </li>
            <li>
              <code className="bg-muted px-2 py-1 rounded text-xs mr-2">
                {`t('myTrips.title')`}
              </code>
              → {t('myTrips.title')}
            </li>
            <li>
              <code className="bg-muted px-2 py-1 rounded text-xs mr-2">
                {`t('trip.dayN', {n: 3})`}
              </code>
              → {t('trip.dayN', { n: 3 })}
            </li>
            <li>
              <code className="bg-muted px-2 py-1 rounded text-xs mr-2">
                {`t('plan.budgetLevels.luxury')`}
              </code>
              → {t('plan.budgetLevels.luxury')}
            </li>
          </ul>
        </div>

        <div className="border-t pt-4">
          <h3 className="font-semibold mb-2">Common Actions:</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm">{t('common.save')}</Button>
            <Button variant="outline" size="sm">{t('common.cancel')}</Button>
            <Button variant="outline" size="sm">{t('common.share')}</Button>
            <Button variant="outline" size="sm">{t('common.download')}</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
