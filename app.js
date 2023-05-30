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

const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Arquivo de sessões criado com sucesso.');
    } catch (err) {
      console.log('Falha ao criar o arquivo de sessões: ', err);
    }
  }
};

createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
};

const getSessionsFile = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
};

class Session {
  constructor(id, description) {
    this.id = id;
    this.description = description;
    this.ready = false;
    this.client = null;
    this.webhooks = [];
  }

  setReady(ready) {
    this.ready = ready;
  }

  addWebhook(webhook) {
    this.webhooks.push(webhook);
  }

  removeWebhook(webhook) {
    const index = this.webhooks.indexOf(webhook);
    if (index !== -1) {
      this.webhooks.splice(index, 1);
    }
  }
}

const sessions = [];

const createSession = function(id, description, webhooks) {
  console.log('Criando sessão: ' + id);
  const session = new Session(id, description);
  webhooks.forEach(webhook => {
    session.addWebhook(webhook);
  });

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
    console.log('QR RECEBIDO', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code recebido, por favor, escaneie!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'WhatsApp está pronto!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id === id);
    savedSessions[sessionIndex].setReady(true);
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'WhatsApp está autenticado!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Falha na autenticação, reiniciando...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'WhatsApp está desconectado!' });
    client.destroy();
    client.initialize();

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id === id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  session.client = client;
  sessions.push(session);

  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id === id);

  if (sessionIndex === -1) {
    savedSessions.push(session);
    setSessionsFile(savedSessions);
  }
};

const init = function(socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      savedSessions.forEach((sess) => {
        sess.setReady(false);
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach((sess) => {
        createSession(sess.id, sess.description, sess.webhooks);
      });
    }
  }
};

init();

io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Criar sessão: ' + data.id);
    createSession(data.id, data.description, data.webhooks);
  });
});

server.listen(port, function() {
  console.log('Aplicação rodando em *: ' + port);
});
