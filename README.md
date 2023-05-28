# INSTALAÇÃO WHATSAPP API

Aqui está um passo a passo detalhado:

1. Conectar-se à sua instância do Lightsail AWS Debian 11.4.

2. Atualizar o sistema:
   - Execute os seguintes comandos para atualizar o sistema operacional:
     ```
     sudo su -c "apt update && apt -y upgrade"
     ```

3. Instalar o Node.js:
   - Instale o Node.js, npm, git e Chromium com o comando:
     ```
     curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs && sudo npm install -g npm@latest && sudo apt update && sudo apt install -y git && sudo apt update && sudo apt install -y chromium
     ```

4. Verificar a instalação do Node.js, npm, git e Chromium:
   - Verifique se o Node.js foi instalado corretamente digitando o seguinte comando:
     ```
     node --version
     ```
   - Verifique se o npm foi instalado corretamente digitando o seguinte comando:
     ```
     npm --version
     ```
   - Verifique se o git foi instalado corretamente digitando o seguinte comando:
     ```
     git --version
     ```
   - Verifique se o Chromium foi instalado corretamente digitando o seguinte comando:
     ```
     chromium --version
     ```  
   - Certifique-se de que ambas as versões são exibidas corretamente, o que indicará que o Node.js e o npm estão instalados com sucesso.

5. Criar um diretório para o projeto:
     ```
     git clone https://github.com/Gabriel-Moors/whatsapp-api.git && cd whatsapp-api && sudo su
     ```
     
6. Instalar as dependências:
   - Execute o seguinte comando para instalar as dependências:
     ```
     npm install puppeteer@20.4.0
     npm install --save axios express express-fileupload express-validator http mime-types qrcode socket.io whatsapp-web.js
     ```
     
7. Executar o servidor:
   - Execute o servidor Express com o seguinte comando:
     ```
     sudo node app.js
     ```
   - Para uma instalação rápida dessas 7 etapas, Execute o servidor Express com o seguinte comando:
     ```
     echo -n "sudo apt update && sudo apt upgrade -y && curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs && sudo npm install -g npm@latest && sudo apt update && sudo apt install -y git chromium && node --version && npm --version && git --version && chromium --version && git clone https://github.com/Gabriel-Moors/whatsapp-api.git && cd whatsapp-api && sudo npm install venom-bot@5.0.1 express@4.18.2 winston@3.9.0 && sudo node app.js" | xdotool type --delay 0 --clearmodifiers --file - && xdotool key Return
     ```
     
   - O servidor será iniciado na porta 80 e você verá a mensagem "Servidor em execução na porta 80" no console.

Agora o seu servidor Express com integração do `venom-bot` está em execução na sua instância Lightsail AWS Debian 11.4. Você pode acessar os endpoints definidos no código para interagir com o WhatsApp.
