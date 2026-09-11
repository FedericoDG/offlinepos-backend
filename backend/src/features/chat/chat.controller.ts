import os from 'os';
import { Request, Response } from 'express';
import { env } from '../../config/env';
import { handleApiError } from '../../utils/api-error';
import { PreguntarDTO, ResultadoConsultaDTO, UsoConsultaDTO, FacturaOcrRequestDTO } from './chat.dtos';
import { ChatService } from './chat.service';
import {
  construirMensajesResultado,
  validarLicenciaChat,
  acumularTokens,
  crearSesionMovil,
  obtenerEstadoSesionMovil,
  subirImagenSesionMovil,
  renderHtmlMovil,
} from './chat.service';
import { llamarLLMStream } from './chat.llm';

const chatService = new ChatService();

function resolverBaseUrlParaMovil(req: Request): string {
  // 1. Si existe PUBLIC_BASE_URL configurada en el servidor y no es localhost, usarla directamente
  if (env.PUBLIC_BASE_URL && !env.PUBLIC_BASE_URL.includes('localhost') && !env.PUBLIC_BASE_URL.includes('127.0.0.1')) {
    return env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  // 2. Si el cliente envió un host explícito por query o body (ej: si se configuró una IP específica)
  const hostParam = (req.query?.host as string) || (req.body?.host as string);
  if (hostParam && !hostParam.includes('localhost') && !hostParam.includes('127.0.0.1')) {
    const protocol = hostParam.startsWith('http') ? '' : 'http://';
    return `${protocol}${hostParam}`.replace(/\/$/, '');
  }

  // 3. Si el host de la petición entrante es un dominio real externo o IP remota (no localhost)
  const reqHost = req.get('x-forwarded-host') || req.get('host') || '';
  if (reqHost && !reqHost.includes('localhost') && !reqHost.includes('127.0.0.1')) {
    const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
    return `${protocol}://${reqHost}`;
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
    return `http://${ipLocal}:${env.PORT}`;
  }

  // Fallback si la máquina no tuviera ninguna interfaz de red externa
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${protocol}://${reqHost || 'localhost:4000'}`;
}

export class ChatController {
  async crearSesionMovil(req: Request, res: Response): Promise<void> {
    try {
      const sesion = crearSesionMovil();
      const baseUrl = resolverBaseUrlParaMovil(req);
      const urlMovil = `${baseUrl}/api/chat/movil-factura/${sesion.sessionId}`;
      res.json({
        sessionId: sesion.sessionId,
        expiraEn: sesion.expiraEn,
        urlMovil,
      });
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async verPaginaMovil(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const html = renderHtmlMovil(sessionId as string);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async subirFotoMovil(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const { imagenBase64, mimeType, nombreArchivo } = req.body;
      if (!imagenBase64) {
        res.status(400).json({ error: 'Falta la imagen' });
        return;
      }
      const ok = subirImagenSesionMovil(sessionId as string, imagenBase64, mimeType, nombreArchivo);
      if (!ok) {
        res.status(410).json({ error: 'Sesión expirada o no encontrada' });
        return;
      }
      res.json({ ok: true, mensaje: 'Imagen recibida exitosamente' });
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async estadoSesionMovil(req: Request, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      const estado = obtenerEstadoSesionMovil(sessionId as string);
      res.json(estado);
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async procesarFacturaOcr(req: Request, res: Response): Promise<void> {
    try {
      const data = FacturaOcrRequestDTO.parse(req.body);
      const respuesta = await chatService.procesarFacturaOcr(data);
      res.json(respuesta);
    } catch (error) {
      handleApiError(error, res);
    }
  }
  async preguntar(req: Request, res: Response): Promise<void> {
    try {
      const data = PreguntarDTO.parse(req.body);
      const respuesta = await chatService.preguntar(data);
      res.json(respuesta);
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async uso(req: Request, res: Response): Promise<void> {
    try {
      const data = UsoConsultaDTO.parse(req.body);
      const respuesta = await chatService.uso(data);
      res.json(respuesta);
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async resultado(req: Request, res: Response): Promise<void> {
    try {
      const data = ResultadoConsultaDTO.parse(req.body);
      const respuesta = await chatService.resultado(data);
      res.json(respuesta);
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async preguntarStream(req: Request, res: Response): Promise<void> {
    try {
      const data = PreguntarDTO.parse(req.body);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      for await (const evento of chatService.preguntarStream(data)) {
        if (evento.type === 'chunk' && evento.texto) {
          res.write(`event: chunk\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
        } else if (evento.type === 'done') {
          res.write(`event: done\ndata: ${JSON.stringify({ tokens: evento.tokens, uso: evento.uso })}\n\n`);
        } else if (evento.type === 'consulta' && evento.respuesta) {
          res.write(`event: consulta\ndata: ${JSON.stringify(evento.respuesta)}\n\n`);
        } else if (evento.type === 'error') {
          res.write(`event: error\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
        }
      }

      res.end();
    } catch (error) {
      if (!res.headersSent) {
        handleApiError(error, res);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ texto: 'Error inesperado' })}\n\n`);
        res.end();
      }
    }
  }

  async resultadoStream(req: Request, res: Response): Promise<void> {
    try {
      const data = ResultadoConsultaDTO.parse(req.body);
      const lic = await validarLicenciaChat(data.clave, data.instalacion_id);
      const mensajes = construirMensajesResultado(data, 'stream');

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let textoCompleto = '';
      let tokens: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cached_tokens: number } = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 };

      for await (const evento of llamarLLMStream(mensajes)) {
        if (evento.type === 'chunk' && evento.texto) {
          textoCompleto += evento.texto;
          res.write(`event: chunk\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
        } else if (evento.type === 'done') {
          tokens = evento.tokens ?? tokens;
          res.write(`event: done\ndata: ${JSON.stringify({ texto: textoCompleto, tokens })}\n\n`);
        } else if (evento.type === 'consulta' && evento.respuesta) {
          res.write(`event: consulta\ndata: ${JSON.stringify(evento.respuesta)}\n\n`);
        } else if (evento.type === 'error') {
          res.write(`event: error\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
        }
      }

      // Acumular tokens en DB
      if (tokens.total_tokens > 0) {
        await acumularTokens(lic.id, tokens);
      }

      res.end();
    } catch (error) {
      if (!res.headersSent) {
        handleApiError(error, res);
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ texto: 'Error inesperado' })}\n\n`);
        res.end();
      }
    }
  }
}
