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

// Rota para obter o status e o QR code de uma sessão específica
app.get('/sessions/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessions.find(sess => sess.id === sessionId);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }

  const client = session.client;

  const sessionStatus = {
    id: session.id,
    description: session.description,
    ready: session.ready
  };

  if (client.qrCode) {
    // Gera o QR code usando o conteúdo fornecido pelo cliente
    qrcode.toDataURL(client.qrCode, (err, qrCodeData) => {
      if (err) {
        console.error('Erro ao gerar o QR code:', err);
        return res.status(500).json({
          status: false,
          message: 'Erro ao gerar o QR code.'
        });
      }

      sessionStatus.qrCode = qrCodeData;
      res.status(200).json({
        status: true,
        session: sessionStatus
      });
    });
  } else {
    res.status(200).json({
      status: true,
      session: sessionStatus
    });
  }
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

const createSession = function(id, description, webhookUrls) {
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
        '--disable-gpu'
      ],
      ignoreDefaultArgs: ['--disable-extensions'],
    },
    session: id ? id : undefined
  });

  client.initialize();

  client.on('qr', qr => {
    console.log('QR code recebido', qr);
    io.emit('qrCode', {
      sessionId: id,
      qrCode: qr
    });
  });

  client.on('authenticated', session => {
    console.log('Autenticado na sessão: ' + session);
    io.emit('authenticated', {
      sessionId: id,
      session: session
    });
    clientName = session;
    sessionCfg = session;
  });

  client.on('auth_failure', msg => {
    console.error('Falha na autenticação: ', msg);
    io.emit('authFailure', {
      sessionId: id,
      message: msg
    });
  });

  client.on('ready', () => {
    console.log('Cliente pronto!');
    io.emit('ready', {
      sessionId: id
    });
    const savedSessions = getSessionsFile();

    const sessionIndex = savedSessions.findIndex(sess => sess.id === id);
    if (sessionIndex === -1) {
      savedSessions.push({
        id: id,
        description: description,
        ready: true,
        webhookUrls: webhookUrls
      });
    } else {
      savedSessions[sessionIndex].ready = true;
      savedSessions[sessionIndex].webhookUrls = webhookUrls;
    }

    setSessionsFile(savedSessions);
  });

  client.on('message', async msg => {
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id === id);
    if (sessionIndex !== -1 && savedSessions[sessionIndex].webhookUrls) {
      const webhookUrls = savedSessions[sessionIndex].webhookUrls;
      for (const webhookUrl of webhookUrls) {
        try {
          await axios.post(webhookUrl, msg);
          console.log('Mensagem enviada para o webhook:', webhookUrl);
        } catch (error) {
          console.error('Erro ao enviar mensagem para o webhook:', webhookUrl, error);
        }
      }
    }
  });

  return {
    id: id,
    description: description,
    ready: false,
    client: client
  };
}

// Carrega as sessões salvas no arquivo
const savedSessions = getSessionsFile();
if (savedSessions.length) {
  for (const sess of savedSessions) {
    const session = createSession(sess.id, sess.description, sess.webhookUrls);
    session.ready = sess.ready;
    sessions.push(session);
  }
}

app.post('/sessions', (req, res) => {
  const {
    id,
    description,
    webhookUrls
  } = req.body;

  const session = createSession(id, description, webhookUrls);
  sessions.push(session);

  res.json({
    status: true,
    message: 'Sessão criada com sucesso.'
  });
});

app.delete('/sessions/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const sessionIndex = sessions.findIndex(sess => sess.id === sessionId);

  if (sessionIndex !== -1) {
    const session = sessions[sessionIndex];
    session.client.destroy();
    sessions.splice(sessionIndex, 1);

    const savedSessions = getSessionsFile();
    const savedSessionIndex = savedSessions.findIndex(sess => sess.id === sessionId);
    if (savedSessionIndex !== -1) {
      savedSessions.splice(savedSessionIndex, 1);
      setSessionsFile(savedSessions);
    }

    res.json({
      status: true,
      message: 'Sessão encerrada com sucesso.'
    });
  } else {
    res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }
});

app.post('/send-message', async (req, res) => {
  const {
    sessionId,
    number,
    message
  } = req.body;

  const sessionIndex = sessions.findIndex(sess => sess.id === sessionId);

  if (sessionIndex !== -1) {
    const session = sessions[sessionIndex];
    const client = session.client;

    const numberFormatted = phoneNumberFormatter(number);
    const messageToSend = message;

    try {
      await client.sendMessage(numberFormatted, messageToSend);

      res.json({
        status: true,
        message: 'Mensagem enviada com sucesso.'
      });
    } catch (error) {
      res.status(500).json({
        status: false,
        message: 'Erro ao enviar mensagem: ' + error
      });
    }
  } else {
    res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }
});

io.on('connection', function(socket) {
  socket.on('newSession', function(session) {
    const newSession = createSession(session.id, session.description, session.webhookUrls);
    sessions.push(newSession);
  });
});

server.listen(port, function() {
  console.log('App listening on *:' + port);
});
