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
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 * 
 * The two middlewares above only handle for data json & urlencode (x-www-form-urlencoded)
 * So, we need to add extra middleware to handle form-data
 * Here we can use express-fileupload
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
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
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

const createSession = function(id, description) {
  console.log('Creating session: ' + id);
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
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    })
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
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
      /**
       * At the first time of running (e.g. restarting the server), our client is not ready yet!
       * It will need several time to authenticating.
       * 
       * So to make people not confused for the 'ready' status
       * We need to make it as FALSE for this condition
       */
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

  socket.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });
});

// Rota para enviar mensagem
app.post('/send-message', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = sessions.find(sess => sess.id == sender)?.client;

  // Verifique se o remetente existe e está pronto
  if (!client) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  /**
   * Verifique se o número está registrado
   * Copiado de app.js
   * 
   * Por favor, verifique app.js para mais exemplos de validações
   * Você pode adicionar as mesmas aqui!
   */
  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'The number is not registered'
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

// Rota para criar uma nova sessão
app.post('/create-session', (req, res) => {
  const id = req.body.id;
  const description = req.body.description;

  // Verifique se o ID e a descrição são fornecidos
  if (!id || !description) {
    return res.status(400).json({
      status: false,
      message: 'ID and description are required!'
    });
  }

  // Crie uma nova sessão
  createSession(id, description);

  res.status(200).json({
    status: true,
    message: 'Session created successfully'
  });
});

// Rota para buscar o estado da sessão
app.get('/session/:id', (req, res) => {
  const id = req.params.id;
  const session = sessions.find(sess => sess.id == id);

  if (session) {
    return res.status(200).json({
      status: true,
      session: session
    });
  } else {
    return res.status(404).json({
      status: false,
      message: 'Session not found'
    });
  }
});

// Rota para enviar arquivo de mídia
app.post('/send-media', async (req, res) => {
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;

  if (req.files && req.files.media) {
    const media = req.files.media;

    const client = sessions.find(sess => sess.id == sender)?.client;

    // Verifique se o remetente existe e está pronto
    if (!client) {
      return res.status(422).json({
        status: false,
        message: `The sender: ${sender} is not found!`
      })
    }

    /**
     * Verifique se o número está registrado
     * Copiado de app.js
     * 
     * Por favor, verifique app.js para mais exemplos de validações
     * Você pode adicionar as mesmas aqui!
     */
    const isRegisteredNumber = await client.isRegisteredUser(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }

    const mediaPath = './temp/' + media.name;

    media.mv(mediaPath, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({
          status: false,
          message: 'Failed to upload media'
        });
      }

      const mediaCaption = caption ? caption : '';

      const mediaMessage = new MessageMedia(media.mimetype, fs.readFileSync(mediaPath), media.name);

      client.sendMessage(number, mediaMessage, { caption: mediaCaption }).then(response => {
        fs.unlinkSync(mediaPath); // Remover arquivo de mídia após o envio

        res.status(200).json({
          status: true,
          response: response
        });
      }).catch(err => {
        fs.unlinkSync(mediaPath); // Remover arquivo de mídia em caso de erro

        res.status(500).json({
          status: false,
          response: err
        });
      });
    });
  } else {
    return res.status(400).json({
      status: false,
      message: 'Media file is required'
    });
  }
});

// Rota para buscar informações do usuário
app.get('/user/:id', async (req, res) => {
  const id = req.params.id;
  const session = sessions.find(sess => sess.id == id);

  if (session) {
    const client = session.client;
    const user = await client.getNumberProfile(session.client.info.me.user);

    if (user) {
      return res.status(200).json({
        status: true,
        user: user
      });
    } else {
      return res.status(404).json({
        status: false,
        message: 'User not found'
      });
    }
  } else {
    return res.status(404).json({
      status: false,
      message: 'Session not found'
    });
  }
});

// Rota para buscar conversas
app.get('/chats/:id', async (req, res) => {
  const id = req.params.id;
  const session = sessions.find(sess => sess.id == id);

  if (session) {
    const client = session.client;
    const chats = await client.getChats();

    return res.status(200).json({
      status: true,
      chats: chats
    });
  } else {
    return res.status(404).json({
      status: false,
      message: 'Session not found'
    });
  }
});

// Rota para buscar mensagens de uma conversa
app.get('/messages/:id/:chatId', async (req, res) => {
  const id = req.params.id;
  const chatId = req.params.chatId;
  const session = sessions.find(sess => sess.id == id);

  if (session) {
    const client = session.client;
    const messages = await client.getChatMessages(chatId);

    return res.status(200).json({
      status: true,
      messages: messages
    });
  } else {
    return res.status(404).json({
      status: false,
      message: 'Session not found'
    });
  }
});

// Rota para atualizar informações do usuário
app.put('/user/:id', async (req, res) => {
  const id = req.params.id;
  const name = req.body.name;
  const status = req.body.status;
  const session = sessions.find(sess => sess.id == id);

  if (session) {
    const client = session.client;

    await client.updateProfile({
      name: name,
      status: status
    });

    return res.status(200).json({
      status: true,
      message: 'User updated successfully'
    });
  } else {
    return res.status(404).json({
      status: false,
      message: 'Session not found'
    });
  }
});

// Rota para atualizar o status de "visto por último" do usuário
app.put('/seen/:id/:chatId', async (req, res) => {
  const id = req.params.id;
  const chatId = req.params.chatId;
  const session = sessions.find(sess => sess.id == id);

  if (session) {
    const client = session.client;

    await client.sendSeen(chatId);

    return res.status(200).json({
      status: true,
      message: 'Seen status updated successfully'
    });
  } else {
    return res.status(404).json({
      status: false,
      message: 'Session not found'
    });
  }
});

// Rota para desconectar a sessão
app.delete('/session/:id', (req, res) => {
  const id = req.params.id;
  const sessionIndex = sessions.findIndex(sess => sess.id == id);

  if (sessionIndex != -1) {
    const session = sessions[sessionIndex];
    session.client.destroy();
    sessions.splice(sessionIndex, 1);

    // Remove session from sessions file
    const savedSessions = getSessionsFile();
    const sessionFileIndex = savedSessions.findIndex(sess => sess.id == id);

    if (sessionFileIndex != -1) {
      savedSessions.splice(sessionFileIndex, 1);
      setSessionsFile(savedSessions);
    }

    return res.status(200).json({
      status: true,
      message: 'Session disconnected'
    });
  } else {
    return res.status(404).json({
      status: false,
      message: 'Session not found'
    });
  }
});

server.listen(port, function() {
  console.log('App running on *: ' + port);
});
