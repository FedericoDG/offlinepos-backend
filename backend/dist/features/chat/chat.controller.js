import { handleApiError } from '../../utils/api-error';
import { PreguntarDTO, ResultadoConsultaDTO } from './chat.dtos';
import { ChatService } from './chat.service';
const chatService = new ChatService();
export class ChatController {
    async preguntar(req, res) {
        try {
            const data = PreguntarDTO.parse(req.body);
            const respuesta = await chatService.preguntar(data);
            res.json(respuesta);
        }
        catch (error) {
            handleApiError(error, res);
        }
    }
    async resultado(req, res) {
        try {
            const data = ResultadoConsultaDTO.parse(req.body);
            const respuesta = await chatService.resultado(data);
            res.json(respuesta);
        }
        catch (error) {
            handleApiError(error, res);
        }
    }
}
