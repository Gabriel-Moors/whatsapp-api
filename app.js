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
        if (state.qrcode && state.status === 'CONFLICT') {
          // Retorna o código QR como uma resposta JSON
          res.json({ qrcode: state.qrcode });
        } else if (state.status === 'CONNECTED') {
          // Instância conectada com sucesso
          res.send('Instância conectada com sucesso!');
        }
      });

      client.onAnyMessage((message) => {
        // Manipula todas as mensagens recebidas
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
