# INSTALAÇÃO WHATSAPP API

Aqui está um passo a passo detalhado:

1. Conectar-se à sua instância do Lightsail AWS Debian 11.4.

2. Atualizar o sistema:
   - Execute os seguintes comandos para atualizar o sistema operacional:
     ```
     sudo su
     sudo apt update
     sudo apt upgrade
     ```

3. Instalar o Node.js:
   - Use o gerenciador de pacotes `curl` para baixar o script de instalação do Node.js:
     ```
     curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
     ```
   - Instale o Node.js, npm e Chrome com o comando `apt`:
     ```
     sudo apt install -y nodejs
     sudo apt install -y git
     sudo apt install -y chromium
     ```

4. Verificar a instalação do Node.js e npm:
   - Verifique se o Node.js foi instalado corretamente digitando o seguinte comando:
     ```
     node --version
     ```
   - Verifique se o npm foi instalado corretamente digitando o seguinte comando:
     ```
     npm --version
     ```
   - Certifique-se de que ambas as versões são exibidas corretamente, o que indicará que o Node.js e o npm estão instalados com sucesso.

5. Criar um diretório para o projeto:
     ```
     git clone https://github.com/Gabriel-Moors/whatsapp-api.git
     ```
     
6. Instalar as dependências:
   - Execute o seguinte comando para instalar as dependências `venom-bot`, `express` e `winston`:
     ```
     npm install venom-bot express winston
     ```
     
7. Executar o servidor:
   - Execute o servidor Express com o seguinte comando:
     ```
     sudo node app.js
     ```
   - O servidor será iniciado na porta 80 e você verá a mensagem "Servidor em execução na porta 80" no console.

Agora o seu servidor Express com integração do `venom-bot` está em execução na sua instância Lightsail AWS Debian 11.4. Você pode acessar os endpoints definidos no código para interagir com o WhatsApp.
