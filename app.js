const express = require('express');
const venom = require('venom-bot');

const app = express();
app.use(express.json());

let sessionInstance;

// Endpoint para criar uma nova instância do Venom-bot
app.post('/sessions', async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'O ID da sessão é obrigatório.' });
    }

    if (sessionInstance) {
      return res.status(400).json({ error: 'Já existe uma sessão em execução.' });
    }

    sessionInstance = await venom.create(sessionId, (base64QrCode) => {
      // Callback para receber o QR Code
      const qrCode = `data:image/png;base64, ${base64QrCode}`;
      res.status(200).json({ message: 'Sessão criada com sucesso.', qrCode });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha ao criar a sessão.' });
  }
});

// Endpoint para enviar uma mensagem
app.post('/sessions/:sessionId/send-message', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { number, message } = req.body;

    if (!sessionInstance) {
      return res.status(400).json({ error: 'Nenhuma sessão ativa.' });
    }

    await sessionInstance.sendText(number, message);
    res.status(200).json({ message: 'Mensagem enviada com sucesso.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Falha ao enviar a mensagem.' });
  }
});

// Iniciar o servidor
const port = 80;
app.listen(port, () => {
  console.log(`Servidor em execução na porta ${port}`);
});
