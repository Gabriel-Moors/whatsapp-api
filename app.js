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

const porta = process.env.PORT || 80;

const app = express();
const servidor = http.createServer(app);
const io = socketIO(servidor);

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

/**
 * BASEADO EM MUITAS PERGUNTAS
 * Mencionado nos tutoriais
 * 
 * Muitas pessoas confundem o aviso para o upload de arquivos
 * Portanto, estamos desativando o modo de depuração para simplificar.
 */
app.use(fileUpload({
  debug: false
}));

app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: __dirname
  });
});

const cliente = new Client({
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
      '--single-process', // <- essa opção não funciona no Windows
      '--disable-gpu'
    ],
  },
  authStrategy: new LocalAuth()
});

cliente.on('message', msg => {
  if (msg.body == '!ping') {
    msg.reply('pong');
  } else if (msg.body == 'bom dia') {
    msg.reply('bom dia');
  } else if (msg.body == '!grupos') {
    cliente.getChats().then(chats => {
      const grupos = chats.filter(chat => chat.isGroup);

      if (grupos.length == 0) {
        msg.reply('Você não possui nenhum grupo ainda.');
      } else {
        let respostaMsg = '*SEUS GRUPOS*\n\n';
        grupos.forEach((grupo, i) => {
          respostaMsg += `ID: ${grupo.id._serialized}\nNome: ${grupo.name}\n\n`;
        });
        respostaMsg += '_Você pode usar o ID do grupo para enviar uma mensagem para o grupo._';
        msg.reply(respostaMsg);
      }
    });
  }

  // OBSERVAÇÃO!
  // DESCOMENTE O TRECHO ABAIXO SE DESEJAR SALVAR OS ARQUIVOS DE MÍDIA RECEBIDOS
  // Baixando a mídia
  // if (msg.hasMedia) {
  //   msg.downloadMedia().then(media => {
  //     // Para entender melhor
  //     // Por favor, veja no console os dados que obtemos
  //     console.log(media);

  //     if (media) {
  //       // A pasta para armazenar: altere conforme desejado!
  //       // Crie se não existir
  //       const caminhoMídia = './media-baixada/';

  //       if (!fs.existsSync(caminhoMídia)) {
  //         fs.mkdirSync(caminhoMídia);
  //       }

  //       // Salvando arquivo de mídia
  //       const nomeArquivo = `${caminhoMídia}${media.filename}`;
  //       media.save(nomeArquivo).then(() => {
  //         console.log(`Arquivo de mídia salvo: ${nomeArquivo}`);
  //       });
  //     }
  //   });
  // }
});

cliente.initialize();

// Configuração do Socket.IO
io.on('connection', socket => {
  socket.emit('message', 'Conexão estabelecida com o servidor.');

  cliente.on('qr', qr => {
    console.log('QR Code gerado!');
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit('qr', url);
      socket.emit('message', 'Leia o código QR com o seu aplicativo WhatsApp.');
    });
  });

  cliente.on('ready', () => {
    socket.emit('ready', 'Cliente está pronto!');
    socket.emit('message', 'O WhatsApp está pronto para ser usado!');
  });

  cliente.on('authenticated', session => {
    socket.emit('authenticated', 'Cliente autenticado!');
    socket.emit('message', 'Cliente autenticado!');
    console.log('Autenticado');

    // Salvando a sessão para posterior recuperação
    fs.writeFile('./session.json', JSON.stringify(session), function (err) {
      if (err) {
        socket.emit('message', 'Erro ao salvar a sessão.');
        console.log(err);
      }
    });
  });

  cliente.on('auth_failure', msg => {
    socket.emit('message', 'Falha na autenticação, reiniciando...');
  });

  cliente.on('disconnected', reason => {
    socket.emit('message', 'Cliente desconectado!');
    fs.unlink('./session.json', function (err) {
      if (err) return console.log(err);
      console.log('Sessão excluída.');
    });
    cliente.destroy();
    cliente.initialize();
  });
});

// Carregando a sessão
fs.existsSync('./session.json') && cliente.useAuthInfo(fs.readFileSync('./session.json', 'utf-8'));

/**
 * FUNÇÕES AUXILIARES
 */

// Verificando se o número de telefone está registrado no WhatsApp
const verificarNumeroRegistrado = async (numero) => {
  const numeroFormatado = phoneNumberFormatter(numero);
  const isRegistered = await cliente.isRegisteredUser(numeroFormatado);
  return isRegistered;
};

/**
 * ROTAS DA API
 */

// Enviar mensagem para um número de telefone
app.post(
  '/enviar-mensagem',
  [
    body('numero').notEmpty(),
    body('mensagem').notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: errors.array()[0],
      });
    }

    const { numero, mensagem } = req.body;
    const numeroFormatado = phoneNumberFormatter(numero);

    verificarNumeroRegistrado(numeroFormatado)
      .then((isRegistered) => {
        if (isRegistered) {
          cliente.sendMessage(numeroFormatado, mensagem).then((response) => {
            res.status(200).json({
              success: true,
              message: 'Mensagem enviada com sucesso!',
              response,
            });
          });
        } else {
          res.status(404).json({
            success: false,
            message: 'Número de telefone não registrado no WhatsApp!',
          });
        }
      })
      .catch((err) => {
        res.status(500).json({
          success: false,
          message: 'Erro ao enviar a mensagem!',
          error: err.message,
        });
      });
  }
);

// Enviar mensagem para um grupo
app.post(
  '/enviar-mensagem-grupo',
  [
    body('idGrupo').notEmpty(),
    body('mensagem').notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: errors.array()[0],
      });
    }

    const { idGrupo, mensagem } = req.body;

    cliente.getChatById(idGrupo)
      .then((chat) => {
        chat.sendMessage(mensagem).then((response) => {
          res.status(200).json({
            success: true,
            message: 'Mensagem enviada com sucesso!',
            response,
          });
        });
      })
      .catch((err) => {
        res.status(500).json({
          success: false,
          message: 'Erro ao enviar a mensagem!',
          error: err.message,
        });
      });
  }
);

// Enviar arquivo de mídia (imagem, vídeo, documento) para um número de telefone
app.post(
  '/enviar-media',
  [
    body('numero').notEmpty(),
    body('tipo').notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: errors.array()[0],
      });
    }

    const { numero, tipo } = req.body;
    const numeroFormatado = phoneNumberFormatter(numero);
    const mediaFile = req.files.media;
    const mimeType = mediaFile.mimetype;
    const mediaData = {
      mimetype: mimeType,
      data: mediaFile.data,
    };

    verificarNumeroRegistrado(numeroFormatado)
      .then((isRegistered) => {
        if (isRegistered) {
          const media = new MessageMedia(mimeType, mediaData);
          cliente.sendMessage(numeroFormatado, media).then((response) => {
            res.status(200).json({
              success: true,
              message: 'Mídia enviada com sucesso!',
              response,
            });
          });
        } else {
          res.status(404).json({
            success: false,
            message: 'Número de telefone não registrado no WhatsApp!',
          });
        }
      })
      .catch((err) => {
        res.status(500).json({
          success: false,
          message: 'Erro ao enviar a mídia!',
          error: err.message,
        });
      });
  }
);

// Enviar arquivo de mídia (imagem, vídeo, documento) para um grupo
app.post(
  '/enviar-media-grupo',
  [
    body('idGrupo').notEmpty(),
    body('tipo').notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        message: errors.array()[0],
      });
    }

    const { idGrupo, tipo } = req.body;
    const mediaFile = req.files.media;
    const mimeType = mediaFile.mimetype;
    const mediaData = {
      mimetype: mimeType,
      data: mediaFile.data,
    };

    cliente.getChatById(idGrupo)
      .then((chat) => {
        const media = new MessageMedia(mimeType, mediaData);
        chat.sendMessage(media).then((response) => {
          res.status(200).json({
            success: true,
            message: 'Mídia enviada com sucesso!',
            response,
          });
        });
      })
      .catch((err) => {
        res.status(500).json({
          success: false,
          message: 'Erro ao enviar a mídia!',
          error: err.message,
        });
      });
  }
);

// Obter informações de um número de telefone
app.get('/numero/:numero', (req, res) => {
  const numeroFormatado = phoneNumberFormatter(req.params.numero);

  verificarNumeroRegistrado(numeroFormatado)
    .then((isRegistered) => {
      if (isRegistered) {
        const number = cliente.getNumberId(numeroFormatado);
        const profilePicUrl = cliente.getProfilePicUrl(number._serialized);
        const status = cliente.getStatus(number._serialized);

        res.status(200).json({
          success: true,
          message: 'Informações do número de telefone obtidas com sucesso!',
          data: {
            id: number._serialized,
            profilePicUrl,
            status,
          },
        });
      } else {
        res.status(404).json({
          success: false,
          message: 'Número de telefone não registrado no WhatsApp!',
        });
      }
    })
    .catch((err) => {
      res.status(500).json({
        success: false,
        message: 'Erro ao obter informações do número de telefone!',
        error: err.message,
      });
    });
});

// Obter informações de um grupo
app.get('/grupo/:idGrupo', (req, res) => {
  cliente.getChatById(req.params.idGrupo)
    .then((chat) => {
      const groupData = {
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        isReadOnly: chat.read_only,
        isAnnouncementGroup: chat.isAnnouncementGroup,
        owner: chat.owner.user,
        participants: chat.participants,
      };

      res.status(200).json({
        success: true,
        message: 'Informações do grupo obtidas com sucesso!',
        data: groupData,
      });
    })
    .catch((err) => {
      res.status(500).json({
        success: false,
        message: 'Erro ao obter informações do grupo!',
        error: err.message,
      });
    });
});

// Fazer uma chamada para uma API externa
app.post('/chamada-api', (req, res) => {
  const { url, metodo, corpo } = req.body;

  axios({
    method: metodo,
    url,
    data: corpo,
  })
    .then((response) => {
      res.status(200).json({
        success: true,
        message: 'Chamada da API realizada com sucesso!',
        data: response.data,
      });
    })
    .catch((err) => {
      res.status(500).json({
        success: false,
        message: 'Erro ao fazer a chamada da API!',
        error: err.message,
      });
    });
});

// Servir arquivos de mídia
app.get('/media/:fileName', (req, res) => {
  const fileName = req.params.fileName;
  const filePath = `./media/${fileName}`;
  const mimeType = mime.lookup(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.status(404).json({
        success: false,
        message: 'Arquivo de mídia não encontrado!',
      });
    } else {
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
      });
      res.end(data);
    }
  });
});

servidor.listen(porta, () => {
  console.log(`Servidor iniciado na porta ${porta}`);
});
