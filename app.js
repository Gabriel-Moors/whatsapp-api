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

// Configurações do aplicativo Express
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.use(fileUpload({
  debug: false
}));

// Rota principal
app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: __dirname
  });
});

// Gerenciamento de sessões
const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Arquivo de sessões criado com sucesso.');
    } catch(err) {
      console.log('Falha ao criar o arquivo de sessões: ', err);
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

const createSession = async function(id, description) {
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
    })
  });

  client.initialize();

  const webhooks = []; // Lista de webhooks da sessão

  // Função para gerar QR code e emitir evento para os webhooks
  const generateQrCode = async (sessionId, qrData) => {
    const qrCode = await qrcode.toDataURL(qrData);
    io.to(sessionId).emit('qr', { id: sessionId, src: qrCode });
    webhooks.forEach(webhook => {
      axios.post(webhook, { qrCode: qrCode });
    });
  };

  client.on('qr', (qr) => {
    console.log('QR RECEBIDO', qr);
    generateQrCode(id, qr);
  });

  client.on('ready', () => {
    io.to(id).emit('ready', { id: id });
    io.to(id).emit('message', { id: id, text: 'O WhatsApp está pronto!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.to(id).emit('authenticated', { id: id });
    io.to(id).emit('message', { id: id, text: 'O WhatsApp foi autenticado!' });
  });

  client.on('auth_failure', function() {
    io.to(id).emit('message', { id: id, text: 'Falha na autenticação, reiniciando...' });
  });

  client.on('disconnected', (reason) => {
    io.to(id).emit('message', { id: id, text: 'O WhatsApp foi desconectado!' });
    client.destroy();
    client.initialize();

    // Remover da lista de sessões
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.to(id).emit('remove-session', id);
  });

  // Adicionar cliente às sessões
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Adicionar sessão ao arquivo
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex === -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
      webhooks: webhooks
    });
    setSessionsFile(savedSessions);
  }

  return { id: id, qrCode: await client.getQRCode() }; // Retorna o ID da sessão e o QR code
}

const init = function(socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', async function(data) {
    const { id, description, webhooks } = data;
    if (!id || !description) {
      socket.emit('create-session-error', 'ID e descrição da sessão são obrigatórios.');
      return;
    }

    if (webhooks && webhooks.length > 5) {
      socket.emit('create-session-error', 'A sessão pode ter no máximo 5 webhooks.');
      return;
    }

    const sessionExists = sessions.some(sess => sess.id === id);
    if (sessionExists) {
      socket.emit('create-session-error', 'Já existe uma sessão com o mesmo ID.');
      return;
    }

    const session = await createSession(id, description);
    if (webhooks) {
      session.webhooks = webhooks;
    }
    socket.join(id);
    socket.emit('create-session-success', session);
  });
});

// Enviar mensagem
app.post('/send-message', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = sessions.find(sess => sess.id === sender)?.client;

  // Verificar se o remetente existe e está pronto
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `O remetente: ${sender} não foi encontrado!`
    })
  }

  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'O número não está registrado'
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

server.listen(port, function() {
  console.log('Aplicativo sendo executado em *:' + port);
});
