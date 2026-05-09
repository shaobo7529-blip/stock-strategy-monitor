#!/bin/bash
# 每日自动运行股票策略监控
# 使用方法: crontab -e 添加以下行
# 0 9 * * 1-5 /home/ec2-user/stock-strategy-monitor/scripts/daily-monitor.sh >> /home/ec2-user/stock-strategy-monitor/logs/cron.log 2>&1

PROJECT_DIR="/home/ec2-user/stock-strategy-monitor"
LOG_DIR="$PROJECT_DIR/logs"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

# 创建日志目录
mkdir -p $LOG_DIR

echo "[$DATE] Starting daily monitor..."

cd $PROJECT_DIR

# 调用 API 触发刷新，并等待返回结果
RESPONSE=$(curl -s "http://localhost:3000/api/monitor?refresh=1")

# 检查返回的记录数
RECORD_COUNT=$(echo "$RESPONSE" | grep -o '"records":\[.*\]' | grep -o '"symbol"' | wc -l)

echo "[$DATE] Daily monitor completed. Records: $RECORD_COUNT"
