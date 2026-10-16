/**
 * Corre todas las pruebas de logica del backend.
 *
 *   npx tsx pruebas/correr.ts
 *
 * No hacen falta ni Postgres ni Docker: los servicios reciben una base en
 * memoria. Lo que se ejercita es el codigo real, no una copia.
 */
import './entorno';

import { informe } from './ayuda';
import * as suscripciones from './suscripciones.prueba';
import * as licencias from './licencias.prueba';
import * as estadisticas from './estadisticas.prueba';
import * as chatConsumo from './chat-consumo.prueba';
import * as valoraciones from './valoraciones.prueba';
import * as guardasEspejo from './chat-guardas-espejo.prueba';

console.log('\n=== Pruebas de logica del panel ===');

await suscripciones.correr();
await licencias.correr();
await estadisticas.correr();
await chatConsumo.correr();
await valoraciones.correr();
guardasEspejo.correr();

informe();
