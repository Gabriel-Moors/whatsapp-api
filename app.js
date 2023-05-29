const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const port = process.env.PORT || 80;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: __dirname
  });
});

// Rota para obter a lista de sessões existentes
app.get('/sessions', (req, res) => {
  const savedSessions = getSessionsFile();
  res.json(savedSessions);
});

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Arquivo de sessões criado com sucesso.');
    } catch(err) {
      console.log('Falha ao criar o arquivo de sessões! ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function(id, description, webhookUrl) {
  console.log('Criando sessão: ' + id);
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- este não funciona no Windows
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    }),
    sessionData: {
      webhookUrl: webhookUrl
    }
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEBIDO', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code recebido, por favor escaneie!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'WhatsApp pronto.' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'WhatsApp autenticado.' });
  });

  client.on('auth_failure', (session) => {
    io.emit('message', { id: id, text: 'Falha na autenticação, tente novamente!' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'WhatsApp desconectado!' });
    fs.unlinkSync(SESSIONS_FILE, function(err) {
      if (err) return console.log(err);
      console.log('Arquivo de sessões excluído com sucesso.');
    });
    client.destroy();
    client.initialize();

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = false;
    setSessionsFile(savedSessions);
  });

  client.on('message', async (msg) => {
    io.emit('message', { id: id, text: msg.body });
  });

  const session = {
    id: id,
    description: description,
    client: client
  }

  sessions.push(session);

  const savedSessions = getSessionsFile();
  savedSessions.push({ id: id, description: description, ready: false });
  setSessionsFile(savedSessions);
}

// Rota para criar uma sessão
app.post('/create-session', (req, res) => {
  const { id, description, webhookUrl } = req.body;

  if (!id || !description || !webhookUrl) {
    return res.status(400).json({
      status: false,
      message: 'ID, descrição e URL do webhook são obrigatórios.'
    });
  }

  createSession(id, description, webhookUrl);

  return res.status(200).json({
    status: true,
    message: 'Sessão criada com sucesso.'
  });
});

// Rota para obter o QR code de uma sessão
app.get('/qr-code/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessions.find(sess => sess.id === sessionId);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }

  const client = session.client;

  client.on('qr', (qr) => {
    res.json({
      status: true,
      qr: qr
    });
  });
});

// Rota para deletar uma sessão
app.delete('/delete-session/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const sessionIndex = sessions.findIndex(sess => sess.id === sessionId);

  if (sessionIndex === -1) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }

  const client = sessions[sessionIndex].client;
  client.destroy();

  sessions.splice(sessionIndex, 1);
  setSessionsFile(getSessionsFile().filter(sess => sess.id !== sessionId));

  res.status(200).json({
    status: true,
    message: 'Sessão deletada com sucesso.'
  });
});

// Rota para enviar uma mensagem de texto
app.post('/send-message', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = sessions.find(sess => sess.id == sender)?.client;

  if (!client) {
    return res.status(422).json({
      status: false,
      message: `O remetente: ${sender} não foi encontrado!`
    });
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `O número: ${number} não está registrado no WhatsApp!`
    });
  }

  client.sendMessage(number, message).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Rota para enviar uma mensagem de mídia
app.post('/send-media', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.fileUrl;

  const client = sessions.find(sess => sess.id == sender)?.client;

  if (!client) {
    return res.status(422).json({
      status: false,
      message: `O remetente: ${sender} não foi encontrado!`
    });
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `O número: ${number} não está registrado no WhatsApp!`
    });
  }

  const media = MessageMedia.fromUrl(fileUrl);

  client.sendMessage(number, media, { caption: caption }).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Rota para enviar uma mensagem com imagem em base64
app.post('/send-image', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const imageData = req.body.imageData;

  const client = sessions.find(sess => sess.id == sender)?.client;

  if (!client) {
    return res.status(422).json({
      status: false,
      message: `O remetente: ${sender} não foi encontrado!`
    });
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `O número: ${number} não está registrado no WhatsApp!`
    });
  }

  const media = new MessageMedia('image/png', imageData);

  client.sendMessage(number, media, { caption: caption }).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Rota para enviar uma mensagem com arquivo em base64
app.post('/send-file', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileData = req.body.fileData;
  const fileName = req.body.fileName;

  const client = sessions.find(sess => sess.id == sender)?.client;

  if (!client) {
    return res.status(422).json({
      status: false,
      message: `O remetente: ${sender} não foi encontrado!`
    });
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `O número: ${number} não está registrado no WhatsApp!`
    });
  }

  const media = new MessageMedia.fromBase64(fileData, fileName);

  client.sendMessage(number, media, { caption: caption }).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Rota para enviar uma mensagem com arquivo em anexo
app.post('/send-attachment', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const attachment = req.files && req.files.attachment;

  const client = sessions.find(sess => sess.id == sender)?.client;

  if (!client) {
    return res.status(422).json({
      status: false,
      message: `O remetente: ${sender} não foi encontrado!`
    });
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: `O número: ${number} não está registrado no WhatsApp!`
    });
  }

  if (!attachment) {
    return res.status(400).json({
      status: false,
      message: 'Anexo não encontrado.'
    });
  }

  const media = new MessageMedia(attachment.mimetype, attachment.data);

  client.sendMessage(number, media, { caption: caption }).then(response => {
    res.status(200).json({
      status: true,
      response: response
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  });
});

// Rota para obter os contatos de uma sessão
app.get('/contacts/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessions.find(sess => sess.id === sessionId);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }

  const client = session.client;

  const contacts = await client.getContacts();

  res.status(200).json({
    status: true,
    contacts: contacts
  });
});

server.listen(port, function() {
  console.log('App rodando na porta ' + port);
});
