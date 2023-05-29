const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const mime = require('mime-types');

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
 * Como mencionado nos tutoriais
 * 
 * Muitas pessoas ficam confusas com o aviso de envio de arquivos
 * Então, estamos apenas desabilitando o modo de depuração para simplificar.
 */
app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: __dirname
  });
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
      '--single-process', // <- este não funciona no Windows
      '--disable-gpu'
    ],
  },
  authStrategy: new LocalAuth()
});

client.on('message', msg => {
  if (msg.body == '!ping') {
    msg.reply('pong');
  } else if (msg.body == 'bom dia') {
    msg.reply('bom dia');
  } else if (msg.body == '!grupos') {
    client.getChats().then(chats => {
      const grupos = chats.filter(chat => chat.isGroup);

      if (grupos.length == 0) {
        msg.reply('Você ainda não tem nenhum grupo.');
      } else {
        let mensagemResposta = '*SEUS GRUPOS*\n\n';
        grupos.forEach((grupo, i) => {
          mensagemResposta += `ID: ${grupo.id._serialized}\nNome: ${grupo.name}\n\n`;
        });
        mensagemResposta += '_Você pode usar o ID do grupo para enviar uma mensagem para o grupo._'
        msg.reply(mensagemResposta);
      }
    });
  }

  // OBSERVAÇÃO!
  // DESCOMENTE O TRECHO ABAIXO SE DESEJAR SALVAR OS ARQUIVOS DE MÍDIA DAS MENSAGENS
  // Baixando a mídia
  // if (msg.hasMedia) {
  //   msg.downloadMedia().then(media => {
  //     // Para melhor entendimento
  //     // Por favor, verifique o console para ver os dados que estamos recebendo
  //     console.log(media);

  //     if (media) {
  //       // Pasta para armazenar: altere como desejar!
  //       // Crie se não existir
  //       const pastaMídia = './mídias-baixadas/';

  //       if (!fs.existsSync(pastaMídia)) {
  //         fs.mkdirSync(pastaMídia);
  //       }

  //       // Obtenha a extensão do arquivo pelo tipo MIME
  //       const extensão = mime.extension(media.mimetype);
        
  //       // Nome do arquivo: altere como desejar!
  //       // Usarei o horário como exemplo
  //       // Por que não usar media.filename? Porque o valor não é garantido que exista
  //       const nomeArquivo = new Date().getTime();

  //       const nomeCompletoArquivo = pastaMídia + nomeArquivo + '.' + extensão;

  //       // Salve no arquivo
  //       try {
  //         fs.writeFileSync(nomeCompletoArquivo, media.data, { encoding: 'base64' }); 
  //         console.log('Arquivo baixado com sucesso!', nomeCompletoArquivo);
  //       } catch (err) {
  //         console.log('Falha ao salvar o arquivo:', err);
  //       }
  //     }
  //   });
  // }
});

client.initialize();

// Socket IO
io.on('connection', function(socket) {
  socket.emit('message', 'Conectando...');

  client.on('qr', (qr) => {
    console.log('QR RECEBIDO', qr);
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit('qr', url);
      socket.emit('message', 'Código QR recebido, por favor, faça a leitura!');
    });
  });

  client.on('ready', () => {
    socket.emit('ready', 'WhatsApp pronto!');
    socket.emit('message', 'WhatsApp pronto!');
  });

  client.on('authenticated', () => {
    socket.emit('authenticated', 'WhatsApp autenticado!');
    socket.emit('message', 'WhatsApp autenticado!');
    console.log('AUTENTICADO');
  });

  client.on('auth_failure', function(session) {
    socket.emit('message', 'Falha na autenticação, reiniciando...');
  });

  client.on('disconnected', (reason) => {
    socket.emit('message', 'WhatsApp desconectado!');
    client.destroy();
    client.initialize();
  });
});


const checkRegisteredNumber = async function(number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
}

// Enviar Mensagem
app.post('/send-message', [
  body('number').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const isRegisteredNumber = await checkRegisteredNumber(number);

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

// Enviar Mídia
app.post('/send-media', async (req, res) => {
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  // const media = MessageMedia.fromFilePath('./image-example.png');
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  let mimetype;
  const attachment = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  }).then(response => {
    mimetype = response.headers['content-type'];
    return response.data.toString('base64');
  });

  const media = new MessageMedia(mimetype, attachment, 'Media');

  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
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

servidor.escutar(porta, function() {
  console.log('Aplicação em execução na porta *: ' + porta);
});
