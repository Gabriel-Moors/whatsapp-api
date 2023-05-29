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

/**
 * BASEADO EM VÁRIAS PERGUNTAS
 * Mencionado nos tutoriais disponíveis
 *
 * Os dois middlewares acima lidam apenas com dados JSON e urlencode (x-www-form-urlencoded)
 * Portanto, precisamos adicionar um middleware extra para lidar com form-data
 * Aqui podemos usar o express-fileupload
 */
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
      webhookUrl: webhookUrl // Define a URL do webhook na sessão
    }
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEBIDO', qr);
    const qrCode = 'data:image/png;base64,' + qr;
    const sessionIndex = sessions.findIndex(sess => sess.id === id);
    sessions[sessionIndex].qrCode = qrCode;
    io.emit('qr', { id: id, src: qrCode });
    io.emit('message', { id: id, text: 'QR Code recebido, por favor escaneie!' });
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

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Falha na autenticação! Reiniciando...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'WhatsApp desconectado!' });
    client.destroy();
    client.initialize();

    // Removendo do arquivo de sessões
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  // Adicione o cliente às sessões
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Adicionando a sessão no arquivo
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
      webhookUrl: webhookUrl // Adiciona a URL do webhook na sessão
    });
    setSessionsFile(savedSessions);
  }
}

const init = function(socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      /**
       * Na primeira vez que é executado (por exemplo, ao reiniciar o servidor), nosso cliente ainda não está pronto!
       * Ele precisará de algum tempo para autenticação.
       * 
       * Portanto, para evitar confusão com o status 'pronto',
       * precisamos definir como FALSO para essa condição.
       */
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description, sess.webhookUrl);
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
    createSession(data.id, data.description, data.webhookUrl);
  });
});

// Rota de Criação de Sessão
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

// Rota de Enviar Mensagem de Texto
app.post('/send-message', async (req, res) => {
  console.log(req);

  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = sessions.find(sess => sess.id == sender)?.client;

  if (!client) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }

  try {
    await client.sendMessage(number, message);

    return res.status(200).json({
      status: true,
      message: 'Mensagem enviada com sucesso.'
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: 'Erro ao enviar a mensagem: ' + error
    });
  }
});

// Rota de Envio de Mídia
app.post('/send-media', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;

  const client = sessions.find(sess => sess.id == sender)?.client;

  if (!client) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }

  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({
      status: false,
      message: 'Nenhum arquivo foi enviado.'
    });
  }

  try {
    const media = new MessageMedia(
      req.files.file.mimetype,
      req.files.file.data.toString('base64'),
      req.files.file.name
    );

    if (caption) {
      await client.sendMessage(number, media, { caption: caption });
    } else {
      await client.sendMessage(number, media);
    }

    return res.status(200).json({
      status: true,
      message: 'Mídia enviada com sucesso.'
    });
  } catch (error) {
    return res.status(500).json({
      status: false,
      message: 'Erro ao enviar a mídia: ' + error
    });
  }
});

// Rota de Geração de QR Code
app.get('/qr-code/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessions.find(sess => sess.id == sessionId);

  if (!session) {
    return res.status(404).json({
      status: false,
      message: 'Sessão não encontrada.'
    });
  }

  if (!session.qrCode) {
    return res.status(404).json({
      status: false,
      message: 'QR code não encontrado para esta sessão.'
    });
  }

  res.send(session.qrCode);
});

server.listen(port, function() {
  console.log('App ouvindo na porta ' + port);
});
