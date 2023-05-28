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
 * Já mencionado nos tutoriais
 * 
 * Os dois middlewares acima lidam apenas com dados JSON e urlencode (x-www-form-urlencoded)
 * Portanto, precisamos adicionar um middleware extra para lidar com form-data
 * Aqui usamos o express-fileupload
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

const criarArquivoDeSessoesSeNaoExistir = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Arquivo de sessões criado com sucesso.');
    } catch(err) {
      console.log('Falha ao criar o arquivo de sessões: ', err);
    }
  }
}

criarArquivoDeSessoesSeNaoExistir();

const definirArquivoDeSessoes = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const obterArquivoDeSessoes = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const criarSessao = function(id, descricao) {
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
        '--single-process', // <- esse não funciona no Windows
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
      io.emit('message', { id: id, text: 'QR Code recebido, por favor, faça a leitura!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'O WhatsApp está pronto!' });

    const sessoesSalvas = obterArquivoDeSessoes();
    const indiceSessao = sessoesSalvas.findIndex(sess => sess.id == id);
    sessoesSalvas[indiceSessao].ready = true;
    definirArquivoDeSessoes(sessoesSalvas);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'O WhatsApp está autenticado!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Falha na autenticação, reiniciando...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'O WhatsApp está desconectado!' });
    client.destroy();
    client.initialize();

    // Remover da lista de sessões
    const sessoesSalvas = obterArquivoDeSessoes();
    const indiceSessao = sessoesSalvas.findIndex(sess => sess.id == id);
    sessoesSalvas.splice(indiceSessao, 1);
    definirArquivoDeSessoes(sessoesSalvas);

    io.emit('remove-session', id);
  });

  // Adicionar cliente às sessões
  sessions.push({
    id: id,
    descricao: descricao,
    cliente: client
  });

  // Adicionar sessão ao arquivo
  const sessoesSalvas = obterArquivoDeSessoes();
  const indiceSessao = sessoesSalvas.findIndex(sess => sess.id == id);

  if (indiceSessao == -1) {
    sessoesSalvas.push({
      id: id,
      descricao: descricao,
      ready: false,
    });
    definirArquivoDeSessoes(sessoesSalvas);
  }
}

const inicializar = function(socket) {
  const sessoesSalvas = obterArquivoDeSessoes();

  if (sessoesSalvas.length > 0) {
    if (socket) {
      /**
       * Na primeira vez que é executado (por exemplo, reiniciando o servidor), nosso cliente ainda não está pronto!
       * Será necessário algum tempo para autenticação.
       * 
       * Portanto, para evitar confusões com o status 'ready'
       * Precisamos definir como FALSE para esta condição
       */
      sessoesSalvas.forEach((e, i, arr) => {
        arr[i].ready = false;
      });

      socket.emit('init', sessoesSalvas);
    } else {
      sessoesSalvas.forEach(sess => {
        criarSessao(sess.id, sess.descricao);
      });
    }
  }
}

inicializar();

// Socket IO
io.on('connection', function(socket) {
  inicializar(socket);

  socket.on('create-session', function(data) {
    console.log('Criar sessão: ' + data.id);
    criarSessao(data.id, data.descricao);
  });
});

// Enviar mensagem
app.post('/send-message', async (req, res) => {
  console.log(req);

  const remetente = req.body.remetente;
  const numero = phoneNumberFormatter(req.body.numero);
  const mensagem = req.body.mensagem;

  const cliente = sessions.find(sess => sess.id == remetente)?.cliente;

  // Certificar-se de que o remetente exista e esteja pronto
  if (!cliente) {
    return res.status(422).json({
      status: false,
      message: `O remetente: ${remetente} não foi encontrado!`
    })
  }

  /**
   * Verificar se o número já está registrado
   * Copiado de app.js
   * 
   * Por favor, verifique app.js para mais exemplos de validações
   * Você pode adicionar as mesmas aqui!
   */
  const numeroRegistrado = await cliente.isRegisteredUser(numero);

  if (!numeroRegistrado) {
    return res.status(422).json({
      status: false,
      message: 'O número não está registrado'
    });
  }

  cliente.sendMessage(numero, mensagem).then(response => {
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
  console.log('Aplicativo em execução em *: ' + port);
});
