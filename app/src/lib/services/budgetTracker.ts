/**
 * BudgetTracker - Suivi du budget en temps réel pendant la planification.
 *
 * Permet de contraindre les choix (activités, repas) par le budget restant
 * au lieu de calculer les coûts après coup.
 */

export type BudgetCategory = 'flights' | 'accommodation' | 'food' | 'activities' | 'transport' | 'other';

export interface BudgetBreakdown {
  flights: number;
  accommodation: number;
  food: number;
  activities: number;
  transport: number;
  other: number;
}

export class BudgetTracker {
  private totalBudget: number;
  private spent: BudgetBreakdown;
  private groupSize: number;
  private durationDays: number;

  constructor(totalBudget: number, groupSize: number, durationDays: number) {
    this.totalBudget = totalBudget;
    this.groupSize = groupSize;
    this.durationDays = durationDays;
    this.spent = {
      flights: 0,
      accommodation: 0,
      food: 0,
      activities: 0,
      transport: 0,
      other: 0,
    };
  }

  /** Enregistre une dépense */
  spend(category: BudgetCategory, amount: number): void {
    this.spent[category] += amount;
  }

  /** Vérifie si on peut se permettre une dépense */
  canAfford(category: BudgetCategory, amount: number): boolean {
    return this.getTotalSpent() + amount <= this.totalBudget;
  }

  /** Budget restant total */
  getRemaining(): number {
    return Math.max(0, this.totalBudget - this.getTotalSpent());
  }

  /** Budget restant par jour (pour les jours restants) */
  getRemainingPerDay(daysLeft: number): number {
    if (daysLeft <= 0) return 0;
    const fixedCosts = this.spent.flights + this.spent.accommodation;
    const variableSpent = this.getTotalSpent() - fixedCosts;
    const variableBudget = this.totalBudget - fixedCosts;
    const variableRemaining = variableBudget - variableSpent;
    return Math.max(0, variableRemaining / daysLeft);
  }

  /** Budget quotidien estimé pour une catégorie variable (food/activities) */
  getDailyBudgetFor(category: 'food' | 'activities', dailyTarget: number, daysLeft: number): number {
    if (daysLeft <= 0) return 0;
    const remainingPerDay = this.getRemainingPerDay(daysLeft);
    // Si le budget journalier restant est serré, réduire proportionnellement
    const totalDailyVariable = dailyTarget * 2; // rough: food + activities
    if (totalDailyVariable === 0) return dailyTarget;
    const ratio = Math.min(1, remainingPerDay / totalDailyVariable);
    return Math.round(dailyTarget * ratio);
  }

  /** Total dépensé */
  getTotalSpent(): number {
    return Object.values(this.spent).reduce((a, b) => a + b, 0);
  }

  /** Breakdown complet */
  getBreakdown(): BudgetBreakdown {
    return { ...this.spent };
  }

  /** Pré-remplir les coûts fixes (vols, hébergement) */
  setFixedCosts(flights: number, accommodation: number): void {
    this.spent.flights = flights;
    this.spent.accommodation = accommodation;
  }

  /** Est-on au-dessus du budget ? */
  isOverBudget(): boolean {
    return this.getTotalSpent() > this.totalBudget;
  }

  /** Résumé pour debug */
  getSummary(): string {
    return `Budget: ${this.getTotalSpent()}/${this.totalBudget}€ (reste ${this.getRemaining()}€) | ` +
      `Vols=${this.spent.flights}€ Héb=${this.spent.accommodation}€ Food=${this.spent.food}€ ` +
      `Activités=${this.spent.activities}€ Transport=${this.spent.transport}€`;
  }
}
