const venom = require('venom-bot');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const instances = [];

app.post('/createInstance', (req, res) => {
  venom.create().then((client) => {
    instances.push(client);
    const qrcode = client.getQRCode();
    res.status(200).json({ success: true, message: 'Escaneie o QR code para conectar', qrcode });
  }).catch((error) => {
    res.status(500).json({ success: false, message: 'Falha ao criar instância', error });
  });
});

app.post('/sendMessage', (req, res) => {
  const { instanceIndex, number, message } = req.body;
  const client = instances[instanceIndex];
  if (!client) {
    res.status(404).json({ success: false, message: 'Instância não encontrada' });
    return;
  }
  client.sendText(number, message).then((result) => {
    res.sendStatus(200);
  }).catch((error) => {
    res.status(500).json({ success: false, message: 'Falha ao enviar mensagem', error });
  });
});

app.delete('/deleteInstance/:instanceIndex', (req, res) => {
  const instanceIndex = req.params.instanceIndex;
  if (instances[instanceIndex]) {
    instances.splice(instanceIndex, 1);
    res.sendStatus(204);
  } else {
    res.status(404).json({ success: false, message: 'Instância não encontrada' });
  }
});

app.get('/listInstances', (req, res) => {
  res.status(200).json({ success: true, instances });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint não encontrado' });
});

app.listen(80, () => {
  console.log('API em execução na porta 3000');
});
