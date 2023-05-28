const venom = require('venom-bot');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

venom.create().then((client) => {
  app.post('/sendMessage', (req, res) => {
    const { number, message } = req.body;
    client.sendText(number, message).then((result) => {
      res.json({ success: true, message: 'Message sent successfully' });
    }).catch((error) => {
      res.status(500).json({ success: false, message: 'Failed to send message', error });
    });
  });

  app.listen(80, () => {
    console.log('API running on port 80');
  });
}).catch((error) => {
  console.log('Failed to create venom client', error);
});
