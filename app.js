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
const SESSIONS_FILE = './whatsapp-sessions.json';

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ debug: false }));

app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: __dirname
  });
});

let sessions = [];

const createSessionsFileIfNotExists = function () {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Arquivo de sessões criado com sucesso.');
    } catch (err) {
      console.log('Falha ao criar o arquivo de sessões:', err);
    }
  }
};

createSessionsFileIfNotExists();

const setSessionsFile = function (sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function (err) {
    if (err) {
      console.log(err);
    }
  });
};

const getSessionsFile = function () {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
};

const createSession = function (id, description, webhooks) {
  console.log('Criando sessão:', id);
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
        '--single-process',
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    })
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEBIDO:', qr);
    if (typeof qr === 'string') {
      qrcode.toDataURL(qr, (err, url) => {
        if (err) {
          console.error('Erro ao gerar o código QR:', err);
          return;
        }
        io.emit('qr', { id: id, src: url });
        io.emit('message', { id: id, text: 'QR Code recebido, faça a leitura!' });
      });
    } else {
      console.error('QR code inválido:', qr);
    }
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'O WhatsApp está pronto!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id === id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'O WhatsApp foi autenticado!' });
  });

  client.on('auth_failure', function () {
    io.emit('message', { id: id, text: 'Falha na autenticação, reiniciando...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'O WhatsApp foi desconectado!' });
    client.destroy();
    client.initialize();

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id === id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  sessions.push({
    id: id,
    description: description,
    client: client,
    webhooks: webhooks
  });

  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id === id);

  if (sessionIndex === -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
      webhooks: webhooks
    });
    setSessionsFile(savedSessions);
  }
};

const init = function (socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description, sess.webhooks);
      });
    }
  }
};

init();

io.on('connection', function (socket) {
  init(socket);

  socket.on('create-session', function (data) {
    console.log('Criar sessão:', data.id);
    createSession(data.id, data.description, data.webhooks);
  });
});

// CRIAR SESSÃO
app.post('/create-session', async (req, res) => {
  const id = req.body.id;
  const description = req.body.description;
  const webhooks = req.body.webhooks;

  if (!id || !description || !webhooks) {
    return res.status(422).json({
      status: false,
      message: 'Os parâmetros id, description e webhooks são obrigatórios'
    });
  }

  if (sessions.some(sess => sess.id === id)) {
    return res.status(422).json({
      status: false,
      message: 'Já existe uma sessão com o mesmo ID'
    });
  }

  if (sessions.length >= 5) {
    return res.status(422).json({
      status: false,
      message: 'O número máximo de sessões foi atingido'
    });
  }

  createSession(id, description, webhooks);

  return res.status(200).json({
    status: true,
    message: 'Sessão criada com sucesso'
  });
});

// DELETAR SESSÃO
app.delete('/delete-session/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;

  const sessionIndex = sessions.findIndex(sess => sess.id === sessionId);

  if (sessionIndex === -1) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada',
    });
  }

  const deletedSession = sessions.splice(sessionIndex, 1)[0];

  const savedSessions = getSessionsFile();
  const savedSessionIndex = savedSessions.findIndex(sess => sess.id === sessionId);
  savedSessions.splice(savedSessionIndex, 1);
  setSessionsFile(savedSessions);

  deletedSession.client.destroy();

  io.emit('remove-session', sessionId);

  return res.status(200).json({
    status: true,
    message: 'Sessão excluída com sucesso',
  });
});

// LISTAR SESSÕES
app.get('/sessions', (req, res) => {
  return res.status(200).json({
    status: true,
    sessions: sessions.map(sess => ({
      id: sess.id,
      description: sess.description,
      ready: sess.client.isReady,
    })),
  });
});

// ENVIAR MENSAGEM
app.post('/send-message', (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const session = sessions.find(sess => sess.id === sender);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada',
    });
  }

  session.client.sendMessage(number, message).then(response => {
    return res.status(200).json({
      status: true,
      response: response,
    });
  }).catch(err => {
    return res.status(500).json({
      status: false,
      message: err,
    });
  });
});

// ENVIAR MÍDIA
app.post('/send-media', (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;

  const file = req.files.file;

  const session = sessions.find(sess => sess.id === sender);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada',
    });
  }

  const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);

  session.client.sendMessage(number, media, { caption: caption }).then(response => {
    return res.status(200).json({
      status: true,
      response: response,
    });
  }).catch(err => {
    return res.status(500).json({
      status: false,
      message: err,
    });
  });
});

// ENVIAR CONTATO
app.post('/send-contact', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const contactId = req.body.contactId;

  const session = sessions.find(sess => sess.id === sender);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada',
    });
  }

  const contact = await session.client.getContactById(contactId);

  session.client.sendMessage(number, contact.vcard).then(response => {
    return res.status(200).json({
      status: true,
      response: response,
    });
  }).catch(err => {
    return res.status(500).json({
      status: false,
      message: err,
    });
  });
});

// ENVIAR LOCALIZAÇÃO
app.post('/send-location', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const lat = req.body.lat;
  const long = req.body.long;
  const name = req.body.name;

  const session = sessions.find(sess => sess.id === sender);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada',
    });
  }

  const location = new Location(lat, long, name);

  session.client.sendMessage(number, location).then(response => {
    return res.status(200).json({
      status: true,
      response: response,
    });
  }).catch(err => {
    return res.status(500).json({
      status: false,
      message: err,
    });
  });
});

// ENVIAR ARQUIVO
app.post('/send-file', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);

  const file = req.files.file;

  const session = sessions.find(sess => sess.id === sender);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada',
    });
  }

  const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);

  session.client.sendFile(number, media).then(response => {
    return res.status(200).json({
      status: true,
      response: response,
    });
  }).catch(err => {
    return res.status(500).json({
      status: false,
      message: err,
    });
  });
});

// OBTER INFORMAÇÕES DO CONTATO
app.get('/get-contact/:number', async (req, res) => {
  const sender = req.query.sender;
  const number = phoneNumberFormatter(req.params.number);

  const session = sessions.find(sess => sess.id === sender);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada',
    });
  }

  const contact = await session.client.getNumberProfile(number);

  return res.status(200).json({
    status: true,
    contact: contact,
  });
});

server.listen(port, function () {
  console.log('App rodando na porta *:' + port);
});
