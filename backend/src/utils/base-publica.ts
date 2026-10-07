import os from 'os';
import { Request } from 'express';
import { env } from '../config/env';

/**
 * Devuelve el origen público (sin barra final y sin path) con el que se deben
 * armar las URLs absolutas que consume un cliente externo: el link móvil del
 * chat y las URLs de descarga del updater del POS.
 *
 * Estrategia, en orden:
 *  1. Si `PUBLIC_BASE_URL` está configurada y no es localhost, se usa tal cual.
 *  2. Si el cliente mandó un `host` explícito (query o body) no-localhost.
 *  3. Si el host del request entrante (`x-forwarded-host`/`host`) no es
 *     localhost, se combina con `x-forwarded-proto`/`req.protocol`.
 *  4. Si el request vino de localhost (app desktop en la misma PC), se busca
 *     una IP de red local para que el celular o la caja en la misma red pueda
 *     alcanzarla.
 *  5. Fallback: el host del request (o localhost:PORT si no hubiera host).
 *
 * El resultado se normaliza a su `origin` para garantizar que nunca lleve
 * path ni barra final (el código consumidor agrega `/api/...`).
 */
export function resolverBasePublica(req: Request): string {
  // 1. Si existe PUBLIC_BASE_URL configurada en el servidor y no es localhost, usarla directamente
  if (env.PUBLIC_BASE_URL && !env.PUBLIC_BASE_URL.includes('localhost') && !env.PUBLIC_BASE_URL.includes('127.0.0.1')) {
    return soloOrigen(env.PUBLIC_BASE_URL);
  }

  // 2. Si el cliente envió un host explícito por query o body (ej: si se configuró una IP específica)
  const hostParam = (req.query?.host as string) || (req.body?.host as string);
  if (hostParam && !hostParam.includes('localhost') && !hostParam.includes('127.0.0.1')) {
    const protocol = hostParam.startsWith('http') ? '' : 'http://';
    return soloOrigen(`${protocol}${hostParam}`);
  }

  // 3. Si el host de la petición entrante es un dominio real externo o IP remota (no localhost)
  const reqHost = req.get('x-forwarded-host') || req.get('host') || '';
  if (reqHost && !reqHost.includes('localhost') && !reqHost.includes('127.0.0.1')) {
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
    return soloOrigen(`${protocol}://${reqHost}`);
  }

  // 4. Si la petición provino de localhost/127.0.0.1 (caso de la app desktop en la misma PC):
  // El teléfono no puede resolver "localhost" porque se conectaría a sí mismo.
  // Buscamos la IP local de la computadora en la red Wi-Fi o Ethernet para que el celular en la misma red pueda acceder.
  const nets = os.networkInterfaces();
  const candidatas: string[] = [];

  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    // Descartar interfaces virtuales de Docker, puentes de red y máquinas virtuales
    if (
      lower.startsWith('br-') ||
      lower.startsWith('docker') ||
      lower.startsWith('veth') ||
      lower.startsWith('virbr') ||
      lower.startsWith('vmnet')
    ) {
      continue;
    }
    for (const net of nets[name] || []) {
      if ((net.family === 'IPv4' || (net.family as any) === 4) && !net.internal) {
        candidatas.push(net.address);
      }
    }
  }

  // Priorizar rangos típicos de red de área local (Wi-Fi o LAN comercial)
  const ipLocal =
    candidatas.find((ip) => ip.startsWith('192.168.')) ||
    candidatas.find((ip) => ip.startsWith('10.')) ||
    candidatas[0];

  if (ipLocal) {
    return soloOrigen(`http://${ipLocal}:${env.PORT}`);
  }

  // Fallback si la máquina no tuviera ninguna interfaz de red externa
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  return soloOrigen(`${protocol}://${reqHost || `localhost:${env.PORT}`}`);
}

/**
 * Normaliza a origen: sin path y sin barra final. Si la cadena no parsea como
 * URL (caso raro), cae a un recorte de la barra final.
 */
function soloOrigen(valor: string): string {
  try {
    return new URL(valor).origin;
  } catch {
    return valor.replace(/\/$/, '');
  }
}
