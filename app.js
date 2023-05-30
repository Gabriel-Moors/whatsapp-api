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
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ debug: false }));

// Rota inicial
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: __dirname });
});

const SESSIONS_FILE = './whatsapp-sessions.json';
let sessions = [];

// Verifica se o arquivo de sessões existe, caso contrário, cria um novo
const createSessionsFileIfNotExists = () => {
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

// Salva as sessões no arquivo
const setSessionsFile = (sessions) => {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), (err) => {
    if (err) {
      console.log(err);
    }
  });
};

// Retorna as sessões do arquivo
const getSessionsFile = () => {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
};

// Cria uma nova sessão
const createSession = (id, description, webhooks) => {
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
        '--single-process',
        '--disable-gpu'
      ],
    },
    session: id,
    authSessions: SESSIONS_FILE,
    qrTimeoutMs: 0,
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEBIDO', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code recebido, por favor, faça a leitura!' });
    });
  });

  client.on('authenticated', (session) => {
    console.log('Autenticado com sucesso');
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id === id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('auth_failure', (session) => {
    console.log('Falha na autenticação do WhatsApp');
    io.emit('message', { id: id, text: 'Falha na autenticação do WhatsApp, verifique o código QR e tente novamente.' });
  });

  client.on('disconnected', (reason) => {
    console.log('WhatsApp desconectado: ' + reason);
    io.emit('message', { id: id, text: 'WhatsApp está desconectado!' });
    client.destroy();
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id === id);
    if (sessionIndex !== -1) {
      savedSessions.splice(sessionIndex, 1);
      setSessionsFile(savedSessions);
      io.emit('remove-session', id);
    }
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

// Inicializa as sessões salvas
const init = (socket) => {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    }
  }
};

// Inicializa o socket
io.on('connection', (socket) => {
  init(socket);

  socket.on('create-session', (data) => {
    console.log('Criando sessão: ' + data.id);
    createSession(data.id, data.description, data.webhooks);
  });
});

// Rota para envio de mensagens
app.post('/send-message', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const session = sessions.find(sess => sess.id === sender);
  const client = session ? session.client : null;

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
      message: 'O número não está registrado'
    });
  }

  client.sendMessage(number, message)
    .then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    })
    .catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
});

// Rota para criar uma nova sessão
app.post('/create-session', (req, res) => {
  const id = req.body.id;
  const description = req.body.description;
  const webhooks = req.body.webhooks;

  if (!id || !description || !webhooks || webhooks.length !== 4) {
    return res.status(422).json({
      status: false,
      message: 'Os dados da sessão são inválidos ou estão faltando.'
    });
  }

  createSession(id, description, webhooks);

  return res.status(200).json({
    status: true,
    message: 'Sessão criada com sucesso.'
  });
});

// Rota para deletar uma sessão
app.delete('/delete-session/:id', (req, res) => {
  const id = req.params.id;

  const sessionIndex = sessions.findIndex(sess => sess.id === id);
  if (sessionIndex === -1) {
    return res.status(422).json({
      status: false,
      message: 'A sessão não existe.'
    });
  }

  sessions.splice(sessionIndex, 1);

  const savedSessions = getSessionsFile();
  const savedSessionIndex = savedSessions.findIndex(sess => sess.id === id);
  savedSessions.splice(savedSessionIndex, 1);
  setSessionsFile(savedSessions);

  return res.status(200).json({
    status: true,
    message: 'Sessão deletada com sucesso.'
  });
});

// Rota para enviar arquivo de mídia
app.post('/send-media', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  const session = sessions.find(sess => sess.id === sender);
  const client = session ? session.client : null;

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
      message: 'O número não está registrado'
    });
  }

  const media = new MessageMedia(fileUrl);

  client.sendMessage(number, media, { caption: caption })
    .then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    })
    .catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
});

// Rota para obter informações de uma sessão
app.get('/session/:id', (req, res) => {
  const id = req.params.id;

  const session = sessions.find(sess => sess.id === id);

  if (!session) {
    return res.status(422).json({
      status: false,
      message: 'A sessão não existe.'
    });
  }

  return res.status(200).json({
    status: true,
    session: {
      id: session.id,
      description: session.description,
      ready: session.client?.isConnected() || false,
      webhooks: session.webhooks
    }
  });
});

// Rota para obter todas as sessões
app.get('/sessions', (req, res) => {
  const savedSessions = getSessionsFile();

  return res.status(200).json({
    status: true,
    sessions: savedSessions.map(session => ({
      id: session.id,
      description: session.description,
      ready: sessions.find(sess => sess.id === session.id)?.client?.isConnected() || false,
      webhooks: session.webhooks
    }))
  });
});

// Inicia o servidor
server.listen(port, function () {
  console.log('App está executando na porta ' + port);
});
