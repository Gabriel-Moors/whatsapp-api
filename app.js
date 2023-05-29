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

const createSession = function(id, description, webhooks) {
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

  client.on('qr', (qr) => {
    console.log('QR RECEBIDO', qr);
    qrcode.toDataURL(qr, (err, url) => {
      const sessionData = {
        id: id,
        description: description,
        qrCode: url // Adiciona o QR code à resposta JSON
      };
      res.json(sessionData);
    });
  });  

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp pronto!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp autenticado!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Falha na autenticação, reiniciando...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp desconectado!' });
    client.destroy();
    client.initialize();

    // Removendo do arquivo de sessões
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  // Registre os webhooks
  webhooks.forEach((url, index) => {
    client.onMessage(async (message) => {
      try {
        // Faça o post da mensagem recebida para o webhook
        await axios.post(url, message);
      } catch (error) {
        console.error('Erro ao enviar mensagem para o webhook:', error);
      }
    });
  });

  // Adicione o cliente ao arquivo de sessões
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Adicionando a sessão ao arquivo
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
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
        createSession(sess.id, sess.description, sess.webhooks);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Criar sessão: ' + data.id);
    createSession(data.id, data.description, data.webhooks);
  });
});

// Rota para criar uma sessão
app.post('/create-session', (req, res) => {
  const id = req.body.id;
  const description = req.body.description;
  const webhooks = req.body.webhooks;

  // Verifica se o ID da sessão já está em uso
  const sessionExists = sessions.some(sess => sess.id === id);
  if (sessionExists) {
    return res.status(400).json({ error: 'ID de sessão já está em uso' });
  }

  // Verifica se o número de webhooks é válido
  if (!Array.isArray(webhooks) || webhooks.length !== 4) {
    return res.status(400).json({ error: 'Número inválido de webhooks' });
  }

  // Cria a sessão
  createSession(id, description);

  // Adiciona os webhooks à sessão
  const session = sessions.find(sess => sess.id === id);
  if (session) {
    session.webhooks = webhooks;
  }

  res.json({ success: true });
});

// Rota para excluir uma sessão
app.delete('/delete-session/:id', (req, res) => {
  const sessionId = req.params.id;

  // Procurar sessão pelo ID
  const sessionIndex = sessions.findIndex(sess => sess.id === sessionId);

  // Se a sessão existir, removê-la
  if (sessionIndex !== -1) {
    const removedSession = sessions.splice(sessionIndex, 1);
    setSessionsFile(sessions);

    // Encerrar a conexão do cliente
    removedSession[0].client.destroy();

    return res.status(200).json({
      status: true,
      message: 'Sessão excluída com sucesso.',
      data: removedSession[0]
    });
  } else {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }
});

// Rota para enviar mensagem de texto
app.post('/send-message', async (req, res) => {
  console.log(req);

  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = sessions.find(sess => sess.id == sender)?.client;

  // Verifique se o remetente existe e está pronto
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
      message: 'O número não está registrado.'
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
  console.log('Aplicativo em execução na porta *: ' + port);
});
