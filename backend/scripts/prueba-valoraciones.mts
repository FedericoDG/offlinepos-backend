/**
 * Corre SOLO las comprobaciones de valoraciones (las de la suite general) sin
 * Postgres: usan la base falsa en memoria.
 *
 * Atajo para iterar sobre este feature sin correr toda la suite.
 *
 * Uso: npx tsx scripts/prueba-valoraciones.mts
 */
import '../pruebas/entorno';
import { informe } from '../pruebas/ayuda';
import * as valoraciones from '../pruebas/valoraciones.prueba';

console.log('\n=== Valoraciones de Binny (aislado) ===');
await valoraciones.correr();
informe();
