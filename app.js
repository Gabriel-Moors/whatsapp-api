const express = require('express');
const venom = require('venom-bot');

const app = express();
const port = 80; // Porta 80

app.get('/', (req, res) => {
  res.json({ message: 'API do WhatsApp' });
});

app.get('/qr', (req, res) => {
  venom
    .create()
    .then((client) => {
      client.onStateChange((state) => {
        if (state.qrcode && state.status === 'CONFLICT') {
          res.json({ qrcode: state.qrcode });
        } else if (state.status === 'CONNECTED') {
          res.json({ message: 'Instância conectada com sucesso!' });
        }
      });

      client.onAnyMessage((message) => {
        console.log(message);
      });

      client.onQrcode((qrCode) => {
        res.json({ qrcode: qrCode });
      });
    })
    .catch((error) => {
      console.error('Erro ao criar o cliente Venom:', error);
      res.status(500).json({ error: 'Erro ao criar o cliente Venom' });
    });
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
