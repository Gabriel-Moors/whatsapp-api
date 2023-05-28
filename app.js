const venom = require('venom-bot');
const express = require('express');
const app = express();
app.use(express.json());

// Armazenará as instâncias do Venom
const sessions = {};

// Endpoint para criar uma nova instância
app.post('/sessions', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'O ID da sessão é obrigatório.' });
  }

  try {
    if (!sessions[sessionId]) {
      sessions[sessionId] = await venom.create(sessionId, (base64Qr, asciiQR) => {
        // Callback para receber o QR code
        res.status(200).json({ message: 'Sessão criada com sucesso.', qrCode: base64Qr });
      });

      // Aguardar a geração do QR code antes de retornar a resposta
      await sessions[sessionId].waitForQrCode();
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

// Configurar rota padrão
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado.' });
});

// Criar servidor HTTP
const port = 80;
app.listen(port, () => {
  console.log(`Servidor em execução na porta ${port}`);
});
