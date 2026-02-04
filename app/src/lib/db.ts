/**
 * Client Prisma pour la base de données locale (cache des lieux)
 *
 * Utilise un singleton pour éviter les connexions multiples en développement
 * avec le hot-reload de Next.js.
 *
 * IMPORTANT: Si DATABASE_URL n'est pas défini (ex: Vercel sans SQLite),
 * prisma sera null et le cache sera désactivé silencieusement.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | null | undefined;
};

function createPrismaClient(): PrismaClient | null {
  if (!process.env.DATABASE_URL) {
    console.warn('[DB] DATABASE_URL non défini — cache local désactivé (normal sur Vercel)');
    return null;
  }

  try {
    return new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
    });
  } catch (error) {
    console.warn('[DB] Impossible de créer le client Prisma — cache local désactivé:', error);
    return null;
  }
}

export const prisma: PrismaClient | null = globalForPrisma.prisma !== undefined
  ? globalForPrisma.prisma
  : createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
