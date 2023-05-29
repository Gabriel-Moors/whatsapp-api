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
 * BASEADO EM MUITAS PERGUNTAS
 * Mencionado nos tutoriais
 *
 * Os dois middlewares acima lidam apenas com dados json e urlencode (x-www-form-urlencoded)
 * Portanto, precisamos adicionar um middleware adicional para lidar com form-data
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

const createSession = function(id, description) {
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
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code recebido, escaneie por favor!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'O WhatsApp está pronto!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Autenticação realizada com sucesso!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].authenticated = true;
    setSessionsFile(savedSessions);
  });

  client.on('auth_failure', function(session) {
    io.emit('message', { id: id, text: 'Falha na autenticação, tente novamente!' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'WhatsApp desconectado!' });
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    if (sessionIndex != -1) {
      savedSessions[sessionIndex].ready = false;
      savedSessions[sessionIndex].authenticated = false;
      setSessionsFile(savedSessions);
    }
    client.destroy();
    client.initialize();
  });

  client.on('message', async(msg) => {
    if (msg.body == '!ping') {
      msg.reply('pong');
    } else if (msg.body == '!chucknorris') {
      const chuck = await axios.get('https://api.chucknorris.io/jokes/random');
      msg.reply(chuck.data.value);
    }
  });

  sessions.push({
    id: id,
    description: description,
    client: client
  });

  setSessionsFile(sessions);
}

const init = function() {
  const savedSessions = getSessionsFile();
  if (savedSessions.length > 0) {
    savedSessions.forEach(sess => {
      createSession(sess.id, sess.description);
    });
  }
}

init();

app.post('/create-session', (req, res) => {
  const {
    id,
    description
  } = req.body;

  const sessionIndex = sessions.findIndex(sess => sess.id == id);

  if (sessionIndex === -1) {
    createSession(id, description);
    res.json({
      status: 'success',
      message: 'Sessão criada com sucesso!'
    });
  } else {
    res.json({
      status: 'failed',
      message: 'Já existe uma sessão com o ID fornecido.'
    });
  }
});

app.post('/send-message', (req, res) => {
  const {
    id,
    number,
    message
  } = req.body;

  const sessionIndex = sessions.findIndex(sess => sess.id == id);

  if (sessionIndex != -1) {
    const client = sessions[sessionIndex].client;
    const numberFormatted = phoneNumberFormatter(number);
    const messageToSend = message;

    client.sendMessage(numberFormatted, messageToSend).then(response => {
      res.json({
        status: 'success',
        response: response
      });
    }).catch(err => {
      res.json({
        status: 'error',
        response: err
      });
    });
  } else {
    res.json({
      status: 'failed',
      message: 'Não foi encontrada uma sessão com o ID fornecido.'
    });
  }
});

app.post('/send-media', (req, res) => {
  const {
    id,
    number
  } = req.body;

  const sessionIndex = sessions.findIndex(sess => sess.id == id);

  if (sessionIndex != -1) {
    const client = sessions[sessionIndex].client;
    const numberFormatted = phoneNumberFormatter(number);
    const caption = req.body.caption;
    let mediaPath;

    if (req.files && req.files.media) {
      const media = req.files.media;
      mediaPath = `media/${Date.now()}_${media.name}`;

      media.mv(mediaPath, (err) => {
        if (err) {
          console.log(err);
          return res.json({
            status: 'error',
            response: err
          });
        }

        const mediaToSend = MessageMedia.fromFilePath(mediaPath);

        client.sendMessage(numberFormatted, mediaToSend, {
          caption: caption || ''
        }).then(response => {
          res.json({
            status: 'success',
            response: response
          });
        }).catch(err => {
          res.json({
            status: 'error',
            response: err
          });
        });
      });
    } else {
      return res.json({
        status: 'failed',
        message: 'Nenhum arquivo de mídia recebido.'
      });
    }
  } else {
    res.json({
      status: 'failed',
      message: 'Não foi encontrada uma sessão com o ID fornecido.'
    });
  }
});

server.listen(port, function() {
  console.log('App iniciado na porta', port);
});
