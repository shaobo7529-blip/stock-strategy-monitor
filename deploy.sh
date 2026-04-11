#!/bin/bash
# 美股策略监控 — AWS EC2 一键部署脚本
# 在 EC2 Instance Connect 终端中执行

set -e

echo "=== 1. 安装 Node.js ==="
if ! command -v node &> /dev/null; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
  sudo yum install -y nodejs
fi
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"

echo "=== 2. 创建项目目录 ==="
mkdir -p ~/stock-strategy-monitor
cd ~/stock-strategy-monitor

echo "=== 3. 初始化 package.json ==="
cat > package.json << 'PKGJSON'
{
  "name": "stock-strategy-monitor",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node dist/index.js",
    "serve": "PORT=80 node dist/server.js"
  },
  "dependencies": {
    "node-fetch": "^3.3.2",
    "https-proxy-agent": "^7.0.6",
    "socks-proxy-agent": "^8.0.5"
  }
}
PKGJSON

echo "=== 4. 安装依赖 ==="
npm install --production

echo "=== 5. 部署完成 ==="
echo "接下来需要上传 dist/ public/ config.json 文件"
echo "然后运行: sudo PORT=80 node dist/server.js"
