const express = require('express');
const venom = require('venom-bot');

const app = express();
const port = 80; // Alterado para a porta 80

// Configuração básica do servidor express
app.get('/', (req, res) => {
  res.send('API do WhatsApp');
});

// Endpoint para gerar o código QR
app.get('/qr', (req, res) => {
  venom
    .create()
    .then((client) => {
      client.onStateChange((state) => {
        // Verifica se o estado é 'CONFLICT' ou 'UNLAUNCHED'
        if (state === venom.SocketState.CONFLICT || state === venom.SocketState.UNLAUNCHED) {
          res.status(500).send('Erro ao gerar o código QR');
        }
      });

      client.onQrCode((qrCode) => {
        // Retorna o código QR como uma imagem base64
        const qrCodeImage = `<img src="data:image/png;base64, ${qrCode}" alt="QR Code">`;
        res.send(qrCodeImage);
      });

      client.onReady(() => {
        // A instância do WhatsApp Web está pronta para uso
        console.log('Pronto para usar');
        client.close(); // Fecha o cliente após obter o código QR
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

// Inicia o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
