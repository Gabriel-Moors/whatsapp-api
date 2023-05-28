const express = require('express');
const venom = require('venom-bot');

const app = express();
const PORT = 80;

// Rota para obter o QR code para fazer login no WhatsApp
app.get('/login', (req, res) => {
  venom
    .create()
    .then((client) => {
      client.onStateChange((state) => {
        if (state === 'CONFLICT' || state === 'DISCONNECTED') {
          client.useHere();
        }
      });

      client.onQRCode((qrCode) => {
        // Enviar o QR code como resposta da API
        res.send(qrCode);
      });

      client.onReady(() => {
        // O login foi bem-sucedido
        res.send('Login efetuado com sucesso!');
      });
    })
    .catch((error) => {
      res.status(500).send('Erro ao fazer login no WhatsApp: ' + error);
    });
});

app.listen(PORT, () => {
  console.log('API rodando em http://localhost:' + PORT);
});
