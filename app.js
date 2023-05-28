const express = require('express');
const venom = require('venom-bot');

const app = express();
const port = 80; // Porta 80

app.get('/', (req, res) => {
  res.send('API do WhatsApp');
});

app.get('/qr', (req, res) => {
  venom
    .create()
    .then((client) => {
      client.onStateChange((state) => {
        if (state.qrcode) {
          // Converte o código QR em base64
          const qrCodeBase64 = state.qrcode.replace('data:image/png;base64,', '');

          // Retorna o código QR como uma resposta JSON
          res.json({ qrcode: qrCodeBase64 });
        }
      });

      client.onReady(() => {
        console.log('Pronto para usar');
        client.close();
      });

      client.onAnyMessage((message) => {
        console.log(message);
      });
    })
    .catch((error) => {
      console.error('Erro ao criar o cliente Venom:', error);
      res.status(500).send('Erro ao criar o cliente Venom');
    });
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
