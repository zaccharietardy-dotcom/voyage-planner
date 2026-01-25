import { useState, useCallback } from 'react';

/**
 * Hook générique pour la gestion d'état des formulaires
 * Gère l'état, les erreurs de validation, et les mises à jour de champs
 *
 * @param initialState - État initial du formulaire
 * @returns Objet avec state, errors, et méthodes de manipulation
 */
export function useFormState<T extends Record<string, unknown>>(initialState: T) {
  const [state, setState] = useState<T>(initialState);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});

  /**
   * Met à jour un champ spécifique et efface son erreur
   */
  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setState(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
    setTouched(prev => ({ ...prev, [field]: true }));
  }, []);

  /**
   * Met à jour plusieurs champs à la fois
   */
  const updateFields = useCallback((updates: Partial<T>) => {
    setState(prev => ({ ...prev, ...updates }));
    // Efface les erreurs pour les champs mis à jour
    const clearedErrors = Object.keys(updates).reduce(
      (acc, key) => ({ ...acc, [key]: undefined }),
      {}
    );
    setErrors(prev => ({ ...prev, ...clearedErrors }));
  }, []);

  /**
   * Définit une erreur pour un champ spécifique
   */
  const setError = useCallback(<K extends keyof T>(field: K, message: string) => {
    setErrors(prev => ({ ...prev, [field]: message }));
  }, []);

  /**
   * Définit plusieurs erreurs à la fois
   */
  const setMultipleErrors = useCallback((newErrors: Partial<Record<keyof T, string>>) => {
    setErrors(prev => ({ ...prev, ...newErrors }));
  }, []);

  /**
   * Efface toutes les erreurs
   */
  const clearErrors = useCallback(() => {
    setErrors({});
  }, []);

  /**
   * Réinitialise le formulaire à son état initial
   */
  const reset = useCallback(() => {
    setState(initialState);
    setErrors({});
    setTouched({});
  }, [initialState]);

  /**
   * Vérifie si le formulaire a été modifié
   */
  const isDirty = Object.keys(touched).some(key => touched[key as keyof T]);

  /**
   * Vérifie si le formulaire a des erreurs
   */
  const hasErrors = Object.values(errors).some(error => error !== undefined);

  return {
    state,
    errors,
    touched,
    updateField,
    updateFields,
    setError,
    setMultipleErrors,
    clearErrors,
    reset,
    isDirty,
    hasErrors,
  };
}
