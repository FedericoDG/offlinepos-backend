import { Request, Response } from 'express';
import { handleApiError } from '../../utils/api-error';
import { resolverBasePublica } from '../../utils/base-publica';
import { PreguntarDTO, ResultadoConsultaDTO, UsoConsultaDTO, FacturaOcrRequestDTO, PreguntarAgenteDTO, ContinuarAgenteDTO, BriefDTO, InformeDTO, ValoracionDTO } from './chat.dtos';
import { ChatService, type EventoAgenteServicio } from './chat.service';
import {
  construirMensajesResultado,
  validarLicenciaChat,
  acumularTokens,
  auditarTextoFinal,
  crearSesionMovil,
  obtenerEstadoSesionMovil,
  subirImagenSesionMovil,
  renderHtmlMovil,
} from './chat.service';
import { llamarLLMStream, mensajeSeguroDeError } from './chat.llm';

const chatService = new ChatService();

export class ChatController {
  async crearSesionMovil(req: Request, res: Response): Promise<void> {
    try {
      const sesion = crearSesionMovil();
      const baseUrl = resolverBasePublica(req);
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

  /**
   * Valoración 👍/👎 del POS. Público como el resto del chat (valida licencia,
   * no usa JWT de admin). No consume cuota y es best-effort: responde
   * `{ ok: true }` aunque la persistencia falle, para no romper al cliente.
   */
  async valorar(req: Request, res: Response): Promise<void> {
    try {
      const data = ValoracionDTO.parse(req.body);
      const respuesta = await chatService.valorar(data);
      res.json(respuesta);
    } catch (error) {
      handleApiError(error, res, 'Error al guardar la valoración');
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
        } else if (evento.type === 'reemplazo' && evento.texto) {
          // Texto corregido por el guardián anti-tarjeta-fantasma: reemplaza
          // todo lo acumulado por chunks en el desktop.
          res.write(`event: reemplazo\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
        } else if (evento.type === 'done') {
          res.write(`event: done\ndata: ${JSON.stringify({ texto: evento.texto ?? '', tokens: evento.tokens, uso: evento.uso })}\n\n`);
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
        responderErrorStream(res, error);
      }
    }
  }

  async resultadoStream(req: Request, res: Response): Promise<void> {    try {
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
      let huboError = false;

      for await (const evento of llamarLLMStream(mensajes)) {
        if (evento.type === 'chunk' && evento.texto) {
          textoCompleto += evento.texto;
          res.write(`event: chunk\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
        } else if (evento.type === 'done') {
          tokens = evento.tokens ?? tokens;
        } else if (evento.type === 'consulta' && evento.respuesta) {
          res.write(`event: consulta\ndata: ${JSON.stringify(evento.respuesta)}\n\n`);
        } else if (evento.type === 'error') {
          huboError = true;
          res.write(`event: error\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
        }
      }

      if (huboError) {
        res.end();
        return;
      }

      // Acumular tokens en DB
      if (tokens.total_tokens > 0) {
        await acumularTokens(lic.id, tokens);
      }

      auditarTextoFinal('resultadoStream', textoCompleto);

      res.write(`event: done\ndata: ${JSON.stringify({ texto: textoCompleto, tokens })}\n\n`);
      res.end();
    } catch (error) {
      if (!res.headersSent) {
        handleApiError(error, res);
      } else {
        responderErrorStream(res, error);
      }
    }
  }

  // --- Agente multi-paso (function calling) ---

  async agenteStream(req: Request, res: Response): Promise<void> {
    try {
      const data = PreguntarAgenteDTO.parse(req.body);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      for await (const evento of chatService.preguntarAgente(data)) {
        escribirEventoAgente(res, evento);
      }

      res.end();
    } catch (error) {
      if (!res.headersSent) {
        handleApiError(error, res);
      } else {
        responderErrorStream(res, error);
      }
    }
  }

  async agenteContinuarStream(req: Request, res: Response): Promise<void> {    try {
      const data = ContinuarAgenteDTO.parse(req.body);

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      for await (const evento of chatService.continuarAgente(data)) {
        escribirEventoAgente(res, evento);
      }

      res.end();
    } catch (error) {
      if (!res.headersSent) {
        handleApiError(error, res);
      } else {
        responderErrorStream(res, error);
      }
    }
  }

  // --- Binny Proactivo (Fase 3): Brief Diario e Informe Semanal ---
  // Respuestas JSON simples (sin streaming). No consumen cuota.

  async brief(req: Request, res: Response): Promise<void> {
    try {
      const data = BriefDTO.parse(req.body);
      const respuesta = await chatService.brief(data);
      res.json(respuesta);
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async informe(req: Request, res: Response): Promise<void> {
    try {
      const data = InformeDTO.parse(req.body);
      const respuesta = await chatService.informe(data);
      res.json(respuesta);
    } catch (error) {
      handleApiError(error, res);
    }
  }
}

/**
 * Cierra un stream SSE con un evento `error` útil cuando los headers ya se
 * enviaron (no se puede usar handleApiError).
 *
 * El error real SIEMPRE queda en el log del servidor (con stack si es Error):
 * antes se escribía el literal pelado "Error inesperado" y el error real se
 * perdía, dejando al usuario ante una pantalla roja sin explicación. Si el
 * error es un mensaje seguro del proveedor se reenvía tal cual; si no, un
 * mensaje genérico que invita a reintentar — nunca detalles internos.
 */
function responderErrorStream(res: Response, error: unknown): void {
  console.error(
    '[chat] error en stream:',
    error instanceof Error ? error.stack ?? error.message : error,
  );
  const texto =
    mensajeSeguroDeError(error) ??
    'No pude completar la respuesta por un error interno. Probá de nuevo en un momento.';
  res.write(`event: error\ndata: ${JSON.stringify({ texto })}\n\n`);
  res.end();
}

/** Serializa un evento del agente al framing SSE que consume el desktop. */
function escribirEventoAgente(res: Response, evento: EventoAgenteServicio): void {
  if (evento.type === 'chunk' && evento.texto) {
    res.write(`event: chunk\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
  } else if (evento.type === 'herramienta' && evento.tool_calls) {
    res.write(`event: herramienta\ndata: ${JSON.stringify({ tool_calls: evento.tool_calls, uso: evento.uso })}\n\n`);
  } else if (evento.type === 'done') {
    res.write(`event: done\ndata: ${JSON.stringify({ texto: evento.texto ?? '', tokens: evento.tokens, uso: evento.uso })}\n\n`);
  } else if (evento.type === 'error') {
    res.write(`event: error\ndata: ${JSON.stringify({ texto: evento.texto })}\n\n`);
  }
}
