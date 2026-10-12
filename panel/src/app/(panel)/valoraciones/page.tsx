import type { Metadata } from 'next';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { Kpi } from '@/components/dashboard/kpi';
import { consultas } from '@/lib/consultas';
import { FiltrosValoraciones } from './filtros';
import { ListaValoraciones } from './lista-valoraciones';

export const metadata: Metadata = { title: 'Valoraciones de Binny' };
export const dynamic = 'force-dynamic';

/**
 * Valoraciones 👍/👎 que los comercios mandan sobre las respuestas de Binny.
 * El objetivo es detectar respuestas malas con el caso concreto: el detalle ya
 * es solo negativas y se puede filtrar por período.
 */
export default async function PaginaValoraciones({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const { periodo } = await searchParams;

  let datos;
  try {
    datos = await consultas.valoraciones({ periodo });
  } catch {
    datos = { resumen: { total: 0, positivas: 0, negativas: 0 }, detalle: [] };
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Valoraciones de Binny"
        descripcion="Lo que los comercios opinan de las respuestas del asistente. Las negativas se listan con el caso concreto para poder revisarlas."
      />

      <section className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi
          etiqueta="Total valoradas"
          valor={datos.resumen.total}
          detalle="respuestas con 👍 o 👎"
        />
        <Kpi
          etiqueta="Positivas 👍"
          valor={datos.resumen.positivas}
          tono="acento"
          detalle="respuestas que sirvieron"
        />
        <Kpi
          etiqueta="Negativas 👎"
          valor={datos.resumen.negativas}
          tono={datos.resumen.negativas > 0 ? 'critico' : 'neutro'}
          detalle="para revisar el caso"
        />
      </section>

      <div className="mb-4">
        <FiltrosValoraciones />
      </div>

      <ListaValoraciones datos={datos.detalle} />
    </>
  );
}
