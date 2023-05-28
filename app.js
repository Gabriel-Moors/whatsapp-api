const venom = require('venom-bot');
const express = require('express');
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

// Configurar rota padrão
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado.' });
});

// Criar servidor HTTP
const port = 80;
app.listen(port, () => {
  console.log(`Servidor em execução na porta ${port}`);
});
