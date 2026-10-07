import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Banknote,
  KeyRound,
  Mail,
  MessageSquare,
  Phone,
  Receipt,
  Users,
} from 'lucide-react';
import { ApiError } from '@/lib/api';
import { consultas } from '@/lib/consultas';
import { fecha, fechaLarga, numero, plata } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { EncabezadoPagina } from '@/components/panel/encabezado';
import { BadgeDeuda, BadgeEstadoClave, BadgePlan, BadgeRolClave } from '@/components/panel/estado-badge';
import { Kpi } from '@/components/dashboard/kpi';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ComercioDetalle, MetodoPago } from '@/lib/tipos';
import { EditarComercio } from '../formularios';
import { AccionesClaveDetalle, BorrarPago, RegistrarPago } from './formularios';

export const dynamic = 'force-dynamic';

const ETIQUETA_METODO: Record<MetodoPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
  TARJETA: 'Tarjeta',
  OTRO: 'Otro',
};

/** El último período cubierto por un pago define desde dónde estimar la deuda. */
function ultimoPeriodoCubierto(detalle: ComercioDetalle): string | null {
  if (detalle.pagos.length === 0) return null;
  return detalle.pagos.reduce(
    (maximo, pago) => (pago.periodo_hasta > maximo ? pago.periodo_hasta : maximo),
    detalle.pagos[0].periodo_hasta
  );
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const detalle = await consultas.comercioDetalle(id);
    return { title: detalle.comercio.nombre };
  } catch {
    return { title: 'Comercio' };
  }
}

export default async function PaginaDetalleComercio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detalle: ComercioDetalle;
  try {
    detalle = await consultas.comercioDetalle(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const { comercio, plan, claves, consumo_chat: consumo, pagos, deuda } = detalle;

  const clavesActivas = claves.filter((clave) => clave.estado === 'activa');
  const servidores = clavesActivas.filter((clave) => clave.rol === 'SERVIDOR').length;
  const clientes = clavesActivas.filter((clave) => clave.rol === 'CLIENTE').length;

  const ilimitado = consumo.cupo === 0;
  const pct = ilimitado ? 0 : Math.min(100, Math.round((consumo.total_mensajes / consumo.cupo) * 100));
  const colorBarra = pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-[var(--warning)]' : 'bg-[var(--success)]';

  const ultimoPeriodo = ultimoPeriodoCubierto(detalle);

  return (
    <>
      <EncabezadoPagina
        titulo={comercio.nombre}
        descripcion="Contacto, claves, consumo del chat, pagos y deuda estimada del comercio en una sola pantalla."
        accion={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/comercios">
                <ArrowLeft /> Comercios
              </Link>
            </Button>
            <EditarComercio comercio={comercio} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/licencias?q=${encodeURIComponent(comercio.nombre)}`}>
                <KeyRound /> Ver claves
              </Link>
            </Button>
          </div>
        }
      />

      {/* Datos del comercio */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Datos del comercio</CardTitle>
          <CardDescription>Alta el {fechaLarga(comercio.createdAt)}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Plan</p>
            <BadgePlan nombre={plan?.nombre} />
            {plan && <p className="text-muted-foreground text-xs">{plata(plan.precio_mensual)} / mes</p>}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Teléfono</p>
            <p className="flex items-center gap-2 text-sm">
              <Phone className="text-muted-foreground size-4 shrink-0" />
              {comercio.telefono ?? <span className="text-muted-foreground">—</span>}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Email</p>
            <p className="flex items-center gap-2 text-sm">
              <Mail className="text-muted-foreground size-4 shrink-0" />
              {comercio.email ? (
                <span className="truncate">{comercio.email}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          etiqueta="Claves activas"
          valor={clavesActivas.length}
          tono="acento"
          detalle={`${servidores} servidor · ${clientes} cliente${
            plan ? ` · cupo ${plan.max_servidores} servidor / ${plan.max_clientes} cliente` : ''
          }`}
        />
        <Kpi
          etiqueta="Consumo chat del mes"
          valor={numero(consumo.total_mensajes)}
          detalle={`${numero(consumo.total_tokens)} tokens · ${
            ilimitado ? 'cupo ilimitado' : `cupo ${numero(consumo.cupo)}`
          }`}
        />
        <Kpi
          etiqueta="Deuda estimada"
          valor={deuda.al_dia ? 'Al día' : plata(deuda.monto_estimado)}
          tono={deuda.al_dia ? 'acento' : 'critico'}
          detalle={
            deuda.al_dia ? (
              'sin períodos impagos'
            ) : (
              <span className="flex items-center gap-2">
                <BadgeDeuda alDia={false} periodos={deuda.periodos_impagos} />
                desde {fecha(deuda.desde)}
              </span>
            )
          }
        />
      </section>

      {/* Consumo del chat */}
      <Card className="mt-4 gap-0">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="size-4" /> Consumo del chat
          </CardTitle>
          <CardDescription>
            Período {consumo.periodo_actual}. El cupo sale del override del comercio o, si no hay, del plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="cifra text-sm tabular-nums">
                {numero(consumo.total_mensajes)}
                {ilimitado ? ' mensajes' : ` / ${numero(consumo.cupo)} mensajes`}
              </span>
              <span className="text-muted-foreground text-xs">{ilimitado ? 'Ilimitado' : `${pct}% del cupo`}</span>
            </div>
            <div className="bg-muted h-2.5 w-full overflow-hidden rounded-full">
              <div
                className={cn('h-full rounded-full transition-[width]', colorBarra)}
                style={{ width: ilimitado ? '100%' : `${pct}%` }}
              />
            </div>
          </div>

          {consumo.por_clave.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-8 text-center">
              <MessageSquare className="size-7 opacity-40" />
              <p className="text-sm">Este comercio todavía no tiene claves cargadas.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clave</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead className="text-right">Mensajes</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consumo.por_clave.map((fila, indice) => (
                  <TableRow key={`${fila.clave_mascara ?? 'clave'}-${indice}`}>
                    <TableCell className="font-mono text-xs">{fila.clave_mascara ?? '(no disponible)'}</TableCell>
                    <TableCell>
                      <BadgeRolClave rol={fila.rol} />
                    </TableCell>
                    <TableCell className="cifra text-right tabular-nums">{numero(fila.mensajes)}</TableCell>
                    <TableCell className="cifra text-right tabular-nums">{numero(fila.tokens)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Claves */}
      <Card className="mt-4 gap-0">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Claves
          </CardTitle>
          <CardDescription>
            {claves.length === 0
              ? 'El comercio no tiene claves asignadas.'
              : `${clavesActivas.length} de ${claves.length} activas. Desactivar es la salida cuando la clave tiene historial; borrar solo si no tiene referencias.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {claves.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-10 text-center">
              <KeyRound className="size-7 opacity-40" />
              <p className="text-sm">Sin claves asignadas todavía.</p>
              <p className="text-xs">
                Generá claves libres en{' '}
                <Link href="/licencias" className="text-foreground underline-offset-2 hover:underline">
                  Claves
                </Link>{' '}
                y asignalas desde el alta del comercio.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Clave</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Activaciones</TableHead>
                  <TableHead>Última activación</TableHead>
                  <TableHead className="pr-6 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claves.map((clave) => (
                  <TableRow key={clave.id}>
                    <TableCell className="pl-6 font-mono text-xs">{clave.clave_mascara ?? '(no disponible)'}</TableCell>
                    <TableCell>
                      <BadgeRolClave rol={clave.rol} />
                    </TableCell>
                    <TableCell>
                      <BadgeEstadoClave estado={clave.estado} />
                    </TableCell>
                    <TableCell className="cifra tabular-nums">{clave.activaciones}</TableCell>
                    <TableCell className="cifra text-muted-foreground tabular-nums">
                      {fecha(clave.ultima_activacion)}
                    </TableCell>
                    <TableCell className="pr-6">
                      <AccionesClaveDetalle clave={clave} comercioId={comercio.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagos */}
      <Card className="mt-4 gap-0">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-4" /> Pagos
          </CardTitle>
          <CardDescription>
            {pagos.length === 0
              ? 'Sin pagos registrados todavía.'
              : `${pagos.length} ${pagos.length === 1 ? 'pago registrado' : 'pagos registrados'}.`}
          </CardDescription>
          <CardAction>
            <RegistrarPago
              comercioId={comercio.id}
              precioMensual={plan?.precio_mensual ?? null}
              ultimoPeriodoHasta={ultimoPeriodo}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="px-0">
          {pagos.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-6 py-10 text-center">
              <Banknote className="size-7 opacity-40" />
              <p className="text-sm">Sin pagos registrados todavía.</p>
              <p className="text-xs">Registrá el primero con el botón de arriba: el monto se prellena con el plan.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Fecha</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Período cubierto</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead className="pr-6 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagos.map((pago) => (
                  <TableRow key={pago.id}>
                    <TableCell className="cifra pl-6 tabular-nums">{fecha(pago.pagado_en)}</TableCell>
                    <TableCell className="cifra text-right font-medium tabular-nums">{plata(pago.monto)}</TableCell>
                    <TableCell>
                      <span className="text-sm">{ETIQUETA_METODO[pago.metodo] ?? pago.metodo}</span>
                    </TableCell>
                    <TableCell className="cifra text-muted-foreground text-xs tabular-nums">
                      {fecha(pago.periodo_desde)} → {fecha(pago.periodo_hasta)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[220px] truncate text-xs">
                      {pago.nota ?? '—'}
                    </TableCell>
                    <TableCell className="pr-6">
                      <BorrarPago pagoId={pago.id} comercioId={comercio.id} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <p className="text-muted-foreground px-6 pt-4 text-xs leading-relaxed">
            <span className="text-foreground">Deuda</span>: {deuda.regla}
            {!deuda.al_dia && <> · desde {fecha(deuda.desde)}</>}. Es una estimación, no un saldo contable.
          </p>
        </CardContent>
      </Card>

      <p className="text-muted-foreground mt-4 max-w-2xl text-xs leading-relaxed">
        <Users className="mr-1 inline size-3" />
        El cupo de claves y de chat lo declara el plan; un override por comercio puede pisar el de chat.
      </p>
    </>
  );
}
