import { Request, Response } from 'express';
import { handleApiError } from '../../utils/api-error';
import { PreguntarDTO, ResultadoConsultaDTO, ReporteDTO, UsoConsultaDTO } from './chat.dtos';
import { ChatService } from './chat.service';
import { construirMensajesResultado, validarLicenciaChat, acumularTokens } from './chat.service';
import { llamarLLMStream } from './chat.llm';

const chatService = new ChatService();

export class ChatController {
  async preguntar(req: Request, res: Response): Promise<void> {
    try {
      const data = PreguntarDTO.parse(req.body);
      const respuesta = await chatService.preguntar(data);
      res.json(respuesta);
    } catch (error) {
      handleApiError(error, res);
    }
  }

  async reporte(req: Request, res: Response): Promise<void> {
    try {
      const data = ReporteDTO.parse(req.body);
      const respuesta = await chatService.reporte(data);
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
      let tokens = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

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
