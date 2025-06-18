MCP服务器使用TypeScript编写  
以下安装命令可能需要网络代理  

**升级nodejs和npm：**  
1.安装管理器nvm：https://github.com/coreybutler/nvm-windows  
2.将安装目录添加到系统环境变量（默认为C:\Users\%username%\AppData\Local\nvm）  
3.打开cmd  
4.nvm install node          安装最新版（可以先使用nvm proxy <URL> 设置网络代理，clash为127.0.0.1:7897）  
5.nvm list                  查看当前已安装版本（注意最新版版本号）  
6.nvm use 最新版版本号       使用最新版  
7.nvm uninstall 旧版本版本号 卸载旧版本（可能需要以管理员身份运行cmd），不成功则手动删除旧版本文件夹  

**构建项目：**
1.创建项目文件夹，建议使用WebStorm创建TypeScript项目，并在项目根目录下打开cmd控制台，确保项目文件结构如此项目所示  
2.npm init -y  
3.npm install @modelcontextprotocol/sdk zod  
4.npm install -D @types/node typescript  

**修改代码：**
由于使用Typescript，每次修改index.ts后，都需要使用npm build编译为js

**启动MCP服务：**
1.使用npm start启动MCP Server
2.在支持MCP的客户端（Cherry Studio，Claude Desktop）中导入此MCP的配置json：config.json（位于此项目根目录下）