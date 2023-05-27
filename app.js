const venom = require('venom-bot');
const express = require('express');
const winston = require('winston');

const app = express();
app.use(express.json());

const sessions = {}; // Armazenará as instâncias do Venom

// Endpoint para criar uma nova instância
app.post('/sessions', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'O ID da sessão é obrigatório.' });
  }

  try {
    if (!sessions[sessionId]) {
      sessions[sessionId] = await venom.create(sessionId);

      // Gerar o QR Code para a nova instância
      const qrCode = await sessions[sessionId].getQrCode();

      // Enviar a resposta com o QR Code
      res.status(200).json({ message: 'Sessão criada com sucesso.', qrCode });
    } else {
      res.status(200).json({ message: 'Sessão já existe.' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha ao criar a sessão.' });
  }
});

// Endpoint para excluir uma instância
app.delete('/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  if (sessions[sessionId]) {
    delete sessions[sessionId];
    res.status(200).json({ message: 'Sessão excluída com sucesso.' });
  } else {
    res.status(404).json({ error: 'Sessão não encontrada.' });
  }
});

// Endpoint para enviar uma mensagem
app.post('/sessions/:sessionId/send-message', async (req, res) => {
  const { sessionId } = req.params;
  const { number, message } = req.body;

  try {
    const session = sessions[sessionId];
    await session.sendText(number, message);

    res.status(200).json({ message: 'Mensagem enviada com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha ao enviar a mensagem.' });
  }
});

// Configurar logs
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Registrar solicitações recebidas nos logs
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Configurar rota padrão
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado.' });
});

// Iniciar o servidor na porta 80
const port = 80;
app.listen(port, () => {
  console.log(`Servidor em execução na porta ${port}`);
});
